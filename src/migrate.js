// Migrasi ringan yang dijalankan otomatis saat server mulai (semua perintah idempoten),
// supaya pembaruan aplikasi tidak wajib menjalankan `npm run db:init` ulang.
const { pool } = require('./db');
const STEPS = [
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS session_no int`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS orig_room_id int REFERENCES rooms(id) ON DELETE SET NULL`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS orig_start_at timestamptz`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS change_note text`,
  `CREATE INDEX IF NOT EXISTS events_series_idx ON events(series_id) WHERE series_id IS NOT NULL`,

  // ASET TETAP: dokumen pengadaan (pembelian/perolehan) & pemakaian (pinjam pakai)
  `CREATE TABLE IF NOT EXISTS asset_acquisitions (
    id             serial PRIMARY KEY,
    number         varchar(80) UNIQUE NOT NULL,
    acq_date       date NOT NULL DEFAULT current_date,
    method         varchar(30) NOT NULL DEFAULT 'pembelian',
    vendor         varchar(150),
    document_no    varchar(100),
    funding_source varchar(100),
    unit_id        int REFERENCES units(id) ON DELETE SET NULL,
    total          numeric(18,2) NOT NULL DEFAULT 0,
    notes          text,
    ba_id          int REFERENCES berita_acara(id) ON DELETE SET NULL,
    created_by     int REFERENCES users(id) ON DELETE SET NULL,
    created_at     timestamptz NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE assets ADD COLUMN IF NOT EXISTS acquisition_id int REFERENCES asset_acquisitions(id) ON DELETE SET NULL`,
  `CREATE TABLE IF NOT EXISTS asset_loans (
    id             serial PRIMARY KEY,
    number         varchar(80) UNIQUE NOT NULL,
    borrower_id    int REFERENCES people(id) ON DELETE SET NULL,
    borrower_unit_id int REFERENCES units(id) ON DELETE SET NULL,
    unit_id        int REFERENCES units(id) ON DELETE SET NULL,
    purpose        text,
    location       varchar(150),
    start_date     date NOT NULL DEFAULT current_date,
    due_date       date,
    returned_date  date,
    status         varchar(15) NOT NULL DEFAULT 'dipinjam' CHECK (status IN ('dipinjam','dikembalikan')),
    notes          text,
    return_notes   text,
    ba_id          int REFERENCES berita_acara(id) ON DELETE SET NULL,
    return_ba_id   int REFERENCES berita_acara(id) ON DELETE SET NULL,
    created_by     int REFERENCES users(id) ON DELETE SET NULL,
    created_at     timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS asset_loan_items (
    loan_id        int NOT NULL REFERENCES asset_loans(id) ON DELETE CASCADE,
    asset_id       int NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    condition_out  varchar(20),
    condition_in   varchar(20),
    PRIMARY KEY (loan_id, asset_id)
  )`,

  // ASET LANCAR (persediaan): dokumen pembelian, pemakaian, stock opname
  `ALTER TABLE consumables ADD COLUMN IF NOT EXISTS category varchar(60)`,
  `CREATE TABLE IF NOT EXISTS stock_docs (
    id             serial PRIMARY KEY,
    number         varchar(80) UNIQUE NOT NULL,
    doc_type       varchar(15) NOT NULL CHECK (doc_type IN ('pembelian','pemakaian','opname')),
    doc_date       date NOT NULL DEFAULT current_date,
    unit_id        int REFERENCES units(id) ON DELETE SET NULL,
    status         varchar(10) NOT NULL DEFAULT 'posted' CHECK (status IN ('draft','posted')),
    vendor         varchar(150),
    invoice_no     varchar(100),
    funding_source varchar(100),
    person_id      int REFERENCES people(id) ON DELETE SET NULL,
    room_id        int REFERENCES rooms(id) ON DELETE SET NULL,
    purpose        text,
    notes          text,
    total          numeric(18,2) NOT NULL DEFAULT 0,
    ba_id          int REFERENCES berita_acara(id) ON DELETE SET NULL,
    created_by     int REFERENCES users(id) ON DELETE SET NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    posted_at      timestamptz
  )`,
  `CREATE TABLE IF NOT EXISTS stock_doc_items (
    id             serial PRIMARY KEY,
    doc_id         int NOT NULL REFERENCES stock_docs(id) ON DELETE CASCADE,
    consumable_id  int NOT NULL REFERENCES consumables(id) ON DELETE CASCADE,
    qty            numeric(14,2),
    unit_price     numeric(16,2) NOT NULL DEFAULT 0,
    system_qty     numeric(14,2),
    counted_qty    numeric(14,2),
    note           text
  )`,
  `ALTER TABLE consumable_tx ADD COLUMN IF NOT EXISTS doc_id int REFERENCES stock_docs(id) ON DELETE SET NULL`,
  `CREATE INDEX IF NOT EXISTS consumable_tx_date_idx ON consumable_tx(tx_date)`,
];
module.exports = async function migrate() {
  for (const q of STEPS) await pool.query(q);
};
