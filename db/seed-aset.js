// Contoh aset tetap per ruang kelas: npm run db:aset  (setelah db:init dan data gedung/ruang ada)
// Setiap Ruang Kelas diberi: meja dosen, kursi belajar (sejumlah kapasitas), papan tulis, infokus, AC. Aman dijalankan ulang.
require('dotenv').config();
const { pool } = require('../src/db');

const ITEMS = [  // [kode, nama, merek, harga, jumlah(fn ruang)]
  ['3.05.02.01.004', 'Meja Dosen', 'Olympic', 1500000, () => 1],
  ['3.05.02.01.005', 'Kursi Belajar (dengan lengan tulis)', 'Chitose', 450000, r => Math.max(1, r.capacity || 30)],
  ['3.05.02.01.006', 'Papan Tulis Whiteboard 120x240', 'Sakana', 1200000, () => 1],
  ['3.10.02.03.001', 'Proyektor (Infokus)', 'Epson EB-X06', 6500000, () => 1],
  ['3.05.02.02.001', 'AC Split 2 PK', 'Daikin', 9500000, () => 2],
];

(async () => {
  const q = async (t, p) => (await pool.query(t, p)).rows;
  const rooms = await q(`SELECT r.id, r.code, r.capacity, a.unit_id FROM rooms r JOIN room_categories c ON c.id=r.category_id
    LEFT JOIN unit_assignments a ON a.building_id=r.building_id WHERE c.name='Ruang Kelas' ORDER BY r.code`);
  if (!rooms.length) { console.log('Belum ada Ruang Kelas. Jalankan npm run db:demo atau buat gedung/ruang dulu.'); return pool.end(); }
  let made = 0;
  for (const room of rooms) for (const [kode, nama, merek, harga, jml] of ITEMS) {
    const code = (await q('SELECT id, code, useful_life_years FROM asset_codes WHERE code=$1', [kode]))[0];
    if (!code) { console.log(`Kode ${kode} belum ada — jalankan npm run db:init`); continue; }
    if ((await q(`SELECT 1 FROM assets WHERE room_id=$1 AND asset_code_id=$2 AND status='aktif' LIMIT 1`, [room.id, code.id])).length) continue;
    const n = jml(room);
    let nup = (await q('SELECT COALESCE(MAX(nup),0)::int m FROM assets WHERE asset_code_id=$1', [code.id]))[0].m;
    for (let i = 0; i < n; i++) {
      nup++;
      const a = (await q(`INSERT INTO assets (asset_code_id,nup,tag,name,brand,acquisition_date,acquisition_method,price,useful_life_years,condition,room_id,unit_id)
        VALUES ($1,$2,$3,$4,$5,CURRENT_DATE - 365,'pembelian',$6,$7,'baik',$8,$9) RETURNING id`,
        [code.id, nup, `${code.code}.${String(nup).padStart(5, '0')}`, nama, merek, harga, code.useful_life_years, room.id, room.unit_id]))[0];
      await q(`INSERT INTO asset_history (asset_id,action,to_room_id,to_condition,note) VALUES ($1,'registrasi',$2,'baik','Data contoh')`, [a.id, room.id]).catch(() => {});
      made++;
    }
  }
  console.log(`✔ ${made} aset contoh dibuat di ${rooms.length} ruang kelas`);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
