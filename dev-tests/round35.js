'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* ==================================================================
   RONDE 35 — Teks sub-judul aplikasi ("SISTEM KEUANGAN") dapat diedit
   ------------------------------------------------------------------
   1. Sekolah: field baru di menu Tema & Branding Aplikasi (`app_sub`)
      → tampil pada bilah samping.
   2. Super Admin: field baru di Branding Sistem (`saas_sub`)
      → menjadi DEFAULT untuk sekolah yang belum mengisi sendiri.
   3. Urutan prioritas: isian sekolah → default sistem → "Sistem Keuangan".
   4. Kosong = kembali ke default sistem; panjang dibatasi 60 karakter,
      spasi dirapikan, dan teks di-escape (tidak bisa menyuntik HTML).
   5. Nilai sekolah disimpan di database sekolah, nilai default sistem
      disimpan di control plane (tidak saling menimpa).
   ================================================================== */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'r35-'));
const DB = path.join(TMP, 'k.sqlite');
const SAAS_DB = path.join(TMP, 'saas.db');
const PORT = 3721;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: {
    ...process.env, PORT, DB_PATH: DB, SAAS_DB_PATH: SAAS_DB,
    DEMO_DB_PATH: path.join(TMP, 'demo.sqlite'), SAAS_ADMIN_PASSWORD: 'SuperUjiR35!'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });

const base = `http://127.0.0.1:${PORT}`;
let cookie = '';
let superCookie = '';
const results = [];
function ok(name, cond, extra = '') {
  results.push({ name, ok: !!cond, extra });
  if (!cond) console.log('FAIL', name, '→', extra);
}
async function req(method, url, body, opt = {}) {
  const headers = {};
  const ck = opt.super ? superCookie : (opt.cookie !== undefined ? opt.cookie : cookie);
  if (ck) headers.Cookie = ck;
  let payload = null;
  if (body) {
    payload = new URLSearchParams(body).toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc && opt.cookie === undefined) {
    const val = sc.split(';')[0];
    if (opt.super) superCookie = val; else cookie = val;
  }
  const text = opt.binary ? Buffer.from(await r.arrayBuffer()) : await r.text();
  return { status: r.status, text, loc: r.headers.get('location') || '', headers: r.headers };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dec = s => { try { return decodeURIComponent(String(s)); } catch (e) { return String(s); } };
/** ambil teks sub-judul bilah samping dari HTML dashboard */
const brandSub = html => {
  const m = String(html).match(/class="brand-sub">([\s\S]*?)<\/div>/);
  return m ? m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'") : null;
};
const inputVal = (html, name) => {
  const m = String(html).match(new RegExp('name="' + name + '"[^>]*value="([^"]*)"'));
  return m ? m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"') : null;
};

(async () => {
  for (let i = 0; i < 90; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  const db = new Database(DB);
  const ctl = new Database(SAAS_DB);

  let r = await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login admin sekolah', r.status === 303 && !/err=/.test(r.loc), r.loc);

  /* ==================================================================
     1. BAWAAN: "Sistem Keuangan"
     ================================================================== */
  r = await req('GET', '/');
  ok('bilah samping menampilkan sub-judul bawaan "Sistem Keuangan"', brandSub(r.text) === 'Sistem Keuangan', String(brandSub(r.text)));

  r = await req('GET', '/tema');
  ok('menu Tema & Branding memuat field sub-judul', /name="app_sub"/.test(r.text));
  ok('field sub-judul kosong secara bawaan (mengikuti default sistem)', inputVal(r.text, 'app_sub') === '', String(inputVal(r.text, 'app_sub')));
  ok('hint menyebut sumber default (Super Admin)', /default dari Super Admin/.test(r.text));
  ok('hint menampilkan nilai default saat ini', /default dari Super Admin: <b>Sistem Keuangan<\/b>/.test(r.text));

  /* ==================================================================
     2. SEKOLAH MENGISI SENDIRI
     ================================================================== */
  r = await req('POST', '/tema', { tema_warna: '#F97316', mode_tema: 'light', app_nama: 'SIMKOLA', app_sub: 'Sistem Informasi Keuangan Sekolah' });
  ok('simpan sub-judul dari akun sekolah', r.status === 303 && /ok=/.test(r.loc), dec(r.loc));
  ok('setting app_sub tersimpan di database sekolah',
    String((db.prepare("SELECT v FROM settings WHERE k='app_sub'").get() || {}).v || '') === 'Sistem Informasi Keuangan Sekolah');
  r = await req('GET', '/');
  ok('bilah samping memakai sub-judul isian sekolah', brandSub(r.text) === 'Sistem Informasi Keuangan Sekolah', String(brandSub(r.text)));
  ok('judul tab browser tetap memakai nama aplikasi', /<title>Dashboard · SIMKOLA<\/title>/.test(r.text));
  r = await req('GET', '/tema');
  ok('form menampilkan nilai tersimpan', inputVal(r.text, 'app_sub') === 'Sistem Informasi Keuangan Sekolah', String(inputVal(r.text, 'app_sub')));

  // spasi berlebih dirapikan & panjang dibatasi 60 karakter
  const panjang = 'A'.repeat(90);
  await req('POST', '/tema', { tema_warna: '#F97316', mode_tema: 'light', app_nama: 'SIMKOLA', app_sub: '  Sistem    Keuangan   Ringkas  ' });
  ok('spasi ganda/berlebih dirapikan',
    String((db.prepare("SELECT v FROM settings WHERE k='app_sub'").get() || {}).v || '') === 'Sistem Keuangan Ringkas',
    String((db.prepare("SELECT v FROM settings WHERE k='app_sub'").get() || {}).v || ''));
  await req('POST', '/tema', { tema_warna: '#F97316', mode_tema: 'light', app_nama: 'SIMKOLA', app_sub: panjang });
  ok('panjang sub-judul dibatasi 60 karakter',
    String((db.prepare("SELECT v FROM settings WHERE k='app_sub'").get() || {}).v || '').length === 60,
    String(String((db.prepare("SELECT v FROM settings WHERE k='app_sub'").get() || {}).v || '').length));

  // audit log mencatat sub-judul
  const audit = db.prepare("SELECT detail FROM audit WHERE modul='sekolah' ORDER BY id DESC LIMIT 1").get();
  ok('audit log mencatat perubahan sub-judul', /sub-judul/.test(String((audit || {}).detail || '')), String((audit || {}).detail || '').slice(0, 120));

  // teks di-escape (tidak boleh menyuntik HTML)
  await req('POST', '/tema', { tema_warna: '#F97316', mode_tema: 'light', app_nama: 'SIMKOLA', app_sub: '<script>alert(1)</script>' });
  r = await req('GET', '/');
  ok('sub-judul di-escape (tag HTML tidak dieksekusi)',
    !/<script>alert\(1\)<\/script>/.test(r.text) && (brandSub(r.text) || '').includes('<script>'),
    String(brandSub(r.text)));
  // kembalikan ke nilai normal
  await req('POST', '/tema', { tema_warna: '#F97316', mode_tema: 'light', app_nama: 'SIMKOLA', app_sub: 'Sistem Keuangan Sekolah' });

  /* ==================================================================
     3. SUPER ADMIN: DEFAULT SISTEM
     ================================================================== */
  r = await req('POST', '/super-admin/login', { email: 'super@simkeu.id', password: 'SuperUjiR35!' }, { super: true });
  ok('login Super Admin Pusat', r.status === 303 && !/err=/.test(r.loc), r.loc);

  r = await req('GET', '/super-admin/branding', null, { super: true });
  ok('Branding Sistem memuat field sub-judul default', /name="saas_sub"/.test(r.text));
  ok('nilai awal sub-judul default = "Sistem Keuangan"', inputVal(r.text, 'saas_sub') === 'Sistem Keuangan', String(inputVal(r.text, 'saas_sub')));
  ok('pratinjau Branding Sistem menampilkan sub-judul', /Sistem Keuangan/.test(r.text));

  r = await req('POST', '/super-admin/branding', { saas_nama: 'SIMKOLA', saas_sub: 'Sistem Administrasi Sekolah' }, { super: true });
  ok('simpan sub-judul default dari Super Admin', r.status === 303 && /ok=/.test(r.loc), dec(r.loc));
  ok('nilai default tersimpan di control plane (saas_settings)',
    String((ctl.prepare("SELECT v FROM saas_settings WHERE k='saas_sub'").get() || {}).v || '') === 'Sistem Administrasi Sekolah',
    String((ctl.prepare("SELECT v FROM saas_settings WHERE k='saas_sub'").get() || {}).v || ''));
  ok('nilai sekolah tidak ikut berubah oleh Super Admin',
    String((db.prepare("SELECT v FROM settings WHERE k='app_sub'").get() || {}).v || '') === 'Sistem Keuangan Sekolah');

  // sekolah yang mengosongkan sub-judul → memakai default sistem
  await req('POST', '/tema', { tema_warna: '#F97316', mode_tema: 'light', app_nama: 'SIMKOLA', app_sub: '' });
  ok('setting sekolah benar-benar dikosongkan', String((db.prepare("SELECT v FROM settings WHERE k='app_sub'").get() || {}).v || '') === '');
  r = await req('GET', '/');
  ok('sekolah tanpa isian memakai default sistem', brandSub(r.text) === 'Sistem Administrasi Sekolah', String(brandSub(r.text)));
  r = await req('GET', '/tema');
  ok('hint di Tema & Branding menampilkan default sistem terbaru',
    /default dari Super Admin: <b>Sistem Administrasi Sekolah<\/b>/.test(r.text));

  // isian sekolah tetap menang atas default sistem
  await req('POST', '/tema', { tema_warna: '#F97316', mode_tema: 'light', app_nama: 'SIMKOLA', app_sub: 'Sistem Keuangan Versi Sekolah' });
  r = await req('GET', '/');
  ok('isian sekolah menang atas default sistem', brandSub(r.text) === 'Sistem Keuangan Versi Sekolah', String(brandSub(r.text)));

  // nilai default sistem tidak boleh merusak tampilan (HTML di-escape juga)
  await req('POST', '/super-admin/branding', { saas_nama: 'SIMKOLA', saas_sub: '<b>Tebal</b> & <i>miring</i>' }, { super: true });
  await req('POST', '/tema', { tema_warna: '#F97316', mode_tema: 'light', app_nama: 'SIMKOLA', app_sub: '' });
  r = await req('GET', '/');
  ok('default sistem juga di-escape',
    !/<b>Tebal<\/b>/.test(r.text) && (brandSub(r.text) || '').includes('<b>Tebal</b>'),
    String(brandSub(r.text)));

  // kosongkan default sistem → kembali ke "Sistem Keuangan"
  r = await req('POST', '/super-admin/branding', { saas_nama: 'SIMKOLA', saas_sub: '' }, { super: true });
  ok('default sistem boleh dikosongkan', r.status === 303, dec(r.loc));
  ok('default sistem kosong disimpan sebagai "Sistem Keuangan"',
    String((ctl.prepare("SELECT v FROM saas_settings WHERE k='saas_sub'").get() || {}).v || '') === 'Sistem Keuangan');
  r = await req('GET', '/');
  ok('sekolah kembali menampilkan "Sistem Keuangan"', brandSub(r.text) === 'Sistem Keuangan', String(brandSub(r.text)));

  /* ==================================================================
     4. TIDAK MEMENGARUHI HAL LAIN
     ================================================================== */
  r = await req('GET', '/');
  ok('nama aplikasi pada bilah samping tetap terpisah', /class="brand-name">SIMKOLA<\/div>/.test(r.text));
  r = await req('GET', '/login', null, { cookie: '' });
  ok('halaman login tidak terpengaruh sub-judul sekolah', r.status === 200 && !/class="brand-sub"/.test(r.text));
  r = await req('GET', '/tema', null, { cookie: '' });
  ok('halaman Tema & Branding tetap memerlukan login', r.status === 303);

  console.log(`\n=== ${results.filter(x => x.ok).length}/${results.length} cek ronde 35 lulus ===`);
  if (results.some(x => !x.ok)) console.log('GAGAL:', results.filter(x => !x.ok).map(x => x.name).join(' | '));
  try { srv.kill(); } catch (e) { }
  setTimeout(() => process.exit(results.every(x => x.ok) ? 0 : 1), 250);
})().catch(e => { console.error(e); try { srv.kill(); } catch (_) { } process.exit(1); });
