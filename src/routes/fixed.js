// ASET TETAP: pengadaan (pembelian/perolehan), pemakaian (pinjam pakai), log transaksi
const express = require('express');
const { db, tx } = require('../db');
const { ah, fail, audit, nextNumber } = require('../util');
const { roles, isSA, seesAll, canManageRoom, ownerUnit } = require('../auth');
const { history, canManageAsset, assetScope } = require('./assets');

const r = express.Router();
const COND = ['baru', 'baik', 'rusak', 'diperbaiki', 'rusak_parah'];

// ---------------- Pengadaan / pembelian aset tetap ----------------
r.get('/acquisitions', ah(async (req, res) => {
  const p = [], w = [seesAll(req.user) ? 'TRUE' : (p.push(req.user.unit_id), `q.unit_id=$${p.length}`)];
  if (req.query.from) { p.push(req.query.from); w.push(`q.acq_date >= $${p.length}`); }
  if (req.query.to) { p.push(req.query.to); w.push(`q.acq_date <= $${p.length}`); }
  if (req.query.q) { p.push(`%${req.query.q}%`); w.push(`(q.number ILIKE $${p.length} OR q.vendor ILIKE $${p.length} OR q.document_no ILIKE $${p.length})`); }
  res.json(await db.q(`SELECT q.*, u.name unit_name, us.name created_by_name, ba.number ba_number,
      (SELECT count(*) FROM assets a WHERE a.acquisition_id=q.id) asset_count,
      (SELECT count(*) FROM attachments f WHERE f.entity_type='acquisition' AND f.entity_id=q.id) file_count
    FROM asset_acquisitions q LEFT JOIN units u ON u.id=q.unit_id LEFT JOIN users us ON us.id=q.created_by LEFT JOIN berita_acara ba ON ba.id=q.ba_id
    WHERE ${w.join(' AND ')} ORDER BY q.acq_date DESC, q.id DESC LIMIT 500`, p));
}));
r.get('/acquisitions/:id', ah(async (req, res) => {
  const q = await db.one(`SELECT q.*, u.name unit_name, ba.number ba_number FROM asset_acquisitions q LEFT JOIN units u ON u.id=q.unit_id LEFT JOIN berita_acara ba ON ba.id=q.ba_id WHERE q.id=$1`, [req.params.id]);
  if (!q) fail(404, 'Dokumen pengadaan tidak ditemukan');
  if (!seesAll(req.user) && q.unit_id !== req.user.unit_id) fail(403, 'Dokumen milik unit lain');
  q.assets = await db.q(`SELECT a.id, a.tag, a.name, a.brand, a.model, a.price, a.condition, a.status, r.code room_code, p.name holder_name
    FROM assets a LEFT JOIN rooms r ON r.id=a.room_id LEFT JOIN people p ON p.id=a.holder_id WHERE a.acquisition_id=$1 ORDER BY a.tag`, [q.id]);
  res.json(q);
}));
r.post('/acquisitions', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const b = req.body, items = (b.items || []).filter(i => i && i.asset_code_id && i.name);
  if (!items.length) fail(400, 'Isi minimal satu baris barang (kode barang dan nama)');
  for (const [k, i] of items.entries()) {
    if (!(Number(i.quantity) >= 1 && Number(i.quantity) <= 500)) fail(400, `Baris ${k + 1}: jumlah 1–500`);
    if (!i.room_id && !i.holder_id) fail(400, `Baris ${k + 1}: tentukan ruang atau pemegang`);
    if (i.room_id && !(await canManageRoom(req.user, i.room_id))) fail(403, `Baris ${k + 1}: ruang di luar pengelolaan unit Anda`);
    if (i.condition && !COND.includes(i.condition)) fail(400, `Baris ${k + 1}: kondisi tidak valid`);
  }
  const unitId = isSA(req.user) ? b.unit_id || null : req.user.unit_id;
  const out = await tx(async c => {
    const number = await nextNumber(c, 'PGD', b.acq_date || new Date());
    const total = items.reduce((s, i) => s + Number(i.quantity) * Number(i.price || 0), 0);
    const acq = await c.one(`INSERT INTO asset_acquisitions (number,acq_date,method,vendor,document_no,funding_source,unit_id,total,notes,created_by)
      VALUES ($1,COALESCE($2,current_date),COALESCE($3,'pembelian'),$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [number, b.acq_date, b.method, b.vendor, b.document_no, b.funding_source, unitId, total, b.notes, req.user.id]);
    const created = [];
    for (const i of items) {
      const code = await c.one('SELECT * FROM asset_codes WHERE id=$1 FOR UPDATE', [i.asset_code_id]);
      if (!code || code.level !== 5) fail(400, `Kode barang untuk "${i.name}" harus level Sub-sub Kelompok`);
      let nup = (await c.one('SELECT COALESCE(max(nup),0) m FROM assets WHERE asset_code_id=$1', [code.id])).m;
      const owner = (i.room_id && await ownerUnit(i.room_id, c)) || unitId;
      for (let k = 0; k < Number(i.quantity); k++) {
        nup++;
        const a = await c.one(`INSERT INTO assets (asset_code_id,nup,tag,name,brand,model,serial_number,specification,acquisition_date,acquisition_method,funding_source,vendor,document_no,
            price,useful_life_years,condition,room_id,holder_id,unit_id,acquisition_id,created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,COALESCE($16,'baru'),$17,$18,$19,$20,$21) RETURNING id, tag`,
        [code.id, nup, `${code.code}.${String(nup).padStart(5, '0')}`, i.name, i.brand || null, i.model || null, Number(i.quantity) === 1 ? i.serial_number || null : null,
          i.specification || null, acq.acq_date, acq.method, acq.funding_source, acq.vendor, acq.document_no, Number(i.price) || 0, i.useful_life_years || null,
          i.condition, i.room_id || null, i.holder_id || null, owner, acq.id, req.user.id]);
        await history(c, a.id, 'registrasi', { to_room_id: i.room_id || null, to_holder_id: i.holder_id || null, to_condition: i.condition || 'baru', note: `Pengadaan ${number}`, ref_type: 'acquisition', ref_id: acq.id }, req.user);
        created.push({ ...a, name: i.name, price: Number(i.price) || 0 });
      }
    }
    if (b.make_ba !== false) {
      const ba = await c.one(`INSERT INTO berita_acara (number,ba_type,ba_date,title,unit_id,content,signatories,ref_type,ref_id,created_by)
        VALUES ($1,'serah_terima',$2,'Berita Acara Penerimaan Barang (Aset Tetap)',$3,$4,$5,'acquisition',$6,$7) RETURNING id`,
      [await nextNumber(c, 'BA-PNR', acq.acq_date), acq.acq_date, unitId,
        JSON.stringify({ kind: 'penerimaan_aset', acquisition_number: number, vendor: b.vendor, document_no: b.document_no, method: acq.method, funding_source: b.funding_source,
          items: created.map(x => ({ tag: x.tag, name: x.name, price: x.price })), total }), JSON.stringify(b.signatories || []), acq.id, req.user.id]);
      await c.query('UPDATE asset_acquisitions SET ba_id=$2 WHERE id=$1', [acq.id, ba.id]);
      acq.ba_id = ba.id;
    }
    await audit(c, req.user, 'create', 'asset_acquisitions', acq.id, { items: created.length, total });
    return { ...acq, assets: created.length };
  });
  res.status(201).json(out);
}));

// ---------------- Pemakaian / pinjam pakai aset tetap ----------------
const LOAN_SQL = `SELECT l.*, p.name borrower_name, p.id_number borrower_number, bu.name borrower_unit, u.name unit_name, ba.number ba_number,
    (l.status='dipinjam' AND l.due_date < current_date) overdue,
    (SELECT json_agg(json_build_object('id',a.id,'tag',a.tag,'name',a.name,'condition_out',i.condition_out,'condition_in',i.condition_in,'room_code',r.code) ORDER BY a.tag)
       FROM asset_loan_items i JOIN assets a ON a.id=i.asset_id LEFT JOIN rooms r ON r.id=a.room_id WHERE i.loan_id=l.id) items
  FROM asset_loans l LEFT JOIN people p ON p.id=l.borrower_id LEFT JOIN units bu ON bu.id=l.borrower_unit_id LEFT JOIN units u ON u.id=l.unit_id
  LEFT JOIN berita_acara ba ON ba.id=l.ba_id`;
r.get('/loans', ah(async (req, res) => {
  const p = [], w = [seesAll(req.user) ? 'TRUE' : (p.push(req.user.unit_id), `l.unit_id=$${p.length}`)];
  if (req.query.status === 'aktif') w.push(`l.status='dipinjam'`);
  if (req.query.status === 'terlambat') w.push(`l.status='dipinjam' AND l.due_date < current_date`);
  if (req.query.status === 'selesai') w.push(`l.status='dikembalikan'`);
  res.json(await db.q(`${LOAN_SQL} WHERE ${w.join(' AND ')} ORDER BY (l.status='dipinjam') DESC, l.start_date DESC LIMIT 500`, p));
}));
r.post('/loans', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const b = req.body, ids = (b.asset_ids || []).map(Number);
  if (!ids.length) fail(400, 'Pilih minimal satu aset');
  if (!b.borrower_id) fail(400, 'Pilih pegawai/dosen pemakai');
  if (b.due_date && b.start_date && b.due_date < b.start_date) fail(400, 'Tanggal kembali harus setelah tanggal mulai');
  const assets = await db.q(`SELECT * FROM assets WHERE id = ANY($1) AND status='aktif'`, [ids]);
  if (assets.length !== ids.length) fail(400, 'Sebagian aset tidak ditemukan atau sudah dihapuskan');
  for (const a of assets) if (!(await canManageAsset(req.user, a))) fail(403, `Aset ${a.tag} di luar lingkup unit Anda`);
  const busy = await db.q(`SELECT a.tag FROM asset_loan_items i JOIN asset_loans l ON l.id=i.loan_id JOIN assets a ON a.id=i.asset_id WHERE l.status='dipinjam' AND i.asset_id = ANY($1)`, [ids]);
  if (busy.length) fail(409, `Aset sedang dipakai/dipinjam: ${busy.map(x => x.tag).join(', ')}`);
  const out = await tx(async c => {
    const number = await nextNumber(c, 'PKA', b.start_date || new Date());
    const person = await c.one('SELECT name, id_number, unit_id FROM people WHERE id=$1', [b.borrower_id]);
    const unitId = assets[0].unit_id || req.user.unit_id;
    const l = await c.one(`INSERT INTO asset_loans (number,borrower_id,borrower_unit_id,unit_id,purpose,location,start_date,due_date,notes,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,current_date),$8,$9,$10) RETURNING *`,
    [number, b.borrower_id, b.borrower_unit_id || (person && person.unit_id), unitId, b.purpose, b.location, b.start_date, b.due_date || null, b.notes, req.user.id]);
    for (const a of assets) {
      await c.query('INSERT INTO asset_loan_items (loan_id,asset_id,condition_out) VALUES ($1,$2,$3)', [l.id, a.id, a.condition]);
      await history(c, a.id, 'dipakai', { to_holder_id: b.borrower_id, note: `Pemakaian ${number}${b.due_date ? ' s.d. ' + b.due_date : ''}: ${b.purpose || ''}`, ref_type: 'loan', ref_id: l.id }, req.user);
    }
    const ba = await c.one(`INSERT INTO berita_acara (number,ba_type,ba_date,title,unit_id,content,signatories,ref_type,ref_id,created_by)
      VALUES ($1,'serah_terima',$2,'Berita Acara Serah Terima Pemakaian Barang',$3,$4,$5,'loan',$6,$7) RETURNING id`,
    [await nextNumber(c, 'BA-PKA', l.start_date), l.start_date, unitId,
      JSON.stringify({ kind: 'pemakaian_aset', loan_number: number, receiver: person, purpose: b.purpose, location: b.location, start_date: l.start_date, due_date: l.due_date,
        items: assets.map(a => ({ tag: a.tag, name: a.name, condition: a.condition, price: a.price })) }),
      JSON.stringify(b.signatories || [{ role: 'Yang menyerahkan', name: req.user.name || '' }, { role: 'Pemakai', name: person ? person.name : '', nip: person ? person.id_number : '' }]), l.id, req.user.id]);
    await c.query('UPDATE asset_loans SET ba_id=$2 WHERE id=$1', [l.id, ba.id]);
    await audit(c, req.user, 'create', 'asset_loans', l.id, { n: assets.length });
    return { ...l, ba_id: ba.id };
  });
  res.status(201).json(out);
}));
r.post('/loans/:id/return', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const l = await db.one('SELECT * FROM asset_loans WHERE id=$1', [req.params.id]);
  if (!l) fail(404, 'Data pemakaian tidak ditemukan');
  if (l.status !== 'dipinjam') fail(409, 'Barang sudah dikembalikan');
  if (!isSA(req.user) && l.unit_id !== req.user.unit_id) fail(403, 'Data milik unit lain');
  const conds = Object.fromEntries((req.body.items || []).map(i => [Number(i.asset_id), i.condition_in]));
  const out = await tx(async c => {
    const items = await c.q('SELECT i.*, a.tag, a.name, a.condition FROM asset_loan_items i JOIN assets a ON a.id=i.asset_id WHERE i.loan_id=$1', [l.id]);
    for (const i of items) {
      const ci = COND.includes(conds[i.asset_id]) ? conds[i.asset_id] : i.condition;
      await c.query('UPDATE asset_loan_items SET condition_in=$3 WHERE loan_id=$1 AND asset_id=$2', [l.id, i.asset_id, ci]);
      if (ci !== i.condition) await c.query('UPDATE assets SET condition=$2, updated_at=now() WHERE id=$1', [i.asset_id, ci]);
      await history(c, i.asset_id, 'dikembalikan', { from_holder_id: l.borrower_id, from_condition: i.condition, to_condition: ci, note: `Pengembalian ${l.number}${req.body.notes ? ': ' + req.body.notes : ''}`, ref_type: 'loan', ref_id: l.id }, req.user);
    }
    const date = req.body.returned_date || new Date().toISOString().slice(0, 10);
    const ba = await c.one(`INSERT INTO berita_acara (number,ba_type,ba_date,title,unit_id,content,ref_type,ref_id,created_by)
      VALUES ($1,'serah_terima',$2,'Berita Acara Pengembalian Barang',$3,$4,'loan',$5,$6) RETURNING id`,
    [await nextNumber(c, 'BA-KMB', date), date, l.unit_id,
      JSON.stringify({ kind: 'pengembalian_aset', loan_number: l.number, notes: req.body.notes, items: items.map(i => ({ tag: i.tag, name: i.name, condition_out: i.condition_out, condition_in: COND.includes(conds[i.asset_id]) ? conds[i.asset_id] : i.condition })) }), l.id, req.user.id]);
    await c.query(`UPDATE asset_loans SET status='dikembalikan', returned_date=$2, return_notes=$3, return_ba_id=$4 WHERE id=$1`, [l.id, date, req.body.notes || null, ba.id]);
    await audit(c, req.user, 'return', 'asset_loans', l.id);
    return { ok: true, ba_id: ba.id };
  });
  res.json(out);
}));

// ---------------- Log transaksi aset tetap ----------------
r.get('/asset-log', ah(async (req, res) => {
  const q = req.query, p = [], w = [assetScope(req.user, p)];
  const add = (v, s) => { p.push(v); w.push(s.replace(/\?/g, '$' + p.length)); };
  if (q.from) add(q.from, 'h.created_at >= ?::date');
  if (q.to) add(q.to, 'h.created_at < ?::date + 1');
  if (q.action) add(q.action, 'h.action = ?');
  if (q.q) add(`%${q.q}%`, '(a.tag ILIKE ? OR a.name ILIKE ? OR h.note ILIKE ?)');
  if (q.room_id) add(q.room_id, '(h.from_room_id = ? OR h.to_room_id = ?)');
  const limit = Math.min(Number(q.limit) || 300, 5000), offset = Number(q.offset) || 0;
  const where = w.join(' AND ');
  const rows = await db.q(`SELECT h.id, h.created_at, h.action, h.note, h.ref_type, h.ref_id, a.id asset_id, a.tag, a.name, fr.code from_room, tr.code to_room,
      fh.name from_holder, th.name to_holder, h.from_condition, h.to_condition, u.name user_name
    FROM asset_history h JOIN assets a ON a.id=h.asset_id LEFT JOIN rooms fr ON fr.id=h.from_room_id LEFT JOIN rooms tr ON tr.id=h.to_room_id
    LEFT JOIN people fh ON fh.id=h.from_holder_id LEFT JOIN people th ON th.id=h.to_holder_id LEFT JOIN users u ON u.id=h.user_id
    WHERE ${where} ORDER BY h.created_at DESC, h.id DESC LIMIT ${limit} OFFSET ${offset}`, p);
  const total = (await db.one(`SELECT count(*) n FROM asset_history h JOIN assets a ON a.id=h.asset_id WHERE ${where}`, p)).n;
  res.json({ rows, total });
}));

module.exports = r;
