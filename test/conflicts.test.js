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
// Hasil proses lain yang belum terbit ikut memblokir ruang/dosen (kelas yang sedang dijadwalkan dikecualikan)
{
  const i = src.indexOf('async function pendingEvents'), j = src.indexOf('async function externalEvents');
  const fakeRuns = [{ id: 7, result: { assignments: [
    { class_id: 10, course_code: 'PAI1', course_name: 'A', class_name: 'A', group: 'PAI-2A', room_id: 1, lecturer_id: 5, room_code: 'R1', day: 1, start_time: '07:00', end_time: '08:25' },
    { class_id: 11, course_code: 'PAI2', course_name: 'B', class_name: 'A', group: 'PAI-2A', room_id: 2, lecturer_id: 6, room_code: 'R2', day: 2, start_time: '07:00', end_time: '08:25' },
    { class_id: 12, course_code: 'PAI3', course_name: 'C', class_name: 'A', group: 'PAI-2A', room_id: 9, lecturer_id: 9, room_code: 'R9', day: 3, start_time: '07:00', end_time: '08:25' }] } }];
  const db = { q: async () => fakeRuns };
  const pe = new Function('db', src.slice(i, j) + '\nreturn pendingEvents;')(db);
  pe(1, null, [11], [1, 2], [5]).then(ev => {
    ok('rombel A (belum terbit) memblokir ruang R1 & dosen 5 untuk rombel B', ev.length === 1 && ev[0].room_id === 1 && ev[0].dow === 1 && ev[0].title.includes('belum terbit'));
    ok('kelas milik proses sendiri dikecualikan; ruang/dosen tak terkait diabaikan', !ev.some(e => e.room_id === 2 || e.room_id === 9));
    const rows2 = analyze([mk({ id: 20, g: 'PAI-2B', l: 5, d: 1, s: '07:00', e: '08:25', r: 1 })], ev);
    ok('analisis: rombel B bentrok ruang & dosen dengan rombel A', rows2.some(r => r.cause === 'ruang_luar') && rows2.some(r => r.cause === 'dosen_luar'));
    console.log(`semua ${n} uji bentrok lulus`);
  });
}
if (false) console.log(`semua ${n} uji bentrok lulus`);
