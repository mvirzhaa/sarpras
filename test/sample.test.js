// Uji kelayakan contoh data penjadwalan terhadap gedung contoh: node test/sample.test.js
const { solve } = require('../src/services/ga');
const S = require('../db/sample-tt');
const base = [['07:30','08:20'],['08:20','09:10'],['09:10','10:00'],['10:00','10:50'],['10:50','11:40'],['11:40','12:30'],['13:00','13:50'],['13:50','14:40'],['14:40','15:30'],['15:30','16:20'],['16:20','17:10'],['18:30','19:20'],['19:20','20:10'],['20:10','21:00']];
const slots = base.map(([s, e], i) => ({ slot_no: i + 1, start_time: s, end_time: e }));
const CAT = { 'Ruang Kelas': 1, Laboratorium: 2 };
const rooms = S.rooms.filter(r => CAT[r[3]]).map(([, code, , c, capacity], i) => ({ id: i + 1, code, capacity, category_id: CAT[c] }));
const lect = new Map(S.dosen.map((d, i) => [d.id_number, i + 1]));
const mk = new Map(S.mk.map((m, i) => [m.code, { ...m, id: i + 1 }]));
const classes = S.kelas.map((k, i) => ({ id: i + 1, label: `${k.course_code}-${k.class_name}`, course_id: mk.get(k.course_code).id, tags: mk.get(k.course_code).tags ? [mk.get(k.course_code).tags] : [],
  lecturer_id: lect.get(k.lecturer), group: k.student_group, size: k.student_count, dur: k.duration_slots, sessions: 1, category_id: k.category ? CAT[k.category] : null }));
const D = { senin: 1, selasa: 2, rabu: 3, kamis: 4, jumat: 5, sabtu: 6 };
const range = (s, map) => String(s || '').split(';').filter(Boolean).flatMap(p => { const [a, b] = p.split('-').map(x => map ? map[x.trim().toLowerCase()] : Number(x)); return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a]; });
const T = { 'Utamakan pagi': ['time', 'early'], 'Hanya pada': ['time', 'only'], 'Tidak pada': ['time', 'avoid'], 'Maks kelas dosen per hari': ['lecturer_max_daily'], 'Padatkan rombel': ['group_compact'], 'Sebar pertemuan': ['spread_sessions'] };
const SC = { Semua: 'all', Tag: 'tags', Dosen: 'lecturer', Rombel: 'groups' };
const constraints = S.kendala.map(k => { const [type, mode] = T[k.type]; const c = { type, mode, weight: k.weight, hard: k.hard === 'Ya', max: Number(k.values) || 3 };
  if (type === 'time') { const kind = SC[k.scope]; c.scope = { kind, values: kind === 'lecturer' ? k.values.split(';').map(v => lect.get(v)) : k.values.split(';').filter(Boolean) }; c.days = range(k.days, D); c.slots = range(k.slots); }
  return c; });
const res = solve({ days: [1, 2, 3, 4, 5, 6], slots, rooms, classes, constraints, blocked: [], params: { population: 60, generations: 800, time_limit_ms: 60000 } });
console.log({ kelas: classes.length, ruang: rooms.length, hard: res.hard, soft: res.soft, gens: res.generations, ms: res.ms, warnings: res.warnings, conflicts: res.conflicts.slice(0, 5) });
const k3 = res.assignments.filter(a => classes[a.class_id - 1].group === 'TI-3K');
console.log('TI-3K:', k3.map(a => `hari ${a.day} sesi ${a.slot_start}-${a.slot_end}`).join(' | '));
const jumat6 = res.assignments.filter(a => a.day === 5 && a.slot_start <= 6 && a.slot_end >= 6).length;
console.log('Kelas yang beririsan Jumat sesi 6:', jumat6);
process.exit(res.hard === 0 && jumat6 === 0 ? 0 : 1);
