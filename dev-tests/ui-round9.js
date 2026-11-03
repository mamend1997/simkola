'use strict';
/* UI test ronde 9 (Playwright): sidebar collapse, filter metode dashboard, modal bayar item terpilih,
   autocomplete + datepicker portal, OTP portal pegawai/slip, kalkulator beasiswa, mobile & tanpa error JS */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright');

const PORT = 3601;
const DB = path.join(os.tmpdir(), 'smk-ui9-' + Date.now() + '.sqlite');
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, DB_PATH: DB }, stdio: ['ignore', 'pipe', 'pipe'] });
const base = `http://127.0.0.1:${PORT}`;
let cookie = '';
const results = [];
function ok(name, cond, extra = '') { results.push({ name, ok: !!cond }); if (!cond) console.log('FAIL', name, extra); }
async function req(method, url, body) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload = null;
  if (body) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) Array.isArray(v) ? v.forEach(x => usp.append(k, x)) : usp.append(k, v);
    payload = usp.toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return r;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const today = new Date().toISOString().slice(0, 10);

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  const Database = require('better-sqlite3');
  const db = new Database(DB);
  const ta = db.prepare('SELECT * FROM tahun_ajaran ORDER BY id LIMIT 1').get();
  const bku = db.prepare('SELECT * FROM bku WHERE tahun_ajaran_id=? AND COALESCE(auto_mode,0)=0 ORDER BY id LIMIT 1').get(ta.id);

  // seed: kelas, siswa, grup bulanan (2 grup), pembayaran tunai & transfer
  await req('POST', '/program-keahlian/save', { nama: 'TKJ', program_studi: 'TKJ', ketua: 'K' });
  const prog = db.prepare("SELECT * FROM program_keahlian WHERE nama='TKJ'").get();
  await req('POST', '/kelas/save', { nama: 'X TKJ 9', tingkat: 'X', wali_kelas: 'W', program_id: prog.id, aktif: '1' });
  const kelas = db.prepare("SELECT * FROM kelas WHERE nama='X TKJ 9'").get();
  await req('POST', '/siswa/save', { nisn: '6001', nama: 'Rina Wulandari', jenis_kelamin: 'P', tanggal_lahir: '2010-06-06', kelas_id: kelas.id });
  const s1 = db.prepare("SELECT * FROM siswa WHERE nisn='6001'").get();
  await req('POST', '/iuran/save', { nama: 'SPP Bulanan', jenis: 'bulanan', mode_nominal: 'rata', nominal_rata: '100000', aktif: '1' });
  await req('POST', '/iuran/save', { nama: 'Iuran Kegiatan', jenis: 'bulanan', mode_nominal: 'rata', nominal_rata: '50000', aktif: '1' });
  const g1 = db.prepare("SELECT * FROM iuran_grup WHERE nama='SPP Bulanan'").get();
  const g2 = db.prepare("SELECT * FROM iuran_grup WHERE nama='Iuran Kegiatan'").get();
  await req('POST', `/iuran/grup/${g1.id}/tetapkan`, { kelas_id: kelas.id, siswa_id: [s1.id] });
  await req('POST', `/iuran/grup/${g2.id}/tetapkan`, { kelas_id: kelas.id, siswa_id: [s1.id] });
  const t1 = db.prepare('SELECT * FROM iuran_tagihan WHERE grup_id=?').get(g1.id);
  const t2 = db.prepare('SELECT * FROM iuran_tagihan WHERE grup_id=?').get(g2.id);
  await req('POST', '/iuran/bayar', { tagihan_id: t1.id, bulan: '7', tanggal: today, jumlah: '100000', potongan: '0', metode: 'tunai', bku_id: bku.id, back: `/iuran/data/${s1.id}` });
  await req('POST', '/iuran/bayar', { tagihan_id: t2.id, bulan: '8', tanggal: today, jumlah: '50000', potongan: '0', metode: 'transfer', bku_id: bku.id, back: `/iuran/data/${s1.id}` });
  await req('POST', '/pegawai/save', { nama: 'Rina Wulandari', jabatan: 'Guru TKJ', tipe: 'guru', aktif: '1', tanggal_lahir: '1987-02-02', whatsapp: '081211112222' });
  await req('POST', '/ekskul/save-grid', { periode: today.slice(0, 7), jenis: 'Pramuka', nama_pembina: ['Pembina Uji'], kehadiran: ['4'], harga_satuan: ['50000'] });

  const browser = await chromium.launch();
  const errors = [];
  const sid = cookie.split('=').slice(1).join('=');
  async function mkContext(viewport, withCookie = true) {
    const ctx = await browser.newContext({ viewport });
    if (withCookie) await ctx.addCookies([{ name: 'simkeu_sid', value: sid, url: base }]);
    return ctx;
  }
  async function visit(url, fn, { viewport = { width: 1280, height: 900 }, anon = false } = {}) {
    const ctx = await mkContext(viewport, !anon);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(url + ': ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(url + ' console: ' + m.text()); });
    await page.goto(base + url, { waitUntil: 'domcontentloaded' });
    if (fn) await fn(page);
    await ctx.close();
  }
  const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

  /* 1. sidebar collapse */
  await visit('/', async page => {
    ok('tombol collapse tersedia', await page.locator('#navCollapse').count() === 1);
    await page.click('#navCollapse');
    ok('sidebar terlipat', await page.locator('.shell.nav-collapsed').count() === 1);
    await page.reload({ waitUntil: 'domcontentloaded' });
    ok('status terlipat tersimpan setelah reload', await page.locator('.shell.nav-collapsed').count() === 1);
    await page.click('#navCollapse');
    ok('sidebar terbuka kembali', await page.locator('.shell.nav-collapsed').count() === 0);
  });

  /* 2. dashboard iuran: summary, matrix, filter metode */
  await visit('/', async page => {
    ok('summary total iuran tampil', await page.locator('text=Total Tagihan Iuran').count() > 0);
    ok('tabel matriks bulanan tampil', await page.locator('text=Total Tagihan per Bulan').count() > 0);
    ok('tabel metode pembayaran tampil', await page.locator('text=Rekapitulasi Metode Pembayaran').count() > 0);
    const firstMonth = await page.locator('#tblGrupIuran thead th').nth(1).textContent();
    const lastMonth = await page.locator('#tblGrupIuran thead th').nth(12).textContent();
    ok('kolom grup iuran dimulai Juli & berakhir Juni', /Jul/.test(firstMonth) && /Jun/.test(lastMonth), `${firstMonth}|${lastMonth}`);
    const allTotal = await page.locator('#tblGrupIuran tfoot [data-foot-total]').textContent();
    await page.selectOption('[data-iuran-metode]', 'tunai');
    const tunaiTotal = await page.locator('#tblGrupIuran tfoot [data-foot-total]').textContent();
    await page.selectOption('[data-iuran-metode]', 'transfer');
    const transferTotal = await page.locator('#tblGrupIuran tfoot [data-foot-total]').textContent();
    ok('filter metode mengubah angka realtime', allTotal !== tunaiTotal && tunaiTotal !== transferTotal, `${allTotal} / ${tunaiTotal} / ${transferTotal}`);
    ok('filter tunai & transfer menjumlah ke total', (() => {
      const num = t => Number(String(t).replace(/[^\d]/g, '')) || 0;
      return num(tunaiTotal) + num(transferTotal) === num(allTotal);
    })(), `${allTotal} = ${tunaiTotal} + ${transferTotal}`);
    ok('tanpa overflow horizontal', (await overflow(page)) <= 2, String(await overflow(page)));
  });

  /* 3. bayar item terpilih: modal input per item */
  await visit(`/iuran/data/${s1.id}`, async page => {
    const boxes = await page.locator('input[name="item"]').count();
    ok('ceklis item per bulan tersedia', boxes >= 24, String(boxes));
    await page.locator('input[name="item"]').nth(8).check();
    await page.locator('input[name="item"]').nth(9).check();
    await page.click('[data-bulk-pay]');
    ok('modal bayar item terpilih terbuka', await page.locator('#mBayarItem.show').count() === 1);
    ok('baris item mengikuti ceklis', await page.locator('#mBayarItem tbody tr').count() === 2, String(await page.locator('#mBayarItem tbody tr').count()));
    const jumlah = await page.locator('#mBayarItem input[name="jumlah_0"]').inputValue();
    ok('jumlah terisi otomatis dari sisa tagihan', /^\d{1,3}(\.\d{3})*$/.test(jumlah) && Number(jumlah.replace(/\./g, '')) > 0, jumlah);
    ok('field tanggal/metode/potongan/BKU per item ada',
      await page.locator('#mBayarItem input[name="tanggal_0"]').count() === 1 &&
      await page.locator('#mBayarItem select[name="metode_0"]').count() === 1 &&
      await page.locator('#mBayarItem input[name="potongan_0"]').count() === 1 &&
      await page.locator('#mBayarItem select[name="bku_0"]').count() === 1);
    await page.locator('#mBayarItem input[name="nonbku_1"]').check();
    const disabled = await page.locator('#mBayarItem select[name="bku_1"]').isDisabled();
    ok('centang Non-BKU menonaktifkan pilihan BKU baris itu', disabled);
    await page.keyboard.press('Escape');
    // toggle non-BKU pada form bayar per item
    const firstBayar = page.locator('button[data-open^="mBayar"]').first();
    await firstBayar.click();
    const modal = page.locator('.modal.show');
    await modal.locator('[data-nonbku]').first().check();
    ok('toggle Non-BKU menonaktifkan BKU', await modal.locator('[data-bku-select]').first().isDisabled());
  });

  /* 4. portal siswa: autocomplete + datepicker + feedback */
  await visit('/portal', async page => {
    ok('tanpa tombol login petugas', await page.locator('text=Login Petugas').count() === 0);
    ok('tanggal lahir memakai datepicker', await page.locator('input[name="lahir"][type="date"]').count() === 1);
    await page.fill('input[name="nama"]', 'Rin');
    await page.waitForTimeout(700);
    ok('dropdown autocomplete muncul ≥3 huruf', await page.locator('.ac-list.show .ac-item').count() > 0);
    await page.locator('.ac-list.show .ac-item').first().click();
    ok('klik saran mengisi kolom nama', (await page.inputValue('input[name="nama"]')).includes('Rina'));
    await page.fill('input[name="nama"]', 'Rina Wulandari');
    await page.fill('input[name="lahir"]', '2010-06-06');
    await page.click('button:has-text("Cari Tagihan")');
    await page.waitForLoadState('domcontentloaded');
    ok('hasil tagihan tampil', await page.locator('text=Kolom Catatan Orang Tua / Wali').count() > 0);
    ok('tombol kembali berlabel tepat', await page.locator('text=Kembali ke Halaman Pencarian').count() > 0);
    ok('tanpa overflow horizontal', (await overflow(page)) <= 2, String(await overflow(page)));
  });

  /* 5. portal pegawai: OTP → rincian piutang */
  await visit('/portal-pegawai', async page => {
    await page.fill('input[name="nama"]', 'Rina');
    await page.waitForTimeout(700);
    ok('autocomplete pegawai muncul', await page.locator('.ac-list.show .ac-item').count() > 0);
    await page.fill('input[name="nama"]', 'Rina Wulandari');
    await page.fill('input[name="lahir"]', '1987-02-02');
    await page.click('button:has-text("Kirim Kode OTP")');
    await page.waitForLoadState('domcontentloaded');
    ok('halaman verifikasi OTP tampil', await page.locator('text=Verifikasi Kode OTP').count() > 0);
    const banner = await page.locator('.alert.warn').first().textContent().catch(() => '');
    const kode = (/(\d{4})/.exec(banner || '') || [])[1] || '';
    ok('kode OTP demo tampil (gateway belum diatur)', /^\d{4}$/.test(kode), banner.slice(0, 60));
    await page.fill('input[name="kode"]', kode);
    await page.click('button:has-text("Verifikasi")');
    await page.waitForLoadState('domcontentloaded');
    ok('rincian piutang pegawai terbuka', await page.locator('text=Piutang Sertifikasi').count() > 0);
    ok('favicon memakai logo sekolah (route favicon)', await page.locator('link[rel="icon"]').getAttribute('href') === '/favicon.ico');
  });

  /* 6. portal slip gaji */
  await visit('/portal-slip', async page => {
    ok('form slip tanpa kolom nomor WhatsApp', await page.locator('input[name="wa"]').count() === 0);
    await page.fill('input[name="nama"]', 'Rina Wulandari');
    await page.fill('input[name="lahir"]', '1987-02-02');
    await page.click('button:has-text("Kirim Kode OTP")');
    await page.waitForLoadState('domcontentloaded');
    const banner = await page.locator('.alert.warn').first().textContent().catch(() => '');
    const kode = (/(\d{4})/.exec(banner || '') || [])[1] || '';
    await page.fill('input[name="kode"]', kode);
    await page.click('button:has-text("Verifikasi")');
    await page.waitForLoadState('domcontentloaded');
    ok('halaman slip gaji terbuka setelah OTP', /Slip Gaji/.test(await page.title()) && await page.locator('.portal-period select[name=bulan]').count() === 1);
    ok('cetak slip per periode tersedia', await page.locator('a[href*="/portal-slip/cetak"][href*="periode="]').count() > 0);
  });

  /* 7. beasiswa: kalkulator dua arah + pratinjau */
  await visit('/beasiswa', async page => {
    await page.check(`[data-bea-group="${g1.id}"]`);
    ok('pilihan bulan muncul untuk grup bulanan', await page.locator('[data-bea-bulan]').first().isVisible());
    await page.fill('[data-bea-nominal]', '150000');
    const pct = await page.inputValue('[data-bea-persen]');
    ok('isi nominal menghitung persentase otomatis', /^\d+(,\d)?$/.test(pct) && Number(pct.replace(',', '.')) > 0, pct);
    await page.fill('[data-bea-persen]', '25');
    await page.waitForTimeout(120);
    const nom = await page.inputValue('[data-bea-nominal]');
    const baseNom = Number(nom.replace(/\./g, '')) || 0;
    ok('isi persentase menghitung nominal otomatis', baseNom > 0 && nom !== '150.000', nom);
    await page.locator('input[name="nama"]').fill('Beasiswa Uji UI');
    await page.locator('input[name="penerima"]').first().check();
    ok('nominal potongan terisi setelah pilih penerima', (await page.inputValue('[data-bea-nominal]')).replace(/\./g, '').length > 0);
    ok('tanpa overflow horizontal', (await overflow(page)) <= 2, String(await overflow(page)));
  });

  /* 8. mobile */
  for (const p of ['/', `/iuran/data/${s1.id}`, '/beasiswa', '/pesan-orangtua', '/transaksi/kertas']) {
    const ctx = await mkContext({ width: 390, height: 780 });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('mobile ' + p + ': ' + e.message));
    await page.goto(base + p, { waitUntil: 'domcontentloaded' });
    ok('mobile tanpa overflow ' + p, (await overflow(page)) <= 2, String(await overflow(page)));
    await ctx.close();
  }

  ok('tanpa error JS', errors.length === 0, errors.slice(0, 4).join(' | '));
  await browser.close();
  const fail = results.filter(x => !x.ok);
  console.log(`\n=== ${results.length - fail.length}/${results.length} cek UI ronde 9 lulus ===`);
  if (fail.length) console.log(fail.map(f => '- ' + f.name).join('\n'));
  srv.kill();
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); srv.kill(); process.exit(2); });
