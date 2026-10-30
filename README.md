# SARPRAS — Sistem Informasi Ruangan, Penjadwalan & Aset

Aplikasi web untuk pencatatan gedung dan denah ruang, penjadwalan pemakaian ruang (termasuk penjadwalan kuliah otomatis), peminjaman ruang antarunit, serta inventaris aset tetap berbasis kodefikasi barang milik negara.

Teknologi: **Node.js (Express) + PostgreSQL**, frontend SPA tanpa build step (HTML/CSS/JS murni).

## Menjalankan

Kebutuhan: Node.js ≥ 18, PostgreSQL ≥ 13 (ekstensi `btree_gist` dan `pgcrypto`, sudah termasuk di paket contrib standar).

```bash
createdb sarpras
cp .env.example .env          # sesuaikan DATABASE_URL, JWT_SECRET, PUBLIC_URL
npm install
npm run db:init               # membuat skema + data awal (aman dijalankan ulang)
npm start                     # http://localhost:3000
npm run test:ga               # uji algoritma penjadwalan dengan data sintetis
```

Masuk dengan `superadmin` / password dari `ADMIN_PASSWORD` (default `admin123`); sistem meminta ganti password saat pertama masuk.

Urutan penyiapan yang disarankan:
1. **Pengaturan > Organisasi**: nama institusi, jam operasional, kode penomoran dokumen.
2. **Kategori ruang**, **Sesi kuliah**, **Periode akademik** (data awal sudah tersedia, sesuaikan).
3. **Gedung & denah**: daftarkan gedung, unggah dokumen, gambar ruang per lantai.
4. **Unit pengelola**: buat unit (akun admin dibuat otomatis), isi password akun, tugaskan gedung/ruang.
5. **Kodefikasi BMN**: impor tabel kodefikasi resmi via CSV, lalu daftarkan aset.

Untuk produksi: jalankan di belakang reverse proxy HTTPS (wajib agar kamera untuk scan QR berfungsi), gunakan `pm2`/systemd, set `NODE_ENV=production`, dan cadangkan basis data serta folder `uploads/`.

## Peran pengguna

| Peran | Hak |
|---|---|
| Super Admin | Semua: gedung, denah, unit, akun, kodefikasi, seluruh aset dan jadwal |
| Admin unit | Jadwal, aset, opname, persediaan, kerusakan, masukan pada gedung/ruang yang ditugaskan ke unitnya; mengajukan & memutuskan peminjaman |
| Pimpinan | Melihat seluruh dashboard, peta, laporan, dan data (tanpa mengubah) |
| Publik (tanpa login) | Portal masukan ruangan (`/portal.html`) dan halaman hasil scan QR aset (`/a.html`) |

Pengelola efektif sebuah ruang ditentukan view `v_room_owner`: penugasan per ruang mengalahkan penugasan per gedung, sehingga satu gedung bisa dibagi beberapa unit.

## Fitur

**Ruang & denah**
- Data gedung lengkap (luas, sertifikat, IMB/PBG, SLF, nilai perolehan, koordinat) dengan dokumentasi multi-berkas.
- Editor denah 2D tampak atas: ruang persegi & poligon (bentuk L), snap grid, ubah ukuran dengan pegangan, undo/redo, duplikat, pintasan keyboard, zoom/geser (termasuk pinch di tablet), deteksi ruang bertumpuk, luas otomatis, **gambar latar untuk menjiplak denah lama**, **salin denah antarlantai** dengan penomoran otomatis, dan draf tersimpan di perangkat.
- Kategori ruang yang dapat dikelola (warna denah, dapat dipinjam, dipakai penjadwalan kuliah).

**Jadwal & peminjaman**
- Jadwal pekanan per ruang, kegiatan tunggal atau berulang mingguan.
- **Anti-bentrok di tingkat basis data** (exclusion constraint `tstzrange` + GiST), bukan hanya validasi aplikasi.
- Cari ruang kosong lintas unit → ajukan peminjaman → persetujuan unit pengelola → otomatis masuk jadwal; notifikasi kedua pihak.
- Peta keterisian per lantai (terpakai/kosong/perbaikan) yang diperbarui tiap menit, dan tabulasi harian ruang × jam.

**Penjadwalan kuliah otomatis** (`src/services/ga.js`)
- Input: kelas per semester (MK, rombel, dosen, jumlah mahasiswa, durasi sesi, pertemuan/pekan, kategori/ruang wajib), cakupan ruang (semua ruang unit / kategori tertentu / ruang pilihan / seluruh kampus), hari & sesi, serta kendala.
- Kendala keras: bentrok ruang, dosen, rombel; kapasitas & kategori ruang; jadwal berulang unit lain di ruang yang sama; kendala waktu bertanda *wajib*.
- Kendala lunak berbobot: MK bertag tertentu diutamakan pagi/sore, dosen hanya/tidak bisa hari/sesi tertentu, larangan waktu (mis. salat Jumat), batas kelas dosen per hari, kepadatan jadwal rombel, sebaran pertemuan, kecocokan kapasitas.
- Algoritma: *memetic genetic algorithm* — domain dipangkas di awal, inisialisasi greedy *most-constrained-first*, seleksi turnamen, *uniform crossover* per kelas, mutasi, dan *local search* terarah konflik dengan evaluasi berbasis tabel okupansi typed-array. Berjalan di `worker_threads` agar server tetap responsif. Uji internal: 320 sesi, 30 ruang, 0 bentrok dalam < 1 detik.
- Hasil dapat dilihat per ruang/dosen/rombel, diedit manual, diunduh CSV, lalu **dipublikasikan** ke jadwal ruang untuk seluruh semester dengan pengecualian tanggal libur/UTS/UAS. Publikasi ulang mengganti hasil sebelumnya.

**Aset**
- Kodefikasi 5 level (Golongan › Bidang › Kelompok › Sub Kelompok › Sub-sub Kelompok) dengan impor CSV. Data awal hanya contoh; impor dan verifikasi tabel kodefikasi resmi yang berlaku.
- Registrasi aset (bisa banyak unit sekaligus), NUP otomatis per kode, kode aset = kode barang + NUP, QR per aset.
- Kondisi: baru, baik, rusak, diperbaiki, rusak parah. Riwayat perbaikan dengan biaya.
- **Kartu riwayat inventaris**: registrasi, mutasi ruang/pemegang/antar unit, perubahan kondisi, perbaikan, opname, penghapusan.
- Mutasi dengan dokumen penyerta opsional dan berita acara otomatis.
- Stock opname dengan pemindaian QR kamera (BarcodeDetector, cadangan jsQR), hasil diterapkan ke data dan berita acara otomatis.
- Penghapusan aset (status, bukan hapus data) dengan berita acara.
- Barang persediaan/habis pakai: stok, stok minimum, transaksi masuk/keluar/penyesuaian, BA serah terima.
- **Penyusutan aset tetap** metode garis lurus (fungsi SQL `asset_dep()`): periode bulanan/semesteran/tahunan, konvensi awal penyusutan, nilai minimum kapitalisasi, nilai sisa, golongan yang tidak disusutkan (default: persediaan, tanah, KDP), masa manfaat diwarisi dari kodefikasi, berhenti saat aset dihapuskan. Tersedia panel & jadwal penyusutan per aset dan **Laporan Penyusutan** (ringkasan per bidang, rincian per aset dengan beban periode berjalan & akumulasi, daftar aset tidak disusutkan). Kebijakan diatur di Pengaturan › Organisasi dan sebaiknya disesuaikan dengan kebijakan akuntansi/regulasi yang berlaku.
- Valuasi per ruang, pemegang, gedung, unit, dan bidang barang: nilai perolehan, akumulasi penyusutan, dan nilai buku.
- Cetak label QR (kertas stiker A4) dan berita acara siap cetak dengan penanda tangan.

**Masukan & kerusakan**
- Portal publik: pilih unit → pilih ruang → kirim saran/keluhan/kerusakan/apresiasi, nilai bintang, foto; nomor tiket untuk melacak tanggapan. QR pintu ruang langsung membuka formulir ruang tersebut.
- Catatan kerusakan per ruang dari laporan internal, aset rusak, atau masukan publik; status ruang otomatis kembali aktif setelah semua kerusakan selesai.

**Dashboard & laporan**
- Dashboard: ruang terpakai sekarang, utilisasi hari ini/7 hari, tren 30 hari, ruang tersibuk & paling jarang dipakai, kondisi & nilai aset, keluhan terbanyak, rata-rata waktu perbaikan.
- Laporan **harian, bulanan, semester**: utilisasi per ruang, kegiatan, rekap per unit penyelenggara (termasuk pemakaian ruang unit lain), beban mengajar dosen, peminjaman, masukan/keluhan, kerusakan, mutasi & perubahan aset, posisi & valuasi aset per ruang, perolehan baru, persediaan, berita acara. Cetak atau unduh Excel (satu sheet per bagian).
- Notifikasi dalam aplikasi dan log aktivitas (audit).

## Struktur

```
db/schema.sql            skema lengkap (tabel, indeks, constraint, view)
db/init.js               inisialisasi & data awal
src/server.js            Express, keamanan (helmet/CSP), penanganan galat
src/auth.js              JWT, peran, lingkup ruang per unit
src/routes/*.js          core (auth, user, unit, master, file), buildings, schedule,
                         timetable, assets, inventory, feedback, reports
src/services/ga.js       algoritma penjadwalan (+ ga-worker.js)
public/                  SPA (index.html), portal.html, a.html, css, js
test/ga.test.js          uji algoritma
```

## Catatan pengembangan lanjutan

- Integrasi SSO/eportal kampus dan sinkronisasi data dosen, mata kuliah, serta rombel dari SIAKAD (saat ini lewat input/impor CSV).
- Token untuk unduhan berkas dikirim lewat query string agar tag `<img>`/tautan dapat diakses; untuk keamanan lebih ketat, ganti dengan cookie HttpOnly atau URL bertanda tangan berumur pendek.
- Rate limiter portal publik berbasis memori; gunakan Redis bila menjalankan lebih dari satu instans.
