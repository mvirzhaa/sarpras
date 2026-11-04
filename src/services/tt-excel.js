// Impor/ekspor Excel untuk penjadwalan kuliah: Dosen, Mata Kuliah, Kelas, Kendala
const ExcelJS = require('exceljs');
const { pool } = require('../db');

const SHEETS = {
  dosen: { name: 'Dosen', cols: [['id_number', 'NIDN/NIP', 16], ['name', 'Nama Dosen', 34], ['email', 'Email', 28], ['phone', 'Telepon', 16]] },
  mk: { name: 'Mata Kuliah', cols: [['code', 'Kode MK', 11], ['name', 'Nama Mata Kuliah', 40], ['credits', 'SKS', 6], ['semester_level', 'Semester', 10], ['tags', 'Tag', 22], ['category', 'Kategori Ruang', 20]] },
  kelas: { name: 'Kelas', cols: [['course_code', 'Kode MK', 11], ['class_name', 'Kelas', 8], ['student_group', 'Rombel', 10], ['lecturer', 'Dosen (NIDN/Nama)', 30], ['student_count', 'Jumlah Mahasiswa', 12],
    ['duration_slots', 'Durasi (sesi)', 11], ['sessions_per_week', 'Pertemuan/Pekan', 12], ['category', 'Kategori Ruang Wajib', 20], ['fixed_room', 'Kode Ruang Tetap', 15], ['note', 'Catatan', 30]] },
  kendala: { name: 'Kendala', cols: [['type', 'Jenis', 26], ['scope', 'Berlaku Untuk', 14], ['values', 'Nilai', 34], ['days', 'Hari', 22], ['slots', 'Sesi', 10], ['hard', 'Wajib', 8], ['weight', 'Bobot', 8], ['note', 'Keterangan', 34]] },
};
const JENIS = ['Utamakan pagi', 'Utamakan sore', 'Hanya pada', 'Tidak pada', 'Maks kelas dosen per hari', 'Padatkan rombel', 'Sebar pertemuan'];
const SCOPE = ['Semua', 'Tag', 'Mata Kuliah', 'Dosen', 'Rombel'];
const HARI = { senin: 1, selasa: 2, rabu: 3, kamis: 4, jumat: 5, sabtu: 6, minggu: 7 };
const HARI_NAMA = ['', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const list = s => String(s ?? '').split(/[;,\n]/).map(x => x.trim()).filter(Boolean);
const yes = s => ['ya', 'y', 'yes', 'true', '1', 'wajib'].includes(norm(s));
function parseDays(s) {
  const out = new Set();
  for (const part of list(s)) {
    const [a, b] = part.split(/\s*[-–]\s*/).map(x => HARI[norm(x)]);
    if (!a) throw new Error(`hari "${part}" tidak dikenal`);
    if (b) for (let d = a; d <= b; d++) out.add(d); else out.add(a);
  }
  return [...out].sort();
}
function parseSlots(s) {
  const out = new Set();
  for (const part of list(s)) {
    const [a, b] = part.split(/\s*[-–]\s*/).map(Number);
    if (!a) throw new Error(`sesi "${part}" tidak valid`);
    if (b) for (let i = a; i <= b; i++) out.add(i); else out.add(a);
  }
  return [...out].sort((x, y) => x - y);
}

// ---------- Template / contoh ----------
async function buildWorkbook({ unitId, sample }) {
  const cats = (await pool.query('SELECT name FROM room_categories ORDER BY sort, name')).rows.map(r => r.name);
  const rooms = (await pool.query(`SELECT r.code FROM rooms r LEFT JOIN v_room_owner o ON o.room_id=r.id WHERE ($1::int IS NULL OR o.unit_id=$1) ORDER BY r.code`, [unitId || null])).rows.map(r => r.code);
  const wb = new ExcelJS.Workbook(); wb.creator = 'SARPRAS';
  const F = { name: 'Arial', size: 10 };
  const head = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
  const fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF146B4E' } };

  const pt = wb.addWorksheet('Petunjuk', { properties: { tabColor: { argb: 'FF146B4E' } } });
  pt.getColumn(1).width = 24; pt.getColumn(2).width = 100;
  const lines = [
    ['IMPOR DATA PENJADWALAN KULIAH — SARPRAS', ''],
    ['', ''],
    ['Cara pakai', 'Isi sheet Dosen, Mata Kuliah, Kelas, dan (opsional) Kendala mulai baris 2. Jangan ubah judul kolom di baris 1. Sheet Referensi berisi daftar pilihan dan tidak perlu diubah.'],
    ['', 'Unggah lewat menu Penjadwalan kuliah › 1. Kelas & dosen › Impor Excel. Sistem menampilkan pratinjau dan daftar kesalahan sebelum data disimpan.'],
    ['', 'Data yang sudah ada diperbarui (dosen dicocokkan lewat NIDN/NIP atau nama, mata kuliah lewat kode, kelas lewat kode MK + nama kelas pada periode yang dipilih).'],
    ['', ''],
    ['Sheet Dosen', 'NIDN/NIP disarankan diisi agar pencocokan akurat. Contoh: 0401018801 | Dr. Ahmad Fauzi, M.Kom'],
    ['Sheet Mata Kuliah', 'Tag dipisah titik koma, dipakai pada kendala (mis. matematika;dasar). Kategori ruang = kategori yang disukai. Contoh: IF101 | Kalkulus I | 3 | 1 | matematika | Ruang Kelas'],
    ['Sheet Kelas', 'Satu baris = satu kelas paralel. Rombel tidak boleh bentrok satu sama lain. Durasi = jumlah sesi berurutan (umumnya = SKS; praktikum 1 SKS = 3 sesi). Dosen boleh berupa NIDN atau nama persis; dosen baru dibuat otomatis.'],
    ['', 'Contoh: IF101 | A | TI-1A | 0401018801 | 40 | 3 | 1 | Ruang Kelas |  | '],
    ['Sheet Kendala', 'Jenis: ' + JENIS.join(', ') + '. Berlaku untuk: ' + SCOPE.join(', ') + '.'],
    ['', 'Nilai: daftar tag / kode MK / NIDN atau nama dosen / rombel, dipisah titik koma. Untuk "Maks kelas dosen per hari", isi angka maksimum.'],
    ['', 'Hari: Senin;Rabu atau rentang Senin-Rabu. Sesi: nomor sesi seperti 6 atau 1-4 atau 1-4;12-14 (lihat menu Sesi kuliah). Wajib: Ya = harus dipenuhi; Tidak = preferensi berbobot.'],
    ['', 'Contoh: Tidak pada | Semua |  | Jumat | 6 | Ya | 100 | Salat Jumat'],
    ['', ''],
    ['Warna', 'Baris judul hijau = jangan diubah. Sel putih = diisi. Kolom dengan panah tarik-turun memiliki daftar pilihan.'],
  ];
  lines.forEach((l, i) => { const r = pt.addRow(l); r.font = F; if (i === 0) r.font = { name: 'Arial', size: 13, bold: true, color: { argb: 'FF146B4E' } }; else if (l[0]) r.getCell(1).font = { ...F, bold: true }; r.getCell(2).alignment = { wrapText: true, vertical: 'top' }; });

  const ref = wb.addWorksheet('Referensi');
  const refCols = [['Kategori Ruang', cats], ['Hari', HARI_NAMA.slice(1)], ['Ya/Tidak', ['Ya', 'Tidak']], ['Jenis Kendala', JENIS], ['Berlaku Untuk', SCOPE], ['Kode Ruang', rooms]];
  refCols.forEach(([h, vals], i) => { ref.getCell(1, i + 1).value = h; ref.getCell(1, i + 1).font = { ...F, bold: true }; vals.forEach((v, j) => { ref.getCell(j + 2, i + 1).value = v; }); ref.getColumn(i + 1).width = 26; });
  const rng = (i, n) => `Referensi!$${String.fromCharCode(65 + i)}$2:$${String.fromCharCode(65 + i)}$${Math.max(2, n + 1)}`;

  const data = sample ? require('../../db/sample-tt') : null;
  const sheets = {};
  for (const [k, spec] of Object.entries(SHEETS)) {
    const ws = wb.addWorksheet(spec.name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = spec.cols.map(([key, label, w]) => ({ header: label, key, width: w, style: { font: F } }));
    ws.getRow(1).eachCell(c => { c.font = head; c.fill = fill; c.alignment = { vertical: 'middle', wrapText: true }; });
    ws.getRow(1).height = 30;
    if (data && data[k]) data[k].forEach(row => ws.addRow(row));
    sheets[k] = ws;
  }
  const dv = (ws, col, formula, rows = 400) => { for (let r = 2; r <= rows; r++) ws.getCell(`${col}${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [formula] }; };
  dv(sheets.mk, 'F', rng(0, cats.length));
  dv(sheets.kelas, 'H', rng(0, cats.length));
  if (rooms.length) dv(sheets.kelas, 'I', rng(5, rooms.length));
  dv(sheets.kendala, 'A', rng(3, JENIS.length), 100); dv(sheets.kendala, 'B', rng(4, SCOPE.length), 100); dv(sheets.kendala, 'F', rng(2, 2), 100);
  for (const c of ['E', 'F', 'G']) for (let r = 2; r <= 400; r++) sheets.kelas.getCell(`${c}${r}`).dataValidation = { type: 'whole', allowBlank: true, operator: 'between', formulae: [1, 500], showErrorMessage: true, error: 'Isi bilangan bulat' };
  wb.worksheets.forEach((w, i) => { if (w.name === 'Referensi') w.state = 'hidden'; });
  // urutan tab: Petunjuk, Dosen, Mata Kuliah, Kelas, Kendala, Referensi(tersembunyi)
  return wb;
}

// ---------- Baca berkas ----------
async function parseWorkbook(buf) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf); } catch { throw new Error('Berkas bukan Excel .xlsx yang valid'); }
  const out = { warnings: [] };
  for (const [k, spec] of Object.entries(SHEETS)) {
    out[k] = [];
    const ws = wb.worksheets.find(w => norm(w.name) === norm(spec.name));
    if (!ws) { if (k === 'kelas') throw new Error('Sheet "Kelas" tidak ditemukan. Gunakan template dari sistem.'); continue; }
    let headRow = 0, map = {};
    for (let r = 1; r <= Math.min(5, ws.rowCount); r++) {
      const m = {};
      ws.getRow(r).eachCell((c, ci) => { const h = norm(c.text); const col = spec.cols.find(([key, label]) => norm(label) === h || norm(key) === h); if (col) m[col[0]] = ci; });
      if (Object.keys(m).length >= 2) { headRow = r; map = m; break; }
    }
    if (!headRow) { out.warnings.push(`Sheet ${spec.name}: judul kolom tidak dikenali, sheet dilewati`); continue; }
    for (let r = headRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r), o = { _row: r }; let any = false;
      for (const [key, ci] of Object.entries(map)) { const v = String(row.getCell(ci).text ?? '').trim(); if (v) { any = true; o[key] = v; } }
      if (any) out[k].push(o);
    }
  }
  return out;
}

// ---------- Simpan ke basis data (dry run = rollback) ----------
async function importData({ periodId, unitId, data, dryRun }) {
  const c = await pool.connect();
  const q = async (t, p) => (await c.query(t, p)).rows;
  const S = { dosen: { created: 0, updated: 0 }, mk: { created: 0, updated: 0 }, kelas: { created: 0, updated: 0 }, constraints: [], errors: [], warnings: [...(data.warnings || [])], preview: [] };
  const attempt = async (label, fn) => {
    await c.query('SAVEPOINT row_sp');
    try { await fn(); await c.query('RELEASE SAVEPOINT row_sp'); } catch (e) { await c.query('ROLLBACK TO SAVEPOINT row_sp'); S.errors.push(`${label}: ${e.message.replace(/^.*duplicate key.*$/, 'data duplikat')}`); }
  };
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL TIME ZONE 'Asia/Jakarta'`);
    const cats = new Map((await q('SELECT id, name FROM room_categories')).map(x => [norm(x.name), x.id]));
    const catId = (name, label) => { if (!name) return null; const id = cats.get(norm(name)); if (!id) throw new Error(`kategori ruang "${name}" tidak ada (${label})`); return id; };
    const findLect = async v => {
      const s = String(v).trim();
      return (await q(`SELECT id FROM people WHERE id_number=$1 OR lower(name)=lower($1) ORDER BY (id_number=$1) DESC LIMIT 1`, [s]))[0];
    };
    // Dosen
    for (const x of data.dosen) await attempt(`Dosen baris ${x._row}`, async () => {
      if (!x.name) throw new Error('nama dosen kosong');
      const ex = x.id_number ? (await q('SELECT id FROM people WHERE id_number=$1', [x.id_number]))[0] : (await q('SELECT id FROM people WHERE lower(name)=lower($1) LIMIT 1', [x.name]))[0];
      if (ex) { await q(`UPDATE people SET name=$2, email=COALESCE($3,email), phone=COALESCE($4,phone), kind='dosen' WHERE id=$1`, [ex.id, x.name, x.email || null, x.phone || null]); S.dosen.updated++; }
      else { await q(`INSERT INTO people (id_number,name,email,phone,kind,unit_id) VALUES ($1,$2,$3,$4,'dosen',$5)`, [x.id_number || null, x.name, x.email || null, x.phone || null, unitId]); S.dosen.created++; }
    });
    // Mata kuliah
    for (const x of data.mk) await attempt(`Mata Kuliah baris ${x._row}`, async () => {
      if (!x.code || !x.name) throw new Error('kode dan nama MK wajib');
      const r = await q(`INSERT INTO courses (code,name,credits,semester_level,unit_id,tags,preferred_category_id) VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, credits=EXCLUDED.credits, semester_level=COALESCE(EXCLUDED.semester_level,courses.semester_level),
          tags=EXCLUDED.tags, preferred_category_id=COALESCE(EXCLUDED.preferred_category_id,courses.preferred_category_id), unit_id=COALESCE(courses.unit_id,EXCLUDED.unit_id)
        RETURNING (xmax = 0) inserted`,
      [x.code.trim(), x.name, Number(x.credits) || 2, Number(x.semester_level) || null, unitId, list(x.tags).map(t => t.toLowerCase()), catId(x.category, 'Mata Kuliah')]);
      r[0].inserted ? S.mk.created++ : S.mk.updated++;
    });
    // Kelas
    for (const x of data.kelas) await attempt(`Kelas baris ${x._row}`, async () => {
      if (!x.course_code) throw new Error('kode MK kosong');
      const course = (await q('SELECT id, credits, name FROM courses WHERE code=$1', [x.course_code.trim()]))[0];
      if (!course) throw new Error(`MK ${x.course_code} belum terdaftar (isi di sheet Mata Kuliah)`);
      let lect = null;
      if (x.lecturer) {
        lect = await findLect(x.lecturer);
        if (!lect) { lect = (await q(`INSERT INTO people (name,kind,unit_id) VALUES ($1,'dosen',$2) RETURNING id`, [x.lecturer.trim(), unitId]))[0]; S.warnings.push(`Kelas baris ${x._row}: dosen "${x.lecturer}" belum ada, dibuat otomatis`); }
      }
      let room = null;
      if (x.fixed_room) {
        room = (await q(`SELECT r.id FROM rooms r LEFT JOIN v_room_owner o ON o.room_id=r.id WHERE lower(r.code)=lower($1) ORDER BY (o.unit_id=$2) DESC NULLS LAST LIMIT 1`, [x.fixed_room.trim(), unitId]))[0];
        if (!room) throw new Error(`ruang ${x.fixed_room} tidak ditemukan`);
      }
      const dur = Number(x.duration_slots) || course.credits || 2;
      const r = await q(`INSERT INTO course_classes (period_id,unit_id,course_id,class_name,student_group,lecturer_id,student_count,duration_slots,sessions_per_week,required_category_id,fixed_room_id,note)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (period_id,course_id,class_name) DO UPDATE SET student_group=EXCLUDED.student_group, lecturer_id=EXCLUDED.lecturer_id, student_count=EXCLUDED.student_count,
          duration_slots=EXCLUDED.duration_slots, sessions_per_week=EXCLUDED.sessions_per_week, required_category_id=EXCLUDED.required_category_id,
          fixed_room_id=EXCLUDED.fixed_room_id, note=EXCLUDED.note RETURNING (xmax = 0) inserted`,
      [periodId, unitId, course.id, (x.class_name || 'A').trim(), x.student_group || null, lect && lect.id, Number(x.student_count) || 30, dur,
        Number(x.sessions_per_week) || 1, catId(x.category, 'Kelas'), room && room.id, x.note || null]);
      r[0].inserted ? S.kelas.created++ : S.kelas.updated++;
      if (S.preview.length < 8) S.preview.push({ row: x._row, course: `${x.course_code} ${course.name}`, class_name: x.class_name || 'A', group: x.student_group || '', lecturer: x.lecturer || '', size: Number(x.student_count) || 30, dur });
    });
    // Kendala
    const TYPE = { utamakanpagi: { type: 'time', mode: 'early', weight: 30 }, utamakansore: { type: 'time', mode: 'late', weight: 30 }, hanyapada: { type: 'time', mode: 'only', weight: 50 },
      tidakpada: { type: 'time', mode: 'avoid', weight: 50 }, makskelasdosenperhari: { type: 'lecturer_max_daily', weight: 15 }, padatkanrombel: { type: 'group_compact', weight: 3 }, sebarpertemuan: { type: 'spread_sessions', weight: 10 } };
    const SC = { semua: 'all', tag: 'tags', matakuliah: 'courses', dosen: 'lecturer', rombel: 'groups' };
    for (const x of data.kendala) await attempt(`Kendala baris ${x._row}`, async () => {
      const t = TYPE[norm(x.type)];
      if (!t) throw new Error(`jenis "${x.type || ''}" tidak dikenal`);
      const con = { type: t.type, weight: Number(x.weight) || t.weight };
      if (t.type === 'lecturer_max_daily') con.max = Number(x.values) || 3;
      if (t.type === 'time') {
        con.mode = t.mode;
        const kind = SC[norm(x.scope || 'semua')];
        if (!kind) throw new Error(`"Berlaku untuk" = "${x.scope}" tidak dikenal`);
        let values = list(x.values);
        if (kind !== 'all' && !values.length) throw new Error('kolom Nilai wajib diisi');
        if (kind === 'courses') values = await Promise.all(values.map(async v => { const r = (await q('SELECT id FROM courses WHERE code=$1', [v]))[0]; if (!r) throw new Error(`MK ${v} tidak ada`); return r.id; }));
        if (kind === 'lecturer') values = await Promise.all(values.map(async v => { const r = await findLect(v); if (!r) throw new Error(`dosen ${v} tidak ada`); return r.id; }));
        if (kind === 'tags') values = values.map(v => v.toLowerCase());
        con.scope = { kind, values: kind === 'all' ? [] : values };
        con.days = x.days ? parseDays(x.days) : [];
        con.slots = x.slots ? parseSlots(x.slots) : [];
        con.hard = ['only', 'avoid'].includes(t.mode) && yes(x.hard);
        if (['only', 'avoid'].includes(t.mode) && !con.days.length && !con.slots.length) throw new Error('isi Hari dan/atau Sesi');
      }
      if (x.note) con.note = x.note;
      S.constraints.push(con);
    });
    if (dryRun) await c.query('ROLLBACK'); else await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  return S;
}

module.exports = { buildWorkbook, parseWorkbook, importData, SHEETS, JENIS, SCOPE };
