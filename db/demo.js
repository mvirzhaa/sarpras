// Data uji coba: npm run db:demo  (setelah npm run db:init)
// Membuat unit Prodi TI + akun admin, gedung contoh dengan denah 2 lantai, penugasan, lalu mengimpor contoh data penjadwalan.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');
const S = require('./sample-tt');
const ttx = require('../src/services/tt-excel');

(async () => {
  const q = async (t, p) => (await pool.query(t, p)).rows;
  const cat = new Map((await q('SELECT id, name FROM room_categories')).map(c => [c.name, c.id]));
  let unit = (await q(`SELECT id FROM units WHERE code='TI'`))[0];
  if (!unit) {
    unit = (await q(`INSERT INTO units (code,name,head_name) VALUES ('TI','Program Studi Teknik Informatika','Kaprodi Teknik Informatika') RETURNING id`))[0];
    await q(`INSERT INTO users (username,name,role,unit_id,is_unit_primary,active,password_hash,must_change_password) VALUES ('admin.ti','Admin Prodi TI','unit_admin',$1,true,true,$2,true)`,
      [unit.id, await bcrypt.hash('adminti123', 10)]);
    console.log('✔ Unit TI + akun admin.ti / adminti123');
  }
  let b = (await q('SELECT id FROM buildings WHERE code=$1', [S.building.code]))[0];
  if (!b) {
    b = (await q(`INSERT INTO buildings (code,name,floors_count,ownership,condition,address) VALUES ($1,$2,$3,'Milik sendiri','baik','Kampus contoh') RETURNING id`, [S.building.code, S.building.name, S.building.floors]))[0];
    const floors = {};
    for (let l = 1; l <= S.building.floors; l++) floors[l] = (await q(`INSERT INTO floors (building_id,level,name,width,height) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [b.id, l, `Lantai ${l}`, S.building.width, S.building.height]))[0].id;
    for (const [lv, code, name, c, capa, x, y, w, h] of S.rooms)
      await q(`INSERT INTO rooms (building_id,floor_id,code,name,category_id,capacity,area,shape,facilities) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [b.id, floors[lv], code, name, cat.get(c) || null, capa, w * h, JSON.stringify({ type: 'rect', x, y, w, h }), c === 'Laboratorium' ? 'Komputer, proyektor, AC' : c === 'Ruang Kelas' ? 'Proyektor, AC, papan tulis' : null]);
    await q('INSERT INTO unit_assignments (unit_id,building_id) VALUES ($1,$2)', [unit.id, b.id]);
    console.log(`✔ Gedung ${S.building.code} dengan ${S.rooms.length} ruang, ditugaskan ke Prodi TI`);
  }
  const period = (await q('SELECT id, name FROM academic_periods WHERE is_active LIMIT 1'))[0];
  if (!period) throw new Error('Belum ada periode aktif — jalankan npm run db:init dulu');
  const wb = await ttx.buildWorkbook({ unitId: unit.id, sample: true });
  const data = await ttx.parseWorkbook(await wb.xlsx.writeBuffer());
  const r = await ttx.importData({ periodId: period.id, unitId: unit.id, data, dryRun: false });
  console.log(`✔ Periode ${period.name}: ${r.dosen.created + r.dosen.updated} dosen, ${r.mk.created + r.mk.updated} MK, ${r.kelas.created + r.kelas.updated} kelas`);
  if (r.errors.length) console.log('  Kesalahan:', r.errors);
  console.log(`  ${r.constraints.length} kendala dibaca. Tambahkan lewat Impor Excel di aplikasi agar tersimpan pada pengaturan penjadwalan,`);
  console.log('  atau atur manual di tab "2. Ruang & kendala". Masuk sebagai admin.ti / adminti123 lalu buka Penjadwalan kuliah.');
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
