// Menyiapkan Fakultas Agama Islam (FAI) + 4 program studi + periode Genap 2026/2027, lalu (opsional) mengimpor kelas kuliah.
//   node db/seed-fai.js                 → hanya membuat unit, sub unit, akun admin, dan periode (aman dijalankan ulang)
//   node db/seed-fai.js --impor         → ditambah mengimpor db/data/Impor_Kelas_FAI_Genap_2026-2027.xlsx (kelas tanpa jadwal)
//   node db/seed-fai.js --impor berkas.xlsx
require('dotenv').config();
const path = require('path'), bcrypt = require('bcryptjs'), ExcelJS = require('exceljs');
const { pool } = require('../src/db');
const ttx = require('../src/services/tt-excel');

const PRODI = [['PAI', 'Program Studi Pendidikan Agama Islam'], ['HKI', 'Program Studi Hukum Keluarga Islam'], ['IAT', "Program Studi Ilmu Al-Qur'an dan Tafsir"], ['BKPI', 'Program Studi Bimbingan dan Konseling Pendidikan Islam']];
const PERIOD = ['2026/2027 Genap', '2027-02-01', '2027-06-30'];

(async () => {
  const q = async (t, p) => (await pool.query(t, p)).rows;
  let unit = (await q(`SELECT id FROM units WHERE code='FAI'`))[0];
  if (!unit) {
    unit = (await q(`INSERT INTO units (code,name,head_name) VALUES ('FAI','Fakultas Agama Islam','Dekan Fakultas Agama Islam') RETURNING id`))[0];
    await q(`INSERT INTO users (username,name,role,unit_id,is_unit_primary,active,password_hash,must_change_password) VALUES ('admin.fai','Admin Fakultas Agama Islam','unit_admin',$1,true,true,$2,true)`, [unit.id, await bcrypt.hash('adminfai123', 10)]);
    console.log('✔ Unit FAI + akun admin.fai / adminfai123 (wajib ganti saat masuk pertama)');
  }
  const subs = {};
  for (const [code, name] of PRODI) {
    let sb = (await q('SELECT id FROM sub_units WHERE unit_id=$1 AND code=$2', [unit.id, code]))[0];
    if (!sb) {
      sb = (await q(`INSERT INTO sub_units (unit_id,code,name,kind) VALUES ($1,$2,$3,'prodi') RETURNING id`, [unit.id, code, name]))[0];
      await q(`INSERT INTO users (username,name,role,unit_id,sub_unit_id,is_sub_primary,active,password_hash,must_change_password) VALUES ($1,$2,'unit_admin',$3,$4,true,true,$5,true)`,
        [`admin.fai.${code.toLowerCase()}`, 'Admin ' + name, unit.id, sb.id, await bcrypt.hash(`admin${code.toLowerCase()}123`, 10)]);
      console.log(`✔ Sub unit ${code} + akun admin.fai.${code.toLowerCase()} / admin${code.toLowerCase()}123`);
    }
    subs[code] = sb.id;
  }
  let per = (await q('SELECT id FROM academic_periods WHERE name=$1', [PERIOD[0]]))[0];
  if (!per) { per = (await q(`INSERT INTO academic_periods (name,start_date,end_date,is_active) VALUES ($1,$2,$3,false) RETURNING id`, PERIOD))[0]; console.log(`✔ Periode ${PERIOD[0]} dibuat (belum aktif; aktifkan lewat menu Periode)`); }

  const i = process.argv.indexOf('--impor');
  if (i > 0) {
    const file = process.argv[i + 1] || path.join(__dirname, 'data', 'Impor_Kelas_FAI_Genap_2026-2027.xlsx');
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
    const data = await ttx.parseWorkbook(await wb.xlsx.writeBuffer());
    const r = await ttx.importData({ periodId: per.id, unitId: unit.id, subUnitId: null, data, dryRun: false });
    console.log(`✔ Impor: dosen +${r.dosen.created}, MK +${r.mk.created}, kelas +${r.kelas.created} (diperbarui ${r.kelas.updated})`);
    r.warnings.slice(0, 10).forEach(w => console.log('  ⚠', w)); r.errors.slice(0, 20).forEach(e => console.log('  ✖', e));
  }
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
