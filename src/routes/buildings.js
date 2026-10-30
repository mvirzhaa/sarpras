const express = require('express');
const QRCode = require('qrcode');
const { db, tx } = require('../db');
const { ah, fail, pick, setClause, insertSql, audit } = require('../util');
const { roles, isSA, assertRoom, canManageRoom } = require('../auth');

const r = express.Router();
const BFIELDS = ['code', 'name', 'address', 'latitude', 'longitude', 'year_built', 'floors_count', 'building_area', 'land_area',
  'ownership', 'certificate_no', 'permit_no', 'slf_no', 'condition', 'acquisition_value', 'description'];

// ---------------- Gedung ----------------
r.get('/buildings', ah(async (req, res) => {
  res.json({ rows: await db.q(`SELECT b.*,
      (SELECT count(*) FROM floors f WHERE f.building_id=b.id) floor_total,
      (SELECT count(*) FROM rooms r WHERE r.building_id=b.id) room_total,
      (SELECT COALESCE(sum(capacity),0) FROM rooms r WHERE r.building_id=b.id) capacity_total,
      (SELECT string_agg(DISTINCT u.name, ', ') FROM rooms r JOIN v_room_owner o ON o.room_id=r.id JOIN units u ON u.id=o.unit_id WHERE r.building_id=b.id) units
    FROM buildings b ORDER BY b.code`) });
}));
r.get('/buildings/:id', ah(async (req, res) => {
  const b = await db.one('SELECT * FROM buildings WHERE id=$1', [req.params.id]);
  if (!b) fail(404, 'Gedung tidak ditemukan');
  b.floors = await db.q(`SELECT f.*, (SELECT count(*) FROM rooms r WHERE r.floor_id=f.id) room_total,
      (SELECT COALESCE(sum(area),0) FROM rooms r WHERE r.floor_id=f.id) area_total FROM floors f WHERE building_id=$1 ORDER BY level`, [b.id]);
  b.assignments = await db.q(`SELECT u.id unit_id, u.name unit_name, ua.room_id FROM unit_assignments ua JOIN units u ON u.id=ua.unit_id
      LEFT JOIN rooms r ON r.id=ua.room_id WHERE ua.building_id=$1 OR r.building_id=$1`, [b.id]);
  b.stats = await db.one(`SELECT count(*) assets, COALESCE(sum(a.price),0) value FROM assets a JOIN rooms r ON r.id=a.room_id
      WHERE r.building_id=$1 AND a.status='aktif'`, [b.id]);
  res.json(b);
}));
r.post('/buildings', roles('superadmin'), ah(async (req, res) => {
  const { sql, values } = insertSql('buildings', pick(req.body, BFIELDS));
  const b = await db.one(sql, values);
  // lantai otomatis sesuai jumlah lantai
  for (let i = 1; i <= Math.min(Number(b.floors_count) || 1, 60); i++)
    await db.query(`INSERT INTO floors (building_id,level,name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [b.id, i, `Lantai ${i}`]);
  await audit(null, req.user, 'create', 'buildings', b.id);
  res.status(201).json(b);
}));
r.put('/buildings/:id', roles('superadmin'), ah(async (req, res) => {
  const { sql, values } = setClause({ ...pick(req.body, BFIELDS), updated_at: new Date() }, 2);
  const b = await db.one(`UPDATE buildings SET ${sql} WHERE id=$1 RETURNING *`, [req.params.id, ...values]);
  await audit(null, req.user, 'update', 'buildings', b.id);
  res.json(b);
}));
r.delete('/buildings/:id', roles('superadmin'), ah(async (req, res) => {
  const a = await db.one(`SELECT count(*) n FROM assets a JOIN rooms r ON r.id=a.room_id WHERE r.building_id=$1 AND a.status='aktif'`, [req.params.id]);
  if (a.n > 0) fail(409, `Gedung masih memiliki ${a.n} aset aktif. Pindahkan aset terlebih dahulu.`);
  await db.query('DELETE FROM buildings WHERE id=$1', [req.params.id]);
  await audit(null, req.user, 'delete', 'buildings', Number(req.params.id));
  res.json({ ok: true });
}));

// ---------------- Lantai & denah ----------------
r.post('/buildings/:id/floors', roles('superadmin'), ah(async (req, res) => {
  const d = pick(req.body, ['level', 'name', 'width', 'height', 'grid']);
  res.status(201).json(await db.one(`INSERT INTO floors (building_id,level,name,width,height,grid) VALUES ($1,$2,$3,COALESCE($4,60),COALESCE($5,30),COALESCE($6,0.5)) RETURNING *`,
    [req.params.id, d.level, d.name || `Lantai ${d.level}`, d.width, d.height, d.grid]));
}));
r.get('/floors/:id', ah(async (req, res) => {
  const f = await db.one(`SELECT f.*, b.name building_name, b.code building_code FROM floors f JOIN buildings b ON b.id=f.building_id WHERE f.id=$1`, [req.params.id]);
  if (!f) fail(404, 'Lantai tidak ditemukan');
  f.rooms = await db.q(`SELECT r.*, c.name category_name, c.color, c.bookable, o.unit_id owner_unit_id, u.name owner_unit
      FROM rooms r LEFT JOIN room_categories c ON c.id=r.category_id LEFT JOIN v_room_owner o ON o.room_id=r.id LEFT JOIN units u ON u.id=o.unit_id
      WHERE r.floor_id=$1 ORDER BY r.code`, [f.id]);
  f.siblings = await db.q('SELECT id, level, name FROM floors WHERE building_id=$1 ORDER BY level', [f.building_id]);
  res.json(f);
}));
r.put('/floors/:id', roles('superadmin'), ah(async (req, res) => {
  const { sql, values } = setClause(pick(req.body, ['level', 'name', 'width', 'height', 'grid', 'background_file_id', 'background_opacity']), 2);
  res.json(await db.one(`UPDATE floors SET ${sql} WHERE id=$1 RETURNING *`, [req.params.id, ...values]));
}));
r.delete('/floors/:id', roles('superadmin'), ah(async (req, res) => {
  const a = await db.one(`SELECT count(*) n FROM assets a JOIN rooms r ON r.id=a.room_id WHERE r.floor_id=$1 AND a.status='aktif'`, [req.params.id]);
  if (a.n > 0) fail(409, `Lantai masih memiliki ${a.n} aset aktif`);
  await db.query('DELETE FROM floors WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// Simpan seluruh denah (ruang baru, ubah, hapus) dalam satu transaksi
r.put('/floors/:id/layout', roles('superadmin'), ah(async (req, res) => {
  const f = await db.one('SELECT * FROM floors WHERE id=$1', [req.params.id]);
  if (!f) fail(404, 'Lantai tidak ditemukan');
  const { rooms = [], deleted = [], annotations, width, height, grid, background_file_id, background_opacity } = req.body;
  const idMap = {};
  await tx(async c => {
    const fu = pick({ annotations: annotations && JSON.stringify(annotations), width, height, grid, background_file_id, background_opacity },
      ['annotations', 'width', 'height', 'grid', 'background_file_id', 'background_opacity']);
    if (Object.keys(fu).length) { const s = setClause(fu, 2); await c.query(`UPDATE floors SET ${s.sql} WHERE id=$1`, [f.id, ...s.values]); }
    for (const id of deleted) {
      const n = await c.one(`SELECT count(*) n FROM assets WHERE room_id=$1 AND status='aktif'`, [id]);
      if (n.n > 0) fail(409, `Ruang yang dihapus masih memiliki ${n.n} aset aktif. Pindahkan asetnya dulu.`);
      await c.query('DELETE FROM rooms WHERE id=$1 AND floor_id=$2', [id, f.id]);
    }
    for (const rm of rooms) {
      if (!rm.code || !rm.name) fail(400, 'Setiap ruang wajib punya kode dan nama');
      const d = pick(rm, ['code', 'name', 'category_id', 'capacity', 'area', 'status', 'facilities', 'description']);
      d.shape = JSON.stringify(rm.shape || {});
      if (typeof rm.id === 'number') {
        const s = setClause({ ...d, updated_at: new Date() }, 3);
        await c.query(`UPDATE rooms SET ${s.sql} WHERE id=$1 AND floor_id=$2`, [rm.id, f.id, ...s.values]);
      } else {
        const ins = insertSql('rooms', { ...d, building_id: f.building_id, floor_id: f.id });
        idMap[rm.id] = (await c.one(ins.sql, ins.values)).id;
      }
    }
    await audit(c, req.user, 'layout', 'floors', f.id, { rooms: rooms.length, deleted: deleted.length });
  });
  res.json({ ok: true, idMap });
}));

// Salin denah dari lantai lain (gedung bertingkat tipikal)
r.post('/floors/:id/copy-from', roles('superadmin'), ah(async (req, res) => {
  const dst = await db.one('SELECT * FROM floors WHERE id=$1', [req.params.id]);
  const src = await db.one('SELECT * FROM floors WHERE id=$1', [req.body.source_floor_id]);
  if (!dst || !src) fail(404, 'Lantai tidak ditemukan');
  const rooms = await db.q('SELECT * FROM rooms WHERE floor_id=$1', [src.id]);
  let n = 0;
  await tx(async c => {
    await c.query('UPDATE floors SET width=$2,height=$3,grid=$4,annotations=$5 WHERE id=$1', [dst.id, src.width, src.height, src.grid, JSON.stringify(src.annotations)]);
    for (const rm of rooms) {
      let code = rm.code.replace(new RegExp(`(\\D|^)${src.level}(\\d{2})(?!\\d)`), `$1${dst.level}$2`);
      if (code === rm.code) code = `${rm.code}-L${dst.level}`;
      const ex = await c.one('SELECT 1 FROM rooms WHERE building_id=$1 AND code=$2', [dst.building_id, code]);
      if (ex) continue;
      await c.query(`INSERT INTO rooms (building_id,floor_id,code,name,category_id,capacity,area,shape,facilities)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [dst.building_id, dst.id, code, rm.name.replace(rm.code, code), rm.category_id, rm.capacity, rm.area, rm.shape, rm.facilities]);
      n++;
    }
  });
  res.json({ ok: true, copied: n });
}));

// Peta keterisian lantai pada waktu tertentu
r.get('/floors/:id/occupancy', ah(async (req, res) => {
  const at = req.query.at ? new Date(req.query.at) : new Date();
  const rows = await db.q(`SELECT r.id room_id,
      (SELECT json_build_object('id',e.id,'title',e.title,'type',e.event_type,'start_at',e.start_at,'end_at',e.end_at,'unit',u.name)
         FROM events e LEFT JOIN units u ON u.id=e.unit_id WHERE e.room_id=r.id AND e.status='confirmed' AND e.start_at<=$2 AND e.end_at>$2 LIMIT 1) current,
      (SELECT json_build_object('title',e.title,'start_at',e.start_at,'end_at',e.end_at)
         FROM events e WHERE e.room_id=r.id AND e.status='confirmed' AND e.start_at>$2 AND e.start_at < date_trunc('day',$2::timestamptz)+interval '1 day'
         ORDER BY e.start_at LIMIT 1) next,
      (SELECT count(*) FROM events e WHERE e.room_id=r.id AND e.status='confirmed' AND e.start_at >= date_trunc('day',$2::timestamptz)
         AND e.start_at < date_trunc('day',$2::timestamptz)+interval '1 day') today_count,
      (SELECT count(*) FROM room_damages d WHERE d.room_id=r.id AND d.status IN ('dilaporkan','diproses')) open_damages
    FROM rooms r WHERE r.floor_id=$1`, [req.params.id, at]);
  res.json({ at, rooms: rows });
}));

// ---------------- Ruangan ----------------
r.get('/rooms', ah(async (req, res) => {
  const p = [], w = ['TRUE'], q = req.query;
  const add = (v, sql) => { p.push(v); w.push(sql.replace(/\?/g, '$' + p.length)); };
  if (q.building_id) add(q.building_id, 'r.building_id=?');
  if (q.floor_id) add(q.floor_id, 'r.floor_id=?');
  if (q.category_id) add(q.category_id, 'r.category_id=?');
  if (q.unit_id) add(q.unit_id, 'o.unit_id=?');
  if (q.q) add(`%${q.q}%`, '(r.code ILIKE ? OR r.name ILIKE ?)');
  if (q.mine === '1' && !isSA(req.user)) add(req.user.unit_id, 'o.unit_id=?');
  if (q.bookable === '1') w.push('c.bookable');
  if (q.schedulable === '1') w.push('c.schedulable');
  res.json({ rows: await db.q(`SELECT r.id, r.code, r.name, r.capacity, r.area, r.status, r.category_id, r.floor_id, r.building_id, r.facilities,
      c.name category_name, c.color, c.bookable, c.schedulable, b.name building_name, b.code building_code, f.level floor_level, f.name floor_name,
      o.unit_id owner_unit_id, u.name owner_unit
    FROM rooms r JOIN buildings b ON b.id=r.building_id JOIN floors f ON f.id=r.floor_id LEFT JOIN room_categories c ON c.id=r.category_id
    LEFT JOIN v_room_owner o ON o.room_id=r.id LEFT JOIN units u ON u.id=o.unit_id
    WHERE ${w.join(' AND ')} ORDER BY b.code, f.level, r.code`, p) });
}));
r.get('/rooms/:id', ah(async (req, res) => {
  const rm = await db.one(`SELECT r.*, c.name category_name, c.color, b.name building_name, f.name floor_name, f.level floor_level, o.unit_id owner_unit_id, u.name owner_unit
    FROM rooms r JOIN buildings b ON b.id=r.building_id JOIN floors f ON f.id=r.floor_id LEFT JOIN room_categories c ON c.id=r.category_id
    LEFT JOIN v_room_owner o ON o.room_id=r.id LEFT JOIN units u ON u.id=o.unit_id WHERE r.id=$1`, [req.params.id]);
  if (!rm) fail(404, 'Ruangan tidak ditemukan');
  rm.can_manage = await canManageRoom(req.user, rm.id);
  rm.assets = await db.one(`SELECT count(*) total, COALESCE(sum(price),0) value,
      count(*) FILTER (WHERE condition IN ('rusak','rusak_parah')) broken FROM assets WHERE room_id=$1 AND status='aktif'`, [rm.id]);
  rm.feedback = await db.one(`SELECT count(*) total, round(avg(rating),1) rating, count(*) FILTER (WHERE status IN ('baru','diproses')) open FROM feedbacks WHERE room_id=$1`, [rm.id]);
  rm.damages = await db.q(`SELECT * FROM room_damages WHERE room_id=$1 ORDER BY reported_at DESC LIMIT 20`, [rm.id]);
  res.json(rm);
}));
r.put('/rooms/:id', ah(async (req, res) => {
  await assertRoom(req.user, req.params.id);
  const fields = isSA(req.user) ? ['code', 'name', 'category_id', 'capacity', 'area', 'status', 'facilities', 'description'] : ['capacity', 'status', 'facilities', 'description'];
  const { sql, values } = setClause({ ...pick(req.body, fields), updated_at: new Date() }, 2);
  const rm = await db.one(`UPDATE rooms SET ${sql} WHERE id=$1 RETURNING *`, [req.params.id, ...values]);
  await audit(null, req.user, 'update', 'rooms', rm.id);
  res.json(rm);
}));
// QR pintu ruangan -> halaman masukan publik
r.get('/rooms/:id/qr.svg', ah(async (req, res) => {
  const base = process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/+$/, '') : `${req.get('x-forwarded-proto') || req.protocol}://${req.get('x-forwarded-host') || req.get('host')}${(process.env.BASE_PATH || '').replace(/\/+$/, '')}`;
  res.type('image/svg+xml').send(await QRCode.toString(`${base}/portal.html?room=${req.params.id}`, { type: 'svg', margin: 1 }));
}));

module.exports = r;
