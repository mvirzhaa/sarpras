const express = require('express');
const { db, tx } = require('../db');
const { ah, fail, pick, setClause, audit, nextNumber } = require('../util');
const { roles, isSA, seesAll, canManageRoom } = require('../auth');
const { history } = require('./assets');

const r = express.Router();
const unitScope = (user, col, p) => (seesAll(user) ? 'TRUE' : (p.push(user.unit_id), `${col}=$${p.length}`));

// ---------------- Stock opname ----------------
r.get('/opnames', ah(async (req, res) => {
  const p = [];
  res.json(await db.q(`SELECT o.*, u.name unit_name, ba.number ba_number,
      (SELECT count(*) FROM stock_opname_items i WHERE i.opname_id=o.id) total,
      (SELECT count(*) FROM stock_opname_items i WHERE i.opname_id=o.id AND i.found IS NOT NULL) checked,
      (SELECT count(*) FROM stock_opname_items i WHERE i.opname_id=o.id AND i.found=false) missing
    FROM stock_opnames o LEFT JOIN units u ON u.id=o.unit_id LEFT JOIN berita_acara ba ON ba.id=o.ba_id
    WHERE ${unitScope(req.user, 'o.unit_id', p)} ORDER BY o.created_at DESC LIMIT 200`, p));
}));
r.post('/opnames', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const { title, opname_date, room_ids = [] } = req.body;
  const unit_id = isSA(req.user) ? req.body.unit_id || null : req.user.unit_id;
  if (!room_ids.length) fail(400, 'Pilih ruangan yang akan diopname');
  for (const id of room_ids) if (!(await canManageRoom(req.user, id))) fail(403, 'Ada ruangan di luar lingkup unit Anda');
  const o = await tx(async c => {
    const row = await c.one(`INSERT INTO stock_opnames (title,unit_id,opname_date,room_ids,created_by) VALUES ($1,$2,COALESCE($3,current_date),$4,$5) RETURNING *`,
      [title || 'Stock Opname', unit_id, opname_date, room_ids.map(Number), req.user.id]);
    await c.query(`INSERT INTO stock_opname_items (opname_id,asset_id,expected_room_id)
      SELECT $1, id, room_id FROM assets WHERE status='aktif' AND room_id = ANY($2)`, [row.id, room_ids.map(Number)]);
    return row;
  });
  res.status(201).json(o);
}));
r.get('/opnames/:id', ah(async (req, res) => {
  const o = await db.one(`SELECT o.*, u.name unit_name FROM stock_opnames o LEFT JOIN units u ON u.id=o.unit_id WHERE o.id=$1`, [req.params.id]);
  if (!o) fail(404, 'Opname tidak ditemukan');
  o.items = await db.q(`SELECT i.*, a.tag, a.name, a.condition current_condition, a.price, er.code expected_room, fr.code found_room, u.name checked_by_name
    FROM stock_opname_items i JOIN assets a ON a.id=i.asset_id LEFT JOIN rooms er ON er.id=i.expected_room_id LEFT JOIN rooms fr ON fr.id=i.found_room_id
    LEFT JOIN users u ON u.id=i.checked_by WHERE i.opname_id=$1 ORDER BY er.code, a.tag`, [o.id]);
  o.rooms = await db.q('SELECT id, code, name FROM rooms WHERE id = ANY($1) ORDER BY code', [o.room_ids]);
  res.json(o);
}));
r.post('/opnames/:id/check', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const o = await db.one('SELECT * FROM stock_opnames WHERE id=$1', [req.params.id]);
  if (!o || o.status !== 'berjalan') fail(409, 'Opname sudah ditutup');
  let assetId = req.body.asset_id;
  if (!assetId && req.body.tag) {
    const raw = String(req.body.tag), m = raw.match(/[?&]t=([^&]+)/);
    const a = await db.one(`SELECT id FROM assets WHERE tag=$1 AND status='aktif'`, [m ? decodeURIComponent(m[1]) : raw.trim()]);
    if (!a) fail(404, 'Kode aset tidak dikenali');
    assetId = a.id;
  }
  const d = pick(req.body, ['found', 'condition_found', 'found_room_id', 'note']);
  if (d.found === undefined) d.found = true;
  const item = await db.one(`INSERT INTO stock_opname_items (opname_id,asset_id,expected_room_id,found,condition_found,found_room_id,note,checked_by,checked_at)
    VALUES ($1,$2,(SELECT room_id FROM assets WHERE id=$2),$3,$4,$5,$6,$7,now())
    ON CONFLICT (opname_id,asset_id) DO UPDATE SET found=$3, condition_found=COALESCE($4,stock_opname_items.condition_found),
      found_room_id=COALESCE($5,stock_opname_items.found_room_id), note=COALESCE($6,stock_opname_items.note), checked_by=$7, checked_at=now()
    RETURNING *, (xmax = 0) inserted`, [o.id, assetId, d.found, d.condition_found, d.found_room_id, d.note, req.user.id]);
  const a = await db.one('SELECT tag, name FROM assets WHERE id=$1', [assetId]);
  res.json({ ...item, ...a, extra: item.inserted });
}));
r.post('/opnames/:id/close', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const o = await db.one('SELECT * FROM stock_opnames WHERE id=$1', [req.params.id]);
  if (!o || o.status !== 'berjalan') fail(409, 'Opname sudah ditutup');
  const items = await db.q(`SELECT i.*, a.tag, a.name, a.price, a.condition cur, a.room_id cur_room, er.code expected_room, fr.code found_room
    FROM stock_opname_items i JOIN assets a ON a.id=i.asset_id LEFT JOIN rooms er ON er.id=i.expected_room_id LEFT JOIN rooms fr ON fr.id=i.found_room_id WHERE i.opname_id=$1`, [o.id]);
  const sum = {
    total: items.length,
    found: items.filter(i => i.found).length,
    missing: items.filter(i => i.found === false),
    unchecked: items.filter(i => i.found === null).length,
    misplaced: items.filter(i => i.found && i.found_room_id && i.found_room_id !== i.expected_room_id),
    condition_changed: items.filter(i => i.found && i.condition_found && i.condition_found !== i.cur),
    value_total: items.reduce((s, i) => s + Number(i.price || 0), 0),
  };
  const out = await tx(async c => {
    if (req.body.apply_changes) {
      for (const i of sum.condition_changed) {
        await c.query('UPDATE assets SET condition=$2, updated_at=now() WHERE id=$1', [i.asset_id, i.condition_found]);
        await history(c, i.asset_id, 'opname', { from_condition: i.cur, to_condition: i.condition_found, note: `Hasil opname: ${o.title}`, ref_type: 'opname', ref_id: o.id }, req.user);
      }
      for (const i of sum.misplaced) {
        await c.query('UPDATE assets SET room_id=$2, updated_at=now() WHERE id=$1', [i.asset_id, i.found_room_id]);
        await history(c, i.asset_id, 'opname', { from_room_id: i.cur_room, to_room_id: i.found_room_id, note: `Ditemukan di ruang lain saat opname: ${o.title}`, ref_type: 'opname', ref_id: o.id }, req.user);
      }
    }
    for (const i of items.filter(x => x.found)) await history(c, i.asset_id, 'opname', { note: `Terverifikasi ada (${o.title})`, ref_type: 'opname', ref_id: o.id }, req.user);
    const pickItem = i => ({ tag: i.tag, name: i.name, expected_room: i.expected_room, found_room: i.found_room, condition_before: i.cur, condition_found: i.condition_found, note: i.note });
    const ba = await c.one(`INSERT INTO berita_acara (number,ba_type,ba_date,title,unit_id,content,signatories,ref_type,ref_id,created_by)
      VALUES ($1,'stock_opname',$2,$3,$4,$5,$6,'opname',$7,$8) RETURNING id, number`,
    [await nextNumber(c, 'BA-SO', o.opname_date), o.opname_date, `Berita Acara Stock Opname — ${o.title}`, o.unit_id,
      JSON.stringify({ summary: { total: sum.total, found: sum.found, missing: sum.missing.length, unchecked: sum.unchecked, misplaced: sum.misplaced.length, condition_changed: sum.condition_changed.length, value_total: sum.value_total },
        missing: sum.missing.map(pickItem), misplaced: sum.misplaced.map(pickItem), condition_changed: sum.condition_changed.map(pickItem), applied: !!req.body.apply_changes, notes: req.body.notes }),
      JSON.stringify(req.body.signatories || []), o.id, req.user.id]);
    await c.query(`UPDATE stock_opnames SET status='selesai', closed_at=now(), ba_id=$2 WHERE id=$1`, [o.id, ba.id]);
    await audit(c, req.user, 'close', 'stock_opnames', o.id);
    return ba;
  });
  res.json(out);
}));

// ---------------- Persediaan / barang habis pakai ----------------
r.get('/consumables', ah(async (req, res) => {
  const p = [], w = [unitScope(req.user, 'c.unit_id', p)];
  if (req.query.low === '1') w.push('c.stock <= c.min_stock');
  if (req.query.q) { p.push(`%${req.query.q}%`); w.push(`(c.name ILIKE $${p.length} OR c.code ILIKE $${p.length})`); }
  res.json(await db.q(`SELECT c.*, u.name unit_name, ac.code asset_code FROM consumables c LEFT JOIN units u ON u.id=c.unit_id
    LEFT JOIN asset_codes ac ON ac.id=c.asset_code_id WHERE ${w.join(' AND ')} ORDER BY c.name`, p));
}));
const CF = ['code', 'name', 'uom', 'asset_code_id', 'min_stock'];
r.post('/consumables', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const d = pick(req.body, CF); d.unit_id = isSA(req.user) ? req.body.unit_id || null : req.user.unit_id;
  res.status(201).json(await db.one(`INSERT INTO consumables (code,name,uom,asset_code_id,min_stock,unit_id) VALUES ($1,$2,COALESCE($3,'pcs'),$4,COALESCE($5,0),$6) RETURNING *`,
    [d.code, d.name, d.uom, d.asset_code_id, d.min_stock, d.unit_id]));
}));
async function guardConsumable(user, id) {
  const c = await db.one('SELECT * FROM consumables WHERE id=$1', [id]);
  if (!c) fail(404, 'Barang tidak ditemukan');
  if (!isSA(user) && c.unit_id !== user.unit_id) fail(403, 'Barang milik unit lain');
  return c;
}
r.put('/consumables/:id', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  await guardConsumable(req.user, req.params.id);
  const { sql, values } = setClause(pick(req.body, CF), 2);
  res.json(await db.one(`UPDATE consumables SET ${sql} WHERE id=$1 RETURNING *`, [req.params.id, ...values]));
}));
r.delete('/consumables/:id', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  await guardConsumable(req.user, req.params.id);
  await db.query('DELETE FROM consumables WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));
r.get('/consumables/:id/tx', ah(async (req, res) => {
  await guardConsumable(req.user, req.params.id);
  res.json(await db.q(`SELECT t.*, r.code room_code, p.name person_name, u.name created_by_name, ba.number ba_number FROM consumable_tx t
    LEFT JOIN rooms r ON r.id=t.room_id LEFT JOIN people p ON p.id=t.person_id LEFT JOIN users u ON u.id=t.created_by LEFT JOIN berita_acara ba ON ba.id=t.ba_id
    WHERE t.consumable_id=$1 ORDER BY t.tx_date DESC, t.id DESC LIMIT 500`, [req.params.id]));
}));
r.post('/consumables/:id/tx', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const item = await guardConsumable(req.user, req.params.id);
  const d = pick(req.body, ['tx_type', 'qty', 'unit_price', 'tx_date', 'room_id', 'person_id', 'note']);
  const qty = Number(d.qty);
  if (!['masuk', 'keluar', 'penyesuaian'].includes(d.tx_type) || !qty) fail(400, 'Jenis transaksi dan jumlah wajib diisi');
  const delta = d.tx_type === 'masuk' ? Math.abs(qty) : d.tx_type === 'keluar' ? -Math.abs(qty) : qty;
  if (Number(item.stock) + delta < 0) fail(409, `Stok tidak cukup (tersisa ${item.stock} ${item.uom})`);
  const out = await tx(async c => {
    let baId = null;
    if (req.body.make_ba && d.tx_type === 'keluar') {
      const person = d.person_id ? await c.one('SELECT name, id_number FROM people WHERE id=$1', [d.person_id]) : null;
      const room = d.room_id ? await c.one('SELECT code, name FROM rooms WHERE id=$1', [d.room_id]) : null;
      baId = (await c.one(`INSERT INTO berita_acara (number,ba_type,ba_date,title,unit_id,content,ref_type,ref_id,created_by)
        VALUES ($1,'persediaan',COALESCE($2,current_date),'Berita Acara Serah Terima Barang Persediaan',$3,$4,'consumable',$5,$6) RETURNING id`,
      [await nextNumber(c, 'BA-PSD', d.tx_date || new Date()), d.tx_date, item.unit_id,
        JSON.stringify({ items: [{ name: item.name, code: item.code, qty: Math.abs(qty), uom: item.uom, unit_price: Number(d.unit_price || item.last_price) }], receiver: person, room, note: d.note }),
        item.id, req.user.id])).id;
    }
    const t = await c.one(`INSERT INTO consumable_tx (consumable_id,tx_type,qty,unit_price,tx_date,room_id,person_id,note,ba_id,created_by)
      VALUES ($1,$2,$3,COALESCE($4,0),COALESCE($5,current_date),$6,$7,$8,$9,$10) RETURNING *`,
    [item.id, d.tx_type, Math.abs(qty), d.unit_price || item.last_price, d.tx_date, d.room_id, d.person_id, d.note, baId, req.user.id]);
    await c.query(`UPDATE consumables SET stock=stock+$2, last_price=CASE WHEN $3::numeric > 0 AND $4='masuk' THEN $3::numeric ELSE last_price END WHERE id=$1`,
      [item.id, delta, Number(d.unit_price) || 0, d.tx_type]);
    return { ...t, ba_id: baId };
  });
  res.status(201).json(out);
}));

// ---------------- Berita acara ----------------
r.get('/ba', ah(async (req, res) => {
  const p = [], w = [unitScope(req.user, 'b.unit_id', p)];
  if (req.query.type) { p.push(req.query.type); w.push(`b.ba_type=$${p.length}`); }
  if (req.query.from) { p.push(req.query.from); w.push(`b.ba_date>=$${p.length}`); }
  if (req.query.to) { p.push(req.query.to); w.push(`b.ba_date<=$${p.length}`); }
  res.json(await db.q(`SELECT b.id,b.number,b.ba_type,b.ba_date,b.title,b.status,b.unit_id,u.name unit_name,us.name created_by_name,
      (SELECT count(*) FROM attachments f WHERE f.entity_type='ba' AND f.entity_id=b.id) file_count
    FROM berita_acara b LEFT JOIN units u ON u.id=b.unit_id LEFT JOIN users us ON us.id=b.created_by
    WHERE ${w.join(' AND ')} ORDER BY b.ba_date DESC, b.id DESC LIMIT 500`, p));
}));
r.get('/ba/:id', ah(async (req, res) => {
  const b = await db.one(`SELECT b.*, u.name unit_name, u.head_name, u.head_nip FROM berita_acara b LEFT JOIN units u ON u.id=b.unit_id WHERE b.id=$1`, [req.params.id]);
  if (!b) fail(404, 'Berita acara tidak ditemukan');
  if (!seesAll(req.user) && b.unit_id && b.unit_id !== req.user.unit_id && b.created_by !== req.user.id) fail(403, 'Berita acara milik unit lain');
  const org = await db.one(`SELECT value FROM settings WHERE key='org'`);
  b.org = org ? org.value : {};
  if (b.ref_type === 'mutation') b.files = await db.q(`SELECT id,title,file_name FROM attachments WHERE entity_type='mutation' AND entity_id=$1`, [b.ref_id]);
  res.json(b);
}));
r.post('/ba', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const d = pick(req.body, ['ba_type', 'ba_date', 'title', 'content', 'signatories']);
  if (!d.title) fail(400, 'Judul wajib diisi');
  const prefix = { serah_terima: 'BA-ST', perbaikan: 'BA-PRB', lainnya: 'BA' }[d.ba_type] || 'BA';
  const b = await tx(async c => c.one(`INSERT INTO berita_acara (number,ba_type,ba_date,title,unit_id,content,signatories,created_by)
    VALUES ($1,$2,COALESCE($3,current_date),$4,$5,$6,$7,$8) RETURNING *`,
  [await nextNumber(c, prefix, d.ba_date || new Date()), d.ba_type || 'lainnya', d.ba_date, d.title, isSA(req.user) ? req.body.unit_id || null : req.user.unit_id,
    JSON.stringify(d.content || {}), JSON.stringify(d.signatories || []), req.user.id]));
  res.status(201).json(b);
}));
r.put('/ba/:id', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const b = await db.one('SELECT * FROM berita_acara WHERE id=$1', [req.params.id]);
  if (!b) fail(404, 'Berita acara tidak ditemukan');
  if (b.status === 'final' && !isSA(req.user)) fail(409, 'Berita acara sudah final');
  if (!isSA(req.user) && b.unit_id !== req.user.unit_id && b.created_by !== req.user.id) fail(403, 'Berita acara milik unit lain');
  const d = pick(req.body, ['title', 'ba_date', 'status']);
  if (req.body.signatories) d.signatories = JSON.stringify(req.body.signatories);
  if (req.body.notes !== undefined) d.content = JSON.stringify({ ...b.content, notes: req.body.notes });
  const { sql, values } = setClause(d, 2);
  res.json(await db.one(`UPDATE berita_acara SET ${sql} WHERE id=$1 RETURNING *`, [b.id, ...values]));
}));

module.exports = r;
