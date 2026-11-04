const jwt = require('jsonwebtoken');
const { db } = require('./db');
const { HttpError } = require('./util');
const SECRET = process.env.JWT_SECRET || 'ganti-secret-ini';

const sign = u => jwt.sign({ id: u.id }, SECRET, { expiresIn: process.env.JWT_EXPIRES || '12h' });
// Token "masuk sebagai": id = akun unit, imp = super admin asal (berlaku 2 jam)
const signAs = (targetId, saId) => jwt.sign({ id: targetId, imp: saId }, SECRET, { expiresIn: '2h' });

async function authRequired(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : req.query.token;
    if (!token) throw new HttpError(401, 'Silakan masuk terlebih dahulu');
    let id, imp;
    try { ({ id, imp } = jwt.verify(token, SECRET)); } catch { throw new HttpError(401, 'Sesi berakhir, silakan masuk lagi'); }
    const u = await db.one(`SELECT u.id,u.username,u.name,u.email,u.role,u.unit_id,u.active,u.must_change_password,un.name unit_name,un.code unit_code
                            FROM users u LEFT JOIN units un ON un.id=u.unit_id WHERE u.id=$1`, [id]);
    if (!u) throw new HttpError(401, 'Akun tidak ditemukan');
    if (imp) {
      const sa = await db.one(`SELECT id, name, username FROM users WHERE id=$1 AND role='superadmin' AND active`, [imp]);
      if (!sa) throw new HttpError(401, 'Sesi masuk-sebagai tidak valid');
      u.impersonated_by = sa.id; u.impersonator_name = sa.name || sa.username; u.must_change_password = false;
    } else if (!u.active) throw new HttpError(401, 'Akun tidak aktif');
    req.user = u;
    if (u.role === 'pimpinan' && req.method !== 'GET' && !/^\/(auth|notifications)/.test(req.path))
      throw new HttpError(403, 'Akun pimpinan hanya dapat melihat data');
    next();
  } catch (e) { next(e); }
}

const roles = (...list) => (req, res, next) => {
  if (!req.user || !list.includes(req.user.role))
    return next(new HttpError(403, 'Akses ditolak: peran tidak sesuai'));
  next();
};

const isSA = u => u && u.role === 'superadmin';
const seesAll = u => isSA(u) || (u && (u.role === 'rektorat' || u.role === 'pimpinan'));

async function canManageRoom(u, roomId, c = db) {
  if (isSA(u)) return true;
  if (!u || !u.unit_id) return false;
  const r = await c.one(`SELECT unit_id FROM v_room_owner WHERE room_id=$1`, [roomId]);
  return r && r.unit_id === u.unit_id;
}

async function assertRoom(u, roomId, c = db) {
  if (!(await canManageRoom(u, roomId, c)))
    throw new HttpError(403, 'Anda bukan pengelola ruang ini');
}

function roomScope(u, field = 'r.id') {
  if (seesAll(u)) return { clause: '1=1', params: [] };
  if (!u.unit_id) return { clause: '1=0', params: [] };
  return {
    clause: `EXISTS (SELECT 1 FROM v_room_owner vro WHERE vro.room_id=${field} AND vro.unit_id=$1)`,
    params: [u.unit_id]
  };
}

async function ownerUnit(roomId, c = db) {
  const r = await c.one(`SELECT unit_id FROM v_room_owner WHERE room_id=$1`, [roomId]);
  return r ? r.unit_id : null;
}
module.exports = { sign, signAs, authRequired, roles, isSA, seesAll, canManageRoom, assertRoom, roomScope, ownerUnit };
