// Basis pengetahuan Rendra: panduan fitur SARPRAS.
// keywords: kata/frasa pemicu (huruf kecil). roles: peran yang boleh melakukan (kosong = semua yang login).
// answer: teks singkat; boleh memakai **tebal**, daftar "- ", dan tautan [teks](#/rute).
module.exports = [
  {
    id: 'gedung', title: 'Menambah gedung', roles: ['superadmin'],
    keywords: ['tambah gedung', 'daftarkan gedung', 'gedung baru', 'input gedung', 'data gedung', 'sertifikat', 'imb', 'pbg', 'slf', 'dokumen gedung'],
    answer: `Buka [Gedung & denah](#/gedung) lalu klik **Daftarkan gedung**. Isi kode, nama, alamat, luas, nomor sertifikat, IMB/PBG, SLF, dan nilai perolehan.
Setelah tersimpan, buka gedungnya untuk:
- menambah **Lantai**,
- mengunggah dokumen (foto, sertifikat, gambar teknis),
- menggambar denah tiap lantai.`,
  },
  {
    id: 'denah', title: 'Menggambar denah ruang',
    keywords: ['denah', 'gambar denah', 'menggambar', 'editor denah', 'gambar ruang', 'poligon', 'bentuk l', 'jiplak', 'gambar latar', 'salin lantai', 'salin denah', 'simpan denah'],
    answer: `Buka [Gedung & denah](#/gedung) › pilih gedung › **Gambar denah** pada lantai yang diinginkan.
- **R**: ruang persegi (seret di kanvas). **P**: poligon untuk ruang berbentuk L.
- Seret pegangan untuk mengubah ukuran. Ctrl+D menduplikat, Del menghapus, Ctrl+Z membatalkan.
- Ikon gambar: unggah denah lama sebagai **gambar latar** untuk dijiplak.
- **Salin dari lantai…** menyalin denah lantai lain dengan penomoran otomatis.
- Isi data ruang (kode, nama, kategori, kapasitas) di panel kanan, lalu klik **Simpan denah**.
Hanya Super Admin yang dapat mengubah denah; peran lain melihat saja.`,
  },
  {
    id: 'kategori', title: 'Kategori ruang',
    keywords: ['kategori ruang', 'jenis ruang', 'warna denah', 'dapat dipinjam', 'bookable'],
    answer: `Kategori diatur di [Kategori ruang](#/master/kategori).
- **Warna** dipakai di denah.
- **Dapat dipinjam** menentukan apakah ruang muncul di pencarian ruang kosong dan peminjaman.
- **Penjadwalan kuliah** menentukan apakah ruang dipakai algoritma jadwal kuliah.
Kategori bisa diimpor dari Excel lewat tombol **Impor Excel**.`,
  },
  {
    id: 'jadwal', title: 'Membuat kegiatan di jadwal ruang', roles: ['superadmin', 'unit_admin'],
    keywords: ['buat kegiatan', 'membuat kegiatan', 'tambah kegiatan', 'kegiatan rutin', 'acara rutin', 'jadwal ruang', 'input jadwal', 'tambah jadwal', 'kegiatan berulang', 'jadwal rutin', 'batalkan kegiatan', 'hapus jadwal', 'ubah jadwal'],
    answer: `Buka [Jadwal ruang](#/jadwal), pilih ruang dan pekan, lalu klik **Buat kegiatan** (atau klik slot kosong).
- Isi nama, jenis, waktu mulai dan selesai.
- Untuk kegiatan rutin, isi **Ulangi tiap pekan sampai**.
Sistem menolak waktu yang bentrok. Pada kegiatan berulang, pertemuan yang bentrok dilewati dan dilaporkan.
Klik kegiatan untuk mengubah atau membatalkannya; pada kegiatan berulang tersedia **Batalkan seri berikutnya**.`,
  },
  {
    id: 'pinjam', title: 'Meminjam ruang unit lain', roles: ['superadmin', 'unit_admin'],
    keywords: ['pinjam ruang', 'meminjam', 'peminjaman', 'ajukan pinjam', 'ajukan peminjaman', 'booking', 'sewa ruang', 'ruang unit lain', 'pakai ruang'],
    answer: `1. Buka [Cari ruang kosong](#/cari-ruang), isi waktu, kapasitas, dan kategori, lalu klik **Cari**.
2. Pada ruang unit lain, klik **Ajukan pinjam** dan isi keperluannya.
3. Unit pengelola ruang menerima notifikasi dan menyetujui atau menolak.
4. Bila disetujui, kegiatan otomatis masuk jadwal ruang dan Anda mendapat notifikasi.
Status ajuan dapat dipantau di [Peminjaman](#/peminjaman?tab=outgoing) › **Diajukan unit saya**.
Anda juga bisa langsung meminta saya, mis. *"carikan aula kosong Jumat jam 13 untuk 80 orang"*.`,
  },
  {
    id: 'setujui', title: 'Menyetujui permintaan peminjaman', roles: ['superadmin', 'unit_admin'],
    keywords: ['setujui', 'persetujuan', 'approve', 'tolak peminjaman', 'permintaan masuk', 'ajuan masuk', 'menyetujui'],
    answer: `Permintaan untuk ruang unit Anda ada di [Peminjaman](#/peminjaman) › **Masuk ke unit saya**. Angka di menu menunjukkan jumlah yang menunggu.
Klik permintaannya, lalu pilih **Setujui** atau **Tolak** (boleh dengan catatan). Saat disetujui, sistem memeriksa bentrok lagi dan memasukkannya ke jadwal ruang.`,
  },
  {
    id: 'cariruang', title: 'Mencari ruang kosong',
    keywords: ['cari ruang kosong', 'ruang kosong', 'ruang tersedia', 'ruang bebas', 'cek ketersediaan'],
    answer: `Ketik saja kebutuhan Anda, mis.:
- *"ruang kosong besok jam 9 sampai 11"*
- *"lab untuk 30 orang Kamis siang"*
- *"aula Jumat 13.00–16.00 di gedung fakultas teknik"*
- *"ruang rapat tiap Senin jam 9 sampai 30 November"*
Saya memeriksa jadwal seluruh unit, lalu menampilkan ruang yang bebas beserta tombol **Buat kegiatan** atau **Ajukan pinjam**.
Pencarian lengkap juga ada di [Cari ruang kosong](#/cari-ruang).`,
  },
  {
    id: 'penjadwalan', title: 'Penjadwalan kuliah otomatis', roles: ['superadmin', 'unit_admin'],
    keywords: ['penjadwalan kuliah', 'jadwal kuliah', 'jadwal otomatis', 'algoritma', 'genetika', 'susun jadwal', 'generate jadwal', 'publikasi jadwal', 'publikasikan', 'kendala', 'bentrok dosen', 'rombel'],
    answer: `Langkahnya di [Penjadwalan kuliah](#/penjadwalan):
1. **Kelas & dosen**: isi kelas semester ini (MK, kelas, rombel, dosen, jumlah mahasiswa, durasi sesi). Bisa **Tambah kelas**, **Impor CSV**, atau **Salin dari semester lain**.
2. **Ruang & kendala**: pilih cakupan ruang, hari, sesi, dan kendala (mis. larangan Jumat siang, MK matematika di pagi hari, batas kelas dosen per hari).
3. **Proses & hasil**: klik **Simpan & jalankan penjadwalan**. Hasilnya bisa dilihat per ruang, dosen, atau rombel dan diedit manual.
4. Klik **Publikasikan ke jadwal** agar masuk jadwal ruang untuk seluruh semester, dengan pengecualian tanggal libur.
Sebelumnya, pastikan [Periode akademik](#/master/periode), [Sesi kuliah](#/master/sesi), dan unit dengan ruang yang ditugaskan sudah ada.`,
  },
  {
    id: 'periode', title: 'Periode akademik & sesi kuliah',
    keywords: ['periode akademik', 'semester', 'periode aktif', 'sesi kuliah', 'jam kuliah', 'jam pelajaran', 'slot'],
    answer: `- [Periode akademik](#/master/periode): nama (mis. *2026/2027 Genap*), tanggal mulai dan akhir perkuliahan. Tandai satu sebagai **aktif**.
- [Sesi kuliah](#/master/sesi): jam mulai dan selesai tiap sesi. Sesi yang tidak bersambung (ada istirahat) tidak digabung dalam satu kelas.
Keduanya dikelola Super Admin dan bisa diimpor lewat **Impor Excel**.`,
  },
  {
    id: 'impor', title: 'Impor data dari Excel',
    keywords: ['impor', 'import', 'excel', 'template', 'xlsx', 'csv', 'unggah data', 'upload data', 'massal'],
    answer: `Menu Unit pengelola, Pengguna, Kategori ruang, Dosen & pegawai, Mata kuliah, Periode akademik, dan Sesi kuliah memiliki tombol **Template Excel** dan **Impor Excel**.
1. Unduh template dan isi sheet **Data**. Kolom merah wajib diisi; contoh dan daftar kode yang valid ada di sheet lain.
2. Klik **Impor Excel** dan pilih berkasnya (.xlsx atau .csv).
Data yang kodenya sudah ada akan diperbarui, sisanya ditambahkan. Bila ada baris yang salah, tidak ada yang disimpan dan kesalahannya ditampilkan per baris.
Untuk mengubah banyak data sekaligus, unduh **Data saat ini**, edit, lalu impor ulang.`,
  },
  {
    id: 'peta', title: 'Peta keterisian & tabulasi',
    keywords: ['peta keterisian', 'peta', 'keterisian', 'terpakai sekarang', 'tabulasi', 'utilisasi', 'okupansi', 'pemakaian ruang'],
    answer: `- [Peta keterisian](#/peta): denah per lantai berwarna (terpakai, kosong, perbaikan), diperbarui tiap menit. Klik ruang untuk melihat kegiatannya.
- [Tabulasi harian](#/tabulasi): tabel ruang × jam untuk satu hari.
- Utilisasi dan tren pemakaian ada di [Dashboard](#/dashboard) dan [Laporan](#/laporan).`,
  },
  {
    id: 'aset', title: 'Mendaftarkan aset', roles: ['superadmin', 'unit_admin'],
    keywords: ['daftarkan aset', 'tambah aset', 'registrasi aset', 'input aset', 'aset baru', 'barang baru', 'nup', 'kode aset', 'inventaris'],
    answer: `Buka [Daftar aset](#/aset) › **Daftarkan aset**. Pilih kode barang (kodefikasi BMN), isi merek, spesifikasi, tanggal dan harga perolehan, ruang, serta pemegang.
Anda bisa mendaftarkan beberapa unit sekaligus. **NUP** dibuat otomatis per kode barang, dan kode aset = kode barang + NUP.
Riwayat setiap aset (mutasi, kondisi, perbaikan, opname, penghapusan) tercatat di **Kartu riwayat inventaris**. Aset yang tidak dipakai lagi dihapuskan lewat **Hapuskan & buat berita acara**; datanya tetap tersimpan.`,
  },
  {
    id: 'qr', title: 'Label QR aset & QR pintu ruang',
    keywords: ['qr', 'label', 'stiker', 'cetak label', 'barcode', 'pindai', 'scan', 'poster qr'],
    answer: `- **Label QR aset**: di [Daftar aset](#/aset), pilih aset lalu **Cetak label** (kertas stiker A4). Memindai QR membuka halaman info aset.
- **Pindai QR**: menu [Pindai QR](#/scan) memakai kamera perangkat (wajib HTTPS).
- **QR pintu ruang**: klik ruang di denah atau [Daftar ruang](#/ruang) › **Cetak poster QR**. Mahasiswa memindainya untuk mengirim masukan tentang ruang tersebut.`,
  },
  {
    id: 'mutasi', title: 'Mutasi barang', roles: ['superadmin', 'unit_admin'],
    keywords: ['mutasi', 'pindah barang', 'pindah aset', 'pindah ruang', 'ganti pemegang', 'antar unit'],
    answer: `Buka [Mutasi barang](#/mutasi) › **Mutasi baru**. Pilih aset, lalu jenis mutasi (ruang, pemegang, ruang + pemegang, atau antar unit) dan tujuannya.
Dokumen penyerta boleh dilampirkan. **Berita acara mutasi** dibuat otomatis dan riwayat aset diperbarui.`,
  },
  {
    id: 'opname', title: 'Stock opname', roles: ['superadmin', 'unit_admin'],
    keywords: ['stock opname', 'opname', 'stok opname', 'cek aset', 'pemeriksaan aset', 'inventarisasi'],
    answer: `Buka [Stock opname](#/opname) › **Mulai opname** dan pilih ruang yang diperiksa. Pindai QR aset dengan kamera (**Mulai memindai**) atau centang manual, lalu catat kondisi dan lokasi temuan.
Setelah selesai, hasilnya diterapkan ke data aset dan **berita acara stock opname** dibuat otomatis.`,
  },
  {
    id: 'persediaan', title: 'Barang persediaan (habis pakai)', roles: ['superadmin', 'unit_admin'],
    keywords: ['persediaan', 'habis pakai', 'atk', 'stok', 'barang masuk', 'barang keluar', 'stok minimum'],
    answer: `Buka [Persediaan](#/persediaan) › **Tambah barang**. Catat transaksi **masuk**, **keluar**, atau **penyesuaian**; stok dihitung otomatis.
Barang di bawah stok minimum ditandai. Saat mencatat transaksi keluar, Anda bisa sekaligus membuat berita acara serah terima.`,
  },
  {
    id: 'penyusutan', title: 'Penyusutan & valuasi aset',
    keywords: ['penyusutan', 'depresiasi', 'nilai buku', 'valuasi', 'masa manfaat', 'akumulasi'],
    answer: `Penyusutan memakai **metode garis lurus**. Kebijakan (periode, konvensi, nilai minimum kapitalisasi, nilai sisa, golongan yang tidak disusutkan) diatur di [Organisasi](#/pengaturan) oleh Super Admin.
- Masa manfaat diambil dari data aset, atau dari kode barang terdekat di kodefikasi.
- [Valuasi aset](#/valuasi): nilai perolehan, akumulasi penyusutan, dan nilai buku per ruang, pemegang, gedung, unit, dan bidang barang.
- **Laporan Penyusutan** tersedia di [Laporan](#/laporan).`,
  },
  {
    id: 'ba', title: 'Berita acara',
    keywords: ['berita acara', 'ba', 'bast', 'serah terima', 'tanda tangan', 'penanda tangan', 'nomor dokumen'],
    answer: `Berita acara dibuat otomatis dari mutasi, stock opname, penghapusan aset, dan persediaan. Semuanya terkumpul di [Berita acara](#/ba).
Buka BA untuk melengkapi penanda tangan, klik **Tandai final**, lalu **Cetak**. BA manual (serah terima, perbaikan) bisa dibuat dari menu yang sama. Kode penomoran diatur di [Organisasi](#/pengaturan).`,
  },
  {
    id: 'kerusakan', title: 'Kerusakan ruang & masukan publik',
    keywords: ['kerusakan', 'rusak', 'perbaikan', 'lapor kerusakan', 'keluhan', 'masukan', 'saran', 'portal', 'tiket'],
    answer: `- [Kerusakan ruang](#/kerusakan) › **Catat kerusakan**. Status ruang menjadi *perbaikan*, lalu otomatis aktif kembali setelah semua kerusakan selesai.
- [Masukan publik](#/masukan): saran, keluhan, laporan kerusakan, dan apresiasi dari portal publik atau QR pintu ruang. Tanggapi di sini; pelapor melacaknya dengan nomor tiket.
- Masukan jenis kerusakan bisa langsung dijadikan catatan kerusakan.`,
  },
  {
    id: 'laporan', title: 'Laporan & unduh Excel',
    keywords: ['laporan', 'rekap', 'cetak laporan', 'unduh excel', 'download', 'ekspor', 'export', 'laporan semester', 'laporan bulanan', 'laporan harian'],
    answer: `Buka [Laporan](#/laporan), pilih **harian**, **bulanan**, atau **semester**, lalu tentukan tanggal atau periodenya.
Isinya meliputi utilisasi ruang, kegiatan, rekap per unit, beban mengajar dosen, peminjaman, masukan, kerusakan, mutasi dan valuasi aset, persediaan, serta berita acara.
Klik **Cetak** atau **Unduh Excel** (satu sheet per bagian).`,
  },
  {
    id: 'unit', title: 'Unit pengelola & penugasan ruang', roles: ['superadmin'],
    keywords: ['unit', 'unit pengelola', 'buat unit', 'tambah unit', 'penugasan', 'tugaskan gedung', 'akun admin unit', 'admin unit', 'fakultas', 'prodi'],
    answer: `Buka [Unit pengelola](#/unit) › **Buat unit**. Akun admin unit (\`admin.<kode>\`) dibuat otomatis, tetapi baru aktif setelah Anda mengisi passwordnya lewat tombol **Akun admin**.
Klik **Penugasan** untuk menugaskan gedung atau ruang tertentu ke unit. Penugasan per ruang mengalahkan penugasan per gedung, sehingga satu gedung bisa dibagi beberapa unit.`,
  },
  {
    id: 'pengguna', title: 'Pengguna & peran',
    keywords: ['pengguna', 'user', 'akun', 'peran', 'role', 'hak akses', 'pimpinan', 'operator', 'tambah pengguna'],
    answer: `Ada tiga peran:
- **Super Admin**: semua fitur.
- **Admin unit**: jadwal, aset, opname, persediaan, kerusakan, dan masukan pada ruang unitnya; mengajukan dan memutuskan peminjaman.
- **Pimpinan**: melihat seluruh data tanpa mengubah.
Super Admin menambah akun di [Pengguna](#/pengguna) › **Tambah pengguna** atau lewat **Impor Excel**.`,
  },
  {
    id: 'password', title: 'Ganti password',
    keywords: ['password', 'kata sandi', 'sandi', 'ganti password', 'lupa password', 'reset password', 'login'],
    answer: `Ganti password lewat [Akun](#/akun) di kanan atas. Pengguna baru wajib menggantinya saat pertama masuk.
Lupa password? Minta Super Admin mereset di [Pengguna](#/pengguna) (untuk admin utama unit: [Unit pengelola](#/unit) › **Akun admin**).`,
  },
  {
    id: 'dosen', title: 'Dosen, pegawai & mata kuliah',
    keywords: ['dosen', 'pegawai', 'tendik', 'nidn', 'nip', 'mata kuliah', 'matkul', 'sks', 'tag mata kuliah'],
    answer: `- [Dosen & pegawai](#/master/orang): dipakai sebagai dosen pengampu di penjadwalan dan pemegang aset.
- [Mata kuliah](#/master/matkul): kode, nama, SKS, semester, dan **tag** (mis. *matematika*, *praktikum*) yang dipakai di kendala penjadwalan.
Keduanya bisa diisi massal lewat **Impor Excel**. Admin unit hanya mengelola data unitnya.`,
  },
  {
    id: 'kodefikasi', title: 'Kodefikasi BMN',
    keywords: ['kodefikasi', 'kode barang', 'bmn', 'golongan', 'bidang', 'kelompok', 'sub kelompok'],
    answer: `[Kodefikasi BMN](#/kodefikasi) memiliki 5 level: Golongan › Bidang › Kelompok › Sub Kelompok › Sub-sub Kelompok. Masa manfaat bisa diisi per kode dan diwarisi ke level di bawahnya.
Data awal hanya contoh; impor tabel kodefikasi resmi lewat CSV di menu tersebut.`,
  },
  {
    id: 'notifikasi', title: 'Notifikasi & log aktivitas',
    keywords: ['notifikasi', 'pemberitahuan', 'lonceng', 'log aktivitas', 'audit', 'riwayat perubahan'],
    answer: `Ikon lonceng di kanan atas menampilkan notifikasi (peminjaman, keputusan, hasil penjadwalan). Klik notifikasi untuk membuka halamannya.
Super Admin bisa melihat jejak semua perubahan data di [Log aktivitas](#/audit).`,
  },
  {
    id: 'dashboard', title: 'Dashboard',
    keywords: ['dashboard', 'ringkasan', 'statistik', 'grafik', 'tersibuk', 'jarang dipakai'],
    answer: `[Dashboard](#/dashboard) menampilkan ruang yang terpakai sekarang, utilisasi hari ini dan 7 hari, tren 30 hari, ruang tersibuk dan paling jarang dipakai, kondisi dan nilai aset, keluhan terbanyak, serta rata-rata waktu perbaikan.`,
  },
];
