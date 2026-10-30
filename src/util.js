const { db } = require('./db');

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (status, msg) => { throw new HttpError(status, msg); };
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k] === '' ? null : o[k]]));
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

// Nomor dokumen: 0007/BA-MUT/SARPRAS-UIKA/X/2026 (reset per tahun)
async function nextNumber(c, prefix, date = new Date()) {
  const d = new Date(date), y = d.getFullYear();
  const r = await c.one(`INSERT INTO numbering (key,last) VALUES ($1,1)
     ON CONFLICT (key) DO UPDATE SET last = numbering.last + 1 RETURNING last`, [`${prefix}/${y}`]);
  const org = await c.one(`SELECT value->>'value' v FROM settings WHERE key='numbering_code'`);
  return `${String(r.last).padStart(4, '0')}/${prefix}/${org ? org.v : 'SARPRAS'}/${ROMAN[d.getMonth()]}/${y}`;
}
const ticket = () => (Math.random().toString(36).slice(2, 5) + Date.now().toString(36).slice(-5)).toUpperCase();

async function audit(c, user, action, entity, entityId, data) {
  await (c || db).query(`INSERT INTO audit_logs (user_id,action,entity,entity_id,data) VALUES ($1,$2,$3,$4,$5)`,
    [user ? user.id : null, action, entity, entityId || null, data ? JSON.stringify(data) : null]);
}
async function notifyUsers(c, userIds, title, body, link) {
  for (const id of [...new Set(userIds.filter(Boolean))])
    await (c || db).query(`INSERT INTO notifications (user_id,title,body,link) VALUES ($1,$2,$3,$4)`, [id, title, body, link]);
}
async function notifyUnit(c, unitId, title, body, link) {
  if (!unitId) return;
  const rows = await (c || db).q(`SELECT id FROM users WHERE unit_id=$1 AND role='unit_admin' AND active`, [unitId]);
  await notifyUsers(c, rows.map(r => r.id), title, body, link);
}
async function notifySuperadmins(c, title, body, link) {
  const rows = await (c || db).q(`SELECT id FROM users WHERE role='superadmin' AND active`);
  await notifyUsers(c, rows.map(r => r.id), title, body, link);
}
function setClause(obj, start = 1) {
  const keys = Object.keys(obj);
  return { sql: keys.map((k, i) => `${k}=$${i + start}`).join(','), values: keys.map(k => obj[k]) };
}
function insertSql(table, obj) {
  const keys = Object.keys(obj);
  return { sql: `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, values: keys.map(k => obj[k]) };
}
module.exports = { HttpError, ah, fail, pick, nextNumber, ticket, audit, notifyUsers, notifyUnit, notifySuperadmins, setClause, insertSql, ROMAN };
