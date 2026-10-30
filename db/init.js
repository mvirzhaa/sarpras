// Jalankan: npm run db:init  (membuat skema + data awal, aman dijalankan ulang)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');

const CATEGORIES = [
  ['Ruang Kelas', '#4C8C6B', true, true, 1],
  ['Laboratorium', '#3E6FA8', true, true, 2],
  ['Ruang Rapat', '#B07D2B', true, false, 3],
  ['Aula / Auditorium', '#8A5A9E', true, false, 4],
  ['Ruang Pengelola Unit', '#6E7F86', false, false, 5],
  ['Ruang Dosen', '#5F8F96', false, false, 6],
  ['Perpustakaan', '#9C6B4E', true, false, 7],
  ['Musala', '#3F8F83', false, false, 8],
  ['Gudang', '#8B8B7A', false, false, 9],
  ['Toilet', '#A3B4BA', false, false, 10],
  ['Koridor / Tangga', '#D3DBD8', false, false, 11],
];

// Sesi kuliah (50 menit/sks). Sesuaikan di menu Master > Sesi Kuliah.
const SLOTS = [
  ['07:30', '08:20'], ['08:20', '09:10'], ['09:10', '10:00'], ['10:00', '10:50'],
  ['10:50', '11:40'], ['11:40', '12:30'], ['13:00', '13:50'], ['13:50', '14:40'],
  ['14:40', '15:30'], ['15:30', '16:20'], ['16:20', '17:10'], ['18:30', '19:20'],
  ['19:20', '20:10'], ['20:10', '21:00'],
];

// CONTOH sebagian kodefikasi BMN (5 level). Impor tabel resmi lengkap lewat menu
// Kodefikasi > Impor CSV dan verifikasi terhadap peraturan kodefikasi BMN yang berlaku.
const CODES = [
  ['1', 'Persediaan'], ['2', 'Tanah'], ['3', 'Peralatan dan Mesin'], ['4', 'Gedung dan Bangunan'],
  ['5', 'Jalan, Irigasi dan Jaringan'], ['6', 'Aset Tetap Lainnya'], ['7', 'Konstruksi Dalam Pengerjaan'], ['8', 'Aset Tak Berwujud'],
  ['3.05', 'Alat Kantor dan Rumah Tangga'],
  ['3.05.01', 'Alat Kantor'], ['3.05.02', 'Alat Rumah Tangga'],
  ['3.05.02.01', 'Mebel'],
  ['3.05.02.01.001', 'Meja Kerja (contoh)'], ['3.05.02.01.002', 'Kursi Kerja (contoh)'], ['3.05.02.01.003', 'Lemari (contoh)'],
  ['3.10', 'Komputer'], ['3.10.01', 'Komputer Unit'], ['3.10.01.02', 'Personal Computer'],
  ['3.10.01.02.001', 'P.C Unit'], ['3.10.01.02.002', 'Lap Top'], ['3.10.01.02.003', 'Note Book'],
];

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('✔ Skema dibuat');

  const c = await pool.query('SELECT count(*)::int n FROM users');
  if (c.rows[0].n === 0) {
    const pw = process.env.ADMIN_PASSWORD || 'admin123';
    await pool.query(
      `INSERT INTO users (username,name,role,password_hash,must_change_password) VALUES ($1,'Super Admin','superadmin',$2,true)`,
      [process.env.ADMIN_USERNAME || 'superadmin', await bcrypt.hash(pw, 10)]);
    console.log(`✔ Akun superadmin dibuat (password awal: ${pw}, wajib diganti saat login)`);
  }
  for (const [name, color, bookable, schedulable, sort] of CATEGORIES)
    await pool.query(`INSERT INTO room_categories (name,color,bookable,schedulable,sort) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (name) DO NOTHING`, [name, color, bookable, schedulable, sort]);
  for (let i = 0; i < SLOTS.length; i++)
    await pool.query(`INSERT INTO time_slots (slot_no,start_time,end_time) VALUES ($1,$2,$3) ON CONFLICT (slot_no) DO NOTHING`, [i + 1, ...SLOTS[i]]);
  for (const [code, name] of CODES) {
    const parts = code.split('.');
    const parentCode = parts.slice(0, -1).join('.');
    const parent = parentCode ? (await pool.query('SELECT id FROM asset_codes WHERE code=$1', [parentCode])).rows[0] : null;
    await pool.query(`INSERT INTO asset_codes (code,name,level,parent_id) VALUES ($1,$2,$3,$4) ON CONFLICT (code) DO NOTHING`,
      [code, name, parts.length, parent ? parent.id : null]);
  }
  const defaults = {
    org: { name: 'Universitas Ibn Khaldun Bogor', short: 'UIKA', unit_label: 'Biro Sarana dan Prasarana', city: 'Bogor' },
    operational: { days: [1, 2, 3, 4, 5, 6], start: '07:00', end: '21:00' },
    numbering_code: { value: 'SARPRAS-UIKA' },
    // Kebijakan penyusutan — sesuaikan dengan kebijakan akuntansi/regulasi yang berlaku
    depreciation: { method: 'garis_lurus', period: 'semester', convention: 'penuh', capitalization_min: 0, residual_pct: 0, excluded_groups: ['1', '2', '7'] },
  };
  for (const [k, v] of Object.entries(defaults))
    await pool.query(`INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING`, [k, v]);
  const y = new Date().getFullYear();
  await pool.query(`INSERT INTO academic_periods (name,start_date,end_date,is_active) VALUES ($1,$2,$3,true) ON CONFLICT (name) DO NOTHING`,
    [`${y}/${y + 1} Ganjil`, `${y}-09-01`, `${y + 1}-01-31`]);
  console.log('✔ Data awal siap');
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
