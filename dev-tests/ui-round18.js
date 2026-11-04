'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* UI ronde 18 (Playwright): rincian bulanan di portal publik, kolom catatan portal pegawai,
   pengaturan alamat portal, pemisahan kelompok posting ekskul, mobile 390px, tanpa error JS. */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
const { chromium } = require('playwright');

const PORT = 3633;
const DB = process.env.R18U_DB || path.join(os.tmpdir(), 'smk-r18u-' + Date.now() + '.sqlite');
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, DB_PATH: DB }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
const results = [];
function ok(name, cond, extra = '') { results.push({ name, ok: !!cond, extra }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' → ' + extra)); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  let cookie = '';
  async function api(method, url, body) {
    const headers = { Cookie: cookie };
    let payload = null;
    if (body) { payload = new URLSearchParams(body).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
    const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, text: await r.text(), loc: r.headers.get('location') || '' };
  }
  await api('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  const db = new Database(DB);
  const ta = db.prepare('SELECT * FROM tahun_ajaran ORDER BY id LIMIT 1').get();
  await api('POST', '/program-keahlian/save', { nama: 'TKRO', program_studi: 'TKRO', ketua: 'K' });
  const prog = db.prepare("SELECT * FROM program_keahlian WHERE nama='TKRO'").get();
  await api('POST', '/kelas/save', { nama: 'XII TKRO 1', tingkat: 'XII', wali_kelas: 'W', program_id: prog.id, aktif: '1' });
  const kelas = db.prepare("SELECT * FROM kelas WHERE nama='XII TKRO 1'").get();
  await api('POST', '/siswa/save', { nisn: '9501', nama: 'Abdul Kholik', jenis_kelamin: 'L', tanggal_lahir: '2008-01-20', kelas_id: kelas.id });
  const siswa = db.prepare("SELECT * FROM siswa WHERE nisn='9501'").get();
  await api('POST', '/iuran/save', { nama: 'SPP', jenis: 'bulanan', mode_nominal: 'rata', nominal_rata: '150000', aktif: '1', tahun_ajaran_id: ta.id });
  const g = db.prepare("SELECT * FROM iuran_grup WHERE nama='SPP'").get();
  await api('POST', `/iuran/grup/${g.id}/tetapkan`, { kelas_id: kelas.id, siswa_id: [siswa.id] });
  const tag = db.prepare('SELECT * FROM iuran_tagihan WHERE grup_id=?').get(g.id);
  const today = new Date().toISOString().slice(0, 10);
  await api('POST', '/iuran/bayar-item', {
    back: `/iuran/data/${siswa.id}`, n: '1',
    key_0: `m:${tag.id}:7`, tanggal_0: today, metode_0: 'tunai', jumlah_0: '150000', potongan_0: '0', bku_0: '', nonbku_0: '1'
  });
  db.prepare("INSERT INTO pegawai (nama,jabatan,tipe,aktif,whatsapp,tanggal_lahir) VALUES (?,?,?,1,?,?)")
    .run('Rina Wulandari', 'Guru', 'guru', '081234567890', '1990-05-05');
  const periode = ta.tanggal_mulai.slice(0, 7);
  await api('POST', '/ekskul/save', { jenis: 'Pramuka', nama_pembina: 'Pembina A', periode, kehadiran: '5', harga_satuan: '50000' });
  await api('POST', '/ekskul/save', { jenis: 'Paskibra', nama_pembina: 'Pembina B', periode, kehadiran: '3', harga_satuan: '50000' });

  const errors = [];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e.message)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  /* ---------- portal publik: rincian bulanan ---------- */
  await page.goto(`${base}/portal?nama=${encodeURIComponent('Abdul Kholik')}&lahir=2008-01-20`);
  const bodyText = await page.locator('.portal-wrap').innerText();
  ok('portal publik menampilkan 12 bulan SPP', (bodyText.match(/SPP - [A-Za-z]+ \d{4}/g) || []).length >= 12,
    String((bodyText.match(/SPP - [A-Za-z]+ \d{4}/g) || []).length));
  ok('bulan Juli & Juni tampil', /SPP - Juli \d{4}/.test(bodyText) && /SPP - Juni \d{4}/.test(bodyText));
  ok('baris bulan bergaya khusus', await page.locator('.portal-bill tr.month-line').count() >= 12);
  const overPortal = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok('portal desktop tanpa overflow horizontal', overPortal <= 1, String(overPortal));

  /* ---------- portal pegawai: kolom catatan ---------- */
  await page.goto(base + '/portal-pegawai');
  await page.fill('input[name=nama]', 'Rina Wulandari');
  await page.fill('input[name=lahir]', '1990-05-05');
  await Promise.all([page.waitForNavigation(), page.click('button.btn-primary')]);
  const kode = (/kode OTP Anda: (\d{4})/.exec(await page.locator('.portal-wrap').innerText()) || [])[1];
  await page.fill('input[name=kode]', kode);
  await Promise.all([page.waitForNavigation(), page.click('button.btn-primary')]);
  ok('halaman rincian piutang memuat kolom catatan', /Kolom Catatan untuk Bendahara/.test(await page.locator('.portal-wrap').innerText()));
  await page.fill('form[action$="/pesan"] textarea[name=pesan]', 'Cicilan piutang saya belum tercatat pada rincian.');
  await Promise.all([page.waitForNavigation(), page.click('form[action$="/pesan"] button.btn-primary')]);
  ok('catatan terkirim & konfirmasi tampil', /sudah dikirim ke bendahara/.test(await page.locator('.portal-wrap').innerText()));
  ok('catatan tersimpan dengan sumber piutang-pegawai', db.prepare("SELECT COUNT(*) c FROM portal_pesan WHERE sumber='piutang-pegawai'").get().c === 1);

  /* ---------- admin: pengaturan alamat portal ---------- */
  await page.goto(base + '/login');
  await page.fill('input[name=kode]', 'SK01');
  await page.fill('input[name=email]', 'admin@sekolah.sch.id');
  await page.fill('input[name=password]', 'admin123');
  await Promise.all([page.waitForNavigation(), page.click('button[type=submit]')]);
  // pengaturan alamat portal pindah ke menu Portal Publik (ronde 26)
  await page.goto(base + '/portal-publik');
  ok('form alamat portal ada', await page.locator('input[name=portal_slip_slug]').count() === 1);
  ok('form URL portal publik (slug unik) ada', await page.locator('form[action$="/sekolah/portal"] input[name=portal_slug]').count() === 1);
  await page.fill('input[name=portal_slip_slug]', 'portal-slip-pegawai');
  await page.fill('input[name=portal_pegawai_slug]', 'piutang-pegawai');
  await Promise.all([page.waitForNavigation(), page.click('button:has-text("Simpan Alamat Portal")')]);
  ok('simpan alamat portal berhasil', /disimpan/.test((await page.locator('main.content').innerText())));
  const r2 = await fetch(base + '/portal-slip-pegawai', { redirect: 'manual' });
  ok('alamat baru portal slip dapat dibuka', r2.status === 200);

  /* ---------- ekskul: kelompok terpisah ---------- */
  await page.goto(base + '/ekskul/antrean');
  const antreanText = await page.locator('main.content').innerText();
  ok('kelompok Pramuka & Paskibra terpisah', /Pramuka — Periode/.test(antreanText) && /Paskibra — Periode/.test(antreanText));
  ok('dua tombol posting (satu per jenis)', await page.locator('button:has-text("Posting ke BKU")').count() === 2,
    String(await page.locator('button:has-text("Posting ke BKU")').count()));
  await ctx.close();

  /* ---------- mobile 390px ---------- */
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', e => errors.push(String(e.message)));
  for (const u of [`/portal?nama=${encodeURIComponent('Abdul Kholik')}&lahir=2008-01-20`, '/portal-pegawai', '/portal-slip']) {
    await p2.goto(base + u);
    const over = await p2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(`mobile 390px tanpa overflow ${u.split('?')[0]}`, over <= 1, String(over));
  }
  await ctx2.close();
  await browser.close();

  ok('tanpa error JS di halaman uji', errors.length === 0, errors.slice(0, 3).join(' | '));

  srv.kill(); db.close();
  const pass = results.filter(x => x.ok).length;
  console.log(`\n=== ${pass}/${results.length} cek UI ronde 18 lulus ===`);
  if (pass !== results.length) { console.log('LOG:\n' + log.slice(-1200)); process.exit(1); }
})().catch(e => { console.error('FATAL', e); try { srv.kill(); } catch (_) { } process.exit(1); });
