const { Pool, types } = require('pg');
types.setTypeParser(1700, v => (v === null ? null : parseFloat(v))); // numeric -> number
types.setTypeParser(20, v => (v === null ? null : parseInt(v, 10)));  // bigint -> number
types.setTypeParser(1082, v => v);                                     // date -> 'YYYY-MM-DD'

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.PG_POOL || 15) });
pool.on('connect', c => c.query(`SET TIME ZONE '${process.env.TZ_DB || 'Asia/Jakarta'}'`));

const wrap = c => {
  c.q = async (t, p) => (await c.query(t, p)).rows;
  c.one = async (t, p) => (await c.query(t, p)).rows[0] || null;
  return c;
};
const db = wrap({ query: (t, p) => pool.query(t, p) });

async function tx(fn) {
  const c = wrap(await pool.connect());
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { c.release(); }
}
module.exports = { pool, db, tx };
