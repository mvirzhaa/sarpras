// CRUD generik untuk tabel master sederhana
const express = require('express');
const { db } = require('./db');
const { ah, fail, pick, setClause, insertSql, audit } = require('./util');
const { roles } = require('./auth');

module.exports = function crud({ table, fields, search = [], order = 't.id DESC', select, filters = {}, write = ['superadmin'], scope, beforeSave }) {
  const r = express.Router();
  const base = select || `SELECT t.* FROM ${table} t`;
  const where = (req, p) => {
    const w = ['TRUE'];
    if (req.query.q && search.length) { p.push(`%${req.query.q}%`); w.push('(' + search.map(s => `${s} ILIKE $${p.length}`).join(' OR ') + ')'); }
    for (const [param, col] of Object.entries(filters))
      if (req.query[param] !== undefined && req.query[param] !== '') { p.push(req.query[param]); w.push(`${col}=$${p.length}`); }
    if (scope) w.push(scope(req.user, p));
    return w.join(' AND ');
  };
  r.get('/', ah(async (req, res) => {
    const p = [], w = where(req, p);
    const limit = Math.min(Number(req.query.limit) || 500, 5000), offset = Number(req.query.offset) || 0;
    const rows = await db.q(`${base} WHERE ${w} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, p);
    const total = (await db.one(`SELECT count(*) n FROM (${base} WHERE ${w}) x`, p)).n;
    res.json({ rows, total });
  }));
  r.get('/:id', ah(async (req, res) => {
    const row = await db.one(`${base} WHERE t.id=$1`, [req.params.id]);
    if (!row) fail(404, 'Data tidak ditemukan');
    res.json(row);
  }));
  r.post('/', roles(...write), ah(async (req, res) => {
    let data = pick(req.body, fields);
    if (beforeSave) data = await beforeSave(data, req, null);
    const { sql, values } = insertSql(table, data);
    const row = await db.one(sql, values);
    await audit(null, req.user, 'create', table, row.id, data);
    res.status(201).json(row);
  }));
  r.put('/:id', roles(...write), ah(async (req, res) => {
    let data = pick(req.body, fields);
    if (beforeSave) data = await beforeSave(data, req, req.params.id);
    if (!Object.keys(data).length) fail(400, 'Tidak ada data yang diubah');
    const { sql, values } = setClause(data, 2);
    const row = await db.one(`UPDATE ${table} SET ${sql} WHERE id=$1 RETURNING *`, [req.params.id, ...values]);
    if (!row) fail(404, 'Data tidak ditemukan');
    await audit(null, req.user, 'update', table, row.id, data);
    res.json(row);
  }));
  r.delete('/:id', roles(...write), ah(async (req, res) => {
    if (beforeSave) await beforeSave({}, req, req.params.id, 'delete');
    const row = await db.one(`DELETE FROM ${table} WHERE id=$1 RETURNING id`, [req.params.id]);
    if (!row) fail(404, 'Data tidak ditemukan');
    await audit(null, req.user, 'delete', table, row.id);
    res.json({ ok: true });
  }));
  return r;
};
