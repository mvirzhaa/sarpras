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
    const u = await db.one(`SELECT u.id,u.username,u.name,u.email,u.role,u.unit_id,u.sub_unit_id,u.active,u.must_change_password,un.name unit_name,un.code unit_code,
                              su.name sub_unit_name, su.code sub_unit_code
                            FROM users u LEFT JOIN units un ON un.id=u.unit_id LEFT JOIN sub_units su ON su.id=u.sub_unit_id WHERE u.id=$1`, [id]);
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

const roles = (...r) => (req, res, next) => (r.includes(req.user && req.user.role) ? next() : next(new HttpError(403, 'Anda tidak punya akses ke fitur ini')));
const isSA = u => u && u.role === 'superadmin';
const seesAll = u => u && (u.role === 'superadmin' || u.role === 'pimpinan' || u.role === 'rektorat');

// Boleh mengelola ruangan ini (jadwal, aset, kerusakan)?
async function canManageRoom(user, roomId, c = db) {
  if (isSA(user)) return true;
  if (!user || user.role !== 'unit_admin' || !roomId) return false;
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

// Hak data akademik per unit / sub unit:
//  - Super Admin: semua; admin unit (fakultas): seluruh data unitnya (tingkat unit & semua sub unit);
//  - admin sub unit (prodi): hanya data sub unit sendiri (tidak boleh data tingkat unit atau sub unit lain).
function assertUnitData(user, unitId, subUnitId) {
  if (isSA(user)) return;
  if (Number(unitId) !== Number(user.unit_id)) throw new HttpError(403, 'Hanya dapat mengelola data unit sendiri');
  if (user.sub_unit_id && Number(subUnitId) !== Number(user.sub_unit_id)) throw new HttpError(403, 'Admin sub unit hanya dapat mengelola data sub unit sendiri');
}
// Pengelola data sub unit ini? (SA, admin unit induknya, atau admin sub unit itu sendiri)
const canManageSub = (user, sub) => isSA(user) || (user && user.role === 'unit_admin' && Number(user.unit_id) === Number(sub.unit_id) && (!user.sub_unit_id || Number(user.sub_unit_id) === Number(sub.id)));

module.exports = { assertUnitData, canManageSub, sign, signAs, authRequired, roles, isSA, seesAll, canManageRoom, assertRoom, roomScope, ownerUnit };
