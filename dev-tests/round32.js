'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* Ronde 32 / 43 — Alamat portal publik HARUS lengkap: /<nama-sekolah>/<sub-slug>.

   1. /portal, /portal-pegawai, /portal-slip, /<nama-sekolah> → DIALIHKAN (302)
      ke alamat lengkap yang sah (tidak pernah melayani halaman portal langsung)
   2. Alamat lengkap /<nama-sekolah>/<sub-slug> → 200 (termasuk sub-route & token)
   3. Sub-slug dapat diubah sekolah; alamat lama /<nama-sekolah>/portal juga dialihkan
   4. Mode 'off' → alamat lama ditolak 404 (halaman "alamat sudah tidak digunakan")
   5. Login pengguna sekolah juga dialihkan (tidak dilayani di alamat lama)
   6. Super Admin menyembunyikan portal → alamat lengkap 404 (prioritas status pusat)
   7. UI tenant menampilkan alamat lengkap & mode alamat lama
*/
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'r32-'));
const DB = path.join(TMP, 'k.sqlite');
const SAAS = path.join(TMP, 's.db');
const PORT = 3664;
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
const isRedirect = r => [301, 302, 303, 307, 308].includes(r.status);
async function reqFollow(method, url, body, opt = {}) {
  let r = await req(method, url, body, opt);
  for (let i = 0; i < 3 && isRedirect(r) && r.loc; i++) r = await req('GET', r.loc.replace(/^https?:\/\/[^/]+/, ''), null, opt);
  return r;
}
/** alamat portal lengkap: /<nama-sekolah>/<sub-slug> */
const P = seg => '/' + BASE_SEG + '/' + seg;
let BASE_SEG = '';

(async () => {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  const db = new Database(DB);
  const ctl = new Database(SAAS);
  const schoolName = String((db.prepare("SELECT v FROM settings WHERE k='sekolah_nama'").get() || {}).v || '');
  const ta = db.prepare('SELECT * FROM tahun_ajaran ORDER BY id LIMIT 1').get();

  let r = await req('POST', '/login', { kode: 'SK01', email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login admin sekolah', r.status === 303 && !/err=/.test(r.loc), dec(r.loc));
  BASE_SEG = String((db.prepare("SELECT v FROM settings WHERE k='portal_base_slug'").get() || {}).v || '');
  ok('bagian nama sekolah pada alamat portal terisi otomatis', BASE_SEG.length > 2, BASE_SEG);

  /* data uji: kelas + siswa + iuran (untuk tautan bertoken) */
  await req('POST', '/kelas/save', { nama: 'XII RPL 1', tingkat: 'XII', wali_kelas: 'W', aktif: '1' });
  const kelas = db.prepare("SELECT * FROM kelas WHERE nama='XII RPL 1'").get();
  await req('POST', '/siswa/save', { nisn: '3232', nama: 'Siswa Alias', jenis_kelamin: 'L', tanggal_lahir: '2008-04-04', kelas_id: kelas.id, parent_phone: '081200000032' });
  const siswa = db.prepare("SELECT * FROM siswa WHERE nisn='3232'").get();
  await req('POST', '/iuran/save', { nama: 'Iuran SPP', jenis: 'bulanan', mode_nominal: 'rata', nominal_rata: '100000', aktif: '1', tahun_ajaran_id: String(ta.id) });
  const grup = db.prepare("SELECT * FROM iuran_grup WHERE nama='Iuran SPP'").get();
  await req('POST', `/iuran/grup/${grup.id}/tetapkan`, { kelas_id: String(kelas.id), siswa_id: [String(siswa.id)] });

  /* ============ 1. slug DEFAULT + auto → /portal dilayani ============ */
  r = await req('POST', '/sekolah/portal-slug', { portal_slug: 'portal-tagihan', portal_pegawai_slug: 'portal-pegawai', portal_slip_slug: 'portal-slip', portal_default_alias: 'auto' });
  ok('simpan sub-slug default + mode auto', r.status === 303 && /ok=/.test(r.loc), dec(r.loc));
  r = await req('GET', '/portal', null, { cookie: '' });
  ok('/portal dialihkan ke alamat lengkap', isRedirect(r) && dec(r.loc).endsWith(P('portal-tagihan')), String(r.status) + ' ' + dec(r.loc));
  r = await reqFollow('GET', '/portal', null, { cookie: '' });
  ok('alamat lengkap /<nama-sekolah>/portal-tagihan 200', r.status === 200 && /portal-head/.test(r.text), String(r.status));
  r = await req('GET', '/' + BASE_SEG, null, { cookie: '' });
  ok('/<nama-sekolah> saja dialihkan ke portal tagihan', isRedirect(r) && dec(r.loc).endsWith(P('portal-tagihan')), String(r.status) + ' ' + dec(r.loc));

  /* ============ 2. slug KUSTOM + auto → /portal 404 ============ */
  r = await req('POST', '/sekolah/portal-slug', { portal_slug: 'iuran-siswa-spc', portal_pegawai_slug: 'piutang-pegawai-spc', portal_slip_slug: 'slip-honor-spc', portal_default_alias: 'auto' });
  ok('slug kustom tersimpan', r.status === 303 && /ok=/.test(r.loc), dec(r.loc));
  ok('flash menyebut alamat lengkap portal', /iuran-siswa-spc/.test(dec(r.loc)), dec(r.loc));
  r = await req('GET', '/portal', null, { cookie: '' });
  ok('/portal tetap dialihkan ke sub-slug baru', isRedirect(r) && dec(r.loc).endsWith(P('iuran-siswa-spc')), String(r.status) + ' ' + dec(r.loc));
  r = await req('GET', '/portal/', null, { cookie: '' });
  ok('/portal/ (dengan garis miring) juga dialihkan', isRedirect(r) && dec(r.loc).endsWith(P('iuran-siswa-spc')), String(r.status));
  r = await req('GET', '/portal/siswa?q=sis', null, { cookie: '' });
  ok('sub-route internal /portal/siswa dialihkan ke alamat lengkap', isRedirect(r) && dec(r.loc).includes(P('iuran-siswa-spc') + '/siswa'), String(r.status) + ' ' + dec(r.loc));
  r = await req('GET', '/' + BASE_SEG + '/portal', null, { cookie: '' });
  ok('alamat lama /<nama-sekolah>/portal dialihkan', isRedirect(r) && dec(r.loc).endsWith(P('iuran-siswa-spc')), String(r.status) + ' ' + dec(r.loc));

  /* ============ 3. alamat kustom tetap berfungsi ============ */
  r = await req('GET', P('iuran-siswa-spc'), null, { cookie: '' });
  ok('alamat kustom lengkap 200', r.status === 200 && /portal-head/.test(r.text), String(r.status));
  ok('judul tab memakai nama sekolah', pageTitle(r.text).endsWith(`· ${schoolName}`), pageTitle(r.text));
  r = await req('GET', P('iuran-siswa-spc') + '/siswa?q=sis', null, { cookie: '' });
  ok('autocomplete lewat alamat kustom tetap jalan', r.status === 200 && /Siswa Alias/.test(r.text), String(r.status) + ' ' + r.text.slice(0, 80));
  r = await req('POST', P('iuran-siswa-spc') + '/pesan', { siswa_id: String(siswa.id), pesan: 'Catatan uji alamat kustom', kontak: '0812' }, { cookie: '' });
  ok('kirim catatan lewat alamat kustom diterima', r.status === 303 && /ok=/.test(r.loc), dec(r.loc).slice(0, 120));
  ok('catatan tersimpan', db.prepare("SELECT COUNT(*) c FROM portal_pesan WHERE pesan LIKE 'Catatan uji alamat kustom%'").get().c >= 1);

  /* token pribadi tetap jalan */
  const pv = await req('GET', '/iuran/wa/preview?siswa_id=' + siswa.id);
  const token = (String((JSON.parse(pv.text) || {}).pesan || '').match(/token=([^"&\s]+)/) || [])[1] || '';
  ok('token pribadi terbit', token.length > 10, token.slice(0, 12));
  r = await req('GET', P('iuran-siswa-spc') + '?token=' + encodeURIComponent(token), null, { cookie: '' });
  ok('tautan bertoken di alamat lengkap 200 & menampilkan siswa', r.status === 200 && /Siswa Alias/.test(r.text), String(r.status));
  r = await req('GET', '/portal?token=' + encodeURIComponent(token), null, { cookie: '' });
  ok('tautan bertoken lewat /portal dialihkan', isRedirect(r) && /token=/.test(r.loc), String(r.status) + ' ' + dec(r.loc).slice(0, 90));

  /* ============ 4. portal pegawai & slip tidak terpengaruh ============ */
  const pPeg = await req('GET', P('piutang-pegawai-spc'), null, { cookie: '' });
  ok('portal piutang pegawai (alamat lengkap) 200', pPeg.status === 200, String(pPeg.status));
  const pSlip = await req('GET', P('slip-honor-spc'), null, { cookie: '' });
  ok('portal slip gaji (alamat lengkap) 200', pSlip.status === 200, String(pSlip.status));
  ok('/portal-pegawai dialihkan ke alamat lengkap', isRedirect(await req('GET', '/portal-pegawai', null, { cookie: '' })));
  ok('/portal-slip dialihkan ke alamat lengkap', isRedirect(await req('GET', '/portal-slip', null, { cookie: '' })));

  /* ============ 5. mode 'on' → alamat bawaan hidup lagi ============ */
  r = await req('POST', '/sekolah/portal-slug', { portal_slug: 'iuran-siswa-spc', portal_pegawai_slug: 'piutang-pegawai-spc', portal_slip_slug: 'slip-honor-spc', portal_default_alias: 'on' });
  ok('mode "on" tersimpan', r.status === 303 && /ok=/.test(r.loc), dec(r.loc));
  r = await req('GET', '/portal', null, { cookie: '' });
  ok('mode "on" → /portal tetap dialihkan ke alamat lengkap', isRedirect(r) && dec(r.loc).endsWith(P('iuran-siswa-spc')), String(r.status));
  ok('audit mencatat status alamat bawaan', /alamat bawaan \/portal aktif/i.test(
    String((db.prepare("SELECT detail FROM audit WHERE aksi='EDIT' ORDER BY id DESC LIMIT 1").get() || {}).detail)));

  /* ============ 6. mode 'off' → 404 walau slug default ============ */
  r = await req('POST', '/sekolah/portal-slug', { portal_slug: 'portal-tagihan', portal_pegawai_slug: 'portal-pegawai', portal_slip_slug: 'portal-slip', portal_default_alias: 'off' });
  ok('mode "off" + sub-slug default tersimpan', r.status === 303 && /ok=/.test(r.loc), dec(r.loc));
  r = await req('GET', '/portal', null, { cookie: '' });
  ok('mode "off" → /portal 404 walau slug "portal"', r.status === 404, String(r.status));
  ok('halaman 404 mengarahkan ke alamat lengkap', /sudah tidak digunakan/i.test(r.text) && new RegExp('/' + BASE_SEG + '/portal-tagihan').test(r.text));
  r = await req('POST', '/sekolah/portal-slug', { portal_slug: 'iuran-siswa-spc', portal_pegawai_slug: 'piutang-pegawai-spc', portal_slip_slug: 'slip-honor-spc', portal_default_alias: 'auto' });
  r = await req('GET', P('iuran-siswa-spc'), null, { cookie: '' });
  ok('kembali ke mode auto + slug kustom → alamat lengkap 200', r.status === 200, String(r.status));

  /* ============ 7. pengguna sekolah (login) juga tidak bisa membuka /portal ============ */
  r = await req('GET', '/portal');
  ok('login pengguna sekolah: /portal dialihkan ke alamat lengkap', isRedirect(r) && dec(r.loc).endsWith(P('iuran-siswa-spc')), String(r.status) + ' ' + dec(r.loc));
  r = await req('GET', P('iuran-siswa-spc'));
  ok('login pengguna sekolah: alamat lengkap 200', r.status === 200, String(r.status));
  r = await req('GET', '/portal-publik');
  ok('halaman pengaturan tetap dapat dibuka pengguna sekolah', r.status === 200, String(r.status));

  /* ============ 8. prioritas status Super Admin ============ */
  cookie = '';
  await req('POST', '/super-admin/login', { email: 'super@simkeu.id', password: 'SuperAdmin2026!' });
  await req('POST', '/super-admin/portal-publik/1/status', { status: 'nonaktif', note: 'uji ronde 32' });
  r = await req('GET', P('iuran-siswa-spc'), null, { cookie: '' });
  ok('Super Admin nonaktif → alamat lengkap 404 (menang atas setelan sekolah)', r.status === 404 && /Administrator Pusat/.test(r.text), String(r.status));
  r = await req('GET', '/portal', null, { cookie: '' });
  ok('/portal juga dialihkan walau portal diblokir pusat', isRedirect(r), String(r.status));
  await req('POST', '/super-admin/portal-publik/1/status', { status: 'aktif' });
  r = await req('GET', P('iuran-siswa-spc'), null, { cookie: '' });
  ok('setelah diaktifkan lagi → alamat lengkap 200', r.status === 200, String(r.status));

  /* ============ 9. UI tenant ============ */
  cookie = '';
  await req('POST', '/login', { kode: 'SK01', email: 'admin@sekolah.sch.id', password: 'admin123' });
  r = await req('GET', '/portal-publik');
  ok('form tenant punya pilihan alamat lama', /name="portal_default_alias"/.test(r.text));
  ok('tiga mode tersedia (auto/on/off)', /value="auto"/.test(r.text) && /value="on"/.test(r.text) && /value="off"/.test(r.text));
  ok('menampilkan status alamat lama saat ini', /Saat ini:/.test(r.text), (r.text.match(/Saat ini:[^<]*/) || ['-'])[0]);
  ok('menampilkan alamat lengkap portal yang berlaku', r.text.includes('/' + BASE_SEG + '/iuran-siswa-spc'));
  ok('sakelar portal tagihan siswa berlabel "Portal Tagihan Siswa"', /Portal Tagihan Siswa/.test(r.text));

  /* ============ ringkasan ============ */
  try { db.close(); ctl.close(); } catch (e) { }
  srv.kill();
  const pass = results.filter(x => x.ok).length;
  console.log(`\nround32: ${pass}/${results.length} cek lulus`);
  if (pass !== results.length) {
    console.log('GAGAL:', results.filter(x => !x.ok).map(x => x.name).join(' | '));
    console.log('LOG SERVER:\n' + log.split('\n').slice(-20).join('\n'));
  }
  setTimeout(() => process.exit(pass === results.length ? 0 : 1), 300);
})().catch(e => { console.error(e); console.log(log.split('\n').slice(-15).join('\n')); srv.kill(); process.exit(1); });
