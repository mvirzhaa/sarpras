const express = require('express');
const { db, tx } = require('../db');
const { ah, fail, pick, setClause, ticket, audit, notifyUnit, notifySuperadmins } = require('../util');
const { roles, roomScope, assertRoom, ownerUnit, seesAll } = require('../auth');
const { upload, saveAttachment } = require('./core');

// ================= PUBLIK (tanpa login) =================
const pub = express.Router();
const hits = new Map();
const limiter = (max, windowMs) => (req, res, next) => {
  const k = req.ip, now = Date.now(), arr = (hits.get(k) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) return res.status(429).json({ error: 'Terlalu banyak kiriman. Coba lagi beberapa menit lagi.' });
  arr.push(now); hits.set(k, arr); next();
};

pub.get('/info', ah(async (req, res) => {
  const org = await db.one(`SELECT value FROM settings WHERE key='org'`);
  res.json(org ? org.value : {});
}));
pub.get('/units', ah(async (req, res) => {
  res.json(await db.q(`SELECT u.id, u.name, u.code, count(o.room_id) rooms FROM units u JOIN v_room_owner o ON o.unit_id=u.id GROUP BY u.id ORDER BY u.name`));
}));
pub.get('/units/:id/rooms', ah(async (req, res) => {
  res.json(await db.q(`SELECT r.id, r.code, r.name, c.name category_name, b.name building_name, f.name floor_name
    FROM v_room_owner o JOIN rooms r ON r.id=o.room_id JOIN buildings b ON b.id=r.building_id JOIN floors f ON f.id=r.floor_id
    LEFT JOIN room_categories c ON c.id=r.category_id WHERE o.unit_id=$1 AND r.status<>'nonaktif'
      AND COALESCE(c.name,'') NOT ILIKE 'koridor%' ORDER BY b.name, f.level, r.code`, [req.params.id]));
}));
pub.get('/rooms/:id', ah(async (req, res) => {
  const r = await db.one(`SELECT r.id, r.code, r.name, c.name category_name, b.name building_name, f.name floor_name, o.unit_id, u.name unit_name,
      (SELECT round(avg(rating),1) FROM feedbacks WHERE room_id=r.id AND rating IS NOT NULL) rating
    FROM rooms r JOIN buildings b ON b.id=r.building_id JOIN floors f ON f.id=r.floor_id LEFT JOIN room_categories c ON c.id=r.category_id
    LEFT JOIN v_room_owner o ON o.room_id=r.id LEFT JOIN units u ON u.id=o.unit_id WHERE r.id=$1`, [req.params.id]);
  if (!r) fail(404, 'Ruangan tidak ditemukan');
  res.json(r);
}));
pub.post('/feedback', limiter(5, 10 * 60000), upload.single('photo'), ah(async (req, res) => {
  const d = pick(req.body, ['room_id', 'kind', 'rating', 'message', 'reporter_name', 'reporter_nim', 'reporter_email']);
  if (req.body.website) fail(400, 'Ditolak'); // honeypot anti-bot
  if (!d.room_id || !d.message || String(d.message).trim().length < 10) fail(400, 'Pilih ruangan dan tulis masukan minimal 10 karakter');
  if (String(d.message).length > 3000) fail(400, 'Masukan terlalu panjang (maks. 3000 karakter)');
  const unitId = await ownerUnit(d.room_id);
  const fb = await tx(async c => {
    const t = ticket();
    const row = await c.one(`INSERT INTO feedbacks (ticket,room_id,unit_id,kind,rating,message,reporter_name,reporter_nim,reporter_email,ip)
      VALUES ($1,$2,$3,COALESCE($4,'saran'),$5,$6,$7,$8,$9,$10) RETURNING id, ticket`,
    [t, d.room_id, unitId, d.kind, d.rating || null, String(d.message).trim(), d.reporter_name, d.reporter_nim, d.reporter_email, req.ip]);
    if (req.file && /^image\//.test(req.file.mimetype)) {
      const a = await saveAttachment(c, req.file, { entity_type: 'feedback', entity_id: row.id, doc_type: 'foto' }, null);
      await c.query('UPDATE feedbacks SET photo_file_id=$2 WHERE id=$1', [row.id, a.id]);
    }
    const room = await c.one('SELECT code, name FROM rooms WHERE id=$1', [d.room_id]);
    const title = `${d.kind === 'kerusakan' ? 'Laporan kerusakan' : 'Masukan baru'}: ${room.code}`;
    if (unitId) await notifyUnit(c, unitId, title, String(d.message).slice(0, 140), '#/masukan');
    else await notifySuperadmins(c, title, String(d.message).slice(0, 140), '#/masukan');
    return row;
  });
  res.status(201).json(fb);
}));
pub.get('/feedback/:ticket', ah(async (req, res) => {
  const f = await db.one(`SELECT f.ticket, f.kind, f.status, f.response, f.created_at, f.responded_at, r.code room_code, r.name room_name, u.name unit_name
    FROM feedbacks f JOIN rooms r ON r.id=f.room_id LEFT JOIN units u ON u.id=f.unit_id WHERE f.ticket=$1`, [String(req.params.ticket).toUpperCase()]);
  if (!f) fail(404, 'Nomor tiket tidak ditemukan');
  res.json(f);
}));
// Hasil scan QR aset (informasi yang aman untuk publik)
pub.get('/assets/:tag', ah(async (req, res) => {
  const a = await db.one(`SELECT a.id, a.tag, a.name, a.brand, a.model, a.condition, a.status, a.acquisition_date, ac.name code_name,
      r.code room_code, r.name room_name, b.name building_name, u.name unit_name, p.name holder_name,
      (SELECT max(created_at) FROM asset_history h WHERE h.asset_id=a.id AND h.action IN ('mutasi','registrasi')) placed_at
    FROM assets a JOIN asset_codes ac ON ac.id=a.asset_code_id LEFT JOIN rooms r ON r.id=a.room_id LEFT JOIN buildings b ON b.id=r.building_id
    LEFT JOIN units u ON u.id=a.unit_id LEFT JOIN people p ON p.id=a.holder_id WHERE a.tag=$1`, [req.params.tag]);
  if (!a) fail(404, 'Aset tidak ditemukan');
  res.json(a);
}));

// ================= INTERNAL =================
const r = express.Router();
r.get('/feedback', ah(async (req, res) => {
  const p = [], w = [roomScope(req.user, 'f.room_id', p)], q = req.query;
  const add = (v, s) => { p.push(v); w.push(s.replace(/\?/g, '$' + p.length)); };
  if (q.status) add(q.status, 'f.status=?');
  if (q.kind) add(q.kind, 'f.kind=?');
  if (q.room_id) add(q.room_id, 'f.room_id=?');
  if (q.unit_id) add(q.unit_id, 'f.unit_id=?');
  if (q.from) add(q.from, 'f.created_at>=?::date');
  if (q.to) add(q.to, 'f.created_at<?::date+1');
  res.json(await db.q(`SELECT f.*, r.code room_code, r.name room_name, b.name building_name, u.name unit_name, us.name responded_by_name
    FROM feedbacks f JOIN rooms r ON r.id=f.room_id JOIN buildings b ON b.id=r.building_id LEFT JOIN units u ON u.id=f.unit_id
    LEFT JOIN users us ON us.id=f.responded_by WHERE ${w.join(' AND ')} ORDER BY (f.status='baru') DESC, f.created_at DESC LIMIT 500`, p));
}));
r.put('/feedback/:id', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const f = await db.one('SELECT * FROM feedbacks WHERE id=$1', [req.params.id]);
  if (!f) fail(404, 'Masukan tidak ditemukan');
  await assertRoom(req.user, f.room_id);
  const d = pick(req.body, ['status', 'response']);
  const row = await db.one(`UPDATE feedbacks SET status=COALESCE($2,status), response=COALESCE($3,response), responded_by=$4, responded_at=now() WHERE id=$1 RETURNING *`,
    [f.id, d.status, d.response, req.user.id]);
  res.json(row);
}));
r.post('/feedback/:id/damage', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const f = await db.one('SELECT * FROM feedbacks WHERE id=$1', [req.params.id]);
  if (!f) fail(404, 'Masukan tidak ditemukan');
  await assertRoom(req.user, f.room_id);
  if (f.damage_id) fail(409, 'Masukan ini sudah dijadikan catatan kerusakan');
  const d = await tx(async c => {
    const dm = await c.one(`INSERT INTO room_damages (room_id,title,description,severity,feedback_id,reported_by) VALUES ($1,$2,$3,COALESCE($4,'sedang'),$5,$6) RETURNING *`,
      [f.room_id, req.body.title || `Laporan pengguna #${f.ticket}`, f.message, req.body.severity, f.id, req.user.id]);
    await c.query(`UPDATE feedbacks SET damage_id=$2, status='diproses', responded_by=$3, responded_at=now(),
      response=COALESCE(response,'Laporan diteruskan ke tim perbaikan') WHERE id=$1`, [f.id, dm.id, req.user.id]);
    return dm;
  });
  res.status(201).json(d);
}));

// ---------------- Catatan kerusakan ruangan ----------------
r.get('/damages', ah(async (req, res) => {
  const p = [], w = [roomScope(req.user, 'd.room_id', p)];
  if (req.query.room_id) { p.push(req.query.room_id); w.push(`d.room_id=$${p.length}`); }
  if (req.query.status) { p.push(req.query.status); w.push(`d.status=$${p.length}`); }
  if (req.query.open === '1') w.push(`d.status IN ('dilaporkan','diproses')`);
  res.json(await db.q(`SELECT d.*, r.code room_code, r.name room_name, b.name building_name, a.tag asset_tag, f.ticket, u.name reported_by_name, un.name unit_name
    FROM room_damages d JOIN rooms r ON r.id=d.room_id JOIN buildings b ON b.id=r.building_id LEFT JOIN assets a ON a.id=d.asset_id
    LEFT JOIN feedbacks f ON f.id=d.feedback_id LEFT JOIN users u ON u.id=d.reported_by
    LEFT JOIN v_room_owner o ON o.room_id=d.room_id LEFT JOIN units un ON un.id=o.unit_id
    WHERE ${w.join(' AND ')} ORDER BY (d.status IN ('dilaporkan','diproses')) DESC, d.reported_at DESC LIMIT 500`, p));
}));
r.post('/damages', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const d = pick(req.body, ['room_id', 'title', 'description', 'severity', 'asset_id', 'estimated_cost']);
  if (!d.room_id || !d.title) fail(400, 'Ruangan dan judul kerusakan wajib diisi');
  await assertRoom(req.user, d.room_id);
  const row = await db.one(`INSERT INTO room_damages (room_id,title,description,severity,asset_id,estimated_cost,reported_by) VALUES ($1,$2,$3,COALESCE($4,'sedang'),$5,$6,$7) RETURNING *`,
    [d.room_id, d.title, d.description, d.severity, d.asset_id, d.estimated_cost, req.user.id]);
  if (req.body.set_room_status) await db.query(`UPDATE rooms SET status='perbaikan' WHERE id=$1`, [d.room_id]);
  await audit(null, req.user, 'create', 'room_damages', row.id);
  res.status(201).json(row);
}));
r.put('/damages/:id', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const dm = await db.one('SELECT * FROM room_damages WHERE id=$1', [req.params.id]);
  if (!dm) fail(404, 'Data tidak ditemukan');
  await assertRoom(req.user, dm.room_id);
  const d = pick(req.body, ['title', 'description', 'severity', 'status', 'estimated_cost', 'actual_cost', 'resolution']);
  if (d.status === 'selesai' && dm.status !== 'selesai') d.resolved_at = new Date();
  const { sql, values } = setClause(d, 2);
  const row = await tx(async c => {
    const x = await c.one(`UPDATE room_damages SET ${sql} WHERE id=$1 RETURNING *`, [dm.id, ...values]);
    if (d.status === 'selesai') {
      if (dm.feedback_id) await c.query(`UPDATE feedbacks SET status='selesai', response=COALESCE($2,response), responded_at=now() WHERE id=$1`, [dm.feedback_id, d.resolution]);
      const open = await c.one(`SELECT count(*) n FROM room_damages WHERE room_id=$1 AND status IN ('dilaporkan','diproses')`, [dm.room_id]);
      if (!open.n) await c.query(`UPDATE rooms SET status='aktif' WHERE id=$1 AND status='perbaikan'`, [dm.room_id]);
    }
    return x;
  });
  res.json(row);
}));

module.exports = { pub, router: r };
