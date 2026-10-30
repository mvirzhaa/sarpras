const jwt = require('jsonwebtoken');
const { db } = require('./db');
const { HttpError } = require('./util');
const SECRET = process.env.JWT_SECRET || 'ganti-secret-ini';

const sign = u => jwt.sign({ id: u.id }, SECRET, { expiresIn: process.env.JWT_EXPIRES || '12h' });

async function authRequired(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : req.query.token;
    if (!token) throw new HttpError(401, 'Silakan masuk terlebih dahulu');
    let id;
    try { ({ id } = jwt.verify(token, SECRET)); } catch { throw new HttpError(401, 'Sesi berakhir, silakan masuk lagi'); }
    const u = await db.one(`SELECT u.id,u.username,u.name,u.email,u.role,u.unit_id,u.active,u.must_change_password,un.name unit_name,un.code unit_code
                            FROM users u LEFT JOIN units un ON un.id=u.unit_id WHERE u.id=$1`, [id]);
    if (!u || !u.active) throw new HttpError(401, 'Akun tidak aktif');
    req.user = u;
    if (u.role === 'pimpinan' && req.method !== 'GET' && !/^\/(auth|notifications)/.test(req.path))
      throw new HttpError(403, 'Akun pimpinan hanya dapat melihat data');
    next();
  } catch (e) { next(e); }
}
const roles = (...r) => (req, res, next) => (r.includes(req.user.role) ? next() : next(new HttpError(403, 'Anda tidak punya akses ke fitur ini')));
const isSA = u => u.role === 'superadmin';
const seesAll = u => u.role === 'superadmin' || u.role === 'pimpinan';

// Boleh mengelola ruangan ini (jadwal, aset, kerusakan)?
async function canManageRoom(user, roomId, c = db) {
  if (isSA(user)) return true;
  if (user.role !== 'unit_admin' || !roomId) return false;
  return !!(await c.one(`SELECT 1 FROM v_room_owner WHERE room_id=$1 AND unit_id=$2`, [roomId, user.unit_id]));
}
async function assertRoom(user, roomId, c = db) {
  if (!(await canManageRoom(user, roomId, c))) throw new HttpError(403, 'Ruangan ini bukan dalam pengelolaan unit Anda');
}
// Fragmen SQL pembatas ruang sesuai lingkup user
function roomScope(user, col, params) {
  if (seesAll(user)) return 'TRUE';
  params.push(user.unit_id);
  return `${col} IN (SELECT room_id FROM v_room_owner WHERE unit_id=$${params.length})`;
}
async function ownerUnit(roomId, c = db) {
  const r = await c.one(`SELECT unit_id FROM v_room_owner WHERE room_id=$1`, [roomId]);
  return r ? r.unit_id : null;
}
module.exports = { sign, authRequired, roles, isSA, seesAll, canManageRoom, assertRoom, roomScope, ownerUnit };
