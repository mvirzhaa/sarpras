// ASET LANCAR (persediaan): pembelian, pemakaian, stock opname, log transaksi
const express = require('express');
const { db, tx } = require('../db');
const { ah, fail, audit, nextNumber } = require('../util');
const { roles, isSA, seesAll } = require('../auth');

const r = express.Router();
const PREFIX = { pembelian: 'PB-PSD', pemakaian: 'PK-PSD', opname: 'SO-PSD' };
const unitOf = (user, body) => (isSA(user) ? body.unit_id || null : user.unit_id);
async function loadItems(c, user, items) {
  const ids = [...new Set(items.map(i => Number(i.consumable_id)))];
  const rows = await c.q('SELECT * FROM consumables WHERE id = ANY($1) FOR UPDATE', [ids]);
  if (rows.length !== ids.length) fail(400, 'Ada barang yang tidak ditemukan');
  for (const x of rows) if (!isSA(user) && x.unit_id !== user.unit_id) fail(403, `Barang "${x.name}" milik unit lain`);
  return new Map(rows.map(x => [x.id, x]));
}
const DOC_SQL = `SELECT d.*, u.name unit_name, p.name person_name, r.code room_code, r.name room_name, us.name created_by_name, ba.number ba_number,
    (SELECT count(*) FROM stock_doc_items i WHERE i.doc_id=d.id) item_count FROM stock_docs d LEFT JOIN units u ON u.id=d.unit_id
    LEFT JOIN people p ON p.id=d.person_id LEFT JOIN rooms r ON r.id=d.room_id LEFT JOIN users us ON us.id=d.created_by LEFT JOIN berita_acara ba ON ba.id=d.ba_id`;

r.get('/stock-docs', ah(async (req, res) => {
  const q = req.query, p = [], w = [seesAll(req.user) ? 'TRUE' : (p.push(req.user.unit_id), `d.unit_id=$${p.length}`)];
  if (q.type) { p.push(q.type); w.push(`d.doc_type=$${p.length}`); }
  if (q.from) { p.push(q.from); w.push(`d.doc_date >= $${p.length}`); }
  if (q.to) { p.push(q.to); w.push(`d.doc_date <= $${p.length}`); }
  res.json(await db.q(`${DOC_SQL} WHERE ${w.join(' AND ')} ORDER BY d.doc_date DESC, d.id DESC LIMIT 500`, p));
}));
r.get('/stock-docs/:id', ah(async (req, res) => {
  const d = await db.one(`${DOC_SQL} WHERE d.id=$1`, [req.params.id]);
  if (!d) fail(404, 'Dokumen tidak ditemukan');
  if (!seesAll(req.user) && d.unit_id !== req.user.unit_id) fail(403, 'Dokumen milik unit lain');
  d.items = await db.q(`SELECT i.*, c.code, c.name, c.uom, c.stock current_stock FROM stock_doc_items i JOIN consumables c ON c.id=i.consumable_id WHERE i.doc_id=$1 ORDER BY c.name`, [d.id]);
  res.json(d);
}));

// Pembelian (stok masuk) & pemakaian (stok keluar) — langsung diposting
r.post('/stock-docs', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const b = req.body, type = b.doc_type;
  if (!['pembelian', 'pemakaian'].includes(type)) fail(400, 'Jenis dokumen tidak valid');
  const items = (b.items || []).filter(i => i && i.consumable_id && Number(i.qty) > 0);
  if (!items.length) fail(400, 'Isi minimal satu barang dengan jumlah > 0');
  if (type === 'pemakaian' && !b.person_id && !b.room_id) fail(400, 'Isi penerima atau ruang pemakai');
  const out = await tx(async c => {
    const map = await loadItems(c, req.user, items);
    const need = {};
    items.forEach(i => { need[i.consumable_id] = (need[i.consumable_id] || 0) + Number(i.qty); });
    if (type === 'pemakaian') for (const [id, q] of Object.entries(need)) { const x = map.get(Number(id)); if (Number(x.stock) < q) fail(409, `Stok "${x.name}" tidak cukup (tersisa ${Number(x.stock)} ${x.uom})`); }
    const date = b.doc_date || new Date().toISOString().slice(0, 10);
    const total = items.reduce((s, i) => s + Number(i.qty) * Number(type === 'pembelian' ? i.unit_price || 0 : i.unit_price || map.get(Number(i.consumable_id)).last_price || 0), 0);
    const d = await c.one(`INSERT INTO stock_docs (number,doc_type,doc_date,unit_id,status,vendor,invoice_no,funding_source,person_id,room_id,purpose,notes,total,created_by,posted_at)
      VALUES ($1,$2,$3,$4,'posted',$5,$6,$7,$8,$9,$10,$11,$12,$13,now()) RETURNING *`,
    [await nextNumber(c, PREFIX[type], date), type, date, unitOf(req.user, b) || map.get(Number(items[0].consumable_id)).unit_id, b.vendor || null, b.invoice_no || null,
      b.funding_source || null, b.person_id || null, b.room_id || null, b.purpose || null, b.notes || null, total, req.user.id]);
    for (const i of items) {
      const x = map.get(Number(i.consumable_id)), price = Number(i.unit_price) || (type === 'pemakaian' ? Number(x.last_price) : 0), qty = Number(i.qty);
      await c.query('INSERT INTO stock_doc_items (doc_id,consumable_id,qty,unit_price,note) VALUES ($1,$2,$3,$4,$5)', [d.id, x.id, qty, price, i.note || null]);
      await c.query(`INSERT INTO consumable_tx (consumable_id,tx_type,qty,unit_price,tx_date,room_id,person_id,note,doc_id,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [x.id, type === 'pembelian' ? 'masuk' : 'keluar', qty, price, date, b.room_id || null, b.person_id || null, `${d.number}${i.note ? ' — ' + i.note : ''}`, d.id, req.user.id]);
      await c.query(`UPDATE consumables SET stock = stock + $2, last_price = CASE WHEN $3 AND $4::numeric > 0 THEN $4::numeric ELSE last_price END WHERE id=$1`,
        [x.id, type === 'pembelian' ? qty : -qty, type === 'pembelian', price]);
    }
    if (b.make_ba !== false) {
      const person = b.person_id ? await c.one('SELECT name, id_number FROM people WHERE id=$1', [b.person_id]) : null;
      const room = b.room_id ? await c.one('SELECT code, name FROM rooms WHERE id=$1', [b.room_id]) : null;
      const ba = await c.one(`INSERT INTO berita_acara (number,ba_type,ba_date,title,unit_id,content,signatories,ref_type,ref_id,created_by)
        VALUES ($1,'persediaan',$2,$3,$4,$5,$6,'stock_doc',$7,$8) RETURNING id`,
      [await nextNumber(c, type === 'pembelian' ? 'BA-PNR' : 'BA-PSD', date), date,
        type === 'pembelian' ? 'Berita Acara Penerimaan Barang Persediaan' : 'Berita Acara Serah Terima Barang Persediaan', d.unit_id,
        JSON.stringify({ kind: type, doc_number: d.number, vendor: b.vendor, invoice_no: b.invoice_no, receiver: person, room, note: b.purpose || b.notes,
          items: items.map(i => { const x = map.get(Number(i.consumable_id)); return { code: x.code, name: x.name, qty: Number(i.qty), uom: x.uom, unit_price: Number(i.unit_price) || Number(x.last_price) }; }) }),
        JSON.stringify(b.signatories || []), d.id, req.user.id]);
      await c.query('UPDATE stock_docs SET ba_id=$2 WHERE id=$1', [d.id, ba.id]);
      d.ba_id = ba.id;
    }
    await audit(c, req.user, 'create', 'stock_docs', d.id, { type, items: items.length, total });
    return d;
  });
  res.status(201).json(out);
}));

// Stock opname persediaan: buat draf (snapshot stok) -> isi hitung fisik -> posting penyesuaian
r.post('/stock-opnames', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const unitId = unitOf(req.user, req.body);
  const d = await tx(async c => {
    const date = req.body.doc_date || new Date().toISOString().slice(0, 10);
    const doc = await c.one(`INSERT INTO stock_docs (number,doc_type,doc_date,unit_id,status,notes,created_by) VALUES ($1,'opname',$2,$3,'draft',$4,$5) RETURNING *`,
      [await nextNumber(c, PREFIX.opname, date), date, unitId, req.body.notes || null, req.user.id]);
    const n = await c.q(`INSERT INTO stock_doc_items (doc_id,consumable_id,system_qty,unit_price)
      SELECT $1, id, stock, last_price FROM consumables WHERE ($2::int IS NULL OR unit_id=$2) ${req.body.category ? 'AND category=$3' : ''} RETURNING id`,
    req.body.category ? [doc.id, unitId, req.body.category] : [doc.id, unitId]);
    if (!n.length) fail(400, 'Tidak ada barang persediaan untuk diopname');
    return doc;
  });
  res.status(201).json(d);
}));
r.put('/stock-docs/:id/items', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const d = await db.one('SELECT * FROM stock_docs WHERE id=$1', [req.params.id]);
  if (!d || d.status !== 'draft') fail(409, 'Hanya draf opname yang dapat diubah');
  if (!isSA(req.user) && d.unit_id !== req.user.unit_id) fail(403, 'Dokumen milik unit lain');
  await tx(async c => {
    for (const i of req.body.items || [])
      await c.query('UPDATE stock_doc_items SET counted_qty=$3, note=$4 WHERE id=$1 AND doc_id=$2', [i.id, d.id, i.counted_qty === '' || i.counted_qty === null || i.counted_qty === undefined ? null : Number(i.counted_qty), i.note || null]);
  });
  res.json({ ok: true });
}));
r.post('/stock-docs/:id/post', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const d = await db.one('SELECT * FROM stock_docs WHERE id=$1', [req.params.id]);
  if (!d || d.status !== 'draft') fail(409, 'Dokumen sudah diposting');
  if (!isSA(req.user) && d.unit_id !== req.user.unit_id) fail(403, 'Dokumen milik unit lain');
  const out = await tx(async c => {
    const items = await c.q('SELECT i.*, c.name, c.code, c.uom FROM stock_doc_items i JOIN consumables c ON c.id=i.consumable_id WHERE i.doc_id=$1 ORDER BY c.name', [d.id]);
    const unchecked = items.filter(i => i.counted_qty === null);
    if (unchecked.length && !req.body.force) fail(409, `${unchecked.length} barang belum diisi hasil hitungnya`);
    const diffs = items.filter(i => i.counted_qty !== null && Number(i.counted_qty) !== Number(i.system_qty));
    let value = 0;
    for (const i of diffs) {
      const delta = Number(i.counted_qty) - Number(i.system_qty); value += delta * Number(i.unit_price);
      await c.query('UPDATE stock_doc_items SET qty=$2 WHERE id=$1', [i.id, delta]);
      await c.query(`INSERT INTO consumable_tx (consumable_id,tx_type,qty,unit_price,tx_date,note,doc_id,created_by) VALUES ($1,'penyesuaian',$2,$3,$4,$5,$6,$7)`,
        [i.consumable_id, delta, i.unit_price, d.doc_date, `${d.number} — selisih opname${i.note ? ': ' + i.note : ''}`, d.id, req.user.id]);
      await c.query('UPDATE consumables SET stock = GREATEST(0, stock + $2) WHERE id=$1', [i.consumable_id, delta]);
    }
    const ba = await c.one(`INSERT INTO berita_acara (number,ba_type,ba_date,title,unit_id,content,signatories,ref_type,ref_id,created_by)
      VALUES ($1,'stock_opname',$2,'Berita Acara Stock Opname Barang Persediaan',$3,$4,$5,'stock_doc',$6,$7) RETURNING id`,
    [await nextNumber(c, 'BA-SOP', d.doc_date), d.doc_date, d.unit_id,
      JSON.stringify({ kind: 'opname_persediaan', doc_number: d.number, notes: req.body.notes || d.notes,
        summary: { items: items.length, checked: items.length - unchecked.length, diff_items: diffs.length, diff_value: Math.round(value) },
        rows: items.map(i => ({ code: i.code, name: i.name, uom: i.uom, system_qty: Number(i.system_qty), counted_qty: i.counted_qty === null ? null : Number(i.counted_qty),
          diff: i.counted_qty === null ? null : Number(i.counted_qty) - Number(i.system_qty), unit_price: Number(i.unit_price), note: i.note })) }),
      JSON.stringify(req.body.signatories || []), d.id, req.user.id]);
    await c.query(`UPDATE stock_docs SET status='posted', posted_at=now(), ba_id=$2, total=$3 WHERE id=$1`, [d.id, ba.id, Math.round(value)]);
    await audit(c, req.user, 'post', 'stock_docs', d.id, { diffs: diffs.length });
    return { ok: true, ba_id: ba.id, diffs: diffs.length, value };
  });
  res.json(out);
}));
r.delete('/stock-docs/:id', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const d = await db.one('SELECT * FROM stock_docs WHERE id=$1', [req.params.id]);
  if (!d || d.status !== 'draft') fail(409, 'Hanya draf yang dapat dihapus');
  if (!isSA(req.user) && d.unit_id !== req.user.unit_id) fail(403, 'Dokumen milik unit lain');
  await db.query('DELETE FROM stock_docs WHERE id=$1', [d.id]);
  res.json({ ok: true });
}));

// Log transaksi persediaan (kartu stok gabungan)
r.get('/stock-log', ah(async (req, res) => {
  const q = req.query, p = [], w = [seesAll(req.user) ? 'TRUE' : (p.push(req.user.unit_id), `c.unit_id=$${p.length}`)];
  const add = (v, s) => { p.push(v); w.push(s.replace(/\?/g, '$' + p.length)); };
  if (q.from) add(q.from, 't.tx_date >= ?'); if (q.to) add(q.to, 't.tx_date <= ?');
  if (q.type) add(q.type, 't.tx_type = ?'); if (q.consumable_id) add(q.consumable_id, 't.consumable_id = ?');
  if (q.q) add(`%${q.q}%`, '(c.name ILIKE ? OR c.code ILIKE ? OR t.note ILIKE ? OR d.number ILIKE ?)');
  const where = w.join(' AND '), limit = Math.min(Number(q.limit) || 300, 5000), offset = Number(q.offset) || 0;
  const rows = await db.q(`SELECT t.*, c.code, c.name, c.uom, d.number doc_number, d.doc_type, r.code room_code, p.name person_name, u.name created_by_name,
      CASE t.tx_type WHEN 'masuk' THEN t.qty WHEN 'keluar' THEN -t.qty ELSE t.qty END signed_qty
    FROM consumable_tx t JOIN consumables c ON c.id=t.consumable_id LEFT JOIN stock_docs d ON d.id=t.doc_id LEFT JOIN rooms r ON r.id=t.room_id
    LEFT JOIN people p ON p.id=t.person_id LEFT JOIN users u ON u.id=t.created_by WHERE ${where} ORDER BY t.tx_date DESC, t.id DESC LIMIT ${limit} OFFSET ${offset}`, p);
  const sum = await db.one(`SELECT count(*) total, COALESCE(sum(t.qty*t.unit_price) FILTER (WHERE t.tx_type='masuk'),0) in_value,
      COALESCE(sum(t.qty*t.unit_price) FILTER (WHERE t.tx_type='keluar'),0) out_value
    FROM consumable_tx t JOIN consumables c ON c.id=t.consumable_id LEFT JOIN stock_docs d ON d.id=t.doc_id WHERE ${where}`, p);
  res.json({ rows, ...sum });
}));

module.exports = r;
