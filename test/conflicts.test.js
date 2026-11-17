// Uji analisis bentrok (analyze) tanpa database: fungsi diambil langsung dari src/routes/timetable.js
const fs = require('fs'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../src/routes/timetable.js', 'utf8');
const a = src.indexOf("const DAYS = ["), b = src.indexOf('async function externalEvents'), c = src.indexOf('// Daftar bentrok keras per penyebab'), d = src.indexOf("\n}\n", c) + 3;
const { analyze, CAUSES } = new Function(src.slice(a, b) + src.slice(c, d) + '\nreturn { analyze, CAUSES };')();
let n = 0; const ok = (m, c) => { n++; assert(c, m); console.log('ok  ', m); };
const mk = (o) => ({ class_id: o.id, session: 1, course_code: 'MK' + o.id, course_name: 'Mata ' + o.id, class_name: 'A', group: o.g, lecturer_id: o.l, lecturer_name: 'Dosen ' + o.l, day: o.d, start_time: o.s, end_time: o.e, room_id: o.r, room_code: 'R' + o.r });
const A = [mk({ id: 1, g: 'G1', l: 1, d: 1, s: '07:00', e: '08:30', r: 1 }), mk({ id: 2, g: 'G2', l: 1, d: 1, s: '08:00', e: '09:30', r: 2 }),   // dosen sama, bertumpuk
  mk({ id: 3, g: 'G3', l: 2, d: 1, s: '07:00', e: '08:30', r: 1 }),                                                                        // ruang sama dengan #1
  mk({ id: 4, g: 'G1', l: 3, d: 1, s: '08:00', e: '09:00', r: 3 }),                                                                        // rombel sama dengan #1
  mk({ id: 5, g: 'G5', l: 4, d: 2, s: '07:00', e: '08:30', r: 4 })];                                                                       // bersih (hari lain)
const rows = analyze(A, [{ title: 'Rapat Dekan', room_id: 4, lecturer_id: 4, room_code: 'R4', dow: 2, st: '08:00', et: '10:00' }, { title: 'Kuliah lain', room_id: 9, lecturer_id: 4, room_code: 'R9', dow: 5, st: '07:00', et: '08:00' }]);
const by = k => rows.filter(r => r.cause === k).map(r => r.class_id).sort();
ok('bentrok dosen: MK1 & MK2', JSON.stringify(by('dosen')) === '[1,2]');
ok('bentrok ruang: MK1 & MK3', JSON.stringify(by('ruang')) === '[1,3]');
ok('bentrok rombel: MK1 & MK4', JSON.stringify(by('rombel')) === '[1,4]');
ok('ruang dipakai kegiatan lain: MK5', JSON.stringify(by('ruang_luar')) === '[5]' && rows.find(r => r.cause === 'ruang_luar').with[0].includes('Rapat Dekan'));
ok('dosen di jadwal lain: MK5 (hanya yang bertumpuk)', JSON.stringify(by('dosen_luar')) === '[5]');
ok('urut per penyebab', rows.map(r => CAUSES.findIndex(c => c[0] === r.cause)).every((v, i, arr) => !i || arr[i - 1] <= v));
ok('baris bersih tidak muncul', !analyze([A[4]], []).length);
console.log(`semua ${n} uji bentrok lulus`);
