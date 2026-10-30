const express = require('express');
const path = require('path');
const { Worker } = require('worker_threads');
const crypto = require('crypto');
const { db, tx } = require('../db');
const { ah, fail, pick, setClause, insertSql, audit, notifyUnit } = require('../util');
const { isSA, roles } = require('../auth');

const r = express.Router();
const workers = new Map();
const unitGuard = (user, unitId) => { if (!isSA(user) && Number(unitId) !== Number(user.unit_id)) fail(403, 'Hanya dapat mengelola data unit sendiri'); };

// ---------------- Kelas per semester ----------------
const CF = ['period_id', 'unit_id', 'course_id', 'class_name', 'student_group', 'lecturer_id', 'student_count', 'duration_slots', 'sessions_per_week', 'required_category_id', 'fixed_room_id', 'note'];
const CLASS_SQL = `SELECT cc.*, c.code course_code, c.name course_name, c.credits, c.tags, c.semester_level, p.name lecturer_name,
    rc.name category_name, fr.code fixed_room_code FROM course_classes cc JOIN courses c ON c.id=cc.course_id
    LEFT JOIN people p ON p.id=cc.lecturer_id LEFT JOIN room_categories rc ON rc.id=cc.required_category_id LEFT JOIN rooms fr ON fr.id=cc.fixed_room_id`;
r.get('/tt/classes', ah(async (req, res) => {
  if (!req.query.period_id || !req.query.unit_id) fail(400, 'Pilih periode dan unit');
  res.json(await db.q(`${CLASS_SQL} WHERE cc.period_id=$1 AND cc.unit_id=$2 ORDER BY c.semester_level NULLS LAST, c.code, cc.class_name`, [req.query.period_id, req.query.unit_id]));
}));
r.post('/tt/classes', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const d = pick(req.body, CF); unitGuard(req.user, d.unit_id);
  const { sql, values } = insertSql('course_classes', d);
  res.status(201).json(await db.one(sql, values));
}));
r.put('/tt/classes/:id', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const ex = await db.one('SELECT unit_id FROM course_classes WHERE id=$1', [req.params.id]);
  if (!ex) fail(404, 'Kelas tidak ditemukan'); unitGuard(req.user, ex.unit_id);
  const { sql, values } = setClause(pick(req.body, CF.filter(f => f !== 'unit_id' && f !== 'period_id')), 2);
  res.json(await db.one(`UPDATE course_classes SET ${sql} WHERE id=$1 RETURNING *`, [req.params.id, ...values]));
}));
r.delete('/tt/classes/:id', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const ex = await db.one('SELECT unit_id FROM course_classes WHERE id=$1', [req.params.id]);
  if (!ex) fail(404, 'Kelas tidak ditemukan'); unitGuard(req.user, ex.unit_id);
  await db.query('DELETE FROM course_classes WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));
// Impor massal dari CSV/Excel (sudah di-parse di frontend)
r.post('/tt/classes/import', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const { period_id, unit_id, rows = [] } = req.body; unitGuard(req.user, unit_id);
  let n = 0; const errors = [];
  await tx(async c => {
    const cats = await c.q('SELECT id, lower(name) n FROM room_categories');
    for (const [i, x] of rows.entries()) {
      try {
        if (!x.course_code) throw new Error('kode MK kosong');
        let course = await c.one('SELECT id FROM courses WHERE code=$1', [x.course_code]);
        if (!course) {
          if (!x.course_name) throw new Error(`MK ${x.course_code} belum terdaftar, isi nama MK`);
          course = await c.one(`INSERT INTO courses (code,name,credits,semester_level,unit_id,tags) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
            [x.course_code, x.course_name, Number(x.credits) || 2, Number(x.semester_level) || null, unit_id,
              String(x.tags || '').split(/[;,]/).map(s => s.trim().toLowerCase()).filter(Boolean)]);
        }
        let lec = null;
        if (x.lecturer) {
          lec = await c.one('SELECT id FROM people WHERE id_number=$1 OR lower(name)=lower($1) LIMIT 1', [String(x.lecturer).trim()]);
          if (!lec) lec = await c.one(`INSERT INTO people (name,kind,unit_id) VALUES ($1,'dosen',$2) RETURNING id`, [String(x.lecturer).trim(), unit_id]);
        }
        const cat = x.category ? cats.find(k => k.n === String(x.category).toLowerCase()) : null;
        await c.query(`INSERT INTO course_classes (period_id,unit_id,course_id,class_name,student_group,lecturer_id,student_count,duration_slots,sessions_per_week,required_category_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (period_id,course_id,class_name) DO UPDATE SET student_group=EXCLUDED.student_group,
          lecturer_id=EXCLUDED.lecturer_id, student_count=EXCLUDED.student_count, duration_slots=EXCLUDED.duration_slots,
          sessions_per_week=EXCLUDED.sessions_per_week, required_category_id=EXCLUDED.required_category_id`,
        [period_id, unit_id, course.id, x.class_name || 'A', x.student_group || null, lec && lec.id, Number(x.student_count) || 30,
          Number(x.duration_slots) || Number(x.credits) || 2, Number(x.sessions_per_week) || 1, cat && cat.id]);
        n++;
      } catch (e) { errors.push(`Baris ${i + 2}: ${e.message}`); }
    }
  });
  res.json({ imported: n, errors });
}));
// Salin kelas dari semester sebelumnya
r.post('/tt/classes/copy', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const { from_period_id, to_period_id, unit_id } = req.body; unitGuard(req.user, unit_id);
  const rows = await db.q(`INSERT INTO course_classes (period_id,unit_id,course_id,class_name,student_group,lecturer_id,student_count,duration_slots,sessions_per_week,required_category_id,fixed_room_id,note)
    SELECT $2,unit_id,course_id,class_name,student_group,lecturer_id,student_count,duration_slots,sessions_per_week,required_category_id,fixed_room_id,note
    FROM course_classes WHERE period_id=$1 AND unit_id=$3 ON CONFLICT DO NOTHING RETURNING id`, [from_period_id, to_period_id, unit_id]);
  res.json({ copied: rows.length });
}));

// ---------------- Proses penjadwalan ----------------
async function scopedRooms(user, unitId, scope) {
  const p = [unitId], w = [`r.status='aktif'`];
  if (scope.mode === 'rooms') {
    p.push((scope.room_ids || []).map(Number)); w.push(`r.id = ANY($${p.length})`);
    if (!isSA(user)) w.push('o.unit_id=$1');
  } else if (scope.mode === 'campus' && isSA(user)) {
    w.push('c.schedulable');
  } else {
    w.push('o.unit_id=$1');
    if (scope.mode === 'category') { p.push((scope.category_ids || []).map(Number)); w.push(`r.category_id = ANY($${p.length})`); } else w.push('c.schedulable');
  }
  return db.q(`SELECT r.id, r.code, r.name, r.capacity, r.category_id FROM rooms r LEFT JOIN room_categories c ON c.id=r.category_id
    LEFT JOIN v_room_owner o ON o.room_id=r.id WHERE ${w.join(' AND ')} AND ($1::int IS NOT NULL) ORDER BY r.capacity`, p);
}

r.get('/tt/runs', ah(async (req, res) => {
  const p = [], w = ['TRUE'];
  if (req.query.period_id) { p.push(req.query.period_id); w.push(`t.period_id=$${p.length}`); }
  if (req.query.unit_id) { p.push(req.query.unit_id); w.push(`t.unit_id=$${p.length}`); }
  res.json(await db.q(`SELECT t.id,t.period_id,t.unit_id,t.status,t.progress,t.hard_violations,t.soft_penalty,t.created_at,t.finished_at,t.published_at,
    t.params, t.room_scope, u.name unit_name, us.name created_by_name, jsonb_array_length(COALESCE(t.result->'assignments','[]')) n_assign
    FROM timetable_runs t JOIN units u ON u.id=t.unit_id LEFT JOIN users us ON us.id=t.created_by WHERE ${w.join(' AND ')} ORDER BY t.created_at DESC LIMIT 50`, p));
}));
r.get('/tt/runs/:id', ah(async (req, res) => {
  const run = await db.one('SELECT * FROM timetable_runs WHERE id=$1', [req.params.id]);
  if (!run) fail(404, 'Proses tidak ditemukan');
  res.json(run);
}));

r.post('/tt/runs', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const { period_id, unit_id, room_scope = { mode: 'owned' }, constraints = [], params = {} } = req.body;
  unitGuard(req.user, unit_id);
  const running = await db.one(`SELECT id FROM timetable_runs WHERE unit_id=$1 AND status='running'`, [unit_id]);
  if (running) fail(409, 'Masih ada proses penjadwalan yang berjalan untuk unit ini');
  const period = await db.one('SELECT * FROM academic_periods WHERE id=$1', [period_id]);
  if (!period) fail(400, 'Periode tidak ditemukan');
  const classes = await db.q(`${CLASS_SQL} WHERE cc.period_id=$1 AND cc.unit_id=$2`, [period_id, unit_id]);
  if (!classes.length) fail(400, 'Belum ada data kelas pada periode ini');
  const rooms = await scopedRooms(req.user, unit_id, room_scope);
  if (!rooms.length) fail(400, 'Tidak ada ruangan aktif dalam cakupan yang dipilih');
  let slots = await db.q(`SELECT slot_no, to_char(start_time,'HH24:MI') start_time, to_char(end_time,'HH24:MI') end_time FROM time_slots ORDER BY slot_no`);
  if (params.slot_nos && params.slot_nos.length) slots = slots.filter(s => params.slot_nos.map(Number).includes(s.slot_no));
  const days = (params.days && params.days.length ? params.days : [1, 2, 3, 4, 5, 6]).map(Number);
  // Jadwal berulang lain (unit lain / event rutin) di ruang yang sama = slot terblokir
  const ev = await db.q(`SELECT DISTINCT e.room_id, extract(isodow FROM e.start_at)::int dow, to_char(e.start_at,'HH24:MI') st, to_char(e.end_at,'HH24:MI') et
    FROM events e WHERE e.status='confirmed' AND e.room_id = ANY($1) AND e.start_at < $3::date + 1 AND e.end_at > $2::date
      AND (e.series_id IS NOT NULL OR e.tt_run_id IS NOT NULL)
      AND (e.tt_run_id IS NULL OR e.tt_run_id NOT IN (SELECT id FROM timetable_runs WHERE period_id=$4 AND unit_id=$5))`,
  [rooms.map(x => x.id), period.start_date, period.end_date, period_id, unit_id]);
  const blocked = [];
  for (const e of ev) slots.forEach((s, i) => { if (s.start_time < e.et && s.end_time > e.st) blocked.push({ room_id: e.room_id, day: e.dow, slot_index: i }); });

  const problem = {
    days, slots, rooms, blocked, constraints,
    params: pick(params, ['population', 'generations', 'time_limit_ms', 'stagnation']),
    classes: classes.map(c => ({
      id: c.id, label: `${c.course_code} ${c.course_name} (${c.class_name})`, course_id: c.course_id, tags: c.tags || [],
      lecturer_id: c.lecturer_id, group: c.student_group, size: c.student_count, dur: c.duration_slots, sessions: c.sessions_per_week,
      category_id: c.required_category_id, fixed_room_id: c.fixed_room_id,
    })),
  };
  const run = await db.one(`INSERT INTO timetable_runs (period_id,unit_id,params,room_scope,constraints,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [period_id, unit_id, JSON.stringify({ ...params, days }), JSON.stringify(room_scope), JSON.stringify(constraints), req.user.id]);

  const w = new Worker(path.join(__dirname, '../services/ga-worker.js'), { workerData: problem });
  workers.set(run.id, w);
  let lastWrite = 0;
  w.on('message', async m => {
    try {
      if (m.type === 'progress' && Date.now() - lastWrite > 1500) {
        lastWrite = Date.now();
        await db.query(`UPDATE timetable_runs SET progress=$2, hard_violations=$3, soft_penalty=$4 WHERE id=$1 AND status='running'`, [run.id, m.progress, m.hard, m.soft]);
      } else if (m.type === 'done') {
        const res2 = m.result;
        const cmap = new Map(classes.map(c => [c.id, c])), rmap = new Map(rooms.map(x => [x.id, x]));
        res2.assignments = res2.assignments.map(a => {
          const c = cmap.get(a.class_id), rm = rmap.get(a.room_id);
          return { ...a, course_code: c.course_code, course_name: c.course_name, class_name: c.class_name, lecturer_id: c.lecturer_id,
            lecturer_name: c.lecturer_name, group: c.student_group, size: c.student_count, room_code: rm.code, room_name: rm.name, capacity: rm.capacity };
        });
        res2.slots = slots; res2.days = days; res2.rooms = rooms;
        await db.query(`UPDATE timetable_runs SET status='done', progress=100, hard_violations=$2, soft_penalty=$3, result=$4, finished_at=now(),
          log=$5 WHERE id=$1`, [run.id, res2.hard, res2.soft, JSON.stringify(res2), `${res2.generations} generasi, ${res2.ms} ms, ${res2.genes} sesi`]);
        await notifyUnit(null, unit_id, 'Penjadwalan otomatis selesai', `Pelanggaran keras: ${res2.hard}`, '#/penjadwalan');
        workers.delete(run.id);
      } else if (m.type === 'error') {
        await db.query(`UPDATE timetable_runs SET status='failed', log=$2, finished_at=now() WHERE id=$1`, [run.id, m.message]);
        workers.delete(run.id);
      }
    } catch (e) { console.error('GA message error', e); }
  });
  w.on('error', async e => { await db.query(`UPDATE timetable_runs SET status='failed', log=$2 WHERE id=$1`, [run.id, e.message]); workers.delete(run.id); });
  await audit(null, req.user, 'run', 'timetable_runs', run.id, { classes: classes.length, rooms: rooms.length });
  res.status(201).json(run);
}));

r.post('/tt/runs/:id/cancel', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const w = workers.get(Number(req.params.id));
  if (w) { await w.terminate(); workers.delete(Number(req.params.id)); }
  await db.query(`UPDATE timetable_runs SET status='cancelled', finished_at=now() WHERE id=$1 AND status='running'`, [req.params.id]);
  res.json({ ok: true });
}));

// Edit manual satu penempatan sebelum dipublikasikan
r.put('/tt/runs/:id/assignment', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const run = await db.one('SELECT * FROM timetable_runs WHERE id=$1', [req.params.id]);
  if (!run || run.status !== 'done') fail(409, 'Hanya hasil yang belum dipublikasikan yang dapat diedit');
  unitGuard(req.user, run.unit_id);
  const { index, day, slot_index, room_id } = req.body;
  const R = run.result, a = R.assignments[index];
  if (!a) fail(404, 'Penempatan tidak ditemukan');
  const dur = R.slots.findIndex(s => s.slot_no === a.slot_end) - R.slots.findIndex(s => s.slot_no === a.slot_start) + 1;
  if (slot_index + dur > R.slots.length) fail(400, 'Durasi melewati sesi terakhir');
  const rm = R.rooms.find(x => x.id === Number(room_id)) || { id: a.room_id, code: a.room_code, name: a.room_name, capacity: a.capacity };
  Object.assign(a, { day: Number(day), slot_index, slot_start: R.slots[slot_index].slot_no, slot_end: R.slots[slot_index + dur - 1].slot_no,
    start_time: R.slots[slot_index].start_time, end_time: R.slots[slot_index + dur - 1].end_time, room_id: rm.id, room_code: rm.code, room_name: rm.name, capacity: rm.capacity, manual: true });
  // hitung ulang bentrok keras secara sederhana
  const clash = (x, y) => x.day === y.day && x.slot_index < y.slot_index + (R.slots.findIndex(s => s.slot_no === y.slot_end) - y.slot_index + 1)
    && y.slot_index < x.slot_index + (R.slots.findIndex(s => s.slot_no === x.slot_end) - x.slot_index + 1);
  const conflicts = [];
  R.assignments.forEach((x, i) => R.assignments.forEach((y, j) => {
    if (j <= i || !clash(x, y)) return;
    const why = [];
    if (x.room_id === y.room_id) why.push('bentrok ruang');
    if (x.lecturer_id && x.lecturer_id === y.lecturer_id) why.push('bentrok dosen');
    if (x.group && x.group === y.group) why.push('bentrok rombel');
    if (why.length) conflicts.push({ class_id: x.class_id, label: `${x.course_code} (${x.class_name}) × ${y.course_code} (${y.class_name})`, reasons: why });
  }));
  R.conflicts = conflicts; R.hard = conflicts.length;
  await db.query('UPDATE timetable_runs SET result=$2, hard_violations=$3 WHERE id=$1', [run.id, JSON.stringify(R), R.hard]);
  res.json(R);
}));

r.post('/tt/runs/:id/publish', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const run = await db.one('SELECT * FROM timetable_runs WHERE id=$1', [req.params.id]);
  if (!run || !['done', 'published'].includes(run.status)) fail(409, 'Proses belum selesai');
  unitGuard(req.user, run.unit_id);
  if (run.hard_violations > 0 && !req.body.force) fail(409, `Masih ada ${run.hard_violations} bentrok. Perbaiki atau publikasikan paksa.`);
  const period = await db.one('SELECT * FROM academic_periods WHERE id=$1', [run.period_id]);
  const from = req.body.start_date || period.start_date, to = req.body.end_date || period.end_date;
  const skip = (req.body.skip_dates || []).filter(Boolean);
  const out = await tx(async c => {
    // ganti jadwal hasil proses sebelumnya pada periode & unit yang sama (mulai tanggal publikasi)
    const prev = await c.q(`SELECT id FROM timetable_runs WHERE period_id=$1 AND unit_id=$2 AND id<>$3 AND status='published'`, [run.period_id, run.unit_id, run.id]);
    const prevIds = prev.map(x => x.id).concat([run.id]);
    await c.query(`DELETE FROM events WHERE tt_run_id = ANY($1) AND start_at >= $2::date`, [prevIds, from]);
    await c.query(`UPDATE timetable_runs SET status='done', published_at=NULL WHERE id = ANY($1) AND id<>$2`, [prevIds, run.id]);
    let created = 0, expected = 0; const skipped = [];
    for (const a of run.result.assignments) {
      const title = `${a.course_code} ${a.course_name} (${a.class_name})`;
      const exp = await c.one(`SELECT count(*) n FROM generate_series($1::date,$2::date,'1 day'::interval) d WHERE extract(isodow FROM d)=$3 AND NOT (d::date = ANY($4::date[]))`, [from, to, a.day, skip]);
      const rows = await c.q(`INSERT INTO events (room_id,title,event_type,start_at,end_at,unit_id,lecturer_id,participants,tt_run_id,tt_class_id,series_id,created_by)
        SELECT $1,$2,'kuliah',(d::date + $3::time)::timestamptz,(d::date + $4::time)::timestamptz,$5,$6,$7,$8,$9,$15::uuid,$10
        FROM generate_series($11::date,$12::date,'1 day'::interval) d WHERE extract(isodow FROM d)=$13 AND NOT (d::date = ANY($14::date[]))
        ON CONFLICT DO NOTHING RETURNING id`,
      [a.room_id, title, a.start_time, a.end_time, run.unit_id, a.lecturer_id, a.size, run.id, a.class_id, req.user.id, from, to, a.day, skip, crypto.randomUUID()]);
      expected += exp.n; created += rows.length;
      if (rows.length < exp.n) skipped.push(`${title}: ${exp.n - rows.length} pertemuan bentrok dengan event lain`);
    }
    await c.query(`UPDATE timetable_runs SET status='published', published_at=now() WHERE id=$1`, [run.id]);
    await audit(c, req.user, 'publish', 'timetable_runs', run.id, { created, expected });
    return { created, expected, skipped };
  });
  res.json(out);
}));

r.delete('/tt/runs/:id', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const run = await db.one('SELECT * FROM timetable_runs WHERE id=$1', [req.params.id]);
  if (!run) fail(404, 'Proses tidak ditemukan'); unitGuard(req.user, run.unit_id);
  await db.query('DELETE FROM timetable_runs WHERE id=$1', [run.id]); // event ikut terhapus (cascade)
  res.json({ ok: true });
}));

module.exports = r;
