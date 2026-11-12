'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* Ronde 30 — Setelah pendaftaran sekolah: langsung masuk dashboard Admin Sekolah
   + kredensial login (Kode Sekolah 4 karakter, Username, Password) tampil SEKALI.

   1. POST /register → 303 ke dashboard (?welcome=1), bukan lagi ke /login
   2. Sesi login otomatis dibuat untuk Admin Sekolah yang baru dibuat (cookie aktif)
   3. Dashboard menampilkan kartu kredensial: kode 4 karakter, username, password
   4. Kartu hanya tampil sekali (kunjungan berikutnya hilang), password tidak di URL
   5. Kredensial benar-benar bisa dipakai login (kode + username/email + password)
   6. Halaman sukses fallback /daftar/sukses (token sekali pakai) & tautan ?kode=
   7. Audit 'DAFTAR' tercatat di database sekolah baru
   8. Tenant tetap terisolasi (data sekolah baru terpisah)
*/
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');
const { otpDaftar } = require('./otp');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'r30-'));
const DB = path.join(TMP, 'k.sqlite');
const SAAS = path.join(TMP, 's.db');
const PORT = 3657;
const base = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, DB_PATH: DB, SAAS_DB_PATH: SAAS, DEMO_DB_PATH: path.join(TMP, 'demo.sqlite') },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });

const results = [];
function ok(name, cond, extra = '') { results.push({ name, ok: !!cond, extra }); if (!cond) console.log('FAIL', name, '→', extra); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dec = s => { try { return decodeURIComponent(String(s)); } catch (e) { return String(s); } };

const cookies = {};
async function req(method, url, body, opt = {}) {
  const who = opt.who || 'main';
  const headers = {};
  if (cookies[who]) headers.Cookie = cookies[who];
  let payload = null;
  if (body) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) { if (Array.isArray(v)) v.forEach(x => usp.append(k, x)); else usp.append(k, v); }
    payload = usp.toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc && opt.keepCookie !== false) cookies[who] = sc.split(';')[0];
  if (opt.clearCookie) delete cookies[who];
  return { status: r.status, text: await r.text(), loc: r.headers.get('location') || '', headers: r.headers };
}

(async () => {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  const ctl = new Database(SAAS);
  const t1 = ctl.prepare('SELECT * FROM tenants ORDER BY id LIMIT 1').get();
  ok('tenant pertama tersedia untuk login biasa', !!t1, JSON.stringify(t1 && t1.school_code));

  /* ============ 1. DAFTAR → LANGSUNG DASHBOARD ============ */
  const SEKOLAH = 'SMK Negeri 30 Uji';
  const EMAIL = 'bendahara@smk30.sch.id';
  const PASS = 'rahasiaUji30';
  const otp1 = await otpDaftar(base, '081200000030');
  let r = await req('POST', '/register', {
    nama: SEKOLAH, admin_nama: 'Ibu Bendahara', admin_email: EMAIL,
    admin_password: PASS, admin_password2: PASS, jenjang: 'SMK',
    alamat: 'Jl. Uji No. 30', telp: '081200000030', otp_token: otp1
  }, { who: 'baru' });
  ok('daftar berhasil & redirect', r.status === 303 && !/err=/.test(r.loc), dec(r.loc));
  ok('redirect langsung ke dashboard (bukan /login)', /\/\?welcome=1$/.test(r.loc) && !/\/login/.test(r.loc), r.loc);
  ok('cookie sesi login otomatis dikirim', !!cookies['baru'], cookies['baru']);

  const tenantBaru = ctl.prepare('SELECT * FROM tenants WHERE nama=?').get(SEKOLAH);
  ok('tenant baru dibuat', !!tenantBaru, String(tenantBaru && tenantBaru.id));
  const KODE = tenantBaru ? tenantBaru.school_code : '';
  ok('kode sekolah 4 karakter alfanumerik', /^[A-Z0-9]{4}$/.test(KODE), KODE);
  const sesi = ctl.prepare('SELECT * FROM sessions WHERE tenant_id=? ORDER BY rowid DESC LIMIT 1').get(tenantBaru.id);
  ok('sesi tersimpan untuk tenant baru', !!sesi && sesi.kind === 'tenant', JSON.stringify(sesi && sesi.kind));

  /* kunjungan pertama (SETELAH redirect) → kartu kredensial */
  r = await req('GET', '/?welcome=1', null, { who: 'baru', keepCookie: false });
  ok('dashboard dapat dibuka tanpa login ulang', r.status === 200 && /Ringkasan Keuangan/.test(r.text), String(r.status));
  ok('kartu kredensial pendaftaran tampil', /id="welcomeKredensial"/.test(r.text));
  ok('kartu menyebut Pendaftaran berhasil', /Pendaftaran berhasil/.test(r.text));
  ok('kode sekolah tampil di kartu (4 karakter)', new RegExp(`data-cred="kode">${KODE}<`).test(r.text), KODE);
  ok('label "Kode Sekolah" & badge 4 karakter', /Kode Sekolah/.test(r.text) && /4 karakter/.test(r.text));
  const uname = (r.text.match(/data-cred="user">([^<]*)</) || [])[1] || '';
  ok('username tampil di kartu', !!uname && uname.length > 0, uname);
  ok('username = email atau bagian depannya', uname === EMAIL || uname === EMAIL.split('@')[0], uname);
  ok('password tampil (tersamar) dengan tombol Lihat', /data-pw="rahasiaUji30"/.test(r.text) && /data-pw-toggle/.test(r.text));
  ok('password TERNYATA tidak dirender polos di HTML', !/>rahasiaUji30</.test(r.text));
  ok('ada tombol salin kode / username / password', (r.text.match(/data-copy=/g) || []).length >= 3);
  ok('ada tombol "Mengerti, lanjut ke dashboard"', /data-close-welcome/.test(r.text));
  ok('peringatan password hanya sekali', /Password hanya ditampilkan sekali/.test(r.text));

  /* kunjungan kedua → kartu hilang (sekali tampil) */
  r = await req('GET', '/', null, { who: 'baru', keepCookie: false });
  ok('kartu kredensial hilang pada kunjungan berikutnya', !/id="welcomeKredensial"/.test(r.text));
  const sesiAfter = ctl.prepare('SELECT welcome FROM sessions WHERE token=?').get(String(cookies['baru'] || '').replace('simkeu_sid=', ''));
  ok('kolom welcome dikosongkan setelah dibaca', !sesiAfter || !sesiAfter.welcome, JSON.stringify(sesiAfter));

  /* ============ 2. KREDENSIAL BENAR-BENAR BISA DIPAKAI LOGIN ============ */
  r = await req('POST', '/logout', {}, { who: 'baru' });
  ok('logout dari sesi baru', r.status === 303);
  r = await req('GET', '/', null, { who: 'baru', keepCookie: false });
  ok('setelah logout tidak bisa akses dashboard', r.status === 303 && /\/login/.test(r.loc), String(r.status));

  r = await req('POST', '/login', { kode: KODE, email: uname, password: PASS }, { who: 'baru' });
  ok('login dengan Kode Sekolah + Username + Password berhasil', r.status === 303 && !/err=/.test(r.loc), dec(r.loc));
  r = await req('GET', '/', null, { who: 'baru', keepCookie: false });
  ok('dashboard sekolah baru terbuka setelah login', r.status === 200 && r.text.includes('Ringkasan Keuangan'), String(r.status));
  ok('identitas sekolah benar (bukan sekolah lain)', r.text.includes(SEKOLAH), SEKOLAH);

  /* login pakai email penuh juga harus bisa */
  await req('POST', '/logout', {}, { who: 'baru' });
  r = await req('POST', '/login', { kode: KODE, email: EMAIL, password: PASS }, { who: 'baru' });
  ok('login memakai email penuh juga berhasil', r.status === 303 && !/err=/.test(r.loc), dec(r.loc));

  /* password salah tetap ditolak */
  r = await req('POST', '/login', { kode: KODE, email: EMAIL, password: 'salahbanget' }, { who: 'x' });
  ok('password salah ditolak', /err=/.test(r.loc), dec(r.loc));

  /* ============ 3. AUDIT & ISOLASI ============ */
  const connBaru = new Database(tenantBaru.db_file, { readonly: true });
  const auditDaftar = connBaru.prepare("SELECT * FROM audit WHERE aksi='DAFTAR' ORDER BY id DESC LIMIT 1").get();
  ok('audit DAFTAR tercatat di database sekolah baru', !!auditDaftar, JSON.stringify(auditDaftar && auditDaftar.detail));
  ok('audit menyebut kode sekolah & langsung masuk dashboard',
    auditDaftar && new RegExp(KODE).test(auditDaftar.detail) && /dashboard/.test(auditDaftar.detail), auditDaftar && auditDaftar.detail);
  const adminBaru = connBaru.prepare("SELECT * FROM users WHERE role='super_admin' ORDER BY id LIMIT 1").get();
  ok('akun admin sekolah baru aktif', adminBaru && Number(adminBaru.aktif) === 1 && adminBaru.email === EMAIL, JSON.stringify(adminBaru && adminBaru.email));
  ok('database sekolah baru terpisah dari sekolah pertama', tenantBaru.db_file !== DB, tenantBaru.db_file);
  const db1 = new Database(DB, { readonly: true });
  ok('sekolah pertama tidak mendapat audit DAFTAR', !db1.prepare("SELECT id FROM audit WHERE aksi='DAFTAR'").get());
  connBaru.close(); db1.close();

  /* ============ 4. HALAMAN SUKSES FALLBACK (/daftar/sukses) ============ */
  r = await req('GET', '/daftar/sukses?kode=' + KODE + '&u=' + encodeURIComponent(EMAIL.split('@')[0]), null, { who: 'none', clearCookie: true });
  ok('halaman sukses pendaftaran dapat dibuka tanpa sesi', r.status === 200 && /Sekolah berhasil didaftarkan/.test(r.text), String(r.status));
  ok('halaman sukses menampilkan kode sekolah', r.text.includes(KODE));
  ok('halaman sukses menampilkan username', new RegExp(`data-cred="user">${EMAIL.split('@')[0]}<`).test(r.text));
  ok('halaman sukses menyediakan tombol masuk ke dashboard', /Masuk ke Dashboard Sekolah/.test(r.text));
  r = await req('GET', '/daftar/sukses', null, { who: 'none', clearCookie: true });
  ok('tanpa token & tanpa kode → kembali ke login dengan pesan', r.status === 303 && /login\?err=/.test(r.loc), r.loc);

  /* token sekali pakai pada alur fallback: paksa lewat saas.takeWelcome tidak relevan,
     cukup pastikan token acak tidak valid */
  r = await req('GET', '/daftar/sukses?t=tokenpalsu123', null, { who: 'none', clearCookie: true });
  ok('token sukses palsu ditolak', r.status === 303 && /kedaluwarsa/.test(dec(r.loc)), dec(r.loc));

  /* ============ 5. PENDAFTARAN KEDUA TETAP TERPISAH ============ */
  const otp2 = await otpDaftar(base, '081200000031');
  const r2 = await req('POST', '/register', {
    nama: 'SMA Dua Uji', admin_nama: 'Pak Dua', admin_email: 'pakdua@sma2.sch.id',
    admin_password: 'rahasiaDua', admin_password2: 'rahasiaDua', jenjang: 'SMA',
    telp: '081200000031', otp_token: otp2
  }, { who: 'dua' });
  const tenant2 = ctl.prepare('SELECT * FROM tenants WHERE nama=?').get('SMA Dua Uji');
  ok('pendaftaran kedua juga langsung ke dashboard', r2.status === 303 && /welcome=1/.test(r2.loc), r2.loc);
  ok('kode sekolah kedua berbeda', tenant2 && tenant2.school_code !== KODE, `${tenant2 && tenant2.school_code} vs ${KODE}`);
  ok('slug portal kedua otomatis dari nama', /sma-dua-uji/.test(String(tenant2 && tenant2.portal_slug)), String(tenant2 && tenant2.portal_slug));
  const dash2 = await req('GET', '/?welcome=1', null, { who: 'dua', keepCookie: false });
  ok('dashboard kedua menampilkan sekolahnya sendiri', dash2.text.includes('SMA Dua Uji') && !dash2.text.includes(SEKOLAH));

  /* ============ 6. PENDAFTARAN GAGAL TIDAK MEMBUAT SESI ============ */
  const before = ctl.prepare('SELECT COUNT(*) c FROM sessions').get().c;
  const bad = await req('POST', '/register', {
    nama: 'Sekolah Gagal', admin_nama: 'X', admin_email: 'bukan-email',
    admin_password: '123', admin_password2: '123'
  }, { who: 'gagal' });
  const after = ctl.prepare('SELECT COUNT(*) c FROM sessions').get().c;
  ok('validasi gagal → kembali ke form register', bad.status === 303 && /\/register\?/.test(bad.loc) && /err=/.test(bad.loc), dec(bad.loc).slice(0, 120));
  ok('pendaftaran gagal tidak membuat sesi login', after === before, `${before} → ${after}`);
  ok('pendaftaran gagal tidak membuat tenant', !ctl.prepare('SELECT id FROM tenants WHERE nama=?').get('Sekolah Gagal'));

  /* ============ ringkasan ============ */
  try { ctl.close(); } catch (e) { }
  srv.kill();
  const pass = results.filter(x => x.ok).length;
  console.log(`\nround30: ${pass}/${results.length} cek lulus`);
  if (pass !== results.length) {
    console.log('GAGAL:', results.filter(x => !x.ok).map(x => x.name).join(' | '));
    console.log('LOG SERVER:\n' + log.split('\n').slice(-25).join('\n'));
  }
  setTimeout(() => process.exit(pass === results.length ? 0 : 1), 300);
})().catch(e => { console.error(e); console.log(log.split('\n').slice(-20).join('\n')); srv.kill(); process.exit(1); });
