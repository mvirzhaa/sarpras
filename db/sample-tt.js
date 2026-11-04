// Contoh data penjadwalan kuliah — Program Studi Teknik Informatika, semester ganjil.
// SEMUA NAMA DAN NIDN FIKTIF. Nomor sesi mengacu sesi bawaan (14 sesi @50 menit, mulai 07.30):
// sesi 6 = 11.40–12.30 (beririsan salat Jumat), sesi 12–14 = 18.30–21.00 (kelas karyawan/malam).
const dosen = [
  ['0401018801', 'Dr. Ahmad Fauzi, M.Kom'], ['0412078502', 'Rina Marlina, M.T.'], ['0423058903', 'Budi Santoso, M.Kom'],
  ['0405129004', 'Dewi Lestari, M.Si.'], ['0417038705', 'Hendra Gunawan, M.Kom'], ['0428119106', 'Siti Nurhaliza, M.Kom'],
  ['0409068607', 'Dr. Agus Salim, M.T.'], ['0414029208', 'Yuliana Putri, M.Cs.'], ['0420108409', 'Irfan Hakim, M.Kom'],
  ['0402059310', 'Nurul Hidayah, M.Pd.'], ['0411128811', 'Rizky Pratama, M.Kom'], ['0425079012', 'Fitri Handayani, M.Si.'],
  ['0407048613', 'Dedi Kurniawan, M.T.'], ['0418099114', 'Anisa Rahmawati, M.Kom'], ['0430018915', 'H. Mahmud Yunus, M.Ag.'],
  ['0413069216', 'Teguh Wibowo, M.Kom'], ['0424128717', 'Lina Kartika, M.Hum.'], ['0406039418', 'Fajar Ramadhan, M.Kom'],
].map(([id_number, name]) => ({ id_number, name, email: name.split(',')[0].replace(/^(Dr\.|H\.)\s*/, '').toLowerCase().replace(/[^a-z ]/g, '').trim().replace(/\s+/g, '.') + '@contoh.ac.id', phone: '' }));

// [kode, nama, sks, semester, tag, kategori, dosen]
const MK = [
  ['IF101', 'Kalkulus I', 3, 1, 'matematika', 'Ruang Kelas', '0405129004'],
  ['IF102', 'Algoritma dan Pemrograman I', 3, 1, 'pemrograman', 'Ruang Kelas', '0423058903'],
  ['IF103', 'Praktikum Algoritma dan Pemrograman I', 1, 1, 'praktikum', 'Laboratorium', '0406039418'],
  ['IF104', 'Pengantar Teknologi Informasi', 2, 1, '', 'Ruang Kelas', '0411128811'],
  ['IF105', 'Logika Informatika', 3, 1, 'matematika', 'Ruang Kelas', '0425079012'],
  ['UK101', 'Pendidikan Agama Islam I', 2, 1, 'mkdu', 'Ruang Kelas', '0430018915'],
  ['UK102', 'Bahasa Inggris I', 2, 1, 'mkdu', 'Ruang Kelas', '0424128717'],
  ['IF201', 'Struktur Data', 3, 3, 'pemrograman', 'Ruang Kelas', '0423058903'],
  ['IF202', 'Basis Data', 3, 3, '', 'Ruang Kelas', '0428119106'],
  ['IF203', 'Praktikum Basis Data', 1, 3, 'praktikum', 'Laboratorium', '0418099114'],
  ['IF204', 'Matematika Diskrit', 3, 3, 'matematika', 'Ruang Kelas', '0425079012'],
  ['IF205', 'Statistika dan Probabilitas', 3, 3, 'matematika', 'Ruang Kelas', '0405129004'],
  ['IF206', 'Pemrograman Berorientasi Objek', 3, 3, 'pemrograman', 'Ruang Kelas', '0417038705'],
  ['IF207', 'Sistem Operasi', 3, 3, '', 'Ruang Kelas', '0407048613'],
  ['IF301', 'Rekayasa Perangkat Lunak', 3, 5, '', 'Ruang Kelas', '0401018801'],
  ['IF302', 'Kecerdasan Buatan', 3, 5, '', 'Ruang Kelas', '0409068607'],
  ['IF303', 'Jaringan Komputer', 3, 5, '', 'Ruang Kelas', '0407048613'],
  ['IF304', 'Praktikum Jaringan Komputer', 1, 5, 'praktikum', 'Laboratorium', '0413069216'],
  ['IF305', 'Pemrograman Web', 3, 5, 'pemrograman', 'Laboratorium', '0420108409'],
  ['IF306', 'Riset Operasi', 3, 5, 'matematika', 'Ruang Kelas', '0412078502'],
  ['IF307', 'Interaksi Manusia dan Komputer', 2, 5, '', 'Ruang Kelas', '0414029208'],
  ['IF401', 'Metodologi Penelitian', 2, 7, '', 'Ruang Kelas', '0401018801'],
  ['IF402', 'Keamanan Informasi', 3, 7, '', 'Ruang Kelas', '0413069216'],
  ['IF403', 'Komputasi Awan', 3, 7, '', 'Ruang Kelas', '0420108409'],
  ['IF404', 'Pembelajaran Mesin', 3, 7, 'matematika', 'Ruang Kelas', '0409068607'],
  ['UK401', 'Kewirausahaan', 2, 7, 'mkdu', 'Ruang Kelas', '0402059310'],
];
const mk = MK.map(([code, name, credits, semester_level, tags, category]) => ({ code, name, credits, semester_level, tags, category }));

// Rombel per semester: [nama kelas, rombel, jumlah mahasiswa]
const ROMBEL = { 1: [['A', 'TI-1A', 40], ['B', 'TI-1B', 38]], 3: [['A', 'TI-3A', 40], ['B', 'TI-3B', 36]], 5: [['A', 'TI-5A', 38], ['B', 'TI-5B', 35]], 7: [['A', 'TI-7A', 35]] };
const ALT = { IF101: '0412078502', IF102: '0406039418', IF201: '0411128811', IF202: '0418099114', IF206: '0428119106', IF303: '0413069216' }; // dosen kelas B
const kelas = [];
for (const [code, , sks, sem, , category, lect] of MK) {
  for (const [cls, group, size] of ROMBEL[sem]) {
    const prak = category === 'Laboratorium' && sks === 1;
    kelas.push({ course_code: code, class_name: cls, student_group: group, lecturer: cls === 'B' && ALT[code] ? ALT[code] : lect, student_count: size,
      duration_slots: prak ? 3 : sks, sessions_per_week: 1, category: category === 'Laboratorium' ? 'Laboratorium' : '', fixed_room: '', note: prak ? '1 SKS praktikum = 3 sesi' : '' });
  }
}
// Kelas karyawan (malam) semester 3
for (const [code, lect] of [['IF201', '0423058903'], ['IF202', '0428119106'], ['IF204', '0425079012'], ['IF206', '0417038705']])
  kelas.push({ course_code: code, class_name: 'K', student_group: 'TI-3K', lecturer: lect, student_count: 24, duration_slots: 3, sessions_per_week: 1, category: '', fixed_room: '', note: 'Kelas karyawan' });

const kendala = [
  { type: 'Tidak pada', scope: 'Semua', values: '', days: 'Jumat', slots: '6', hard: 'Ya', weight: 100, note: 'Salat Jumat (11.40–13.00)' },
  { type: 'Hanya pada', scope: 'Rombel', values: 'TI-3K', days: 'Senin-Jumat', slots: '12-14', hard: 'Ya', weight: 100, note: 'Kelas karyawan hanya malam hari kerja' },
  { type: 'Tidak pada', scope: 'Rombel', values: 'TI-1A;TI-1B;TI-3A;TI-3B;TI-5A;TI-5B;TI-7A', days: '', slots: '12-14', hard: 'Ya', weight: 100, note: 'Kelas reguler tidak malam' },
  { type: 'Tidak pada', scope: 'Rombel', values: 'TI-1A;TI-1B;TI-3A;TI-3B;TI-5A;TI-5B;TI-7A', days: 'Sabtu', slots: '', hard: 'Tidak', weight: 40, note: 'Sabtu dihindari untuk kelas reguler' },
  { type: 'Utamakan pagi', scope: 'Tag', values: 'matematika', days: '', slots: '', hard: '', weight: 30, note: 'MK matematika di jam awal' },
  { type: 'Hanya pada', scope: 'Dosen', values: '0401018801', days: 'Senin-Rabu', slots: '', hard: 'Ya', weight: 50, note: 'Dosen dengan tugas struktural' },
  { type: 'Tidak pada', scope: 'Dosen', values: '0409068607', days: 'Kamis', slots: '1-4', hard: 'Tidak', weight: 40, note: 'Rapat rutin fakultas' },
  { type: 'Hanya pada', scope: 'Dosen', values: '0430018915', days: 'Selasa;Kamis', slots: '', hard: 'Ya', weight: 50, note: 'Dosen MKDU (homebase prodi lain)' },
  { type: 'Maks kelas dosen per hari', scope: '', values: '3', days: '', slots: '', hard: '', weight: 15, note: '' },
  { type: 'Padatkan rombel', scope: '', values: '', days: '', slots: '', hard: '', weight: 3, note: 'Minim jam kosong mahasiswa' },
  { type: 'Sebar pertemuan', scope: '', values: '', days: '', slots: '', hard: '', weight: 10, note: '' },
];

module.exports = { dosen, mk, kelas, kendala };

// Contoh gedung untuk uji coba (dipakai db/demo.js): [lantai, kode, nama, kategori, kapasitas, x, y, w, h] — satuan meter
module.exports.building = { code: 'GFT', name: 'Gedung Fakultas Teknik (contoh)', floors: 2, width: 48, height: 20 };
module.exports.rooms = [
  [1, 'GFT-101', 'Ruang Kelas 101', 'Ruang Kelas', 45, 0, 0, 8, 8], [1, 'GFT-102', 'Ruang Kelas 102', 'Ruang Kelas', 45, 8, 0, 8, 8],
  [1, 'GFT-103', 'Ruang Kelas 103', 'Ruang Kelas', 40, 16, 0, 8, 8], [1, 'GFT-104', 'Ruang Kelas 104', 'Ruang Kelas', 40, 24, 0, 8, 8],
  [1, 'GFT-105', 'Lab Komputer 1', 'Laboratorium', 40, 32, 0, 8, 8], [1, 'GFT-106', 'Lab Komputer 2', 'Laboratorium', 40, 40, 0, 8, 8],
  [1, 'GFT-1K', 'Koridor Lantai 1', 'Koridor / Tangga', 0, 0, 8, 48, 3],
  [1, 'GFT-107', 'Ruang Prodi Teknik Informatika', 'Ruang Pengelola Unit', 8, 0, 11, 10, 9], [1, 'GFT-108', 'Ruang Dosen', 'Ruang Dosen', 16, 10, 11, 12, 9],
  [1, 'GFT-109', 'Ruang Rapat', 'Ruang Rapat', 20, 22, 11, 10, 9], [1, 'GFT-110', 'Toilet', 'Toilet', 0, 32, 11, 6, 9], [1, 'GFT-1T', 'Tangga', 'Koridor / Tangga', 0, 38, 11, 10, 9],
  [2, 'GFT-201', 'Ruang Kelas 201', 'Ruang Kelas', 50, 0, 0, 10, 8], [2, 'GFT-202', 'Ruang Kelas 202', 'Ruang Kelas', 45, 10, 0, 8, 8],
  [2, 'GFT-203', 'Ruang Kelas 203', 'Ruang Kelas', 45, 18, 0, 8, 8], [2, 'GFT-204', 'Ruang Kelas 204', 'Ruang Kelas', 40, 26, 0, 8, 8],
  [2, 'GFT-205', 'Lab Jaringan', 'Laboratorium', 30, 34, 0, 14, 8], [2, 'GFT-2K', 'Koridor Lantai 2', 'Koridor / Tangga', 0, 0, 8, 48, 3],
  [2, 'GFT-206', 'Ruang Kelas 206', 'Ruang Kelas', 40, 0, 11, 10, 9], [2, 'GFT-207', 'Aula Mini', 'Aula / Auditorium', 80, 10, 11, 22, 9],
  [2, 'GFT-208', 'Toilet', 'Toilet', 0, 32, 11, 6, 9], [2, 'GFT-2T', 'Tangga', 'Koridor / Tangga', 0, 38, 11, 10, 9],
];
