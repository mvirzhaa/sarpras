const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { db, tx } = require('../db');
const { ah, fail, pick, audit, setClause } = require('../util');
const { sign, signAs, authRequired, roles, isSA } = require('../auth');
const crud = require('../crud');

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'));
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, f, cb) => { const d = path.join(UPLOAD_DIR, new Date().toISOString().slice(0, 7)); fs.mkdirSync(d, { recursive: true }); cb(null, d); },
    filename: (req, f, cb) => cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 8) + path.extname(f.originalname).toLowerCase()),
  }),
  limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 20) * 1024 * 1024 },
  fileFilter: (req, f, cb) => cb(null, /^(image\/|application\/pdf|application\/vnd|application\/msword|text\/csv|application\/zip|image\/vnd\.dwg)/.test(f.mimetype) || /\.(dwg|dxf|vsdx)$/i.test(f.originalname)),
});

async function saveAttachment(c, file, { entity_type, entity_id, doc_type, title }, user) {
  return c.one(`INSERT INTO attachments (entity_type,entity_id,doc_type,title,file_name,file_path,mime,size,uploaded_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
  [entity_type, entity_id, doc_type || null, title || file.originalname, file.originalname, path.relative(UPLOAD_DIR, file.path), file.mimetype, file.size, user ? user.id : null]);
}

const r = express.Router();

// ---------------- Auth ----------------
r.post('/auth/login', ah(async (req, res) => {
  const { username, password } = req.body;
  const u = await db.one(`SELECT * FROM users WHERE lower(username)=lower($1)`, [username || '']);
  if (!u || !u.password_hash || !(await bcrypt.compare(password || '', u.password_hash))) fail(401, 'Username atau password salah');
  if (!u.active) fail(403, 'Akun belum diaktifkan oleh Super Admin');
  await db.query('UPDATE users SET last_login_at=now() WHERE id=$1', [u.id]);
  await audit(null, u, 'login', 'users', u.id);
  res.json({ token: sign(u) });
}));

r.use(authRequired);

r.get('/auth/me', ah(async (req, res) => {
  const unread = await db.one(`SELECT count(*) n FROM notifications WHERE user_id=$1 AND read_at IS NULL`, [req.user.id]);
  const org = await db.one(`SELECT value FROM settings WHERE key='org'`);
  res.json({ ...req.user, unread: unread.n, org: org ? org.value : {} });
}));
// ---- Super Admin: masuk sebagai admin unit ----
r.post('/auth/impersonate', roles('superadmin'), ah(async (req, res) => {
  const t = req.body.user_id
    ? await db.one('SELECT u.*, n.name unit_name FROM users u LEFT JOIN units n ON n.id=u.unit_id WHERE u.id=$1', [req.body.user_id])
    : await db.one(`SELECT u.*, n.name unit_name FROM users u JOIN units n ON n.id=u.unit_id WHERE u.unit_id=$1 AND u.role='unit_admin' ORDER BY u.is_unit_primary DESC, u.id LIMIT 1`, [req.body.unit_id]);
  if (!t) fail(404, 'Unit ini belum memiliki akun admin');
  if (t.role === 'superadmin') fail(400, 'Tidak dapat masuk sebagai Super Admin');
  await audit(null, req.user, 'impersonate', 'users', t.id, { unit_id: t.unit_id, target: t.username });
  res.json({ token: signAs(t.id, req.user.id), user: { username: t.username, name: t.name, unit_name: t.unit_name } });
}));
r.post('/auth/impersonate/stop', ah(async (req, res) => {
  if (!req.user.impersonated_by) fail(400, 'Anda tidak sedang dalam mode masuk sebagai');
  const sa = await db.one(`SELECT id FROM users WHERE id=$1 AND role='superadmin' AND active`, [req.user.impersonated_by]);
  await audit(null, sa, 'impersonate_stop', 'users', req.user.id);
  res.json({ token: sign(sa) });
}));

r.post('/auth/password', ah(async (req, res) => {
  if (req.user.impersonated_by) fail(403, 'Tidak dapat mengganti password saat masuk sebagai unit');
  const { old_password, new_password } = req.body;
  if (!new_password || new_password.length < 8) fail(400, 'Password baru minimal 8 karakter');
  const u = await db.one('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  if (!(await bcrypt.compare(old_password || '', u.password_hash || ''))) fail(400, 'Password lama salah');
  await db.query('UPDATE users SET password_hash=$2, must_change_password=false WHERE id=$1', [req.user.id, await bcrypt.hash(new_password, 10)]);
  res.json({ ok: true });
}));

// ---------------- Notifikasi ----------------
r.get('/notifications', ah(async (req, res) => {
  res.json(await db.q(`SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, [req.user.id]));
}));
r.post('/notifications/read-all', ah(async (req, res) => {
  await db.query(`UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL`, [req.user.id]);
  res.json({ ok: true });
}));

// ---------------- Pengaturan & audit ----------------
r.get('/settings', ah(async (req, res) => {
  const rows = await db.q('SELECT key,value FROM settings');
  res.json(Object.fromEntries(rows.map(x => [x.key, x.value])));
}));
r.put('/settings/:key', roles('superadmin'), ah(async (req, res) => {
  await db.query(`INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2`, [req.params.key, req.body]);
  res.json({ ok: true });
}));
r.get('/audit', roles('superadmin'), ah(async (req, res) => {
  const p = [], w = ['TRUE'];
  if (req.query.entity) { p.push(req.query.entity); w.push(`a.entity=$${p.length}`); }
  res.json(await db.q(`SELECT a.*, u.username FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE ${w.join(' AND ')}
    ORDER BY a.at DESC LIMIT ${Math.min(Number(req.query.limit) || 200, 1000)} OFFSET ${Number(req.query.offset) || 0}`, p));
}));

// ---------------- Lampiran ----------------
r.post('/files', upload.single('file'), ah(async (req, res) => {
  if (!req.file) fail(400, 'Berkas tidak diterima (format tidak didukung atau terlalu besar)');
  const { entity_type, entity_id } = req.body;
  if (!entity_type || !entity_id) fail(400, 'entity_type dan entity_id wajib');
  if (['building', 'floor'].includes(entity_type) && !isSA(req.user)) fail(403, 'Hanya Super Admin yang dapat mengunggah dokumen gedung');
  const a = await saveAttachment(db, req.file, req.body, req.user);
  if (entity_type === 'asset' && req.body.doc_type === 'foto') await db.query('UPDATE assets SET photo_file_id=$1 WHERE id=$2', [a.id, entity_id]);
  if (entity_type === 'building' && req.body.doc_type === 'foto_sampul') await db.query('UPDATE buildings SET cover_file_id=$1 WHERE id=$2', [a.id, entity_id]);
  res.status(201).json(a);
}));
r.get('/files', ah(async (req, res) => {
  res.json(await db.q(`SELECT a.*, u.name uploader FROM attachments a LEFT JOIN users u ON u.id=a.uploaded_by
    WHERE entity_type=$1 AND entity_id=$2 ORDER BY created_at DESC`, [req.query.entity_type, req.query.entity_id]));
}));
r.get('/files/:id/raw', ah(async (req, res) => {
  const a = await db.one('SELECT * FROM attachments WHERE id=$1', [req.params.id]);
  if (!a) fail(404, 'Berkas tidak ditemukan');
  res.setHeader('Content-Disposition', `${req.query.dl ? 'attachment' : 'inline'}; filename="${encodeURIComponent(a.file_name)}"`);
  res.sendFile(path.join(UPLOAD_DIR, a.file_path));
}));
r.delete('/files/:id', ah(async (req, res) => {
  const a = await db.one('SELECT * FROM attachments WHERE id=$1', [req.params.id]);
  if (!a) fail(404, 'Berkas tidak ditemukan');
  if (!isSA(req.user) && a.uploaded_by !== req.user.id) fail(403, 'Hanya pengunggah atau Super Admin yang dapat menghapus');
  await db.query('DELETE FROM attachments WHERE id=$1', [a.id]);
  fs.unlink(path.join(UPLOAD_DIR, a.file_path), () => {});
  res.json({ ok: true });
}));

// ---------------- Pengguna ----------------
r.get('/users', roles('superadmin'), ah(async (req, res) => {
  res.json({ rows: await db.q(`SELECT u.id,u.username,u.name,u.email,u.phone,u.role,u.unit_id,u.active,u.is_unit_primary,u.last_login_at,
    (u.password_hash IS NOT NULL) has_password, un.name unit_name FROM users u LEFT JOIN units un ON un.id=u.unit_id ORDER BY u.role, un.name, u.username`) });
}));
const USER_FIELDS = ['username', 'name', 'email', 'phone', 'role', 'unit_id', 'active'];
r.post('/users', roles('superadmin'), ah(async (req, res) => {
  const d = pick(req.body, USER_FIELDS);
  if (d.role === 'unit_admin' && !d.unit_id) fail(400, 'Admin unit wajib memiliki unit');
  if (!req.body.password || req.body.password.length < 8) fail(400, 'Password minimal 8 karakter');
  const u = await db.one(`INSERT INTO users (username,name,email,phone,role,unit_id,active,password_hash,must_change_password)
    VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,true),$8,true) RETURNING id,username`,
  [d.username, d.name, d.email, d.phone, d.role, d.unit_id, d.active, await bcrypt.hash(req.body.password, 10)]);
  await audit(null, req.user, 'create', 'users', u.id);
  res.status(201).json(u);
}));
r.put('/users/:id', roles('superadmin'), ah(async (req, res) => {
  const d = pick(req.body, USER_FIELDS);
  if (req.body.password) {
    if (req.body.password.length < 8) fail(400, 'Password minimal 8 karakter');
    d.password_hash = await bcrypt.hash(req.body.password, 10); d.must_change_password = true;
  }
  const { sql, values } = setClause(d, 2);
  await db.query(`UPDATE users SET ${sql} WHERE id=$1`, [req.params.id, ...values]);
  await audit(null, req.user, 'update', 'users', Number(req.params.id), { ...d, password_hash: d.password_hash ? '***' : undefined });
  res.json({ ok: true });
}));
r.delete('/users/:id', roles('superadmin'), ah(async (req, res) => {
  if (Number(req.params.id) === req.user.id) fail(400, 'Tidak dapat menghapus akun sendiri');
  await db.query('DELETE FROM users WHERE id=$1 AND NOT is_unit_primary', [req.params.id]);
  res.json({ ok: true });
}));

// ---------------- Unit pengelola ----------------
r.get('/units', ah(async (req, res) => {
  res.json({ rows: await db.q(`SELECT un.*, a.id admin_id, a.username admin_username, a.name admin_name, a.email admin_email, a.active admin_active,
      (a.password_hash IS NOT NULL) admin_ready,
      (SELECT count(*) FROM v_room_owner o WHERE o.unit_id=un.id) room_count,
      (SELECT string_agg(DISTINCT b.name, ', ') FROM unit_assignments ua JOIN buildings b ON b.id=ua.building_id WHERE ua.unit_id=un.id) buildings
    FROM units un LEFT JOIN users a ON a.unit_id=un.id AND a.is_unit_primary ORDER BY un.name`) });
}));
const UNIT_FIELDS = ['code', 'name', 'description', 'head_name', 'head_nip', 'email', 'phone'];
r.post('/units', roles('superadmin'), ah(async (req, res) => {
  const d = pick(req.body, UNIT_FIELDS);
  if (!d.code || !d.name) fail(400, 'Kode dan nama unit wajib diisi');
  const out = await tx(async c => {
    const un = await c.one(`INSERT INTO units (code,name,description,head_name,head_nip,email,phone) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [d.code.toUpperCase(), d.name, d.description, d.head_name, d.head_nip, d.email, d.phone]);
    // Akun admin unit otomatis (belum aktif sampai Super Admin mengisi password)
    const username = 'admin.' + d.code.toLowerCase().replace(/[^a-z0-9]+/g, '');
    await c.query(`INSERT INTO users (username,name,role,unit_id,is_unit_primary,active) VALUES ($1,$2,'unit_admin',$3,true,false)`,
      [username, 'Admin ' + d.name, un.id]);
    await audit(c, req.user, 'create', 'units', un.id, d);
    return { ...un, admin_username: username };
  });
  res.status(201).json(out);
}));
r.put('/units/:id', roles('superadmin'), ah(async (req, res) => {
  const { sql, values } = setClause(pick(req.body, UNIT_FIELDS), 2);
  res.json(await db.one(`UPDATE units SET ${sql} WHERE id=$1 RETURNING *`, [req.params.id, ...values]));
}));
r.delete('/units/:id', roles('superadmin'), ah(async (req, res) => {
  await db.query('DELETE FROM units WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));
r.put('/units/:id/admin', roles('superadmin'), ah(async (req, res) => {
  const d = pick(req.body, ['username', 'name', 'email', 'phone', 'active']);
  if (req.body.password) {
    if (req.body.password.length < 8) fail(400, 'Password minimal 8 karakter');
    d.password_hash = await bcrypt.hash(req.body.password, 10); d.must_change_password = true;
    if (d.active === undefined) d.active = true;
  }
  const ex = await db.one('SELECT id, password_hash FROM users WHERE unit_id=$1 AND is_unit_primary', [req.params.id]);
  if (d.active && !d.password_hash && !(ex && ex.password_hash)) fail(400, 'Isi password sebelum mengaktifkan akun');
  if (ex) {
    const { sql, values } = setClause(d, 2);
    if (sql) await db.query(`UPDATE users SET ${sql} WHERE id=$1`, [ex.id, ...values]);
  } else {
    await db.query(`INSERT INTO users (username,name,email,phone,role,unit_id,is_unit_primary,active,password_hash,must_change_password)
      VALUES ($1,$2,$3,$4,'unit_admin',$5,true,$6,$7,true)`, [d.username, d.name, d.email, d.phone, req.params.id, !!d.active, d.password_hash || null]);
  }
  await audit(null, req.user, 'update_admin', 'units', Number(req.params.id));
  res.json({ ok: true });
}));
r.get('/units/:id/assignments', ah(async (req, res) => {
  res.json(await db.q(`SELECT ua.id, ua.building_id, b.name building_name, ua.room_id, r.code room_code, r.name room_name, rb.name room_building
    FROM unit_assignments ua LEFT JOIN buildings b ON b.id=ua.building_id LEFT JOIN rooms r ON r.id=ua.room_id LEFT JOIN buildings rb ON rb.id=r.building_id
    WHERE ua.unit_id=$1 ORDER BY ua.building_id NULLS LAST, r.code`, [req.params.id]));
}));
r.put('/units/:id/assignments', roles('superadmin'), ah(async (req, res) => {
  const b = (req.body.building_ids || []).map(Number), rm = (req.body.room_ids || []).map(Number);
  await tx(async c => {
    await c.query('DELETE FROM unit_assignments WHERE unit_id=$1', [req.params.id]);
    for (const id of b) await c.query('INSERT INTO unit_assignments (unit_id,building_id) VALUES ($1,$2)', [req.params.id, id]);
    for (const id of rm) await c.query('INSERT INTO unit_assignments (unit_id,room_id) VALUES ($1,$2)', [req.params.id, id]);
    await audit(c, req.user, 'assign', 'units', Number(req.params.id), { building_ids: b, room_ids: rm });
  });
  res.json({ ok: true });
}));

// ---------------- Master data ----------------
r.use('/room-categories', crud({ table: 'room_categories', fields: ['name', 'color', 'bookable', 'schedulable', 'description', 'sort'], search: ['t.name'], order: 't.sort, t.name' }));
// Buat ulang seluruh sesi kuliah dari jumlah sesi, jam mulai, durasi, jeda & istirahat
r.post('/time-slots/generate', roles('superadmin'), ah(async (req, res) => {
  const n = Number(req.body.count), dur = Number(req.body.minutes), gap = Number(req.body.gap) || 0;
  const [h, m] = String(req.body.start || '').split(':').map(Number);
  if (!(n >= 1 && n <= 30)) fail(400, 'Jumlah sesi 1–30');
  if (!(dur >= 10 && dur <= 240)) fail(400, 'Durasi per sesi 10–240 menit');
  if (Number.isNaN(h) || Number.isNaN(m)) fail(400, 'Jam mulai tidak valid');
  if (gap < 0 || gap > 120) fail(400, 'Jeda antarsesi 0–120 menit');
  const brk = new Map();
  for (const b of req.body.breaks || []) { const a = Number(b.after), mi = Number(b.minutes); if (a >= 1 && a < n && mi > 0) brk.set(a, (brk.get(a) || 0) + mi); }
  const hm = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  let t = h * 60 + m; const slots = [];
  for (let i = 1; i <= n; i++) {
    const e = t + dur; if (e > 24 * 60) fail(400, `Sesi ${i} melewati pukul 24.00`);
    slots.push({ slot_no: i, start_time: hm(t), end_time: hm(e) });
    t = e + gap + (brk.get(i) || 0);
  }
  await tx(async c => {
    await c.query('DELETE FROM time_slots');
    for (const x of slots) await c.query('INSERT INTO time_slots (slot_no,start_time,end_time) VALUES ($1,$2,$3)', [x.slot_no, x.start_time, x.end_time]);
    await audit(c, req.user, 'generate', 'time_slots', null, req.body);
  });
  res.json({ slots });
}));
r.use('/time-slots', crud({ table: 'time_slots', fields: ['slot_no', 'start_time', 'end_time'], order: 't.slot_no' }));
r.use('/periods', crud({
  table: 'academic_periods', fields: ['name', 'start_date', 'end_date', 'is_active'], order: 't.start_date DESC',
  beforeSave: async (d, req, id) => { if (d.is_active === true || d.is_active === 'true') await db.query('UPDATE academic_periods SET is_active=false WHERE id<>COALESCE($1,0)', [id]); return d; },
}));
r.use('/people', crud({
  table: 'people', fields: ['id_number', 'name', 'kind', 'unit_id', 'position', 'email', 'phone', 'active'],
  select: 'SELECT t.*, u.name unit_name FROM people t LEFT JOIN units u ON u.id=t.unit_id',
  search: ['t.name', 't.id_number'], filters: { kind: 't.kind', unit_id: 't.unit_id' }, order: 't.name', write: ['superadmin', 'unit_admin'],
}));
r.use('/courses', crud({
  table: 'courses', fields: ['code', 'name', 'credits', 'semester_level', 'unit_id', 'tags', 'preferred_category_id'],
  select: 'SELECT t.*, u.name unit_name, c.name category_name FROM courses t LEFT JOIN units u ON u.id=t.unit_id LEFT JOIN room_categories c ON c.id=t.preferred_category_id',
  search: ['t.name', 't.code'], filters: { unit_id: 't.unit_id' }, order: 't.code', write: ['superadmin', 'unit_admin'],
  beforeSave: async d => { if (typeof d.tags === 'string') d.tags = d.tags.split(',').map(s => s.trim().toLowerCase()).filter(Boolean); return d; },
}));

module.exports = { router: r, upload, saveAttachment, UPLOAD_DIR };
