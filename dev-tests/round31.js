'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* Ronde 31 — Sinkronisasi judul tab (<title>) & Open Graph pada portal publik
   untuk URL tanpa token dan dengan token (?token=…).

   1. Tanpa token  → "<portal_page_title> · <nama sekolah>"
   2. Tag OG & Twitter (og:title, og:description, og:image, og:url, twitter:title/card) sinkron
   3. Token aktif  → Opsi A: judul sama bila `portal_token_title` kosong
   4. Token aktif  → Opsi B: prefix dari `portal_token_title`, placeholder {judul}
   5. Token palsu  → kembali ke judul biasa + tidak ada noindex
   6. Halaman bertoken: robots noindex,nofollow & og:url tanpa query (token tidak tersebar)
   7. Validasi 60 karakter & tidak ada penyimpanan separuh saat gagal
   8. Default Super Admin (`portal_default_token_title`) dipakai sekolah yang kosong
   9. Tidak ada JS klien yang menimpa document.title
  10. Judul kartu form ikut judul portal (tidak lagi hardcode "Cek Tagihan Iuran")
*/
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'r31-'));
const DB = path.join(TMP, 'k.sqlite');
const SAAS = path.join(TMP, 's.db');
const PORT = 3662;
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
let cookie = '';
async function req(method, url, body, opt = {}) {
  const headers = {};
  if (opt.cookie !== undefined) { if (opt.cookie) headers.Cookie = opt.cookie; }
  else if (cookie) headers.Cookie = cookie;
  let payload = null;
  if (body) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) { if (Array.isArray(v)) v.forEach(x => usp.append(k, x)); else usp.append(k, v); }
    payload = usp.toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc && opt.cookie === undefined) cookie = sc.split(';')[0];
  return { status: r.status, text: await r.text(), loc: r.headers.get('location') || '' };
}
const pageTitle = h => (String(h).match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
const metaOf = (h, prop) => (String(h).match(new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`)) || [])[1] || '';
const hasMeta = (h, prop) => new RegExp(`<meta (?:property|name)="${prop}"`).test(String(h));

(async () => {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  const db = new Database(DB);
  const schoolName = String((db.prepare("SELECT v FROM settings WHERE k='sekolah_nama'").get() || {}).v || '');
  const ta = db.prepare('SELECT * FROM tahun_ajaran ORDER BY id LIMIT 1').get();

  let r = await req('POST', '/login', { kode: 'SK01', email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login admin sekolah', r.status === 303 && !/err=/.test(r.loc), dec(r.loc));

  /* data uji: kelas + siswa dengan tunggakan (untuk token nyata) */
  await req('POST', '/kelas/save', { nama: 'XII AKL 1', tingkat: 'XII', wali_kelas: 'W', aktif: '1' });
  const kelas = db.prepare("SELECT * FROM kelas WHERE nama='XII AKL 1'").get();
  await req('POST', '/siswa/save', {
    nisn: '3131', nama: 'Siswa Judul', jenis_kelamin: 'P', tanggal_lahir: '2008-03-03',
    kelas_id: kelas.id, parent_phone: '081200000031'
  });
  const siswa = db.prepare("SELECT * FROM siswa WHERE nisn='3131'").get();
  await req('POST', '/iuran/save', { nama: 'Iuran SPP', jenis: 'bulanan', mode_nominal: 'rata', nominal_rata: '150000', aktif: '1', tahun_ajaran_id: String(ta.id) });
  const grup = db.prepare("SELECT * FROM iuran_grup WHERE nama='Iuran SPP'").get();
  await req('POST', `/iuran/grup/${grup.id}/tetapkan`, { kelas_id: String(kelas.id), siswa_id: [String(siswa.id)] });

  /* logo sekolah (dipakai og:image) */
  const LOGO = 'https://media.vibecoder.co.id/app-media/logo-uji-31.png';
  db.prepare("UPDATE settings SET v=? WHERE k='sekolah_logo'").run(LOGO);

  const TITLE = 'Kewajiban Iuran';
  const SUB = 'PORTAL IURAN SISWA';
  const save = extra => req('POST', '/sekolah/portal-publik/simpan', Object.assign({
    simpan_publikasi: '1', portal_aktif: '1', portal_pegawai_aktif: '1', portal_slip_aktif: '1',
    portal_page_title: TITLE, portal_subtitle: SUB
  }, extra));
  const SEG = () => ({
    base: String((db.prepare("SELECT v FROM settings WHERE k='portal_base_slug'").get() || {}).v || ''),
    siswa: String((db.prepare("SELECT v FROM settings WHERE k='portal_slug'").get() || {}).v || 'portal-tagihan')
  });
  const PSISWA = () => '/' + SEG().base + '/' + SEG().siswa;
  const reqP = async (url, opt = {}) => {
    let rr = await req('GET', url, null, opt);
    for (let i = 0; i < 3 && [301, 302, 303, 307, 308].includes(rr.status) && rr.loc; i++) {
      rr = await req('GET', rr.loc.replace(/^https?:\/\/[^/]+/, ''), null, opt);
    }
    return rr;
  };
  const tokenOf = async () => {
    const pv = await req('GET', '/iuran/wa/preview?siswa_id=' + siswa.id);
    let json = {}; try { json = JSON.parse(pv.text); } catch (e) { }
    return (String(json.pesan || '').match(/token=([^"&\s]+)/) || [])[1] || '';
  };

  /* ============ 1. TANPA TOKEN ============ */
  let s = await save({});
  ok('simpan judul portal', s.status === 303 && /ok=/.test(s.loc), dec(s.loc));
  r = await reqP(PSISWA(), { cookie: '' });
  ok('portal 200', r.status === 200, String(r.status));
  ok('judul tab = "<judul> · <nama sekolah>"', pageTitle(r.text) === `${TITLE} · ${schoolName}`, pageTitle(r.text));
  ok('og:title sinkron dengan <title>', metaOf(r.text, 'og:title') === `${TITLE} · ${schoolName}`, metaOf(r.text, 'og:title'));
  ok('twitter:title sinkron dengan <title>', metaOf(r.text, 'twitter:title') === `${TITLE} · ${schoolName}`, metaOf(r.text, 'twitter:title'));
  ok('og:description terisi (sub-judul + sekolah)', /PORTAL IURAN SISWA/.test(metaOf(r.text, 'og:description')), metaOf(r.text, 'og:description'));
  ok('twitter:description = og:description', metaOf(r.text, 'twitter:description') === metaOf(r.text, 'og:description'));
  ok('twitter:card tersedia', !!metaOf(r.text, 'twitter:card'), metaOf(r.text, 'twitter:card'));
  ok('og:image memakai logo sekolah', metaOf(r.text, 'og:image') === LOGO, metaOf(r.text, 'og:image'));
  ok('og:type website & og:locale id_ID', metaOf(r.text, 'og:type') === 'website' && metaOf(r.text, 'og:locale') === 'id_ID');
  ok('og:url menunjuk alamat publik portal', new RegExp('/' + SEG().base + '/' + SEG().siswa + '$').test(metaOf(r.text, 'og:url')), metaOf(r.text, 'og:url'));
  ok('halaman publik TIDAK noindex', !hasMeta(r.text, 'robots'));
  ok('judul kartu form ikut judul portal (bukan hardcode)', new RegExp(`<h2>${TITLE}</h2>`).test(r.text));
  ok('nama sekolah tampil di banner', r.text.includes(`<h1 class="school-title">${schoolName}</h1>`));

  /* slug kustom tetap konsisten (contoh prompt: /iuran-siswa-spc) */
  r = await req('POST', '/sekolah/portal-slug', { portal_slug: 'iuran-siswa-spc', portal_pegawai_slug: 'portal-pegawai', portal_slip_slug: 'portal-slip' });
  ok('slug portal diubah ke iuran-siswa-spc', r.status === 303 && /ok=/.test(r.loc), dec(r.loc));
  r = await reqP('/' + SEG().base + '/iuran-siswa-spc', { cookie: '' });
  ok('judul tetap benar pada slug kustom', pageTitle(r.text) === `${TITLE} · ${schoolName}`, pageTitle(r.text));

  /* ============ 2. TOKEN AKTIF — OPSI A (judul sama) ============ */
  const token = await tokenOf();
  ok('token pribadi terbit dari pratinjau WA', token.length > 10, token.slice(0, 12));
  r = await reqP('/' + SEG().base + '/iuran-siswa-spc?token=' + encodeURIComponent(token), { cookie: '' });
  ok('tautan bertoken menampilkan tagihan siswa', r.status === 200 && /Siswa Judul/.test(r.text), String(r.status));
  ok('Opsi A: judul tab SAMA dengan tanpa token', pageTitle(r.text) === `${TITLE} · ${schoolName}`, pageTitle(r.text));
  ok('og:title juga sama pada tautan bertoken', metaOf(r.text, 'og:title') === `${TITLE} · ${schoolName}`, metaOf(r.text, 'og:title'));
  ok('halaman bertoken diberi robots noindex,nofollow', metaOf(r.text, 'robots') === 'noindex,nofollow', metaOf(r.text, 'robots'));
  ok('og:url tautan bertoken TANPA query token', /\/iuran-siswa-spc$/.test(metaOf(r.text, 'og:url')) && !/token=/.test(metaOf(r.text, 'og:url')), metaOf(r.text, 'og:url'));
  ok('token tidak tertulis di <title>', !pageTitle(r.text).includes(token.slice(0, 10)));

  /* ============ 3. TOKEN AKTIF — OPSI B (prefix dinamis) ============ */
  s = await save({ portal_token_title: 'Rincian {judul}' });
  ok('simpan judul bertoken', s.status === 303 && /ok=/.test(s.loc), dec(s.loc));
  r = await reqP('/' + SEG().base + '/iuran-siswa-spc?token=' + encodeURIComponent(token), { cookie: '' });
  ok('Opsi B: placeholder {judul} diganti judul portal', pageTitle(r.text) === `Rincian ${TITLE} · ${schoolName}`, pageTitle(r.text));
  ok('og:title mengikuti judul bertoken', metaOf(r.text, 'og:title') === `Rincian ${TITLE} · ${schoolName}`, metaOf(r.text, 'og:title'));
  r = await reqP('/' + SEG().base + '/iuran-siswa-spc', { cookie: '' });
  ok('URL tanpa token TIDAK memakai prefix token', pageTitle(r.text) === `${TITLE} · ${schoolName}`, pageTitle(r.text));

  /* teks bebas tanpa placeholder */
  await save({ portal_token_title: 'Tagihan Pribadi' });
  r = await reqP('/' + SEG().base + '/iuran-siswa-spc?token=' + encodeURIComponent(token), { cookie: '' });
  ok('judul bertoken boleh teks bebas', pageTitle(r.text) === `Tagihan Pribadi · ${schoolName}`, pageTitle(r.text));

  /* ============ 4. TOKEN PALSU ============ */
  r = await reqP('/' + SEG().base + '/iuran-siswa-spc?token=palsu-token-123', { cookie: '' });
  ok('token palsu → judul kembali ke judul biasa', pageTitle(r.text) === `${TITLE} · ${schoolName}`, pageTitle(r.text));
  ok('token palsu menampilkan form + pesan', /Tautan tagihan tidak valid/.test(r.text));
  ok('token palsu tidak memakai noindex', !hasMeta(r.text, 'robots'));

  /* ============ 5. VALIDASI ============ */
  const before = String((db.prepare("SELECT v FROM settings WHERE k='portal_token_title'").get() || {}).v);
  r = await save({ portal_token_title: 'X'.repeat(61), portal_page_title: 'DIUBAH' });
  ok('judul bertoken > 60 karakter ditolak', /err=/.test(r.loc) && /60 karakter/.test(dec(r.loc)), dec(r.loc));
  ok('validasi gagal tidak menyimpan separuh (judul utama tetap)', String((db.prepare("SELECT v FROM settings WHERE k='portal_page_title'").get() || {}).v) === TITLE);
  ok('validasi gagal tidak mengubah judul bertoken', String((db.prepare("SELECT v FROM settings WHERE k='portal_token_title'").get() || {}).v) === before);

  /* ============ 6. DEFAULT SUPER ADMIN ============ */
  cookie = '';
  r = await req('POST', '/super-admin/login', { email: 'super@simkeu.id', password: 'SuperAdmin2026!' });
  ok('login Super Admin', r.status === 303 && !/err=/.test(r.loc), r.loc);
  r = await req('GET', '/super-admin/branding');
  ok('form branding punya isian default judul bertoken',
    /name="portal_default_token_title"/.test(r.text) && /maxlength="60"/.test(r.text));
  await req('POST', '/super-admin/branding', { saas_nama: 'SIMKEU', portal_default_token_title: 'Rincian {judul}' });
  cookie = '';
  await req('POST', '/login', { kode: 'SK01', email: 'admin@sekolah.sch.id', password: 'admin123' });
  await save({ portal_token_title: '' });
  r = await reqP('/' + SEG().base + '/iuran-siswa-spc?token=' + encodeURIComponent(token), { cookie: '' });
  ok('sekolah kosong → memakai default Super Admin', pageTitle(r.text) === `Rincian ${TITLE} · ${schoolName}`, pageTitle(r.text));
  r = await reqP('/' + SEG().base + '/iuran-siswa-spc', { cookie: '' });
  ok('default Super Admin hanya untuk tautan bertoken', pageTitle(r.text) === `${TITLE} · ${schoolName}`, pageTitle(r.text));

  /* ============ 7. PANEL TENANT ============ */
  r = await req('GET', '/portal-publik');
  ok('form tenant punya isian judul bertoken', /name="portal_token_title"/.test(r.text) && /maxlength="60"/.test(r.text));
  ok('pratinjau judul bertoken tampil', /data-pv-token/.test(r.text) && /data-pv-tokentab/.test(r.text));
  ok('hint placeholder {judul} dijelaskan', /\{judul\}/.test(r.text));
  r = await req('GET', '/audit?mod=sekolah');
  ok('audit mencatat judul bertoken', /judul bertoken/.test(r.text));

  /* ============ 8. TIDAK ADA JS YANG MENIMPA document.title ============ */
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  ok('public/app.js tidak menulis document.title', !/document\.title\s*=/.test(appJs), (appJs.match(/document\.title[^\n]*/) || ['-'])[0]);
  const portalJs = fs.readFileSync(path.join(__dirname, '..', 'routes', 'portal.js'), 'utf8');
  ok('tidak ada judul hardcode "Tagihan Siswa" di route portal', !/'Tagihan Siswa'/.test(portalJs));
  ok('judul tab dibangun dari satu helper (portalTitleFull)', /portalTitleFull/.test(portalJs));
  ok('helper judul tersedia di saas', typeof require(path.join(__dirname, '..', 'saas_extra')) === 'function');

  /* ============ ringkasan ============ */
  try { db.close(); } catch (e) { }
  srv.kill();
  const pass = results.filter(x => x.ok).length;
  console.log(`\nround31: ${pass}/${results.length} cek lulus`);
  if (pass !== results.length) {
    console.log('GAGAL:', results.filter(x => !x.ok).map(x => x.name).join(' | '));
    console.log('LOG SERVER:\n' + log.split('\n').slice(-20).join('\n'));
  }
  setTimeout(() => process.exit(pass === results.length ? 0 : 1), 300);
})().catch(e => { console.error(e); console.log(log.split('\n').slice(-15).join('\n')); srv.kill(); process.exit(1); });
