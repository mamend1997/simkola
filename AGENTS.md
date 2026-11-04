
## Ronde 8 — Menu akordeon, pengaturan tampilan menu, kwitansi selektif, grid ekskul

### Sidebar akordeon + pengaturan tampilan menu
- `ui.js`: `NAV` tiap grup punya `id` + `icon`. `layout()` merender grup ≥2 menu sebagai **akordeon** (`div.nav-group > button.nav-toggle[data-navtoggle] + div.nav-sec`), grup 1 menu sebagai link biasa (`div.nav-single`). Grup dengan item aktif otomatis `open`.
- Open-state disimpan di `localStorage['simkeu:nav-open']` (`{ groupId: 0|1 }`); JS ada di IIFE `navAccordion()` di `public/app.js`. Klik link di mobile menutup drawer.
- **Visibilitas menu**: setting `nav_hidden` = daftar `href` dipisah koma. `ui.navVisibility()` + `layout({navHidden})`; `server.page()` mengirim `c.settings.nav_hidden`.
- Halaman **`/tampilan-menu`** (routes/sistem.js, guard `pengguna.view`, simpan `pengguna.edit`): checkbox `name="show"` per menu (dicatat → tampil), `?reset=1` menampilkan semua, hook generik `data-check-group(-all|-none|-box)="nav"`. Tautan tersedia di kartu Pengaturan Sistem `/pengguna` dan header kartu Identitas Sekolah `/sekolah`.

### Iuran: kembali ke detail siswa setelah cetak
- `POST /iuran/bayar` & `POST /iuran/bayar-item` mengirim `back=<path detail siswa>` pada redirect ke `/iuran/kwitansi`. Route kwitansi memakai `safeBack(req.query.get('back'), '/iuran/transaksi')` → tombol **Kembali ke Detail Siswa**. **Jangan** hardcode `/iuran/transaksi` lagi.

### Detail iuran siswa: ceklis per grup/bulan + cetak selektif + export vertikal
- Checkbox bernama `item` di dalam satu form `#fItems` (POST `/iuran/bayar-item`): nilai `g:<tagihanId>` (grup non-bulanan) atau `m:<tagihanId>:<bulan>` (satu bulan). Grup bulanan **tidak** punya ceklis induk (tidak diakumulasi) — ikuti spesifikasi pemilik.
- Helper baru di `routes/iuran.js`: `parseItemKeys()`, `selectionLines()` (label/jenis/status/tanggal/potongan/pencatat per item), `statusText()`, `safeBack()`.
- Tombol pada form yang sama memakai `formmethod="get" formaction=...`:
  - `GET /iuran/data/:id/kwitansi-terpilih?item=...` → **hanya item dengan `dibayar > 0`** (pembayaran non-void); item belum dibayar dilewati + dicatat di catatan kaki. Tidak ada item terbayar → redirect `err`.
  - `GET /iuran/data/:id/export-item?item=...` → XLSX vertikal per item, kolom `GRUP IURAN / BULAN | JENIS | STATUS | TANGGAL BAYAR | JUMLAH TAGIHAN | SUDAH DIBAYAR | POTONGAN | BELUM DIBAYAR | NAMA PENCATAT` (item belum dibayar tetap tampil).
- `POST /iuran/bayar-item` = bayar massal per item (nominal = sisa item), satu nomor kwitansi, masuk antrean posting.

### Export data iuran semua siswa
- Excel: setiap grup bulanan menghasilkan **3 kolom per bulan** (`<GRUP> - <BULAN> TAGIHAN`, `... SUDAH DIBAYAR`, `... SISA`) + 3 kolom total grup. Grup non-bulanan: TAGIHAN / SUDAH DIBAYAR / SISA.
- PDF: halaman landscape terpisah per grup bulanan (`ui.docPage({css})` — parameter `css` baru) dengan header 2 tingkat: tiap bulan 3 sub-kolom (Tagih/Bayar/Sisa).

### Siswa non-aktif
- `GET /siswa-nonaktif`: form `#fAktifBulk` **diletakkan kosong sebelum tabel** (jangan membungkus tabel — baris berisi form sendiri, nested form tidak valid), checkbox `form="fAktifBulk"`, tombol Pilih Semua/Hapus Ceklis, dan `POST /siswa/aktifkan-bulk` (guard `siswa.edit`) untuk aktivasi massal.
- `iuranTagihanRows({aktifOnly:true})` menambahkan `AND s.status='aktif'`; dipakai `dataIuranRows()` → halaman Data Iuran + export menyembunyikan siswa non-aktif/lulus/pindah/DO.

### Honor ekskul: grid, edit/hapus tersinkron
- `/ekskul`: modal `mAddEkskul` sekarang **tabel grid** (`form#fmGrid[data-ekskul-grid]`, `tbody[data-ekskul-rows]`, tombol `data-ekskul-add-row` / `data-ekskul-del-row`). JS: `ekskulBind(tr)` + `window.__simkeu.initMoney()` untuk input `data-money` hasil klon. Row kosong diabaikan server. `POST /ekskul/save-grid` (array `nama_pembina[]`, `kehadiran[]`, `harga_satuan[]`, `keterangan[]` + `jenis`, `periode`).
- `POST /ekskul/save` id: item **terposting** boleh diedit; `syncBatch(transaksi_id)` menyelaraskan `transaksi.nominal` + `uraian`; periode item terposting tidak boleh diubah; periode BKU tertutup → ditolak.
- `POST /ekskul/delete` kini **cascade**: item pending → hapus baris; item terposting → hapus SEMUA baris `ekskul_honor` dengan `transaksi_id` sama + `transaksi` BKU sasaran (cek `periodeLockError(..., 'edit')`, semua baris masuk `trash`). Menerima `back` agar kembali ke halaman asal (`/ekskul/antrean`).
- `/ekskul/antrean`: setiap baris (pending & terposting) punya tombol **Edit** (`mQe<id>`) + **Hapus**; riwayat terposting dibatasi 60 baris terbaru (modal edit dirender per baris — jaga ukuran HTML).

### Gotcha baru (penting)
- Tool Edit **merusak** teks pengganti yang mengandung `$&` (diganti isi `old_string`) dan `$$` (menjadi `$`). Ini sudah pernah membuat `safeBack()` menelan fungsi `monthRow()` dan `$$(...)` di `public/app.js` berubah jadi `$(...)` (semua modal mati). Untuk konten yang memuat `$&`, `$$`, atau regex path ber-`$`, **pakai Python/heredoc** (`python3 - <<'PY'`) — jangan tool Edit.
- `/ekskul/antrean` merender modal edit per baris: batasi jumlah baris (60) agar halaman tidak membengkak.

### Test ronde 8
```bash
node dev-tests/round8.js     # 67 cek: akordeon, /tampilan-menu, back kwitansi, ceklis per bulan,
                             # kwitansi selektif (hanya terbayar), export vertikal, kolom bulanan export,
                             # siswa non-aktif massal + sembunyi dari Data Iuran, grid ekskul,
                             # edit terposting → nominal BKU, hapus cascade (item+antrean+BKU), saldo BKU
node dev-tests/ui-round8.js  # 33 cek Playwright: akordeon + persistensi, /tampilan-menu, ceklis item,
                             # grid ekskul (tambah/hapus baris + hitung), modal antrean, mobile 390px, tanpa error JS
```

## Ronde 9 — iuran non-BKU, portal publik (OTP WA), feedback orang tua, dashboard analitik, beasiswa baru

### Iuran: kwitansi per-transaksi & bayar item terpilih
- `POST /iuran/bayar` mengumpulkan id baris yang baru dibuat → redirect `?rows=<id,id>`; `GET /iuran/kwitansi` **memprioritaskan `rows`** (kwitansi tidak mencampur item lain). Tombol cetak per baris di daftar memakai `?ids=<id>`.
- `POST /iuran/bayar-item` mendukung **input per item**: `n` + `key_i`, `tanggal_i`, `metode_i`, `jumlah_i`, `potongan_i`, `bku_i`, `nonbku_i`. Mode lama (`item[]` + field global) tetap didukung sebagai fallback.
- Modal `mBayarItem` di halaman detail siswa dibangun **JS** (`public/app.js` → blok `[data-bulk-pay]`): baris diisi dari checkbox tercentang (`data-label`, `data-sisa`), jumlah default = sisa; ada tanggal/BKU default yang menerapkan ke semua baris; centang Non-BKU menonaktifkan select BKU baris tersebut.
- `POST /iuran/bayar` juga menerima `nonbku=1` (toggle `[data-nonbku]` pada form bayar) → baris `iuran_bayar.status='manual'`, `bku_id=NULL`.

### Status pembayaran iuran `manual` (data saja / non-BKU)
- `bayarStatusBadge()/bayarStatusText()` di routes/iuran.js. `manual` **tidak** masuk antrean (`queueRows` hanya `pending`), **tidak** menambah kas BKU, tetapi **mengurangi sisa tagihan** (semua agregat memakai `status<>'void'`).

### Piutang sertifikasi
- Kartu **Rekapitulasi Piutang Sertifikasi per Pegawai** (`dbm.sertifikasiRekap(taId)`) + tombol **Bayar Gabungan** → `POST /piutang-lain/bayar-gabungan` (alokasi FIFO, opsi masuk BKU, satu transaksi pemasukan).
- Laporan `r=sertifikasi` (preview, `/cetak/sertifikasi`, `/export/sertifikasi`) kini memuat **A. REKAP PER PEGAWAI** dan **B. RINCIAN TAGIHAN**.

### Counter transaksi
- `GET /transaksi` tidak lagi `LIMIT 300`: query `where` dipakai bersama, `COUNT(*)` → `totalRows`, pagination 120/halaman (`?hal=`), KPI & total pemasukan/pengeluaran dihitung lewat agregat SQL (bukan baris halaman), pager `.pager`.

### Portal publik siswa (`routes/portal.js`)
- Tanpa link **Login Petugas**; kolom nama → autocomplete `GET /portal/siswa?q=` (min 3 huruf, siswa aktif); tanggal lahir → `<input type="date">`; tombol **Kembali ke Halaman Pencarian**.
- Form **Kolom Catatan Orang Tua / Wali** → `POST /portal/pesan` → tabel `portal_pesan` (`status='baru'`).
- Shell portal memuat `app.js` (wajib untuk autocomplete) + favicon `/favicon.ico` (otomatis dari logo sekolah).

### Pesan orang tua (feedback loop)
- Dashboard: kartu **Pesan / Catatan Orang Tua** (6 terbaru) + halaman `/pesan-orangtua` (filter status) + `POST /pesan-orangtua/selesai` (`status='selesai'`, `selesai_at/by`) → badge **Selesai Ditindaklanjuti**. Nav: "Pesan Orang Tua" (key `dashboard`).

### Portal pegawai & slip gaji (`routes/portal_pegawai.js`, publik)
- `/portal-pegawai` (piutang) & `/portal-slip` (slip gaji): nama (autocomplete `…/nama`), tanggal lahir (date), slip juga meminta nomor WhatsApp (harus cocok dengan master).
- OTP 4 digit: `dbm.otpCreate/otpVerify` (tabel `otp_code`, token, 10 menit, maks 5 percobaan). Pengiriman lewat `wa.js` (`sendWA`) memakai setting `wa_api_url`, `wa_api_token`, `wa_api_payload` (form/json).
- **Mode uji**: bila gateway belum diatur & `wa_demo_tampil='1'`, kode ditampilkan di layar (wajib dimatikan setelah gateway aktif). Diatur di `/pengguna` → Pengaturan Sistem (juga sakelar portal).
- Slip menampilkan komponen pemasukan (gaji/honor, tunjangan, pembantu kepsek, wali kelas, honor ekskul) & pengurangan (telat, dana sosial, BPJS, sertifikasi, kasbon) + `/portal-slip/cetak?token=` (A4, verifikasi token).

### Master pegawai
- Kolom baru `pegawai.tanggal_lahir`, `pegawai.whatsapp` (WA dinormalisasi ke `62…`). Form, tabel, template & import Excel (kolom TANGGAL LAHIR / WHATSAPP opsional) diperbarui.

### Dashboard analitik iuran
- `dbm.iuranAnalytics(taId)` menghitung: summary (tagihan/terbayar/potongan/sisa/siswa/lunas), `monthly` (Juli→Juni), `metode` (tunai vs transfer per bulan), `grup` (sel per bulan per metode + total), `nonBulanan`.
- Dashboard menampilkan 4 KPI iuran, line chart Jul–Jun (`ui.chartLineSPP`), matriks bulanan (tagihan/dibayar/sisa), tabel metode pembayaran, dan tabel rincian per grup dengan **filter metode realtime** (`[data-iuran-metode]` + `data-tunai`/`data-transfer` per sel; filter dihitung di klien).

### Beasiswa (rombak)
- Form: nama, deskripsi, **grup iuran**, checkboxes bulan (untuk grup bulanan), **nominal Rp ↔ persentase %** dua arah (JS `[data-bea-form]`; peta nominal per bulan per grup ditanam sebagai `<script type="application/json" data-bea-nominal-map>` dan dipakai saat grup diganti — **jangan** mengandalkan atribut statis).
- Penetapan siswa: filter kelas, ceklis individual + Pilih Semua, tombol **Lanjutkan → Pratinjau** (`mBeaPreview`) lalu **Simpan Final** → `POST /beasiswa/save-final` (payload JSON) membuat `beasiswa` + `beasiswa_siswa`. Tabel baru `beasiswa_siswa`, kolom `beasiswa.deskripsi/grup_id/bulan_mask/persen`.

### Cetak & kertas
- `ui.kwitansiSize(settings)` + `ui.kwitansiPage(...)`; setting `kw_trx_w_mm/h_mm` + margin 4 sisi `kw_trx_mt/mb/ml/mr` (default 210×99 mm & margin 6/6/8/8). Halaman pengaturan: **`/transaksi/kertas`** (link otomatis di setiap kwitansi). `ui.printPage` menerima `extraActions`.
- Bukti piutang: `/piutang/:id/bukti`, `/piutang/bayar/:id/bukti`, `/piutang-lain/:id/bukti`, `/piutang-lain/bayar/:id/bukti` (memakai ukuran kertas kwitansi transaksi).
- Cetak honor ekskul **dipisah per jenis** (`div.eks-block` per jenis, masing-masing total + kolom tanda tangan) dan export Excel berblok per jenis dengan kolom **JENIS EKSTRAKURIKULER** + SUBTOTAL + GRAND TOTAL.

### Lain-lain
- Grafik SPP di `/piutang` memakai urutan `dbm.BULAN_TA` (Juli→Juni); `ui.chartSPP` memakai `row.label || row.nama` untuk label sumbu.
- Form Identitas Sekolah diurutkan bernomor 1..6 (Nama Sekolah → Alamat → Nama Kepsek → NIP Kepsek → Nama Bendahara → NIP Bendahara).
- **Sidebar collapse**: tombol `#navCollapse` di topbar → `body/.shell.nav-collapsed` (localStorage `simkeu:nav-collapsed`); CSS menyembunyikan label menu (desktop ≥981px).

### Gotcha baru
- **`db.transaction(fn)` mengembalikan fungsi** — wajib dipanggil `()`. Di test ronde 9 sempat lupa memanggil sehingga 310 baris uji tidak pernah masuk.
- Alias SQL **jangan memakai kata kunci** (`in`, `out`): `COALESCE(SUM(...),0) in` → syntax error.
- Halaman portal wajib memuat `<script src="assets/app.js">` bila memakai komponen interaktif (autocomplete/datepicker).
- Test `newfeat.js` memakai periode berjalan (`PERIODE_EK`) agar tidak terkena kunci "bulan lampau belum ditutup".

### Test ronde 9
```bash
node dev-tests/round9.js     # 105 cek: kwitansi per-transaksi, bayar item per item + non-BKU, rekap & bayar
                             # gabungan sertifikasi, counter transaksi >300 + pagination, portal siswa
                             # (autocomplete/datepicker/feedback), portal pegawai & slip (OTP), master pegawai,
                             # beasiswa baru, kertas kwitansi transaksi, bukti piutang, ekskul per jenis,
                             # grafik SPP Juli–Juni, sidebar collapse, urutan identitas sekolah
node dev-tests/ui-round9.js  # 44 cek Playwright: collapse sidebar (persist), filter metode dashboard realtime,
                             # modal bayar item terpilih + toggle non-BKU, autocomplete & datepicker portal,
                             # OTP portal pegawai/slip, kalkulator beasiswa + pratinjau, mobile 390px
```

## Ronde 10 — Sinkron status piutang, Leger Honor DRAF, Slip Gaji modern, Portal slip tanpa WA

### Sinkronisasi status piutang (portal vs SIMKEU)
- `dbm.piutangSyncStatus()` (db.js) menghitung ulang `piutang.status`/`piutang_lain.status` + `tanggal_bayar` **dari total cicilan** (`piutang_bayar` / `piutang_lain_bayar`); hanya baris yang statusnya tidak sesuai yang di-UPDATE, dibungkus satu `db.transaction()`. Sumber kebenaran = tabel pembayaran, kolom `status` hanya cache.
- Dipanggil di halaman `/piutang`, `/piutang-lain`, hasil verifikasi portal piutang, dan setelah aksi kasbon payroll / hapus baris leger.
- Portal `/portal-pegawai` kini memuat **semua** baris (bukan `status='belum'` saja), lalu memisahkan **tagihan aktif** (`sisa > 0`) dan **Riwayat Lunas** (badge `LUNAS`, `.lunas-box`) → transaksi lunas tidak pernah tampil sebagai tagihan aktif walau kolom status sempat basi.

### Leger honor = DRAF (mode baru)
- Tabel baru **`payroll_draft`** (`periode` PK, `kasbon_auto` 0/1, `kasbon_at/by/total`, `catatan`, `updated_at`) + helper `dbm.payrollDraft/payrollDraftSet/payrollPeriods`. Sudah masuk `TABLES` backup/restore.
- Draf **boleh diedit kapan pun** (bulan mana pun, termasuk bulan/tahun pelajaran lain). Input periode tidak lagi memakai `min/max` TA; ada dropdown "Draf / Periode Tersimpan" dari `payrollPeriods()`.
- **Tidak ada lagi pesan "Periode tidak valid"**: `normPeriode()` menerima `2026-10`, `2026/10`, `202610`, `10-2026`; `periodeFromBody()` fallback ke `periode` baris leger (`ids`/`id`) sehingga field `periode` yang hilang tidak menggagalkan simpan.
- **Bug besar yang diperbaiki**: sebelumnya form aksi per baris (`urutkan`/`hapus`) dirender **di dalam** `#fPayroll` → parser HTML menutup form induk, sehingga input baris & tombol submit tidak ikut terkirim (modal review hanya membaca satu baris). Sekarang form aksi dikumpulkan di `rowForms[]`, dirender **setelah** `</form>`, dan tombol memakai atribut `form="fRow…"`.
- Simpan draf **tidak** memotong kasbon & tidak menyentuh BKU (hanya `syncMinus` untuk nilai minus).

### Potongan kasbon dipisah (manual / otomatis saat posting)
- Panel `#kasbon` di bawah leger: KPI (kasbon di leger / sudah dipotong / belum), sakelar `kasbon_auto` (`POST /payroll/kasbon-mode`), tombol `POST /payroll/kasbon-apply` (idempoten, dihitung ulang) & `POST /payroll/kasbon-reset` (hapus `piutang_bayar` ber-`payroll_id`, lalu `piutangSyncStatus()`).
- Posting hanya menerapkan kasbon otomatis bila `kasbon_auto=1`.

### Posting & kuncian
- Tombol eksplisit **Posting Honor ke BKU** → 1 baris pengeluaran CoA 5.1.01 metode **transfer** di BKU Umum (+ pemasukan dana sosial).
- `dbm.payrollPost(periode)` sekarang **auto-unlock**: bila `trx_umum_id` sudah tidak ada / `status='void'`, baris `payroll_post` dihapus dan leger dianggap draf lagi. `dbm.payrollUnlockByTrx(id)` dipanggil dari `POST /transaksi/delete` dan `/transaksi/void`.
- Bila bulan leger sudah berganti dan BKU bulan itu belum ditutup (status periode `'terlewat'`), posting memakai **tanggal hari ini** (bulan berjalan) + catatan di pesan sukses — tetap tidak boleh menembus periode `'ditutup'`.

### Slip gaji
- Modul baru `GET /payroll/slip` (nav "Slip Gaji Pegawai", activeKey `payroll_slip`): dropdown periode, KPI, tabel `.slip-modern` dengan kolom **TOTAL DITERIMA** (`.slip-diterima`, 16–17px bold) + tombol cetak per pegawai.
- Cetak 9 slip/halaman pindah ke `GET /payroll/slip/cetak?periode=&id=` (opsional `id` untuk satu pegawai).
- Portal publik `/portal-slip`: **field nomor WhatsApp dihapus**; OTP dikirim ke `pegawai.whatsapp` (bila belum terdaftar → kartu penjelasan). Rincian slip memakai `.slip-card` + `table.tbl-modern.slip-detail` dan `.slip-total .big` (22px, 20px di mobile, bold 800).
- CSS baru: `.slip-modern`, `.slip-diterima`, `.tbl-modern`, `.slip-card*`, `.slip-total`, `.lunas-box`.

### Test
```bash
node dev-tests/round10.js     # 63 cek: piutang sync + portal LUNAS, draf lintas bulan tanpa error periode,
                              # kasbon manual/reset/mode, posting+kunci+unlock via hapus transaksi, slip & portal slip
node dev-tests/ui-round10.js  # 17 cek Playwright: tanpa error JS, overflow mobile, tombol urutkan baris,
                              # modal review memuat semua baris, TOTAL DITERIMA besar+bold, portal lunas
```

## Ronde 11 — Sertifikasi berbasis JAM, kasbon murni catatan, salin bulan lalu, portal piutang agregat

### Sertifikasi = JAM × tarif (bukan nominal)
- Kolom baru **`payroll.jam_sertifikasi`** (ALTER otomatis). Migrasi sekali: `jam_sertifikasi = ROUND(pot_sertifikasi / sertifikasi_per_jam, 2)` untuk baris lama.
- `dbm.payrollCalc()`: `sertifikasi = ROUND(jam_sertifikasi × sertifikasiJam())` — **tidak ada lagi input nominal** (kolom `pot_sertifikasi` hanya cermin nominal, diisi otomatis saat simpan/import).
- Halaman payroll: input `name="<id>_jam_sertifikasi"` (JS membatasi hanya angka + koma/titik), sub-label menampilkan `Rp X = N jam × Rp 12.500`.
- Halaman baru **`GET/POST /tarif-honor`** ("Pengaturan Nominal Tunjangan & Honor", nav `tarif_honor`) mengatur `sertifikasi_per_jam` (default 12.500), `honor_pembantu_jam`, `honor_wali_jam`. Ada tombol pintasan di halaman *Pengguna & Hak Akses* (Pengaturan Sistem) dan tautan dari halaman payroll. `honor_tugas_jam` tetap disinkronkan dari `honor_pembantu_jam` (kompatibilitas cetakan lama).
- `dbm.honorPembantuJam()` / `honorWaliJam()` menggantikan `honorTugasJam()` pada perhitungan (fallback ke `honor_tugas_jam`).
- Import Excel: kolom **JAM SERTIFIKASI** dibaca sebagai jam; berkas lama berisi rupiah (> 200) otomatis dikonversi `nilai / tarif`.

### Kasbon = pencatatan saja (auto-deduct DIHAPUS)
- `syncKasbon()` beserta route `/payroll/kasbon-mode|kasbon-apply|kasbon-reset` dan panel `#kasbon` **dihapus**. Kolom Kasbon tetap ada (masuk slip & leger) tetapi **tidak** membuat/mengurangi `piutang_bayar`.
- Posting ke BKU tidak lagi memotong piutang; pesan sukses menegaskan kasbon hanya tercatat.

### Salin bulan sebelumnya & hapus massal
- `POST /payroll/salin-bulan` → `dbm.payrollCopyPrev(periode)`: menyalin seluruh isian periode **bulan sebelumnya** dengan `urutan` relatif **sama persis** (tanpa sort abjad); pegawai yang sudah ada dilewati, keterangan diberi catatan "disalin dari <bulan>".
- Ceklis per baris (`name="pilih"`, `form="fHapusTerpilih"`) + header `data-check-all-box="pilih"` + tombol **Pilih Semua / Kosongkan / Hapus Terpilih** → `POST /payroll/hapus-terpilih` (masuk Kotak Sampah).
- Tombol aksi baris (urutkan/hapus) tetap memakai form eksternal + atribut `form=` (jangan pernah dirender di dalam `<table>`).

### Anti "data stuck" & review screen
- Modal **Review & Simpan** dihapus; hanya tombol **Simpan Draf**. `public/app.js`: `pageshow` (persisted) → `location.reload()` dan tombol submit di-disable saat menyimpan, jadi tabel selalu menampilkan versi terbaru. Semua respons HTML sudah `Cache-Control: no-store`.
- Portal publik slip membaca tabel `payroll` langsung → perubahan draf langsung tampil tanpa langkah tambahan.

### Portal piutang = agregat saldo akhir per pegawai
- `dbm.piutangBuckets(kind, nama)` / `piutangBucketsAll(kind, taId)` / `piutangRingkasan(nama)`:
  - keterangan dibersihkan dari prefix **"Saldo awal TA … — "** berlapis (`stripCarryText`),
  - baris dikelompokkan per (pegawai, teks dasar, nominal). Salinan rollover (`isCarryText`) **tidak menambah jumlah utang** — jumlah utang = jumlah baris asli, sedangkan **seluruh pembayaran pada rantai salinan tetap mengurangi**.
  - `sisa = max(0, nominal × jumlahAsli − Σpembayaran)`; `sisa <= 0` → **LUNAS** dan tidak pernah tampil sebagai tagihan aktif.
- Portal `/portal-pegawai` memakai `piutangRingkasan()` (tabel aktif + blok "Riwayat LUNAS") → tidak ada lagi baris "Saldo awal …" ganda yang tampak belum lunas.
- `piutangPegawaiTotal(taId)` & `piutangLainTotal('Sertifikasi', taId)` memakai agregasi yang sama supaya dashboard/neraca tidak membengkak karena salinan rollover.
- Rollover (`rolloverTa`) kini menulis keterangan **tanpa menumpuk prefix** (teks dasar) dan dedupe memakai (nama, teks dasar, nominal).

### Test
```bash
node dev-tests/round11.js     # 49 cek: tarif honor, sertifikasi jam, kasbon tanpa potong, salin bulan urutan sama,
                              # review dihapus, hapus massal, import urutan Excel, portal agregat & LUNAS
node dev-tests/ui-round11.js  # 29 cek Playwright: ceklis, input jam, live calc, simpan anti-stuck, portal realtime,
                              # halaman tarif honor, portal piutang lunas, mobile tanpa overflow
```

## Pembersihan salinan piutang yatim (migrasi sekali jalan)

- `dbm.cleanupOrphanPiutang(user)` (db.js): menghapus baris `piutang` yang `tahun_ajaran_id`-nya **sudah tidak ada** di master `tahun_ajaran` (sisa rollover untuk TA yang kemudian dihapus — tidak pernah muncul di menu Piutang tetapi ikut terhitung di total).
  - Cicilan (`piutang_bayar`) pada baris yatim **dipindahkan lebih dulu** ke baris aktif: cocokkan `nama + stripCarryText(keterangan) + nominal` → `nama + nominal` → piutang belum lunas tertua pegawai tsb. Pembayaran tidak boleh hilang.
  - Baris yatim diarsipkan ke **Kotak Sampah** (`trashAdd`, alasan "salinan Saldo awal TA … yatim") lalu dihapus → masih bisa dipulihkan 30 hari.
  - Idempoten; dipanggil otomatis di `bootstrap()` sekali (flag setting `cleanup_piutang_yatim_v1`).
- **Gotcha**: `TRASH_DAYS`/`TRASH_LABEL` dulu dideklarasikan jauh di bawah `bootstrap()` sehingga `trashAdd` di dalam bootstrap melempar `Cannot access 'TRASH_DAYS' before initialization`. Keduanya kini dideklarasikan **sebelum** `cleanupOrphanPiutang`.
- Hasil pada DB live (2026-11): 168 baris yatim (68 baris TA 2024 + 70 + 30 baris bertanggal 1 Juli 2027) dihapus, 16 cicilan Rp 4.470.000 dipindahkan; total piutang menu turun dari Rp 7.986.425 → **Rp 7.586.425**; baris piutang tinggal 280 (semua TA aktif). Arsip ada di Kotak Sampah.
- Catatan: database live **read-only** dari Bash/Write saat app published — perubahan data live harus lewat kode aplikasi saat server start (pola migrasi di atas), bukan skrip langsung.

## Ronde 12 — riwayat pembayaran (hapus/edit), rekap input piutang, kelulusan manual, bulk siswa

### Riwayat pembayaran piutang bisa diedit & dihapus
- `POST /piutang/bayar/save` (edit nominal/tanggal/metode/keterangan; nominal dibatasi sisa = utang − cicilan lain) dan `POST /piutang/bayar/delete` — keduanya memanggil `refreshPiutang(pid)` yang menghitung ulang `status`/`tanggal_bayar` dari total cicilan.
- `POST /piutang-lain/bayar/save` & `POST /piutang-lain/bayar/delete` (memakai `refreshPiutangLain(pid)`); bila baris punya `transaksi_id` (pembayaran masuk BKU) transaksi itu ikut dihapus — **hanya bila periode BKU belum dikunci** (`periodeLockError`).
- Baris yang dihapus masuk Kotak Sampah (`piutang_bayar` / `piutang_lain_bayar` sudah ada di `TRASH_LABEL`).
- UI: tombol edit (`data-open="mBayarEd<id>"` / `mPlBayarEd<id>"`) + hapus di modal **Riwayat Cicilan/Pembayaran**; modal edit dikumpulkan lewat `late()` (jangan render di dalam `<table>`).

### Riwayat Rekap Input Piutang (paling bawah /piutang)
- Kartu `#rekapInput` (setelah kartu SPP) menggabungkan **piutang umum + sertifikasi** satu TA: Waktu Input (`created_at`), Jenis, Nama, Tanggal Utang, Nominal/Dibayar/Sisa, Status, Keterangan, Aksi **Edit** & **Hapus** (umum → `/piutang?edit=`, sertifikasi → `/piutang-lain?edit=`), diurut dari input terbaru.

### Kelulusan TIDAK lagi otomatis
- Panggilan `dbm.autoGraduateStudents()` di `POST /tahun-ajaran/save` dan `/tahun-ajaran/aktifkan` **dihapus**; `setGradNotice()` + modal `mGradNotice` di dashboard juga dihapus dan setting `graduate_notice` dibersihkan di bootstrap.
- Kelulusan sekarang **manual**: menu **Data Siswa** → ceklis siswa → **Perubahan Massal** → pilih status **Lulus**.
- Helper `autoGraduateStudents(prevTaId,user)` masih ada di db.js (tidak dipanggil otomatis).

### Data Siswa: ceklis + perubahan massal
- Kolom ceklis `name="siswa"` + header `data-check-all-box="siswa"`, tombol `data-check-all/none="siswa"`, penghitung generik `<b data-check-count="siswa">` (lihat `syncCount()` di `public/app.js`).
- Form `#fBulkSiswa` → `POST /siswa/bulk` (guard `siswa.edit`): penetapan **kelas_id** (mencatat `siswa_mutasi`) dan/atau **status** (aktif/nonaktif/lulus/pindah/do). Minimal salah satu wajib dipilih. Jika status non-aktif → redirect ke `/siswa-nonaktif`.
- CSS generik baru: `.pick-cell` (dipakai juga oleh leger payroll) dan `.bulk-panel`.

### Test
```bash
node dev-tests/round12.js     # 49 cek: hapus/edit riwayat pembayaran (umum & sertifikasi), kartu rekap input,
                              # tanpa auto-graduate + tanpa notifikasi dashboard, bulk kelas & status kelulusan
node dev-tests/ui-round12.js  # 26 cek Playwright: ceklis & pilih semua, penghitung, bulk via UI, modal riwayat,
                              # kartu rekap input di bawah, dashboard tanpa pop-up, mobile tanpa overflow
```

## Ronde 13 — Integritas mutasi akademik + modul Piutang Lainnya

### 1. Penempatan kelas per tahun pelajaran (`siswa_penempatan`)
Tabel baru: `siswa_penempatan (siswa_id, kelas_id, tahun_ajaran_id, sumber, mutasi_id, created_at, updated_at, UNIQUE(siswa_id, tahun_ajaran_id))`.

**Masalah lama**: `siswa` hanya punya satu `kelas_id`/`tahun_ajaran_id`; mutasi lintas TA me-`UPDATE` baris itu sehingga siswa hilang dari rekap TA asal (pernah terjadi di DB live: 138 siswa 2026/2027 "pindah" ke 2025/2026 dan rekap TA asal tinggal 79 siswa).

**Aturan sekarang**
- Satu baris penempatan = siswa terdaftar di satu kelas pada satu TA. Mutasi/penetapan kelas **tidak pernah** menghapus baris TA lain.
- `siswa.kelas_id`/`siswa.tahun_ajaran_id` = **cache penempatan terbaru** saja; diselaraskan oleh `dbm.siswaSyncCurrent(siswaId)` (urutan kronologis TA: `tanggal_mulai` → `nama` → `id`, helper `dbm.taSortKey`).
- Helper: `dbm.penempatanSet(siswaId, kelasId, taId, {sumber, mutasiId, overwrite})` (overwrite:false untuk merekam TA asal), `dbm.penempatanList(siswaId)`.
- **Semua jalur tulis wajib memanggil `penempatanSet` + `siswaSyncCurrent`**: `/siswa/save`, `/siswa/kelas`, `/siswa/bulk`, `/siswa/import/commit`, `/mutasi-kelas/apply`.
- `/mutasi-kelas/apply`: (1) pastikan penempatan TA asal (`overwrite:false`), (2) upsert penempatan TA tujuan, (3) `siswaSyncCurrent`. Draft menyimpan `ta_asal_id` dari **kelas asal yang dipilih** (bukan cache siswa) → form mutasi mengirim hidden `kelas_asal`.
- `dbm.siswaList({taId})` memakai penempatan TA tersebut (LEFT JOIN + fallback `s.tahun_ajaran_id` untuk data lama), `kelasList().jumlah_siswa` juga menghitung penempatan TA kelas itu, `iuranTagihanRows`/`iuranBayarRows` me-join kelas lewat penempatan TA tagihan.
- Migrasi bootstrap (idempoten): penempatan dari kolom siswa + **backfill riwayat dari `siswa_mutasi`** (ta_asal/kelas_asal & ta_tujuan/kelas_tujuan) → data yang dulu "hilang" otomatis kembali ke rekap TA asal saat server start.
- UI: halaman Mutasi Kelas menampilkan TA asal/tujuan pada draf, jenis mutasi (lintas/dalam TA), alert bahwa data TA asal tidak dihapus, dan tabel **Riwayat Mutasi Terakhir**; detail siswa punya kartu **Riwayat Penempatan Kelas**.

### 2. Modul Piutang Lainnya (`routes/piutang_lainnya.js`, RBAC `piutang_lainnya`)
Tabel terpisah dari piutang sertifikasi (tidak saling memengaruhi): `piutang_kategori` (nama, keterangan, `tampil_aset`, aktif, urutan), `piutang_lainnya`, `piutang_lainnya_bayar`.
- Halaman `/piutang-lainnya`: KPI, **master kategori CRUD** (tambah/edit/hapus; hapus ditolak bila masih ada tagihan; duplikat nama ditolak), rekap per nama + **Bayar Gabungan** (FIFO), tabel tagihan (edit/hapus/bayar/riwayat/bukti), import Excel/CSV (per kategori), export Excel, cetak PDF.
- Pembayaran: toggle **Masuk ke BKU** → transaksi pemasukan CoA 4.1.03 (opsional, seperti sertifikasi); tanpa toggle hanya mengurangi piutang. Edit/hapus riwayat menghitung ulang sisa & status; hapus riwayat ikut menghapus transaksi BKU terkait bila periode belum ditutup.
- Status tagihan disinkronkan `dbm.piutangLainnyaSyncStatus()` (sumber kebenaran = tabel pembayaran).
- **Sakelar aset**: setting `tampil_piutang_lainnya` (default '1') untuk modul + `piutang_kategori.tampil_aset` per kategori. `dbm.piutangLainnyaAset(taId)` = total sisa kategori `tampil_aset=1` bila modul aktif, dipakai di dashboard, `/aset` (baris "Piutang Lainnya — <kategori>" + kartu panel), `asetData/asetRows` laporan (Rekonsiliasi Kas), dan laporan `r=lainnya`.
- Laporan: tab **Piutang Lainnya** (`/laporan?r=lainnya`) + `/cetak/lainnya` + `/export/lainnya`.
- `piutang_kategori`, `piutang_lainnya`, `piutang_lainnya_bayar`, `siswa_penempatan` sudah masuk `TABLES` backup/restore & `TRASH_LABEL`.
- Rollover TA ikut menyalin sisa piutang lainnya (mempertahankan `kategori_id`).

### Test
```bash
node dev-tests/round13.js     # 84 cek: mutasi lintas TA (rekap asal & tujuan utuh), penempatan/sinkron cache,
                              # riwayat penempatan, kategori CRUD + duplikat + hapus, tagihan, cicilan (BKU/tanpa BKU),
                              # bayar gabungan, edit/hapus riwayat, sakelar aset per kategori & modul, import/export/cetak,
                              # RBAC kepsek, laporan lainnya, backup ZIP memuat tabel baru
```

### Gotcha
- Jangan pernah `UPDATE siswa SET kelas_id=...` langsung untuk mutasi/penetapan kelas — selalu lewat `penempatanSet` + `siswaSyncCurrent`, kalau tidak riwayat TA asal hilang lagi.
- `dev-tests/ui-round10.js` gagal di `#kasbon` (sudah tidak ada di halaman payroll) — kondisi lama, bukan regresi ronde ini.

## Ronde 14 — cetak kwitansi 1 lembar (210×99 mm), isolasi TA iuran, modul "siswa lulus" dihapus, pembersihan data hantu

### Cetak kwitansi
- `ui.kwitansiKop(settings)` = kop RINGKAS (logo 34px + 3 baris: yayasan / nama sekolah / alamat) memakai `kop_baris` (baris 0, baris ke-4, baris terakhir). Dipakai kwitansi transaksi `/transaksi/:id/kwitansi` di atas `.kwit-box`.
- `ui.kwitansiPage()` default **210 × 99 mm**, margin **4/6 mm**; pageCss merapatkan padding (2px), `line-height:1.15`, `.sign-grid .space{height:32px}`, `.kwit-foot`. Body memakai class `print-page kw-page`; `@media print` mengunci `html`/`body` setinggi area cetak + `overflow:hidden`.
- Migrasi sekali (`kw_trx_compact_v1`) memaksa `kw_trx_*` = 210×99 & margin 4/4/6/6 (nilai lama pemilik 297 mm ditimpa sesuai permintaan).
- Kwitansi iuran `/iuran/kwitansi`: `.kwit-iuran.kuitansi-container` tinggi `innerH − 0,8 mm` (`box-sizing:border-box`), `overflow:hidden`, `page-break-after:always` kecuali anak terakhir, class `dense` bila > 6 item. Body `kw-iuran-single` hanya untuk SATU kwitansi (mode multi tidak dikunci tingginya agar semua lembar tercetak).
- **Gotcha Playwright**: `page.pdf()` harus dipanggil saat `emulateMedia({media:'print'})` masih aktif. Kalau dikembalikan ke screen dulu, `.doc-actions` ikut tercetak → 1 lembar jadi 2 halaman (seperti kegagalan palsu).
- `.kuitansi-container, .print-wrapper, .kwit-iuran, .kwit-wrap` diberi `page-break-inside:avoid` di `@media print` app.css.

### Iuran
- **Live search**: input `q` di `/iuran/data` & `/iuran/transaksi` memakai hook generik `data-table-search="#tblDataIuran"` / `"#tblTrxIuran"` (filter instan tanpa submit; tombol Terapkan tetap ada untuk pencarian server).
- **Isolasi TA ketat**: `/iuran/data/:id` hanya memuat tagihan & pembayaran SATU tahun pelajaran (`?ta=` → TA sesi → TA terbaru yang punya tagihan) + dropdown TA + peringatan bila kosong. Link dari Data Iuran dan semua `back` form bayar membawa `?ta=`.
- **Modul "Sisa Tagihan Siswa Lulus" DIHAPUS**: route `/iuran/lulus` + `/iuran/lulus/writeoff`, item NAV, dan radio "Perlakuan Sisa Tagihan" di modal status siswa dihapus. Kuncian `writeoff` di `/iuran/bayar` & `/iuran/bayar-item` dihapus; migrasi `buka_kunci_writeoff_v1` mengosongkan `iuran_tagihan.writeoff` (363 baris di DB live).
- Kunci periode/BKU pada pencatatan pembayaran iuran **tidak lagi memblokir**: pembayaran tetap disimpan di antrean posting dengan pesan `Catatan: …`. Kunci tetap berlaku saat `/iuran/antrean/posting`.
- Penetapan grup ke kelas memakai `dbm.siswaList({kelasId, taId, status:[...]})` → siswa dari **penempatan TA terpilih**, bukan cache `siswa.kelas_id` (sebab dropdown kosong pada TA lampau).
- `POST /tahun-ajaran/save` punya opsi **Salin Kelas & Penempatan Siswa** (`salin_kelas`, default tercentang) → `dbm.cloneKelasTa()`: salin kelas TA sebelumnya dengan promosi X→XI, XI→XII (XII tidak disalin) lalu `penempatanSet` + `siswaSyncCurrent` untuk siswa aktif. Hanya berlaku bila TA baru kronologis setelah TA sumber.

### Pembersihan data hantu — `dbm.purgeGhostData()`
- Dipanggil di bootstrap (setiap start, idempoten, **tanpa** dialog konfirmasi): hard delete baris yang induknya hilang — `piutang/piutang_lain/piutang_lainnya/aset/beasiswa/anggaran/spp/bku/iuran_grup/kelas/siswa_penempatan` dengan `tahun_ajaran_id` tak ada; tagihan/nominal/transaksi/payroll_post/pinjaman_mutasi yatim; `iuran_bayar` yang menunjuk transaksi BKU hilang **dikembalikan ke `pending`** (tidak dihapus).
- Isi baris yang dihapus dicadangkan ke `data/purge-orphan-<waktu>.json` (maks 3 berkas) + audit `BERSIHKAN DATA HANTU`.
- Hasil di DB live: 66 baris (13 piutang sertifikasi 2027 milik TA terhapus, 9 aset, 2 beasiswa, 10 grup iuran + 32 nominal), 1 pembayaran iuran kembali ke antrean.

### Test
```bash
node dev-tests/round14.js     # 47 cek: isolasi TA, live search, writeoff/lulus dihapus, penetapan TA lampau & TA baru, purge data hantu, ukuran kwitansi
node dev-tests/ui-round14.js  # 15 cek Playwright: live search, pemilih TA, menu lulus hilang, kop kwitansi, tanpa scroll horizontal
node dev-tests/print.js       # 33 cek cetak: hitung halaman PDF (transaksi, piutang, iuran 1 & 7 item, 2 kwitansi) + ukuran elemen
```
- **Usang sebelum ronde ini (bukan regresi)**: `dev-tests/final2.js` (14 cek payroll/beasiswa — regex `data-payroll-row` tidak cocok dengan markup drag-handle), `dev-tests/final.js` (1 cek "pembantu pajak" — `coa_id` hardcode), `dev-tests/ui-round10.js` (`#kasbon` sudah tidak ada).

## Ronde 15 — Design Center cetak, orientasi global, beasiswa auto-lunas, filter laporan per bulan, reset TA, audit orphan

### Pusat Desain & Orientasi Cetak (`printcfg.js` + `routes/desain.js`)
- `printcfg.js` = katalog 11 dokumen (`DOCS`): kunci, label, orientasi default, dan daftar field redaksional (label) tiap dokumen.
  Tersimpan di setting **`print_design`** (JSON `{docs:{<key>:{orient,labels:{...}}}}`).
  Helper: `readAll(dbm)`, `saveFromBody(dbm, body)`, `labels(dbm, key)`, `orient(req, dbm, key)`, `pageRule()`, `ORIENT`, `ORIENT_LABEL`.
- Halaman **`GET/POST /desain-cetak`** (nav "Desain Templat Cetak", guard `sekolah`): pilih orientasi default + ubah teks label per dokumen. Kolom dikosongkan → kembali ke default.
- `ui.docPage()` / `ui.printPage()` / `ui.kwitansiPage()` menerima **`orient`** dan **`selfPath`**; bila `selfPath` diisi, halaman cetak menampilkan `ui.orientToggle()` (tombol **Portrait / Landscape**).
  Urutan orientasi efektif: `?orient=` pada URL → default dokumen dari Design Center.
- **Default sekarang PORTRAIT A4** untuk kwitansi transaksi & kwitansi iuran (dulu dipaksa 210×99 mm / landscape). Format 1/3 F4 (210×99 mm) tetap ada sebagai opsi ketiga `orient=small`; ukuran kertas kustom (`/transaksi/kertas`) hanya dipakai di mode `small`.
- **Jangan** menulis `@page{size:...landscape}` hard-coded lagi — selalu lewat `printcfg.orient()`.
- Kwitansi transaksi: label "terima dari" pengeluaran default **"Bendahara Sekolah"** (`lbl_kwitansi_trx_dari_keluar`, dipakai untuk label & isian). TTD 3 kolom dirender `sigCol()` dengan `.sig-head` (tinggi tetap) + `.space` + `.nm` sehingga **header dan nama sejajar**; kolom ke-3 berisi `kota, tanggal` di atas teks Penerima/Penyetor.
- Slip honor (payroll & portal) **tanpa** kolom tanda tangan Bendahara/Penerima. Honor ekskul: teks "Tanda Tangan Bendahara Sekolah" → **"Bendahara"** (bisa diubah di Design Center).

### Portal Piutang Pegawai
- Rincian portal (`piutangResult`) kini juga memuat tabel **"Piutang Lainnya"** (tabel `piutang_lainnya` + cicilan) yang masih `sisa > 0`, ikut di KPI "Piutang Lainnya" & total sisa.

### Beasiswa Enforcement — auto-lunas & terkunci
- Kolom baru: `iuran_bayar.sumber` ('manual'|'import'|'beasiswa'), `iuran_bayar.beasiswa_id`, `iuran_tagihan.beasiswa_locked`, `iuran_tagihan.beasiswa_id`.
- `dbm.beasiswaSync(id)` (idempoten): hapus jejak lama → buat tagihan grup bila belum ada → tulis `iuran_bayar` **satu baris per bulan** (`status='beasiswa'`, `sumber='beasiswa'`, tanpa `bku_id`/`transaksi_id`) → set `beasiswa_locked=1`.
  `dbm.beasiswaSyncAll()`, `dbm.beasiswaCleanup()` (buang jejak beasiswa yang sudah dihapus).
- Dipanggil saat: `/beasiswa/save` (edit), `/beasiswa/save-final`, dan `/beasiswa/delete` (jejak dibersihkan).
- **Terkunci**: `/iuran/bayar`, `/iuran/bayar-item`, `/iuran/bayar/delete`, `/iuran/tagihan/delete` menolak tagihan/pembayaran ber-`beasiswa_locked` atau `sumber='beasiswa'` dengan pesan "ubah melalui menu Beasiswa SPP". UI menandai baris `.row-locked` + chip `.lock-note`, checkbox & tombol bayar dinonaktifkan.
- Filter penerima: **pencarian nama/NISN** (`?q=`, live `data-table-search="#tblPenerimaBea"`) + **dropdown kelas** (`?kelas=`).

### Bulk Unassign Penetapan Iuran
- `/iuran/grup/:id` tabel "Siswa yang Ditetapkan" memakai form luar `#fLepas` (input `form="fLepas"`), ceklis `data-check-group="lepas"` + `data-check-group-box="lepas"` + tombol `data-check-group-all|none`.
- `POST /iuran/grup/:id/lepas` (guard `iuran.delete`): hapus penetapan terpilih **beserta** pembayaran/transaksi BKU terkait (masuk Kotak Sampah); baris terkunci beasiswa & periode BKU ditutup dilewati dengan pesan.

### Import iuran per bulan (SPP)
- `importColumns(groups)` + `resolveImportCol(prefix)` (routes/iuran.js): grup bulanan → pasangan kolom **`<GRUP>-<Bulan> TANGGAL BAYAR` / `… NOMINAL BAYAR`** per bulan bernominal; grup non-bulanan tetap satu pasang kolom.
- Parser header toleran (tanpa `-`, spasi, em dash) dan menyimpan `iuran_bayar.bulan`; validasi sisa **per bulan**. Template & modal import menjelaskan format kolom baru.

### Instant Search Global (`public/app.js`)
- Blok `INSTANT SEARCH GLOBAL`: setiap `input[name=q|cari|search|keyword|kata_kunci|nama|nisn]` (type text/search) yang tidak punya `data-table-search` memfilter **semua tabel** di area utama (`.content/.portal-wrap/main`, kecuali di dalam `.modal` atau `.no-live-search`) secara realtime (debounce 120 ms). Tombol Filter tetap ada untuk pencarian server.

### Tahun Pelajaran terbaru di atas
- `dbm.allTahun()` diurutkan **kronologis menurun** (`tanggal_mulai DESC, nama DESC, id DESC`) — `aktif` hanya penanda default login, tidak lagi mengangkat TA ke atas. Berlaku untuk Master TA & semua dropdown TA.

### Laporan/Export per bulan + Target BKU
- `bkuData(bkuIds|[], from, to, taId)` — `bkuArg=''`/`'all'` = **SEMUA BKU** (transaksi digabung, saldo awal = Σ saldo awal; kolom "Buku Kas" muncul).
- Helper: `taMonths(ta)`, `monthRange(ta,'YYYY-MM')`, `bulanSelect(ta,value)` (**1 Tahun Pelajaran (Penuh)** / **Rincian <Bulan> <Tahun>**), `bkuSelect(bkuss,value)` (Semua BKU / spesifik), `qBulans()`.
- `?bulan=YYYY-MM` memaksa mode **rincian transaksi aktual** (bukan rekapan) pada `/laporan?r=bku`, `/cetak/bku`, `/export/bku`.
- `lraData(taId, from, to)` mengembalikan `detail` (transaksi belanja periode) → tabel rincian di halaman/cetak/export LRA saat filter bulan dipakai.
- `dbm.arusKasData(taId, from, to, bkuIds)` + filter bulan & Target BKU di `/laporan?r=aruskas`, `/cetak/aruskas`, `/export/aruskas`.
- `/laporan?r=pembantu` & `/cetak/pembantu` menerima `bulan` + multi-BKU; **baru**: `GET /export/pembantu` (XLSX).

### Reset Data per Tahun Pelajaran
- `dbm.resetTaData(taId, user, {cadangan})` (db.js): hapus transaksi BKU TA tsb, `bku_periode`, `koreksi`, `bku_import`, `rekon_saldo`, `iuran_bayar`+`iuran_tagihan`, `payroll`/`payroll_post`/`payroll_draft` (rentang periode TA), `ekskul_honor`, `mutasi_kas`, `spp`, `piutang*` (+cicilan), `beasiswa` (+penerima), `pinjaman_mutasi` akun TA; lalu `bku.saldo_awal=0` & status `aktif`, `aset.saldo=0`.
  **Tidak** menghapus siswa/kelas/pegawai/CoA/BKU master/TA lain/grup iuran/anggaran.
  Cadangan `data/reset-ta-<ta>-<stamp>.json` (maks 3).
- `GET/POST /reset-tahun` (routes/desain.js) — **hanya Super Admin**: halaman menampilkan hitungan baris per TA; POST wajib `password` akun + ketik `RESET`. Non-super mendapat halaman "Akses ditolak"; POST ditolak dengan audit `RESET DITOLAK`.

### Audit Data Tersembunyi (`/audit-orphan`)
- `ORPHAN_CHECKS` (19 pola) memindai: transaksi tanpa BKU/CoA, jurnal pembalik tanpa asal, `iuran_bayar` tanpa tagihan / menunjuk transaksi hilang, tagihan tanpa grup/siswa atau beda TA, cicilan piutang (3 tabel) tanpa induk, piutang* menempel TA terhapus, payroll/payroll_post yatim, ekskul menunjuk transaksi hilang, mutasi aset yatim, `bku_periode` yatim, beasiswa TA terhapus.
- `POST /audit-orphan/hapus` (**Super Admin**) — per baris (`tabel`+`id`, di-whitelist `DELETE_TABLES`) atau seluruh kategori (`kode`+`semua=1`); hard delete + audit `HAPUS PERMANEN` + `piutangSyncStatus()`.

### Portal Slip Gaji Pegawai — pilih periode
- `GET /portal-slip/hasil?token=&bulan=&tahun=` (publik, wajib OTP terverifikasi) merender **dua dropdown**: **Bulan** (Jan–Des, tanda `•` bila ada data) & **Tahun / Tahun Pelajaran**; keduanya `data-autosubmit` → data ter-update realtime tanpa JS baru.
- Default (`pickPeriode`): bulan berjalan bila ada record; bila tidak → periode terakhir yang tersedia (dengan catatan penjelas).
- Periode tanpa data → `Data slip gaji untuk periode <Bulan Tahun> belum tersedia.` (alert info, tanpa nominal).
- `slipRowOf(nama, periode)` memilih satu baris leger terbaik (bila ada duplikat periode, ambil nilai penerimaan terbesar — bukan sembarang `id DESC`).
- Cetak: `GET /portal-slip/cetak?token=&periode=YYYY-MM` hanya periode itu; judul dokumen **"SLIP GAJI PEGAWAI — PERIODE: OKTOBER 2026"**; periode kosong → dokumen tetap tercetak dengan pesan "belum tersedia".

### Test ronde 15/16
```bash
node dev-tests/round15.js     # 73 cek: portal piutang lainnya, bulk unassign, design center, orientasi kwitansi,
                              # default "Bendahara Sekolah", TTD sejajar, slip/ekskul, template SPP per bulan,
                              # beasiswa auto-lunas & terkunci, sorting TA, laporan/export per bulan + multi BKU,
                              # reset TA (sandi+konfirmasi), audit orphan + hard delete
node dev-tests/ui-round15.js  # 22 cek Playwright: instant search (transaksi & piutang), design center, TTD sejajar,
                              # toggle landscape, filter beasiswa, bulk unassign
node dev-tests/round16.js     # 25 cek: dropdown periode portal slip, data per periode, pesan kosong, cetak per periode
node dev-tests/ui-round16.js  # 14 cek Playwright: auto-submit dropdown, cetak ikut periode, mobile 390px
```
- Disesuaikan karena perubahan perilaku yang DISENGAJA: `round9.js` (kwitansi default A4 portrait + `orient=small`,
  slip portal per periode), `round7.js` (label ekskul "Bendahara"), `print.js` & `ui-round14.js` (mode `orient=small`),
  `final.js` (`coa_id` pajak dinamis), `ta.js`/`ta-ui.js` (teks "X dari Y transaksi"), `audit3.js`/`ui-final.js` (label "Rekonsiliasi Kas").

---

## Ronde 17 — Non-BKU antrean, pelonggaran tutup bulan, iuran bulanan, catatan pegawai, backup menyeluruh, .env

### 1. Antrean posting iuran: opsi & tombol Non-BKU
- Status `iuran_bayar` yang dipakai: `pending` (antrean BKU) · `posted` · **`manual`/`nonbku` = DATA SAJA (Non-BKU)** · `void` · `beasiswa`. Tidak ada kolom baru.
- `POST /iuran/antrean/nonbku` (`ids=1,2,3`) → `status='manual'`, `transaksi_id=NULL`, `bku_id=NULL`. Audit `NON-BKU IURAN`. Tidak membuat transaksi BKU.
- `POST /iuran/antrean/edit` kini menerima `status_tujuan` = `pending` | `manual`. Untuk `pending` **wajib** `bku_id` aktif (dipakai bila baris dikembalikan ke antrean). `manual` → `bku_id=NULL`.
- Halaman `/iuran/antrean` punya **dua tombol aksi utama** per kelompok (dan di footer modal Tinjau): **Posting ke BKU** (hijau) & **Hanya Simpan Data (Non-BKU)**. Tombol pertama memakai hidden `coa_id` default; pemilihan CoA tetap ada di modal.
- Halaman antrean kini 3 kartu: **Antrean Posting BKU**, **Rincian Penerimaan Belum Terposting** (pending), **Penerimaan Non-BKU (Data Saja)** (manual, bisa diedit kembali ke antrean).
- **Gotcha diperbaiki**: `${late.html()}` dulu dipanggil sebelum `late('mE…')` milik tabel rincian → modal edit per baris tidak pernah terender. Sekarang **satu** `${late.html()}` di akhir `content` (pola wajib: semua `late()` harus selesai sebelum `late.html()`).

### 2. Validasi tutup bulan dilonggarkan
- `dbm.periodeLockError()` sekarang **hanya** memblokir periode berstatus **`ditutup`** (pesan mengarahkan ke tombol **Buka Kembali**). Status `terlewat` (bulan lalu belum ditutup) **tidak lagi** memblokir input/posting.
- Konsekuensi: pesan lama "Bulan … sudah berganti dan BKU bulan tersebut belum ditutup…" **hilang** (jangan dimunculkan lagi). Badge "belum ditutup" di daftar transaksi ikut hilang karena `lockInfo` selalu null.
- `routes/payroll.js` posting honor: workaround "pindahkan ke bulan berjalan bila periode leger `terlewat`" **dihapus** — honor selalu dibukukan pada akhir periode leger sendiri (`catatanTanggal` dihapus).
- Notifikasi dashboard `dbm.unclosedPeriods()` tetap ada (informasi, bukan blokir).
- Test yang disesuaikan karena perubahan perilaku ini: `round9.js` (kartu Non-BKU di antrean), `round14.js` (tidak ada lagi "Catatan periode" saat bayar di bulan belum ditutup).

### 3. Rincian iuran bulanan (Juli … Juni)
- Halaman baru `GET /iuran/bulanan` (`active:'iuran_bulanan'`): matriks **siswa × 12 bulan** (`dbm.BULAN_TA` = 7..12,1..6). Sel: nominal + tanda `✓` lunas / `½` sebagian / `!` belum / `—` tidak ditagihkan; filter TA, q, kelas & grup multi-pilih. Total tagihan/bayar/terhutang di tfoot.
- Data: `iuranTagihanRows()` (grup bulanan) + satu query `iuran_bayar` per TA, dialokasikan lewat `monthlyDetail()`.
- Detail siswa `/iuran/data/:id` kini merender **12 baris `tr.month-row`** (bulan tanpa nominal → badge "Tidak ditagihkan", tanpa ceklis/tombol bayar).
- CSS: `.bulanan-tbl`, `.bulan-cell.lunas|sebagian|kurang|kosong`, `.sticky-col(2)`, `tr.row-muted`.

### 4. Catatan Pegawai → Bendahara (modul `catatan`)
- Tabel `catatan_pegawai` (`user_id, nama, jabatan, pesan, terkait, periode, status, balasan, balas_oleh, balas_at, tahun_ajaran_id, created_at, updated_at`). Status: `baru` → `diproses` → `selesai`.
- Helper `dbm.catatanAdd/List/Count/Reply/Status/Delete` + `CATATAN_STATUS`.
- `routes/catatan.js`: `GET /catatan-pegawai` (form + daftar), `POST /catatan-pegawai/kirim` (create), `POST /catatan-pegawai/balas|status` (edit), `POST /catatan-pegawai/delete` (delete).
- **Nama & jabatan pengirim diambil dari sesi login di server** (`req.user`) — field `nama`/`jabatan` dari klien diabaikan (diuji dengan mengirim nama palsu).
- RBAC: modul baru `catatan` — staff & kepala sekolah = view+create (kepala sekolah juga edit), super_admin penuh. Nav grup baru **Komunikasi Internal** (Catatan Pegawai + Pesan Orang Tua dipindah ke sini).
- Dashboard: kartu `#catatanPegawai` (bendahara: semua catatan + badge "perlu ditindaklanjuti"; staff: catatan sendiri).
- `catatan_pegawai` masuk `TABLES` backup/restore.

### 5. Backup menyeluruh level admin (`/backup`)
- `GET /backup/export-database` → dump **.sql** portabel (`DROP/CREATE` dari `sqlite_master` + `INSERT` seluruh baris, nilai di-escape, diakhiri `COMMIT`). Guard `backup.create`.
- `GET /backup/download-source` → ZIP source code: `server.js, env.js, db.js, lib.js, ui.js, wa.js, xlsx-read.js, importer.js, impcache.js, printcfg.js, package*.json, .env.example, .gitignore, AGENTS.md` + folder `routes/`, `public/`, `dev-tests/` + `README-SOURCE.txt` (cara pasang di VPS). **Tidak** menyertakan `data/`, `node_modules/`, `.git/`, `*.sqlite*`, `.env`, `.vibecoder-media-token`.
- `TABLES` (backup/restore) ditambah `catatan_pegawai, portal_pesan, otp_code`.
- Halaman `/backup` menampilkan kartu **Konfigurasi Lingkungan (.env)** dari `envCfg.describe()` (nilai sensitif disamarkan; penanda "dari .env" vs default).

### 6. Portable configuration (.env)
- `env.js` (tanpa dependency): memuat `.env` di folder aplikasi (atau `ENV_FILE`) saat `require('./env')`; **tidak menimpa** `process.env` yang sudah ada. Di-require paling atas oleh `db.js` & `server.js`.
- Variabel: `PORT`, `DB_PATH`, `APP_BASE_URL`, `APP_MEDIA_URL` (default `http://127.0.0.1:4310`, dipakai `uploadMedia`), `APP_MEDIA_TOKEN` (runtime platform), `WA_API_URL`, `WA_API_TOKEN`, `WA_API_PAYLOAD`, `STORAGE_QUOTA_MB`, `ENV_FILE`.
- `wa.waConfig()`: **env menang** atas setting `wa_api_url/token/payload` di DB. `wa.portalLink()` memakai `APP_BASE_URL` dan disisipkan ke pesan OTP portal pegawai ("Buka portal: …").
- Berkas contoh: `.env.example`; `.env` & `.env.local` masuk `.gitignore`.

### Test ronde 17
```bash
node dev-tests/round17.js     # 62 cek: non-BKU antrean (2 tombol, edit status bolak-balik), pelonggaran tutup bulan
                              # (terlewat boleh, ditutup diblokir, buka kembali), 12 baris bulan, catatan pegawai
                              # (nama otomatis, balasan, RBAC), export .sql, download source (isi & pengecualian), .env
node dev-tests/ui-round17.js  # 23 cek Playwright: matriks 12 bulan, 2 tombol antrean + modal, form catatan,
                              # menu baru, tombol backup, mobile 390px tanpa overflow, tanpa error JS
```

---

## Ronde 18 — rincian bulanan di portal publik, catatan di portal pegawai, ekskul per jenis, slug portal

### 1. Portal publik tagihan siswa: rincian bulanan (Juli … Juni)
- `routes/portal.js` `renderResults()` tidak lagi menampilkan grup bulanan sebagai satu baris. Setiap grup `jenis='bulanan'` **dijabarkan satu baris per bulan**: `SPP - Juli 2026`, `SPP - Agustus 2026`, … `SPP - Juni 2027` (label memakai `tanggal_mulai` tahun ajaran grup).
- Sumber angka = helper bersama **`dbm.iuranMonthDetail(grupId, payments)`** (dipindah ke `db.js`; dulu duplikat di `routes/iuran.js`) + `dbm.iuranPaysMap(ids)`. `routes/iuran.js` `monthlyDetail()` kini hanya mendelegasikan ke helper itu → angka portal, detail siswa, dan matriks bulanan **selalu identik**.
- Bulan tanpa nominal (tidak ditagihkan) tidak dirender; badge `Lunas` / `Sebagian` per bulan; baris `tr.month-line` + CSS `.portal-bill`.
- Subtotal tahun pelajaran dihitung dari **baris tampilan** (bukan dari `iuran_tagihan` mentah) supaya tidak dobel-hitung.
- Catatan orang tua: form tetap; riwayat 3 catatan terakhir siswa ditampilkan di atas form.

### 2. Portal piutang pegawai & slip gaji: kolom catatan untuk bendahara
- `portal_pesan` mendapat kolom **`sumber`** (`siswa` default · `piutang-pegawai` · `slip-pegawai`) dan **`ref`** (id pegawai/siswa). Migrasi ALTER otomatis + masuk SCHEMA.
- `catatanForm()` (di `routes/portal_pegawai.js`) dirender di halaman rincian piutang dan halaman hasil slip: nama pegawai otomatis (readonly), nomor WhatsApp terdaftar, pilihan "Terkait", riwayat 3 catatan terakhir.
- `POST /portal-pegawai/pesan` & `POST /portal-slip/pesan` → `handlePesan()`: **wajib sesi OTP terverifikasi** (`otp_code.verified=1` dan `jenis` cocok, `ref` = id pegawai) → tidak bisa mengirim catatan atas nama orang lain. Audit `CATATAN PEGAWAI` (modul `portal`).
- Piutang: konfirmasi dirender inline (`piutangResult({...ok})`). Slip: redirect ke `/portal-slip/hasil?...&ok=` — `/portal-slip/hasil` kini membaca `ok`/`err` dari query.
- `/pesan-orangtua` + kartu dashboard menampilkan **kolom Sumber** (Tagihan Siswa / Piutang Pegawai / Slip Pegawai).

### 3. Posting honor ekskul dipisah per JENIS
- `GET /ekskul/antrean` mengelompokkan pending per **(periode + jenis)**, bukan per periode lagi. Kartu berjudul `Pramuka — Periode Juli 2026`, dst., masing-masing punya form posting sendiri (hidden `jenis`) → **satu transaksi BKU per jenis**.
- `POST /ekskul/antrean/posting` menerima `jenis`; query memakai `COALESCE(TRIM(jenis),'')=?`. Tanpa `jenis` = perilaku lama (semua pending periode itu) untuk kompatibilitas.
- Uraian & `nama_pihak` transaksi memuat jenis (`Honor Pembina Ekstrakurikuler Pramuka <Periode> (n pembina)`), `syncBatch()` ikut memakai jenis pada uraian.
- `POST /ekskul/save`: **jenis item yang sudah terposting tidak boleh diubah** (satu transaksi = satu jenis).

### 4. Ujung alamat (slug) portal publik dapat diubah
- Setting baru: **`portal_slug`** (default `portal`), **`portal_pegawai_slug`** (`portal-pegawai`), **`portal_slip_slug`** (`portal-slip`). Diatur di **Identitas Sekolah → Alamat (URL) Portal Publik**.
- `db.js`: `PORTAL_SLUG_KEYS`, `PORTAL_SLUG_DEFAULT`, `RESERVED_SLUGS` (path aplikasi yang tidak boleh dipakai), `normalizePortalSlug()`, `portalSlugs()` (cache, di-reset oleh `setSetting`), `portalSlugError(raw, key)` (validasi: `^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$`; unik antar portal; bukan path aplikasi; nilai default selalu boleh).
- `server.js`: `dbm.portalRewrite(pathname)` dijalankan **sebelum** pencocokan route → `/<slug-kustom>` dipetakan ke route kanonik (`/portal`, `/portal-pegawai`, `/portal-slip`), termasuk semua sub-path (`/otp`, `/nama`, `/verifikasi`, `/hasil`, `/cetak`, `/pesan`). Alamat default tetap dapat dibuka.
- Semua tautan internal portal memakai slug aktif (`pgUrl()`, `slipUrl()`, `kindUrl()`, `url()` di portal siswa), termasuk `wa.portalLink()` (tautan "Buka portal" pada pesan OTP) dan tautan di halaman Pengaturan Sistem / Pesan Orang Tua.
- Validasi dijalankan **sebelum** menulis setting lain di `POST /sekolah` (tidak ada penyimpanan separuh).

### Test ronde 18
```bash
node dev-tests/round18.js     # 56 cek: 12 baris bulan di portal, subtotal tidak dobel, catatan piutang & slip
                              # (wajib OTP, nama otomatis), inbox bendahara per sumber, ekskul 2 transaksi terpisah,
                              # slug kustom + validasi (reserved/ganda) + alamat default tetap jalan
node dev-tests/ui-round18.js  # 16 cek Playwright: portal bulanan, form catatan portal pegawai, form alamat portal,
                              # 2 tombol posting ekskul, mobile 390px, tanpa error JS
```

---

## Ronde 19 — kwitansi pengeluaran, tempat-tanggal seragam, ikon portal, urutan TA portal

### 1. Kwitansi pengeluaran: "Telah diterima dari" → "Bendahara <sekolah>"
- `printcfg.js` DOCS `kwitansi_trx`: label `dari_keluar` default **`Telah diterima dari`** (dulu `Bendahara Sekolah`) dan **field baru** `nilai_dari_keluar` default **`Bendahara {sekolah}`** (`{sekolah}` = `settings.sekolah_nama`).
- `routes/transaksi.js` kwitansi: pengeluaran → label `L.dari_keluar`, isi `printcfg.fill(L.nilai_dari_keluar, {sekolah})`; pemasukan tetap memakai `nama_pihak`.
- **Migrasi konfigurasi lama**: `printcfg.readAll()` memakai `LEGACY_LABELS` — bila `print_design` tersimpan **belum punya** kolom `nilai_dari_keluar` (konfigurasi sebelum ronde ini) dan nilai `dari_keluar` = `Bendahara Sekolah`, otomatis dibaca sebagai default baru. Konfigurasi baru yang sengaja diisi `Bendahara Sekolah` tetap dihormati (karena sudah punya kolom `nilai_dari_keluar`).

### 2. Baris "Tempat, tanggal" seragam di semua cetakan (default Cikoneng)
- Setting baru **`print_tempat`** (default `Cikoneng`) + helper `printcfg.tempat(dbm)`, `printcfg.tempatTanggal(dbm, tanggal)`, `printcfg.fill(text, vars)`, konstanta `TEMPAT_DEFAULT`.
- Diatur di **Desain Templat Cetak** (`/desain-cetak`) → kartu **"Tempat pada Tanggal Cetak"** (input `name="print_tempat"`, kosong = kembali ke `Cikoneng`); disimpan oleh `printcfg.saveFromBody()` (yang kini juga menulis `print_tempat`).
- Dipakai oleh: kwitansi transaksi (`kota`), bukti piutang pegawai / sertifikasi / piutang lainnya, kwitansi iuran (2 jalur), honor ekskul, dan **`ui.signBlock()`** (laporan BKU/LRA/neraca/arus kas/pembantu/piutang, berita acara tutup BKU, leger & slip payroll, dll — semua pemanggil `signBlock` yang dulu mengirim `tempat: ''`).
- `ui.signBlock()` sekarang: `tempat = opts.tempat || settings.print_tempat || 'Cikoneng'` lalu dirender `"<tempat>, <tanggal>"` (dulu tanpa koma dan kosong).

### 3. Ikon "tanda seru" portal slip proporsional
- Penyebab: `ui.icon()` merender `<svg viewBox>` **tanpa width/height**, dan di `routes/portal_pegawai.js` (`slipResult`) ikon diletakkan di `<div class="help small">` yang tidak punya aturan ukuran → SVG melebar mengikuti kontainer (±822 px pada kartu portal).
- Perbaikan CSS (`public/app.css`): `.help svg` & `.hint svg` = 13×13, plus `.portal-card .alert svg` = 15×15 dan padding alert portal dipadatkan.

### 4. Portal tagihan siswa: urutan tahun pelajaran TERLAMA di atas
- `routes/portal.js` `renderResults()` menyusun ulang entri per tahun pelajaran dengan `dbm.taSortKey()` **ascending** (2024/2025 → 2025/2026 → …); tagihan tanpa TA diletakkan paling bawah.

### Test ronde 19
```bash
node dev-tests/round19.js     # 37 cek: label+isi "diterima dari", 7 halaman cetak + kwitansi iuran memakai
                              # "Cikoneng, <tanggal>", edit tempat lewat desain, konfigurasi lama termigrasi,
                              # template {sekolah} kustom, urutan TA portal
node dev-tests/ui-round19.js  # 17 cek Playwright: urutan baris kwitansi, TTD "Cikoneng, …", kolom tempat,
                              # ikon portal ≤24px, urutan TA portal, mobile 390px, tanpa error JS
```
- Disesuaikan karena perubahan perilaku yang DISENGAJA: `ui-round15.js` (label bawaan kwitansi pengeluaran).

### Gotcha ronde 19
- **`ui.icon()` tidak punya width/height** → jangan menaruhnya di kontainer tanpa aturan ukuran (`.help`, `.hint`, `p`, `span` polos); SVG akan memenuhi lebar kontainer. Sudah dijaga lewat CSS `.help svg, .hint svg{width:13px}` — bila menambah kontainer teks baru, tambahkan kelas `.help`/`.hint` atau atur ukuran svg-nya.
- Teks tempat cetak **hanya** dari `settings.print_tempat` (jangan pakai `sekolah_nama` sebagai tempat lagi).

---

## Ronde 20 — Manajemen Sistem: Auto-Backup cloud (SUDAH DIHAPUS di ronde 23, lihat bawah)

### Berkas & modul baru
- `backupdata.js` — sumber tunggal isi ZIP backup: `TABLES` (termasuk `cloud_backup`), `dumpAll(db)`, `csvOf`, `buildDatabaseZip(db)` (database.json + data/*.csv + README.txt), `backupFileName(date)` → `Backup_SIMKEU_03Nov2026_0600.zip`, `BACKUP_NAME_RE`. Dipakai bersama `/backup/download-zip` (routes/sistem.js) → isi ZIP manual & cloud identik.
- `gdrive.js` — klien Google Drive REST tanpa dependency: `parseCredentials/credSummary`, `accessToken` (JWT RS256 → OAuth2, cache), `folderInfo`, `listBackups`, `uploadBackup` (multipart ≤4,5 MB; **resumable** >4,5 MB), `deleteFile`, `cleanupOld`, `testConnection`, `cfgFromDb`, `isConfigured`, `scheduleTimes`, `nextRun`, `checkSchedule`, `startScheduler`, `runBackup`, `history`, `lastRun`.
- `routes/backup_cloud.js` — `GET /pengaturan-backup` + `POST /pengaturan-backup/simpan|jalan|uji|bersihkan`.
- Tabel `cloud_backup` (waktu, nama_berkas, ukuran, file_id, status, pesan, pemicu, user_nama, dihapus, durasi_ms) + index `idx_cloud_backup_waktu`; ikut `TABLES` backup/restore.
- Settings baru: `gdrive_credentials` (JSON service account), `gdrive_folder_id`, `gdrive_auto` (default `1`), `gdrive_times` (default `06:00,15:00`), `gdrive_retensi_hari` (default `30`), `gdrive_done` (JSON slot yang sudah dijalankan), `gdrive_last_slot`. `RESERVED_SLUGS` ditambah `pengaturan-backup`.

### Aturan
- Halaman & semua POST hanya untuk administrator: `guard(req,res,'backup','create')` (default hanya `super_admin`; kepala sekolah/staff tidak punya `backup.create`). Menu sidebar "Pengaturan Backup" memakai `action:'create'` → tersembunyi untuk role lain.
- Kredensial **tidak pernah dirender ulang** ke HTML (textarea kosong + info email tersimpan); isi kunci privat tidak ikut ke halaman.
- Dua kolom input = sumber autentikasi & destinasi: `gdrive_credentials` → JWT, `gdrive_folder_id` → `parents` saat upload. Folder ID boleh ditempel sebagai URL Drive (ID diekstrak otomatis).
- Validasi dilakukan **sebelum** menulis setting apa pun (JSON rusak / jam tidak valid → tidak ada penyimpanan separuh).
- Nama berkas versioning: `Backup_SIMKEU_<DD><Mon><YYYY>_<HHMM>.zip` (bulan Inggris 3 huruf, mis. `03Nov2026`).
- Retensi: setiap unggahan sukses memanggil `cleanupOld()` → hanya berkas yang **cocok pola `Backup_SIMKEU_*.zip`** dan `createdTime` lebih tua dari `gdrive_retensi_hari` (30) yang dihapus. Berkas lain di folder tidak pernah disentuh.
- Penjadwalan: `startScheduler(dbm)` di `server.js` (interval internal 30 detik + cek 15 detik setelah start, `unref`). Slot yang sudah dijalankan dicatat di `gdrive_done` → restart tidak menghasilkan backup ganda; toleransi 45 menit mengejar jadwal yang terlewat.
- **Tidak ada** pemanggilan backup dari route simpan transaksi/payroll/iuran (dijaga test).
- `runBackup` memakai penjaga `running` (satu proses backup pada satu waktu) & selalu menulis baris `cloud_backup` (sukses/gagal) + audit `BACKUP CLOUD`.
- Galat Drive diterjemahkan: `storageQuotaExceeded` → instruksi Shared Drive (akun layanan tidak punya kuota My Drive), 403/404 → cek share folder & Folder ID.

### Test
```bash
node dev-tests/cloud.js     # (DIHAPUS ronde 23) 77 cek: nama berkas dinamis, parsing kredensial, JWT/token cache, multipart & resumable,
                            # retensi 30 hari (hanya berkas backup), runBackup + log, scheduler sekali per slot,
                            # RBAC 403 untuk staff, kredensial tidak bocor ke HTML
node dev-tests/ui-cloud.js  # (DIHAPUS ronde 23) 20 cek Playwright: 4 kartu status, form kredensial/Folder ID, simpan via UI,
                            # tombol manual nonaktif saat belum dikonfigurasi, mobile 390px, tanpa error JS
```

---

## Ronde 21 — grafik SPP tunggal, hapus masal, beasiswa multi-grup, tema/branding/menu, demo sandbox

### 1. Grafik SPP & rekap per grup iuran
- `dbm.sppSeries(taId)` **tidak lagi** membaca tabel `spp` lama. Sumbernya sekarang **data iuran riil**: grup bulanan bernama SPP (fallback: semua grup bulanan) → `iuranMonthDetail()` per tagihan lalu dijumlah per bulan. Dashboard & halaman `/spp` memakai deret yang sama sehingga selalu sinkron.
- Dashboard hanya punya **satu** line chart SPP (kartu duplikat di bawah dihapus). Kartu `Grafik SPP per Bulan` di `/piutang` diganti kartu tautan ke `/spp` (chart batang lama tidak dipakai lagi).
- `iuranAnalytics()` kini mengisi `g.sel[bulan]` untuk grup **non-bulanan** berdasarkan **bulan tanggal pembayaran** → tabel "Rincian Penerimaan per Grup Iuran" tidak lagi kosong selain SPP. Footer GRAND TOTAL per bulan dihitung dari jumlah baris grup (bukan `monthMap`).

### 2. Hapus masal antrean posting & rekap transaksi
- Helper `hapusBayarMassal(ids, user)` di `routes/iuran.js` (dipakai `POST /iuran/bayar/hapus-masal`, guard `iuran.delete`): menghapus `iuran_bayar` (riwayat transaksi siswa ikut hilang), menghapus transaksi BKU terkait (bila `posted` & periode tidak ditutup), mengembalikan pembayaran se-kwitansi ke `pending`, mencatat Kotak Sampah + audit. Baris void/beasiswa dilewati (dilaporkan pada flash `warn`).
- UI: antrean (`Rincian Penerimaan Belum Terposting` & `Penerimaan Non-BKU`) punya ceklis `ids` + `data-check-all-box="ids"` + tombol **Hapus Terpilih** (`form="fHapusAntrean"`). Rekap transaksi memakai ceklis `fKwit` yang sudah ada + tombol `formaction="/iuran/bayar/hapus-masal" formmethod="post" formtarget="_self"`.
- `data-check-count="ids"` (hook generik app.js) menampilkan jumlah baris tercentang.

### 3. Beasiswa multi-grup & multi-siswa (`routes/beasiswa.js` ditulis ulang)
- Tabel baru `beasiswa_grup(beasiswa_id,grup_id,bulan_mask)`; helper `beasiswaGrupList/GrupSet`.
- `beasiswaSync()` iterasi penerima × grup (fallback `beasiswa.grup_id` bila tabel kosong), alokasi potongan FIFO per bulan; `beasiswa.nominal` = potongan per siswa × jumlah penerima.
- Halaman `/beasiswa` = **satu form** `#fBeasiswa` berurutan: (1) Detail, (2) Penetapan Siswa, (3) Rekap Data. Ceklis siswa (`name="penerima"`) & rekap memakai atribut `form="fBeasiswa"`.
- Bug "please fill out this field" berasal dari **dua elemen `id="fBeasiswa"`** (form tambah & form di modal edit) → `form="fBeasiswa"` menunjuk form pertama. Modal edit dihapus, edit memakai `?edit=<id>` pada form yang sama (hanya satu `#fBeasiswa`).
- Filter kelas & pencarian siswa **client-side** (`data-bea-kelas`, `data-bea-search`, `tr[data-bea-row]`) → tidak ada reload, isian nama/grup tidak hilang. Kalkulator nominal↔persen & ringkasan (`data-bea-calc`, `data-bea-rekap`) di `public/app.js` blok beasiswa.

### 4. Tema, branding & manajer menu
- Setting baru: `tema_warna` (#RRGGBB), `app_nama` (sudah ada, kini dipakai), `app_logo`, `nav_ui` (JSON: `{groups,order,labels,icons}`).
- `ui.themeCss(hex)` menurunkan seluruh `--o-*`, `--bg`, `--sh-1` + `body::before` dari satu warna (HSL) dan disuntik ke `layout`, `docPage`, `printPage`, dan halaman login. Halaman pengaturan: **`/tema`** (warna + palet cepat + nama aplikasi + logo aplikasi via media proxy).
- `ui.navOrdered(cfg)` menerapkan urutan kelompok, urutan item, judul kustom, dan ikon PNG (`iconUrl` → `<img class="nav-ico-img">`). Pengaturan global dibaca dari **database utama** (`dbm.mainSetting/navUiGlobal/…`) agar sesi demo tidak mengubah menu sekolah.
- `/tampilan-menu`: drag & drop baris (HTML5) + tombol ▲▼, geser kelompok, input judul per baris, unggah ikon PNG (rekomendasi 64×64 px), ceklis tampil/sembunyi, `#nav_order` & `#group_order` diisi JS saat submit. `POST /tampilan-menu` menerima `h_i`, `lbl_i`, `ico_i`, `ico_lama_i`, `rm_ico_i`; bila `h_*` tidak terkirim, urutan diambil dari `nav_order`.
- **Struktur menu baru**: grup **Piutang** (Piutang Pegawai, Sertifikasi, Lainnya) terpisah dari grup **Grup Iuran**; menu **SPP** (`/spp`) ada di **paling bawah** grup Grup Iuran. Grup **Bantuan** (Petunjuk Pengguna) di urutan terakhir.

### 5. Identitas sekolah & tarif honor
- Kolom "Tarif Standar Tugas Tambahan" & "Sertifikasi per jam" **dihapus** dari `/sekolah` (sekarang hanya di `/tarif-honor`, termasuk `honor_tugas_jam` sebagai tarif cadangan). POST `/sekolah` tidak lagi menulis setting tarif.
- Checkbox `portal_aktif` dihapus dari `/sekolah` (satu-satunya pengaturan ada di `/pengguna` → Pengaturan Sistem).

### 6. Catatan Pegawai vs Catatan Orang Tua + Petunjuk Pengguna
- `/catatan-pegawai` untuk pemegang `catatan.edit` = **rekap murni** (tanpa form kirim). Staff tetap melihat form kirim + catatan sendiri.
- `/catatan-orangtua` (alamat lama `/pesan-orangtua` tetap dilayani, bukan redirect): rekap `portal_pesan` + filter sumber/status + **tombol hapus per baris** (`POST /catatan-orangtua/delete`, guard `dashboard.delete` atau `catatan.delete`). `portalPesanList({sumber})` mendukung filter.
- Modul & tabel baru **Petunjuk Pengguna**: `panduan` (judul, kategori, ringkas, thumbnail, video_url, pdf_url, urutan, aktif). Halaman `/petunjuk` menampilkan kartu thumbnail + modal YouTube embed (`youtube.com/embed/<id>`) + tautan PDF. Thumbnail/PDF diunggah lewat media proxy. Modul RBAC `panduan` (view untuk semua role).

### 7. Akun Demo (sandbox database dummy)
- Peran baru `demo` (`ROLE_LABEL.demo`, `ROLES`, `DEMO_BLOCKED = pengguna, sekolah, backup, trash, audit, tahun_ajaran, saldo_awal`).
- **Isolasi database**: `db` di `db.js` kini **Proxy** yang membaca `AsyncLocalStorage`. `dbm.runAsDemo(fn)` (dipanggil `server.js` untuk setiap request role demo) mengarahkan **semua** query ke `data/demo.sqlite` (`DEMO_DB_PATH`). `dbm.ensureDemoDb()` membuat skema + master awal saat pertama dibutuhkan; `dbm.resetDemoDb()` mengosongkan isi dummy.
- Yang **selalu** memakai database utama (`dbm.mainDb`): `currentUser`, `setSession`, `can`, `permissionMatrix`, logout, `/ta/pilih`, serta setting tampilan global (`mainSetting`, `setMainSetting`, `navUiGlobal`, `temaWarnaGlobal`, `appNamaGlobal`, `appLogoGlobal`).
- Tahun ajaran untuk sesi demo dipaksa ke TA database dummy (`req.TA`/`req.taId` ditimpa di server.js) karena id TA DB utama tidak berlaku di sandbox.
- Kontrol akses demo = **Permission Matrix role "Akun Demo"** di `/pengguna` (+ ceklis tampil/sembunyi menu). Default: semua modul operasional boleh, modul sistem diblokir.
- Password demo: `POST /akun` menolak perubahan sandi bila `users.role='demo'`; admin tetap bisa mengatur lewat form pengguna. Halaman `/akun` menampilkan pemberitahuan khusus.

### Test ronde 21
```bash
node dev-tests/round21.js     # 76 cek: chart SPP tunggal & rekap semua grup, hapus masal (antrean + rekap,
                              # cascade BKU), beasiswa multi-grup/multi-siswa & edit, tema/branding, manajer menu,
                              # relokasi tarif honor, catatan ortu + petunjuk, isolasi & keamanan akun demo
node dev-tests/ui-round21.js  # 23 cek Playwright: tema live preview, drag & drop menu + judul kustom,
                              # state form beasiswa tidak reset saat filter kelas, embed video petunjuk, mobile 390px
```
- Tes lama yang disesuaikan karena perubahan perilaku **disengaja**: `round9.js` (judul kartu catatan orang tua, atribut form beasiswa), `round15.js` (label pencarian beasiswa), `round17.js` (judul "Rekap Catatan Pegawai").

---

## Ronde 22 — ARSITEKTUR SAAS MULTI-TENANT & PORTAL SUPER ADMIN

### Model isolasi (penting, jangan diubah tanpa alasan kuat)
- **Satu database per sekolah**: `data/tenants/tenant-<id>.db`. Sekolah pertama tetap memakai
  `data/keuangan.sqlite` (data produksi tidak disalin, hanya dimigrasi).
- **Control plane** `data/saas.db` (env `SAAS_DB_PATH`) berisi `tenants`, `saas_users`, `sessions`,
  `saas_payments`, `saas_settings`, `saas_audit`, `saas_backup_log` — TIDAK berisi data keuangan.
- Default `SAAS_DB_PATH` = `path.dirname(DB_PATH)/saas.db`; default tenant file = `path.dirname(DB_PATH)/tenants/*.db`.
  Karena itu **tes dengan `DB_PATH` sementara otomatis terisolasi** (jangan kembalikan ke `DATA_DIR`).
- **Ekstensi `.db`, bukan `.sqlite`**: berkas `*.sqlite` di folder app yang sudah publish diproteksi
  read-only oleh platform (muncul sebagai mount `ro` di `/proc/mounts`) → pembuatan tenant gagal
  (`SQLITE_READONLY`). Jangan pernah menaruh database baru dengan ekstensi `.sqlite`.
- `dbm.mainDb` sekarang **proxy** (sama seperti `dbm.db`): di dalam request tenant mengarah ke database
  sekolah itu; di luar konteks mengarah ke `rootDb` (tenant 1). `dbm.controlDb` = control plane.
- Konteks request: `dbm.runAsTenant(tenant, fn)` (AsyncLocalStorage). Akun demo tetap memakai
  `dbm.runAsDemo()` (database dummy) — `isDemoContext()` memakai penanda `conn.__demoConn`.

### Kolom tenant_id (Tahap 1)
- `migrateTenantColumns(conn, tenantId)` (dipanggil saat start untuk tenant 1 + setiap tenant baru)
  menambahkan kolom `tenant_id` ke SEMUA tabel dan mengisi baris yang masih NULL. Idempoten.
- `users.username` ditambahkan di bootstrap (login boleh pakai email atau username).

### Login & registrasi (Tahap 2)
- `POST /login` sekarang: **kode sekolah (4 karakter) + username/email + password**.
  Bila kode KOSONG → fallback ke sekolah pertama (kompatibilitas tautan/bookmark lama + tes lama).
- `GET/POST /register` (+ alias `/daftar`): mendaftarkan sekolah baru → tenant + database + akun admin
  + masa uji coba (`saas_settings.trial_hari`), lalu menampilkan kode sekolah.
- Sesi SEMUA login ada di `sessions` (control plane) dengan kolom `tenant_id`, `kind` ('tenant'|'saas'),
  `imp_by`. Kode yang dulu memakai `dbm.mainDb` untuk sesi sudah dipindah ke `saas.*Session()`:
  `server.setSession`, `readSession`, `/ta/pilih`, `routes/dashboard.js` (alert_pending),
  `routes/sistem.js` (hapus semua sesi → hanya tenant aktif).
- Halaman login memakai branding layanan (`saas.appName/appLogo/tema`); bila hanya ada SATU sekolah,
  logo & nama sekolah itu ditampilkan agar tampilan lama tetap terasa.

### Portal Super Admin (Tahap 3) — `/super-admin*`
- `routes/superadmin.js`, cookie `simkeu_saas`, akun `saas_users` (bukan akun sekolah).
  Akun awal: `SAAS_ADMIN_EMAIL` / `SAAS_ADMIN_PASSWORD` (default `super@simkeu.id` / `SuperAdmin2026!`)
  — dibuat otomatis saat start pertama; **ganti sandinya lewat DB/env setelah dipakai**.
- Request `/super-admin*` ditangani SEBELUM resolusi tenant (tidak pernah masuk konteks sekolah).
- Dashboard juga memuat kartu **Keamanan Akun Super Admin** (`POST /super-admin/password`: sandi lama
  divalidasi, minimal 8 karakter) — ganti sandi bawaan setelah pemasangan.
- Halaman: dashboard (KPI), `/sekolah` (tabel + modal tambah), `/sekolah/:id` (edit, feature flag,
  lifetime, login-as, hapus), `/pembayaran` (approve/reject + lightbox bukti), `/qris` (unggah QRIS,
  nama/nomor/instruksi, harga & masa uji coba), `/backup` (SMTP backup seluruh SaaS).
- **Feature flag**: `saas.FEATURES` (std/pro) + `saas.PATH_FEATURES` (peta URL→fitur).
  `saas.blockedFeature(tenant, path)` dipakai server.js (403 halaman "fitur belum tersedia") dan
  `ui.layout()` menyembunyikan item menu yang fiturnya mati (`features` dari `page()`).
  Item menu `layanan` selalu tampil. Super Admin SaaS tidak bisa dimatikan dari sini.
- **Lifetime** (`is_lifetime_free`) → status "Aktif (Lifetime)", `expires_at=NULL`, kebal auto-suspend,
  tombol perpanjangan disembunyikan.
- **Login As Tenant** → sesi `kind='tenant'` untuk akun super_admin sekolah + `imp_by`;
  `ui.layout()` menampilkan banner "Mode bantuan" dan tautan `/super-admin/kembali`.
- **Cron harian** (`saas.runDailyJobs`, penanda `saas_settings.last_daily`): tagihan H-7
  (`saas_payments.jenis='tagihan'`, dedupe per `periode_mulai`=tanggal berakhir) + auto-suspend bila
  lewat masa aktif (lifetime dikecualikan). Tagihan tetap diterbitkan walau sekolah sudah kedaluwarsa.

### Pembayaran QRIS (Tahap 4 & 5)
- Pengaturan QRIS/harga di `/super-admin/qris` (gambar diunggah lewat media proxy → URL disimpan di
  `saas_settings.qris_image`; harga `harga_bulan`/`harga_tahun`, `trial_hari`, `saas_nama`).
- Sisi sekolah: `/info-layanan` (kartu status, nominal tagihan, riwayat, pengaturan backup email) dan
  `/perpanjang` (checkout: QRIS + unduh, pilihan 1/12 bulan, unggah bukti, catatan).
  **Tombol kirim dikunci** selama masih ada pengajuan `pending` (anti double submission).
- `saas.submitPayment/approvePayment/rejectPayment`. Approve = `+durasi` hari dihitung dari
  `max(expires_at, hari ini)`, `status='active'` (un-suspend), tagihan `issued` lama ikut ditutup.
  Reject = alasan wajib, tampil di Info Layanan sekolah untuk unggah ulang.
- Status pembayaran: `pending` · `approved` · `rejected` · `issued` (tagihan cron) — label UI di `saas.PAY_STATUS`.

### Auto-backup database via email (Tahap 6)
- `mailer.js`: klien SMTP sendiri (net/tls, EHLO → STARTTLS bila ditawarkan → AUTH LOGIN → DATA),
  lampiran base64. **Tanpa dependency baru.**
- Konfigurasi per sekolah: `settings.mail_to|mail_host|mail_port|mail_secure|mail_from|mail_user|mail_pass|mail_aktif`
  (form di `/info-layanan`); untuk Super Admin: `saas_settings` dengan kunci sama (`mail_*`, `backup_slots`).
- `mailer.checkSchedules(dbm, saas)` (interval 5 menit, toleransi 45 menit) menjalankan slot `06:00` & `15:00`
  sekali per hari; `mailer.sendTenantBackup` menulis ZIP ke `os.tmpdir()` lalu **selalu `unlink`**
  setelah kirim (auto-cleanup). Nama berkas `Backup_SIMKEU_DDMMYYYY_HHMM.zip` (`bd.backupFileName`).
- Backup SaaS menggabungkan `saas/control-plane.json` + `sekolah/<kode>/database.json` tiap sekolah.
- Riwayat: tabel `cloud_backup` (per sekolah) & `saas_backup_log` (SaaS).

### Alamat portal publik per sekolah (penyesuaian)
- Prompt publik tanpa sesi: `server.portalSlugMap()` memetakan slug kustom semua sekolah → route kanonik.
  Bila slug tidak ditemukan, peta dibangun ulang sekali (slug baru langsung berlaku).
  Perhatikan `pathname0.slice(first.length + 1)` (karakter `/` di depan ikut dihitung).
- `?kode=SK02` pada URL portal memilih sekolah tertentu; tanpa kode → sekolah pertama.

### Alur penting saat menambah sekolah
`saas.createTenant` → baris `tenants` (kode 4 karakter via `nextSchoolCode`, default `SK01`, `SK02`, …)
→ `dbm.createTenantDatabase` (bootstrap skema + master, `migrateTenantColumns`, ganti akun bawaan
dengan admin sekolah) → audit `saas_audit`.

### Tes
```bash
node dev-tests/saas.js     # 100 cek: migrasi tenant_id, login kode sekolah, registrasi, isolasi data,
                           # super admin (tabel/modal/fitur/lifetime/login-as), QRIS & approve/reject,
                           # auto-suspend & tagihan H-7, info layanan, backup email (SMTP tiruan) + auto-cleanup,
                           # ganti password super admin
node dev-tests/ui-saas.js  # 29 cek Playwright: portal super admin (desktop+mobile 390px, modal, tanpa error JS),
                           # dashboard kartu Info Layanan, halaman info-layanan & checkout
```

### Catatan lingkungan (penting)
- Berkas `data/tenants/tenant-2.sqlite`, `tenant-3.sqlite`, `coba.db` adalah **sisa uji coba** yang
  terlanjur dibuat di folder app dan diproteksi platform (read-only, tidak bisa dihapus dari sandbox).
  Tidak dipakai kode (sekarang memakai `.db`), aman dibiarkan.
- Bila suatu saat muncul `SQLITE_READONLY` pada control plane/tenant: pindahkan `SAAS_DB_PATH` dan
  folder `tenants/` ke direktori di luar folder aplikasi lewat `.env`.


---

## Ronde 23 — hapus backup lama, Telegram, tiket, pengumuman/maintenance, WA, slug/domain, leger dinamis

### 1. Sistem backup lama DIHAPUS (jangan dihidupkan lagi)
- `gdrive.js`, `mailer.js` (SMTP), `routes/backup_cloud.js`, `dev-tests/cloud.js`, `dev-tests/ui-cloud.js` **dihapus**.
- Setting lama (`gdrive_*`, `mail_*`) tidak dipakai lagi. Kartu Google Drive di `routes/sistem.js` &
  `routes/layanan.js` diganti rujukan ke **Pengaturan Auto-Backup (Telegram)**.
- `backupdata.js` dipakai bersama: `buildDatabaseZip(db, { extraFiles })`, `tenantBackupName(kode)`
  → `Backup_SIMKEU_<KODE>_DDMMYYYY_HHMM.zip`, `fullBackupName()` → `Backup_FULL_SIMKEU_DDMMYYYY_HHMM.zip`.

### 2. Auto-backup Telegram (2× sehari 06:00 & 15:00)
- `telegram.js`: klien Bot API tanpa dependency (`getMe`, `sendMessage`, `sendDocument` via FormData/Blob),
  `mask()`, `looksValidToken()`, `writeTemp()`, `cleanup()`, `sweepTemps()`, `slotNow()`.
  Base URL bisa dioverride `TELEGRAM_API_BASE` (dipakai tes dengan server Telegram tiruan).
- `backup_tg.js`: `tenantConfig/saveTenantConfig` (setting `tg_token`, `tg_chat`, `tg_aktif`, `tg_slots`, `tg_last`),
  `saasConfig` (control plane: `tg_token`, `tg_chat`, `tg_aktif`, `backup_slots`, `backup_last`),
  `runTenantBackup`, `runSaasBackup`, `scheduleTick`, `registerJobs`, `startScheduler`.
- **Auto-cleanup wajib**: berkas `.zip`/`.sql` ditulis ke `os.tmpdir()` berawalan `simkeu-tg-` dan
  **selalu** dihapus di blok `finally` (sukses maupun gagal). `sweepTemps()` menyapu sisa > 1 jam.
- Halaman sekolah: `/pengaturan-backup` (token disamarkan, uji koneksi, kirim sekarang, riwayat `cloud_backup`).
- Halaman Super Admin: `/super-admin/backup` (auto-backup server + statistik queue + riwayat `saas_backup_log`).
- **Unduhan langsung**: `GET /super-admin/backup/download-zip` dan `/download-sql`
  (dump control plane + seluruh database sekolah; berkas sementara langsung dihapus).

### 3. Queue worker (`queue.js`)
- Tabel `saas_jobs` (control plane): `jenis, payload, status, attempts, run_at, last_error`.
- `queue.register/push/drain/start`; handler terdaftar di `backup_tg.registerJobs()`:
  `backup.tenant`, `backup.saas`, `wa.reminder`, `wa.notify`, `billing.daily`.
- Job `running` dikembalikan ke `pending` saat server start (anti job menggantung).
- Cron penagihan (`server.runBillingTick`) **hanya mengantrekan** `billing.daily`, tidak menjalankan inline.
- Tombol **Proses Antrean Sekarang** (`POST /super-admin/backup/antrean`) memanggil `queue.drain()`.

### 4. Master Petunjuk Pengguna (read-only di sekolah)
- Tabel control plane `master_guides` (+ CRUD di `/super-admin/petunjuk`).
- `routes/panduan.js` DITULIS ULANG: `/petunjuk` hanya menampilkan materi terbit (pencarian judul,
  detail `?id=`, render markdown ringan). **`POST /petunjuk/save|delete|urut` selalu 403** untuk akun sekolah.
- Tabel lama `panduan` (per sekolah) tidak lagi dipakai UI.

### 5. Reset password admin sekolah (Super Admin)
- `POST /super-admin/sekolah/:id/reset-password` (`lib.hashPassword` = scrypt + salt).
- Modal per sekolah di tabel (`mReset<id>`) dengan tombol **Generate Acak** (`data-generate-pw`).
- Kredensial ditampilkan **sekali** lewat `saas.credNoticeSet/Take` + modal `mCredBaru`
  dengan tombol **Salin Info Login** (`data-copy-login`).

### 6. Audit Logs terpusat
- Tabel `audit_log` di control plane (dibuat di `db.js` agar `logAudit` selalu bisa menulis):
  `tenant_id, tenant_nama, user_id, user_nama, role, ip, aksi, modul, detail, created_at`.
- `db.runWithMeta({ip,tenantId,tenantNama}, fn)` — server.js membungkus setiap request
  (`clientIp` dari `x-forwarded-for`). `dbm.logAudit` menulis ke DB sekolah **dan** control plane;
  `saas.logSaas` juga menulis ke `audit_log` (role `super_admin`).
- Halaman `/super-admin/audit` (filter tanggal, sekolah, aktivitas, pencarian).

### 7. Pengumuman global & Maintenance Mode
- Tabel `announcements` (`tipe: banner|popup`, `warna`, `mulai/selesai`, `aktif`) + `/super-admin/pengumuman`.
- `saas.visibleAnnouncements()` → `ui.layout({ announcements })` merender banner di atas konten dan pop-up
  `mAnn<id>` (auto-show sekali per sesi via `data-autoshow`).
- `saas.maintenance()`/`setMaintenance()` (setting `maintenance_aktif/pesan/selesai`).
  Saat aktif, **semua** request non-`/super-admin` dijawab halaman **503 "Sistem Dalam Perbaikan"**
  (`maintenancePage`), termasuk `/login`. `/files/*` tetap boleh (aset gambar).

### 8. Tiket kendala (helpdesk)
- Tabel `tickets` + `ticket_messages`. Sekolah: `/bantuan` (form + riwayat) dan `/bantuan/:id` (percakapan).
- Super Admin: `/super-admin/tiket` (filter status/pencarian, balas + lampiran, ubah status
  Open → In Progress → Resolved; balasan admin pertama otomatis `in_progress`).

### 9. WA Gateway pusat
- Setting control plane `wa_api_url/wa_api_token/wa_sender/wa_payload/wa_aktif`; `saas.sendWA()`
  mendukung payload `form` (target+message) & `json`. Halaman `/super-admin/wa` + tombol Uji Kirim.
- `saas.notifyTenantAdmin()` dipakai otomatis: **approve/reject pembayaran** (lewat queue `wa.notify`)
  dan **pengingat H-7** (queue `wa.reminder` dari job `billing.daily`, sekali per hari per sekolah
  via `wa_reminder_done`). Nomor diambil dari `tenants.contact_telp`.

### 10. portal_slug unik & custom domain
- Kolom baru `tenants`: `portal_slug` (unique), `custom_domain` (unique), `custom_domain_status`
  (`''|pending|verified|failed`), `tg_*`, `wa_notify`.
- `saas.slugify/slugFromName/setPortalSlug/portalSlugError` (reserved = `dbm.RESERVED_SLUGS` + halaman SaaS),
  slug default otomatis dari nama sekolah ("SDN 1 Jakarta" → `sdn-1-jakarta`, bentrok → `-2`).
- **Routing publik** (server.js): `/portal` (default sekolah 1), `/<slug>/portal`, `/portal/<slug>`,
  `<slug>`/`<slug>/<sub>` (alamat portal lama dari settings sekolah), `?kode=SK01`.
  Slug tidak dikenal → halaman **404 Sekolah Tidak Ditemukan**.
- Domain khusus: `saas.tenantByDomain(host)` (header `x-forwarded-host`/`host`). Status belum
  `verified` → halaman **404 Domain Belum Terverifikasi**; verified → portal diakar domain.
- `saas.checkDns()` (CNAME `PORTAL_CNAME_TARGET`/`saas_base_url` atau A `SERVER_IP`).
  Sekolah: `/sekolah` (form URL portal + domain + petunjuk DNS). Super Admin: kolom URL Portal &
  Custom Domain di daftar sekolah + `Verifikasi & Aktifkan Domain` / `Hapus Domain`.
- SSL/HTTPS diserahkan ke proxy (Caddy) — **jangan** menjalankan/mengubah Caddy dari sandbox.

### 11. Storage terisolasi & sesi
- `storage.js`: nama berkas `t<tenant_id>-<jenis>-<YYYYMMDDHHMMSS>-<acak6>-<namaasli>`; folder
  `storage/tenants/<id>/<jenis>/` untuk mode lokal (disajikan `/files/<id>/<jenis>/<nama>`),
  atau media proxy bila `APP_MEDIA_TOKEN` tersedia. `uploadMedia(b64, filename, { jenis })`.
- Sesi: cookie `simkeu_sid` harus cocok `sessions.tenant_id` dengan tenant yang dimuat, dan
  `users.tenant_id` (bila terisi) harus sama — jika tidak, sesi dihancurkan.
- **UNIQUE gabungan**: `ensureTenantUniqueIndexes()` → `uq_siswa_tenant_nisn`, `uq_pegawai_tenant_nip`
  (kolom `pegawai.nip` baru), `uq_transaksi_tenant_bukti`, `uq_iuran_tenant_kuitansi`
  (partial index: hanya bila nilai tidak kosong). Dipanggil dari `migrateTenantColumns`.

### 12. Leger Honor DINAMIS (kolom bisa diatur sekolah)
- Tabel `payroll_kolom` (kode, label, tipe `penerimaan|potongan|info`, nilai `uang|jam`, `rumus`,
  `urutan`, `sistem`, `aktif`) + `payroll_nilai` (payroll_id, kolom_kode, nilai).
- 20 kolom bawaan di-seed `seedPayrollColumns()`; kolom **bawaan** memakai kolom lama tabel `payroll`
  (`PAYROLL_LEGACY`) agar kasbon/posting/slip lama tetap bekerja. Kolom bawaan tidak bisa dihapus.
- `payrollEval()` = parser rumus aman (**tanpa `eval`**): `+ - * / ( )`, `round/min/max/abs`,
  variabel = kode kolom lain + `honor_pembantu`, `honor_wali`, `sertifikasi_rate`.
- `payrollDynamic(periode)` → `{ cols, rows (din, penerimaanDinamis…), totals.perKode }`;
  `payrollRows()` menimpa `penerimaan/potongan/diterima` dengan hasil dinamis sehingga **posting BKU,
  slip, portal, dan neraca ikut struktur kolom**.
- Halaman `/payroll/kolom`: tambah/ubah nama/tipe/satuan/rumus, aktif/nonaktif, hapus (kustom saja),
  geser urutan (naik/turun). Form simpan memakai nama `${id}_c_<kode>` (server tetap menerima format lama).
- Cetak (`/payroll/cetak?mode=leger`) & export Excel memakai kolom + urutan + baris total dinamis;
  Excel memuat blok tanda tangan Bendahara & Kepala Sekolah.
- `public/app.js`: blok `payrollDynamic()` menghitung ulang baris (`js-calc`, `js-din`), total
  penerimaan/potongan/THP, dan **footer per kolom** (`[data-foot-kode]`) secara real-time —
  rumus di klien mencerminkan `payrollEval`.

### Gotcha ronde ini
- `CREATE INDEX` di dalam `SCHEMA` gagal pada database lama bila kolomnya belum ada
  (`no such column: nip`) → tambahkan kolom lewat `ALTER` di bootstrap, index unik dibuat setelah
  `migrateTenantColumns`.
- `ui.printPage()` juga dirender untuk dokumen cetak — jangan menambahkan variabel `layout()`
  (mis. `announcements`) di luar `layout()` (pernah menyebabkan 500 di `/cetak/sertifikasi`).
- `/tmp` di sandbox tidak persisten antar perintah Bash → tes yang butuh salinan DB produksi harus
  membuat folder + menyalin dalam **satu** perintah/berkas skrip (`dev-tests/liveclone.js`).
- Berkas sah: `data/tenants/tenant-2.sqlite`, `tenant-3.sqlite` adalah sisa uji lama yang
  read-only & tidak dipakai (database tenant kini `tenant-<id>.db`).

### Tes
```bash
node dev-tests/round23.js   # 127 cek: hapus backup lama, Telegram (fake API) + auto-cleanup,
                            # unduhan .zip/.sql, panduan read-only 403, reset password + kredensial,
                            # audit logs, pengumuman/maintenance, tiket, WA (approve & H-7), slug/domain,
                            # storage terisolasi, unique per sekolah, leger dinamis + export/cetak
node dev-tests/ui-saas.js   # 45 cek Playwright: portal Super Admin (semua menu baru, modal reset +
                            # generate acak), halaman sekolah (petunjuk read-only, tiket, auto-backup,
                            # kolom leger), blokir fitur Pro untuk paket Standard, mobile 390px
node dev-tests/liveclone.js # 27 cek migrasi memakai SALINAN database produksi (data tidak disentuh)
```


---

## Ronde 24 — jenjang & tingkat kelas, login ringkas, branding dinamis, paket, anti-spam

### 1. Master jenjang & tingkat (db.js)
- `JENJANG` = `{'PAUD/TK': [KB,TK-A,TK-B], 'SD/MI': [I..VI], 'SMP/MTs': [VII..IX],
  'SMA/MA': [X..XII], 'SMK': [X..XII], 'KUSTOM': []}`.
- `TINGKAT_MASTER` (pra-sekolah KB/TK-A/TK-B/PAUD + I..XII), `TINGKAT_ALIAS` (1→I … 12→XII),
  `tingkatUrut()`, `tingkatNaik()` (menjaga konvensi ANGKA: 7→8, 12→lulus), `tingkatLabel()`.
- Setting sekolah: `jenjang_pendidikan` + `tingkat_aktif` (JSON). `tingkatAktif()` (fallback preset jenjang),
  `setTingkatAktif()`, `jenjangPreset()`, `applyJenjangPreset(jenjang, force)`.
- **Kolom baru**: `kelas.nama_kelas` (disinkronkan dengan `nama`; backfill otomatis),
  `iuran_nominal.tingkat` ('' = default semua tingkat).
- `kelasList()` mengurutkan menurut `tingkatUrut` lalu `urutan`/nama; `kelasById()` mengembalikan `nama_kelas`.
- `cloneKelasTa()` memakai `tingkatNaik`; `autoGraduateStudents()` meluluskan kelas yang `tingkatNaik()===''`.

### 2. Halaman "Pengaturan Kelas & Tingkat" (`/kelas/tingkat`, routes/kelas_tingkat.js)
- Pilih jenjang → preset tingkat otomatis; centang tingkat aktif; tambah/hapus tingkat KUSTOM
  (tidak bisa dihapus bila masih dipakai kelas); tambah kelas langsung per tingkat
  (`nama` = `nama_kelas`, contoh `VII-A`, `7 Al-Farabi`).
- Form Data Kelas (`routes/akademik.js`) memakai `tingkatAktif()` — **bukan** daftar tetap X/XI/XII.
- Profil sekolah (`POST /sekolah`) menyimpan `jenjang_pendidikan`; bila jenjang BERUBAH preset tingkat
  otomatis diterapkan. `register` juga mengirim jenjang → `createTenantDatabase({ jenjang })`.

### 3. Tagihan per tingkat
- `iuran_nominal.tingkat`: nominal khusus per tingkat; `iuranNominalMap(grupId, tingkat)` (fallback default),
  `iuranTotalFor(grupId, tingkat)`, `siswaTingkat(siswaId, taId)`.
- Form grup iuran & form edit nominal punya **"Terapkan Tagihan Berdasarkan Tingkat"**;
  `POST /iuran/grup/:id/nominal` hanya menimpa baris tingkat yang dipilih lalu menyinkronkan tagihan
  yang belum dibayar **sesuai tingkat siswa**.
- Penetapan grup ke siswa memakai tarif tingkat siswa (bukan satu tarif untuk semua).

### 4. Filter laporan per tingkat & kelas
- `iuranTagihanRows({ tingkat: [...] })` (filter baru) → dipakai halaman `?r=tunggakan` baru.
- `GET /laporan?r=tunggakan&tingkat=..&kelas=..` = **Tunggakan per Tingkat** (rekap per tingkat + per kelas,
  KPI, filter multi-pilih). Cetak: `/cetak/tunggakan`, Excel: `/export/tunggakan`.
- `/iuran/data` (multi-pilih Tingkat + Kelas) dan `/iuran/transaksi` (dropdown Tingkat) ikut mendukung filter;
  `iuranBayarRows` kini mengembalikan `k.tingkat`.

### 5. Login utama disederhanakan
- `/login` hanya 3 kolom: **Kode Sekolah (4 karakter), Username/Email, Password**.
- Tautan "Portal Orang Tua" dan "Super Admin Pusat" **dihapus** dari halaman login
  (portal `/portal` & `/super-admin` tetap hidup, hanya tidak ditautkan).
- Halaman login memakai **branding DEFAULT sistem** (nama+logo Super Admin), bukan logo sekolah.

### 6. Branding dinamis
- Super Admin: `/super-admin/branding` → `saas_nama`, logo default (`saas_logo`), favicon default
  (`saas_favicon`), `trial_hari`, paket default, + pengaturan anti-spam.
- Sekolah: logo (`sekolah_logo`) & `app_nama` lewat `/tema`/`/sekolah` (sudah ada).
- **Favicon**: `sysFavicon()` (server.js) memakai `saas_favicon` → `saas_logo` → SVG inisial nama aplikasi;
  route `/favicon.ico` memilih logo tenant bila ada konteks sekolah (sesi, custom domain, atau slug pada path),
  selain itu favicon default sistem.

### 7. Trial, kode acak, paket dinamis
- `trial_hari` (Super Admin) → pendaftaran mandiri: `expires_at = hari ini + trial`.
- `nextSchoolCode()` sekarang **acak 4 karakter** (alfanumerik tanpa O/0/I/1, mis. `WJ79`) — bukan SK01/SK02.
  Tenant 1 (instalasi) tetap memakai kode lamanya.
- Tabel `saas_packages` (+ seed Basic/Standard/Pro) & CRUD `/super-admin/paket`:
  `packageRows/ByKode/ById/defaultPackage/packagePrice/packageSave/packageDelete/packageSetDefault/setPackage`.
  **Default = Basic** untuk pendaftaran mandiri (`paket_default`).
- `saas_payments.paket_tujuan`: checkout dapat memilih paket; `submitPayment({ paket })` menghitung nominal
  dari paket; **approve** menerapkan `setPackage()` (fitur mengikuti preset paket).
- Tenant: `/info-layanan/paket` (kartu paket + tombol pilih) → `/perpanjang?paket=pro` (QRIS).
- Fitur inti `siswa`, `kelas`, `program`, `mutasi_kelas`, `iuran` kini **std:1** (semua paket) —
  Pro tetap untuk payroll/pegawai/ekskul/beasiswa/piutang lain/backup cloud.

### 8. Anti-spam pendaftaran
- Tabel `reg_attempts` + `regStatus/regHit/regLog` (setting `reg_limit_per_hour` default 2,
  `reg_block_hours` default 24). Pesan: "Terlalu banyak permintaan pendaftaran. Silakan coba beberapa saat lagi."
- CAPTCHA opsional (`captcha_provider` = off|recaptcha|turnstile, `captcha_site_key`, `captcha_secret`):
  `verifyCaptcha()` memanggil endpoint resmi; **nonaktif default** dan tidak memblokir bila secret kosong.
  Widget dirender di form `/register` (Turnstile/`grecaptcha`).

### Gotcha ronde ini
- **Index pada SCHEMA tidak boleh menyebut kolom hasil ALTER** (`iuran_nominal(tingkat)`) —
  DB lama akan gagal `no such column` sebelum migrasi jalan. Buat index setelah ALTER.
- `public/app.js`: `$$`/`$` hanya ada **di dalam IIFE**; blok yang ditambahkan setelahnya wajib memakai
  `qsa`/`qs` (kalau tidak: `ReferenceError: $$ is not defined` di semua halaman).
- `data-autosubmit` pada select di dalam form **POST** akan men-submit form; untuk pindah filter pakai
  `data-nominal-tingkat-jump` (handler JS melakukan navigasi GET).
- Kode sekolah tidak lagi berurutan → tes harus membaca `tenants.school_code`, bukan menulis `SK02`.

### Tes
```bash
node dev-tests/round24.js     # 84 cek: preset jenjang, login ringkas, branding, paket CRUD, kode acak,
                              # trial, rate limit, pengaturan tingkat, kelas per tingkat, tarif per tingkat,
                              # filter & cetak/export tunggakan, upgrade paket, favicon
node dev-tests/ui-round24.js  # 29 cek Playwright: login 3 kolom, halaman tingkat (preset & tambah kelas),
                              # laporan tunggakan, paket sekolah, branding & paket Super Admin, mobile 390px
```


---

## Ronde 25 — kontrol fitur per paket, kartu paket di pendaftaran, kartu layanan ringkas, pindah auto-backup

### 1. Kontrol fitur per PAKET (menu Paket Langganan)
- `saas_packages.fitur` kini menyimpan **peta fitur lengkap** paket (array kode fitur atau objek `{kode:0|1}`),
  bukan lagi `{std:1}`.
- Helper baru (saas.js): `packageFeatureMap(pkg)`, `packageFeatureLabels(pkg)`, `packageSelfTrial(pkg)`,
  `packageTrialDays(pkg)`. `packageFeatureMap()` menerima array maupun objek (format lama tetap jalan).
- `setPackage()` dan `createTenant()` memakai `packageFeatureMap(pkg)` → **fitur sekolah mengikuti paket**.
- Form `/super-admin/paket` punya grid centang semua `FEATURES` + tombol **Pilih Semua/Kosongkan**
  (atribut generik `data-check-name-all|none` di `public/app.js`).
- Paket default hasil seed: Basic (25 fitur, termasuk siswa/kelas/iuran), Standard (+pegawai, piutang
  sertifikasi & lainnya, catatan, tarif honor), Pro (semua fitur).

### 2. Pendaftaran: kartu paket + alur WhatsApp
- `/register` menampilkan **kartu paket** (judul, harga bulan/tahun, badge, daftar fitur dari
  `packageFeatureLabels()`); dropdown paket dihapus.
- Kolom baru `saas_packages.self_trial` (boleh daftar mandiri + trial) & `trial_hari` (durasi per paket).
  Basic = self_trial; paket lain = berbayar.
- `POST /register`: paket non-self_trial → **redirect ke WhatsApp admin** (`https://wa.me/<nomor>?text=…`,
  pesan memuat nama paket, harga, nama sekolah & admin) dan **tenant tidak dibuat**.
- Nomor admin: setting `wa_admin_number` (diatur di `/super-admin/branding`), helper `waAdminNumber()`,
  `waAdminLink(pkg, {sekolah, admin})`, `normalizeWa()` (08xx → 628xx).
- Trial default kini **7 hari** (`trial_hari`, migrasi `mig_trial7` mengubah nilai lama 30 → 7);
  durasi paket menimpa nilai global bila diisi.

### 3. Kartu Info Layanan dashboard dibuat ringkas
- `routes/dashboard.js` → `layananCard` memakai `.card.svc-mini` satu baris (ikon + Paket / Masa aktif /
  Biaya / Status + tombol Detail & Perpanjang), id tetap `#infoLayanan` (kompatibel tes lama).
- CSS baru di `public/app.css`: `.svc-mini`, `.pk-grid`, `.pk-card`, `.pk-pick`, `.pk-feats`, `.pk-feat-grid`.

### 4. Auto-backup dipindah ke menu Auto Backup + riwayat bisa dihapus
- Kartu "Auto-Backup Database" **dihapus** dari `/info-layanan` (dan tidak ada di `/perpanjang`).
- `/pengaturan-backup` kini menampilkan **riwayat 30 pengiriman** + tombol hapus per baris &
  **Hapus Semua Riwayat** → `POST /pengaturan-backup/riwayat/hapus` (`id` kosong = hapus semua),
  guard `backup.create`, audit `HAPUS / backup`.
- Catatan: menu auto-backup adalah fitur **Pro** (`backup_cloud`), jadi sekolah paket Basic/Standard
  tetap tidak melihatnya (feature flagging).

### Catatan implementasi tambahan
- `migratePackageFeatures()` (dipanggil `ensureBootstrap()`) mengubah `fitur` paket lama (`{std:1}`)
  menjadi **array kode fitur** sekali saja (flag `mig_pkgfitur_v1`) — paket yang sudah memakai array
  (hasil sunting Super Admin) tidak disentuh.
- `packageTrialDays()` memperlakukan `trial_hari` NULL/kosong sebagai "ikut setting global"
  (jangan memakai `Number(null)` → 0).
- Paket terpilih di `/register`: query `?paket=` → paket default (bila `self_trial`) → paket pertama yang
  `self_trial` → paket default. Jadi sekolah baru tetap bisa langsung daftar walaupun paket default
  yang dipilih Super Admin adalah paket berbayar.
- `data-check-name-all|none="<name>"` = hook JS generik untuk mencentang semua input dengan `name` tsb
  di dalam form (dipakai grid fitur paket).

### Tes
```bash
node dev-tests/round25.js   # 47 cek: peta fitur paket + edit di Super Admin, kartu paket di /register,
                            # Basic → daftar + trial 7 hari, paket berbayar → wa.me (tanpa tenant),
                            # kartu layanan ringkas, auto-backup pindah & hapus riwayat + audit
```

---

## Ronde 26 (ringkas — detail lengkap di AGENTS.md root)

- **Performa**: `perf.js` (minify CSS/JS + gzip/brotli + `Cache-Control: immutable` untuk `/assets/*?v=`), semua `<script>` `defer`, `ui.fontLinks()` (preconnect + font non-blocking), preload logo LCP + `fetchpriority`, lazy/decoding pada gambar non-kritis, `optimizeImage()` konversi **WebP** di klien (logo/nota/foto, maks 1600 px), logo responsif `sekolah_logo_small`/`app_logo_small` + `ui.logoSrcset()`.
- **Identitas sekolah**: NPSN (8 digit unik), bentuk pendidikan, status, kepemilikan, telepon, email, website; dua kartu form (Informasi Umum & Kontak / Legalitas & Status); variabel dinamis `{nama} {npsn} {bentuk} {status} {kepemilikan} {alamat} {telp} {email} {website}` dipakai kop, kwitansi, footer portal (`ui.fillIdentitas`, `ui.identitasKontak`, `ui.identitasFooter`); `tenants.npsn` + indeks `uq_tenants_npsn`.
- **Menu dipisah**: `/sekolah` (Identitas) · `/portal-publik` (3 slug, subdomain, custom domain) · `/tema` (warna, logo, **mode gelap**) · `/desain-cetak` (kop surat + ukuran kuitansi). Nav key baru `identitas/portal_publik/tema/desain_cetak`.
- **Mode gelap**: setting `mode_tema`, `<html data-mode="dark">`, CSS `html[data-mode="dark"]`; dokumen cetak tetap putih.
- **Role Demo dihapus** dari `ROLES`, Permission Matrix, dan semua validator pengguna; user lama dipindah ke `staff` + nonaktif.
- **Backup**: sekolah → JSON/ZIP data sekolah saja; Super Admin → `/super-admin/backup` (ZIP seluruh sistem, `.sql`, source code via `sourcepack.js`, `.env`, modal **Restore Database** ZIP/JSON). `routes/superadmin_db.js` = Database Manager (browse/edit/hapus baris, konsol SQL, export CSV) dengan audit `* DATABASE`.
- **Custom domain**: `saas.checkDns(domain,{host,ip})` cek CNAME **dan** A Record + `hostMatch`; setting `saas_base_url`, `saas_server_ip`, `portal_cname_target` di `/super-admin/branding`; form sekolah menampilkan Opsi 1 (CNAME) & Opsi 2 (A Record — direkomendasikan).
- **Preset menu** `/super-admin/menu-default` (`saas_settings.school_menu_default`) diterapkan ke sekolah baru & tombol terapkan massal. `nav_hidden`/`nav_ui` kini **per sekolah**.
- **Fitur paket granular**: `identitas, portal_publik, tema, desain_cetak, pembantu_kas, pembantu_bank, pembantu_pajak, pembantu_bhp, pembantu_modal` (+ `FEATURE_PARENT` untuk kompatibilitas paket lama).
- Tes: `node dev-tests/round26.js` (90), `node dev-tests/ui-round26.js` (40).

---

## Ronde 27 (ringkas — detail di AGENTS.md root)

- **`siswa.parent_phone`** (No. HP/WA orang tua) + normalisasi `lib.normPhone()` → `62…`, `lib.phoneDisplay()` → `08…`;
  form/import/template/export/pratinjau Data Siswa mendukung kolom **NO. HP / WA ORANG TUA**.
- **`reminder.js`** = inti pengingat tagihan WhatsApp: konfigurasi jadwal (rutin tanggal / H-X jatuh tempo, jam, template dinamis),
  `wa_template` + `wa_reminder_log`, token portal HMAC (`/portal?token=`), `enqueue*`, **worker latar jeda acak 2–5 detik**,
  penjadwalan `dueSlots/runSchedule` (toleransi 15 menit, anti dobel via `reminder_done`).
- **`routes/reminder.js`**: `/iuran/pengingat` (pengaturan, editor template + dynamic tags, pratinjau, riwayat),
  aksi `simpan|template-utama|template|template/hapus|jalan|jadwal|riwayat`, serta
  `POST /iuran/wa/satu` & `POST /iuran/wa/massal` + `GET /iuran/wa/preview` (JSON pratinjau).
- **Data Iuran**: tombol WhatsApp per baris (modal `mWaSatu`) & **Kirim WA Massal** (modal `mWaMassal`: template, ceklis, filter kelas/tingkat).
- **Gateway**: `wa.waConfig()` = `.env` → sekolah → **pusat Super Admin** (`source`).
- Tes: `node dev-tests/round27.js` (85), `node dev-tests/ui-round27.js` (38). Disesuaikan: `round18`.

---

## Ronde 28 — Manajemen Halaman Publik & Routing Slug (Super Admin + Tenant)

### 1. Kolom control plane `tenants` (migrasi otomatis di `saas.js` + `saas_extra.js`)
`portal_status` (default **`aktif`** | `nonaktif` | `private`), `portal_note`, `portal_locked_at`, `portal_locked_by`.
Semua perubahan status/slug menulis `saas.logSaas` (audit `BLOKIR/BUKA PORTAL PUBLIK`, `UBAH SLUG`, `HAPUS HALAMAN PUBLIK`).

### 2. Helper di `saas_extra.js` (diekspor lewat `saas`)
- `PORTAL_STATUS` (`aktif`/`nonaktif`/`private` + label & warna), `portalStatusOf(t)`, `portalStatusInfo(t)`, `setPortalStatus(id, status, note, user)`.
- `tenantPortalPublished(t)` = `settings.portal_aktif` milik sekolah (sakelar "Publikasikan Halaman Portal").
- `clearPortalSlug(id, user)` = kosongkan slug **dan** set status `nonaktif` (tombol Hapus Halaman Publik).
- **`portalAccess(t, path)`** — inti middleware. Urutan: tenant → status `nonaktif` (**404**) → `private` (**403**) → slug kosong (**404**, "halaman publik dihapus") → sakelar sekolah untuk jenis portal yang diminta OFF (**503**).
  Jenis ditentukan `portalKindOf(path)` (`/portal-slip` → slip, `/portal-pegawai` → pegawai, `/portal` → siswa) dan `tenantPortalSwitches(t)` mengembalikan ketiga status sekaligus; jadi mematikan portal siswa **tidak** mematikan portal pegawai/slip.
- `PORTAL_TEXT_DEFAULT`, `PORTAL_TITLE_MAX` (40), `PORTAL_SUBTITLE_MAX` (**60**), `portalDefaults()`, `portalText(settings)`, `portalTextError({title,subtitle})`.

### 3. Middleware (`server.js` → `portalAccessPage`)
Dua tempat memanggil `saas.portalAccess`:
1. jalur **belum login** (portal publik) — sebelum `runAsTenant`;
2. jalur **sudah login** untuk pathname `/portal|/portal-pegawai|/portal-slip` — jadi halaman yang diblokir Super Admin tetap tertutup walau pengunjung punya sesi sekolah.
`portalAccessPage({base,tenant,access})` merender halaman 404/403/503 ber-branding sekolah (logo + nama dari DB tenant), selalu ada tautan "Halaman Masuk Sekolah".

### 4. Sisi tenant — menu **Portal Publik** (`routes/master.js`)
Kartu **"Publikasi & Teks Halaman Portal"** (`#publikasiPortal`, POST `/sekolah/portal-publik/simpan`):
sakelar `.sw` (`portal_aktif`, label ON/OFF), `portal_page_title` (maxlength 40), `portal_subtitle` (maxlength 60),
**pratinjau langsung** (`data-portal-preview` + `data-pv-title`/`data-pv-sub`, JS di blok `public/app.js` bagian "sakelar & pratinjau teks portal"),
dan hidden `data-pv-tabhint` pada hint. Validasi server: panjang maksimum + tanpa baris baru (`saas.portalTextError`) **sebelum** menyimpan apa pun.
Bila Super Admin memblokir, halaman ini menampilkan banner `#bannerPortalAdmin`; dashboard menampilkan `#bannerPortalPublik` (hanya jika `can('sekolah','view')`).

### 4b. Sakelar publikasi ketiga portal (pindah dari Pengaturan Sistem)
Kartu publikasi kini memuat **tiga** sakelar: `portal_aktif` (tagihan siswa), `portal_pegawai_aktif`, `portal_slip_aktif` —
masing-masing baris `.publ-row` dengan `.sw` + tautan alamat (`url-chip`). CSS: `.publ-list/.publ-row/.publ-meta`.
POST `/sekolah/portal-publik/simpan` **hanya memproses sakelar bila form mengirim penanda `simpan_publikasi=1`**
(checkbox yang tidak dicentang memang tidak terkirim, jadi tanpa penanda sebuah POST teks murni akan mematikan semua portal).
`routes/sistem.js` (`/pengguna`) **tidak lagi** menulis `portal_*` — hanya kartu tautan ke Portal Publik + setelan gateway WA.
Diuji: menyimpan setelan sistem tidak menyalakan/mematikan portal.

### 5. Sisi Super Admin — `/super-admin/portal-publik`
Menu sidebar **"Manajemen Custom Slug & Portal Publik"** (`MENU` di `routes/superadmin.js`; CSS `.sa-nav span{line-height:1.28}` agar label 2 baris).
Tabel seluruh tenant: Nama Sekolah · URL/Custom Slug · Custom Domain · **Status Akses Publik** (select `data-autosubmit`) · Aksi
(**Lihat** halaman, modal **Edit Slug** `mSlug<id>` dengan slug+status+catatan, **Sembunyikan/Aktifkan** cepat, **Hapus** `data-confirm`).
KPI: total sekolah, halaman aktif, non-aktif, private, punya slug, custom domain. Kolom status juga menampilkan **sakelar per portal** sekolah
(`Sakelar sekolah: Siswa ON · Pegawai ON · Slip OFF`), dan kolom Aksi punya tiga tombol Lihat (`Siswa`, `Pegawai`, `Slip`).
POST: `/portal-publik/:id/status|slug|hapus` → selalu `refreshPortalMap()`.
Default teks global diatur di **`/super-admin/branding`** → kartu "Default Tampilan Halaman Portal Publik" (`portal_default_title` = `Cek Tagihan`, `portal_default_subtitle` = `PORTAL CEK TAGIHAN IURAN SISWA`).

### 6. Portal publik (`routes/portal.js` + CSS)
`<title>{judul} · {nama sekolah}</title>` (judul = `portal_page_title` atau default Super Admin) dan banner:
`.portal-head > .banner-text > h1.school-title` (nama sekolah) + `p.portal-subtitle` (sub-judul, uppercase). Kelas lama `.pn/.ps` masih dipakai `portal_pegawai.js` — jangan dihapus.
Sub-judul memakai `.portal-subtitle` (font 11,5px, letter-spacing .12em, turun ke 10,5px di ≤620px) agar tidak merusak layout HP.

### Gotcha
- `routes/portal.js` kini menerima `saas` (didaftarkan di `server.js`) untuk membaca default teks.
- Kartu pratinjau memakai `data-pv-*`; jangan menaruh input `[data-pv-title]` di luar form pratinjau (JS mencari dalam `form` terdekat).
- Uji portal publik dari sisi pengunjung **tanpa cookie** (sesi sekolah juga diperiksa terpisah, tapi `page.request` Playwright membawa cookie → bisa menyesatkan).

### Tes
```bash
node dev-tests/round28.js     # 71 cek: kartu publikasi & teks portal (3 sakelar), validasi 60 karakter, sakelar per portal (503),
                              # portal pegawai tetap hidup, halaman Super Admin, status aktif/nonaktif(404)/private(403),
                              # banner dashboard, ubah slug, hapus halaman publik, default dari branding, RBAC staff
node dev-tests/ui-round28.js  # 43 cek Playwright: 3 sakelar & pratinjau live, tab browser portal, banner, mobile 390px,
                              # tabel Super Admin, dropdown status, modal slug, tanpa error JS
```

---

## Ronde 29 — Zona waktu aplikasi WIB (Asia/Jakarta)

### 1. Modul baru `tz.js` (dimuat paling awal)
- `tz.apply(raw)` menyetel `process.env.TZ` + `process.env.APP_TIMEZONE`, menerima alias (`WIB`, `gmt+7`, `jakarta`, `wita`, `wit`, `utc`); nilai tak dikenal → kembali `Asia/Jakarta` + `tz.warning`.
- API: `TZ`, `partsOf(date)`, `offsetMinutes()`, `offsetLabel()` (`+07:00`), `label()` (`WIB`), `info()`, `startupLine()`.
- **Dimuat oleh `env.js` SETELAH `.env` dibaca** → `APP_TIMEZONE` di `.env`/shell langsung berlaku untuk `Date`, pustaka native (SQLite `localtime`), worker WA, penjadwalan pengingat, backup otomatis. Tidak perlu mengubah kode lain.

### 2. `lib.js` — helper WIB
`tzLabel()`, `tzOffset()`, `stampID(v)` → **`04-11-2026 12:05:31 WIB`**, `stampShort(v)` → `04-11-2026 12:05`, `plusMinutesStamp(m)`, `plusDaysStamp(d)`.
`nowStamp()`/`todayISO()` tetap `YYYY-MM-DD HH:mm:ss` (WIB) — **disimpan** dalam format terurut supaya `ORDER BY`/perbandingan teks tetap benar; format `DD-MM-YYYY … WIB` dipakai saat **ditampilkan**.
`db.js`: `dateOffsetISO(days)` (mis. -1 = kemarin WIB) — jangan memakai `new Date().toISOString()` untuk tanggal.

### 3. SQL
- `CURRENT_TIMESTAMP`/`NOW()` di SQLite **selalu UTC** → tidak dipakai.
- Setiap koneksi (`rootDb`, kontrol plane, tiap tenant, demo) diberi fungsi `now_wib()` dan `today_wib()` (`registerTimeFns()`), mis. `SELECT now_wib()`.
- `datetime('now','localtime')` juga WIB karena TZ proses disetel sebelum koneksi dibuka.

### 4. Migrasi stempel waktu lama (`mig_tz_wib_v1`)
Server lama (UTC) menulis kolom `*_at` 7 jam lebih awal. `dbm.migrateLegacyTimestamps(conn, 'settings')` menggeser **hanya nilai berpola `YYYY-MM-DD HH:MM:SS` (19 karakter)** sebanyak `+7` jam, sekali saja (flag `mig_tz_wib_v1`):
- dijalankan di `bootstrap()` **sebelum seed**, dan **dilewati bila database masih baru** (data seed sudah WIB);
- dijalankan juga untuk control plane (`saas_settings`) dan setiap DB tenant saat koneksi pertama dibuka, plus **setelah restore backup** (backup lama belum punya flag → ikut digeser; backup baru membawa flag → tidak dobel);
- tabel `sessions` & `saas_jobs` dilewati; kolom tanggal murni (`tanggal`, `periode`, `tenants.expires_at`) tidak tersentuh karena tidak cocok pola;
- bisa dimatikan: `TZ_SHIFT_LEGACY=0` (mis. bila server memang sudah WIB sejak awal).

### 5. Perbaikan bug waktu yang ikut ditemukan
- `otp_code.expires_at` & `sessions.expires_at` dulu dibuat dengan `toISOString()` (UTC) lalu dibandingkan dengan `nowStamp()` (jam lokal) → OTP **selalu** dianggap kedaluwarsa bila server UTC. Sekarang memakai `lib.plusMinutesStamp/plusDaysStamp` (jam WIB yang sama) dan perbandingan string.
- `saas.regStatus()` (rate limit pendaftaran), nama berkas invoice/backup, stempel berkas `storage.js`, "kemarin" pada antrean iuran & notifikasi dashboard, dan tanggal tanda tangan laporan kini memakai WIB (bukan `toISOString()`).
- Tampilan: halaman Audit Logs, riwayat pengingat WA, waktu pengajuan approval, dan kolom `created_at`/`deleted_at`/`posted_at` memakai `lib.stampID`/`stampShort` → berakhiran **WIB**. Footer sidebar menampilkan `WIB · GMT+07:00`.
- Log startup: `[tz] Asia/Jakarta (WIB +07:00) — sekarang 04-11-2026 12:05:31 WIB`.

### 6. Konfigurasi
`.env` (dan `.env.example`): `APP_TIMEZONE=Asia/Jakarta` (default), `TZ_SHIFT_LEGACY=1`. Kartu **Konfigurasi Lingkungan (.env)** di `/super-admin/backup` menampilkan `APP_TIMEZONE` + label & offset aktif.

### Tes
```bash
node dev-tests/round29.js   # 46 cek: TZ proses & lib, now_wib()/today_wib(), audit & transaksi berjam WIB,
                            # format tampilan "DD-MM-YYYY HH:mm:ss WIB", sesi & OTP tidak langsung kedaluwarsa,
                            # penjadwalan pengingat memakai jam WIB (bukan UTC), migrasi +7 jam idempoten,
                            # TZ_SHIFT_LEGACY=0, APP_TIMEZONE=Asia/Makassar (WITA) & nilai tak dikenal
```
**Catatan tes**: semua `dev-tests/*.js` kini menyetel `process.env.TZ='Asia/Jakarta'` di baris awal supaya jam test = jam aplikasi (sebelumnya test menghitung jam UTC dan gagal pada round27).

---

## Ronde 30 — Setelah daftar: langsung masuk dashboard + kredensial tampil sekali

### Alur baru `POST /register` (`routes/auth.js`)
Dulu berakhir di `GET /login?ok=…&kode=…`; sekarang **auto-login** lalu langsung ke dashboard:
1. `saas.createTenant(...)` membuat sekolah + admin (`users.role='super_admin'`).
2. Admin diambil dari DB tenant, lalu `setSession(admin.id, tenant.id, 0, welcomeJSON)` membuat sesi login dan cookie `simkeu_sid` (14 hari) — sama seperti `POST /login`.
3. Redirect **`base + '/?welcome=1'`** (dashboard sekolah baru).
4. Bila pembuatan sesi gagal → fallback `GET /daftar/sukses?t=<token>`.

### Kredensial disimpan di baris sesi (bukan URL)
- Kolom baru `sessions.welcome TEXT` (control plane; ALTER otomatis di `saas.js`).
- `saas.createSession({…, welcome})` + `saas.takeWelcome(token)` (mengembalikan `{kode, sekolah, username, nama, password, at}` lalu **mengosongkan kolom** → sekali tampil).
- Isi: **Kode Sekolah 4 karakter** (`tenants.school_code`), **Username** (`users.username` = bagian depan email), **Password** (yang baru diketik saat daftar).
- Password **tidak pernah** masuk URL/riwayat browser; ditampilkan tersamar (`data-pw`) dengan tombol **Lihat** & **Salin**.

### Dashboard (`routes/dashboard.js`)
Kartu `#welcomeKredensial` (kelas `.welcome-card`/`.cred-grid`/`.cred-cell`) dirender paling atas bila `saas.takeWelcome(req.sessionRow.token)` mengembalikan data:
tiga sel (Kode Sekolah besar + badge "4 karakter", Username, Password) dengan tombol salin, tombol "Mengerti, lanjut ke dashboard" (`data-close-welcome`), dan catatan "password hanya ditampilkan sekali".

### Halaman sukses fallback `GET /daftar/sukses`
Publik (`isPublicPath` menerima `/daftar/sukses`), memakai `authShell`. Sumber data: `?t=<token sekali pakai>` (Map di memori, TTL 30 menit) atau `?kode=..&u=..` (tanpa password). Menampilkan kartu kredensial + tombol **Masuk ke Dashboard Sekolah** (`/login?kode=…`). Tanpa keduanya → redirect `/login?err=…`.

### Klien (`public/app.js`)
Blok "kredensial pendaftaran": `[data-copy]` (clipboard + fallback `execCommand`), `[data-pw-toggle]` (Lihat/Sembunyikan), `[data-close-welcome]` (hapus kartu). Ikon baru `ui.icon('login')` & `ui.icon('copy')`.

### Catatan
- Audit baru `DAFTAR` di DB sekolah: `Pendaftaran sekolah <nama> (<kode>) — admin <email> langsung masuk ke dashboard`.
- Halaman login tetap tersedia untuk kunjungan berikutnya; kartu kredensial tidak pernah muncul lagi (kolom `welcome` sudah NULL).
- Tes lama yang menyesuaikan perilaku **disengaja**: `round24.js` (redirect `/register` → `/?welcome=1`), `round26.js` (ambang ukuran `app.js` minified 72.000 → 80.000 byte).

### Tes
```bash
node dev-tests/round30.js     # 46 cek: redirect dashboard, sesi otomatis, kartu kredensial (kode/username/password),
                              # sekali tampil, kredensial bisa dipakai login (username & email), audit DAFTAR,
                              # isolasi tenant, halaman sukses fallback, gagal daftar tidak membuat sesi
node dev-tests/ui-round30.js  # 22 cek Playwright: alur daftar di browser, Lihat password, Salin ke clipboard,
                              # mobile 390px (1 kolom), tutup kartu & tidak muncul lagi, login ulang
```
