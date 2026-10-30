// Uji GA dengan data sintetis: node test/ga.test.js
const { solve } = require('../src/services/ga');
const slots = [['07:30','08:20'],['08:20','09:10'],['09:10','10:00'],['10:00','10:50'],['10:50','11:40'],['11:40','12:30'],['13:00','13:50'],['13:50','14:40'],['14:40','15:30'],['15:30','16:20'],['16:20','17:10']]
  .map(([s,e],i)=>({slot_no:i+1,start_time:s,end_time:e}));
const rooms = [];
for (let i=0;i<10;i++) rooms.push({id:i+1, code:'K'+(101+i), capacity: i<7?40:60, category_id: 1});
rooms.push({id:11, code:'LAB1', capacity:35, category_id:2},{id:12, code:'LAB2', capacity:35, category_id:2});
const classes = []; let id=1;
const groups = ['TI-1A','TI-1B','TI-3A','TI-3B','TI-5A','TI-5B','SI-1A','SI-3A','SI-5A','TI-7A'];
for (const g of groups) for (let k=0;k<7;k++) {
  const math = k===0;
  classes.push({ id:id++, label:`MK${k}-${g}`, course_id:k+ (g.startsWith('SI')?100:0), tags: math?['matematika']:[],
    lecturer_id: 1 + ((id*7) % 28), group:g, size: 30+((id*3)%25), dur: k===6?3:2, sessions:1, category_id: k===5?2:1 });
}
const constraints = [
  { type:'time', mode:'early', scope:{kind:'tags', values:['matematika']}, weight:30 },
  { type:'time', mode:'avoid', days:[5], slots:[5,6,7], hard:true, scope:{kind:'all'} },   // Jumatan
  { type:'time', mode:'only', days:[1,2,3], scope:{kind:'lecturer', values:[3]}, hard:true }, // dosen 3 hanya Sen-Rab
  { type:'lecturer_max_daily', max:3, weight:15 },
  { type:'group_compact', weight:3 },
];
const blocked = [{room_id:1, day:1, slot_index:0},{room_id:1, day:1, slot_index:1}];
const t=Date.now();
const res = solve({ days:[1,2,3,4,5,6], slots, rooms, classes, constraints, blocked, params:{population:50, generations:400, time_limit_ms:30000} },
  p => { if (p.generation % 50 === 0) console.log('gen', p.generation, 'hard', p.hard, 'soft', p.soft); });
console.log({ hard: res.hard, soft: res.soft, gens: res.generations, ms: res.ms, genes: res.genes, warnings: res.warnings.length, conflicts: res.conflicts.length });
// verifikasi independen
const occ = new Map(); let bad = 0;
for (const a of res.assignments) {
  const c = classes.find(x=>x.id===a.class_id);
  for (let s=a.slot_index; s<a.slot_index+c.dur; s++) {
    for (const k of [`r${a.room_id}`, `l${c.lecturer_id}`, `g${c.group}`]) { const key=`${k}-${a.day}-${s}`; if (occ.has(key)) bad++; occ.set(key,1); }
    if (a.day===5 && [4,5,6].includes(s)) bad++;
  }
  if (c.lecturer_id===3 && ![1,2,3].includes(a.day)) bad++;
  if (rooms.find(r=>r.id===a.room_id).category_id !== c.category_id) bad++;
}
const mathAvg = res.assignments.filter(a=>classes.find(c=>c.id===a.class_id).tags.length).reduce((s,a,_,arr)=>s+a.slot_index/arr.length,0);
console.log('verifikasi pelanggaran keras:', bad, '| rata-rata sesi mulai MK matematika (0=paling pagi):', mathAvg.toFixed(2));
process.exit(bad === 0 ? 0 : 1);
