'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* UI ronde 12: ceklis siswa & perubahan massal, riwayat rekap input piutang,
   hapus/edit riwayat pembayaran, dashboard tanpa notifikasi kelulusan */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');
const { chromium } = require('playwright');

const PORT = 3646;
const DB = process.env.R12UI_DB || path.join(os.tmpdir(), 'smk-r12ui-' + Date.now() + '.sqlite');
const OUT = process.env.SHOT_DIR || path.join(os.tmpdir(), 'shots-r12');
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, DB_PATH: DB }, stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function ok(name, cond, extra = '') { results.push({ name, ok: !!cond, extra }); if (!cond) console.log('FAIL', name, extra); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  const login = await fetch(base + '/login', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'email=admin@sekolah.sch.id&password=admin123', redirect: 'manual'
  });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const post = async (url, body) => {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) Array.isArray(v) ? v.forEach(x => usp.append(k, x)) : usp.append(k, v);
    return fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: usp.toString(), redirect: 'manual' });
  };
  const db = new Database(DB);
  const today = new Date().toISOString().slice(0, 10);
  const ta = db.prepare('SELECT * FROM tahun_ajaran ORDER BY id LIMIT 1').get();

  /* data: pegawai, piutang umum + cicilan, piutang sertifikasi, kelas + 3 siswa */
  await post('/pegawai/save', { nama: 'Rina Uji', jabatan: 'Guru', tipe: 'guru', aktif: '1', tanggal_lahir: '1990-01-01', whatsapp: '081200000009' });
  await post('/piutang/save', { nama_pegawai: 'Rina Uji', tanggal_utang: today, nominal: '750000', keterangan: 'Pinjaman koperasi' });
  const piu = db.prepare("SELECT * FROM piutang WHERE nama_pegawai='Rina Uji' ORDER BY id DESC LIMIT 1").get();
  await post('/piutang/bayar', { id: piu.id, nominal: '250000', tanggal_bayar: today, metode: 'transfer', keterangan: 'cicilan pertama' });
  await post('/piutang-lain/save', { nama: 'Rina Uji', tanggal: today, nominal: '300000', keterangan: 'Sertifikasi 2026' });
  const pl = db.prepare("SELECT * FROM piutang_lain WHERE nama='Rina Uji' ORDER BY id DESC LIMIT 1").get();
  await post('/piutang-lain/bayar', { id: pl.id, nominal: '100000', tanggal_bayar: today, metode: 'tunai' });

  await post('/program-keahlian/save', { nama: 'TKJ', program_studi: 'TKJ', ketua: 'K' });
  const prog = db.prepare("SELECT * FROM program_keahlian WHERE nama='TKJ'").get();
  await post('/kelas/save', { nama: 'XII TKJ 1', tingkat: 'XII', wali_kelas: 'W', program_id: prog.id, aktif: '1' });
  const kelas = db.prepare("SELECT * FROM kelas WHERE nama='XII TKJ 1'").get();
  for (const [n, nm] of [['7001', 'Alfa Siswa'], ['7002', 'Beta Siswa'], ['7003', 'Gama Siswa']]) {
    await post('/siswa/save', { nisn: n, nama: nm, jenis_kelamin: 'L', tanggal_lahir: '2008-03-03', kelas_id: kelas.id });
  }

  const browser = await chromium.launch();
  const ctxOf = async (viewport) => {
    const ctx = await browser.newContext({ viewport });
    await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=').slice(1).join('='), url: base }]);
    return ctx;
  };
  const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  /* ===== 1. Data Siswa: ceklis, pilih semua, perubahan massal ===== */
  {
    const ctx = await ctxOf({ width: 1500, height: 1000 });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(base + '/siswa?ta=' + ta.id + '&kelas=' + kelas.id, { waitUntil: 'networkidle' });
    ok('data siswa: tanpa error JS', errs.length === 0, errs.join(' | '));
    ok('ceklis per baris ada', await page.locator('tbody input[name="siswa"]').count() === 3);
    ok('ceklis pilih semua di header', await page.locator('thead input[data-check-all-box="siswa"]').count() === 1);
    await page.screenshot({ path: path.join(OUT, '01-siswa.png'), fullPage: true });

    // klik Pilih Semua → semua tercentang & penghitung = 3
    await page.click('button:has-text("Pilih Semua")');
    const checked = await page.locator('tbody input[name="siswa"]:checked').count();
    const counter = (await page.locator('[data-check-count="siswa"]').first().textContent()).trim();
    ok('Pilih Semua mencentang semua siswa', checked === 3, String(checked));
    ok('penghitung terpilih ikut update', counter === '3', counter);

    // header master checkbox → kosongkan
    await page.locator('thead input[data-check-all-box="siswa"]').uncheck();
    ok('master checkbox mengosongkan pilihan', await page.locator('tbody input[name="siswa"]:checked').count() === 0);

    // perubahan massal: status lulus untuk 2 siswa
    await page.locator('tbody input[name="siswa"]').nth(0).check();
    await page.locator('tbody input[name="siswa"]').nth(1).check();
    await page.selectOption('#fBulkSiswa select[name="status"]', 'lulus');
    page.once('dialog', d => d.accept());
    await page.click('#fBulkSiswa button:has-text("Terapkan ke Siswa Terpilih")');
    await page.waitForLoadState('networkidle');
    const lunus = db.prepare("SELECT COUNT(*) c FROM siswa WHERE kelas_id=? AND status='lulus'").get(kelas.id).c;
    ok('perubahan massal status kelulusan bekerja', lunus === 2, String(lunus));
    ok('flash sukses tampil', /diubah statusnya menjadi/i.test(await page.locator('body').textContent()));
    ok('diarahkan ke halaman siswa non-aktif', /siswa-nonaktif/.test(page.url()), page.url());
    ok('siswa lulus tampil di halaman non-aktif', /Alfa Siswa/.test(await page.locator('body').textContent()));

    // perubahan massal: penetapan kelas (siswa yang masih aktif)
    await page.goto(base + '/kelas', { waitUntil: 'domcontentloaded' });
    await post('/kelas/save', { nama: 'XI TKJ 2', tingkat: 'XI', wali_kelas: 'W2', program_id: prog.id, aktif: '1' });
    const kelas2 = db.prepare("SELECT * FROM kelas WHERE nama='XI TKJ 2'").get();
    await page.goto(base + '/siswa?ta=' + ta.id + '&kelas=' + kelas.id, { waitUntil: 'networkidle' });
    ok('siswa lulus tidak lagi tampil di data siswa aktif', await page.locator('tbody input[name="siswa"]').count() === 1);
    await page.locator('tbody input[name="siswa"]').first().check();
    await page.selectOption('#fBulkSiswa select[name="kelas_id"]', String(kelas2.id));
    page.once('dialog', d => d.accept());
    await page.click('#fBulkSiswa button:has-text("Terapkan ke Siswa Terpilih")');
    await page.waitForLoadState('networkidle');
    ok('perubahan massal penetapan kelas bekerja',
      Number(db.prepare('SELECT kelas_id FROM siswa WHERE nisn=?').get('7003').kelas_id) === Number(kelas2.id));
    await ctx.close();
  }

  /* ===== 2. Piutang: riwayat rekap input di bawah + hapus/edit riwayat pembayaran ===== */
  {
    const ctx = await ctxOf({ width: 1500, height: 1000 });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(base + '/piutang', { waitUntil: 'networkidle' });
    ok('piutang: tanpa error JS', errs.length === 0, errs.join(' | '));

    // kartu rekap input ada di paling bawah
    const rekapTop = await page.evaluate(() => {
      const el = document.getElementById('rekapInput');
      return el ? el.getBoundingClientRect().top + window.scrollY : -1;
    });
    const sppTop = await page.evaluate(() => {
      const h = Array.from(document.querySelectorAll('h3')).find(x => /Tagihan SPP Siswa/.test(x.textContent));
      return h ? h.getBoundingClientRect().top + window.scrollY : -1;
    });
    ok('kartu rekap input berada setelah kartu SPP', rekapTop > sppTop && sppTop > 0, `${sppTop} < ${rekapTop}`);
    ok('rekap input memuat baris umum & sertifikasi', await page.locator('#tblRekapInput tbody tr').count() >= 2);
    await page.locator('#rekapInput').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(OUT, '02-rekap-input.png'), fullPage: false });

    // buka modal riwayat cicilan → tombol hapus & edit ada
    await page.goto(base + '/piutang', { waitUntil: 'networkidle' });
    await page.locator('button:has-text("Riwayat")').first().click();
    await page.waitForTimeout(300);
    ok('modal riwayat menampilkan tombol hapus pembayaran',
      await page.locator('form[action$="/piutang/bayar/delete"]').count() >= 1);
    ok('modal riwayat menampilkan tombol edit pembayaran',
      await page.locator('button[data-open^="mBayarEd"]').count() >= 1);
    await page.screenshot({ path: path.join(OUT, '03-riwayat-cicilan.png'), fullPage: false });

    // hapus lewat UI
    const before = db.prepare('SELECT COUNT(*) c FROM piutang_bayar WHERE piutang_id=?').get(piu.id).c;
    page.once('dialog', d => d.accept());
    await page.locator('form[action$="/piutang/bayar/delete"] button').first().click();
    await page.waitForLoadState('networkidle');
    const after = db.prepare('SELECT COUNT(*) c FROM piutang_bayar WHERE piutang_id=?').get(piu.id).c;
    ok('hapus riwayat pembayaran lewat UI', after === before - 1, `${before} → ${after}`);
    ok('status piutang kembali belum lunas', db.prepare('SELECT status FROM piutang WHERE id=?').get(piu.id).status === 'belum');
    await ctx.close();
  }

  /* ===== 3. Piutang sertifikasi: hapus pembayaran lewat UI ===== */
  {
    const ctx = await ctxOf({ width: 1440, height: 1000 });
    const page = await ctx.newPage();
    await page.goto(base + '/piutang-lain', { waitUntil: 'networkidle' });
    await page.locator('button[data-open^="mPlRiwayat"]').first().click();
    await page.waitForTimeout(300);
    ok('riwayat sertifikasi punya tombol hapus', await page.locator('form[action$="/piutang-lain/bayar/delete"]').count() >= 1);
    ok('riwayat sertifikasi punya tombol edit', await page.locator('button[data-open^="mPlBayarEd"]').count() >= 1);
    const before = db.prepare('SELECT COUNT(*) c FROM piutang_lain_bayar WHERE piutang_id=?').get(pl.id).c;
    page.once('dialog', d => d.accept());
    await page.locator('form[action$="/piutang-lain/bayar/delete"] button').first().click();
    await page.waitForLoadState('networkidle');
    const after = db.prepare('SELECT COUNT(*) c FROM piutang_lain_bayar WHERE piutang_id=?').get(pl.id).c;
    ok('hapus pembayaran sertifikasi lewat UI', after === before - 1, `${before} → ${after}`);
    await ctx.close();
  }

  /* ===== 4. Dashboard tanpa notifikasi kelulusan ===== */
  {
    const ctx = await ctxOf({ width: 1440, height: 1000 });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    ok('dashboard tanpa pop-up kelulusan', await page.locator('#mGradNotice').count() === 0);
    ok('dashboard tanpa error JS', errs.length === 0, errs.join(' | '));
    await page.screenshot({ path: path.join(OUT, '04-dashboard.png'), fullPage: false });
    await ctx.close();
  }

  /* ===== 5. mobile tanpa overflow ===== */
  {
    const ctx = await ctxOf({ width: 390, height: 900 });
    const page = await ctx.newPage();
    await page.goto(base + '/siswa?ta=' + ta.id, { waitUntil: 'networkidle' });
    ok('data siswa mobile tanpa overflow', (await overflow(page)) <= 2, String(await overflow(page)));
    await page.goto(base + '/piutang', { waitUntil: 'networkidle' });
    ok('piutang mobile tanpa overflow', (await overflow(page)) <= 2, String(await overflow(page)));
    await ctx.close();
  }

  await browser.close();
  db.close();
  srv.kill();
  const pass = results.filter(x => x.ok).length;
  console.log(`\n=== ${pass}/${results.length} cek UI ronde 12 lulus ===\nscreenshot: ${OUT}`);
  if (pass !== results.length) {
    console.log('GAGAL:', results.filter(x => !x.ok).map(x => x.name).join(' | '));
    if (!/SIMKEU Sekolah listening/.test(log)) console.log('log:', log.slice(-800));
    process.exit(1);
  }
})().catch(e => { console.error(e); try { srv.kill(); } catch (_) { } process.exit(1); });
