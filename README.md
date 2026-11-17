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
npm run db:demo               # (opsional) data uji coba: unit Prodi TI, gedung contoh 2 lantai, contoh kelas & dosen
npm run db:seed-demo          # (opsional) data contoh: gedung 2 lantai + denah + jadwal kuliah semester aktif
npm run db:seed-demo -- --reset   # hapus data contoh (hanya data berkode DEMO)
npm run test:ga               # uji algoritma penjadwalan dengan data sintetis
node test/sample.test.js      # uji contoh data penjadwalan terhadap gedung contoh
```

**Data contoh** (`db/seed-demo.js` dan `db/demo.js`) menyediakan data uji coba untuk demonstrasi dan evaluasi fitur.

Masuk dengan `superadmin` / password dari `ADMIN_PASSWORD` (default `admin123`); sistem meminta ganti password saat pertama masuk.

Urutan penyiapan yang disarankan:
1. **Pengaturan > Organisasi**: nama institusi, jam operasional, kode penomoran dokumen.
2. **Kategori ruang**, **Sesi kuliah**, **Periode akademik** (data awal sudah tersedia, sesuaikan).
3. **Gedung & denah**: daftarkan gedung, unggah dokumen, gambar ruang per lantai.
4. **Unit pengelola**: buat unit (akun admin dibuat otomatis), isi password akun, tugaskan gedung/ruang.
5. **Kodefikasi BMN**: impor tabel kodefikasi resmi via CSV, lalu daftarkan aset.

Halaman HTML tidak di-cache browser, dan file JS/CSS diberi nomor versi otomatis dari isinya. Jadi setelah file diperbarui dan server di-restart, pengguna langsung mendapat versi baru.

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

**Jadwal per pertemuan & perubahan jadwal** (`src/routes/reschedule.js`)
- Buat kegiatan **sekali**, **tiap pekan sejumlah pertemuan** (mis. 16), atau **tiap pekan sampai tanggal**. Tanggal libur/UTS/UAS dilewati tanpa mengurangi jumlah pertemuan. Setiap pertemuan bernomor (P1…P16).
- Sebelum disimpan, layar **Periksa jadwal** menampilkan semua pertemuan. Untuk yang bentrok, pilih: pakai ruang alternatif (ruang kosong yang Anda kelola, diurutkan dari gedung & kategori yang sama), **utamakan kegiatan ini** (kegiatan yang bentrok dipindah ke ruang kosong lain), atau lewati. Ada pilihan "terapkan ke semua bentrok".
- **Pindah / jadwal ulang** untuk satu pertemuan (acara insidentil) atau pertemuan ini dan seterusnya: ruang dan/atau hari-jam.
- Semua perubahan disimpan dalam satu transaksi dan diperiksa ulang terhadap bentrok. Ruang & waktu semula serta alasan dicatat dan ditampilkan (tanda ⇄). Unit penyelenggara kegiatan yang dipindah mendapat notifikasi.
- Kolom baru di tabel `events` (`session_no`, `orig_room_id`, `orig_start_at`, `change_note`) ditambahkan otomatis saat server mulai (`src/migrate.js`).

**Penjadwalan kuliah otomatis** (`src/services/ga.js`)
- Data kelas dapat diisi manual, disalin dari semester lain, atau **diimpor dari Excel** (`src/services/tt-excel.js`, template berisi sheet Dosen, Mata Kuliah, Kelas, Kendala, dengan daftar pilihan; tersedia versi berisi contoh data). Impor didahului pratinjau (dry run) yang menampilkan jumlah data baru/diperbarui dan validasi kesalahan per baris.
- Sesi kuliah dapat dibuat otomatis (`Pages.slotGenerator`): cukup isi jumlah sesi, jam mulai, durasi per sesi, jeda antarsesi (otomatis mendeteksi sesi bersambung jika jeda <= 15 menit), dan istirahat.
- Input: kelas per semester (MK, rombel, dosen, jumlah mahasiswa, durasi sesi, pertemuan/pekan, kategori/ruang wajib), cakupan ruang (semua ruang unit / kategori tertentu / ruang pilihan / seluruh kampus), hari & sesi, serta kendala.
- Kendala keras: bentrok ruang, dosen, rombel; kapasitas & kategori ruang; jadwal berulang unit lain di ruang yang sama; kendala waktu bertanda *wajib*.
- Kendala lunak berbobot: MK bertag tertentu diutamakan pagi/sore, dosen hanya/tidak bisa hari/sesi tertentu, larangan waktu (mis. salat Jumat), batas kelas dosen per hari, kepadatan jadwal rombel, sebaran pertemuan, kecocokan kapasitas.
- Algoritma: *memetic genetic algorithm* — domain dipangkas di awal, inisialisasi greedy *most-constrained-first*, seleksi turnamen, *uniform crossover* per kelas, mutasi, dan *local search* terarah konflik dengan evaluasi berbasis tabel okupansi typed-array. Berjalan di `worker_threads` agar server tetap responsif. Uji internal: 320 sesi, 30 ruang, 0 bentrok dalam < 1 detik.
- Hasil dapat dilihat per ruang/dosen/rombel, diedit manual, diunduh CSV, lalu **dipublikasikan** ke jadwal ruang untuk seluruh semester dengan pengecualian tanggal libur/UTS/UAS. Publikasi ulang mengganti hasil sebelumnya.

**Aset Tetap & Aset Lancar (Persediaan)** (`src/routes/fixed.js`, `src/routes/stock.js`, `public/js/pages-inventory.js`)
- **Aset Tetap**: Pengadaan/pembelian massal (`asset_acquisitions`), penomoran dokumen, pencatatan vendor & sumber dana; Pemakaian / pinjam pakai (`asset_loans`, `asset_loan_items`) antarunit/perorangan dengan tanggal kembali, kondisi serah & kembali, serta Berita Acara otomatis.
- **Aset Lancar (Persediaan)**: Dokumen stok (`stock_docs`, `stock_doc_items`) untuk pembelian, pemakaian ruangan/perorangan, dan stock opname fisik persediaan.
- **Masuk Sebagai (Impersonation)**: Super Admin dapat "Masuk sebagai" admin unit tertentu dari menu Unit Pengelola atau Pengguna (token berdurasi 2 jam, pita penanda atas, seluruh aktivitas diaudit dengan identitas Super Admin asal).
- Kodefikasi 5 level (Golongan › Bidang › Kelompok › Sub Kelompok › Sub-sub Kelompok) dengan impor CSV. Data awal hanya contoh; impor dan verifikasi tabel kodefikasi resmi yang berlaku.
- Registrasi aset (bisa banyak unit sekaligus), NUP otomatis per kode, kode aset = kode barang + NUP, QR per aset.
- Kondisi: baru, baik, rusak, diperbaiki, rusak parah. Riwayat perbaikan dengan biaya.
- **Kartu riwayat inventaris**: registrasi, mutasi ruang/pemegang/antar unit, perubahan kondisi, perbaikan, opname, peminjaman/pemakaian, penghapusan.
- Mutasi dengan dokumen penyerta opsional dan berita acara otomatis.
- Stock opname dengan pemindaian QR kamera (BarcodeDetector, cadangan jsQR), hasil diterapkan ke data dan berita acara otomatis.
- Penghapusan aset (status, bukan hapus data) dengan berita acara.
- **Penyusutan aset tetap** metode garis lurus (fungsi SQL `asset_dep()`): periode bulanan/semesteran/tahunan, konvensi awal penyusutan, nilai minimum kapitalisasi, nilai sisa, golongan yang tidak disusutkan (default: persediaan, tanah, KDP), masa manfaat diwarisi dari kodefikasi, berhenti saat aset dihapuskan. Tersedia panel & jadwal penyusutan per aset dan **Laporan Penyusutan** (ringkasan per bidang, rincian per aset dengan beban periode berjalan & akumulasi, daftar aset tidak disusutkan). Kebijakan diatur di Pengaturan › Organisasi dan sebaiknya disesuaikan dengan kebijakan akuntansi/regulasi yang berlaku.
- Valuasi per ruang, pemegang, gedung, unit, dan bidang barang: nilai perolehan, akumulasi penyusutan, dan nilai buku.
- Cetak label QR (kertas stiker A4) dan berita acara siap cetak dengan penanda tangan.

**Masukan & kerusakan**
- Portal publik: pilih unit → pilih ruang → kirim saran/keluhan/kerusakan/apresiasi, nilai bintang, foto; nomor tiket untuk melacak tanggapan. QR pintu ruang langsung membuka formulir ruang tersebut.
- Catatan kerusakan per ruang dari laporan internal, aset rusak, atau masukan publik; status ruang otomatis kembali aktif setelah semua kerusakan selesai.

**Impor Excel data master** (`src/routes/import.js`)
- Menu Unit pengelola, Pengguna, Kategori ruang, Dosen & pegawai, Mata kuliah, Periode akademik, dan Sesi kuliah memiliki tombol **Template Excel** dan **Impor Excel** (.xlsx atau .csv, pemisah koma atau titik koma).
- Template berisi sheet *Data* (judul kolom, kolom wajib berwarna merah, keterangan di tiap judul, daftar pilihan), *Petunjuk*, *Contoh*, dan *Referensi* (kode unit/gedung/kategori yang valid saat ini). Tersedia juga unduhan *data saat ini* untuk edit massal lalu impor ulang.
- Kunci pencocokan: kode unit, username, nama kategori, NIP/NIDN (atau nama), kode MK, nama periode, nomor sesi. Kunci yang sudah ada diperbarui, selebihnya ditambahkan; tidak ada data yang dihapus.
- Impor bersifat utuh: bila ada satu baris salah, tidak ada yang disimpan dan semua kesalahan ditampilkan per baris. Admin unit hanya dapat mengimpor dosen dan mata kuliah untuk unitnya sendiri.

**Asisten Rendra** (`src/services/rendra.js`, `public/js/rendra.js`)
- Tombol **Tanya Rendra** di pojok kanan bawah setiap halaman setelah login.
- Mencarikan ruang kosong dari kalimat biasa: tanggal (*besok*, *Senin depan*, *12 November*, *15/11*), jam (*jam 9 sampai 11*, *13.00–15.00*, *jam 2 siang*, *sore*, *selama 2 jam*), kapasitas (*untuk 40 orang*), kategori (*lab*, *aula*, *ruang rapat*), gedung, dan kegiatan berulang (*tiap Senin … sampai 30 November*, *selama 8 pekan*, *satu semester*). Pertanyaan lanjutan (*kalau jam 1?*, *semua kategori*) memakai filter sebelumnya.
- Mengecek ruang tertentu (*apakah ruang 105 kosong Senin depan jam 9?*) beserta kegiatan yang memakainya.
- Hasil tampil sebagai kartu dengan tombol **Buat kegiatan** (ruang unit sendiri) atau **Ajukan pinjam** (ruang unit lain). Hasil memakai query yang sama dengan menu Cari ruang kosong.
- Menjawab cara memakai fitur dari basis pengetahuan `src/services/rendra-kb.js` (27 topik; sunting berkas ini bila menu berubah), dengan memperhatikan peran pengguna.
- **Mode dasar** (bawaan) berjalan tanpa layanan luar. **Mode AI** aktif bila `ANTHROPIC_API_KEY` diisi: percakapan lebih luwes memakai Claude, tetapi data ruang tetap diambil dari basis data aplikasi lewat alat yang sama, dan hanya membaca. Bila layanan AI gagal, Rendra otomatis kembali ke mode dasar.
- Pengaturan `.env` opsional: `ANTHROPIC_API_KEY`, `RENDRA_MODEL` (bawaan `claude-haiku-5-5`), `RENDRA_AI=off`, `RENDRA_RATE_PER_MIN` (bawaan 20 pesan/menit per pengguna).

**Dashboard & laporan**
- Dashboard: ruang terpakai sekarang, utilisasi hari ini/7 hari, tren 30 hari, ruang tersibuk & paling jarang dipakai, kondisi & nilai aset, keluhan terbanyak, rata-rata waktu perbaikan.
- Laporan **harian, bulanan, semester**: utilisasi per ruang, kegiatan, rekap per unit penyelenggara (termasuk pemakaian ruang unit lain), beban mengajar dosen, peminjaman, masukan/keluhan, kerusakan, mutasi & perubahan aset, posisi & valuasi aset per ruang, perolehan baru, persediaan, berita acara. Cetak atau unduh Excel (satu sheet per bagian).
- Notifikasi dalam aplikasi dan log aktivitas (audit).

## Peta kampus 2D/3D

Menu **Ruang & jadwal › Peta kampus 2D/3D** (`#/peta-kampus`) menempatkan gedung pada lokasi nyata.

- Tampilan 2D (tampak atas) dan 3D (ekstrusi per lantai), latar Peta (OpenStreetMap) / Satelit (Esri) / Polos, pemotongan s.d. lantai tertentu.
- Jumlah lantai mengikuti tabel `floors` (level ≥ 1). **Tinggi lantai bawaan 4 m**, diatur saat tambah/ubah lantai (`floors.floor_height`, 2–30 m).
- **Dinding otomatis menyelimuti semua lantai**; warna dinding per gedung (`buildings.wall_color`), opsional per lantai (`floors.wall_color`), atap otomatis lebih gelap atau `roof_color`.
- Tapak gedung = garis luar (convex hull) denah lantai terluas; bila belum ada denah dipakai perkiraan dari luas bangunan; dapat diatur manual (`map_footprint`, meter lokal [timur, utara]) dan diputar (`map_rotation`). Titik pusat = `latitude/longitude`.
- API: `GET /api/map/buildings`, `GET|PUT /api/buildings/:id/map`, `POST /api/buildings/:id/map/reset-footprint` (tulis: Super Admin).
- Pustaka MapLibre GL JS 4.7.1 dimuat dari cdn.jsdelivr.net, ubin dari OSM/Esri; CSP diatur di `src/server.js`. Ganti sumber ubin dengan variabel `TILE_HOSTS` di `.env` (daftar host dipisah koma) lalu sesuaikan `styleFor()` di `public/js/pages-map.js`.
- Geometri: `public/js/mapgeo.js` (diuji `node test/mapgeo.test.js`); uji UI dengan pustaka peta tiruan: `node test/map-ui.test.js` (butuh Playwright).

## Sub unit (program studi di bawah fakultas)

- Tabel `sub_units` (kode, nama, jenis: prodi/jurusan/bagian/lainnya) milik satu unit. Setiap sub unit otomatis punya akun admin (`admin.<unit>.<kode>`, nonaktif sampai password diisi) di menu **Pengaturan › Sub unit / program studi**.
- **Pengelola:** Super Admin dan admin unit (fakultas) mengelola semua sub unit unitnya; admin sub unit (`users.sub_unit_id` terisi) hanya mengelola data sub unitnya sendiri. Admin unit tanpa `sub_unit_id` = admin tingkat fakultas.
- **Penjadwalan kuliah:** kelas (`course_classes.sub_unit_id`, kosong = tingkat unit) dan proses GA (`timetable_runs.sub_unit_id`, kosong = seluruh unit) dapat dibuat untuk seluruh fakultas atau per program studi. Memilih sub unit di bagian atas halaman Penjadwalan membatasi daftar kelas, impor, dan proses.
- **Publikasi:** proses seluruh unit menggantikan semua jadwal kuliah unit pada periode itu; proses per prodi hanya menggantikan jadwal prodi itu (termasuk bagian prodi itu dari terbitan seluruh unit).
- **Anti-bentrok lintas prodi:** ruang yang dipakai jadwal prodi lain, dan jam mengajar dosen di jadwal lain (mis. dosen yang mengajar di dua prodi), otomatis dihindari GA (`lecBlocked`).
- Impor Excel: kolom **Program Studi (kode)** pada sheet Kelas; kosong = sub unit yang dipilih saat impor / tingkat unit. Admin prodi hanya boleh mengimpor prodinya.
- Data master dosen (`people`) dan mata kuliah (`courses`) punya `sub_unit_id`; data baru dari admin prodi otomatis menjadi milik prodinya.
- Akses ruang, peminjaman, dan aset tetap masih per unit: admin sub unit memakai ruang dan data unit induknya. Pembatasan per sub unit saat ini hanya untuk data akademik (kelas, dosen, MK, penjadwalan).
- Demo: `npm run db:demo` membuat Fakultas Teknik dengan prodi TI & SI (`admin.ft` / `adminft123`, `admin.ft.ti` / `adminti123`, `admin.ft.si` / `adminsi123`).
- Uji: `node test/subunit.test.js` (GA lintas prodi) dan `node test/subunit-ui.test.js` (Chromium, server tiruan).

## Reset jadwal per semester

- Tombol **Reset jadwal** di halaman Penjadwalan kuliah (`POST /api/tt/reset/preview` untuk menghitung dampak, `POST /api/tt/reset` untuk menghapus). Cakupan: `all` (seluruh universitas, hanya Super Admin), `unit` (satu fakultas), `sub` (satu program studi), selalu untuk satu periode.
- Yang dihapus: pertemuan kuliah hasil penjadwalan (`events` bertanda `tt_run_id`) dan `timetable_runs` pada cakupan itu. Data kelas hanya ikut terhapus bila `include_classes` dicentang. Kegiatan/peminjaman manual tidak disentuh. Ditolak (409) bila ada proses yang masih berjalan; dicatat di audit log. Cakupan `all` meminta ketikan "RESET" di UI.
- Super Admin tetap bisa menjalankan dan menerbitkan penjadwalan untuk unit/prodi mana pun.

## Data awal Fakultas Agama Islam

- `node db/seed-fai.js` membuat unit FAI, sub unit PAI/HKI/IAT/BKPI (beserta akun admin `admin.fai[.kode]`, kata sandi awal `admin<kode>123`, wajib diganti) dan periode 2026/2027 Genap. Tambahkan `--impor` (atau `npm run db:fai`) untuk sekaligus mengimpor `db/data/Impor_Kelas_FAI_Genap_2026-2027.xlsx` (208 kelas tanpa jadwal; mata kuliah berkode UIK dikecualikan; lihat sheet Catatan).

## Tabel: pencarian, filter, urut, paginasi

Seluruh tabel (modul `public/js/tablekit.js`) otomatis memiliki kotak pencarian, filter kolom otomatis untuk kolom kategorikal, pengurutan A–Z/Z–A per kolom (angka, rupiah, tanggal Indonesia, dan teks natural dikenali otomatis; sel kosong selalu di bawah), serta paginasi 10/20/50/100 yang pilihannya disimpan. Cetak mencakup seluruh baris hasil saring. Untuk daftar besar (aset, log transaksi, log aktivitas) pengurutan dan paginasi dilakukan di server dengan daftar putih kolom (`orderBy` di `src/util.js`). Tabel dengan isian dinamis dikecualikan dengan atribut `data-tk-off`. Uji: `node test/tablekit.test.js`.

## Struktur

```
db/schema.sql            skema lengkap (tabel, indeks, constraint, view)
db/init.js               inisialisasi & data awal
db/seed-demo.js          data contoh gedung + denah + jadwal (opsional)
src/server.js            Express, keamanan (helmet/CSP), penanganan galat
src/auth.js              JWT, peran, lingkup ruang per unit
src/routes/*.js          core (auth, user, unit, master, file), buildings, schedule,
                         timetable, assets, inventory, feedback, reports, import
src/services/ga.js       algoritma penjadwalan (+ ga-worker.js)
src/services/rendra*.js  asisten Rendra & basis pengetahuannya
public/                  SPA (index.html), portal.html, a.html, css, js
test/ga.test.js          uji algoritma
```

## Catatan pengembangan lanjutan

- Integrasi SSO/eportal kampus dan sinkronisasi data dosen, mata kuliah, serta rombel dari SIAKAD (saat ini lewat input/impor CSV).
- Token untuk unduhan berkas dikirim lewat query string agar tag `<img>`/tautan dapat diakses; untuk keamanan lebih ketat, ganti dengan cookie HttpOnly atau URL bertanda tangan berumur pendek.
- Rate limiter portal publik berbasis memori; gunakan Redis bila menjalankan lebih dari satu instans.

## Pembaruan: bentrok, drag & drop, rombel, aset per ruang
- **Bentrok** ditampilkan sebagai tabel per penyebab (ruang, dosen, rombel, ruang terpakai kegiatan lain, dosen mengajar di jadwal lain) dan dapat diekspor ke Excel (`GET /api/tt/runs/:id/conflicts.xlsx`).
- **Edit manual jadwal** dengan seret-lepas ke posisi kosong; server menolak (409) bila dosen/ruang/rombel terpakai dan menyebut penyebabnya.
- **Pemilihan rombel** setelah memilih prodi; setiap rombel dijadwalkan sendiri (`timetable_runs.student_group`). Terbitkan jadwal satu rombel sebelum menjalankan rombel berikutnya agar yang berikutnya menghindari jadwal yang sudah terbit.
- Warna default dinding `#6799FE`, atap `#6788CB`.
- **Aset per ruang** (Denah → Aset, kondisi & KIR ruang): daftarkan aset baru, tambah dari daftar aset (mutasi), ubah data, pindah ruang, hapus (berita acara penghapusan), ubah kondisi, dan cetak **Kartu Inventaris Ruangan (KIR)**.
- **Contoh aset tetap**: `npm run db:init` menambah kode Meja Dosen, Kursi Belajar, Papan Tulis, Proyektor (Infokus), AC Split; `npm run db:aset` mengisi tiap Ruang Kelas dengan aset contoh tersebut (aman diulang).
- Setelah memperbarui kode jalankan `npm run db:init` (kolom & kode baru) atau restart server (migrasi otomatis).
