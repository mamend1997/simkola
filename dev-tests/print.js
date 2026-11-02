'use strict';
/* Test cetak kwitansi (rondе 14):
   1. Kwitansi transaksi 210 × 99 mm: kop ringkas ada, spasi rapat, PDF = 1 halaman
   2. Kwitansi iuran (Bukti Pembayaran Siswa): PDF = 1 halaman, isi tidak terpotong
   3. Cetak beberapa kwitansi sekaligus: 1 halaman per kwitansi
   Jalankan: node dev-tests/print.js
*/
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
const { chromium } = require('playwright');

const PORT = 3691;
const DB = process.env.PRINT_DB || path.join(os.tmpdir(), 'smk-print-' + Date.now() + '.sqlite');
const APP = path.join(__dirname, '..');
const srv = spawn(process.execPath, [path.join(APP, 'server.js')], {
  env: { ...process.env, PORT, DB_PATH: DB }, stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
let cookie = '';
const results = [];
function ok(name, cond, extra = '') { results.push({ name, ok: !!cond, extra }); if (!cond) console.log('FAIL', name, extra); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function req(method, url, body) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload = null;
  if (body) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (Array.isArray(v)) v.forEach(x => usp.append(k, x));
      else usp.append(k, v);
    }
    payload = usp.toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc && !cookie) cookie = sc.split(';')[0];
  return { status: r.status, text: await r.text(), loc: r.headers.get('location') || '' };
}
const pdfPages = pdf => (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

(async () => {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(120); }
  let r = await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login admin', r.status === 303);
  const db = new Database(DB);
  const ta = db.prepare('SELECT * FROM tahun_ajaran ORDER BY id LIMIT 1').get();
  const bku = db.prepare('SELECT * FROM bku WHERE COALESCE(auto_mode,0)=0 ORDER BY id LIMIT 1').get();
  const today = new Date().toISOString().slice(0, 10);

  /* ---------- siapkan data: siswa, grup iuran, pembayaran, transaksi ---------- */
  await req('POST', '/kelas/save', { nama: 'X AKL Cetak', tingkat: 'X', aktif: '1' });
  const kelas = db.prepare("SELECT * FROM kelas WHERE nama='X AKL Cetak'").get();
  ok('kelas uji dibuat', !!kelas);
  await req('POST', '/siswa/save', { nisn: '7770001', nama: 'Siswa Uji Cetak', jenis_kelamin: 'L', tanggal_lahir: '2010-05-05', kelas_id: kelas.id });
  const siswa = db.prepare("SELECT * FROM siswa WHERE nisn='7770001'").get();
  ok('siswa uji dibuat', !!siswa);
  await req('POST', '/iuran/save', { nama: 'SPP Cetak', jenis: 'bulanan', mode_nominal: 'rata', nominal_rata: '150000', aktif: '1' });
  const grup = db.prepare("SELECT * FROM iuran_grup WHERE nama='SPP Cetak'").get();
  ok('grup iuran uji dibuat', !!grup);
  await req('POST', `/iuran/grup/${grup.id}/tetapkan`, { kelas_id: kelas.id, siswa_id: [siswa.id] });
  const tagihan = db.prepare('SELECT * FROM iuran_tagihan WHERE grup_id=? AND siswa_id=?').get(grup.id, siswa.id);
  ok('tagihan uji dibuat', !!tagihan);
  // 5 pembayaran pada satu kwitansi (uji kwitansi "padat") + 1 transaksi untuk kwitansi transaksi
  let bayarIds = [];
  for (const bulan of [7, 8, 9, 10, 11]) {
    r = await req('POST', '/iuran/bayar', {
      tagihan_id: tagihan.id, bulan: String(bulan), tanggal: today, jumlah: '150000', potongan: '0',
      metode: 'tunai', nonbku: '1', back: `/iuran/data/${siswa.id}`
    });
    ok(`bayar bulan ${bulan}`, r.status === 303, r.loc);
  }
  bayarIds = db.prepare('SELECT id FROM iuran_bayar ORDER BY id').all().map(x => x.id);
  ok('5 pembayaran tercatat', bayarIds.length === 5, JSON.stringify(bayarIds));

  r = await req('POST', '/transaksi/save', {
    bku_id: bku.id, tanggal: today, jenis: 'pemasukan', metode: 'tunai',
    coa_id: db.prepare("SELECT id FROM coa WHERE kategori='pendapatan' ORDER BY kode LIMIT 1").get().id,
    nominal: '275000', uraian: 'Uji cetak kwitansi transaksi', nama_pihak: 'Bendahara Uji', after: 'simpan'
  });
  ok('transaksi uji disimpan', r.status === 303, r.loc);
  const trx = db.prepare('SELECT * FROM transaksi ORDER BY id DESC LIMIT 1').get();

  /* ---------- Playwright: ukur halaman cetak ---------- */
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const cookieName = cookie.split('=')[0], cookieVal = cookie.slice(cookie.indexOf('=') + 1);
  await page.context().addCookies([{ name: cookieName, value: cookieVal, url: base }]);

  const measure = async (url) => {
    await page.goto(base + url, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    const m = await page.evaluate(() => {
      const pick = sel => document.querySelector(sel);
      const box = sel => { const el = pick(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, scroll: el.scrollHeight, client: el.clientHeight }; };
      const cs = sel => { const el = pick(sel); return el ? getComputedStyle(el) : null; };
      return {
        box: box('.kwit-box'), wrap: box('.kwit-wrap'), iuran: box('.kwit-iuran'),
        kop: box('.kwit-kop'), space: box('.sign-grid .space'),
        kFont: cs('.kwit-body .k') ? cs('.kwit-body .k').fontSize : null,
        kPad: cs('.kwit-body .k') ? cs('.kwit-body .k').paddingTop : null,
        lineH: cs('.kwit-body .k') ? cs('.kwit-body .k').lineHeight : null,
        kopNama: cs('.kwit-kop .kwit-kop-nama') ? cs('.kwit-kop .kwit-kop-nama').fontSize : null,
        iuranScroll: (() => { const el = pick('.kwit-iuran'); return el ? { scroll: el.scrollHeight, client: el.clientHeight } : null; })(),
        dense: (() => { const el = pick('.kwit-iuran'); return el ? el.classList.contains('dense') : null; })(),
        // pastikan elemen terakhir (footer / tanda tangan) masih di dalam kotak yang tercetak
        tail: (() => {
          const host = pick('.kwit-wrap') || pick('.kwit-iuran');
          const last = pick('.kwit-foot') || pick('.ki-sign') || pick('.sign-grid');
          if (!host || !last) return null;
          const hb = host.getBoundingClientRect(), lb = last.getBoundingClientRect();
          return { gap: +(hb.bottom - lb.bottom).toFixed(1), lastH: +lb.height.toFixed(1) };
        })()
      };
    });
    // PDF harus dibuat SAAT media print aktif — kalau tidak, .doc-actions ikut tercetak
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    await page.emulateMedia({ media: 'screen' });
    return { ...m, pages: pdfPages(pdf), pdf };
  };

  /* ===== 1. kwitansi transaksi ===== */
  const k1 = await measure(`/transaksi/${trx.id}/kwitansi?orient=small`);
  ok('kwitansi transaksi: tepat 1 halaman', k1.pages === 1, `${k1.pages} halaman`);
  ok('kwitansi transaksi: kop ringkas tampil', !!k1.kop && k1.kop.h > 20 && k1.kop.h < 60, JSON.stringify(k1.kop));
  ok('kwitansi transaksi: logo/kop ≤ 35px', (await page.evaluate(() => {
    const el = document.querySelector('.kwit-kop img, .kwit-kop-ph');
    return el ? Math.round(el.getBoundingClientRect().height) : 0;
  })) <= 36);
  ok('kwitansi transaksi: font isi ≤ 10pt', parseFloat(k1.kFont) <= 13.4, k1.kFont);
  ok('kwitansi transaksi: padding sel rapat (≤4px)', parseFloat(k1.kPad) <= 4, k1.kPad);
  ok('kwitansi transaksi: area TTD ±30-35px', Math.abs(k1.space.h - 32) <= 4, JSON.stringify(k1.space));
  ok('kwitansi transaksi: isi muat di area cetak', k1.wrap.h <= 344, `tinggi ${k1.wrap.h}px (maks 91mm ≈ 344px)`);
  ok('kwitansi transaksi: footer & TTD tidak terpotong', k1.tail && k1.tail.gap >= -0.5, JSON.stringify(k1.tail));

  /* ===== 1a. default PORTRAIT A4 + toggle orientasi ===== */
  const kp1 = await measure(`/transaksi/${trx.id}/kwitansi`);
  const htmlK1 = await req('GET', `/transaksi/${trx.id}/kwitansi`);
  ok('kwitansi transaksi: default PORTRAIT (A4)', /size:A4 portrait/.test(htmlK1.text), 'page rule');
  ok('kwitansi transaksi: toggle portrait & landscape tersedia', /orient=portrait/.test(htmlK1.text) && /orient=landscape/.test(htmlK1.text));
  ok('kwitansi transaksi: default 1 halaman', kp1.pages === 1, `${kp1.pages} halaman`);
  ok('kwitansi transaksi: label terima pemasukan', /Telah diterima dari/.test(htmlK1.text));
  ok('kwitansi transaksi: TTD sejajar (kwit-sign)', /kwit-sign/.test(htmlK1.text) && /sig-head/.test(htmlK1.text));
  const htmlK1L = await req('GET', `/transaksi/${trx.id}/kwitansi?orient=landscape`);
  ok('kwitansi transaksi: landscape saat dipilih', /size:A4 landscape/.test(htmlK1L.text));

  /* ===== 1b. bukti piutang (komponen kwitansi yang sama) ===== */
  r = await req('POST', '/piutang/save', {
    nama_pegawai: 'Pegawai Uji Cetak', tanggal_utang: today, nominal: '1250000',
    keterangan: 'Uji cetak bukti piutang', back: '/piutang'
  });
  ok('piutang uji disimpan', r.status === 303, r.loc);
  const piu = db.prepare("SELECT * FROM piutang WHERE nama_pegawai='Pegawai Uji Cetak'").get();
  if (piu) {
    const kp = await measure(`/piutang/${piu.id}/bukti`);
    ok('bukti piutang: tepat 1 halaman', kp.pages === 1, `${kp.pages} halaman`);
    ok('bukti piutang: footer tidak terpotong', kp.tail && kp.tail.gap >= -0.5, JSON.stringify(kp.tail));
  } else {
    ok('bukti piutang: tepat 1 halaman', false, 'data piutang tidak tersimpan');
  }

  /* ===== 2. kwitansi iuran (1 pembayaran) ===== */
  const k2 = await measure(`/iuran/kwitansi?ids=${bayarIds[0]}&orient=small`);
  ok('kwitansi iuran: tepat 1 halaman', k2.pages === 1, `${k2.pages} halaman`);
  ok('kwitansi iuran: tidak terpotong', k2.iuranScroll && k2.iuranScroll.scroll <= k2.iuranScroll.client + 1, JSON.stringify(k2.iuranScroll));
  ok('kwitansi iuran: tinggi area cetak 87mm', k2.iuran && Math.abs(k2.iuran.h - 326) <= 5, JSON.stringify(k2.iuran));
  ok('kwitansi iuran: TTD pencatat tidak terpotong', k2.tail && k2.tail.gap >= -0.5, JSON.stringify(k2.tail));

  /* ===== 3. kwitansi iuran PADAT: 7 item dalam satu kwitansi (mode rapat) ===== */
  const items = [12, 1, 2, 3, 4, 5, 6];
  const body = { back: `/iuran/data/${siswa.id}`, n: String(items.length) };
  items.forEach((b, i) => {
    body['key_' + i] = `m:${tagihan.id}:${b}`;
    body['tanggal_' + i] = today;
    body['metode_' + i] = 'tunai';
    body['jumlah_' + i] = '150000';
    body['potongan_' + i] = '0';
    body['nonbku_' + i] = '1';
  });
  r = await req('POST', '/iuran/bayar-item', body);
  ok('bayar 7 item satu kwitansi', r.status === 303 && /kwitansi\?rows=/.test(r.loc), r.loc);
  const padat = db.prepare('SELECT kwitansi_no, COUNT(*) n FROM iuran_bayar GROUP BY kwitansi_no ORDER BY MAX(id) DESC LIMIT 1').get();
  ok('kwitansi padat berisi 7 item', Number(padat.n) === 7, JSON.stringify(padat));
  const k3 = await measure(`/iuran/kwitansi?no=${encodeURIComponent(padat.kwitansi_no)}&orient=small`);
  ok('kwitansi iuran 7 item: tepat 1 halaman', k3.pages === 1, `${k3.pages} halaman`);
  ok('kwitansi iuran 7 item: tidak terpotong', k3.iuranScroll && k3.iuranScroll.scroll <= k3.iuranScroll.client + 1, JSON.stringify(k3.iuranScroll));
  ok('kwitansi iuran 7 item: mode rapat aktif', k3.dense === true, String(k3.dense));

  /* ===== 4. dua kwitansi sekaligus ===== */
  const k4 = await measure(`/iuran/kwitansi?ids=${bayarIds[0]},${bayarIds[1]}&orient=small`);
  ok('dua kwitansi: 2 halaman (1 per kwitansi)', k4.pages === 2, `${k4.pages} halaman`);

  await page.close();
  await browser.close();

  const pass = results.filter(x => x.ok).length;
  console.log(`\n=== ${pass}/${results.length} cek cetak kwitansi lulus ===`);
  db.close(); srv.kill();
  if (pass !== results.length) { console.log('LOG SERVER:\n' + log.slice(-1500)); process.exit(1); }
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
