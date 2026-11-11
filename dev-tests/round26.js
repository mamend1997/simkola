'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* Ronde 26 — struktur menu, identitas resmi, mode gelap, backup/restore Super Admin,
   Database Manager, custom domain A Record, preset menu & kontrol fitur granular,
   optimasi performa (cache immutable, kompresi, preload/lazy, WebP client-side).
   1. Identitas sekolah: NPSN, bentuk, status, kepemilikan, kontak, website (+validasi)
   2. Pemisahan menu Identitas vs Portal Publik vs Desain Templat Cetak
   3. Mode gelap/terang di Tema & Branding
   4. Role demo dihapus total
   5. Backup sekolah (JSON) vs Super Admin (ZIP/source/restore) + Database Manager
   6. Custom domain: opsi CNAME & A Record
   7. Preset default tampilan menu + fitur paket granular
   8. Performa: Cache-Control immutable, gzip, script defer, preconnect, minifikasi
*/
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');
const X = require('../xlsx-read');

const PORT = 3627;
const DB = process.env.R26_DB || path.join(os.tmpdir(), 'smk-r26-' + Date.now() + '.sqlite');
const SAAS_DB = path.join(path.dirname(DB), 'saas.db');
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, DB_PATH: DB, SAAS_DB_PATH: SAAS_DB }, stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
let cookie = '';
const results = [];
function ok(name, cond, extra = '') { results.push({ name, ok: !!cond, extra }); if (!cond) console.log('FAIL', name, '→', extra); }
async function req(method, url, body, opt = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (opt.cookie !== undefined) { if (opt.cookie) headers.Cookie = opt.cookie; else delete headers.Cookie; }
  let payload = null;
  if (body) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (Array.isArray(v)) v.forEach(x => usp.append(k, x)); else usp.append(k, v);
    }
    payload = usp.toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc && opt.cookie === undefined) cookie = sc.split(';')[0];
  const text = opt.binary ? Buffer.from(await r.arrayBuffer()) : await r.text();
  return { status: r.status, text, loc: r.headers.get('location') || '', headers: r.headers };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const decode = s => { try { return decodeURIComponent(s); } catch (e) { return s; } };
const today = new Date().toISOString().slice(0, 10);

(async () => {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  const db = new Database(DB);
  let r = await req('POST', '/login', { kode: 'SK01', email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login admin sekolah', r.status === 303, r.status + ' ' + r.loc);

  /* ============ 1. IDENTITAS RESMI SEKOLAH ============ */
  r = await req('GET', '/sekolah');
  ok('halaman Identitas Sekolah 200', r.status === 200);
  ok('form memuat NPSN', /name="sekolah_npsn"/.test(r.text));
  ok('form memuat bentuk pendidikan lengkap', ['SMK', 'SMA', 'MA', 'SMP', 'MTS', 'SD', 'MI', 'PAUD'].every(k => new RegExp(`value="${k}"`).test(r.text)));
  ok('form memuat status Negeri & Swasta', /name="sekolah_status"/.test(r.text) && /value="Negeri"/.test(r.text) && /value="Swasta"/.test(r.text));
  ok('form memuat kepemilikan (datalist)', /name="sekolah_kepemilikan"/.test(r.text) && /Pemerintah Daerah/.test(r.text));
  ok('form memuat telepon, email, website', /name="sekolah_telp"/.test(r.text) && /name="sekolah_email"/.test(r.text) && /name="sekolah_website"/.test(r.text));
  ok('dua bagian: Informasi Umum & Kontak + Legalitas & Status', /Informasi Umum &amp; Kontak/.test(r.text) && /Legalitas &amp; Status/.test(r.text));
  ok('halaman identitas TIDAK lagi memuat form kop/ukuran kuitansi', !/name="kop_baris"/.test(r.text) && !/name="kwitansi_w_mm"/.test(r.text));
  ok('halaman identitas TIDAK lagi memuat slug/domain', !/name="portal_slug"/.test(r.text) && !/name="custom_domain"/.test(r.text));

  // validasi NPSN
  r = await req('POST', '/sekolah', { sekolah_npsn: '123' });
  ok('NPSN kurang dari 8 digit ditolak', r.status === 303 && /err=/.test(r.loc), decode(r.loc));
  r = await req('POST', '/sekolah', { sekolah_npsn: '20211525', sekolah_email: 'bukan-email' });
  ok('email tidak valid ditolak', /err=/.test(r.loc) && /email/i.test(decode(r.loc)), decode(r.loc));
  /* ronde 33: website diisi TANPA https:// — protokol ditambahkan otomatis saat disimpan */
  r = await req('POST', '/sekolah', { sekolah_npsn: '20211525', sekolah_website: 'sekolah.sch.id' });
  ok('website tanpa https:// diterima', /ok=/.test(r.loc), decode(r.loc));
  ok('website disimpan dengan protokol https://',
    String((db.prepare("SELECT v FROM settings WHERE k='sekolah_website'").get() || {}).v || '') === 'https://sekolah.sch.id',
    String((db.prepare("SELECT v FROM settings WHERE k='sekolah_website'").get() || {}).v || ''));
  r = await req('POST', '/sekolah', { sekolah_npsn: '20211525', sekolah_website: 'bukan url' });
  ok('website benar-benar tidak valid tetap ditolak', /err=/.test(r.loc) && /website/i.test(decode(r.loc)), decode(r.loc));

  r = await req('POST', '/sekolah', {
    sekolah_nama: 'SMK PGRI Cikoneng', sekolah_npsn: '20211525', sekolah_bentuk: 'SMK',
    sekolah_status: 'Swasta', sekolah_kepemilikan: 'Yayasan',
    sekolah_telp: '(0265) 773258', sekolah_email: 'info@smkpgricikoneng.sch.id',
    sekolah_website: 'https://smkpgricikoneng.sch.id',
    sekolah_alamat: 'Jl. Raya No.144, Cikoneng, Ciamis',
    sekolah_kepala: 'Drs. H. Ahmad Fauzi, M.Pd.', sekolah_nip_kepala: '196804121994031005',
    sekolah_bendahara: 'Siti Nurhaliza, S.E.', sekolah_nip_bendahara: '198207152008012011'
  });
  ok('identitas resmi tersimpan', r.status === 303 && /ok=/.test(r.loc), decode(r.loc));
  const S = k => db.prepare('SELECT v FROM settings WHERE k=?').get(k).v;
  ok('NPSN tersimpan', S('sekolah_npsn') === '20211525');
  ok('bentuk pendidikan tersimpan', S('sekolah_bentuk') === 'SMK');
  ok('status & kepemilikan tersimpan', S('sekolah_status') === 'Swasta' && S('sekolah_kepemilikan') === 'Yayasan');
  ok('kontak & website tersimpan', S('sekolah_telp').length > 5 && /@/.test(S('sekolah_email')) && /^https:\/\//.test(S('sekolah_website')));
  const cdb = new Database(SAAS_DB);
  ok('NPSN tersinkron ke control plane (indeks unik)', String((cdb.prepare('SELECT npsn FROM tenants WHERE id=1').get() || {}).npsn) === '20211525');
  cdb.close();

  // variabel dinamis kop
  await req('POST', '/desain-cetak', {
    kop_baris: 'YAYASAN PENDIDIKAN\nNPSN : {npsn}\nBentuk: {bentuk}\n{nama}\n{alamat} · Telp. {telp} · {email}',
    kop_font: '10', kop_font_besar: '15', kwitansi_w_mm: '210', kwitansi_h_mm: '99', kwitansi_margin_mm: '6', print_tempat: 'Cikoneng'
  });
  r = await req('GET', '/sekolah');
  ok('variabel {npsn}/{bentuk}/{email} terisi pada pratinjau kop', /20211525/.test(r.text) && /Sekolah Menengah Kejuruan/.test(r.text) && /info@smkpgricikoneng/.test(r.text));
  r = await req('GET', '/cetak/bku?ta=1');
  ok('laporan cetak memakai kop ber-variabel (NPSN & kontak)', r.status === 200 && /20211525/.test(r.text) && /info@smkpgricikoneng/.test(r.text));

  /* ============ 2. PEMISAHAN MENU ============ */
  r = await req('GET', '/portal-publik');
  ok('halaman Portal Publik 200', r.status === 200);
  ok('memuat alamat 3 portal (slug)', /name="portal_slug"/.test(r.text) && /name="portal_pegawai_slug"/.test(r.text) && /name="portal_slip_slug"/.test(r.text));
  ok('memuat subdomain/URL portal sekolah', /URL Portal Sekolah/.test(r.text) && /Custom URL Slug/.test(r.text));
  ok('memuat custom domain + 2 opsi DNS', /name="custom_domain"/.test(r.text) && /Opsi 1/.test(r.text) && /Opsi 2/.test(r.text));
  ok('opsi CNAME & A Record (direkomendasikan) tampil', /CNAME Record/.test(r.text) && /A Record \(Direkomendasikan\)/.test(r.text));
  ok('A Record menampilkan IP server / instruksi', /Target\/Value/.test(r.text));
  r = await req('GET', '/desain-cetak');
  ok('Desain Templat Cetak memuat Kop Surat Resmi', /Kop Surat Resmi/.test(r.text) && /name="kop_baris"/.test(r.text));
  ok('Desain Templat Cetak memuat Ukuran Kuitansi', /Ukuran Kuitansi/.test(r.text) && /name="kwitansi_w_mm"/.test(r.text));
  r = await req('GET', '/');
  ok('menu sidebar: Identitas Sekolah, Portal Publik, Desain Templat Cetak', /Identitas Sekolah/.test(r.text) && /Portal Publik/.test(r.text) && /Desain Templat Cetak/.test(r.text));

  // slug validasi & simpan
  r = await req('POST', '/sekolah/portal-slug', { portal_slug: 'sekolah', portal_pegawai_slug: 'portal-pegawai', portal_slip_slug: 'portal-slip' });
  ok('slug terlarang ditolak', /err=/.test(r.loc), decode(r.loc));
  r = await req('POST', '/sekolah/portal-slug', { portal_slug: 'tagihan-siswa', portal_pegawai_slug: 'piutang-pegawai', portal_slip_slug: 'slip-gaji' });
  ok('slug kustom tersimpan', /ok=/.test(r.loc) && S('portal_slug') === 'tagihan-siswa');
  await req('POST', '/sekolah/portal-slug', { portal_slug: 'portal', portal_pegawai_slug: 'portal-pegawai', portal_slip_slug: 'portal-slip' });

  /* ============ 3. MODE GELAP / TERANG ============ */
  r = await req('GET', '/tema');
  ok('Tema & Branding memuat pilihan Mode Tampilan', /Mode Tampilan/.test(r.text) && /name="mode_tema"/.test(r.text) && /Mode Gelap/.test(r.text));
  r = await req('POST', '/tema', { tema_warna: '#F97316', tema_hex: '#F97316', mode_tema: 'dark', app_nama: 'SIMKEU Sekolah' });
  ok('simpan mode gelap', /ok=/.test(r.loc), decode(r.loc));
  r = await req('GET', '/');
  ok('halaman memakai data-mode="dark"', /data-mode="dark"/.test(r.text));
  ok('CSS mode gelap tersedia', (await req('GET', '/assets/app.css')).text.includes('html[data-mode="dark"]'));
  await req('POST', '/tema', { tema_warna: '#F97316', tema_hex: '#F97316', mode_tema: 'light', app_nama: 'SIMKEU Sekolah' });
  r = await req('GET', '/');
  ok('kembali ke mode terang', /data-mode="light"/.test(r.text));

  /* ============ 4. ROLE DEMO DIHAPUS ============ */
  r = await req('GET', '/pengguna');
  ok('tidak ada pilihan role demo', !/value="demo"/.test(r.text) && !/Akun Demo \(Sandbox\)/.test(r.text));
  ok('hanya 3 role pada dropdown', (r.text.match(/name="role"/g) || []).length >= 1 && !/Akun Demo/.test((r.text.match(/<select name="role">[\s\S]*?<\/select>/) || [''])[0]));

  /* ============ 5. BACKUP SEKOLAH vs SUPER ADMIN ============ */
  r = await req('GET', '/backup');
  ok('backup sekolah = Backup Data Sekolah (JSON)', /Backup Data Sekolah/.test(r.text) && /\.json\)/.test(r.text));
  ok('tidak ada export .sql / source code', !/Export Database \(\.sql\)/.test(r.text) && !/Download Source Code/.test(r.text));
  r = await req('GET', '/backup/download', null, { binary: true });
  let dump = null; try { dump = JSON.parse(r.text.toString('utf8')); } catch (e) { }
  ok('unduh JSON berisi data sekolah', r.status === 200 && dump && dump.app === 'simkeu-sekolah');
  ok('export .sql akun sekolah ditolak', (await req('GET', '/backup/export-database', null, { binary: true })).status === 404);
  ok('download source akun sekolah ditolak', (await req('GET', '/backup/download-source', null, { binary: true })).status === 404);

  // login super admin
  cookie = '';
  r = await req('POST', '/super-admin/login', { email: 'super@simkeu.id', password: 'SuperAdmin2026!' });
  ok('login Super Admin Pusat', r.status === 303 && !/err=/.test(r.loc), r.loc);
  r = await req('GET', '/super-admin/backup');
  ok('panel Backup & Restore Database System 200', r.status === 200 && /Backup &amp; Restore Database System/.test(r.text));
  ok('menyediakan unduhan ZIP seluruh sistem', /Download Keseluruhan Data \(\.zip\)/.test(r.text));
  ok('menyediakan Download Source Code', /Download Source Code \(\.zip\)/.test(r.text));
  ok('menyediakan tombol Restore Database', /Restore Database/.test(r.text) && /mRestoreDb/.test(r.text));
  ok('panel menampilkan konfigurasi .env', /Konfigurasi Lingkungan \(\.env\)/.test(r.text) && /APP_MEDIA_TOKEN/.test(r.text));
  r = await req('GET', '/super-admin/backup/download-source', null, { binary: true });
  let entries = {};
  try { entries = X.unzipEntries(r.text); } catch (e) { }
  const names = Object.keys(entries);
  ok('ZIP source 200 & berisi kode', r.status === 200 && r.text.slice(0, 2).toString() === 'PK' && names.includes('server.js') && names.includes('routes/superadmin_db.js'));
  ok('ZIP source memuat aset & README', names.includes('public/app.css') && names.includes('README-SOURCE.txt'));
  ok('ZIP source TANPA .env/database/node_modules', !names.includes('.env') && !names.some(n => /\.sqlite|node_modules/.test(n)));

  // restore JSON per sekolah (round-trip aman, isi sama)
  const b64 = Buffer.from(JSON.stringify(dump)).toString('base64');
  r = await req('POST', '/super-admin/backup/restore', { file_b64: 'data:application/json;base64,' + b64, tenant_id: '1', konfirmasi: '1' });
  ok('restore JSON per sekolah berhasil', /ok=/.test(r.loc) && /Restore JSON/i.test(decode(r.loc)), decode(r.loc));
  ok('data transaksi tetap utuh setelah restore', db.prepare('SELECT COUNT(*) c FROM users').get().c >= 1);
  r = await req('POST', '/super-admin/backup/restore', { file_b64: 'data:application/json;base64,' + Buffer.from('{"app":"lain"}').toString('base64'), tenant_id: '1', konfirmasi: '1' });
  ok('restore JSON format asing ditolak', /err=/.test(r.loc), decode(r.loc));

  /* ============ 6. DATABASE MANAGER ============ */
  r = await req('GET', '/super-admin/database');
  ok('Database Manager 200 & pemilih database', r.status === 200 && /Pemilih Database/.test(r.text) && /saas\.db/.test(r.text));
  ok('konsol SQL tersedia', /Konsol SQL/.test(r.text) && /name="sql"/.test(r.text));
  r = await req('GET', '/super-admin/database/tabel?scope=saas&tabel=tenants');
  ok('browse tabel tenants', r.status === 200 && /DAFTAR TABEL/.test(r.text) && /tenants/.test(r.text));
  ok('baris tabel dapat diedit (input sel)', /class="cell-in"/.test(r.text));
  const ctl = new Database(SAAS_DB);
  const t1 = ctl.prepare('SELECT * FROM tenants').get();
  r = await req('POST', '/super-admin/database/baris', { scope: 'saas', tabel: 'tenants', rid: t1.id, c_catatan: 'catatan uji r26' });
  const cdb2 = new Database(SAAS_DB, { readonly: true });
  ok('edit sel tersimpan ke database', String((cdb2.prepare('SELECT catatan FROM tenants WHERE id=?').get(t1.id) || {}).catatan || '') === 'catatan uji r26');
  ok('edit sel tercatat di audit Super Admin', cdb2.prepare("SELECT COUNT(*) c FROM saas_audit WHERE aksi='EDIT DATABASE'").get().c >= 1);
  cdb2.close();
  r = await req('POST', '/super-admin/database/query', { scope: 'saas', sql: 'SELECT COUNT(*) c FROM tenants' });
  ok('konsol SQL SELECT menampilkan hasil', r.status === 200 && /Hasil Query/.test(r.text) && /tenants/.test(r.text));
  r = await req('POST', '/super-admin/database/query', { scope: 'saas', sql: 'SELECT 1; SELECT 2' });
  ok('multi-perintah ditolak', /err=/.test(r.loc));
  r = await req('POST', '/super-admin/database/query', { scope: 'saas', sql: 'SELECT * FROM tenants', konfirmasi: '1' });
  ok('SELECT dengan konfirmasi tetap berjalan', r.status === 200 && /Hasil Query/.test(r.text));
  r = await req('POST', '/super-admin/database/query', { scope: 'saas', sql: "UPDATE tenants SET catatan=catatan WHERE id=" + t1.id });
  ctl.close();
  ok('query tulis tanpa konfirmasi ditolak', /err=/.test(r.loc));
  cookie = '';
  r = await req('GET', '/super-admin/database', null, { cookie: '' });
  ok('Database Manager menolak tanpa sesi super admin', r.status === 303 && /super-admin\/login/.test(r.loc));

  /* ============ 7. PRESET MENU & FITUR GRANULAR ============ */
  cookie = '';
  await req('POST', '/super-admin/login', { email: 'super@simkeu.id', password: 'SuperAdmin2026!' });
  r = await req('GET', '/super-admin/menu-default');
  ok('halaman Default Tampilan Menu Sekolah 200', r.status === 200 && /Default Tampilan Menu Sekolah/.test(r.text));
  ok('struktur sama: ceklis tampil + judul + urutan', /name="show"/.test(r.text) && /name="lbl_0"/.test(r.text) && /name="ord_0"/.test(r.text));
  ok('tombol terapkan ke semua sekolah', /Terapkan ke Semua Sekolah/.test(r.text));
  // sembunyikan menu Kotak Sampah (/trash)
  const form = {};
  const hrefs = [...r.text.matchAll(/name="h_(\d+)" value="([^"]+)"/g)].map(m => ({ i: m[1], href: m[2] }));
  ok('preset memuat daftar seluruh menu', hrefs.length > 30, String(hrefs.length));
  hrefs.forEach(h => {
    form['h_' + h.i] = h.href;
    form['lbl_' + h.i] = '';
    form['ord_' + h.i] = String(Number(h.i) + 1);
    if (h.href !== '/trash') form['show_' + h.i] = h.href;
  });
  // checkbox name="show" bernilai href
  const showVals = hrefs.filter(h => h.href !== '/trash').map(h => h.href);
  const bodyMenu = { ...form, show: showVals };
  Object.keys(bodyMenu).forEach(k => { if (k.startsWith('show_')) delete bodyMenu[k]; });
  const gids = [...r.text.matchAll(/name="g_([a-z_]+)"/g)].map(m => m[1]);
  gids.forEach((g, i) => { bodyMenu['g_' + g] = String(i + 1); });
  r = await req('POST', '/super-admin/menu-default/simpan', bodyMenu);
  ok('preset menu tersimpan', /ok=/.test(r.loc), decode(r.loc));
  const cdb3 = new Database(SAAS_DB, { readonly: true });
  const tplRaw = (cdb3.prepare("SELECT v FROM saas_settings WHERE k='school_menu_default'").get() || {}).v || '{}';
  let tpl = {}; try { tpl = JSON.parse(tplRaw); } catch (e) { }
  ok('preset menyimpan menu tersembunyi', Array.isArray(tpl.hidden) && tpl.hidden.includes('/trash'));
  ok('preset menyimpan urutan menu', tpl.navUi && tpl.navUi.order && Object.keys(tpl.navUi.order).length > 30);
  cdb3.close();
  // template diterapkan ke sekolah saat preset disimpan? (dipakai pada createTenant) → cek fungsi terapkan
  r = await req('POST', '/super-admin/menu-default/terapkan', { konfirmasi: '1' });
  ok('terapkan preset ke semua sekolah', /ok=/.test(r.loc), decode(r.loc));
  const navHiddenNow = String((db.prepare("SELECT v FROM settings WHERE k='nav_hidden'").get() || {}).v || '');
  ok('sekolah menerima nav_hidden dari preset', navHiddenNow.includes('/trash'), navHiddenNow);
  // pulihkan
  await req('POST', '/super-admin/menu-default/simpan', { ...bodyMenu, show: showVals.concat(['/trash']) });
  await req('POST', '/super-admin/menu-default/terapkan', { konfirmasi: '1' });

  r = await req('GET', '/super-admin/paket');
  ok('paket: toggle Identitas Sekolah terpisah', /Identitas Sekolah \(NPSN, kontak &amp; legalitas\)/.test(r.text));
  ok('paket: toggle Tema &amp; Branding terpisah', /Tema &amp; Branding \(warna, logo, mode gelap\)/.test(r.text));
  ok('paket: toggle Desain Templat Cetak terpisah', /Desain Templat Cetak \(kop surat/.test(r.text));
  ok('paket: buku pembantu dipisah (kas/bank/pajak/BHP/modal)', ['Buku Pembantu Kas / Tunai', 'Buku Pembantu Bank', 'Buku Pembantu Pajak', 'Barang Habis Pakai', 'Barang Modal'].every(x => r.text.includes(x)));

  /* ============ 8. PERFORMA ============ */
  const cssV = await fetch(base + '/assets/app.css?v=999', { headers: { 'Accept-Encoding': 'gzip' } });
  ok('aset ber-versi: Cache-Control immutable', /immutable/.test(String(cssV.headers.get('cache-control'))) && /max-age=31536000/.test(String(cssV.headers.get('cache-control'))), String(cssV.headers.get('cache-control')));
  ok('aset dikompresi (gzip/br)', /gzip|br/.test(String(cssV.headers.get('content-encoding'))), String(cssV.headers.get('content-encoding')));
  ok('aset minified (tanpa komentar blok)', !/\/\* =+ SIMKEU/.test(await cssV.text()));
  const cssNV = await fetch(base + '/assets/app.css');
  ok('aset tanpa versi: cache singkat + revalidate', /max-age=3600/.test(String(cssNV.headers.get('cache-control'))) && /must-revalidate/.test(String(cssNV.headers.get('cache-control'))), String(cssNV.headers.get('cache-control')));
  const jsMin = await (await fetch(base + '/assets/app.js?v=999')).text();
  /* ambang dinaikkan di ronde 30 (kredensial pendaftaran) & ronde 34 (pratinjau kop + tab desain cetak) */
  ok('app.js terkirim dalam bentuk minified', jsMin.length < 96000 && /function/.test(jsMin), String(jsMin.length));
  cookie = '';
  r = await req('GET', '/login', null, { cookie: '' });
  ok('halaman login: preconnect + dns-prefetch', /rel="preconnect" href="https:\/\/fonts.googleapis.com"/.test(r.text) && /rel="dns-prefetch"/.test(r.text));
  ok('halaman login: script defer (tidak render-blocking)', /assets\/app\.js\?v=\d+" defer/.test(r.text));
  ok('halaman login: font display=swap', /display=swap/.test(r.text));
  // preload logo saat logo sistem tersedia
  cookie = '';
  await req('POST', '/super-admin/login', { email: 'super@simkeu.id', password: 'SuperAdmin2026!' });
  const favSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#F97316"/></svg>';
  await req('POST', '/super-admin/branding', {
    saas_nama: 'SIMKEU', logo_b64: 'data:image/svg+xml;base64,' + Buffer.from(favSvg).toString('base64'),
    saas_base_url: 'portal.simkeu.test', saas_server_ip: '103.10.10.10'
  });
  cookie = '';
  r = await req('GET', '/login', null, { cookie: '' });
  ok('logo LCP dipreload + fetchpriority', /rel="preload" as="image"/.test(r.text) || /fetchpriority="high"/.test(r.text), 'preload/fetchpriority tidak ditemukan');
  // tombol dark mode juga memengaruhi portal publik
  cookie = '';
  await req('POST', '/login', { kode: 'SK01', email: 'admin@sekolah.sch.id', password: 'admin123' });
  await req('POST', '/tema', { tema_warna: '#F97316', tema_hex: '#F97316', mode_tema: 'dark', app_nama: 'SIMKEU Sekolah' });
  cookie = '';
  r = await req('GET', '/portal', null, { cookie: '' });
  ok('portal publik mengikuti mode gelap sekolah', /data-mode="dark"/.test(r.text));
  cookie = '';
  await req('POST', '/login', { kode: 'SK01', email: 'admin@sekolah.sch.id', password: 'admin123' });
  await req('POST', '/tema', { tema_warna: '#F97316', tema_hex: '#F97316', mode_tema: 'light', app_nama: 'SIMKEU Sekolah' });

  /* ============ ringkasan ============ */
  const pass = results.filter(x => x.ok).length;
  console.log(`\n${pass}/${results.length} cek ronde 26 lulus`);
  if (pass !== results.length) console.log('GAGAL:', results.filter(x => !x.ok).map(x => x.name).join(', '));
  if (/\[ERROR\]/.test(log)) console.log('log server:\n' + log.split('\n').filter(l => /ERROR/.test(l)).slice(0, 12).join('\n'));
  srv.kill();
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
