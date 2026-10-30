const express = require('express');
const QRCode = require('qrcode');
const { db, tx } = require('../db');
const { ah, fail, pick, setClause, audit, nextNumber } = require('../util');
const { roles, isSA, seesAll, canManageRoom, ownerUnit } = require('../auth');

const r = express.Router();
const LEVELS = ['', 'Golongan', 'Bidang', 'Kelompok', 'Sub Kelompok', 'Sub-sub Kelompok'];
// Nilai buku & akumulasi penyusutan dihitung fungsi SQL asset_dep() (lihat db/schema.sql)
const BOOK = `(SELECT book_value FROM asset_dep(a.id))`;
const ACC = `(SELECT accumulated FROM asset_dep(a.id))`;
const publicBase = req => {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const host = req.get('x-forwarded-host') || req.get('host');
  const base = (process.env.BASE_PATH || '').replace(/\/+$/, '');
  return `${proto}://${host}${base}`;
};

function assetScope(user, p) {
  if (seesAll(user)) return 'TRUE';
  p.push(user.unit_id);
  return `(a.room_id IN (SELECT room_id FROM v_room_owner WHERE unit_id=$${p.length}) OR (a.room_id IS NULL AND a.unit_id=$${p.length}))`;
}
async function canManageAsset(user, a, c = db) {
  if (isSA(user)) return true;
  if (user.role !== 'unit_admin') return false;
  if (a.room_id) return canManageRoom(user, a.room_id, c);
  return a.unit_id === user.unit_id;
}
async function history(c, assetId, action, extra, user) {
  const e = { from_room_id: null, to_room_id: null, from_holder_id: null, to_holder_id: null, from_condition: null, to_condition: null, note: null, ref_type: null, ref_id: null, ...extra };
  await c.query(`INSERT INTO asset_history (asset_id,action,from_room_id,to_room_id,from_holder_id,to_holder_id,from_condition,to_condition,note,ref_type,ref_id,user_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
  [assetId, action, e.from_room_id, e.to_room_id, e.from_holder_id, e.to_holder_id, e.from_condition, e.to_condition, e.note, e.ref_type, e.ref_id, user ? user.id : null]);
}

// ---------------- Kodefikasi BMN ----------------
r.get('/asset-codes', ah(async (req, res) => {
  if (req.query.q) {
    return res.json(await db.q(`SELECT c.*, (SELECT count(*) FROM asset_codes k WHERE k.parent_id=c.id) child_count
      FROM asset_codes c WHERE (c.code ILIKE $1 OR c.name ILIKE $2) ${req.query.level ? 'AND c.level=' + Number(req.query.level) : ''}
      ORDER BY c.code LIMIT 100`, [req.query.q + '%', '%' + req.query.q + '%']));
  }
  const p = req.query.parent_id ? [req.query.parent_id] : [];
  res.json(await db.q(`SELECT c.*, (SELECT count(*) FROM asset_codes k WHERE k.parent_id=c.id) child_count,
      (SELECT count(*) FROM assets a JOIN asset_codes x ON x.id=a.asset_code_id WHERE (x.code = c.code OR x.code LIKE c.code || '.%') AND a.status='aktif') asset_count
    FROM asset_codes c WHERE ${p.length ? 'c.parent_id=$1' : 'c.parent_id IS NULL'} ORDER BY c.code`, p));
}));
r.get('/asset-codes/:id/path', ah(async (req, res) => {
  res.json(await db.q(`WITH RECURSIVE up AS (SELECT * FROM asset_codes WHERE id=$1 UNION ALL SELECT c.* FROM asset_codes c JOIN up ON c.id=up.parent_id)
    SELECT id, code, name, level FROM up ORDER BY level`, [req.params.id]));
}));
async function codeParent(c, code) {
  const parts = String(code).trim().split('.');
  if (parts.length > 5 || parts.some(x => !/^\d+$/.test(x))) fail(400, `Format kode "${code}" tidak valid (contoh: 3.10.01.02.001)`);
  const parentCode = parts.slice(0, -1).join('.');
  const parent = parentCode ? await c.one('SELECT id FROM asset_codes WHERE code=$1', [parentCode]) : null;
  if (parentCode && !parent) fail(400, `Induk ${parentCode} belum ada`);
  return { level: parts.length, parent_id: parent ? parent.id : null };
}
r.post('/asset-codes', roles('superadmin'), ah(async (req, res) => {
  const d = pick(req.body, ['code', 'name', 'useful_life_years', 'description']);
  const { level, parent_id } = await codeParent(db, d.code);
  const row = await db.one(`INSERT INTO asset_codes (code,name,level,parent_id,useful_life_years,description) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [d.code.trim(), d.name, level, parent_id, d.useful_life_years, d.description]);
  await audit(null, req.user, 'create', 'asset_codes', row.id);
  res.status(201).json(row);
}));
r.put('/asset-codes/:id', roles('superadmin'), ah(async (req, res) => {
  const { sql, values } = setClause(pick(req.body, ['name', 'useful_life_years', 'description']), 2);
  res.json(await db.one(`UPDATE asset_codes SET ${sql} WHERE id=$1 RETURNING *`, [req.params.id, ...values]));
}));
r.delete('/asset-codes/:id', roles('superadmin'), ah(async (req, res) => {
  const n = await db.one(`SELECT count(*) n FROM assets a JOIN asset_codes x ON x.id=a.asset_code_id, asset_codes c
    WHERE c.id=$1 AND (x.code=c.code OR x.code LIKE c.code || '.%')`, [req.params.id]);
  if (n.n) fail(409, `Kode ini (atau turunannya) dipakai ${n.n} aset`);
  await db.query('DELETE FROM asset_codes WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));
r.post('/asset-codes/import', roles('superadmin'), ah(async (req, res) => {
  const rows = (req.body.rows || []).filter(x => x.code && x.name).sort((a, b) => String(a.code).split('.').length - String(b.code).split('.').length || String(a.code).localeCompare(String(b.code)));
  let n = 0; const errors = [];
  await tx(async c => {
    for (const x of rows) {
      try {
        const { level, parent_id } = await codeParent(c, x.code);
        await c.query(`INSERT INTO asset_codes (code,name,level,parent_id,useful_life_years) VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, useful_life_years=COALESCE(EXCLUDED.useful_life_years, asset_codes.useful_life_years)`,
        [String(x.code).trim(), x.name, level, parent_id, Number(x.useful_life_years) || null]);
        n++;
      } catch (e) { errors.push(`${x.code}: ${e.message}`); }
    }
  });
  res.json({ imported: n, errors: errors.slice(0, 50) });
}));

// ---------------- Aset ----------------
const ASSET_SQL = `SELECT a.*, ac.code asset_code, ac.name code_name, r.code room_code, r.name room_name, b.name building_name, b.id building_id,
    p.name holder_name, p.id_number holder_number, u.name unit_name, ${BOOK} book_value, ${ACC} acc_dep
  FROM assets a JOIN asset_codes ac ON ac.id=a.asset_code_id LEFT JOIN rooms r ON r.id=a.room_id LEFT JOIN buildings b ON b.id=r.building_id
  LEFT JOIN people p ON p.id=a.holder_id LEFT JOIN units u ON u.id=a.unit_id`;

r.get('/assets', ah(async (req, res) => {
  const q = req.query, p = [], w = [];
  const add = (v, s) => { p.push(v); w.push(s.replace(/\?/g, '$' + p.length)); };
  add(q.status || 'aktif', 'a.status=?');
  if (q.q) add(`%${q.q}%`, '(a.name ILIKE ? OR a.tag ILIKE ? OR a.serial_number ILIKE ? OR a.brand ILIKE ?)');
  if (q.room_id) add(q.room_id, 'a.room_id=?');
  if (q.building_id) add(q.building_id, 'r.building_id=?');
  if (q.holder_id) add(q.holder_id, 'a.holder_id=?');
  if (q.unit_id) add(q.unit_id, 'a.unit_id=?');
  if (q.condition) add(q.condition, 'a.condition=?');
  if (q.code) add(q.code, "(ac.code=? OR ac.code LIKE ? || '.%')");
  if (q.ids) add(String(q.ids).split(',').map(Number), 'a.id = ANY(?)');
  w.push(assetScope(req.user, p));
  const limit = Math.min(Number(q.limit) || 100, 5000), offset = Number(q.offset) || 0;
  const where = w.join(' AND ');
  const rows = await db.q(`${ASSET_SQL} WHERE ${where} ORDER BY ac.code, a.nup LIMIT ${limit} OFFSET ${offset}`, p);
  const sum = await db.one(`SELECT count(*) total, COALESCE(sum(a.price),0) value, COALESCE(sum(${BOOK}),0) book, COALESCE(sum(${ACC}),0) acc FROM assets a JOIN asset_codes ac ON ac.id=a.asset_code_id
    LEFT JOIN rooms r ON r.id=a.room_id WHERE ${where}`, p);
  res.json({ rows, ...sum });
}));

r.get('/assets/:id', ah(async (req, res) => {
  const a = await db.one(`${ASSET_SQL} WHERE a.id=$1`, [req.params.id]);
  if (!a) fail(404, 'Aset tidak ditemukan');
  if (!seesAll(req.user) && !(await canManageAsset(req.user, a))) fail(403, 'Aset ini di luar lingkup unit Anda');
  a.can_manage = await canManageAsset(req.user, a);
  a.code_path = await db.q(`WITH RECURSIVE up AS (SELECT * FROM asset_codes WHERE id=$1 UNION ALL SELECT c.* FROM asset_codes c JOIN up ON c.id=up.parent_id)
    SELECT code, name, level FROM up ORDER BY level`, [a.asset_code_id]);
  a.history = await db.q(`SELECT h.*, fr.code from_room, tr.code to_room, fh.name from_holder, th.name to_holder, u.name user_name
    FROM asset_history h LEFT JOIN rooms fr ON fr.id=h.from_room_id LEFT JOIN rooms tr ON tr.id=h.to_room_id
    LEFT JOIN people fh ON fh.id=h.from_holder_id LEFT JOIN people th ON th.id=h.to_holder_id LEFT JOIN users u ON u.id=h.user_id
    WHERE h.asset_id=$1 ORDER BY h.created_at DESC, h.id DESC`, [a.id]);
  a.maintenance = await db.q('SELECT * FROM maintenance WHERE asset_id=$1 ORDER BY start_date DESC', [a.id]);
  a.depreciation = await db.one('SELECT * FROM asset_dep($1)', [a.id]);
  a.files = await db.q(`SELECT * FROM attachments WHERE entity_type='asset' AND entity_id=$1 ORDER BY created_at DESC`, [a.id]);
  res.json(a);
}));

const AF = ['name', 'brand', 'model', 'serial_number', 'specification', 'acquisition_date', 'acquisition_method', 'funding_source', 'vendor', 'document_no', 'price', 'useful_life_years', 'notes'];
r.post('/assets', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const d = pick(req.body, [...AF, 'asset_code_id', 'room_id', 'holder_id', 'condition']);
  const qty = Math.max(1, Math.min(500, Number(req.body.quantity) || 1));
  if (!d.asset_code_id || !d.name) fail(400, 'Kode barang dan nama aset wajib diisi');
  if (!d.room_id && !d.holder_id) fail(400, 'Tentukan penempatan: ruangan dan/atau pemegang');
  if (d.room_id && !(await canManageRoom(req.user, d.room_id))) fail(403, 'Ruangan ini bukan dalam pengelolaan unit Anda');
  const code = await db.one('SELECT * FROM asset_codes WHERE id=$1', [d.asset_code_id]);
  if (!code || code.level !== 5) fail(400, 'Aset harus didaftarkan pada level Sub-sub Kelompok');
  const unitId = (d.room_id && await ownerUnit(d.room_id)) || req.user.unit_id || null;
  const ids = await tx(async c => {
    await c.query('SELECT id FROM asset_codes WHERE id=$1 FOR UPDATE', [code.id]); // kunci penomoran NUP
    let nup = (await c.one('SELECT COALESCE(max(nup),0) m FROM assets WHERE asset_code_id=$1', [code.id])).m;
    const out = [];
    for (let i = 0; i < qty; i++) {
      nup++;
      const tag = `${code.code}.${String(nup).padStart(5, '0')}`;
      const row = await c.one(`INSERT INTO assets (asset_code_id,nup,tag,name,brand,model,serial_number,specification,acquisition_date,acquisition_method,funding_source,vendor,document_no,price,useful_life_years,notes,condition,room_id,holder_id,unit_id,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,'pembelian'),$11,$12,$13,COALESCE($14,0),$15,$16,COALESCE($17,'baru'),$18,$19,$20,$21) RETURNING id`,
      [code.id, nup, tag, d.name, d.brand, d.model, qty > 1 ? null : d.serial_number, d.specification, d.acquisition_date, d.acquisition_method, d.funding_source, d.vendor, d.document_no, d.price, d.useful_life_years || code.useful_life_years, d.notes, d.condition, d.room_id, d.holder_id, unitId, req.user.id]);
      await history(c, row.id, 'registrasi', { to_room_id: d.room_id, to_holder_id: d.holder_id, to_condition: d.condition || 'baru', note: `Perolehan: ${d.acquisition_method || 'pembelian'}` }, req.user);
      out.push(row.id);
    }
    await audit(c, req.user, 'create', 'assets', out[0], { qty, code: code.code });
    return out;
  });
  res.status(201).json({ ids });
}));

r.put('/assets/:id', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const a = await db.one('SELECT * FROM assets WHERE id=$1', [req.params.id]);
  if (!a) fail(404, 'Aset tidak ditemukan');
  if (!(await canManageAsset(req.user, a))) fail(403, 'Aset ini di luar lingkup unit Anda');
  const d = pick(req.body, AF);
  const { sql, values } = setClause({ ...d, updated_at: new Date() }, 2);
  await tx(async c => {
    await c.query(`UPDATE assets SET ${sql} WHERE id=$1`, [a.id, ...values]);
    const changed = Object.keys(d).filter(k => String(d[k] ?? '') !== String(a[k] ?? ''));
    if (changed.length) await history(c, a.id, 'ubah_data', { note: 'Ubah: ' + changed.join(', ') }, req.user);
  });
  res.json({ ok: true });
}));

r.post('/assets/:id/condition', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const a = await db.one('SELECT * FROM assets WHERE id=$1', [req.params.id]);
  if (!a) fail(404, 'Aset tidak ditemukan');
  if (!(await canManageAsset(req.user, a))) fail(403, 'Aset ini di luar lingkup unit Anda');
  const cond = req.body.condition;
  if (!['baru', 'baik', 'rusak', 'diperbaiki', 'rusak_parah'].includes(cond)) fail(400, 'Kondisi tidak valid');
  await tx(async c => {
    await c.query('UPDATE assets SET condition=$2, updated_at=now() WHERE id=$1', [a.id, cond]);
    await history(c, a.id, 'kondisi', { from_condition: a.condition, to_condition: cond, note: req.body.note }, req.user);
    if (req.body.report_damage && a.room_id && ['rusak', 'rusak_parah'].includes(cond))
      await c.query(`INSERT INTO room_damages (room_id,title,description,severity,asset_id,reported_by) VALUES ($1,$2,$3,$4,$5,$6)`,
        [a.room_id, `Kerusakan aset: ${a.name} (${a.tag})`, req.body.note, cond === 'rusak_parah' ? 'berat' : 'sedang', a.id, req.user.id]);
  });
  res.json({ ok: true });
}));

// ---------------- Pemeliharaan / perbaikan ----------------
r.post('/assets/:id/maintenance', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const a = await db.one('SELECT * FROM assets WHERE id=$1', [req.params.id]);
  if (!a) fail(404, 'Aset tidak ditemukan');
  if (!(await canManageAsset(req.user, a))) fail(403, 'Aset ini di luar lingkup unit Anda');
  const d = pick(req.body, ['start_date', 'description', 'vendor', 'cost']);
  if (!d.description) fail(400, 'Uraian perbaikan wajib diisi');
  const m = await tx(async c => {
    const row = await c.one(`INSERT INTO maintenance (asset_id,start_date,description,vendor,cost,created_by) VALUES ($1,COALESCE($2,current_date),$3,$4,COALESCE($5,0),$6) RETURNING *`,
      [a.id, d.start_date, d.description, d.vendor, d.cost, req.user.id]);
    await c.query(`UPDATE assets SET condition='diperbaiki', updated_at=now() WHERE id=$1`, [a.id]);
    await history(c, a.id, 'perbaikan', { from_condition: a.condition, to_condition: 'diperbaiki', note: d.description, ref_type: 'maintenance', ref_id: row.id }, req.user);
    return row;
  });
  res.status(201).json(m);
}));
r.put('/maintenance/:id', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const m = await db.one('SELECT m.*, a.room_id, a.unit_id, a.condition FROM maintenance m JOIN assets a ON a.id=m.asset_id WHERE m.id=$1', [req.params.id]);
  if (!m) fail(404, 'Data perbaikan tidak ditemukan');
  if (!(await canManageAsset(req.user, m))) fail(403, 'Aset ini di luar lingkup unit Anda');
  const d = pick(req.body, ['status', 'end_date', 'cost', 'result_condition', 'vendor', 'description']);
  await tx(async c => {
    const s = setClause(d, 2);
    await c.query(`UPDATE maintenance SET ${s.sql} WHERE id=$1`, [m.id, ...s.values]);
    if (d.status && d.status !== 'proses') {
      const cond = d.result_condition || (d.status === 'selesai' ? 'baik' : 'rusak_parah');
      await c.query('UPDATE assets SET condition=$2, updated_at=now() WHERE id=$1', [m.asset_id, cond]);
      await history(c, m.asset_id, 'perbaikan', { from_condition: m.condition, to_condition: cond, note: `Perbaikan ${d.status}`, ref_type: 'maintenance', ref_id: m.id }, req.user);
    }
  });
  res.json({ ok: true });
}));

// ---------------- Mutasi (ruang / pemegang / antar unit) ----------------
r.post('/mutations', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const { asset_ids = [], to_room_id, to_holder_id, clear_holder, mutation_date, reason, signatories } = req.body;
  if (!asset_ids.length) fail(400, 'Pilih minimal satu aset');
  if (!to_room_id && !to_holder_id && !clear_holder) fail(400, 'Tentukan ruang tujuan dan/atau pemegang baru');
  const assets = await db.q('SELECT * FROM assets WHERE id = ANY($1) AND status=$2', [asset_ids.map(Number), 'aktif']);
  if (assets.length !== asset_ids.length) fail(400, 'Sebagian aset tidak ditemukan atau sudah dihapus');
  for (const a of assets) if (!(await canManageAsset(req.user, a))) fail(403, `Aset ${a.tag} di luar lingkup unit Anda`);
  const toUnit = to_room_id ? await ownerUnit(to_room_id) : null;
  const crossUnit = to_room_id && assets.some(a => (a.unit_id || null) !== (toUnit || null));
  if (to_room_id && !isSA(req.user) && !(await canManageRoom(req.user, to_room_id))) fail(403, 'Mutasi antar unit hanya dapat dilakukan Super Admin');
  const type = crossUnit ? 'antar_unit' : to_room_id && (to_holder_id || clear_holder) ? 'ruang_pemegang' : to_room_id ? 'ruang' : 'pemegang';
  const out = await tx(async c => {
    const number = await nextNumber(c, 'MUT', mutation_date || new Date());
    const toRoom = to_room_id ? await c.one('SELECT r.code, r.name, b.name building FROM rooms r JOIN buildings b ON b.id=r.building_id WHERE r.id=$1', [to_room_id]) : null;
    const toHolder = to_holder_id ? await c.one('SELECT name, id_number FROM people WHERE id=$1', [to_holder_id]) : null;
    const items = await c.q(`SELECT a.id, a.tag, a.name, a.price, a.condition, r.code room_code, p.name holder FROM assets a LEFT JOIN rooms r ON r.id=a.room_id
      LEFT JOIN people p ON p.id=a.holder_id WHERE a.id = ANY($1) ORDER BY a.tag`, [asset_ids.map(Number)]);
    const ba = await c.one(`INSERT INTO berita_acara (number,ba_type,ba_date,title,unit_id,content,signatories,ref_type,created_by)
      VALUES ($1,'mutasi',COALESCE($2,current_date),$3,$4,$5,$6,'mutation',$7) RETURNING id`,
    [await nextNumber(c, 'BA-MUT', mutation_date || new Date()), mutation_date, 'Berita Acara Mutasi Barang', toUnit || req.user.unit_id,
      JSON.stringify({ mutation_number: number, type, reason, to_room: toRoom, to_holder: toHolder, items }), JSON.stringify(signatories || []), req.user.id]);
    const m = await c.one(`INSERT INTO mutations (number,mutation_date,mutation_type,to_unit_id,to_room_id,to_holder_id,reason,ba_id,created_by)
      VALUES ($1,COALESCE($2,current_date),$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [number, mutation_date, type, toUnit, to_room_id || null, to_holder_id || null, reason, ba.id, req.user.id]);
    await c.query('UPDATE berita_acara SET ref_id=$2 WHERE id=$1', [ba.id, m.id]);
    for (const a of assets) {
      await c.query('INSERT INTO mutation_items (mutation_id,asset_id,from_unit_id,from_room_id,from_holder_id) VALUES ($1,$2,$3,$4,$5)', [m.id, a.id, a.unit_id, a.room_id, a.holder_id]);
      const newRoom = to_room_id || a.room_id, newHolder = clear_holder ? null : (to_holder_id || a.holder_id);
      await c.query('UPDATE assets SET room_id=$2, holder_id=$3, unit_id=COALESCE($4,unit_id), updated_at=now() WHERE id=$1', [a.id, newRoom, newHolder, toUnit]);
      await history(c, a.id, 'mutasi', { from_room_id: a.room_id, to_room_id: newRoom, from_holder_id: a.holder_id, to_holder_id: newHolder, note: reason, ref_type: 'mutation', ref_id: m.id }, req.user);
    }
    await audit(c, req.user, 'create', 'mutations', m.id, { n: assets.length, type });
    return { ...m, ba_id: ba.id };
  });
  res.status(201).json(out);
}));
r.get('/mutations', ah(async (req, res) => {
  const p = [], scope = seesAll(req.user) ? 'TRUE' : (p.push(req.user.unit_id), `(m.to_unit_id=$1 OR EXISTS (SELECT 1 FROM mutation_items i WHERE i.mutation_id=m.id AND i.from_unit_id=$1) OR m.created_by=${Number(req.user.id)})`);
  res.json(await db.q(`SELECT m.*, r.code to_room_code, r.name to_room_name, p.name to_holder_name, u.name created_by_name, ba.number ba_number,
      (SELECT count(*) FROM mutation_items i WHERE i.mutation_id=m.id) item_count,
      (SELECT count(*) FROM attachments f WHERE f.entity_type='mutation' AND f.entity_id=m.id) file_count
    FROM mutations m LEFT JOIN rooms r ON r.id=m.to_room_id LEFT JOIN people p ON p.id=m.to_holder_id LEFT JOIN users u ON u.id=m.created_by
    LEFT JOIN berita_acara ba ON ba.id=m.ba_id WHERE ${scope} ORDER BY m.created_at DESC LIMIT 300`, p));
}));

// ---------------- Penghapusan (pengurangan aset) ----------------
r.post('/assets/dispose', roles('superadmin', 'unit_admin'), ah(async (req, res) => {
  const { asset_ids = [], reason, method = 'dimusnahkan', disposal_date, signatories } = req.body;
  if (!asset_ids.length || !reason) fail(400, 'Pilih aset dan isi alasan penghapusan');
  const assets = await db.q(`SELECT a.*, r.code room_code FROM assets a LEFT JOIN rooms r ON r.id=a.room_id WHERE a.id = ANY($1) AND a.status='aktif'`, [asset_ids.map(Number)]);
  for (const a of assets) if (!(await canManageAsset(req.user, a))) fail(403, `Aset ${a.tag} di luar lingkup unit Anda`);
  const out = await tx(async c => {
    const ba = await c.one(`INSERT INTO berita_acara (number,ba_type,ba_date,title,unit_id,content,signatories,ref_type,created_by)
      VALUES ($1,'penghapusan',COALESCE($2,current_date),'Berita Acara Penghapusan Barang',$3,$4,$5,'disposal',$6) RETURNING id, number`,
    [await nextNumber(c, 'BA-HPS', disposal_date || new Date()), disposal_date, req.user.unit_id || (assets[0] && assets[0].unit_id),
      JSON.stringify({ reason, method, items: assets.map(a => ({ tag: a.tag, name: a.name, price: a.price, condition: a.condition, room_code: a.room_code })) }),
      JSON.stringify(signatories || []), req.user.id]);
    for (const a of assets) {
      await c.query(`UPDATE assets SET status='dihapus', disposed_at=COALESCE($2,current_date), disposal_ba_id=$3, updated_at=now() WHERE id=$1`, [a.id, disposal_date, ba.id]);
      await history(c, a.id, 'penghapusan', { from_room_id: a.room_id, from_holder_id: a.holder_id, note: `${method}: ${reason}`, ref_type: 'ba', ref_id: ba.id }, req.user);
    }
    await audit(c, req.user, 'dispose', 'assets', null, { ids: asset_ids, ba: ba.id });
    return ba;
  });
  res.json(out);
}));

// ---------------- Valuasi ----------------
r.get('/valuation', ah(async (req, res) => {
  const groups = {
    room: ['r.id', `COALESCE(r.code || ' — ' || r.name, '(tanpa ruang)')`, 'b.name'],
    holder: ['p.id', `COALESCE(p.name, '(tanpa pemegang)')`, 'p.id_number'],
    unit: ['un.id', `COALESCE(un.name, '(tanpa unit)')`, 'un.code'],
    building: ['b.id', `COALESCE(b.name, '(tanpa gedung)')`, 'b.code'],
    code: ['k.id', `k.code || ' ' || k.name`, `'Bidang'`],
  };
  const g = groups[req.query.group] || groups.room, p = [];
  const w = [`a.status='aktif'`, assetScope(req.user, p)];
  if (req.query.unit_id) { p.push(req.query.unit_id); w.push(`a.unit_id=$${p.length}`); }
  const codeJoin = req.query.group === 'code' ? `JOIN asset_codes k ON k.level=2 AND (ac.code LIKE k.code || '.%')` : '';
  res.json(await db.q(`SELECT ${g[0]} id, ${g[1]} label, ${g[2]} sub, count(*) qty, COALESCE(sum(a.price),0) value, COALESCE(sum(${BOOK}),0) book_value,
      count(*) FILTER (WHERE a.condition IN ('rusak','rusak_parah')) broken
    FROM assets a JOIN asset_codes ac ON ac.id=a.asset_code_id ${codeJoin} LEFT JOIN rooms r ON r.id=a.room_id LEFT JOIN buildings b ON b.id=r.building_id
    LEFT JOIN people p ON p.id=a.holder_id LEFT JOIN units un ON un.id=a.unit_id
    WHERE ${w.join(' AND ')} GROUP BY 1,2,3 ORDER BY value DESC LIMIT 1000`, p));
}));

// ---------------- QR & label ----------------
r.get('/assets/:id/qr.svg', ah(async (req, res) => {
  const a = await db.one('SELECT tag FROM assets WHERE id=$1', [req.params.id]);
  if (!a) fail(404, 'Aset tidak ditemukan');
  res.type('image/svg+xml').send(await QRCode.toString(`${publicBase(req)}/a.html?t=${encodeURIComponent(a.tag)}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }));
}));
r.post('/assets/labels', ah(async (req, res) => {
  const p = [(req.body.ids || []).map(Number)];
  const rows = await db.q(`SELECT a.id, a.tag, a.name, a.acquisition_date, r.code room_code, b.code building_code, u.name unit_name
    FROM assets a LEFT JOIN rooms r ON r.id=a.room_id LEFT JOIN buildings b ON b.id=r.building_id LEFT JOIN units u ON u.id=a.unit_id
    WHERE a.id = ANY($1) AND ${assetScope(req.user, p)} ORDER BY a.tag`, p);
  for (const x of rows) x.qr = await QRCode.toString(`${publicBase(req)}/a.html?t=${encodeURIComponent(x.tag)}`, { type: 'svg', margin: 0 });
  res.json(rows);
}));
// Cari aset dari hasil scan (tag atau URL)
r.get('/scan', ah(async (req, res) => {
  const raw = String(req.query.code || ''), m = raw.match(/[?&]t=([^&]+)/);
  const tag = m ? decodeURIComponent(m[1]) : raw.trim();
  const a = await db.one('SELECT id FROM assets WHERE tag=$1', [tag]);
  if (!a) fail(404, `Aset dengan kode ${tag} tidak ditemukan`);
  res.json(a);
}));

// ---------------- Jadwal penyusutan per aset ----------------
r.get('/assets/:id/depreciation', ah(async (req, res) => {
  const a = await db.one('SELECT * FROM assets WHERE id=$1', [req.params.id]);
  if (!a) fail(404, 'Aset tidak ditemukan');
  if (!seesAll(req.user) && !(await canManageAsset(req.user, a))) fail(403, 'Aset ini di luar lingkup unit Anda');
  const now = await db.one('SELECT * FROM asset_dep($1)', [a.id]);
  if (!now.depreciable) return res.json({ summary: now, schedule: [] });
  const rows = await db.q(`SELECT g.i, dep_idx_end(g.i, $2) period_end, d.accumulated, d.book_value, d.periods_elapsed
    FROM generate_series(dep_idx($3::date, $2), dep_idx($3::date, $2) + $4) g(i), LATERAL asset_dep($1, dep_idx_end(g.i, $2)) d
    ORDER BY g.i`, [a.id, now.period_type, a.acquisition_date, Math.min(now.periods_total + 1, 1200)]);
  let prev = 0; const today = new Date().toISOString().slice(0, 10);
  const schedule = rows.filter(x => x.periods_elapsed > 0).map(x => { const o = { period_end: x.period_end, expense: Math.round((x.accumulated - prev) * 100) / 100, accumulated: x.accumulated, book_value: x.book_value, past: x.period_end <= today }; prev = x.accumulated; return o; })
    .filter((x, i, arr) => x.expense > 0 || i === 0);
  res.json({ summary: now, schedule });
}));

// ---------------- Kebijakan penyusutan ----------------
r.get('/depreciation/policy', ah(async (req, res) => {
  const s = await db.one(`SELECT value FROM settings WHERE key='depreciation'`);
  res.json(s ? s.value : {});
}));
r.put('/depreciation/policy', roles('superadmin'), ah(async (req, res) => {
  const v = pick(req.body, ['period', 'convention', 'capitalization_min', 'residual_pct', 'excluded_groups']);
  if (!['bulan', 'semester', 'tahun'].includes(v.period)) fail(400, 'Periode penyusutan tidak valid');
  if (!['penuh', 'berikutnya'].includes(v.convention)) fail(400, 'Konvensi awal penyusutan tidak valid');
  v.method = 'garis_lurus'; v.capitalization_min = Number(v.capitalization_min) || 0; v.residual_pct = Math.min(100, Math.max(0, Number(v.residual_pct) || 0));
  v.excluded_groups = (v.excluded_groups || []).map(String);
  await db.query(`INSERT INTO settings (key,value) VALUES ('depreciation',$1) ON CONFLICT (key) DO UPDATE SET value=$1`, [JSON.stringify(v)]);
  await audit(null, req.user, 'update', 'settings', null, { depreciation: v });
  res.json(v);
}));

module.exports = { router: r, history, canManageAsset, assetScope, BOOK, ACC };
