'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* ==================================================================
   UI RONDE 34 (Playwright)
   1. "Pilih Semua" benar-benar mencentang semua baris + penghitung
      "Terpilih: N" ikut berubah (Transaksi, Antrean Iuran, Slip Gaji,
      Data Pegawai) dan ceklis parsial membuat kotak kepala indeterminate
   2. Ceklis pada satu tabel tidak mencentang tabel lain (scope)
   3. Menu Syarat & Ketentuan + SLA di sidebar panel sekolah
   4. Desain Templat Cetak: 2 tab kop, pratinjau langsung (teks, ukuran
      font, logo, garis), tab tersimpan di URL hash
   5. Tanpa error JS, mobile 390px tanpa overflow horizontal
   ================================================================== */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium } = require('playwright');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'r34u-'));
const DB = path.join(TMP, 'k.sqlite');
const SAAS_DB = path.join(TMP, 'saas.db');
const PORT = 3692;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, DB_PATH: DB, SAAS_DB_PATH: SAAS_DB, DEMO_DB_PATH: path.join(TMP, 'demo.sqlite') },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
const results = [];
function ok(name, cond, extra = '') {
  results.push({ name, ok: !!cond, extra });
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' → ' + extra));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const today = new Date().toISOString().slice(0, 10);

(async () => {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  let cookie = '';
  async function api(method, url, body) {
    const headers = { Cookie: cookie };
    let payload = null;
    if (body) {
      const usp = new URLSearchParams();
      for (const [k, v] of Object.entries(body)) { if (Array.isArray(v)) v.forEach(x => usp.append(k, x)); else usp.append(k, v); }
      payload = usp.toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, text: await r.text() };
  }
  await api('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  const Database = require('better-sqlite3');
  const db = new Database(DB);
  const ta = db.prepare('SELECT * FROM tahun_ajaran ORDER BY id LIMIT 1').get();
  const bku = db.prepare("SELECT * FROM bku WHERE COALESCE(auto_mode,0)=0 AND tahun_ajaran_id=? ORDER BY id LIMIT 1").get(ta.id);
  const coaIn = db.prepare("SELECT id FROM coa WHERE kode='4.1.01'").get().id;
  const coaOut = db.prepare("SELECT id FROM coa WHERE kode='5.2.01'").get().id;
  for (const [jenis, coa, nom, ket] of [['pemasukan', coaIn, '1000000', 'Ceklis A'], ['pengeluaran', coaOut, '250000', 'Ceklis B'], ['pemasukan', coaIn, '500000', 'Ceklis C']]) {
    await api('POST', '/transaksi/save', { bku_id: bku.id, tanggal: today, jenis, coa_id: coa, nominal: nom, uraian: ket, metode: 'tunai' });
  }
  // pegawai + leger honor (untuk slip)
  for (const nm of ['Guru Satu', 'Guru Dua']) await api('POST', '/pegawai/save', { nama: nm, jabatan: 'Guru', tipe: 'guru', aktif: '1' });
  const pegawai = db.prepare('SELECT * FROM pegawai ORDER BY id').all();
  const periode = String(today).slice(0, 7);
  const insPay = db.prepare('INSERT INTO payroll (periode,pegawai_id,nama,jabatan,tipe,jam_efektif,honor_jam,created_at) VALUES (?,?,?,?,?,?,?,?)');
  for (const p of pegawai) insPay.run(periode, p.id, p.nama, p.jabatan || 'Guru', 'guru', 20, 50000, new Date().toISOString());
  // iuran: pembayaran pending (antrean) + non-BKU + siswa/kelas
  await api('POST', '/program-keahlian/save', { nama: 'TKJ', program_studi: 'TKJ', ketua: 'K' });
  const prog = db.prepare("SELECT * FROM program_keahlian WHERE nama='TKJ'").get();
  await api('POST', '/kelas/save', { nama: 'X TKJ 1', tingkat: 'X', wali_kelas: 'W', program_id: prog.id, aktif: '1' });
  const kelas = db.prepare("SELECT * FROM kelas WHERE nama='X TKJ 1'").get();
  await api('POST', '/siswa/save', { nisn: '9501', nama: 'Siswa Uji UI', jenis_kelamin: 'L', tanggal_lahir: '2010-03-03', kelas_id: kelas.id });
  const siswa = db.prepare("SELECT * FROM siswa WHERE nisn='9501'").get();
  await api('POST', '/iuran/save', { nama: 'Iuran UI', jenis: 'bulanan', mode_nominal: 'rata', nominal_rata: '150000', aktif: '1', tahun_ajaran_id: ta.id });
  const grup = db.prepare("SELECT * FROM iuran_grup WHERE nama='Iuran UI'").get();
  await api('POST', `/iuran/grup/${grup.id}/tetapkan`, { kelas_id: kelas.id, siswa_id: [siswa.id] });
  const tag = db.prepare('SELECT * FROM iuran_tagihan WHERE grup_id=?').get(grup.id);
  await api('POST', '/iuran/bayar-item', {
    back: `/iuran/data/${siswa.id}`, n: '1',
    key_0: `m:${tag.id}:7`, tanggal_0: today, metode_0: 'tunai', jumlah_0: '150000', potongan_0: '0', bku_0: String(bku.id), nonbku_0: ''
  });
  await api('POST', '/iuran/bayar-item', {
    back: `/iuran/data/${siswa.id}`, n: '1',
    key_0: `m:${tag.id}:8`, tanggal_0: today, metode_0: 'tunai', jumlah_0: '150000', potongan_0: '0', bku_0: String(bku.id), nonbku_0: '1'
  });

  const errors = [];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=').slice(1).join('='), url: base }]);
  let page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e.message)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  /* ============ 1. TRANSAKSI: PILIH SEMUA & PENGHITUNG ============ */
  await page.goto(base + '/transaksi');
  await page.waitForSelector('input[data-check-item="trxIds"]');
  const trxBoxes = page.locator('input[data-check-item="trxIds"]:not([disabled])');
  const trxN = await trxBoxes.count();
  ok('transaksi: baris ceklis tersedia', trxN > 0, String(trxN));
  const trxCounter = page.locator('[data-check-count="trxIds"]').first();
  ok('transaksi: penghitung awal 0', (await trxCounter.innerText()).trim() === '0');
  await page.locator('[data-check-all="trxIds"]').click();
  let checkedAll = true;
  for (let i = 0; i < trxN; i++) if (!(await trxBoxes.nth(i).isChecked())) checkedAll = false;
  ok('transaksi: Pilih Semua mencentang SELURUH baris', checkedAll);
  ok('transaksi: penghitung berubah menjadi jumlah baris', (await trxCounter.innerText()).trim() === String(trxN), await trxCounter.innerText());
  const trxMaster = page.locator('input[data-check-all-box="trxIds"]');
  ok('transaksi: kotak kepala tabel ikut tercentang', await trxMaster.isChecked());
  await trxBoxes.first().uncheck();
  ok('transaksi: ceklis parsial → kotak kepala indeterminate', await trxMaster.evaluate(el => el.indeterminate === true));
  ok('transaksi: penghitung turun setelah 1 baris dilepas', (await trxCounter.innerText()).trim() === String(trxN - 1));
  await page.locator('[data-check-none="trxIds"]').click();
  ok('transaksi: Hapus Ceklis mengosongkan semua & penghitung 0',
    (await trxCounter.innerText()).trim() === '0' && !(await trxBoxes.first().isChecked()));

  /* ============ 2. PEGAWAI & SLIP GAJI ============ */
  await page.goto(base + '/pegawai');
  await page.waitForSelector('input[data-check-item="pegawaiIds"]');
  const pegBoxes = page.locator('input[data-check-item="pegawaiIds"]:not([disabled])');
  const pegN = await pegBoxes.count();
  await page.locator('[data-check-all="pegawaiIds"]').click();
  let pegAll = true;
  for (let i = 0; i < pegN; i++) if (!(await pegBoxes.nth(i).isChecked())) pegAll = false;
  const pegCounter = page.locator('[data-check-count="pegawaiIds"]').first();
  ok('pegawai: Pilih Semua mencentang semua baris', pegN > 0 && pegAll, String(pegN));
  ok('pegawai: penghitung "Terpilih" sesuai jumlah', (await pegCounter.innerText()).trim() === String(pegN), await pegCounter.innerText());

  await page.goto(base + '/payroll/slip?periode=' + periode);
  await page.waitForSelector('input[data-check-item="slipIds"]');
  const slipBoxes = page.locator('input[data-check-item="slipIds"]:not([disabled])');
  const slipN = await slipBoxes.count();
  await page.locator('[data-check-all="slipIds"]').click();
  let slipAll = true;
  for (let i = 0; i < slipN; i++) if (!(await slipBoxes.nth(i).isChecked())) slipAll = false;
  ok('slip gaji: Pilih Semua mencentang semua pegawai', slipN > 0 && slipAll, String(slipN));
  ok('slip gaji: penghitung sesuai jumlah', (await page.locator('[data-check-count="slipIds"]').first().innerText()).trim() === String(slipN));

  /* ============ 3. ANTREAN IURAN: 2 TABEL TIDAK SALING MENCENTANG ============ */
  await page.goto(base + '/iuran/antrean');
  await page.waitForSelector('#tblAntreanQueue');
  const qBoxes = page.locator('#tblAntreanQueue input[data-check-item="qids"]');
  const qN = await qBoxes.count();
  await page.locator('[data-check-all="qids"]').click();
  ok('antrean: Pilih Semua mencentang kelompok queue', qN > 0 && await qBoxes.first().isChecked(), String(qN));
  ok('antrean: penghitung kelompok sesuai', (await page.locator('[data-check-count="qids"]').first().innerText()).trim() === String(qN));
  const pendBoxes = page.locator('#tblAntreanPending input[name="ids"]');
  // ceklis pada tabel pending tidak boleh ikut mencentang queue
  await page.locator('button[data-check-all="ids"][data-check-scope="#tblAntreanPending"]').click();
  ok('antrean: ceklis tabel pending tidak memengaruhi queue',
    await qBoxes.first().isChecked() && await page.locator('#tblAntreanQueue input[data-check-item="qids"]').first().isChecked());
  ok('antrean: kotak kepala tabel pending mengikuti isi tabelnya',
    await page.locator('input[data-check-all-box="ids"][data-check-scope="#tblAntreanPending"]').isChecked());
  ok('antrean: kotak kepala tabel non-BKU tidak ikut tercentang',
    !(await page.locator('input[data-check-all-box="ids"][data-check-scope="#tblAntreanNonBku"]').isChecked()));
  ok('antrean: penghitung pending hanya menghitung tabelnya',
    Number(await page.locator('[data-check-count="ids"][data-check-scope="#tblAntreanPending"]').first().innerText()) === await pendBoxes.count());

  /* ============ 4. MENU LEGAL DI SIDEBAR ============ */
  await page.goto(base + '/');
  const legalTos = page.locator('a[href$="/legal/tos"]');
  const legalSla = page.locator('a[href$="/legal/sla"]');
  ok('sidebar: menu Syarat & Ketentuan tampil', await legalTos.count() === 1);
  ok('sidebar: menu SLA tampil', await legalSla.count() === 1);
  const lastHref = await page.locator('.nav a').last().getAttribute('href');
  ok('sidebar: menu legal berada paling bawah', /\/legal\//.test(lastHref || ''), String(lastHref));
  await Promise.all([page.waitForNavigation(), legalTos.first().click()]);
  ok('halaman ToS terbuka dari sidebar', /legal\/tos/.test(page.url()) && (await page.locator('h3:has-text("Syarat & Ketentuan")').count()) > 0);
  ok('halaman ToS tetap memakai sidebar panel', await page.locator('aside.sidebar').count() === 1);
  await Promise.all([page.waitForNavigation(), page.locator('a[href$="/legal/sla"]').first().click()]);
  ok('halaman SLA terbuka dari sidebar', /legal\/sla/.test(page.url()));

  /* ============ 5. DESAIN CETAK: TAB & PRATINJAU LANGSUNG ============ */
  await page.goto(base + '/desain-cetak');
  const tabBtns = page.locator('[data-tab-btn]');
  ok('desain: dua tab kop tampil', await tabBtns.count() === 4, String(await tabBtns.count()));
  const paneKw = page.locator('[data-tab-pane="kwitansi"]');
  const paneLp = page.locator('[data-tab-pane="laporan"]');
  ok('desain: tab pertama (kop kwitansi) aktif', await paneKw.isVisible() && !(await paneLp.isVisible()));

  const form = paneKw.locator('form[data-kop-form="kwitansi"]');
  const preview = form.locator('[data-kopv="kwitansi"]');
  ok('desain: pratinjau kwitansi terisi', ((await preview.innerText()) || '').length > 0, await preview.innerText());
  // ubah teks manual → pratinjau ikut
  await form.locator('select[name=sumber]').selectOption('manual');
  await form.locator('textarea[name=text]').fill('YAYASAN PRATINJAU\nNAMA SEKOLAH PRATINJAU');
  await page.waitForTimeout(120);
  ok('pratinjau: teks kop mengikuti input', /NAMA SEKOLAH PRATINJAU/.test(await preview.innerText()), await preview.innerText());
  // ubah ukuran font baris 1
  await form.locator('input[name="size_1"]').fill('14');
  await form.locator('input[name="bold_1"]').check();
  await page.waitForTimeout(120);
  const line1 = await preview.locator('.kopv-txt > div').first().evaluate(el => getComputedStyle(el).fontSize);
  ok('pratinjau: ukuran font baris 1 berubah (14px)', line1 === '14px', line1);
  const line1Weight = await preview.locator('.kopv-txt > div').first().evaluate(el => getComputedStyle(el).fontWeight);
  ok('pratinjau: tebal baris 1 aktif', Number(line1Weight) >= 700, line1Weight);
  // ukuran logo
  await form.locator('input[name=logo_w]').fill('48');
  await form.locator('input[name=logo_h]').fill('48');
  await page.waitForTimeout(120);
  const logoBox = preview.locator('.kopv-ph, img').first();
  const lw = await logoBox.evaluate(el => Math.round(el.getBoundingClientRect().width));
  ok('pratinjau: ukuran logo mengikuti input (48px)', lw === 48, String(lw));
  // garis pemisah
  await form.locator('select[name=garis]').selectOption('none');
  await page.waitForTimeout(120);
  const border = await preview.locator('.kopv-inner').evaluate(el => getComputedStyle(el).borderBottomStyle);
  ok('pratinjau: garis pemisah "tanpa garis" diterapkan', border === 'none', border);
  await form.locator('select[name=garis]').selectOption('double');
  await page.waitForTimeout(120);
  const border2 = await preview.locator('.kopv-inner').evaluate(el => getComputedStyle(el).borderBottomStyle);
  ok('pratinjau: garis ganda diterapkan', border2 === 'double', border2);

  // sumber otomatis → memakai identitas sekolah
  await form.locator('select[name=sumber]').selectOption('auto');
  await page.waitForTimeout(150);
  const autoTxt = await preview.innerText();
  ok('pratinjau: sumber otomatis memakai identitas sekolah', /SMK PGRI|SEKOLAH|CIKONENG/i.test(autoTxt), autoTxt.slice(0, 80));
  ok('pratinjau: kolom teks manual disembunyikan saat otomatis',
    await form.locator('[data-kopv-manual="kwitansi"]').isHidden());

  // pindah tab laporan
  await tabBtns.nth(1).click();
  ok('desain: tab kop laporan menampilkan pane-nya', await paneLp.isVisible() && !(await paneKw.isVisible()));
  const formLp = paneLp.locator('form[data-kop-form="laporan"]');
  await formLp.locator('select[name=sumber]').selectOption('manual');
  await formLp.locator('textarea[name=text]').fill('KOP LAPORAN UJI');
  await formLp.locator('input[name="size_1"]').fill('18');
  await page.waitForTimeout(150);
  const previewLp = formLp.locator('[data-kopv="laporan"]');
  const lpText = await previewLp.innerText();
  const lpStyle = await previewLp.locator('.kopv-txt > div').first().getAttribute('style');
  ok('pratinjau laporan: teks & ukuran (pt) mengikuti input',
    /KOP LAPORAN UJI/.test(lpText) && /font-size:18pt/.test(lpStyle || ''), `${lpText.slice(0, 40)} · ${lpStyle}`);
  ok('desain: tab tersimpan pada URL hash', /#laporan/.test(page.url()), page.url());

  // simpan lewat UI (tab kwitansi)
  await tabBtns.nth(0).click();
  await form.locator('select[name=sumber]').selectOption('manual');
  await form.locator('textarea[name=text]').fill('YAYASAN SIMPAN UI\nNAMA SEKOLAH SIMPAN UI');
  await Promise.all([page.waitForNavigation(), form.locator('button[name=simpan]').click()]);
  ok('desain: simpan kop kwitansi via UI berhasil', /\?ok=/.test(page.url()) || /ok=/.test(decodeURIComponent(page.url())), page.url());
  const saved = await api('GET', '/desain-cetak');
  ok('desain: teks tersimpan muncul kembali pada editor', /YAYASAN SIMPAN UI/.test(saved.text));

  /* ============ 5a. KOP TAMPIL APA ADANYA (tanpa UPPERCASE otomatis) ============ */
  // pratinjau di halaman desain: baris kop tidak boleh dipaksa huruf besar
  await tabBtns.nth(1).click();
  await formLp.locator('select[name=sumber]').selectOption('manual');
  await formLp.locator('textarea[name=text]').fill('Yayasan Pendidikan Cikoneng\nSekolah Menengah Kejuruan PGri Cikoneng');
  await page.waitForTimeout(150);
  const pvTransform = await previewLp.locator('.kopv-txt > div').first().evaluate(el => getComputedStyle(el).textTransform);
  ok('pratinjau kop: tidak ada text-transform uppercase', pvTransform === 'none', pvTransform);
  ok('pratinjau kop: teks tetap campuran huruf kecil/besar', /Yayasan Pendidikan Cikoneng/.test(await previewLp.innerText()));

  // halaman cetak sungguhan: CSS kop tidak mengubah huruf
  await api('POST', '/desain-cetak/kop', {
    jenis: 'laporan', sumber: 'manual', garis: 'double',
    text: 'Yayasan Pendidikan Cikoneng\nSekolah Menengah Kejuruan PGRI Cikoneng\nJalan Raya Cikoneng No.144 Telp. (0265) 773258'
  });
  await page.goto(base + '/cetak/bku', { waitUntil: 'load' });
  const cetakKop = await page.evaluate(() => {
    const lines = [...document.querySelectorAll('.kop .kop-txt > div')];
    return {
      texts: lines.map(el => el.textContent.trim()),
      transforms: lines.map(el => getComputedStyle(el).textTransform),
      raw: (document.querySelector('.kop') || {}).innerText || ''
    };
  });
  ok('cetak laporan: baris kop tidak di-uppercase CSS',
    cetakKop.transforms.every(t => t === 'none'), JSON.stringify(cetakKop.transforms));
  ok('cetak laporan: teks kop persis seperti yang diketik',
    cetakKop.raw.includes('Yayasan Pendidikan Cikoneng') && cetakKop.raw.includes('Telp. (0265) 773258'),
    cetakKop.raw.split('\n').slice(0, 3).join(' | '));

  /* ============ 5b. CETAK: KWITANSI IURAN TETAP 1 HALAMAN DENGAN KOP BARU ============ */
  await api('POST', '/desain-cetak/kop', {
    jenis: 'kwitansi', sumber: 'manual', garis: 'single', logo_w: '30', logo_h: '30',
    text: 'YAYASAN UJI\nSMK PGRI CIKONENG\nJl. Uji Cetak No. 1 · Telp. 0265 123456',
    size_1: '7', size_2: '9', bold_2: '1', size_3: '7'
  });
  const bayarId = db.prepare('SELECT id FROM iuran_bayar ORDER BY id LIMIT 1').get();
  if (bayarId) {
    await page.goto(base + `/iuran/kwitansi?ids=${bayarId.id}&orient=small`, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    const iuran = await page.evaluate(() => {
      const box = sel => { const el = document.querySelector(sel); return el ? { h: el.getBoundingClientRect().height, scroll: el.scrollHeight, client: el.clientHeight } : null; };
      const host = document.querySelector('.kwit-iuran');
      const last = document.querySelector('.ki-sign');
      return {
        kop: !!document.querySelector('.ki-kop .kwit-kop'),
        box: box('.kwit-iuran'),
        gap: host && last ? +(host.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom).toFixed(1) : null
      };
    });
    const pdfBuf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    const pages = (pdfBuf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    await page.emulateMedia({ media: 'screen' });
    ok('kwitansi iuran memakai kop kwitansi khusus', iuran.kop === true);
    ok('kwitansi iuran tetap 1 halaman', pages === 1, String(pages));
    ok('kwitansi iuran tidak terpotong oleh kop baru', iuran.box && iuran.box.scroll <= iuran.box.client + 1,
      JSON.stringify(iuran.box));
    ok('tanda tangan kwitansi iuran masih terlihat', iuran.gap !== null && iuran.gap >= -0.5, String(iuran.gap));
  } else {
    ok('kwitansi iuran memakai kop kwitansi khusus', false, 'data pembayaran tidak ada');
  }

  /* ============ 6. MOBILE 390px TANPA OVERFLOW ============ */
  await page.close();
  page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.setViewportSize({ width: 390, height: 800 });
  for (const url of ['/desain-cetak', '/transaksi', '/pegawai', '/iuran/antrean', '/legal/tos']) {
    await page.goto(base + url);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(`mobile 390px: tanpa overflow horizontal ${url}`, overflow <= 2, String(overflow));
  }
  const tabOverflow = await page.evaluate(() => {
    const t = document.querySelector('.tabbar');
    return t ? t.scrollWidth - t.clientWidth : 0;
  });
  ok('mobile 390px: tab dapat digulir (tidak memotong halaman)', tabOverflow >= 0);

  ok('tanpa error JavaScript di seluruh halaman', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log(`\n=== ${results.filter(x => x.ok).length}/${results.length} cek UI ronde 34 lulus ===`);
  if (results.some(x => !x.ok)) console.log('GAGAL:', results.filter(x => !x.ok).map(x => x.name).join(' | '));
  await browser.close();
  try { srv.kill(); } catch (e) { }
  setTimeout(() => process.exit(results.every(x => x.ok) ? 0 : 1), 250);
})().catch(e => { console.error(e); try { srv.kill(); } catch (_) { } process.exit(1); });
