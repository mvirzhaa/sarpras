'use strict';
/**
 * Penjadwalan kuliah otomatis — Memetic Genetic Algorithm
 * ------------------------------------------------------------------
 * Gen        : satu sesi pertemuan kelas = (opsi waktu t = hari*S + sesi_mulai, indeks ruang)
 * Domain     : dipersempit di awal (kapasitas, kategori ruang, ruang tetap, kendala KERAS waktu,
 *              sesi harus bersambung tanpa jeda istirahat) -> ruang pencarian jauh lebih kecil.
 * Kendala keras (penalti 1000/pelanggaran): bentrok ruang, bentrok dosen, bentrok rombel,
 *              ruang sudah terpakai event berulang lain (blocked).
 * Kendala lunak: preferensi waktu (only/avoid/early), pemerataan pertemuan, beban harian dosen,
 *              kepadatan jadwal rombel (minim jam kosong), kecocokan kapasitas ruang.
 * Operator   : inisialisasi greedy-acak (most-constrained-first) + acak, seleksi turnamen,
 *              uniform crossover per kelas, mutasi, local search terarah konflik (memetic)
 *              dengan evaluasi inkremental berbasis tabel okupansi (typed array).
 */
function solve(P, onProgress = () => {}) {
  const t0 = Date.now();
  const prm = Object.assign({ population: 60, generations: 1000, time_limit_ms: 120000, stagnation: 150, elite: 2, tournament: 3, crossover: 0.85, mutation: 0.02 }, P.params || {});
  const days = P.days.map(Number), D = days.length;
  const slots = P.slots, S = slots.length, DS = D * S;
  const rooms = P.rooms, R = rooms.length;
  if (!R) throw new Error('Tidak ada ruangan dalam cakupan penjadwalan');
  if (!S || !D) throw new Error('Hari atau sesi kuliah belum diatur');
  const rnd = n => (Math.random() * n) | 0;
  const slotIdx = new Map(slots.map((s, i) => [Number(s.slot_no), i]));
  const dayIdx = new Map(days.map((d, i) => [d, i]));
  const roomIdx = new Map(rooms.map((r, i) => [Number(r.id), i]));
  const contiguous = slots.map((s, i) => i < S - 1 && s.end_time === slots[i + 1].start_time);
  const canSpan = (s, dur) => { if (s + dur > S) return false; for (let k = s; k < s + dur - 1; k++) if (!contiguous[k]) return false; return true; };

  // ---- Gen ----
  const lecMap = new Map(), grpMap = new Map(), genes = [];
  const idx = (m, k) => (m.has(k) ? m.get(k) : (m.set(k, m.size), m.size - 1));
  P.classes.forEach((c, ci) => {
    const l = c.lecturer_id ? idx(lecMap, Number(c.lecturer_id)) : -1;
    const gp = c.group ? idx(grpMap, String(c.group)) : -1;
    const dur = Math.max(1, Math.min(S, Number(c.dur) || 2));
    for (let k = 0; k < Math.max(1, Number(c.sessions) || 1); k++) genes.push({ ci, c, k, l, gp, dur });
  });
  const G = genes.length, L = Math.max(1, lecMap.size), GP = Math.max(1, grpMap.size), NC = P.classes.length;
  if (!G) throw new Error('Belum ada kelas untuk dijadwalkan');

  // ---- Kendala ----
  const cons = (P.constraints || []).filter(c => c && c.enabled !== false).map(c => ({
    ...c, weight: Number(c.weight) || 10,
    daysSet: c.days && c.days.length ? new Set(c.days.map(d => dayIdx.get(Number(d))).filter(x => x !== undefined)) : null,
    slotSet: c.slots && c.slots.length ? new Set(c.slots.map(s => slotIdx.get(Number(s))).filter(x => x !== undefined)) : null,
  }));
  const lc = v => String(v).trim().toLowerCase();
  const scopeMatch = (con, g) => {
    const s = con.scope || { kind: 'all' }, vals = s.values || [], c = g.c;
    switch (s.kind) {
      case 'all': return true;
      case 'tags': return (c.tags || []).some(t => vals.map(lc).includes(lc(t)));
      case 'courses': return vals.map(Number).includes(Number(c.course_id));
      case 'lecturer': return vals.map(Number).includes(Number(c.lecturer_id));
      case 'classes': return vals.map(Number).includes(Number(c.id));
      case 'groups': return vals.map(lc).includes(lc(c.group || ''));
      default: return false;
    }
  };
  const timeViolation = (con, d, s, dur) => {
    if (con.mode === 'only') {
      if (con.daysSet && !con.daysSet.has(d)) return 1;
      if (con.slotSet) for (let k = 0; k < dur; k++) if (!con.slotSet.has(s + k)) return 1;
      return 0;
    }
    if (con.mode === 'avoid') {
      if (con.daysSet && !con.daysSet.has(d)) return 0;
      if (!con.slotSet) return 1;
      for (let k = 0; k < dur; k++) if (con.slotSet.has(s + k)) return 1;
      return 0;
    }
    if (con.mode === 'early') return S > 1 ? s / (S - 1) : 0;    // makin pagi makin baik
    if (con.mode === 'late') return S > 1 ? 1 - s / (S - 1) : 0;
    return 0;
  };
  const timeCons = cons.filter(c => c.type === 'time');
  const maxDaily = cons.find(c => c.type === 'lecturer_max_daily');
  const compact = cons.find(c => c.type === 'group_compact');
  const spread = cons.find(c => c.type === 'spread_sessions');
  const spreadW = spread ? spread.weight : 10;

  // ---- Domain (pruning) ----
  const warnings = [], timeOpts = [], timePen = [], roomOpts = [], roomPen = [];
  genes.forEach(g => {
    const tc = timeCons.filter(c => scopeMatch(c, g));
    let opts = []; const pen = new Float32Array(DS);
    for (let d = 0; d < D; d++) for (let s = 0; s < S; s++) {
      if (!canSpan(s, g.dur)) continue;
      let ok = true, p = 0;
      for (const c of tc) {
        const v = timeViolation(c, d, s, g.dur);
        if (!v) continue;
        if (c.hard && c.mode !== 'early' && c.mode !== 'late') { ok = false; break; }
        p += v * c.weight;
      }
      if (ok) { opts.push(d * S + s); pen[d * S + s] = p; }
    }
    if (!opts.length) {
      warnings.push(`Kelas ${g.c.label}: kendala keras waktu tidak dapat dipenuhi, kendala dilonggarkan`);
      for (let d = 0; d < D; d++) for (let s = 0; s < S; s++) if (canSpan(s, g.dur)) opts.push(d * S + s);
      if (!opts.length) throw new Error(`Durasi kelas ${g.c.label} (${g.dur} sesi) melebihi sesi bersambung yang tersedia`);
    }
    timeOpts.push(Int32Array.from(opts)); timePen.push(pen);

    const ro = [], rp = new Float32Array(R);
    rooms.forEach((r, ri) => {
      if (g.c.fixed_room_id) { if (Number(r.id) === Number(g.c.fixed_room_id)) ro.push(ri); return; }
      if (g.c.category_id && Number(r.category_id) !== Number(g.c.category_id)) return;
      if (Number(r.capacity) >= Number(g.c.size)) { ro.push(ri); rp[ri] = 2 * (r.capacity - g.c.size) / Math.max(r.capacity, 1); }
    });
    if (!ro.length) {
      const cand = rooms.map((r, ri) => ({ r, ri })).filter(x => !g.c.category_id || Number(x.r.category_id) === Number(g.c.category_id))
        .sort((a, b) => b.r.capacity - a.r.capacity).slice(0, 3);
      if (!cand.length) throw new Error(`Tidak ada ruang dengan kategori yang diminta untuk kelas ${g.c.label}`);
      cand.forEach(x => { ro.push(x.ri); rp[x.ri] = 50; });
      if (g.k === 0) warnings.push(`Kelas ${g.c.label} (${g.c.size} mhs) melebihi kapasitas ruang terbesar yang cocok`);
    }
    roomOpts.push(Int32Array.from(ro)); roomPen.push(rp);
  });

  // ---- Tabel okupansi ----
  const occR = new Int16Array(R * DS), occL = new Int16Array(L * DS), occG = new Int16Array(GP * DS);
  const blocked = new Uint8Array(R * DS);
  for (const b of P.blocked || []) {
    const ri = roomIdx.get(Number(b.room_id)), d = dayIdx.get(Number(b.day));
    if (ri !== undefined && d !== undefined && b.slot_index >= 0 && b.slot_index < S) blocked[ri * DS + d * S + b.slot_index] = 1;
  }
  const clear = () => { occR.fill(0); occL.fill(0); occG.fill(0); };
  const addGene = (gi, t, ri, sg) => {
    const g = genes[gi];
    for (let k = 0; k < g.dur; k++) {
      const cell = t + k;
      occR[ri * DS + cell] += sg;
      if (g.l >= 0) occL[g.l * DS + cell] += sg;
      if (g.gp >= 0) occG[g.gp * DS + cell] += sg;
    }
  };
  const clashIfPlaced = (gi, t, ri) => {
    const g = genes[gi]; let c = 0;
    for (let k = 0; k < g.dur; k++) {
      const cell = t + k;
      c += occR[ri * DS + cell] + blocked[ri * DS + cell];
      if (g.l >= 0) c += occL[g.l * DS + cell];
      if (g.gp >= 0) c += occG[g.gp * DS + cell];
    }
    return c;
  };
  const localScore = (gi, t, ri) => clashIfPlaced(gi, t, ri) * 1000 + timePen[gi][t] + roomPen[gi][ri];

  const classDay = new Int16Array(NC * D), lecDay = new Int16Array(L * D);
  function evaluate(ind) {
    clear(); classDay.fill(0); lecDay.fill(0);
    let hard = 0, soft = 0;
    const T = ind.T, Rm = ind.R;
    for (let gi = 0; gi < G; gi++) {
      const t = T[gi], ri = Rm[gi], g = genes[gi], d = (t / S) | 0;
      soft += timePen[gi][t] + roomPen[gi][ri];
      hard += clashIfPlaced(gi, t, ri);
      addGene(gi, t, ri, 1);
      if (classDay[g.ci * D + d]++ > 0) soft += spreadW;
      if (g.l >= 0) lecDay[g.l * D + d]++;
    }
    if (maxDaily && lecMap.size) {
      const mx = Number(maxDaily.max) || 3;
      for (let i = 0; i < L * D; i++) if (lecDay[i] > mx) soft += (lecDay[i] - mx) * maxDaily.weight;
    }
    if (compact && grpMap.size) {
      for (let gp = 0; gp < GP; gp++) for (let d = 0; d < D; d++) {
        let first = -1, last = -1, cnt = 0;
        const base = gp * DS + d * S;
        for (let s = 0; s < S; s++) if (occG[base + s] > 0) { if (first < 0) first = s; last = s; cnt++; }
        if (cnt) soft += ((last - first + 1) - cnt) * compact.weight;
      }
    }
    ind.hard = hard; ind.soft = Math.round(soft * 100) / 100; ind.fit = hard * 1000 + soft;
    return ind;
  }
  const isConflicted = (gi, T, Rm) => {
    const g = genes[gi], t = T[gi], ri = Rm[gi];
    for (let k = 0; k < g.dur; k++) {
      const cell = t + k;
      if (occR[ri * DS + cell] > 1 || blocked[ri * DS + cell] || (g.l >= 0 && occL[g.l * DS + cell] > 1) || (g.gp >= 0 && occG[g.gp * DS + cell] > 1)) return true;
    }
    return false;
  };
  const pickT = gi => timeOpts[gi][rnd(timeOpts[gi].length)];
  const pickR = gi => roomOpts[gi][rnd(roomOpts[gi].length)];
  const clone = x => ({ T: Int32Array.from(x.T), R: Int32Array.from(x.R), hard: x.hard, soft: x.soft, fit: x.fit });

  // Local search terarah konflik (bagian "memetic")
  function improve(ind, iters, k) {
    evaluate(ind);
    const T = ind.T, Rm = ind.R;
    for (let it = 0; it < iters; it++) {
      const conf = [];
      for (let gi = 0; gi < G; gi++) if (isConflicted(gi, T, Rm)) conf.push(gi);
      const gi = conf.length ? conf[rnd(conf.length)] : rnd(G);
      addGene(gi, T[gi], Rm[gi], -1);
      let bT = T[gi], bR = Rm[gi], bS = localScore(gi, bT, bR);
      for (let j = 0; j < k; j++) {
        const t = j % 3 === 1 ? T[gi] : pickT(gi), r = j % 3 === 2 ? Rm[gi] : pickR(gi);
        const sc = localScore(gi, t, r);
        if (sc < bS) { bS = sc; bT = t; bR = r; }
      }
      T[gi] = bT; Rm[gi] = bR; addGene(gi, bT, bR, 1);
    }
    return evaluate(ind);
  }
  function construct() {
    clear();
    const ind = { T: new Int32Array(G), R: new Int32Array(G) };
    const order = [...Array(G).keys()].map(gi => [gi, timeOpts[gi].length * roomOpts[gi].length * (0.7 + Math.random() * 0.6)])
      .sort((a, b) => a[1] - b[1]).map(x => x[0]);
    for (const gi of order) {
      let bT = pickT(gi), bR = pickR(gi), bS = localScore(gi, bT, bR);
      for (let j = 0; j < 24 && bS >= 1000; j++) { const t = pickT(gi), r = pickR(gi), sc = localScore(gi, t, r); if (sc < bS) { bS = sc; bT = t; bR = r; } }
      for (let j = 0; j < 6; j++) { const t = pickT(gi), r = pickR(gi), sc = localScore(gi, t, r); if (sc < bS) { bS = sc; bT = t; bR = r; } }
      ind.T[gi] = bT; ind.R[gi] = bR; addGene(gi, bT, bR, 1);
    }
    return evaluate(ind);
  }
  function randomInd() {
    const ind = { T: new Int32Array(G), R: new Int32Array(G) };
    for (let gi = 0; gi < G; gi++) { ind.T[gi] = pickT(gi); ind.R[gi] = pickR(gi); }
    return evaluate(ind);
  }
  const tournament = pop => { let b = pop[rnd(pop.length)]; for (let i = 1; i < prm.tournament; i++) { const x = pop[rnd(pop.length)]; if (x.fit < b.fit) b = x; } return b; };
  const coin = new Uint8Array(NC);
  function crossover(a, b) {
    for (let i = 0; i < NC; i++) coin[i] = Math.random() < 0.5 ? 1 : 0;
    const c = { T: new Int32Array(G), R: new Int32Array(G) };
    for (let gi = 0; gi < G; gi++) { const src = coin[genes[gi].ci] ? a : b; c.T[gi] = src.T[gi]; c.R[gi] = src.R[gi]; }
    return c;
  }
  function mutate(c) {
    const pm = Math.max(prm.mutation, 1 / G);
    for (let gi = 0; gi < G; gi++) if (Math.random() < pm) {
      const m = Math.random();
      if (m < 0.5) c.T[gi] = pickT(gi); else if (m < 0.8) c.R[gi] = pickR(gi); else { c.T[gi] = pickT(gi); c.R[gi] = pickR(gi); }
    }
  }

  // ---- Evolusi ----
  const N = Math.max(10, Number(prm.population));
  let pop = [];
  for (let i = 0; i < N; i++) pop.push(i < Math.ceil(N * 0.6) ? construct() : randomInd());
  pop.sort((a, b) => a.fit - b.fit);
  let best = clone(pop[0]), stagn = 0, gen = 0;
  for (gen = 1; gen <= prm.generations; gen++) {
    if (Date.now() - t0 > prm.time_limit_ms) break;
    const next = pop.slice(0, prm.elite).map(clone);
    while (next.length < N) {
      const a = tournament(pop), b = tournament(pop);
      const child = Math.random() < prm.crossover ? crossover(a, b) : clone(a);
      mutate(child);
      if (Math.random() < 0.35) improve(child, 4, 8); else evaluate(child);
      next.push(child);
    }
    pop = next.sort((a, b) => a.fit - b.fit);
    const polished = improve(clone(pop[0]), 30, 16);
    if (polished.fit < pop[0].fit) pop[0] = polished;
    if (pop[0].fit < best.fit - 1e-9) { best = clone(pop[0]); stagn = 0; } else stagn++;
    if (gen % 10 === 0) onProgress({ generation: gen, hard: best.hard, soft: best.soft, progress: Math.min(99, Math.round(100 * Math.max(gen / prm.generations, (Date.now() - t0) / prm.time_limit_ms))) });
    if (best.hard === 0 && stagn >= prm.stagnation) break;
  }
  const fin = improve(clone(best), Math.min(2000, G * 4), 24);
  if (fin.fit < best.fit) best = fin;
  evaluate(best);

  // ---- Hasil ----
  const conflicts = [];
  for (let gi = 0; gi < G; gi++) {
    if (!isConflicted(gi, best.T, best.R)) continue;
    const g = genes[gi], t = best.T[gi], ri = best.R[gi], why = new Set();
    for (let k = 0; k < g.dur; k++) {
      const cell = t + k;
      if (occR[ri * DS + cell] > 1) why.add('bentrok ruang');
      if (blocked[ri * DS + cell]) why.add('ruang terpakai jadwal lain');
      if (g.l >= 0 && occL[g.l * DS + cell] > 1) why.add('bentrok dosen');
      if (g.gp >= 0 && occG[g.gp * DS + cell] > 1) why.add('bentrok rombel');
    }
    conflicts.push({ class_id: g.c.id, label: g.c.label, session: g.k + 1, reasons: [...why] });
  }
  const assignments = genes.map((g, gi) => {
    const t = best.T[gi], d = (t / S) | 0, s = t % S;
    return { class_id: g.c.id, session: g.k + 1, day: days[d], slot_index: s, slot_start: slots[s].slot_no, slot_end: slots[s + g.dur - 1].slot_no,
      start_time: slots[s].start_time, end_time: slots[s + g.dur - 1].end_time, room_id: rooms[best.R[gi]].id, pref_penalty: Math.round(timePen[gi][t] * 10) / 10 };
  });
  return { assignments, hard: best.hard, soft: best.soft, generations: gen, ms: Date.now() - t0, genes: G, warnings, conflicts };
}
module.exports = { solve };
