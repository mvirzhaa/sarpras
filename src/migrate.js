// Migrasi ringan yang dijalankan otomatis saat server mulai (semua perintah idempoten),
// supaya pembaruan aplikasi tidak wajib menjalankan `npm run db:init` ulang.
const { pool } = require('./db');
const STEPS = [
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS session_no int`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS orig_room_id int REFERENCES rooms(id) ON DELETE SET NULL`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS orig_start_at timestamptz`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS change_note text`,
  `CREATE INDEX IF NOT EXISTS events_series_idx ON events(series_id) WHERE series_id IS NOT NULL`,
];
module.exports = async function migrate() {
  for (const q of STEPS) await pool.query(q);
};
