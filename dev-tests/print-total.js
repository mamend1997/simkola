'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* Test cetak laporan multi halaman:
   1. Baris JUMLAH / TOTAL pada laporan panjang hanya tercetak SEKALI, di halaman terakhir
   2. Baris total TIDAK ikut tercetak di setiap halaman (bug <tfoot> yang diulang)
   3. Judul kolom (<thead>) TETAP berulang di setiap halaman
   4. Berlaku untuk halaman cetak (/cetak/*) maupun halaman layar yang dicetak langsung (/bku/:id)
   Jalankan: node dev-tests/print-total.js
*/
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');
const { chromium } = require('playwright');

const PORT = Number(process.env.PTT_PORT || 3696);
const DB = process.env.PTT_DB || path.join(os.tmpdir(), 'smk-print-total-' + Date.now() + '.sqlite');
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

/* pdftotext dipakai untuk membaca teks PDF per halaman (dipisah form feed). */
const HAS_PDFTOTEXT = spawnSync('pdftotext', ['-v'], { encoding: 'utf8' }).status !== null;
let tmpSeq = 0;
function pdfPageTexts(buf) {
  if (!HAS_PDFTOTEXT) return null;
  const f = path.join(os.tmpdir(), `ptt-${process.pid}-${tmpSeq++}.pdf`);
  fs.writeFileSync(f, buf);
  const r = spawnSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8', maxBuffer: 40 * 1024 * 1024 });
  try { fs.unlinkSync(f); } catch (e) { }
  if (r.status !== 0 || !r.stdout) return null;
  return r.stdout.split('\f').filter(p => p.trim() !== '');
}
/* jumlah kemunculan pola per halaman */
const countPer = (pages, re) => pages.map(p => (p.match(re) || []).length);
const pagesWith = (pages, re) => pages.map((p, i) => (re.test(p) ? i : -1)).filter(i => i >= 0);

(async () => {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(120); }
  let r = await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login admin', r.status === 303);

  const db = new Database(DB);
  const ta = db.prepare('SELECT * FROM tahun_ajaran ORDER BY id LIMIT 1').get();
  const bku = db.prepare('SELECT * FROM bku WHERE COALESCE(auto_mode,0)=0 ORDER BY id LIMIT 1').get();
  ok('BKU dana tersedia', !!bku);
  const today = new Date().toISOString().slice(0, 10);

  /* ---------- data uji: 240 transaksi agar laporan pasti lebih dari 3 halaman ---------- */
  const N = 240;
  db.transaction(() => {
    const ins = db.prepare(`INSERT INTO transaksi (bku_id,tanggal,jenis,metode,no_bukti,coa_id,nominal,uraian,status,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,'posted',1,?)`);
    const coaIn = db.prepare("SELECT id FROM coa WHERE kategori='pendapatan' ORDER BY kode LIMIT 1").get();
    const coaOut = db.prepare("SELECT id FROM coa WHERE kategori='pengeluaran' ORDER BY kode LIMIT 1").get();
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    for (let i = 1; i <= N; i++) {
      const jenis = i % 3 === 0 ? 'pengeluaran' : 'pemasukan';
      ins.run(bku.id, today, jenis, i % 2 ? 'tunai' : 'transfer', `PTT/${i}`,
        jenis === 'pemasukan' ? (coaIn ? coaIn.id : null) : (coaOut ? coaOut.id : null),
        jenis === 'pemasukan' ? 25000 : 15000,
        `UJI CETAK ${String(i).padStart(3, '0')} pengujian baris total multi halaman`, stamp);
    }
  })();
  ok('240 transaksi uji tersimpan', db.prepare('SELECT COUNT(*) c FROM transaksi').get().c >= N);

  /* ---------- Playwright: cetak tiap laporan ke PDF, baca teks per halaman ---------- */
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const cookieName = cookie.split('=')[0], cookieVal = cookie.slice(cookie.indexOf('=') + 1);
  await page.context().addCookies([{ name: cookieName, value: cookieVal, url: base }]);

  async function render(url) {
    await page.goto(base + url, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });            // PDF harus dibuat saat media print aktif
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, format: undefined });
    await page.emulateMedia({ media: 'screen' });
    return { pdf, pages: pdfPages(pdf), texts: pdfPageTexts(pdf) };
  }

  /* Cek inti: baris total hanya di halaman terakhir, header tetap berulang. */
  function checkTotal(name, out, totalRe, headerRe, dataRe) {
    ok(`${name}: lebih dari 2 halaman`, out.pages >= 3, `${out.pages} halaman`);
    if (!out.texts) { results.push({ name: `${name}: teks PDF (pdftotext tidak tersedia)`, ok: false, extra: 'pdftotext tidak ada' }); return; }
    const totalRe2 = new RegExp(totalRe.source, 'g');
    const withTotal = pagesWith(out.texts, totalRe2);
    ok(`${name}: baris total tidak berulang (hanya 1 halaman)`, withTotal.length === 1, `halaman: ${JSON.stringify(withTotal)} dari ${out.texts.length}`);
    ok(`${name}: baris total ada di halaman TERAKHIR`, withTotal.length === 1 && withTotal[0] === out.texts.length - 1, `total di ${JSON.stringify(withTotal)} / terakhir ${out.texts.length - 1}`);
    ok(`${name}: baris total tidak tercetak di halaman pertama`, !withTotal.includes(0), JSON.stringify(withTotal));
    if (headerRe) {
      /* header wajib berulang di setiap halaman yang memuat baris data
         (halaman terakhir boleh hanya berisi baris total bila baris data terakhir tepat di batas halaman) */
      const dataPages = dataRe ? pagesWith(out.texts, dataRe) : out.texts.map((_, i) => i);
      const headPages = pagesWith(out.texts, headerRe);
      const missing = dataPages.filter(i => !headPages.includes(i));
      ok(`${name}: judul kolom berulang di setiap halaman berisi data`, dataPages.length > 2 && missing.length === 0,
        `${headPages.length}/${out.texts.length} halaman ber-header; tanpa header: ${JSON.stringify(missing)}`);
    }
    if (dataRe) {
      /* baris total harus berada SETELAH baris data terakhir (halaman & posisi) */
      const dRe = new RegExp(dataRe.source, 'g');
      let lastData = null, totalAt = null;
      out.texts.forEach((p, pi) => {
        for (const m of p.matchAll(dRe)) lastData = { pi, i: m.index };
        const t = new RegExp(totalRe.source).exec(p);
        if (t) totalAt = { pi, i: t.index };
      });
      ok(`${name}: baris total berada di bawah baris data terakhir`,
        !!(lastData && totalAt) && (totalAt.pi > lastData.pi || (totalAt.pi === lastData.pi && totalAt.i > lastData.i)),
        `data terakhir ${JSON.stringify(lastData)} · total ${JSON.stringify(totalAt)}`);
    }
  }

  /* ===== 1. Laporan Buku Kas Umum — SEMUA BKU (kasus pada keluhan) ===== */
  const b1 = await render('/cetak/bku?bku=all');
  checkTotal('cetak BKU semua buku', b1, /JUMLAH/, /PENERIMAAN/, /UJI CETAK/);
  if (b1.texts) {
    ok('cetak BKU: seluruh 240 transaksi tercetak', new Set(Array.from((b1.texts.join('\n')).matchAll(/UJI CETAK (\d{3})/g), m => m[1])).size === N,
      `${new Set(Array.from((b1.texts.join('\n')).matchAll(/UJI CETAK (\d{3})/g), m => m[1])).size} transaksi`);
  }

  /* ===== 2. Laporan Buku Pembantu (tunai) ===== */
  const b2 = await render('/cetak/pembantu?p=tunai');
  checkTotal('cetak buku pembantu tunai', b2, /JUMLAH/, /MASUK/, /UJI CETAK/);

  /* ===== 3. Halaman layar Detail BKU yang dicetak langsung ===== */
  const b3 = await render(`/bku/${bku.id}`);
  checkTotal('cetak halaman layar Detail BKU', b3, /JUMLAH/, /saldo berjalan/i, /UJI CETAK/);

  /* ===== 4. Laporan piutang: 2 tabel, masing-masing punya baris total ===== */
  db.transaction(() => {
    const ins = db.prepare(`INSERT INTO piutang (nama_pegawai,tanggal_utang,nominal,keterangan,status,tahun_ajaran_id,created_at)
      VALUES (?,?,?,?,'belum',?,?)`);
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    for (let i = 1; i <= 150; i++) ins.run(`PEGAWAI UJI ${String(i).padStart(3, '0')}`, today, 125000, 'uji cetak piutang', ta.id, stamp);
  })();
  const b4 = await render('/cetak/piutang');
  if (process.env.PTT_DEBUG && b4.texts) console.log(b4.texts.map((t, i) => `\n=== HAL ${i + 1} ===\n` + t).join('\n'));
  ok('cetak piutang: lebih dari 2 halaman', b4.pages >= 3, `${b4.pages} halaman`);
  if (b4.texts) {
    /* nilai total tabel A (150 × 125.000 = 18.750.000) hanya boleh muncul SEKALI di seluruh PDF */
    const withGrand = pagesWith(b4.texts, /18\.750\.000/g);
    ok('cetak piutang: total piutang tidak berulang', withGrand.length === 1, `halaman: ${JSON.stringify(withGrand)} dari ${b4.texts.length}`);
    /* tabel A diikuti tabel B (rekap SPP) pada halaman yang sama/berikutnya → total tabel A
       harus berada SETELAH baris data terakhir tabel A, bukan di akhir seluruh dokumen */
    let lastData = null, totalAt = null;
    b4.texts.forEach((p, pi) => {
      for (const m of p.matchAll(/PEGAWAI UJI \d{3}/g)) lastData = { pi, i: m.index };
      const t = /18\.750\.000/.exec(p); if (t) totalAt = { pi, i: t.index };
    });
    ok('cetak piutang: total berada tepat di bawah baris data terakhir tabelnya',
      !!(lastData && totalAt) && (totalAt.pi > lastData.pi || (totalAt.pi === lastData.pi && totalAt.i > lastData.i)),
      `data terakhir ${JSON.stringify(lastData)} · total ${JSON.stringify(totalAt)}`);
    const dataPages = pagesWith(b4.texts, /PEGAWAI UJI/g);
    ok('cetak piutang: seluruh 150 baris tercetak', new Set(Array.from(b4.texts.join('\n').matchAll(/PEGAWAI UJI (\d{3})/g), m => m[1])).size === 150,
      `${new Set(Array.from(b4.texts.join('\n').matchAll(/PEGAWAI UJI (\d{3})/g), m => m[1])).size} baris`);
    const headPages = pagesWith(b4.texts, /DICICIL|SISA PIUTANG/i);
    ok('cetak piutang: judul kolom berulang di setiap halaman berisi data',
      dataPages.length > 2 && dataPages.every(i => headPages.includes(i)), `data: ${JSON.stringify(dataPages)} header: ${JSON.stringify(headPages)}`);
  }

  /* ===== 5. Gaya CSS: tfoot bukan footer grup saat cetak ===== */
  await page.goto(base + '/cetak/bku?bku=all', { waitUntil: 'load' });
  await page.emulateMedia({ media: 'print' });
  const disp = await page.evaluate(() => {
    const tf = document.querySelector('table.doc-tbl > tfoot');
    const th = document.querySelector('table.doc-tbl > thead');
    return {
      tfoot: tf ? getComputedStyle(tf).display : null,
      thead: th ? getComputedStyle(th).display : null,
      rowAvoid: tf ? getComputedStyle(tf.querySelector('tr')).breakInside : null
    };
  });
  ok('cetak: tfoot bukan display:table-footer-group', disp.tfoot === 'table-row-group', String(disp.tfoot));
  ok('cetak: thead tetap display:table-header-group', disp.thead === 'table-header-group', String(disp.thead));
  ok('cetak: baris total page-break-inside:avoid', disp.rowAvoid === 'avoid', String(disp.rowAvoid));
  await page.emulateMedia({ media: 'screen' });
  const dispScreen = await page.evaluate(() => {
    const tf = document.querySelector('table.doc-tbl > tfoot');
    return tf ? getComputedStyle(tf).display : null;
  });
  ok('layar: tfoot tetap footer grup (sticky footer tidak berubah)', dispScreen === 'table-footer-group', String(dispScreen));

  /* ===== 6. Tabel layar bergulir dengan footer sticky tetap berfungsi ===== */
  await page.goto(base + `/bku/${bku.id}`, { waitUntil: 'load' });
  const screenFoot = await page.evaluate(() => {
    const tf = document.querySelector('.table-scroll table tfoot');
    if (!tf) return null;
    const td = tf.querySelector('td');
    return { display: getComputedStyle(tf).display, pos: td ? getComputedStyle(td).position : null };
  });
  ok('layar: footer tabel bergulir tetap sticky', screenFoot && screenFoot.display === 'table-footer-group' && screenFoot.pos === 'sticky', JSON.stringify(screenFoot));
  /* saat dicetak, footer itu ikut direset agar tidak berulang */
  await page.emulateMedia({ media: 'print' });
  const printFoot = await page.evaluate(() => {
    const tf = document.querySelector('.table-scroll table tfoot');
    if (!tf) return null;
    const td = tf.querySelector('td');
    return { display: getComputedStyle(tf).display, pos: td ? getComputedStyle(td).position : null };
  });
  ok('cetak: footer tabel bergulir bukan grup berulang & tidak sticky',
    printFoot && printFoot.display === 'table-row-group' && printFoot.pos === 'static', JSON.stringify(printFoot));
  await page.emulateMedia({ media: 'screen' });

  await browser.close();
  srv.kill();

  const bad = results.filter(x => !x.ok);
  console.log(`\n${results.length - bad.length}/${results.length} cek lulus`);
  if (bad.length) { console.log('GAGAL:'); bad.forEach(x => console.log(' -', x.name, x.extra)); }
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); try { srv.kill(); } catch (x) { } process.exit(1); });
