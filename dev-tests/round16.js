'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* Ronde 16 — Portal Slip Gaji: dropdown periode (bulan & tahun), data realtime per
   periode, pesan "belum tersedia", cetak sesuai periode terpilih. */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');

const PORT = 3585;
const DB = path.join(os.tmpdir(), 'smk-r16-' + Date.now() + '.sqlite');
try { fs.unlinkSync(DB); } catch (e) { }
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, DB_PATH: DB }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
const results = [];
const ok = (n, c, e = '') => { results.push({ n, ok: !!c }); if (!c) console.log('FAIL:', n, e); };
async function reqRaw(method, url, body, opt = {}) {
  const headers = {};
  let payload = null;
  if (body) { payload = new URLSearchParams(body).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
  return { status: r.status, text: await r.text(), loc: r.headers.get('location') || '' };
}

/* ronde 43: alamat portal publik berpindah ke /<nama-sekolah>/<sub-slug>.
   Permintaan GET ke alamat lama (/portal…) dialihkan 302 — helper ini mengikutinya. */
async function portalFollow43(method, url, body, opt) {
  let r = await reqRaw(method, url, body, opt);
  if (method !== 'GET' || !/^\/portal(-|$|\?|\/)/.test(String(url || ''))) return r;
  for (let i = 0; i < 3 && [301, 302, 303, 307, 308].includes(r.status) && r.loc; i++) {
    r = await reqRaw('GET', r.loc.replace(/^https?:\/\/[^/]+/, ''), null, opt);
  }
  return r;
}
const req = (...a) => portalFollow43(...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  const db = new Database(DB);
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const curP = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const y = now.getFullYear() - 1;
  db.prepare('INSERT INTO pegawai (nama,jabatan,tipe,aktif,whatsapp,tanggal_lahir) VALUES (?,?,?,1,?,?)')
    .run('Guru Slip Uji', 'Guru', 'guru', '081234567891', '1990-01-01');
  const pg = db.prepare("SELECT * FROM pegawai WHERE nama='Guru Slip Uji'").get();
  // tiga periode berbeda, nominal berbeda → untuk menguji query per periode
  const seed = (periode, jam) => db.prepare(`INSERT INTO payroll (periode,nama,jabatan,tipe,jam_efektif,jam_telat,honor_jam,pegawai_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(periode, 'Guru Slip Uji', 'Guru', 'guru', jam, 1, 50000, pg.id, today);
  seed(`${y}-07`, 20);
  seed(`${y}-10`, 30);
  seed(`${y}-11`, 40);
  // periode tanpa data (untuk pesan "belum tersedia")
  const kosongBulan = 3, kosongTahun = y;

  /* ---------- 1. buka portal & verifikasi OTP ---------- */
  let r = await req('GET', '/portal-slip');
  ok('halaman portal slip 200', r.status === 200);
  r = await req('POST', '/portal-slip/otp', { nama: 'Guru Slip Uji', lahir: '1990-01-01' });
  const kode = (/kode OTP Anda: <b[^>]*>(\d{4})<\/b>/.exec(r.text) || [])[1];
  const tok = (r.text.match(/name="token" value="([^"]+)"/) || [])[1];
  ok('OTP slip terkirim (mode uji)', !!kode && !!tok, r.status);
  r = await req('POST', '/portal-slip/verifikasi', { token: tok, kode });
  ok('verifikasi membuka hasil slip', r.status === 200 && /Rincian Slip Gaji/.test(r.text));

  /* ---------- 2. default = periode bulan berjalan / terakhir tersedia ---------- */
  ok('tersedia dropdown Bulan', /name="bulan"/.test(r.text) && /<option value="1"/.test(r.text));
  ok('tersedia dropdown Tahun', /name="tahun"/.test(r.text) && /name="bulan" data-autosubmit/.test(r.text));
  ok('dropdown terhubung ke halaman hasil portal slip', /action="[^"]*\/hasil"/.test(r.text), (r.text.match(/action="[^"]*hasil[^"]*"/) || [])[0]);
  const aktifDefault = (/Periode aktif: ([A-Za-z]+ \d{4})/.exec(r.text) || [])[1] || '';
  const harapDefault = now.getFullYear() + '/'; // placeholder
  // periode default harus periode terbaru yang ada datanya (karena bulan berjalan belum diinput)
  ok('default menampilkan periode terakhir tersedia', aktifDefault === 'November ' + y, aktifDefault);
  ok('ada penjelasan default bulan berjalan', /periode bulan berjalan/.test(r.text));

  /* ---------- 3. ganti periode → data realtime berubah ---------- */
  const ambilTotal = txt => (txt.match(/TOTAL DITERIMA<\/span><span class="big">Rp ([\d.]+)/) || [])[1] || '';
  r = await req('GET', `/portal-slip/hasil?token=${tok}&bulan=7&tahun=${y}`);
  ok('pilih Juli menampilkan Juli', /Periode aktif: Juli \d{4}/.test(r.text), r.status);
  const totalJuli = ambilTotal(r.text);
  ok('Juli memuat total diterima', !!totalJuli, totalJuli);
  ok('Juli menyembunyikan periode lain', !/Periode aktif: November/.test(r.text));
  r = await req('GET', `/portal-slip/hasil?token=${tok}&bulan=11&tahun=${y}`);
  const totalNov = ambilTotal(r.text);
  ok('November menampilkan data berbeda', !!totalNov && totalNov !== totalJuli, `${totalJuli} vs ${totalNov}`);
  ok('total November lebih besar (jam 40 vs 20)', Number(totalNov.replace(/\./g, '')) > Number(totalJuli.replace(/\./g, '')));

  /* ---------- 4. periode tanpa data → pesan informatif ---------- */
  r = await req('GET', `/portal-slip/hasil?token=${tok}&bulan=${kosongBulan}&tahun=${kosongTahun}`);
  const labelKosong = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'][kosongBulan - 1];
  ok('periode kosong menampilkan pesan resmi', new RegExp(`Data slip gaji untuk periode ${labelKosong} ${kosongTahun} belum tersedia`).test(r.text),
    `harap "${labelKosong} ${kosongTahun}"`);
  ok('pesan kosong rapi (alert info) & tanpa rincian nominal', /class="alert info"/.test(r.text) && !/TOTAL DITERIMA<\/span><span class="big"/.test(r.text));

  /* ---------- 5. cetak sesuai periode terpilih ---------- */
  r = await req('GET', `/portal-slip/cetak?token=${tok}&periode=${y}-10`);
  ok('cetak periode Oktober 200 OK', r.status === 200);
  ok('judul cetak eksplisit periode', new RegExp(`SLIP GAJI PEGAWAI — PERIODE: OKTOBER ${y}`).test(r.text), 'judul');
  ok('cetak hanya 1 slip (periode terpilih)', (r.text.match(/class="slip-doc"/g) || []).length === 1);
  ok('cetak tidak memuat nomor halaman lain', !new RegExp(`PERIODE: JULI ${y}`).test(r.text));
  r = await req('GET', `/portal-slip/cetak?token=${tok}&periode=${y}-07`);
  ok('cetak Juli berbeda total', new RegExp(`PERIODE: JULI ${y}`).test(r.text) && /TOTAL DITERIMA/.test(r.text));
  r = await req('GET', `/portal-slip/cetak?token=${tok}&periode=${y}-03`);
  ok('cetak periode kosong tetap memberi pesan', /belum tersedia/.test(r.text) && new RegExp(`PERIODE: MARET ${y}`).test(r.text));
  r = await req('GET', `/portal-slip/cetak?token=salah`);
  ok('token salah ditolak (tanpa data pribadi)', r.status === 200 && /Akses Kedaluwarsa/.test(r.text));

  /* ---------- 5b. default = BULAN BERJALAN saat datanya ada ---------- */
  seed(curP, 25);
  r = await req('GET', `/portal-slip/hasil?token=${tok}`);
  const bulanNow = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'][now.getMonth()];
  ok('default mengikuti bulan berjalan bila ada data', new RegExp(`Periode aktif: ${bulanNow} ${now.getFullYear()}`).test(r.text),
    (/Periode aktif: ([A-Za-z]+ \d{4})/.exec(r.text) || [])[1]);
  ok('penanda bulan berjalan ditampilkan', /periode bulan berjalan/.test(r.text));

  /* ---------- 6. halaman hasil butuh token valid ---------- */
  r = await req('GET', '/portal-slip/hasil?bulan=7&tahun=2025');
  ok('hasil tanpa token ditolak', /Akses Kedaluwarsa/.test(r.text));

  srv.kill();
  db.close();
  const pass = results.filter(x => x.ok).length;
  console.log(`\n=== ${pass}/${results.length} cek portal slip lulus ===`);
  if (pass !== results.length) { console.log('LOG:\n' + log.slice(-1000)); process.exit(1); }
})().catch(e => { console.error('FATAL', e); try { srv.kill(); } catch (_) { } process.exit(1); });
