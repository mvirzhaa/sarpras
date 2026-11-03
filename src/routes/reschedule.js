// Jadwal per pertemuan, pindah/jadwal ulang, dan acara insidentil yang menggeser kegiatan lain.
//   POST /events/plan            rencana kegiatan baru (sekali / N pertemuan / sampai tanggal) + bentrok + ruang alternatif
//   POST /events/:id/plan-move   rencana pindah ruang/jam untuk satu pertemuan atau pertemuan ini & seterusnya
//   POST /events/apply           simpan rencana yang sudah diputuskan pengguna (satu transaksi)
// Pola: rencana -> pengguna memilih tindakan untuk tiap pertemuan bentrok -> apply.
const express = require('express');
const crypto = require('crypto');
const { db, tx } = require('../db');
const { ah, fail, pick, audit, notifyUnit } = require('../util');
const { isSA, assertRoom, canManageRoom, ownerUnit } = require('../auth');
const { findFreeRooms } = require('./schedule');

const r = express.Router();
const DAY = 86400000, MAX_SESSIONS = 52;
const pad = n => String(n).padStart(2, '0');
const ymdLocal = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const fmtD = d => { const x = new Date(d); return `${HARI[x.getDay()]} ${x.getDate()}/${x.getMonth() + 1}/${x.getFullYear()}`; };
const fmtT = d => { const x = new Date(d); return `${pad(x.getHours())}.${pad(x.getMinutes())}`; };

// Tanggal yang dilewati: "2026-12-25, 25/12/2026" -> Set('2026-12-25', ...)
function parseSkip(v) {
  const list = Array.isArray(v) ? v : String(v || '').split(/[\s,;]+/);
  const out = new Set();
  for (const raw of list) {
    const s = String(raw).trim(); if (!s) continue;
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/), y, mo, d;
    if (m) [y, mo, d] = [+m[1], +m[2], +m[3]];
    else if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) [y, mo, d] = [+m[3], +m[2], +m[1]];
    if (m) {
      const x = new Date(y, mo - 1, d);
      if (x.getFullYear() !== y || x.getMonth() !== mo - 1 || x.getDate() !== d) fail(400, `Tanggal dilewati tidak valid: "${s}"`);
      out.add(`${y}-${pad(mo)}-${pad(d)}`); continue;
    }
    fail(400, `Tanggal dilewati tidak dikenali: "${s}". Gunakan format 2026-12-25 atau 25/12/2026`);
  }
  return out;
}
// Daftar pertemuan mingguan. Tanggal libur dilewati dan tidak dihitung, sehingga jumlah pertemuan tetap.
function buildOccurrences({ start_at, end_at, sessions, repeat_until, skip_dates }) {
  const s = new Date(start_at), e = new Date(end_at), skip = parseSkip(skip_dates), out = [];
  if (!(s < e)) fail(400, 'Waktu selesai harus setelah waktu mulai');
  if (e - s > DAY) fail(400, 'Satu pertemuan maksimal 24 jam');
  const n = Number(sessions) || 0, until = repeat_until ? new Date(repeat_until + 'T23:59:59') : null;
  if (n > MAX_SESSIONS) fail(400, `Maksimal ${MAX_SESSIONS} pertemuan`);
  if (!n && !until) return [{ no: null, start_at: s, end_at: e, holiday: false }];
  let no = 0;
  for (let k = 0; k < 120; k++) {
    const a = new Date(s.getTime() + k * 7 * DAY), b = new Date(e.getTime() + k * 7 * DAY);
    if (until && a > until) break;
    if (n && no >= n) break;
    if (skip.has(ymdLocal(a))) { out.push({ no: null, start_at: a, end_at: b, holiday: true }); continue; }
    out.push({ no: ++no, start_at: a, end_at: b, holiday: false });
  }
  if (!out.some(o => !o.holiday)) fail(400, 'Tidak ada pertemuan yang terbentuk; periksa tanggal sampai atau tanggal yang dilewati');
  return out;
}
async function conflicts(c, roomId, s, e, excludeIds = []) {
  return c.q(`SELECT e.id, e.title, e.event_type, e.start_at, e.end_at, e.participants, e.series_id, e.session_no, e.unit_id, u.name unit_name
    FROM events e LEFT JOIN units u ON u.id=e.unit_id WHERE e.room_id=$1 AND e.status='confirmed' AND tstzrange(e.start_at,e.end_at) && tstzrange($2,$3)
      AND NOT (e.id = ANY($4::int[])) ORDER BY e.start_at`, [roomId, s, e, excludeIds]);
}
// Ruang kosong yang boleh dipakai pengguna, diurutkan: gedung sama, kategori sama, kapasitas terdekat
async function alternatives(user, s, e, need, near, excludeRoomIds = [], limit = 5) {
  const rows = (await findFreeRooms(user, { start_at: s.toISOString(), end_at: e.toISOString(), capacity: need || 0 }))
    .filter(x => (isSA(user) || x.mine) && !excludeRoomIds.includes(x.id));
  const meta = near ? await db.one('SELECT building_id, category_id FROM rooms WHERE id=$1', [near]) : null;
  if (meta) {
    const ids = rows.map(x => x.id);
    const info = new Map((await db.q('SELECT id, building_id, category_id FROM rooms WHERE id = ANY($1::int[])', [ids])).map(x => [x.id, x]));
    rows.sort((a, b) => {
      const A = info.get(a.id), B = info.get(b.id);
      return (B.building_id === meta.building_id) - (A.building_id === meta.building_id) || (B.category_id === meta.category_id) - (A.category_id === meta.category_id) || a.capacity - b.capacity;
    });
  }
  return rows.slice(0, limit).map(x => ({ id: x.id, code: x.code, name: x.name, capacity: x.capacity, building_name: x.building_name, category_name: x.category_name }));
}
// Lengkapi tiap pertemuan dengan status, bentrok, alternatif ruang, dan target pemindahan kegiatan yang bentrok
async function enrich(user, items, need, excludeIds) {
  const now = Date.now();
  for (const it of items) {
    if (it.holiday) { it.status = 'holiday'; continue; }
    const cf = await conflicts(db, it.room_id, it.start_at, it.end_at, excludeIds);
    it.past = it.end_at.getTime() < now;
    if (!cf.length) { it.status = 'ok'; continue; }
    it.status = 'conflict';
    it.conflicts = [];
    for (const x of cf) {
      const targets = await alternatives(user, new Date(x.start_at), new Date(x.end_at), x.participants, it.room_id, [it.room_id], 3);
      it.conflicts.push({ ...x, bump_targets: targets });
    }
    it.alternatives = await alternatives(user, it.start_at, it.end_at, need, it.room_id, [it.room_id]);
  }
  return items;
}
const summary = items => ({
  total: items.filter(i => !i.holiday).length, ok: items.filter(i => i.status === 'ok').length,
  conflict: items.filter(i => i.status === 'conflict').length, holiday: items.filter(i => i.holiday).length,
});
const roomInfo = id => db.one(`SELECT r.id, r.code, r.name, r.capacity, r.status, b.name building_name FROM rooms r JOIN buildings b ON b.id=r.building_id WHERE r.id=$1`, [id]);

// ---------- Rencana kegiatan baru ----------
r.post('/events/plan', ah(async (req, res) => {
  const d = pick(req.body, ['room_id', 'start_at', 'end_at', 'sessions', 'repeat_until', 'skip_dates', 'participants']);
  if (!d.room_id || !d.start_at || !d.end_at) fail(400, 'Ruang dan waktu wajib diisi');
  await assertRoom(req.user, d.room_id);
  const room = await roomInfo(d.room_id);
  if (room.status === 'nonaktif') fail(409, 'Ruangan sedang nonaktif');
  const items = buildOccurrences(d).map(o => ({ ...o, room_id: Number(d.room_id) }));
  await enrich(req.user, items, d.participants, []);
  res.json({ mode: 'create', room, items, summary: summary(items), capacity_warning: d.participants && room.capacity < d.participants ? `Kapasitas ${room.code} hanya ${room.capacity} orang` : null });
}));

// ---------- Rencana pindah / jadwal ulang ----------
r.post('/events/:id/plan-move', ah(async (req, res) => {
  const ev = await db.one(`SELECT * FROM events WHERE id=$1 AND status='confirmed'`, [req.params.id]);
  if (!ev) fail(404, 'Kegiatan tidak ditemukan');
  await assertRoom(req.user, ev.room_id);
  const { scope = 'one', room_id, start_at, end_at } = req.body;
  const newRoom = Number(room_id) || ev.room_id;
  if (newRoom !== ev.room_id) await assertRoom(req.user, newRoom);
  const ns = new Date(start_at || ev.start_at), ne = new Date(end_at || ev.end_at);
  if (!(ns < ne)) fail(400, 'Waktu selesai harus setelah waktu mulai');
  const delta = ns - new Date(ev.start_at), dur = ne - ns, roomChanged = newRoom !== ev.room_id;
  const group = scope === 'following' && ev.series_id
    ? await db.q(`SELECT * FROM events WHERE series_id=$1 AND status='confirmed' AND start_at>=$2 ORDER BY start_at`, [ev.series_id, ev.start_at])
    : [ev];
  const ids = group.map(x => x.id);
  const items = group.map(x => {
    const s = new Date(new Date(x.start_at).getTime() + delta);
    return { event_id: x.id, no: x.session_no, title: x.title, from_room_id: x.room_id, from_start_at: x.start_at, start_at: s, end_at: new Date(s.getTime() + dur),
      room_id: roomChanged ? newRoom : x.room_id };
  });
  if (!delta && !roomChanged && dur === new Date(ev.end_at) - new Date(ev.start_at)) fail(400, 'Tidak ada perubahan ruang maupun waktu');
  await enrich(req.user, items, ev.participants, ids);
  res.json({ mode: 'move', event: { id: ev.id, title: ev.title, series_id: ev.series_id }, room: await roomInfo(newRoom), items, summary: summary(items) });
}));

// ---------- Simpan ----------
// body: { mode:'create', base:{title,event_type,description,lecturer_id,participants}, items:[{no,start_at,end_at,room_id}], bumps:[{event_id,to_room_id}], note }
//       { mode:'move', items:[{event_id,start_at,end_at,room_id}], bumps:[...], note }
r.post('/events/apply', ah(async (req, res) => {
  const { mode, items = [], bumps = [], note } = req.body;
  if (!['create', 'move'].includes(mode)) fail(400, 'Mode tidak dikenal');
  if (!items.length) fail(400, 'Tidak ada pertemuan yang disimpan');
  if (items.length > MAX_SESSIONS + 10) fail(400, 'Terlalu banyak pertemuan');
  const base = pick(req.body.base || {}, ['title', 'event_type', 'description', 'lecturer_id', 'participants']);
  if (mode === 'create' && !base.title) fail(400, 'Nama kegiatan wajib diisi');
  const reason = String(note || '').trim().slice(0, 300);
  const notices = [];
  const out = await tx(async c => {
    for (const it of items) {
      if (!it.room_id || !it.start_at || !it.end_at || !(new Date(it.start_at) < new Date(it.end_at))) fail(400, 'Data pertemuan tidak lengkap');
      await assertRoom(req.user, it.room_id, c);
    }
    // 1) Geser kegiatan yang bentrok ke ruang lain (acara insidentil diutamakan)
    const label = mode === 'create' ? `"${base.title}"` : 'perubahan jadwal';
    for (const b of bumps) {
      const ev = await c.one(`SELECT e.*, r.code room_code FROM events e JOIN rooms r ON r.id=e.room_id WHERE e.id=$1 AND e.status='confirmed' FOR UPDATE`, [b.event_id]);
      if (!ev) fail(409, 'Kegiatan yang akan dipindah sudah berubah. Muat ulang rencana.');
      await assertRoom(req.user, ev.room_id, c); await assertRoom(req.user, b.to_room_id, c);
      const to = await c.one('SELECT code FROM rooms WHERE id=$1', [b.to_room_id]);
      const why = `Dipindah dari ${ev.room_code} ke ${to.code} karena ${label}${reason ? ' — ' + reason : ''}`;
      await updEvent(c, ev.id, { room_id: b.to_room_id, start_at: ev.start_at, end_at: ev.end_at }, ev, why);
      notices.push({ unit_id: ev.unit_id, text: `${ev.title} (${fmtD(ev.start_at)} ${fmtT(ev.start_at)}) dipindah dari ruang ${ev.room_code} ke ${to.code} karena ${label}.` });
    }
    // 2a) Kegiatan baru
    if (mode === 'create') {
      const owner = await ownerUnit(items[0].room_id, c);
      const series = items.length > 1 ? crypto.randomUUID() : null, ids = [];
      for (const it of items) {
        const row = await c.one(`INSERT INTO events (room_id,title,event_type,description,start_at,end_at,unit_id,lecturer_id,participants,series_id,session_no,created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [it.room_id, base.title, base.event_type || 'lainnya', base.description || null, it.start_at, it.end_at, req.user.unit_id || owner,
          base.lecturer_id || null, base.participants || null, series, it.no || null, req.user.id]).catch(conflictErr(c, it));
        ids.push(row.id);
      }
      await audit(c, req.user, 'create', 'events', ids[0], { n: ids.length, bumps: bumps.length });
      return { created: ids.length, moved: bumps.length, series };
    }
    // 2b) Pindah / jadwal ulang. Urutan diatur agar tidak menabrak pertemuan seri sendiri yang belum dipindah.
    const rows = [];
    for (const it of items) {
      const ev = await c.one(`SELECT * FROM events WHERE id=$1 AND status='confirmed' FOR UPDATE`, [it.event_id]);
      if (!ev) fail(409, 'Ada pertemuan yang sudah berubah atau dibatalkan. Muat ulang rencana.');
      await assertRoom(req.user, ev.room_id, c);
      rows.push({ ev, it });
    }
    const forward = rows.length > 1 && new Date(rows[0].it.start_at) > new Date(rows[0].ev.start_at);
    if (forward) rows.reverse();
    for (const { ev, it } of rows) {
      const toCode = (await c.one('SELECT code FROM rooms WHERE id=$1', [it.room_id])).code, fromCode = (await c.one('SELECT code FROM rooms WHERE id=$1', [ev.room_id])).code;
      const parts = [];
      if (Number(it.room_id) !== ev.room_id) parts.push(`dipindah dari ruang ${fromCode} ke ${toCode}`);
      if (new Date(it.start_at).getTime() !== new Date(ev.start_at).getTime()) parts.push(`dijadwal ulang dari ${fmtD(ev.start_at)} ${fmtT(ev.start_at)}`);
      const why = parts.length ? parts.join(', ').replace(/^./, ch => ch.toUpperCase()) + (reason ? ' — ' + reason : '') : null;
      await updEvent(c, ev.id, it, ev, why).catch(conflictErr(c, it));
      if (why && ev.unit_id && ev.unit_id !== req.user.unit_id) notices.push({ unit_id: ev.unit_id, text: `${ev.title} (${fmtD(ev.start_at)} ${fmtT(ev.start_at)}): ${why}.` });
    }
    await audit(c, req.user, 'reschedule', 'events', items[0].event_id, { n: items.length, bumps: bumps.length, note: reason || undefined });
    return { updated: items.length, moved: bumps.length };
  });
  // Notifikasi unit penyelenggara yang kegiatannya digeser (di luar transaksi; dikelompokkan per unit)
  const byUnit = new Map();
  for (const n of notices) if (n.unit_id && n.unit_id !== req.user.unit_id) byUnit.set(n.unit_id, [...(byUnit.get(n.unit_id) || []), n.text]);
  for (const [u, texts] of byUnit) await notifyUnit(null, u, texts.length > 1 ? `${texts.length} jadwal kegiatan Anda dipindah` : 'Jadwal kegiatan Anda dipindah', texts.slice(0, 5).join(' ') + (texts.length > 5 ? ` (+${texts.length - 5} lainnya)` : ''), '#/jadwal');
  res.json(out);
}));

async function updEvent(c, id, it, ev, why) {
  const roomChanged = Number(it.room_id) !== ev.room_id, timeChanged = new Date(it.start_at).getTime() !== new Date(ev.start_at).getTime();
  await c.query(`UPDATE events SET room_id=$2, start_at=$3, end_at=$4,
      orig_room_id = CASE WHEN $5 THEN COALESCE(orig_room_id, room_id) ELSE orig_room_id END,
      orig_start_at = CASE WHEN $6 THEN COALESCE(orig_start_at, start_at) ELSE orig_start_at END,
      change_note = COALESCE($7, change_note) WHERE id=$1`, [id, it.room_id, it.start_at, it.end_at, roomChanged, timeChanged, why]);
}
const conflictErr = (c, it) => async e => {
  if (e.code !== '23P01') throw e;
  fail(409, `Bentrok pada ${fmtD(it.start_at)} ${fmtT(it.start_at)}: ruang sudah terisi sejak rencana dibuat. Muat ulang rencana dan pilih tindakan lain.`);
};

module.exports = r;
module.exports._test = { buildOccurrences, parseSkip };
