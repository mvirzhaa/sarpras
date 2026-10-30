const express = require('express');
const crypto = require('crypto');
const { db, tx } = require('../db');
const { ah, fail, pick, setClause, audit, notifyUnit, notifyUsers, notifySuperadmins, nextNumber } = require('../util');
const { isSA, assertRoom, canManageRoom, ownerUnit } = require('../auth');

const r = express.Router();
const DAY = 86400000;

// Daftar kemunculan mingguan (start..repeat_until)
function occurrences(start, end, until) {
  const s = new Date(start), e = new Date(end), out = [];
  if (!until) return [[s, e]];
  const lim = new Date(until + 'T23:59:59');
  for (let k = 0; k < 60; k++) {
    const a = new Date(s.getTime() + k * 7 * DAY), b = new Date(e.getTime() + k * 7 * DAY);
    if (a > lim) break;
    out.push([a, b]);
  }
  return out;
}
async function conflictsFor(c, roomId, s, e) {
  return c.q(`SELECT e.id, e.title, e.start_at, e.end_at, u.name unit FROM events e LEFT JOIN units u ON u.id=e.unit_id
    WHERE e.room_id=$1 AND e.status='confirmed' AND tstzrange(e.start_at,e.end_at) && tstzrange($2,$3) ORDER BY e.start_at`, [roomId, s, e]);
}
// Sisipkan event (tunggal / berulang). Bentrok pada event berulang dilewati & dilaporkan.
async function insertEvents(c, base, occ) {
  const series = occ.length > 1 ? crypto.randomUUID() : null, created = [], skipped = [];
  for (const [s, e] of occ) {
    const row = await c.one(`INSERT INTO events (room_id,title,event_type,description,start_at,end_at,unit_id,lecturer_id,participants,series_id,booking_id,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING RETURNING id`,
    [base.room_id, base.title, base.event_type || 'lainnya', base.description, s, e, base.unit_id, base.lecturer_id || null, base.participants || null, series, base.booking_id || null, base.created_by]);
    if (row) created.push(row.id); else skipped.push(s);
  }
  if (occ.length === 1 && skipped.length) {
    const cf = await conflictsFor(c, base.room_id, occ[0][0], occ[0][1]);
    const x = cf[0];
    fail(409, x ? `Ruangan sudah terpakai: "${x.title}"${x.unit ? ' (' + x.unit + ')' : ''}` : 'Ruangan sudah terpakai pada waktu tersebut');
  }
  return { created, skipped, series };
}

// ---------------- Event ----------------
r.get('/events', ah(async (req, res) => {
  const p = [], w = [`e.status='confirmed'`], q = req.query;
  const add = (v, s) => { p.push(v); w.push(s.replace(/\?/g, '$' + p.length)); };
  if (q.room_id) add(q.room_id, 'e.room_id=?');
  if (q.from) add(q.from, 'e.end_at>?');
  if (q.to) add(q.to, 'e.start_at<?');
  if (q.unit_id) add(q.unit_id, 'o.unit_id=?');
  if (q.building_id) add(q.building_id, 'rm.building_id=?');
  if (q.organizer_unit_id) add(q.organizer_unit_id, 'e.unit_id=?');
  if (!q.from && !q.to && !q.room_id) fail(400, 'Tentukan rentang waktu');
  res.json(await db.q(`SELECT e.*, rm.code room_code, rm.name room_name, b.name building_name, u.name unit_name, pp.name lecturer_name, o.unit_id owner_unit_id
    FROM events e JOIN rooms rm ON rm.id=e.room_id JOIN buildings b ON b.id=rm.building_id LEFT JOIN units u ON u.id=e.unit_id
    LEFT JOIN people pp ON pp.id=e.lecturer_id LEFT JOIN v_room_owner o ON o.room_id=e.room_id
    WHERE ${w.join(' AND ')} ORDER BY e.start_at LIMIT 3000`, p));
}));

r.post('/events', ah(async (req, res) => {
  const d = pick(req.body, ['room_id', 'title', 'event_type', 'description', 'start_at', 'end_at', 'lecturer_id', 'participants', 'repeat_until']);
  if (!d.room_id || !d.title || !d.start_at || !d.end_at) fail(400, 'Ruang, judul, dan waktu wajib diisi');
  if (new Date(d.end_at) <= new Date(d.start_at)) fail(400, 'Waktu selesai harus setelah waktu mulai');
  await assertRoom(req.user, d.room_id);
  const rm = await db.one('SELECT status FROM rooms WHERE id=$1', [d.room_id]);
  if (rm.status === 'nonaktif') fail(409, 'Ruangan sedang nonaktif');
  const out = await tx(async c => {
    const owner = await ownerUnit(d.room_id, c);
    const result = await insertEvents(c, { ...d, unit_id: req.body.unit_id || req.user.unit_id || owner, created_by: req.user.id }, occurrences(d.start_at, d.end_at, d.repeat_until));
    await audit(c, req.user, 'create', 'events', result.created[0], { room_id: d.room_id, n: result.created.length });
    return result;
  });
  res.status(201).json(out);
}));

r.put('/events/:id', ah(async (req, res) => {
  const ev = await db.one('SELECT * FROM events WHERE id=$1', [req.params.id]);
  if (!ev) fail(404, 'Event tidak ditemukan');
  await assertRoom(req.user, ev.room_id);
  const d = pick(req.body, ['title', 'event_type', 'description', 'start_at', 'end_at', 'room_id', 'participants', 'attendance', 'lecturer_id']);
  if (d.room_id && d.room_id !== ev.room_id) await assertRoom(req.user, d.room_id);
  const { sql, values } = setClause(d, 2);
  try {
    res.json(await db.one(`UPDATE events SET ${sql} WHERE id=$1 RETURNING *`, [ev.id, ...values]));
  } catch (e) {
    if (e.code === '23P01') { const cf = await conflictsFor(db, d.room_id || ev.room_id, d.start_at || ev.start_at, d.end_at || ev.end_at); fail(409, `Bentrok dengan "${(cf.find(x => x.id !== ev.id) || {}).title || 'event lain'}"`); }
    throw e;
  }
}));

r.delete('/events/:id', ah(async (req, res) => {
  const ev = await db.one('SELECT * FROM events WHERE id=$1', [req.params.id]);
  if (!ev) fail(404, 'Event tidak ditemukan');
  await assertRoom(req.user, ev.room_id);
  const series = req.query.scope === 'series' && ev.series_id;
  const rows = series
    ? await db.q(`UPDATE events SET status='cancelled' WHERE series_id=$1 AND start_at>=$2 RETURNING id`, [ev.series_id, ev.start_at])
    : await db.q(`UPDATE events SET status='cancelled' WHERE id=$1 RETURNING id`, [ev.id]);
  await audit(null, req.user, 'cancel', 'events', ev.id, { count: rows.length });
  res.json({ ok: true, cancelled: rows.length });
}));

// ---------------- Cari ruang kosong (lintas unit) ----------------
r.get('/availability', ah(async (req, res) => {
  const { start_at, end_at, capacity, category_id, building_id, repeat_until } = req.query;
  if (!start_at || !end_at) fail(400, 'Tentukan waktu mulai dan selesai');
  const occ = occurrences(start_at, end_at, repeat_until);
  const p = [Number(capacity) || 0], w = ['c.bookable', `r.status='aktif'`, 'r.capacity >= $1'];
  if (category_id) { p.push(category_id); w.push(`r.category_id=$${p.length}`); }
  if (building_id) { p.push(building_id); w.push(`r.building_id=$${p.length}`); }
  const ranges = occ.map(([s, e]) => { p.push(s, e); return `tstzrange($${p.length - 1}::timestamptz,$${p.length}::timestamptz)`; });
  const rows = await db.q(`SELECT r.id, r.code, r.name, r.capacity, r.facilities, c.name category_name, c.color, b.name building_name, f.name floor_name,
      o.unit_id owner_unit_id, u.name owner_unit
    FROM rooms r JOIN room_categories c ON c.id=r.category_id JOIN buildings b ON b.id=r.building_id JOIN floors f ON f.id=r.floor_id
    LEFT JOIN v_room_owner o ON o.room_id=r.id LEFT JOIN units u ON u.id=o.unit_id
    WHERE ${w.join(' AND ')} AND NOT EXISTS (SELECT 1 FROM events e WHERE e.room_id=r.id AND e.status='confirmed'
      AND tstzrange(e.start_at,e.end_at) && ANY(ARRAY[${ranges.join(',')}]))
    ORDER BY (o.unit_id = ${Number(req.user.unit_id) || 0}) DESC, r.capacity, b.code, r.code LIMIT 200`, p);
  res.json(rows.map(x => ({ ...x, mine: isSA(req.user) || x.owner_unit_id === req.user.unit_id })));
}));

// ---------------- Peminjaman antar unit ----------------
r.post('/bookings', ah(async (req, res) => {
  const d = pick(req.body, ['room_id', 'title', 'purpose', 'event_type', 'participants', 'start_at', 'end_at', 'repeat_until']);
  if (!d.room_id || !d.title || !d.start_at || !d.end_at) fail(400, 'Ruang, judul, dan waktu wajib diisi');
  if (new Date(d.end_at) <= new Date(d.start_at)) fail(400, 'Waktu selesai harus setelah waktu mulai');
  if (new Date(d.start_at) < new Date(Date.now() - 3600000)) fail(400, 'Tidak dapat meminjam untuk waktu yang sudah lewat');
  const owner = await ownerUnit(d.room_id);
  if (!isSA(req.user) && owner && owner === req.user.unit_id) fail(400, 'Ruangan ini milik unit Anda — buat event langsung dari menu Jadwal');
  const first = occurrences(d.start_at, d.end_at, d.repeat_until)[0];
  const cf = await conflictsFor(db, d.room_id, first[0], first[1]);
  if (cf.length) fail(409, `Ruangan sudah terpakai: "${cf[0].title}"`);
  const b = await tx(async c => {
    const code = 'PJM-' + (await nextNumber(c, 'PJM')).split('/')[0] + '-' + new Date().getFullYear();
    const row = await c.one(`INSERT INTO booking_requests (code,room_id,owner_unit_id,requester_unit_id,requested_by,title,purpose,event_type,participants,start_at,end_at,repeat_until)
      VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'lainnya'),$9,$10,$11,$12) RETURNING *`,
    [code, d.room_id, owner, req.user.unit_id, req.user.id, d.title, d.purpose, d.event_type, d.participants, d.start_at, d.end_at, d.repeat_until]);
    const msg = `${req.user.unit_name || req.user.name} mengajukan peminjaman: ${d.title}`;
    if (owner) await notifyUnit(c, owner, 'Permintaan peminjaman ruang', msg, '#/peminjaman');
    else await notifySuperadmins(c, 'Permintaan peminjaman ruang', msg, '#/peminjaman');
    await audit(c, req.user, 'create', 'booking_requests', row.id);
    return row;
  });
  res.status(201).json(b);
}));

r.get('/bookings', ah(async (req, res) => {
  const p = [], w = ['TRUE'], u = req.user;
  if (req.query.status) { p.push(req.query.status); w.push(`b.status=$${p.length}`); }
  if (req.query.box === 'incoming' && !isSA(u)) { p.push(u.unit_id); w.push(`b.owner_unit_id=$${p.length}`); }
  if (req.query.box === 'outgoing') { p.push(u.unit_id, u.id); w.push(`(b.requester_unit_id=$${p.length - 1} OR b.requested_by=$${p.length})`); }
  if (req.query.box === 'all' && !isSA(u) && u.role !== 'pimpinan') { p.push(u.unit_id); w.push(`(b.owner_unit_id=$${p.length} OR b.requester_unit_id=$${p.length})`); }
  res.json(await db.q(`SELECT b.*, r.code room_code, r.name room_name, bl.name building_name, ou.name owner_unit, ru.name requester_unit,
      us.name requester_name, du.name decided_by_name
    FROM booking_requests b JOIN rooms r ON r.id=b.room_id JOIN buildings bl ON bl.id=r.building_id
    LEFT JOIN units ou ON ou.id=b.owner_unit_id LEFT JOIN units ru ON ru.id=b.requester_unit_id
    LEFT JOIN users us ON us.id=b.requested_by LEFT JOIN users du ON du.id=b.decided_by
    WHERE ${w.join(' AND ')} ORDER BY (b.status='pending') DESC, b.start_at DESC LIMIT 500`, p));
}));

async function decide(req, status) {
  const b = await db.one('SELECT * FROM booking_requests WHERE id=$1', [req.params.id]);
  if (!b) fail(404, 'Permintaan tidak ditemukan');
  if (b.status !== 'pending') fail(409, 'Permintaan ini sudah diproses');
  if (!(await canManageRoom(req.user, b.room_id))) fail(403, 'Hanya unit pengelola ruangan yang dapat memutuskan');
  return tx(async c => {
    let result = null;
    if (status === 'approved') {
      result = await insertEvents(c, { room_id: b.room_id, title: b.title, event_type: b.event_type, description: b.purpose,
        unit_id: b.requester_unit_id, participants: b.participants, booking_id: b.id, created_by: req.user.id },
      occurrences(b.start_at, b.end_at, b.repeat_until));
      if (!result.created.length) fail(409, 'Semua jadwal yang diminta sudah bentrok');
    }
    await c.query(`UPDATE booking_requests SET status=$2, decided_by=$3, decided_at=now(), decision_note=$4 WHERE id=$1`, [b.id, status, req.user.id, req.body.note || null]);
    const note = status === 'approved' ? `disetujui${result.skipped.length ? ` (${result.skipped.length} tanggal dilewati karena bentrok)` : ''}` : 'ditolak';
    await notifyUsers(c, [b.requested_by], `Peminjaman ${note}`, `${b.title}${req.body.note ? ' — ' + req.body.note : ''}`, '#/peminjaman');
    await audit(c, req.user, status, 'booking_requests', b.id);
    return { ok: true, ...(result || {}) };
  });
}
r.post('/bookings/:id/approve', ah(async (req, res) => res.json(await decide(req, 'approved'))));
r.post('/bookings/:id/reject', ah(async (req, res) => res.json(await decide(req, 'rejected'))));
r.post('/bookings/:id/cancel', ah(async (req, res) => {
  const b = await db.one('SELECT * FROM booking_requests WHERE id=$1', [req.params.id]);
  if (!b) fail(404, 'Permintaan tidak ditemukan');
  if (!isSA(req.user) && b.requested_by !== req.user.id && b.requester_unit_id !== req.user.unit_id) fail(403, 'Hanya pemohon yang dapat membatalkan');
  await tx(async c => {
    await c.query(`UPDATE booking_requests SET status='cancelled' WHERE id=$1`, [b.id]);
    await c.query(`UPDATE events SET status='cancelled' WHERE booking_id=$1 AND start_at>now()`, [b.id]);
    if (b.status === 'approved') await notifyUnit(c, b.owner_unit_id, 'Peminjaman dibatalkan pemohon', b.title, '#/peminjaman');
  });
  res.json({ ok: true });
}));

// ---------------- Tabulasi harian (ruang x waktu) ----------------
r.get('/schedule/grid', ah(async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const p = [], w = ['TRUE'];
  if (req.query.unit_id) { p.push(req.query.unit_id); w.push(`o.unit_id=$${p.length}`); }
  if (req.query.building_id) { p.push(req.query.building_id); w.push(`r.building_id=$${p.length}`); }
  if (req.query.category_id) { p.push(req.query.category_id); w.push(`r.category_id=$${p.length}`); }
  if (req.query.bookable !== '0') w.push('c.bookable');
  const rooms = await db.q(`SELECT r.id, r.code, r.name, r.capacity, r.status, c.name category_name, c.color, b.name building_name, b.code building_code, u.name owner_unit, o.unit_id owner_unit_id
    FROM rooms r JOIN buildings b ON b.id=r.building_id LEFT JOIN room_categories c ON c.id=r.category_id
    LEFT JOIN v_room_owner o ON o.room_id=r.id LEFT JOIN units u ON u.id=o.unit_id WHERE ${w.join(' AND ')} ORDER BY b.code, r.code`, p);
  const ids = rooms.map(x => x.id);
  const events = ids.length ? await db.q(`SELECT e.id, e.room_id, e.title, e.event_type, e.start_at, e.end_at, u.name unit_name, pp.name lecturer_name
    FROM events e LEFT JOIN units u ON u.id=e.unit_id LEFT JOIN people pp ON pp.id=e.lecturer_id
    WHERE e.status='confirmed' AND e.room_id = ANY($1) AND e.start_at < ($2::date + 1) AND e.end_at > $2::date ORDER BY e.start_at`, [ids, date]) : [];
  const slots = await db.q('SELECT * FROM time_slots ORDER BY slot_no');
  const op = await db.one(`SELECT value FROM settings WHERE key='operational'`);
  res.json({ date, rooms, events, slots, operational: op ? op.value : { start: '07:00', end: '21:00' } });
}));

module.exports = { router: r, occurrences };
