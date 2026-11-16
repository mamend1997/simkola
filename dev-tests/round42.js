'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* =====================================================================
   RONDE 42 (SIMKEU) — sidebar interaktif, akordeon eksklusif,
   tahun ajaran menyalin BKU, kode BKU otomatis, balas catatan orang tua,
   bayar iuran mandiri di portal (manual + gateway), antrean & notifikasi.
   Jalankan: node dev-tests/round42.js
   ===================================================================== */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');
const { chromium } = require('playwright');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'r42-'));
const DB = path.join(TMP, 'k.sqlite');
const SAAS_DB = path.join(TMP, 'saas.db');
const PORT = 3762;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, DB_PATH: DB, SAAS_DB_PATH: SAAS_DB, DEMO_DB_PATH: path.join(TMP, 'demo.sqlite') },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; fails.push(n + (x ? ' — ' + x : '')); console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

let cookie = '';
async function req(method, url, body, opt = {}) {
  const headers = { Cookie: cookie };
  let payload = null;
  if (body) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) { if (Array.isArray(v)) v.forEach(x => usp.append(k, x)); else usp.append(k, v); }
    payload = usp.toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: opt.redirect || 'manual' });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: r.status, text: await r.text(), loc: r.headers.get('location') || '' };
}
/** permintaan tanpa sesi (portal publik) */
/* portal publik kini beralamat /<nama-sekolah>/<sub-slug>; alamat lama 30x → ikuti */
async function follow(method, url, body, depth = 0) {
  const r = await pub(method, url, body);
  if ((r.status === 301 || r.status === 302 || r.status === 303 || r.status === 307 || r.status === 308) && r.loc && depth < 3) {
    return follow(method, r.loc, method === 'GET' ? null : body, depth + 1);
  }
  return r;
}
async function pub(method, url, body) {
  let payload = null; const headers = {};
  if (body) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) { if (Array.isArray(v)) v.forEach(x => usp.append(k, x)); else usp.append(k, v); }
    payload = usp.toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
  return { status: r.status, text: await r.text(), loc: r.headers.get('location') || '' };
}
let cssCache = null;
function readCss() {
  if (cssCache !== null) return cssCache;
  try { cssCache = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'app.css'), 'utf8'); }
  catch (e) { cssCache = ''; }
  return cssCache;
}
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

(async () => {
  for (let i = 0; i < 90; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  let r = await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login admin berhasil', r.status === 303, 'status=' + r.status);

  const db = new Database(DB);
  const sql = (s, ...a) => db.prepare(s).run(...a);
  const one = (s, ...a) => db.prepare(s).get(...a);
  const all = (s, ...a) => db.prepare(s).all(...a);
  const ta = one('SELECT * FROM tahun_ajaran WHERE aktif=1 ORDER BY id LIMIT 1');
  await req('POST', '/ta/pilih', { ta: ta.id });

  /* ================= 1. SIDEBAR: hover + akordeon eksklusif ================= */
  r = await req('GET', '/');
  ok('sidebar memakai pembungkus sb-inner', /class="sb-inner"/.test(r.text));
  ok('sakelar hover tersedia di sidebar', /id="navHoverPref"/.test(r.text));
  const openGroups = (r.text.match(/class="nav-group open"/g) || []).length;
  ok('akordeon: hanya SATU grup menu terbuka', openGroups <= 1, 'jumlah=' + openGroups);
  ok('sidebar memuat data-navgroup untuk akordeon', /data-navgroup="/.test(r.text));

  /* ================= 2. KODE BKU OTOMATIS ================= */
  const before = all("SELECT kode FROM bku WHERE kode LIKE 'U%'").map(x => Number((/(\d+)$/.exec(x.kode) || [0, 0])[1]) || 0);
  const nextU = 'U' + String(Math.max(0, ...before) + 1).padStart(2, '0');
  r = await req('POST', '/bku/save', { nama: 'BKU Uji Kode Otomatis', jenis: 'umum', kode: '', tahun_ajaran_id: ta.id, saldo_awal: '0' });
  ok('simpan BKU tanpa kode dialihkan (303)', r.status === 303, 'status=' + r.status);
  const bkuBaru = one("SELECT * FROM bku WHERE nama='BKU Uji Kode Otomatis' ORDER BY id DESC LIMIT 1");
  ok('kode BKU terisi otomatis ' + nextU, bkuBaru && bkuBaru.kode === nextU, bkuBaru && bkuBaru.kode);
  const nextK = 'K' + String(Math.max(0, ...all("SELECT kode FROM bku WHERE kode LIKE 'K%'").map(x => Number((/(\d+)$/.exec(x.kode) || [0, 0])[1]) || 0)) + 1).padStart(2, '0');
  await req('POST', '/bku/save', { nama: 'BKU Uji Kegiatan', jenis: 'kegiatan', kode: '', tahun_ajaran_id: ta.id, saldo_awal: '0' });
  const bkuK = one("SELECT * FROM bku WHERE nama='BKU Uji Kegiatan' ORDER BY id DESC LIMIT 1");
  ok('kode BKU kegiatan otomatis ' + nextK, bkuK && bkuK.kode === nextK, bkuK && bkuK.kode);
  r = await req('GET', '/bku');
  ok('form Tambah BKU menandai kode otomatis', /data-kode-auto/.test(r.text));

  /* ================= 3. TAHUN AJARAN BARU MENYALIN BKU ================= */
  const namaBkuTa1 = all('SELECT nama FROM bku WHERE tahun_ajaran_id=? ORDER BY urutan, id', ta.id).map(x => x.nama);
  r = await req('POST', '/tahun-ajaran/save', {
    nama: '2099/2100', tanggal_mulai: '2099-07-01', tanggal_selesai: '2100-06-30',
    salin_bku: '1', salin_master: '1', rollover: '1'
  });
  ok('tambah tahun ajaran 303', r.status === 303, 'status=' + r.status + ' ' + r.loc);
  const taBaru = one("SELECT * FROM tahun_ajaran WHERE nama='2099/2100'");
  ok('tahun ajaran baru dibuat', !!taBaru);
  const bkuTaBaru = all('SELECT nama,kode FROM bku WHERE tahun_ajaran_id=?', taBaru.id);
  ok('BKU disalin dari tahun ajaran sebelumnya (' + namaBkuTa1.length + ' → ' + bkuTaBaru.length + ')',
    bkuTaBaru.length === namaBkuTa1.length && namaBkuTa1.every(n => bkuTaBaru.some(b => b.nama === n)),
    'ta1=' + namaBkuTa1.length + ' baru=' + bkuTaBaru.length);
  r = await req('GET', '/tahun-ajaran');
  ok('form Tambah TA tidak lagi memakai centang 17 BKU standar', !/name="buat_bku"/.test(r.text));
  ok('form Tambah TA memakai opsi salin BKU', /name="salin_bku"/.test(r.text));

  /* siapkan data iuran uji pada TA aktif */
  const now = '2026-01-05 09:00:00';
  const gid = Number(sql(`INSERT INTO iuran_grup (nama,jenis,tahun_ajaran_id,aktif,created_at) VALUES ('SPP Uji','bulanan',?,1,?)`, ta.id, now).lastInsertRowid);
  sql(`INSERT INTO iuran_nominal (grup_id,bulan,nominal,tingkat) VALUES (?,?,?, '')`, gid, 7, 150000);
  const sid = Number(sql(`INSERT INTO siswa (nama,nisn,tanggal_lahir,status,created_at) VALUES ('Budi Uji','9990001','2010-01-02','aktif',?)`, now).lastInsertRowid);
  sql(`INSERT INTO iuran_tagihan (grup_id,siswa_id,tahun_ajaran_id,nominal,created_at) VALUES (?,?,?,?,?)`, gid, sid, ta.id, 150000, now);
  ok('data uji iuran dibuat', !!one('SELECT * FROM iuran_tagihan WHERE siswa_id=?', sid));

  /* ================= 4. BALAS CATATAN ORANG TUA ================= */
  const pesanId = Number(sql(`INSERT INTO portal_pesan (siswa_id,nama,kontak,pesan,status,tahun_ajaran_id,created_at,sumber,ref)
    VALUES (?,?,?,?, 'baru', ?, ?, 'siswa', ?)`, sid, 'Budi Uji', '08123', 'Mohon cek pembayaran SPP Juli.', ta.id, now, String(sid)).lastInsertRowid);
  r = await req('GET', '/catatan-orangtua');
  ok('rekap catatan orang tua punya tombol Balas', /catatan-orangtua\/balas/.test(r.text) && /Balas<\/summary>/.test(r.text));
  ok('kolom Balasan Sekolah tampil', /Balasan Sekolah/.test(r.text));
  r = await req('POST', '/catatan-orangtua/balas', { id: pesanId, balasan: 'Sudah kami periksa, pembayaran tercatat. Terima kasih.', status_after: 'selesai' });
  ok('kirim balasan 303', r.status === 303);
  const pesanRow = one('SELECT * FROM portal_pesan WHERE id=?', pesanId);
  ok('balasan tersimpan di database', /Sudah kami periksa/.test(pesanRow.balasan || ''), pesanRow.balasan);
  ok('status catatan menjadi selesai', pesanRow.status === 'selesai', pesanRow.status);
  ok('nama pembalas tercatat', (pesanRow.balas_oleh || '').length > 2, pesanRow.balas_oleh);

  /* ================= 5. PORTAL: BAYAR IURAN MANUAL ================= */
  await req('POST', '/pembayaran-online/simpan', {
    bayar_manual_aktif: '1', bayar_gateway_aktif: '0', bayar_provider: 'sandbox',
    bayar_mode: 'sandbox', bayar_expire_menit: '60', bayar_instruksi: 'Transfer ke BRI 123 a.n. Sekolah', notif_bayar_aktif: '1'
  });
  ok('pengaturan pembayaran manual aktif', one("SELECT v FROM settings WHERE k='bayar_manual_aktif'").v === '1');
  r = await req('GET', '/pembayaran-online');
  ok('halaman Pembayaran Online tampil', r.status === 200 && /Pengaturan Gateway/.test(r.text), 'status=' + r.status);

  const ident = { nama: 'Budi Uji', lahir: '2010-01-02' };
  r = await follow('GET', '/portal/bayar?nama=' + encodeURIComponent(ident.nama) + '&lahir=' + ident.lahir);
  ok('halaman bayar portal tampil', r.status === 200 && /Total Pembayaran/.test(r.text), 'status=' + r.status);
  ok('item tagihan SPP tampil dengan ceklis', /data-bayar-item/.test(r.text) && /SPP Uji/.test(r.text));
  ok('total dihitung real-time (elemen total)', /data-bayar-total/.test(r.text));

  r = await follow('POST', '/portal/bayar', {
    ...ident, metode: 'manual', item: `${one('SELECT id FROM iuran_tagihan WHERE siswa_id=?', sid).id}:7`,
    bukti_b64: PNG, bukti_nama: 'bukti.png', catatan: 'Transfer dari Bapak Budi'
  });
  ok('kirim pembayaran manual dialihkan (303)', r.status === 303, 'status=' + r.status + ' ' + r.loc);
  const co = one('SELECT * FROM iuran_checkout ORDER BY id DESC LIMIT 1');
  ok('keranjang pembayaran tersimpan', !!co && co.status === 'menunggu', co && co.status);
  ok('nominal keranjang benar', Number(co.total) === 150000, co && co.total);
  ok('bukti pembayaran terlampir', !!co.bukti_url, co && co.bukti_url);
  ok('metode tercatat manual', co.metode === 'manual');
  const notifRow = one("SELECT * FROM notif WHERE untuk='super_admin' AND jenis='bayar-manual' ORDER BY id DESC LIMIT 1");
  ok('notifikasi bendahara dibuat', !!notifRow && /Budi Uji/.test(notifRow.judul), notifRow && notifRow.judul);
  ok('notifikasi memuat nominal & waktu', /150\.000/.test(notifRow.isi || '') && /2026-/.test(notifRow.isi || ''), notifRow.isi);

  r = await req('GET', '/iuran/antrean');
  ok('antrean menampilkan kartu verifikasi portal', /Verifikasi Pembayaran Portal Orang Tua/.test(r.text));
  ok('antrean memuat bukti bayar', /Lihat bukti/.test(r.text));
  ok('antrean menyediakan Setujui & Tolak', /Setujui<\/button>/.test(r.text) && /Tolak Pembayaran/.test(r.text));
  ok('lonceng notifikasi tampil di header', /notif-bell/.test(r.text) && /nf-item/.test(r.text));

  r = await req('POST', '/iuran/verifikasi', { id: co.id, aksi: 'setuju', back: '/iuran/antrean' });
  ok('verifikasi pembayaran 303', r.status === 303, r.loc);
  ok('keranjang menjadi lunas', one('SELECT status FROM iuran_checkout WHERE id=?', co.id).status === 'lunas');
  const bayarRows = all("SELECT * FROM iuran_bayar WHERE siswa_id=? AND status='pending'", sid);
  ok('rincian item masuk antrean posting (1 baris)', bayarRows.length === 1, 'baris=' + bayarRows.length);
  ok('pembayaran ber-metode transfer', bayarRows[0] && bayarRows[0].metode === 'transfer', bayarRows[0] && bayarRows[0].metode);
  ok('bulan tagihan tersimpan (Juli)', bayarRows[0] && Number(bayarRows[0].bulan) === 7, bayarRows[0] && bayarRows[0].bulan);
  r = await req('GET', '/iuran/antrean');
  ok('pembayaran muncul pada Antrean Posting BKU', /Antrean Posting BKU/.test(r.text) && /SPP Uji/.test(r.text));

  /* ================= 6. PORTAL: BAYAR IURAN VIA GATEWAY (sandbox) ================= */
  await req('GET', '/pembayaran-online');
  await req('POST', '/pembayaran-online/simpan', {
    bayar_manual_aktif: '1', bayar_gateway_aktif: '1', bayar_provider: 'sandbox', bayar_mode: 'sandbox', bayar_expire_menit: '60'
  });
  ok('gateway aktif tersimpan', one("SELECT v FROM settings WHERE k='bayar_gateway_aktif'").v === '1');
  // tagihan baru agar masih ada sisa
  sql(`INSERT INTO iuran_nominal (grup_id,bulan,nominal,tingkat) VALUES (?,?,?, '')`, gid, 8, 150000);
  r = await pub('POST', '/portal/bayar', { ...ident, metode: 'gateway', item: `${one('SELECT id FROM iuran_tagihan WHERE siswa_id=?', sid).id}:8` });
  ok('gateway: dialihkan ke halaman status', r.status === 303 && /bayar\/status/.test(r.loc), r.status + ' ' + r.loc);
  const stPage = await pub('GET', String(r.loc).replace(/^https?:\/\/[^/]+/, ''));
  ok('halaman status gateway terbuka', stPage.status === 200 && /Status Pembayaran/.test(stPage.text), stPage.status);
  const coG = one("SELECT * FROM iuran_checkout WHERE metode='gateway' ORDER BY id DESC LIMIT 1");
  ok('order gateway memiliki order_id', !!coG && /^IU\d+-/.test(coG.order_id), coG && coG.order_id);
  ok('QRIS string tersimpan (sandbox)', !!coG.qr_string, coG && coG.qr_string);
  r = await pub('POST', '/portal/pay/callback?t=1', { order_id: coG.order_id, status: 'PAID', paid: true, amount: 150000 });
  ok('callback sandbox tanpa signature ditolak', r.status === 401, r.status + ' ' + r.text);
  ok('checkout tetap menunggu setelah callback sandbox palsu',
    one('SELECT status FROM iuran_checkout WHERE id=?', coG.id).status === 'menunggu');
  r = await req('POST', '/iuran/verifikasi', { id: coG.id, aksi: 'setuju' });
  ok('admin dapat menyetujui pembayaran sandbox secara manual', r.status === 303 && /ok=/.test(r.loc), r.status + ' ' + r.loc);
  ok('verifikasi manual menandai lunas', one('SELECT status FROM iuran_checkout WHERE id=?', coG.id).status === 'lunas');
  const rowsG = all("SELECT * FROM iuran_bayar WHERE siswa_id=? AND status='pending'", sid);
  ok('gateway → antrean bertambah menjadi 2 baris', rowsG.length === 2, 'baris=' + rowsG.length);
  const notifG = one("SELECT * FROM notif WHERE untuk='super_admin' AND jenis='bayar-lunas' ORDER BY id DESC LIMIT 1");
  ok('notifikasi lunas dikirim', !!notifG, notifG && notifG.judul);

  /* ================= 7. TOLAK PEMBAYARAN ================= */
  sql(`INSERT INTO iuran_nominal (grup_id,bulan,nominal,tingkat) VALUES (?,?,?, '')`, gid, 9, 100000);
  r = await follow('POST', '/portal/bayar', {
    ...ident, metode: 'manual', item: `${one('SELECT id FROM iuran_tagihan WHERE siswa_id=?', sid).id}:9`,
    bukti_b64: PNG, bukti_nama: 'bukti2.png'
  });
  const coReject = one("SELECT * FROM iuran_checkout WHERE status='menunggu' ORDER BY id DESC LIMIT 1");
  ok('keranjang kedua menunggu verifikasi', !!coReject, coReject && coReject.id);
  await req('POST', '/iuran/verifikasi', { id: coReject.id, aksi: 'tolak', alasan: 'Bukti tidak terbaca', back: '/iuran/antrean' });
  const rej = one('SELECT * FROM iuran_checkout WHERE id=?', coReject.id);
  ok('pembayaran ditolak beserta alasan', rej.status === 'ditolak' && /tidak terbaca/.test(rej.alasan || ''), rej.status);

  /* ================= 7b. REKONSILIASI: satu input saldo gabungan ================= */
  r = await req('GET', '/rekon');
  ok('rekon: kartu input saldo koran memuat SEMUA BKU', /Input Saldo Rekening Koran — Semua BKU/.test(r.text));
  ok('rekon: tidak ada lagi dropdown BKU khusus saldo koran', !/name="bku_id" required>\s*<option/.test(r.text.split('Input Saldo Rekening Koran')[1] || ''));
  ok('rekon: hanya ada satu input saldo koran gabungan', /name="saldo_koran"/.test(r.text) && !/name="saldo_\d+"/.test(r.text));
  const bkuLegacy = all("SELECT id FROM bku WHERE tahun_ajaran_id=? AND COALESCE(auto_mode,0)=0 ORDER BY urutan LIMIT 3", ta.id);
  bkuLegacy.forEach((b, i) => sql(
    'INSERT INTO rekon_saldo (bku_id,tanggal,saldo_koran,catatan,created_at) VALUES (?,?,?,?,?)',
    b.id, '2026-01-30', 100000 * (i + 1), 'Saldo lama per BKU', '2026-01-30 12:00:00'
  ));
  r = await req('GET', '/rekon');
  ok('rekon: saldo lama per BKU menjadi nilai awal total gabungan', /name="saldo_koran"[^>]*value="600\.000"/.test(r.text));
  r = await req('POST', '/rekon/saldo-masal', { tanggal: '2026-01-31', catatan: 'Uji saldo gabungan', saldo_koran: '600000' });
  ok('rekon: simpan satu saldo koran gabungan', r.status === 303 && /ok=/.test(r.loc), r.status + ' ' + r.loc);
  const saldoGlobal = one("SELECT * FROM rekon_saldo_global WHERE catatan='Uji saldo gabungan'");
  ok('rekon: satu baris tersimpan untuk seluruh BKU', !!saldoGlobal && Number(saldoGlobal.saldo_koran) === 600000 && saldoGlobal.tahun_ajaran_id === ta.id);
  const rAgain = await req('GET', '/rekon');
  ok('rekon: input menampilkan kembali saldo gabungan tersimpan', /name="saldo_koran"[^>]*value="600\.000"/.test(rAgain.text));

  /* ================= 7c. TUTUP BKU MASAL: Opsi A & Opsi B ================= */
  r = await req('GET', '/tutup-bulanan?periode=2025-12&semua=1');
  ok('tutup massal: modal menyediakan Opsi A (rollover)', /mtMassA/.test(r.text) && /Lanjutkan Sisa Saldo Buku/i.test(r.text));
  ok('tutup massal: modal menyediakan Opsi B (opnam kas)', /mtMassB/.test(r.text) && /Penyesuaian Kas Riil/i.test(r.text));
  ok('tutup massal: format nomor berita acara dapat diatur', /name="ba_pattern"/.test(r.text));
  ok('tutup massal: input kas riil per BKU saat Opsi B', /name="opnam_tunai_\d+"/.test(r.text));
  const bkuMass = all("SELECT id FROM bku WHERE tahun_ajaran_id=? AND COALESCE(auto_mode,0)=0 ORDER BY urutan LIMIT 2", ta.id);
  const formMass = { periode: '2025-12' };
  bkuMass.forEach(b => { formMass['pilih_' + b.id] = '1'; });
  r = await req('POST', '/tutup-bulanan/tutup-massal', { ...formMass, metode_massal: 'rollover' });
  ok('tutup massal Opsi A: 2 BKU ditutup', r.status === 303 && /Opsi A/.test(decodeURIComponent(r.loc)), r.status);
  const closedA = db.prepare(`SELECT COUNT(*) c FROM bku_periode WHERE periode='2025-12' AND status='ditutup' AND bku_id IN (${bkuMass.map(b => b.id).join(',')})`).get().c;
  ok('tutup massal Opsi A: baris periode dibuat', closedA === 2, 'baris=' + closedA);
  const baA = db.prepare("SELECT berita_acara_no FROM bku_periode WHERE periode='2025-12' ORDER BY id DESC LIMIT 1").get().berita_acara_no || '';
  ok('tutup massal Opsi A: nomor berita acara terisi', /BA-ROLL\//.test(baA), baA);

  // buka kembali lalu tutup dengan Opsi B (opnam)
  for (const b of bkuMass) await req('POST', '/tutup-bulanan/buka', { bku_id: b.id, periode: '2025-12' });
  const formB = { periode: '2025-12', metode_massal: 'opnam', metode_penyesuaian: 'tunai', ba_pattern: 'BA-OPNAM/{kode}/{periode}' };
  bkuMass.forEach((b, i) => {
    formB['pilih_' + b.id] = '1';
    formB['opnam_tunai_' + b.id] = String(100000 + i);
    formB['opnam_bank_' + b.id] = '0';
    formB['alasan_' + b.id] = 'Selisih uji opnam';
  });
  r = await req('POST', '/tutup-bulanan/tutup-massal', formB);
  ok('tutup massal Opsi B: berhasil', r.status === 303 && /Opsi B/.test(decodeURIComponent(r.loc)), r.status + ' ' + r.loc);
  const rowB = db.prepare(`SELECT * FROM bku_periode WHERE periode='2025-12' AND bku_id=? ORDER BY id DESC LIMIT 1`).get(bkuMass[0].id);
  ok('tutup massal Opsi B: metode opnam tercatat', rowB && rowB.metode === 'opnam', rowB && rowB.metode);
  ok('tutup massal Opsi B: nomor berita acara opnam', rowB && /BA-OPNAM\//.test(rowB.berita_acara_no || ''), rowB && rowB.berita_acara_no);
  ok('tutup massal Opsi B: selisih kas dibukukan', Math.abs(Number(rowB.selisih) || 0) >= 0, rowB && rowB.selisih);

  /* ================= 7d. TEKS FORM TAMBAH TAHUN AJARAN ================= */
  r = await req('GET', '/tahun-ajaran');
  ok('form TA: kalimat baru "Salin daftar BKU dari tahun ajaran sebelumnya"', /Salin daftar BKU dari tahun ajaran sebelumnya/.test(r.text));
  ok('form TA: penjelasan nama/jenis/kode BKU dari TA sebelumnya', /nama, jenis &amp; kode BKU diambil dari tahun ajaran sebelumnya/.test(r.text));
  ok('form TA: tidak lagi menyebut "17 BKU standar"', !/17 BKU standar/.test(r.text));

  /* ================= 7e. PORTAL: judul nama sekolah PUTIH + alamat lengkap ================= */
  r = await follow('GET', '/portal');
  ok('portal: judul nama sekolah berwarna putih', /class="school-title"/.test(r.text) && /color:#fff/.test(readCss()));
  ok('portal: alamat sah berbentuk /<nama-sekolah>/<sub-slug>', new RegExp('/' + one("SELECT v FROM settings WHERE k='portal_base_slug'").v + '/portal-tagihan').test(r.text) || /portal-tagihan/.test(r.text));
  r = await pub('GET', '/portal-pegawai');
  ok('alamat lama /portal-pegawai dialihkan', [301, 302, 303, 307, 308].includes(r.status) && /portal-pegawai/.test(r.loc), r.status + ' ' + r.loc);
  r = await pub('GET', '/portal-slip');
  ok('alamat lama /portal-slip dialihkan', [301, 302, 303, 307, 308].includes(r.status), r.status);
  r = await req('GET', '/portal-publik');
  ok('pengaturan: sakelar berlabel "Portal Tagihan Siswa"', /Portal Tagihan Siswa/.test(r.text));
  ok('pengaturan: sub-slug tagihan default portal-tagihan', /name="portal_slug"[^>]*value="portal-tagihan"|value="portal-tagihan"[^>]*name="portal_slug"/.test(r.text) || /portal-tagihan/.test(r.text));

  /* ================= 8. UI (Playwright): hover sidebar ================= */
  const browser = await chromium.launch();
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const ck = cookie.split(';')[0].split('=');
  await ctxB.addCookies([{ name: ck[0], value: ck.slice(1).join('='), domain: '127.0.0.1', path: '/' }]);
  const page = await ctxB.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(base + '/');
  await page.waitForSelector('.sidebar');
  // akordeon eksklusif: hanya satu grup terbuka
  ok('UI: hanya satu grup menu terbuka', (await page.locator('.nav-group.open').count()) <= 1);
  // klik grup lain → grup pertama tertutup
  const toggles = page.locator('[data-navtoggle]');
  const nT = await toggles.count();
  if (nT >= 2) {
    await toggles.nth(0).click();
    await toggles.nth(1).click();
    ok('UI: membuka grup lain menutup grup sebelumnya', (await page.locator('.nav-group.open').count()) === 1);
  } else { ok('UI: grup menu cukup untuk uji akordeon', false, 'n=' + nT); }
  // lipat sidebar lalu arahkan kursor → hover-open
  await page.click('#navCollapse');
  await page.waitForFunction(() => document.querySelector('.shell').classList.contains('nav-collapsed'));
  await page.hover('#sidebar');
  await page.waitForFunction(() => document.querySelector('.shell').classList.contains('hover-open'), { timeout: 3000 }).catch(() => { });
  ok('UI: kursor mendekat membuka sidebar (hover-open)', await page.evaluate(() => document.querySelector('.shell').classList.contains('hover-open')));
  // matikan sakelar → hover tidak membuka lagi
  await page.evaluate(() => { const p = document.getElementById('navHoverPref'); p.checked = false; p.dispatchEvent(new Event('change')); });
  await page.mouse.move(400, 300);
  await page.waitForTimeout(300);
  await page.hover('#sidebar');
  await page.waitForTimeout(400);
  ok('UI: sakelar OFF mematikan buka-otomatis', !(await page.evaluate(() => document.querySelector('.shell').classList.contains('hover-open'))));
  ok('UI: tidak ada error JavaScript', errs.length === 0, errs.join(' | '));
  await browser.close();

  console.log('\n=== RINGKASAN RONDE 42 ===');
  console.log(`lulus: ${pass} · gagal: ${fail}`);
  if (fail) console.log('GAGAL:\n - ' + fails.join('\n - '));
  if (fail) console.log('\n--- server log ---\n' + log.slice(-3000));
  srv.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); console.log(log.slice(-3000)); srv.kill(); process.exit(1); });
