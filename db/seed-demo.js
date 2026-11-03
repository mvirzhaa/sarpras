// Data CONTOH: satu unit, satu gedung 2 lantai lengkap dengan denah, dosen, mata kuliah,
// kelas semester aktif, jadwal kuliah hasil algoritma penjadwalan (sudah dipublikasikan),
// serta beberapa kegiatan non-kuliah (rapat rutin, seminar, peminjaman).
//
//   npm run db:seed-demo            -> membuat data contoh
//   npm run db:seed-demo -- --reset -> menghapus data contoh (hanya yang berkode DEMO)
//
// Jalankan setelah `npm run db:init`. Semua kode memakai penanda DEMO sehingga tidak
// bentrok dengan data asli dan dapat dihapus bersih.
require('dotenv').config();
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool, tx } = require('../src/db');
const { solve } = require('../src/services/ga');

const UNIT = { code: 'FTDEMO', name: 'Fakultas Teknik (Contoh)', head_name: 'Dr. Ir. Ahmad Fauzi, M.T.', head_nip: '197805122005011002',
  email: 'ft.demo@uika-bogor.ac.id', phone: '0251-8356884', description: 'Unit contoh untuk demonstrasi SARPRAS. Hapus dengan: npm run db:seed-demo -- --reset' };
const ADMIN = { username: 'admin.ftdemo', password: 'adminft123' };
const BUILDING = { code: 'GD-DEMO', name: 'Gedung Fakultas Teknik (Contoh)', address: 'Jl. K.H. Sholeh Iskandar KM 2, Kedung Badak, Tanah Sareal, Kota Bogor',
  latitude: -6.5568, longitude: 106.7803, year_built: 2015, floors_count: 2, building_area: 1440, land_area: 1800, ownership: 'milik sendiri',
  certificate_no: 'SHM 10.21.03.05.1.00123 (contoh)', permit_no: 'PBG-3271-2015-0456 (contoh)', slf_no: 'SLF-3271-2016-0078 (contoh)', condition: 'baik',
  acquisition_value: 18500000000, description: 'Gedung contoh: 2 lantai, ruang kelas, laboratorium, ruang dosen, aula.' };

// Denah 40 m × 18 m per lantai: deret atas y 1–7, koridor y 7–10, deret bawah y 10–17
const rect = (x, y, w, h) => ({ type: 'rect', x, y, w, h });
const FLOORS = [
  { level: 1, name: 'Lantai 1', rooms: [
    ['101', 'Ruang Kelas 101', 'Ruang Kelas', 40, rect(1, 1, 8, 6), 'Proyektor, AC 2 unit, papan tulis, 40 kursi kuliah'],
    ['102', 'Ruang Kelas 102', 'Ruang Kelas', 40, rect(9, 1, 8, 6), 'Proyektor, AC 2 unit, papan tulis, 40 kursi kuliah'],
    ['103', 'Laboratorium Komputer', 'Laboratorium', 40, rect(17, 1, 12, 6), '40 PC, proyektor, AC 3 unit, jaringan LAN'],
    ['104', 'Ruang Dosen Teknik Informatika', 'Ruang Dosen', 0, rect(29, 1, 10, 6), '10 meja kerja dosen, lemari arsip'],
    ['KOR-1', 'Koridor Lantai 1', 'Koridor / Tangga', 0, rect(1, 7, 38, 3), null],
    ['105', 'Ruang Rapat Fakultas', 'Ruang Rapat', 20, rect(1, 10, 8, 7), 'Meja rapat 20 kursi, TV 65", konferensi video'],
    ['106', 'Musala', 'Musala', 30, rect(9, 10, 6, 7), 'Tempat wudu, sajadah, AC'],
    ['107', 'Toilet Lantai 1', 'Toilet', 0, rect(15, 10, 4, 7), null],
    ['TG-1', 'Tangga Utama', 'Koridor / Tangga', 0, rect(19, 10, 4, 7), null],
    ['108', 'Gudang', 'Gudang', 0, rect(23, 10, 5, 7), 'Rak penyimpanan'],
    ['109', 'Tata Usaha Fakultas', 'Ruang Pengelola Unit', 0, rect(28, 10, 11, 7), 'Layanan administrasi akademik & keuangan'],
  ] },
  { level: 2, name: 'Lantai 2', rooms: [
    ['201', 'Ruang Kelas 201', 'Ruang Kelas', 45, rect(1, 1, 8, 6), 'Proyektor, AC 2 unit, papan tulis'],
    ['202', 'Ruang Kelas 202', 'Ruang Kelas', 45, rect(9, 1, 8, 6), 'Proyektor, AC 2 unit, papan tulis'],
    ['203', 'Ruang Kelas 203', 'Ruang Kelas', 45, rect(17, 1, 8, 6), 'Proyektor, AC 2 unit, papan tulis'],
    ['204', 'Laboratorium Jaringan', 'Laboratorium', 30, rect(25, 1, 14, 6), 'Router & switch Cisco, rak server, 30 PC'],
    ['KOR-2', 'Koridor Lantai 2', 'Koridor / Tangga', 0, rect(1, 7, 38, 3), null],
    ['205', 'Aula Fakultas', 'Aula / Auditorium', 120, rect(1, 10, 18, 7), 'Panggung, sound system, proyektor ganda, 120 kursi'],
    ['TG-2', 'Tangga Utama', 'Koridor / Tangga', 0, rect(19, 10, 4, 7), null],
    ['206', 'Ruang Kelas 206', 'Ruang Kelas', 50, rect(23, 10, 8, 7), 'Proyektor, AC 2 unit, papan tulis'],
    ['207', 'Toilet Lantai 2', 'Toilet', 0, rect(31, 10, 4, 7), null],
    ['208', 'Ruang Kaprodi', 'Ruang Dosen', 0, rect(35, 10, 4, 7), null],
  ] },
];

const LECTURERS = [
  ['DEMO-0001', 'Dr. Hendra Gunawan, M.Kom.', 'Lektor Kepala'],
  ['DEMO-0002', 'Siti Nurhaliza, M.T.', 'Lektor'],
  ['DEMO-0003', 'Rizky Pratama, M.Kom.', 'Asisten Ahli'],
  ['DEMO-0004', 'Dewi Kartika, M.Si.', 'Lektor'],
  ['DEMO-0005', 'Ir. Bambang Setiawan, M.T.', 'Lektor Kepala'],
  ['DEMO-0006', 'Fajar Ramadhan, M.Cs.', 'Asisten Ahli'],
  ['DEMO-0007', 'Ust. Abdul Hakim, Lc., M.A.', 'Lektor'],
  ['DEMO-0008', 'Maya Anggraini, M.Pd.', 'Asisten Ahli'],
];
// [kode, nama, sks, semester, tag, kategori ruang wajib (null = Ruang Kelas), durasi sesi, dosen per rombel {rombel: NIDN}]
const COURSES = [
  ['DTIF101', 'Kalkulus I', 3, 1, ['matematika'], null, 3, { 'TI-1A': 'DEMO-0004', 'TI-1B': 'DEMO-0004' }],
  ['DTIF102', 'Algoritma dan Pemrograman', 3, 1, [], null, 3, { 'TI-1A': 'DEMO-0001', 'TI-1B': 'DEMO-0003' }],
  ['DTIF103', 'Praktikum Algoritma dan Pemrograman', 1, 1, ['praktikum'], 'Laboratorium', 2, { 'TI-1A': 'DEMO-0003', 'TI-1B': 'DEMO-0003' }],
  ['DTIF104', 'Pengantar Teknologi Informasi', 2, 1, [], null, 2, { 'TI-1A': 'DEMO-0006', 'TI-1B': 'DEMO-0006' }],
  ['DTIF105', 'Bahasa Inggris I', 2, 1, [], null, 2, { 'TI-1A': 'DEMO-0008', 'TI-1B': 'DEMO-0008' }],
  ['DTIF301', 'Struktur Data', 3, 3, [], null, 3, { 'TI-3A': 'DEMO-0001' }],
  ['DTIF302', 'Basis Data', 3, 3, [], null, 3, { 'TI-3A': 'DEMO-0002' }],
  ['DTIF303', 'Praktikum Basis Data', 1, 3, ['praktikum'], 'Laboratorium', 2, { 'TI-3A': 'DEMO-0002' }],
  ['DTIF304', 'Matematika Diskrit', 3, 3, ['matematika'], null, 3, { 'TI-3A': 'DEMO-0004' }],
  ['DTIF305', 'Pendidikan Agama Islam', 2, 3, [], null, 2, { 'TI-3A': 'DEMO-0007' }],
  ['DTIF501', 'Rekayasa Perangkat Lunak', 3, 5, [], null, 3, { 'TI-5A': 'DEMO-0002' }],
  ['DTIF502', 'Jaringan Komputer', 3, 5, [], null, 3, { 'TI-5A': 'DEMO-0005' }],
  ['DTIF503', 'Praktikum Jaringan Komputer', 1, 5, ['praktikum'], 'Laboratorium', 2, { 'TI-5A': 'DEMO-0005' }],
  ['DTIF504', 'Kecerdasan Buatan', 3, 5, [], null, 3, { 'TI-5A': 'DEMO-0006' }],
  ['DTIF505', 'Metodologi Penelitian', 2, 5, [], null, 2, { 'TI-5A': 'DEMO-0005' }],
];
const GROUPS = { 'TI-1A': ['A', 40], 'TI-1B': ['B', 38], 'TI-3A': ['A', 35], 'TI-5A': ['A', 30] };
// Kendala penjadwalan (sama dengan pilihan di layar Penjadwalan kuliah)
const CONSTRAINTS = [
  { type: 'time', mode: 'avoid', scope: { kind: 'all' }, days: [5], slots: [6, 7], hard: true, weight: 100 }, // salat Jumat
  { type: 'time', mode: 'early', scope: { kind: 'tags', values: ['matematika'] }, weight: 30 },
  { type: 'lecturer_max_daily', max: 3, weight: 15 },
  { type: 'spread_sessions', weight: 10 },
  { type: 'group_compact', weight: 3 },
];
const DAYS = [1, 2, 3, 4, 5]; // Senin–Jumat
const SLOT_NOS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]; // 07.30–17.10 (kelas malam tidak dipakai)

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = d => addDays(d, -((d.getDay() + 6) % 7));

async function reset(c) {
  await c.query(`DELETE FROM buildings WHERE code=$1`, [BUILDING.code]);              // lantai, ruang, event ikut terhapus
  await c.query(`DELETE FROM units WHERE code=$1`, [UNIT.code]);                       // akun admin, kelas, proses penjadwalan ikut terhapus
  await c.query(`DELETE FROM courses WHERE code LIKE 'DTIF%'`);
  await c.query(`DELETE FROM people WHERE id_number LIKE 'DEMO-%'`);
}

async function main() {
  if (process.argv.includes('--reset')) {
    await tx(reset);
    console.log('✔ Data contoh dihapus');
    return;
  }
  const exists = await pool.query('SELECT 1 FROM units WHERE code=$1 UNION ALL SELECT 1 FROM buildings WHERE code=$2', [UNIT.code, BUILDING.code]);
  if (exists.rowCount) { console.log('Data contoh sudah ada. Hapus dulu dengan: npm run db:seed-demo -- --reset'); return; }

  const sa = (await pool.query(`SELECT id FROM users WHERE role='superadmin' ORDER BY id LIMIT 1`)).rows[0];
  if (!sa) throw new Error('Akun superadmin belum ada. Jalankan npm run db:init terlebih dahulu.');
  const cats = new Map((await pool.query('SELECT id, name FROM room_categories')).rows.map(r => [r.name, r.id]));
  for (const f of FLOORS) for (const r of f.rooms) if (!cats.has(r[2])) throw new Error(`Kategori ruang "${r[2]}" tidak ditemukan. Jalankan npm run db:init.`);

  // Periode akademik aktif (dibuat bila belum ada)
  let period = (await pool.query(`SELECT * FROM academic_periods WHERE is_active ORDER BY start_date DESC LIMIT 1`)).rows[0];
  if (!period) {
    const y = new Date().getMonth() >= 7 ? new Date().getFullYear() : new Date().getFullYear() - 1;
    period = (await pool.query(`INSERT INTO academic_periods (name,start_date,end_date,is_active) VALUES ($1,$2,$3,true)
      ON CONFLICT (name) DO UPDATE SET is_active=true RETURNING *`, [`${y}/${y + 1} Ganjil`, `${y}-09-01`, `${y + 1}-01-31`])).rows[0];
  }

  const out = await tx(async c => {
    // ---- Unit & akun admin unit ----
    const unit = await c.one(`INSERT INTO units (code,name,description,head_name,head_nip,email,phone) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [UNIT.code, UNIT.name, UNIT.description, UNIT.head_name, UNIT.head_nip, UNIT.email, UNIT.phone]);
    await c.query(`INSERT INTO users (username,name,role,unit_id,is_unit_primary,active,password_hash,must_change_password)
      VALUES ($1,$2,'unit_admin',$3,true,true,$4,true) ON CONFLICT (username) DO NOTHING`,
    [ADMIN.username, 'Admin ' + UNIT.name, unit.id, await bcrypt.hash(ADMIN.password, 10)]);

    // ---- Gedung, lantai, ruang ----
    const B = BUILDING;
    const bld = await c.one(`INSERT INTO buildings (code,name,address,latitude,longitude,year_built,floors_count,building_area,land_area,ownership,
      certificate_no,permit_no,slf_no,condition,acquisition_value,description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [B.code, B.name, B.address, B.latitude, B.longitude, B.year_built, B.floors_count, B.building_area, B.land_area, B.ownership,
      B.certificate_no, B.permit_no, B.slf_no, B.condition, B.acquisition_value, B.description]);
    const room = {}; let nRooms = 0;
    for (const f of FLOORS) {
      const fl = await c.one(`INSERT INTO floors (building_id,level,name,width,height,grid) VALUES ($1,$2,$3,40,18,0.5) RETURNING id`, [bld.id, f.level, f.name]);
      for (const [code, name, cat, cap, shape, fac] of f.rooms) {
        const r = await c.one(`INSERT INTO rooms (building_id,floor_id,code,name,category_id,capacity,area,shape,facilities) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [bld.id, fl.id, code, name, cats.get(cat), cap, shape.w * shape.h, JSON.stringify(shape), fac]);
        room[code] = r.id; nRooms++;
      }
    }
    await c.query(`INSERT INTO unit_assignments (unit_id,building_id) VALUES ($1,$2)`, [unit.id, bld.id]);

    // ---- Dosen, mata kuliah, kelas semester aktif ----
    const lec = {};
    for (const [nidn, name, pos] of LECTURERS)
      lec[nidn] = (await c.one(`INSERT INTO people (id_number,name,kind,unit_id,position) VALUES ($1,$2,'dosen',$3,$4) RETURNING id`, [nidn, name, unit.id, pos])).id;
    let nClasses = 0;
    for (const [code, name, sks, sem, tags, reqCat, dur, byGroup] of COURSES) {
      const crs = await c.one(`INSERT INTO courses (code,name,credits,semester_level,unit_id,tags,preferred_category_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [code, name, sks, sem, unit.id, tags, cats.get(reqCat || 'Ruang Kelas')]);
      for (const [grp, nidn] of Object.entries(byGroup)) {
        const [cls, size] = GROUPS[grp];
        await c.query(`INSERT INTO course_classes (period_id,unit_id,course_id,class_name,student_group,lecturer_id,student_count,duration_slots,sessions_per_week,required_category_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9)`, [period.id, unit.id, crs.id, cls, grp, lec[nidn], size, dur, cats.get(reqCat || 'Ruang Kelas')]);
        nClasses++;
      }
    }

    // ---- Penjadwalan otomatis (algoritma yang sama dengan menu Penjadwalan kuliah) ----
    const classes = await c.q(`SELECT cc.*, c.code course_code, c.name course_name, c.tags, p.name lecturer_name FROM course_classes cc
      JOIN courses c ON c.id=cc.course_id LEFT JOIN people p ON p.id=cc.lecturer_id WHERE cc.period_id=$1 AND cc.unit_id=$2`, [period.id, unit.id]);
    const rooms = await c.q(`SELECT r.id, r.code, r.name, r.capacity, r.category_id FROM rooms r JOIN room_categories k ON k.id=r.category_id
      JOIN v_room_owner o ON o.room_id=r.id WHERE r.status='aktif' AND k.schedulable AND o.unit_id=$1 ORDER BY r.capacity`, [unit.id]);
    const slots = (await c.q(`SELECT slot_no, to_char(start_time,'HH24:MI') start_time, to_char(end_time,'HH24:MI') end_time FROM time_slots ORDER BY slot_no`))
      .filter(s => SLOT_NOS.includes(s.slot_no));
    const params = { population: 60, generations: 600, time_limit_ms: 20000, stagnation: 80 };
    const res = solve({ days: DAYS, slots, rooms, blocked: [], constraints: CONSTRAINTS, params, classes: classes.map(x => ({
      id: x.id, label: `${x.course_code} ${x.course_name} (${x.class_name})`, course_id: x.course_id, tags: x.tags || [], lecturer_id: x.lecturer_id,
      group: x.student_group, size: x.student_count, dur: x.duration_slots, sessions: x.sessions_per_week, category_id: x.required_category_id, fixed_room_id: x.fixed_room_id })) }, () => {});
    if (res.hard > 0) throw new Error(`Algoritma masih menyisakan ${res.hard} bentrok. Jalankan ulang skrip.`);
    if (res.warnings.length) throw new Error('Data contoh tidak konsisten: ' + res.warnings.join('; '));
    const cmap = new Map(classes.map(x => [x.id, x])), rmap = new Map(rooms.map(x => [x.id, x]));
    res.assignments = res.assignments.map(a => {
      const k = cmap.get(a.class_id), rm = rmap.get(a.room_id);
      return { ...a, course_code: k.course_code, course_name: k.course_name, class_name: k.class_name, lecturer_id: k.lecturer_id, lecturer_name: k.lecturer_name,
        group: k.student_group, size: k.student_count, room_code: rm.code, room_name: rm.name, capacity: rm.capacity };
    });
    res.slots = slots; res.days = DAYS; res.rooms = rooms;
    const run = await c.one(`INSERT INTO timetable_runs (period_id,unit_id,status,params,room_scope,constraints,progress,hard_violations,soft_penalty,result,log,created_by,finished_at,published_at)
      VALUES ($1,$2,'published',$3,$4,$5,100,$6,$7,$8,$9,$10,now(),now()) RETURNING id`,
    [period.id, unit.id, JSON.stringify({ ...params, days: DAYS, slot_nos: SLOT_NOS }), JSON.stringify({ mode: 'owned' }), JSON.stringify(CONSTRAINTS),
      res.hard, res.soft, JSON.stringify(res), `${res.generations} generasi, ${res.ms} ms, ${res.genes} sesi (data contoh)`, sa.id]);

    // Publikasi ke jadwal ruang untuk seluruh periode (logika sama dengan tombol "Publikasikan")
    const skip = [`${period.start_date.slice(0, 4)}-12-25`, `${Number(period.start_date.slice(0, 4)) + 1}-01-01`]; // contoh hari libur
    let nKuliah = 0;
    for (const a of res.assignments) {
      const rows = await c.q(`INSERT INTO events (room_id,title,event_type,start_at,end_at,unit_id,lecturer_id,participants,tt_run_id,tt_class_id,series_id,created_by)
        SELECT $1,$2,'kuliah',(d::date + $3::time)::timestamptz,(d::date + $4::time)::timestamptz,$5,$6,$7,$8,$9,$10::uuid,$11
        FROM generate_series($12::date,$13::date,'1 day') d WHERE extract(isodow FROM d)=$14 AND NOT (d::date = ANY($15::date[]))
        ON CONFLICT DO NOTHING RETURNING id`,
      [a.room_id, `${a.course_code} ${a.course_name} (${a.class_name})`, a.start_time, a.end_time, unit.id, a.lecturer_id, a.size, run.id, a.class_id,
        crypto.randomUUID(), sa.id, period.start_date, period.end_date, a.day, skip]);
      nKuliah += rows.length;
    }

    // ---- Kegiatan non-kuliah di sekitar pekan berjalan ----
    const mon = mondayOf(new Date());
    const ev = async (code, title, type, day, st, et, extra = {}) => {
      const s = new Date(`${ymd(addDays(mon, day))}T${st}:00`), e = new Date(`${ymd(addDays(mon, day))}T${et}:00`);
      const occ = extra.weeks ? Array.from({ length: extra.weeks }, (_, k) => [addDays(s, 7 * k), addDays(e, 7 * k)]) : [[s, e]];
      const series = occ.length > 1 ? crypto.randomUUID() : null; let n = 0;
      for (const [a, b] of occ) {
        const r = await c.one(`INSERT INTO events (room_id,title,event_type,description,start_at,end_at,unit_id,lecturer_id,participants,series_id,created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING RETURNING id`,
        [room[code], title, type, extra.desc || null, a, b, unit.id, extra.lecturer ? lec[extra.lecturer] : null, extra.participants || null, series, sa.id]);
        if (r) n++;
      }
      return n;
    };
    let nOther = 0;
    nOther += await ev('105', 'Rapat Pimpinan Fakultas', 'rapat', 0, '09:00', '11:00', { weeks: 8, participants: 12, desc: 'Rapat rutin pekanan dekan, wakil dekan, dan kaprodi' });
    nOther += await ev('105', 'Rapat Kurikulum Prodi Teknik Informatika', 'rapat', 2, '13:00', '15:00', { participants: 15, desc: 'Peninjauan kurikulum OBE bersama dosen prodi' });
    nOther += await ev('205', 'Seminar Nasional "AI untuk Pendidikan"', 'seminar', 3, '08:00', '12:00', { participants: 110, desc: 'Pembicara tamu dari industri' });
    nOther += await ev('205', 'Sidang Skripsi Gelombang I', 'ujian', 4, '13:30', '16:30', { participants: 20 });
    nOther += await ev('205', 'Kajian Rutin Jumat Pagi', 'lainnya', 4, '07:00', '07:30', { weeks: 8, participants: 60, lecturer: 'DEMO-0007' });

    // Satu ajuan peminjaman menunggu persetujuan (tampil di menu Peminjaman)
    const bdate = ymd(addDays(mon, 12));
    await c.query(`INSERT INTO booking_requests (code,room_id,owner_unit_id,requester_unit_id,requested_by,title,purpose,event_type,participants,start_at,end_at)
      VALUES ($1,$2,$3,$3,$4,'Workshop Himpunan Mahasiswa Informatika','Pelatihan Git & GitHub untuk mahasiswa baru','seminar',80,$5,$6)`,
    [`PJM-DEMO-${Date.now().toString().slice(-6)}`, room['205'], unit.id, sa.id, new Date(`${bdate}T13:00:00`), new Date(`${bdate}T16:00:00`)]);

    return { unit, bld, nRooms, nClasses, nKuliah, nOther, res, period };
  });

  console.log(`✔ Unit        : ${out.unit.name} (akun ${ADMIN.username} / ${ADMIN.password}, wajib ganti password)`);
  console.log(`✔ Gedung      : ${out.bld.name} — 2 lantai, ${out.nRooms} ruang dengan denah`);
  console.log(`✔ Penjadwalan : ${out.nClasses} kelas, periode ${out.period.name}; ${out.res.genes} sesi/pekan, bentrok ${out.res.hard} (${out.res.ms} ms)`);
  console.log(`✔ Jadwal ruang: ${out.nKuliah} pertemuan kuliah + ${out.nOther} kegiatan lain, 1 ajuan peminjaman`);
  console.log(`  Buka: Gedung & denah › ${out.bld.name}`);
}
main().catch(e => { console.error('✖', e.message); process.exitCode = 1; }).finally(() => pool.end());
