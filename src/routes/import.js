// Impor data master dari Excel (.xlsx) / CSV, beserta template unduhan.
//   GET  /api/import/:entity/template          -> template kosong (+ petunjuk, contoh, referensi)
//   GET  /api/import/:entity/template?data=1   -> template berisi data saat ini (untuk diedit massal)
//   POST /api/import/:entity  (multipart: file) -> impor; semua baris valid atau tidak ada yang disimpan
// Baris dengan kunci yang sudah ada (kode/username/nama/...) diperbarui, selebihnya ditambahkan.
const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const bcrypt = require('bcryptjs');
const { Readable } = require('stream');
const { db, tx } = require('../db');
const { ah, fail, audit } = require('../util');
const { isSA } = require('../auth');

const r = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const MAX_ROWS = 5000;

// ---------------- Konversi nilai sel ----------------
class RowError extends Error {}
const bad = msg => { throw new RowError(msg); };
const pad = n => String(n).padStart(2, '0');
function cellText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(t => t.text).join('');
    if (v.text !== undefined) return cellText(v.text);           // hyperlink
    if (v.result !== undefined) return cellText(v.result);       // rumus
    if (v.error) return '';
    return String(v);
  }
  return v;
}
const str = v => (v instanceof Date ? v.toISOString() : String(v)).trim();
const YES = ['ya', 'y', 'yes', 'true', '1', 'aktif', 'v', '✓'], NO = ['tidak', 't', 'no', 'n', 'false', '0', 'nonaktif', '-', '–'];
const T = {
  text: (v, c) => { const s = str(v); if (c.max && s.length > c.max) bad(`maksimal ${c.max} karakter`); return s; },
  int: v => { const n = typeof v === 'number' ? v : Number(str(v).replace(',', '.')); if (!Number.isInteger(n)) bad('harus bilangan bulat'); return n; },
  bool: v => { const s = str(v).toLowerCase(); if (YES.includes(s)) return true; if (NO.includes(s)) return false; bad('isi Ya atau Tidak'); },
  date: v => {
    if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
    if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 86400000)); return T.date(d); } // nomor seri Excel
    const s = str(v); let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return check(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) return check(+m[3], +m[2], +m[1]); // DD/MM/YYYY
    bad('format tanggal YYYY-MM-DD atau DD/MM/YYYY');
    function check(y, mo, d) { const x = new Date(Date.UTC(y, mo - 1, d)); if (x.getUTCMonth() !== mo - 1 || x.getUTCDate() !== d) bad('tanggal tidak valid'); return `${y}-${pad(mo)}-${pad(d)}`; }
  },
  time: v => {
    let h, mi;
    if (v instanceof Date) { h = v.getUTCHours(); mi = v.getUTCMinutes() + (v.getUTCSeconds() >= 30 ? 1 : 0); }
    else if (typeof v === 'number' && v >= 0 && v < 1) { const t = Math.round(v * 1440); h = Math.floor(t / 60); mi = t % 60; }
    else { const m = str(v).match(/^(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?$/); if (!m) bad('format jam HH:MM, mis. 07:30'); h = +m[1]; mi = +m[2]; }
    if (mi === 60) { h++; mi = 0; }
    if (h > 23 || mi > 59) bad('jam tidak valid');
    return `${pad(h)}:${pad(mi)}`;
  },
  color: v => { const s = str(v); if (!/^#[0-9a-f]{6}$/i.test(s)) bad('format warna #RRGGBB, mis. #4C8C6B'); return s.toUpperCase(); },
  email: v => { const s = str(v); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) bad('email tidak valid'); return s; },
  list: v => str(v).split(/[;,]/).map(s => s.trim()).filter(Boolean),
};
const enumOf = (c, v) => {
  const s = str(v).toLowerCase();
  const hit = c.options.find(([k, label]) => k === s || label.toLowerCase() === s);
  if (!hit) bad(`pilih salah satu: ${c.options.map(o => o[1]).join(', ')}`);
  return hit[0];
};
const norm = s => String(s || '').toLowerCase().replace(/\*/g, '').replace(/\(.*?\)/g, '').trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

// ---------------- Definisi tiap menu ----------------
// Kolom: key, header, type (text|int|bool|date|time|color|email|list|enum), required, max, options (enum), note, width
const KIND = [['dosen', 'Dosen'], ['tendik', 'Tenaga kependidikan'], ['mahasiswa', 'Mahasiswa'], ['lainnya', 'Lainnya']];
const ROLE = [['superadmin', 'Super Admin'], ['unit_admin', 'Admin unit'], ['pimpinan', 'Pimpinan']];
const unitByCode = (ctx, code) => { const u = ctx.units.get(String(code).toUpperCase()); if (!u) bad(`kode unit "${code}" tidak terdaftar (lihat sheet Referensi)`); return u; };
// Admin unit hanya boleh mengisi/menimpa data unitnya sendiri
const scopedUnit = (ctx, code) => {
  if (isSA(ctx.user)) return code ? unitByCode(ctx, code).id : null;
  if (code && unitByCode(ctx, code).id !== ctx.user.unit_id) bad(`hanya boleh unit Anda sendiri (${ctx.user.unit_code})`);
  return ctx.user.unit_id;
};
const ownGuard = (ctx, row) => { if (!isSA(ctx.user) && row && row.unit_id && row.unit_id !== ctx.user.unit_id) bad('data ini milik unit lain dan tidak dapat diubah'); };
const loadUnits = async c => new Map((await c.q('SELECT id, code, name FROM units')).map(u => [u.code.toUpperCase(), u]));
const loadCats = async c => new Map((await c.q('SELECT id, name FROM room_categories')).map(k => [k.name.toLowerCase(), k]));

const ENTITIES = {
  units: {
    title: 'Unit pengelola', file: 'unit-pengelola', write: ['superadmin'], key: 'code',
    columns: [
      { key: 'code', header: 'Kode unit', required: true, max: 20, note: 'Huruf/angka tanpa spasi, mis. FT, FEB, BAAK. Kode yang sudah ada akan diperbarui. Username admin otomatis: admin.<kode>', width: 14 },
      { key: 'name', header: 'Nama unit', required: true, max: 150, width: 34 },
      { key: 'head_name', header: 'Nama pimpinan', max: 150, width: 30 },
      { key: 'head_nip', header: 'NIP pimpinan', max: 40, width: 22, note: 'Ketik sebagai teks agar angka 0 di depan tidak hilang' },
      { key: 'email', header: 'Email', type: 'email', max: 150, width: 28 },
      { key: 'phone', header: 'Telepon', max: 40, width: 16 },
      { key: 'buildings', header: 'Gedung dikelola', type: 'list', width: 24, note: 'Kode gedung, pisahkan dengan koma. Penugasan ditambahkan, penugasan lama tidak dihapus' },
      { key: 'description', header: 'Keterangan', width: 30 },
    ],
    examples: [
      { code: 'FT', name: 'Fakultas Teknik', head_name: 'Dr. Ir. Ahmad Fauzi, M.T.', head_nip: '197805122005011002', email: 'ft@uika-bogor.ac.id', phone: '0251-8356884' },
      { code: 'FEB', name: 'Fakultas Ekonomi dan Bisnis', head_name: 'Dr. Siti Aminah, S.E., M.M.', email: 'feb@uika-bogor.ac.id' },
      { code: 'BAAK', name: 'Biro Administrasi Akademik dan Kemahasiswaan' },
    ],
    refs: async c => ({ 'Kode gedung': (await c.q('SELECT code, name FROM buildings ORDER BY code')).map(b => [b.code, b.name]) }),
    rows: c => c.q(`SELECT u.code, u.name, u.head_name, u.head_nip, u.email, u.phone, u.description,
      (SELECT string_agg(b.code, ', ' ORDER BY b.code) FROM unit_assignments a JOIN buildings b ON b.id=a.building_id WHERE a.unit_id=u.id) buildings FROM units u ORDER BY u.code`),
    async prepare(c, ctx) { ctx.blds = new Map((await c.q('SELECT id, code FROM buildings')).map(b => [b.code.toUpperCase(), b.id])); },
    async save(c, d, ctx) {
      d.code = d.code.toUpperCase();
      if (!/^[A-Z0-9._-]+$/.test(d.code)) bad('kode unit hanya huruf, angka, titik, minus, garis bawah');
      const bIds = (d.buildings || []).map(k => ctx.blds.get(k.toUpperCase()) || bad(`kode gedung "${k}" tidak ditemukan`));
      const ex = await c.one('SELECT id FROM units WHERE upper(code)=$1', [d.code]);
      const f = [d.name, d.head_name, d.head_nip, d.email, d.phone, d.description];
      let id, op;
      if (ex) { await c.query('UPDATE units SET name=$2, head_name=$3, head_nip=$4, email=$5, phone=$6, description=$7 WHERE id=$1', [ex.id, ...f]); id = ex.id; op = 'update'; }
      else {
        id = (await c.one('INSERT INTO units (code,name,head_name,head_nip,email,phone,description) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [d.code, ...f])).id;
        const username = 'admin.' + d.code.toLowerCase().replace(/[^a-z0-9]+/g, '');
        if (await c.one('SELECT 1 FROM users WHERE lower(username)=$1', [username])) bad(`username ${username} sudah dipakai akun lain`);
        await c.query(`INSERT INTO users (username,name,role,unit_id,is_unit_primary,active) VALUES ($1,$2,'unit_admin',$3,true,false)`, [username, 'Admin ' + d.name, id]);
        op = 'insert';
      }
      for (const b of bIds) await c.query('INSERT INTO unit_assignments (unit_id,building_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, b]);
      return op;
    },
  },

  users: {
    title: 'Pengguna', file: 'pengguna', write: ['superadmin'], key: 'username',
    columns: [
      { key: 'username', header: 'Username', required: true, max: 60, width: 20, note: 'Username yang sudah ada akan diperbarui' },
      { key: 'name', header: 'Nama', max: 150, width: 30 },
      { key: 'email', header: 'Email', type: 'email', max: 150, width: 28 },
      { key: 'phone', header: 'Telepon', max: 40, width: 16 },
      { key: 'role', header: 'Peran', type: 'enum', options: ROLE, required: true, width: 16 },
      { key: 'unit', header: 'Kode unit', width: 12, note: 'Wajib untuk Admin unit' },
      { key: 'password', header: 'Password', width: 16, note: 'Wajib untuk akun baru (min. 8 karakter). Kosongkan bila tidak diubah. Pengguna wajib mengganti saat pertama masuk' },
      { key: 'active', header: 'Aktif', type: 'bool', width: 9, note: 'Ya / Tidak (kosong = Ya)' },
    ],
    examples: [
      { username: 'operator.ft', name: 'Rina Marlina', email: 'rina@uika-bogor.ac.id', role: 'Admin unit', unit: 'FT', password: 'GantiSegera123', active: 'Ya' },
      { username: 'warek2', name: 'Wakil Rektor II', role: 'Pimpinan', password: 'GantiSegera123', active: 'Ya' },
    ],
    refs: async c => ({ 'Kode unit': (await c.q('SELECT code, name FROM units ORDER BY code')).map(u => [u.code, u.name]) }),
    rows: c => c.q(`SELECT u.username, u.name, u.email, u.phone, CASE u.role WHEN 'superadmin' THEN 'Super Admin' WHEN 'unit_admin' THEN 'Admin unit' ELSE 'Pimpinan' END role,
      un.code unit, NULL password, CASE WHEN u.active THEN 'Ya' ELSE 'Tidak' END active FROM users u LEFT JOIN units un ON un.id=u.unit_id ORDER BY u.role, un.code, u.username`),
    async prepare(c, ctx) { ctx.units = await loadUnits(c); },
    async save(c, d, ctx) {
      if (!/^[A-Za-z0-9._-]+$/.test(d.username)) bad('username hanya huruf, angka, titik, minus, garis bawah');
      const unitId = d.unit ? unitByCode(ctx, d.unit).id : null;
      if (d.role === 'unit_admin' && !unitId) bad('Admin unit wajib diisi kode unitnya');
      if (d.password !== undefined && String(d.password).length < 8) bad('password minimal 8 karakter');
      const ex = await c.one('SELECT id, is_unit_primary, unit_id FROM users WHERE lower(username)=lower($1)', [d.username]);
      const active = d.active === undefined ? true : d.active;
      if (ex && ex.id === ctx.user.id && (!active || d.role !== 'superadmin')) bad('tidak dapat menonaktifkan atau menurunkan peran akun Anda sendiri');
      if (ex && ex.is_unit_primary && (d.role !== 'unit_admin' || unitId !== ex.unit_id)) bad('akun admin utama unit tidak boleh dipindah unit/peran');
      const hash = d.password !== undefined ? await bcrypt.hash(String(d.password), 10) : null;
      if (ex) {
        await c.query(`UPDATE users SET name=$2, email=$3, phone=$4, role=$5, unit_id=$6, active=$7,
          password_hash=COALESCE($8,password_hash), must_change_password=CASE WHEN $8::text IS NULL THEN must_change_password ELSE true END WHERE id=$1`,
        [ex.id, d.name, d.email, d.phone, d.role, unitId, active, hash]);
        return 'update';
      }
      if (!hash) bad('password wajib diisi untuk akun baru');
      await c.query(`INSERT INTO users (username,name,email,phone,role,unit_id,active,password_hash,must_change_password) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)`,
        [d.username, d.name, d.email, d.phone, d.role, unitId, active, hash]);
      return 'insert';
    },
  },

  categories: {
    title: 'Kategori ruang', file: 'kategori-ruang', write: ['superadmin'], key: 'name', ref: 'categories',
    columns: [
      { key: 'name', header: 'Nama kategori', required: true, max: 80, width: 26, note: 'Nama yang sudah ada akan diperbarui' },
      { key: 'color', header: 'Warna', type: 'color', width: 11, note: 'Kode warna denah #RRGGBB (kosong = #8FA3A8)' },
      { key: 'bookable', header: 'Dapat dipinjam', type: 'bool', width: 15, note: 'Ya / Tidak (kosong = Ya)' },
      { key: 'schedulable', header: 'Penjadwalan kuliah', type: 'bool', width: 19, note: 'Ya bila ruang dipakai algoritma penjadwalan (kosong = Tidak)' },
      { key: 'sort', header: 'Urutan', type: 'int', width: 9 },
      { key: 'description', header: 'Keterangan', width: 30 },
    ],
    examples: [
      { name: 'Studio Gambar', color: '#7A6FB0', bookable: 'Ya', schedulable: 'Ya', sort: 12, description: 'Ruang praktik gambar teknik' },
      { name: 'Ruang Server', color: '#55606E', bookable: 'Tidak', schedulable: 'Tidak', sort: 13 },
    ],
    rows: c => c.q(`SELECT name, color, CASE WHEN bookable THEN 'Ya' ELSE 'Tidak' END bookable, CASE WHEN schedulable THEN 'Ya' ELSE 'Tidak' END schedulable, sort, description FROM room_categories ORDER BY sort, name`),
    async save(c, d) {
      const ex = await c.one('SELECT id FROM room_categories WHERE lower(name)=lower($1)', [d.name]);
      const v = [d.name, d.color || '#8FA3A8', d.bookable ?? true, d.schedulable ?? false, d.sort ?? 0, d.description];
      if (ex) { await c.query('UPDATE room_categories SET name=$2, color=$3, bookable=$4, schedulable=$5, sort=$6, description=$7 WHERE id=$1', [ex.id, ...v]); return 'update'; }
      await c.query('INSERT INTO room_categories (name,color,bookable,schedulable,sort,description) VALUES ($1,$2,$3,$4,$5,$6)', v);
      return 'insert';
    },
  },

  people: {
    title: 'Dosen & pegawai', file: 'dosen-pegawai', write: ['superadmin', 'unit_admin'], key: 'id_number', ref: 'people',
    columns: [
      { key: 'id_number', header: 'NIP/NIDN/NIK', max: 40, width: 22, note: 'Kunci pencocokan: NIP/NIDN yang sudah ada akan diperbarui. Bila kosong, dicocokkan dengan nama. Ketik sebagai teks' },
      { key: 'name', header: 'Nama lengkap', required: true, max: 150, width: 34 },
      { key: 'kind', header: 'Jenis', type: 'enum', options: KIND, width: 20, note: 'Kosong = Dosen' },
      { key: 'unit', header: 'Kode unit', width: 12, note: 'Untuk Admin unit: kosong = unit Anda' },
      { key: 'position', header: 'Jabatan', max: 100, width: 22 },
      { key: 'email', header: 'Email', type: 'email', max: 150, width: 28 },
      { key: 'phone', header: 'Telepon', max: 40, width: 16 },
      { key: 'active', header: 'Aktif', type: 'bool', width: 9, note: 'Ya / Tidak (kosong = Ya)' },
    ],
    examples: [
      { id_number: '0412078501', name: 'Dr. Hendra Gunawan, M.Kom.', kind: 'Dosen', unit: 'FT', position: 'Lektor Kepala', email: 'hendra@uika-bogor.ac.id', active: 'Ya' },
      { id_number: '198903152019032011', name: 'Rina Marlina, S.Kom.', kind: 'Tenaga kependidikan', unit: 'FT', position: 'Staf Tata Usaha', active: 'Ya' },
    ],
    refs: async c => ({ 'Kode unit': (await c.q('SELECT code, name FROM units ORDER BY code')).map(u => [u.code, u.name]) }),
    rows: (c, ctx) => c.q(`SELECT p.id_number, p.name, CASE p.kind ${KIND.map(([k, l]) => `WHEN '${k}' THEN '${l}'`).join(' ')} END kind, u.code unit, p.position, p.email, p.phone,
      CASE WHEN p.active THEN 'Ya' ELSE 'Tidak' END active FROM people p LEFT JOIN units u ON u.id=p.unit_id WHERE $1::int IS NULL OR p.unit_id=$1 ORDER BY p.name`, [isSA(ctx.user) ? null : ctx.user.unit_id]),
    async prepare(c, ctx) { ctx.units = await loadUnits(c); },
    async save(c, d, ctx) {
      const unitId = scopedUnit(ctx, d.unit);
      const ex = d.id_number
        ? await c.one('SELECT id, unit_id FROM people WHERE id_number=$1', [d.id_number])
        : await c.one(`SELECT id, unit_id FROM people WHERE lower(name)=lower($1) AND COALESCE(id_number,'')='' ORDER BY id LIMIT 1`, [d.name]);
      ownGuard(ctx, ex);
      const v = [d.id_number || null, d.name, d.kind || 'dosen', unitId, d.position, d.email, d.phone, d.active ?? true];
      if (ex) { await c.query('UPDATE people SET id_number=$2, name=$3, kind=$4, unit_id=$5, position=$6, email=$7, phone=$8, active=$9 WHERE id=$1', [ex.id, ...v]); return 'update'; }
      await c.query('INSERT INTO people (id_number,name,kind,unit_id,position,email,phone,active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', v);
      return 'insert';
    },
  },

  courses: {
    title: 'Mata kuliah', file: 'mata-kuliah', write: ['superadmin', 'unit_admin'], key: 'code',
    columns: [
      { key: 'code', header: 'Kode MK', required: true, max: 30, width: 14, note: 'Kode yang sudah ada akan diperbarui' },
      { key: 'name', header: 'Nama MK', required: true, max: 150, width: 36 },
      { key: 'credits', header: 'SKS', type: 'int', width: 7, note: 'Kosong = 2' },
      { key: 'semester_level', header: 'Semester', type: 'int', width: 10 },
      { key: 'unit', header: 'Kode unit', width: 12, note: 'Unit/prodi pengampu. Untuk Admin unit: kosong = unit Anda' },
      { key: 'tags', header: 'Tag', type: 'list', width: 22, note: 'Pisahkan dengan koma, mis. matematika, praktikum. Dipakai di kendala penjadwalan' },
      { key: 'category', header: 'Kategori ruang disukai', width: 24, note: 'Nama kategori ruang (lihat sheet Referensi)' },
    ],
    examples: [
      { code: 'TIF101', name: 'Kalkulus I', credits: 3, semester_level: 1, unit: 'FT', tags: 'matematika', category: 'Ruang Kelas' },
      { code: 'TIF103', name: 'Praktikum Algoritma dan Pemrograman', credits: 1, semester_level: 1, unit: 'FT', tags: 'praktikum', category: 'Laboratorium' },
    ],
    refs: async c => ({ 'Kode unit': (await c.q('SELECT code, name FROM units ORDER BY code')).map(u => [u.code, u.name]),
      'Kategori ruang': (await c.q('SELECT name, CASE WHEN schedulable THEN \'dipakai penjadwalan\' ELSE \'\' END k FROM room_categories ORDER BY sort, name')).map(k => [k.name, k.k]) }),
    rows: (c, ctx) => c.q(`SELECT t.code, t.name, t.credits, t.semester_level, u.code unit, array_to_string(t.tags, ', ') tags, k.name category
      FROM courses t LEFT JOIN units u ON u.id=t.unit_id LEFT JOIN room_categories k ON k.id=t.preferred_category_id WHERE $1::int IS NULL OR t.unit_id=$1 ORDER BY t.code`, [isSA(ctx.user) ? null : ctx.user.unit_id]),
    async prepare(c, ctx) { ctx.units = await loadUnits(c); ctx.cats = await loadCats(c); },
    async save(c, d, ctx) {
      const unitId = scopedUnit(ctx, d.unit);
      let cat = null;
      if (d.category) { cat = ctx.cats.get(d.category.toLowerCase()); if (!cat) bad(`kategori ruang "${d.category}" tidak ditemukan`); }
      if (d.credits !== undefined && (d.credits < 0 || d.credits > 24)) bad('SKS tidak wajar (0–24)');
      const ex = await c.one('SELECT id, unit_id FROM courses WHERE code=$1', [d.code]);
      ownGuard(ctx, ex);
      const v = [d.code, d.name, d.credits ?? 2, d.semester_level ?? null, unitId, (d.tags || []).map(t => t.toLowerCase()), cat && cat.id];
      if (ex) { await c.query('UPDATE courses SET code=$2, name=$3, credits=$4, semester_level=$5, unit_id=$6, tags=$7, preferred_category_id=$8 WHERE id=$1', [ex.id, ...v]); return 'update'; }
      await c.query('INSERT INTO courses (code,name,credits,semester_level,unit_id,tags,preferred_category_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', v);
      return 'insert';
    },
  },

  periods: {
    title: 'Periode akademik', file: 'periode-akademik', write: ['superadmin'], key: 'name', ref: 'periods',
    columns: [
      { key: 'name', header: 'Nama periode', required: true, max: 60, width: 24, note: 'mis. 2026/2027 Genap. Nama yang sudah ada akan diperbarui' },
      { key: 'start_date', header: 'Mulai perkuliahan', type: 'date', required: true, width: 18, note: 'Tanggal, mis. 2027-02-15 atau 15/02/2027' },
      { key: 'end_date', header: 'Akhir perkuliahan', type: 'date', required: true, width: 18 },
      { key: 'is_active', header: 'Aktif', type: 'bool', width: 9, note: 'Hanya satu periode boleh Ya; periode lain otomatis dinonaktifkan' },
    ],
    examples: [
      { name: '2026/2027 Ganjil', start_date: '2026-09-01', end_date: '2027-01-31', is_active: 'Ya' },
      { name: '2026/2027 Genap', start_date: '2027-02-15', end_date: '2027-07-15', is_active: 'Tidak' },
    ],
    rows: c => c.q(`SELECT name, start_date, end_date, CASE WHEN is_active THEN 'Ya' ELSE 'Tidak' END is_active FROM academic_periods ORDER BY start_date`),
    async save(c, d, ctx) {
      if (d.end_date <= d.start_date) bad('akhir perkuliahan harus setelah tanggal mulai');
      if (d.is_active) { if (ctx.activeSeen) bad(`hanya satu periode boleh aktif (sudah ada di baris ${ctx.activeSeen})`); ctx.activeSeen = ctx.rowNo; }
      const ex = await c.one('SELECT id FROM academic_periods WHERE lower(name)=lower($1)', [d.name]);
      const v = [d.name, d.start_date, d.end_date, d.is_active ?? false];
      let id;
      if (ex) { await c.query('UPDATE academic_periods SET name=$2, start_date=$3, end_date=$4, is_active=$5 WHERE id=$1', [ex.id, ...v]); id = ex.id; }
      else id = (await c.one('INSERT INTO academic_periods (name,start_date,end_date,is_active) VALUES ($1,$2,$3,$4) RETURNING id', v)).id;
      if (d.is_active) await c.query('UPDATE academic_periods SET is_active=false WHERE id<>$1', [id]);
      return ex ? 'update' : 'insert';
    },
  },

  slots: {
    title: 'Sesi kuliah', file: 'sesi-kuliah', write: ['superadmin'], key: 'slot_no', ref: 'slots',
    columns: [
      { key: 'slot_no', header: 'Sesi ke', type: 'int', required: true, width: 9, note: 'Nomor sesi yang sudah ada akan diperbarui' },
      { key: 'start_time', header: 'Jam mulai', type: 'time', required: true, width: 12, note: 'HH:MM, mis. 07:30' },
      { key: 'end_time', header: 'Jam selesai', type: 'time', required: true, width: 12 },
    ],
    examples: [{ slot_no: 1, start_time: '07:30', end_time: '08:20' }, { slot_no: 2, start_time: '08:20', end_time: '09:10' }, { slot_no: 3, start_time: '09:10', end_time: '10:00' }],
    rows: c => c.q(`SELECT slot_no, to_char(start_time,'HH24:MI') start_time, to_char(end_time,'HH24:MI') end_time FROM time_slots ORDER BY slot_no`),
    async save(c, d) {
      if (d.slot_no < 1 || d.slot_no > 30) bad('nomor sesi 1–30');
      if (d.end_time <= d.start_time) bad('jam selesai harus setelah jam mulai');
      const ex = await c.one('SELECT id FROM time_slots WHERE slot_no=$1', [d.slot_no]);
      if (ex) { await c.query('UPDATE time_slots SET start_time=$2, end_time=$3 WHERE id=$1', [ex.id, d.start_time, d.end_time]); return 'update'; }
      await c.query('INSERT INTO time_slots (slot_no,start_time,end_time) VALUES ($1,$2,$3)', [d.slot_no, d.start_time, d.end_time]);
      return 'insert';
    },
  },
};

function entityFor(req) {
  const E = ENTITIES[req.params.entity];
  if (!E) fail(404, 'Jenis data impor tidak dikenal');
  if (!E.write.includes(req.user.role)) fail(403, 'Anda tidak punya akses untuk mengimpor data ini');
  return E;
}

// ---------------- Template ----------------
const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F5F4A' } };
const REQ_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB5462F' } };
const fmtHint = c => ({ int: 'Bilangan bulat', bool: 'Ya / Tidak', date: 'Tanggal (YYYY-MM-DD atau DD/MM/YYYY)', time: 'Jam (HH:MM)', color: 'Warna #RRGGBB', email: 'Alamat email', list: 'Daftar, pisahkan koma', enum: 'Pilihan: ' + (c.options || []).map(o => o[1]).join(' / ') }[c.type] || 'Teks' + (c.max ? ` (maks. ${c.max} karakter)` : ''));
const display = (c, v) => {
  if (v === null || v === undefined) return null;
  if (c.type === 'enum') { const o = c.options.find(x => x[0] === v || x[1] === v); return o ? o[1] : v; }
  if (c.type === 'int') return Number(v);
  return String(v);
};
function dataSheet(wb, E, rows, name = 'Data') {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = E.columns.map(c => ({ header: c.header + (c.required ? ' *' : ''), key: c.key, width: c.width || 18,
    style: { numFmt: '@' } }));                     // semua kolom teks: NIP, kode, jam tidak diubah Excel
  const h = ws.getRow(1); h.height = 22;
  E.columns.forEach((c, i) => {
    const cell = h.getCell(i + 1);
    cell.fill = c.required ? REQ_FILL : HEAD_FILL; cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.alignment = { vertical: 'middle' };
    cell.note = { texts: [{ text: `${c.required ? 'WAJIB. ' : ''}${fmtHint(c)}${c.note ? '. ' + c.note : ''}` }] };
  });
  for (const row of rows) ws.addRow(Object.fromEntries(E.columns.map(c => [c.key, display(c, row[c.key])])));
  // Daftar pilihan (dropdown) untuk kolom Ya/Tidak dan pilihan tetap
  const last = Math.max(rows.length + 1, 500);
  E.columns.forEach((c, i) => {
    const list = c.type === 'bool' ? ['Ya', 'Tidak'] : c.type === 'enum' ? c.options.map(o => o[1]) : null;
    if (!list) return;
    const col = ws.getColumn(i + 1).letter;
    for (let n = 2; n <= last; n++) ws.getCell(`${col}${n}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${list.join(',')}"`], showErrorMessage: true, errorTitle: 'Isian tidak valid', error: 'Pilih dari daftar' };
  });
  return ws;
}
r.get('/import/:entity/template', ah(async (req, res) => {
  const E = entityFor(req), ctx = { user: req.user };
  const wb = new ExcelJS.Workbook(); wb.creator = 'SARPRAS'; wb.created = new Date();
  dataSheet(wb, E, req.query.data ? await E.rows(db, ctx) : []);
  const p = wb.addWorksheet('Petunjuk');
  p.columns = [{ width: 26 }, { width: 10 }, { width: 38 }, { width: 70 }];
  p.addRow([`Template impor: ${E.title}`]).font = { bold: true, size: 14 };
  p.addRow(['1. Isi sheet "Data" mulai baris 2. Jangan ubah judul kolom di baris 1. Kolom bertanda * (merah) wajib diisi.']);
  p.addRow(['2. Data yang kuncinya sudah ada (kolom pertama) akan DIPERBARUI; selebihnya DITAMBAHKAN. Tidak ada data yang dihapus.']);
  p.addRow(['3. Impor bersifat utuh: bila ada satu baris salah, tidak ada yang disimpan dan semua kesalahan ditampilkan per baris.']);
  p.addRow(['4. Lihat sheet "Contoh" untuk contoh pengisian dan "Referensi" untuk kode yang valid. Simpan sebagai .xlsx (atau .csv).']);
  p.addRow([]);
  const hr = p.addRow(['Kolom', 'Wajib', 'Format', 'Keterangan']); hr.font = { bold: true, color: { argb: 'FFFFFFFF' } }; hr.eachCell(c => (c.fill = HEAD_FILL));
  for (const c of E.columns) p.addRow([c.header, c.required ? 'Ya' : '', fmtHint(c), c.note || '']).alignment = { wrapText: true, vertical: 'top' };
  dataSheet(wb, E, E.examples, 'Contoh');
  if (E.refs) {
    const refs = await E.refs(db), ws = wb.addWorksheet('Referensi'); let col = 1;
    for (const [title, list] of Object.entries(refs)) {
      ws.getColumn(col).width = 18; ws.getColumn(col + 1).width = 40;
      const t = ws.getCell(1, col); t.value = title; t.font = { bold: true };
      list.forEach(([a, b], i) => { ws.getCell(i + 2, col).value = a; ws.getCell(i + 2, col + 1).value = b; });
      if (!list.length) ws.getCell(2, col).value = '(belum ada data)';
      col += 3;
    }
  }
  const fname = `${req.query.data ? 'data' : 'template'}-${E.file}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
  await wb.xlsx.write(res); res.end();
}));

// ---------------- Impor ----------------
async function readRows(file) {
  const wb = new ExcelJS.Workbook();
  const name = (file.originalname || '').toLowerCase();
  if (name.endsWith('.csv') || file.mimetype === 'text/csv') {
    const text = file.buffer.toString('utf8').replace(/^﻿/, '');
    const first = text.split(/\r?\n/)[0] || '';
    const delimiter = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
    await wb.csv.read(Readable.from([text]), { parserOptions: { delimiter }, map: v => v }); // tanpa konversi otomatis
  } else if (name.endsWith('.xlsx') || /spreadsheetml/.test(file.mimetype)) {
    try { await wb.xlsx.load(file.buffer); } catch { fail(400, 'Berkas Excel tidak dapat dibaca. Pastikan formatnya .xlsx (bukan .xls lama)'); }
  } else fail(400, 'Format berkas harus .xlsx atau .csv');
  const ws = wb.getWorksheet('Data') || wb.worksheets.find(w => w.state !== 'hidden' && !['Petunjuk', 'Contoh', 'Referensi'].includes(w.name));
  if (!ws) fail(400, 'Sheet "Data" tidak ditemukan');
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => rows.push({ n, cells: row.values.slice(1).map(cellText) }));
  return rows;
}
r.post('/import/:entity', upload.single('file'), ah(async (req, res) => {
  const E = entityFor(req);
  if (!req.file) fail(400, 'Pilih berkas Excel/CSV terlebih dahulu');
  const raw = await readRows(req.file);
  if (!raw.length) fail(400, 'Berkas kosong');
  // Petakan judul kolom -> definisi kolom (toleran terhadap huruf besar/kecil, tanda *, urutan)
  const alias = new Map(); E.columns.forEach(c => { alias.set(norm(c.header), c); alias.set(norm(c.key), c); });
  const head = raw[0].cells.map(h => alias.get(norm(h)) || null);
  const missing = E.columns.filter(c => c.required && !head.includes(c));
  if (missing.length) fail(400, `Kolom wajib tidak ditemukan di baris 1: ${missing.map(c => c.header).join(', ')}. Gunakan template terbaru.`);
  const body = raw.slice(1).filter(x => x.cells.some(v => str(v ?? '') !== ''));
  if (!body.length) fail(400, 'Belum ada data di bawah judul kolom');
  if (body.length > MAX_ROWS) fail(400, `Maksimal ${MAX_ROWS} baris per impor`);

  const errors = [], seen = new Map(); let inserted = 0, updated = 0;
  const ctx = { user: req.user };
  try {
    await tx(async c => {
      if (E.prepare) await E.prepare(c, ctx);
      for (const { n, cells } of body) {
        ctx.rowNo = n;
        const d = {}, rowErr = [];
        head.forEach((col, i) => {
          if (!col) return;
          let v = cells[i]; if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return;
          try { d[col.key] = col.type === 'enum' ? enumOf(col, v) : (T[col.type || 'text'])(v, col); } catch (e) { rowErr.push(`${col.header}: ${e.message}`); }
        });
        for (const col of E.columns) if (col.required && (d[col.key] === undefined || d[col.key] === '') && !rowErr.some(m => m.startsWith(col.header))) rowErr.push(`${col.header} wajib diisi`);
        if (!rowErr.length) {
          const k = String(d[E.key] ?? '').toLowerCase();
          if (k && seen.has(k)) rowErr.push(`duplikat dengan baris ${seen.get(k)} (${E.columns.find(x => x.key === E.key).header} sama)`); else if (k) seen.set(k, n);
        }
        if (rowErr.length) { errors.push({ row: n, message: rowErr.join('; ') }); continue; }
        await c.query('SAVEPOINT r');
        try {
          const op = await E.save(c, d, ctx);
          op === 'insert' ? inserted++ : updated++;
          await c.query('RELEASE SAVEPOINT r');
        } catch (e) {
          await c.query('ROLLBACK TO SAVEPOINT r');
          if (!(e instanceof RowError) && !e.code) throw e;
          errors.push({ row: n, message: e.code === '23505' ? 'data duplikat: ' + (e.detail || '') : e.code ? `isian tidak valid (${e.message})` : e.message });
        }
      }
      if (errors.length) throw Object.assign(new Error('rollback'), { rollback: true });
      await audit(c, req.user, 'import', req.params.entity, null, { file: req.file.originalname, inserted, updated });
    });
  } catch (e) { if (!e.rollback) throw e; }
  if (errors.length) return res.status(422).json({ ok: false, total: body.length, errors, error: `${errors.length} baris bermasalah. Tidak ada data yang disimpan.` });
  res.json({ ok: true, total: body.length, inserted, updated });
}));

module.exports = r;
module.exports.ENTITIES = ENTITIES;
