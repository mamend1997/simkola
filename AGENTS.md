
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
