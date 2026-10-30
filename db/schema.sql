-- =====================================================================
-- SARPRAS: Sistem Informasi Ruangan, Penjadwalan & Aset
-- PostgreSQL >= 13
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- anti-bentrok jadwal (exclusion constraint)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- Pengaturan & penomoran ----------
CREATE TABLE IF NOT EXISTS settings (
  key   varchar(60) PRIMARY KEY,
  value jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS numbering (
  key  varchar(80) PRIMARY KEY,
  last int NOT NULL DEFAULT 0
);

-- ---------- Unit & pengguna ----------
CREATE TABLE IF NOT EXISTS units (
  id          serial PRIMARY KEY,
  code        varchar(20) UNIQUE NOT NULL,
  name        varchar(150) NOT NULL,
  description text,
  head_name   varchar(150),
  head_nip    varchar(40),
  email       varchar(150),
  phone       varchar(40),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            serial PRIMARY KEY,
  username      varchar(60) UNIQUE NOT NULL,
  name          varchar(150),
  email         varchar(150),
  phone         varchar(40),
  password_hash text,
  role          varchar(20) NOT NULL CHECK (role IN ('superadmin','unit_admin','pimpinan')),
  unit_id       int REFERENCES units(id) ON DELETE CASCADE,
  is_unit_primary boolean NOT NULL DEFAULT false,   -- akun admin otomatis milik unit
  active        boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT false,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS people (           -- dosen, tendik, pemegang aset
  id        serial PRIMARY KEY,
  id_number varchar(40),                      -- NIP / NIDN / NIK
  name      varchar(150) NOT NULL,
  kind      varchar(20) NOT NULL DEFAULT 'dosen' CHECK (kind IN ('dosen','tendik','mahasiswa','lainnya')),
  unit_id   int REFERENCES units(id) ON DELETE SET NULL,
  position  varchar(100),
  email     varchar(150),
  phone     varchar(40),
  active    boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS people_idnum_uq ON people(id_number) WHERE id_number IS NOT NULL AND id_number <> '';

-- ---------- Lampiran (generik) ----------
CREATE TABLE IF NOT EXISTS attachments (
  id          serial PRIMARY KEY,
  entity_type varchar(40) NOT NULL,   -- building, floor, asset, mutation, ba, damage, feedback, opname
  entity_id   int NOT NULL,
  doc_type    varchar(60),            -- foto, sertifikat, IMB/PBG, gambar teknis, BAST, dll
  title       varchar(200),
  file_name   varchar(255) NOT NULL,
  file_path   varchar(400) NOT NULL,
  mime        varchar(120),
  size        int,
  uploaded_by int REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attachments_entity_idx ON attachments(entity_type, entity_id);

-- ---------- Gedung, lantai, ruangan ----------
CREATE TABLE IF NOT EXISTS room_categories (
  id          serial PRIMARY KEY,
  name        varchar(80) UNIQUE NOT NULL,
  color       varchar(9) NOT NULL DEFAULT '#8FA3A8',
  bookable    boolean NOT NULL DEFAULT true,     -- bisa dipinjam/dijadwalkan event
  schedulable boolean NOT NULL DEFAULT false,    -- dipakai penjadwalan kuliah otomatis
  description text,
  sort        int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS buildings (
  id             serial PRIMARY KEY,
  code           varchar(30) UNIQUE NOT NULL,
  name           varchar(150) NOT NULL,
  address        text,
  latitude       numeric(10,7),
  longitude      numeric(10,7),
  year_built     int,
  floors_count   int,
  building_area  numeric(12,2),      -- luas bangunan m2
  land_area      numeric(12,2),      -- luas tanah m2
  ownership      varchar(60),        -- milik sendiri / sewa / pinjam pakai
  certificate_no varchar(100),       -- no. sertifikat tanah
  permit_no      varchar(100),       -- IMB / PBG
  slf_no         varchar(100),       -- Sertifikat Laik Fungsi
  condition      varchar(20) DEFAULT 'baik',
  acquisition_value numeric(16,2),
  description    text,
  cover_file_id  int REFERENCES attachments(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS floors (
  id                 serial PRIMARY KEY,
  building_id        int NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  level              int NOT NULL,
  name               varchar(60),
  width              numeric(8,2) NOT NULL DEFAULT 60,   -- meter
  height             numeric(8,2) NOT NULL DEFAULT 30,   -- meter
  grid               numeric(5,2) NOT NULL DEFAULT 0.5,  -- snap meter
  background_file_id int REFERENCES attachments(id) ON DELETE SET NULL,
  background_opacity numeric(3,2) NOT NULL DEFAULT 0.35,
  annotations        jsonb NOT NULL DEFAULT '[]',        -- teks/pintu/tangga dekoratif
  UNIQUE(building_id, level)
);

CREATE TABLE IF NOT EXISTS rooms (
  id          serial PRIMARY KEY,
  building_id int NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  floor_id    int NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  code        varchar(40) NOT NULL,
  name        varchar(150) NOT NULL,
  category_id int REFERENCES room_categories(id) ON DELETE SET NULL,
  capacity    int NOT NULL DEFAULT 0,
  area        numeric(10,2),
  shape       jsonb NOT NULL DEFAULT '{}',   -- {type:'rect',x,y,w,h} | {type:'poly',points:[[x,y],..]}
  facilities  text,
  status      varchar(20) NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif','perbaikan','nonaktif')),
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(building_id, code)
);
CREATE INDEX IF NOT EXISTS rooms_floor_idx ON rooms(floor_id);

CREATE TABLE IF NOT EXISTS unit_assignments (
  id          serial PRIMARY KEY,
  unit_id     int NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  building_id int REFERENCES buildings(id) ON DELETE CASCADE,
  room_id     int REFERENCES rooms(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((building_id IS NOT NULL) <> (room_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ua_room_uq ON unit_assignments(unit_id, room_id) WHERE room_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ua_bld_uq  ON unit_assignments(unit_id, building_id) WHERE building_id IS NOT NULL;

-- Pengelola efektif tiap ruangan: penugasan per-ruang mengalahkan penugasan per-gedung
CREATE OR REPLACE VIEW v_room_owner AS
SELECT DISTINCT ON (r.id) r.id AS room_id, ua.unit_id
FROM rooms r
JOIN unit_assignments ua ON ua.room_id = r.id OR (ua.room_id IS NULL AND ua.building_id = r.building_id)
ORDER BY r.id, (ua.room_id IS NULL), ua.id;

-- ---------- Akademik ----------
CREATE TABLE IF NOT EXISTS academic_periods (
  id         serial PRIMARY KEY,
  name       varchar(60) UNIQUE NOT NULL,     -- 2026/2027 Ganjil
  start_date date NOT NULL,
  end_date   date NOT NULL,
  is_active  boolean NOT NULL DEFAULT false,
  CHECK (end_date > start_date)
);

CREATE TABLE IF NOT EXISTS time_slots (     -- sesi/jam pelajaran
  id         serial PRIMARY KEY,
  slot_no    int UNIQUE NOT NULL,
  start_time time NOT NULL,
  end_time   time NOT NULL,
  CHECK (end_time > start_time)
);

CREATE TABLE IF NOT EXISTS courses (
  id             serial PRIMARY KEY,
  code           varchar(30) UNIQUE NOT NULL,
  name           varchar(150) NOT NULL,
  credits        int NOT NULL DEFAULT 2,
  semester_level int,
  unit_id        int REFERENCES units(id) ON DELETE SET NULL,
  tags           text[] NOT NULL DEFAULT '{}',   -- mis. {matematika, praktikum}
  preferred_category_id int REFERENCES room_categories(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS course_classes (    -- kelas paralel per semester
  id                serial PRIMARY KEY,
  period_id         int NOT NULL REFERENCES academic_periods(id) ON DELETE CASCADE,
  unit_id           int NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  course_id         int NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  class_name        varchar(10) NOT NULL DEFAULT 'A',
  student_group     varchar(40),                 -- rombel, mis. TI-3A (tidak boleh bentrok)
  lecturer_id       int REFERENCES people(id) ON DELETE SET NULL,
  student_count     int NOT NULL DEFAULT 30,
  duration_slots    int NOT NULL DEFAULT 2,      -- jumlah sesi berurutan
  sessions_per_week int NOT NULL DEFAULT 1,
  required_category_id int REFERENCES room_categories(id) ON DELETE SET NULL,
  fixed_room_id     int REFERENCES rooms(id) ON DELETE SET NULL,
  note              text,
  UNIQUE(period_id, course_id, class_name)
);

CREATE TABLE IF NOT EXISTS timetable_runs (
  id              serial PRIMARY KEY,
  period_id       int NOT NULL REFERENCES academic_periods(id) ON DELETE CASCADE,
  unit_id         int NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  status          varchar(15) NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','failed','cancelled','published')),
  params          jsonb NOT NULL DEFAULT '{}',
  room_scope      jsonb NOT NULL DEFAULT '{}',
  constraints     jsonb NOT NULL DEFAULT '[]',
  progress        int NOT NULL DEFAULT 0,
  hard_violations int,
  soft_penalty    numeric,
  result          jsonb,
  log             text,
  created_by      int REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  published_at    timestamptz
);

-- ---------- Jadwal & peminjaman ----------
CREATE TABLE IF NOT EXISTS events (
  id          serial PRIMARY KEY,
  room_id     int NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  title       varchar(200) NOT NULL,
  event_type  varchar(30) NOT NULL DEFAULT 'lainnya',   -- kuliah, praktikum, ujian, rapat, seminar, lainnya
  description text,
  start_at    timestamptz NOT NULL,
  end_at      timestamptz NOT NULL,
  unit_id     int REFERENCES units(id) ON DELETE SET NULL,   -- penyelenggara
  lecturer_id int REFERENCES people(id) ON DELETE SET NULL,
  participants int,
  status      varchar(15) NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
  series_id   uuid,
  booking_id  int,
  tt_run_id   int REFERENCES timetable_runs(id) ON DELETE CASCADE,
  tt_class_id int REFERENCES course_classes(id) ON DELETE SET NULL,
  attendance  int,                     -- realisasi peserta (opsional)
  created_by  int REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at),
  CONSTRAINT events_no_overlap EXCLUDE USING gist (room_id WITH =, tstzrange(start_at, end_at) WITH &&) WHERE (status = 'confirmed')
);
CREATE INDEX IF NOT EXISTS events_time_idx ON events(start_at, end_at);

CREATE TABLE IF NOT EXISTS booking_requests (
  id                serial PRIMARY KEY,
  code              varchar(30) UNIQUE NOT NULL,
  room_id           int NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  owner_unit_id     int REFERENCES units(id) ON DELETE SET NULL,
  requester_unit_id int REFERENCES units(id) ON DELETE SET NULL,
  requested_by      int REFERENCES users(id) ON DELETE SET NULL,
  title             varchar(200) NOT NULL,
  purpose           text,
  event_type        varchar(30) NOT NULL DEFAULT 'lainnya',
  participants      int,
  start_at          timestamptz NOT NULL,
  end_at            timestamptz NOT NULL,
  repeat_until      date,                       -- berulang mingguan (opsional)
  status            varchar(15) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  decided_by        int REFERENCES users(id) ON DELETE SET NULL,
  decided_at        timestamptz,
  decision_note     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at)
);

-- ---------- Kodefikasi & aset ----------
CREATE TABLE IF NOT EXISTS asset_codes (
  id          serial PRIMARY KEY,
  code        varchar(30) UNIQUE NOT NULL,     -- 3.10.01.02.001
  name        varchar(200) NOT NULL,
  level       smallint NOT NULL CHECK (level BETWEEN 1 AND 5), -- 1 Golongan,2 Bidang,3 Kelompok,4 Sub Kelompok,5 Sub-sub Kelompok
  parent_id   int REFERENCES asset_codes(id) ON DELETE CASCADE,
  useful_life_years int,                        -- masa manfaat (untuk penyusutan)
  description text
);
CREATE INDEX IF NOT EXISTS asset_codes_parent_idx ON asset_codes(parent_id);

CREATE TABLE IF NOT EXISTS assets (
  id                 serial PRIMARY KEY,
  asset_code_id      int NOT NULL REFERENCES asset_codes(id),
  nup                int NOT NULL,                        -- Nomor Urut Pendaftaran
  tag                varchar(60) UNIQUE NOT NULL,         -- kode aset lengkap (isi QR)
  name               varchar(200) NOT NULL,
  brand              varchar(100),
  model              varchar(100),
  serial_number      varchar(100),
  specification      text,
  acquisition_date   date,
  acquisition_method varchar(30) NOT NULL DEFAULT 'pembelian',  -- pembelian, hibah, transfer, lainnya
  funding_source     varchar(100),
  vendor             varchar(150),
  document_no        varchar(100),                        -- no. faktur/kontrak/BAST
  price              numeric(16,2) NOT NULL DEFAULT 0,
  useful_life_years  int,
  condition          varchar(20) NOT NULL DEFAULT 'baru' CHECK (condition IN ('baru','baik','rusak','diperbaiki','rusak_parah')),
  status             varchar(20) NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif','dihapus')),
  unit_id            int REFERENCES units(id) ON DELETE SET NULL,
  room_id            int REFERENCES rooms(id) ON DELETE SET NULL,
  holder_id          int REFERENCES people(id) ON DELETE SET NULL,
  photo_file_id      int REFERENCES attachments(id) ON DELETE SET NULL,
  notes              text,
  disposed_at        date,
  disposal_ba_id     int,
  created_by         int REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE(asset_code_id, nup)
);
CREATE INDEX IF NOT EXISTS assets_room_idx ON assets(room_id);
CREATE INDEX IF NOT EXISTS assets_holder_idx ON assets(holder_id);

CREATE TABLE IF NOT EXISTS asset_history (       -- Kartu Inventaris / riwayat
  id             serial PRIMARY KEY,
  asset_id       int NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  action         varchar(30) NOT NULL,  -- registrasi, mutasi, kondisi, perbaikan, opname, penghapusan, ubah_data
  from_room_id   int REFERENCES rooms(id) ON DELETE SET NULL,
  to_room_id     int REFERENCES rooms(id) ON DELETE SET NULL,
  from_holder_id int REFERENCES people(id) ON DELETE SET NULL,
  to_holder_id   int REFERENCES people(id) ON DELETE SET NULL,
  from_condition varchar(20),
  to_condition   varchar(20),
  note           text,
  ref_type       varchar(30),
  ref_id         int,
  user_id        int REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS asset_history_asset_idx ON asset_history(asset_id, created_at);

CREATE TABLE IF NOT EXISTS berita_acara (
  id          serial PRIMARY KEY,
  number      varchar(80) UNIQUE NOT NULL,
  ba_type     varchar(30) NOT NULL,  -- stock_opname, mutasi, penghapusan, serah_terima, persediaan, perbaikan, lainnya
  ba_date     date NOT NULL DEFAULT current_date,
  title       varchar(200) NOT NULL,
  unit_id     int REFERENCES units(id) ON DELETE SET NULL,
  content     jsonb NOT NULL DEFAULT '{}',
  signatories jsonb NOT NULL DEFAULT '[]',   -- [{role,name,nip}]
  status      varchar(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','final')),
  ref_type    varchar(30),
  ref_id      int,
  created_by  int REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mutations (
  id             serial PRIMARY KEY,
  number         varchar(80) UNIQUE NOT NULL,
  mutation_date  date NOT NULL DEFAULT current_date,
  mutation_type  varchar(20) NOT NULL,  -- ruang, pemegang, ruang_pemegang, antar_unit
  to_unit_id     int REFERENCES units(id) ON DELETE SET NULL,
  to_room_id     int REFERENCES rooms(id) ON DELETE SET NULL,
  to_holder_id   int REFERENCES people(id) ON DELETE SET NULL,
  reason         text,
  ba_id          int REFERENCES berita_acara(id) ON DELETE SET NULL,
  created_by     int REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mutation_items (
  mutation_id    int NOT NULL REFERENCES mutations(id) ON DELETE CASCADE,
  asset_id       int NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  from_unit_id   int,
  from_room_id   int,
  from_holder_id int,
  PRIMARY KEY (mutation_id, asset_id)
);

CREATE TABLE IF NOT EXISTS maintenance (
  id               serial PRIMARY KEY,
  asset_id         int NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  start_date       date NOT NULL DEFAULT current_date,
  end_date         date,
  description      text NOT NULL,
  vendor           varchar(150),
  cost             numeric(16,2) NOT NULL DEFAULT 0,
  status           varchar(15) NOT NULL DEFAULT 'proses' CHECK (status IN ('proses','selesai','gagal')),
  result_condition varchar(20),
  created_by       int REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_opnames (
  id           serial PRIMARY KEY,
  title        varchar(200) NOT NULL,
  unit_id      int REFERENCES units(id) ON DELETE SET NULL,
  opname_date  date NOT NULL DEFAULT current_date,
  room_ids     int[] NOT NULL DEFAULT '{}',
  status       varchar(15) NOT NULL DEFAULT 'berjalan' CHECK (status IN ('berjalan','selesai')),
  ba_id        int REFERENCES berita_acara(id) ON DELETE SET NULL,
  created_by   int REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz
);
CREATE TABLE IF NOT EXISTS stock_opname_items (
  id               serial PRIMARY KEY,
  opname_id        int NOT NULL REFERENCES stock_opnames(id) ON DELETE CASCADE,
  asset_id         int NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  expected_room_id int,
  found            boolean,                -- null = belum dicek
  found_room_id    int,
  condition_found  varchar(20),
  note             text,
  checked_by       int REFERENCES users(id) ON DELETE SET NULL,
  checked_at       timestamptz,
  UNIQUE(opname_id, asset_id)
);

-- Barang persediaan / habis pakai (disposable)
CREATE TABLE IF NOT EXISTS consumables (
  id            serial PRIMARY KEY,
  code          varchar(40),
  name          varchar(200) NOT NULL,
  uom           varchar(20) NOT NULL DEFAULT 'pcs',
  unit_id       int REFERENCES units(id) ON DELETE CASCADE,
  asset_code_id int REFERENCES asset_codes(id) ON DELETE SET NULL,
  stock         numeric(14,2) NOT NULL DEFAULT 0,
  min_stock     numeric(14,2) NOT NULL DEFAULT 0,
  last_price    numeric(16,2) NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS consumable_tx (
  id            serial PRIMARY KEY,
  consumable_id int NOT NULL REFERENCES consumables(id) ON DELETE CASCADE,
  tx_type       varchar(15) NOT NULL CHECK (tx_type IN ('masuk','keluar','penyesuaian')),
  qty           numeric(14,2) NOT NULL,
  unit_price    numeric(16,2) NOT NULL DEFAULT 0,
  tx_date       date NOT NULL DEFAULT current_date,
  room_id       int REFERENCES rooms(id) ON DELETE SET NULL,
  person_id     int REFERENCES people(id) ON DELETE SET NULL,
  note          text,
  ba_id         int REFERENCES berita_acara(id) ON DELETE SET NULL,
  created_by    int REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------- Masukan publik & kerusakan ----------
CREATE TABLE IF NOT EXISTS room_damages (
  id             serial PRIMARY KEY,
  room_id        int NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  title          varchar(200) NOT NULL,
  description    text,
  severity       varchar(10) NOT NULL DEFAULT 'sedang' CHECK (severity IN ('ringan','sedang','berat')),
  status         varchar(15) NOT NULL DEFAULT 'dilaporkan' CHECK (status IN ('dilaporkan','diproses','selesai','ditolak')),
  asset_id       int REFERENCES assets(id) ON DELETE SET NULL,
  feedback_id    int,
  reported_by    int REFERENCES users(id) ON DELETE SET NULL,
  estimated_cost numeric(16,2),
  actual_cost    numeric(16,2),
  reported_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz,
  resolution     text
);

CREATE TABLE IF NOT EXISTS feedbacks (
  id             serial PRIMARY KEY,
  ticket         varchar(12) UNIQUE NOT NULL,
  room_id        int NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  unit_id        int REFERENCES units(id) ON DELETE SET NULL,
  kind           varchar(15) NOT NULL DEFAULT 'saran' CHECK (kind IN ('saran','keluhan','kerusakan','apresiasi')),
  rating         smallint CHECK (rating BETWEEN 1 AND 5),
  message        text NOT NULL,
  reporter_name  varchar(120),
  reporter_nim   varchar(40),
  reporter_email varchar(150),
  photo_file_id  int REFERENCES attachments(id) ON DELETE SET NULL,
  status         varchar(15) NOT NULL DEFAULT 'baru' CHECK (status IN ('baru','diproses','selesai','ditolak')),
  response       text,
  responded_by   int REFERENCES users(id) ON DELETE SET NULL,
  responded_at   timestamptz,
  damage_id      int REFERENCES room_damages(id) ON DELETE SET NULL,
  ip             varchar(60),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------- Notifikasi & audit ----------
CREATE TABLE IF NOT EXISTS notifications (
  id         serial PRIMARY KEY,
  user_id    int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      varchar(200) NOT NULL,
  body       text,
  link       varchar(200),
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notif_user_idx ON notifications(user_id, read_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id        bigserial PRIMARY KEY,
  user_id   int REFERENCES users(id) ON DELETE SET NULL,
  action    varchar(40) NOT NULL,
  entity    varchar(40) NOT NULL,
  entity_id int,
  data      jsonb,
  at        timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- PENYUSUTAN ASET TETAP (metode garis lurus)
-- Kebijakan diatur di settings.depreciation:
--   period            : 'bulan' | 'semester' | 'tahun'   (periode pengakuan beban)
--   convention        : 'penuh'      = periode perolehan disusutkan penuh
--                       'berikutnya' = mulai disusutkan periode setelah perolehan
--   capitalization_min: harga minimum aset yang disusutkan (di bawahnya = tidak disusutkan)
--   residual_pct      : nilai sisa (% dari harga), umumnya 0
--   excluded_groups   : golongan kode barang yang tidak disusutkan (mis. 1 Persediaan, 2 Tanah, 7 KDP)
-- Masa manfaat: kolom aset -> kode barang terdekat (diwarisi dari induk kodefikasi).
-- Beban diakui untuk periode yang SUDAH BERAKHIR pada tanggal acuan.
-- =====================================================================
CREATE OR REPLACE FUNCTION dep_k(p text) RETURNS int IMMUTABLE LANGUAGE sql AS
$$ SELECT CASE p WHEN 'bulan' THEN 12 WHEN 'semester' THEN 2 ELSE 1 END $$;

CREATE OR REPLACE FUNCTION dep_idx(d date, p text) RETURNS int IMMUTABLE LANGUAGE sql AS
$$ SELECT CASE p WHEN 'bulan' THEN extract(year FROM d)::int * 12 + extract(month FROM d)::int - 1
                 WHEN 'semester' THEN extract(year FROM d)::int * 2 + CASE WHEN extract(month FROM d) > 6 THEN 1 ELSE 0 END
                 ELSE extract(year FROM d)::int END $$;

CREATE OR REPLACE FUNCTION dep_idx_end(i int, p text) RETURNS date IMMUTABLE LANGUAGE sql AS
$$ SELECT CASE p WHEN 'bulan' THEN (make_date(i / 12, i % 12 + 1, 1) + interval '1 month' - interval '1 day')::date
                 WHEN 'semester' THEN CASE WHEN i % 2 = 0 THEN make_date(i / 2, 6, 30) ELSE make_date(i / 2, 12, 31) END
                 ELSE make_date(i, 12, 31) END $$;

-- Akhir periode terakhir yang sudah selesai pada tanggal d
CREATE OR REPLACE FUNCTION dep_last_end(d date, p text) RETURNS date IMMUTABLE LANGUAGE sql AS
$$ SELECT CASE WHEN d = dep_idx_end(dep_idx(d, p), p) THEN d ELSE dep_idx_end(dep_idx(d, p) - 1, p) END $$;

CREATE OR REPLACE FUNCTION dep_cfg() RETURNS jsonb STABLE LANGUAGE sql AS
$$ SELECT COALESCE((SELECT value FROM settings WHERE key = 'depreciation'), '{}'::jsonb) $$;

CREATE OR REPLACE FUNCTION asset_code_life(cid int) RETURNS int STABLE LANGUAGE sql AS
$$ WITH RECURSIVE up AS (
     SELECT id, parent_id, useful_life_years, level FROM asset_codes WHERE id = cid
     UNION ALL SELECT c.id, c.parent_id, c.useful_life_years, c.level FROM asset_codes c JOIN up ON c.id = up.parent_id)
   SELECT useful_life_years FROM up WHERE useful_life_years IS NOT NULL ORDER BY level DESC LIMIT 1 $$;

CREATE OR REPLACE FUNCTION asset_dep(aid int, as_of date DEFAULT current_date)
RETURNS TABLE (life int, periods_total int, periods_elapsed int, per_period numeric, accumulated numeric,
               book_value numeric, depreciable boolean, period_type text, reason text)
STABLE LANGUAGE plpgsql AS $fn$
DECLARE
  r record; cfg jsonb := dep_cfg(); p text; conv text; n int; e int; lf int; base numeric; resid numeric;
  d date; acc numeric; excl text[]; why text;
BEGIN
  SELECT x.price, x.acquisition_date, x.useful_life_years, x.asset_code_id, x.disposed_at, c.code INTO r
    FROM assets x JOIN asset_codes c ON c.id = x.asset_code_id WHERE x.id = aid;
  IF NOT FOUND THEN RETURN; END IF;
  p := COALESCE(cfg->>'period', 'semester');
  conv := COALESCE(cfg->>'convention', 'penuh');
  excl := ARRAY(SELECT jsonb_array_elements_text(COALESCE(cfg->'excluded_groups', '["1","2","7"]'::jsonb)));
  lf := COALESCE(r.useful_life_years, asset_code_life(r.asset_code_id));
  why := CASE
    WHEN split_part(r.code, '.', 1) = ANY (excl) THEN 'Golongan barang tidak disusutkan'
    WHEN r.price < COALESCE(NULLIF(cfg->>'capitalization_min', '')::numeric, 0) THEN 'Di bawah nilai minimum kapitalisasi'
    WHEN lf IS NULL OR lf <= 0 THEN 'Masa manfaat belum diisi'
    WHEN r.acquisition_date IS NULL THEN 'Tanggal perolehan belum diisi'
    ELSE NULL END;
  IF why IS NOT NULL THEN
    RETURN QUERY SELECT lf, 0, 0, 0::numeric, 0::numeric, r.price, false, p, why;
    RETURN;
  END IF;
  d := LEAST(as_of, COALESCE(r.disposed_at, as_of));
  n := lf * dep_k(p);
  resid := round(r.price * COALESCE(NULLIF(cfg->>'residual_pct', '')::numeric, 0) / 100, 2);
  base := r.price - resid;
  e := (dep_idx(d, p) - CASE WHEN d = dep_idx_end(dep_idx(d, p), p) THEN 0 ELSE 1 END)
       - (dep_idx(r.acquisition_date, p) + CASE WHEN conv = 'penuh' THEN 0 ELSE 1 END) + 1;
  e := GREATEST(0, LEAST(n, e));
  acc := CASE WHEN e >= n THEN base ELSE round(base / n * e, 2) END;
  RETURN QUERY SELECT lf, n, e, round(base / n, 2), acc, r.price - acc, true, p,
    CASE WHEN e >= n THEN 'Telah habis disusutkan' ELSE NULL END;
END $fn$;
