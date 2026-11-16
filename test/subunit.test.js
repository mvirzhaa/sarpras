// Uji dukungan sub unit pada penjadwalan: dosen lintas program studi tidak boleh bentrok. node test/subunit.test.js
const { solve } = require('../src/services/ga');
const slots = [['07:30', '08:20'], ['08:20', '09:10'], ['09:10', '10:00'], ['10:00', '10:50']].map(([s, e], i) => ({ slot_no: i + 1, start_time: s, end_time: e }));
const rooms = [{ id: 1, code: 'K1', capacity: 40, category_id: 1 }, { id: 2, code: 'K2', capacity: 40, category_id: 1 }];
let fail = 0; const ok = (n, c, x) => { if (!c) { fail++; console.log('GAGAL', n, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', n); };

// Prodi SI memakai dosen 7 yang sudah mengajar (di prodi TI) Senin sesi 1-3 (index 0..2)
const base = { days: [1, 2], slots, rooms, constraints: [], params: { population: 30, generations: 200, time_limit_ms: 8000 } };
const classes = [{ id: 1, label: 'SI-A', lecturer_id: 7, group: 'SI-1A', size: 30, dur: 2, sessions: 1 }, { id: 2, label: 'SI-B', lecturer_id: 7, group: 'SI-1B', size: 30, dur: 2, sessions: 1 }];
const lecBlocked = [0, 1, 2].map(i => ({ lecturer_id: 7, day: 1, slot_index: i }));
const r1 = solve({ ...base, classes, blocked: [], lecBlocked });
ok('tanpa bentrok keras', r1.hard === 0, r1.conflicts);
const clash = r1.assignments.filter(a => a.day === 1 && a.slot_start <= 3);   // sesi 1-3 pada Senin
ok('dosen tidak dijadwalkan pada jamnya mengajar di prodi lain', clash.length === 0, r1.assignments.map(a => [a.day, a.slot_start, a.slot_end]));

// Semua sel tersedia diblokir -> bentrok dosen harus terlapor, bukan lolos diam-diam
const all = []; for (const d of [1, 2]) for (let i = 0; i < 4; i++) all.push({ lecturer_id: 7, day: d, slot_index: i });
const r2 = solve({ ...base, classes: [classes[0]], blocked: [], lecBlocked: all });
ok('dosen penuh jadwal -> terlapor bentrok dosen', r2.hard > 0 && r2.conflicts.some(c => c.reasons.includes('bentrok dosen')), r2.conflicts);

// Dosen lain tidak terpengaruh
const r3 = solve({ ...base, classes: [{ ...classes[0], lecturer_id: 8 }], blocked: [], lecBlocked: all });
ok('dosen lain bebas', r3.hard === 0);
console.log(fail ? fail + ' uji gagal' : 'semua uji sub unit lulus'); process.exit(fail ? 1 : 0);
