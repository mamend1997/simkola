'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* Ronde 32 — Menghapus alamat bawaan /portal setelah sekolah memakai slug kustom.

   1. Slug masih "portal" + mode auto  → /portal tetap dilayani (200)
   2. Slug kustom + mode auto          → /portal 404 "alamat sudah tidak digunakan",
                                         berisi tautan ke alamat kustom yang aktif
   3. Alamat kustom tetap 200 (+ sub-route autocomplete & kirim catatan)
   4. Mode 'on'  → /portal dilayani kembali (tautan lama)
   5. Mode 'off' → /portal 404 walau slug masih "portal"
   6. Portal pegawai & slip TIDAK terpengaruh
   7. Tautan bertoken (?token=) tetap bekerja di alamat kustom
   8. Super Admin menyembunyikan seluruh portal tetap menang (prioritas status pusat)
   9. UI tenant menampilkan status & menyimpan mode; audit mencatatnya
  10. Login pengguna sekolah tidak bisa membuka /portal juga (404)
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

(async () => {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  const db = new Database(DB);
  const ctl = new Database(SAAS);
  const schoolName = String((db.prepare("SELECT v FROM settings WHERE k='sekolah_nama'").get() || {}).v || '');
  const ta = db.prepare('SELECT * FROM tahun_ajaran ORDER BY id LIMIT 1').get();

  let r = await req('POST', '/login', { kode: 'SK01', email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login admin sekolah', r.status === 303 && !/err=/.test(r.loc), dec(r.loc));

  /* data uji: kelas + siswa + iuran (untuk tautan bertoken) */
  await req('POST', '/kelas/save', { nama: 'XII RPL 1', tingkat: 'XII', wali_kelas: 'W', aktif: '1' });
  const kelas = db.prepare("SELECT * FROM kelas WHERE nama='XII RPL 1'").get();
  await req('POST', '/siswa/save', { nisn: '3232', nama: 'Siswa Alias', jenis_kelamin: 'L', tanggal_lahir: '2008-04-04', kelas_id: kelas.id, parent_phone: '081200000032' });
  const siswa = db.prepare("SELECT * FROM siswa WHERE nisn='3232'").get();
  await req('POST', '/iuran/save', { nama: 'Iuran SPP', jenis: 'bulanan', mode_nominal: 'rata', nominal_rata: '100000', aktif: '1', tahun_ajaran_id: String(ta.id) });
  const grup = db.prepare("SELECT * FROM iuran_grup WHERE nama='Iuran SPP'").get();
  await req('POST', `/iuran/grup/${grup.id}/tetapkan`, { kelas_id: String(kelas.id), siswa_id: [String(siswa.id)] });

  /* ============ 1. slug DEFAULT + auto → /portal dilayani ============ */
  r = await req('POST', '/sekolah/portal-slug', { portal_slug: 'portal', portal_pegawai_slug: 'portal-pegawai', portal_slip_slug: 'portal-slip', portal_default_alias: 'auto' });
  ok('simpan slug default + mode auto', r.status === 303 && /ok=/.test(r.loc), dec(r.loc));
  r = await req('GET', '/portal', null, { cookie: '' });
  ok('slug "portal" → /portal 200', r.status === 200 && /portal-head/.test(r.text), String(r.status));

  /* ============ 2. slug KUSTOM + auto → /portal 404 ============ */
  r = await req('POST', '/sekolah/portal-slug', { portal_slug: 'iuran-siswa-spc', portal_pegawai_slug: 'piutang-pegawai-spc', portal_slip_slug: 'slip-honor-spc', portal_default_alias: 'auto' });
  ok('slug kustom tersimpan', r.status === 303 && /ok=/.test(r.loc), dec(r.loc));
  ok('flash menyebut alamat bawaan tidak dipakai', /tidak dipakai/i.test(dec(r.loc)) && /iuran-siswa-spc/.test(dec(r.loc)), dec(r.loc));
  r = await req('GET', '/portal', null, { cookie: '' });
  ok('/portal (alamat bawaan) sekarang 404', r.status === 404, String(r.status));
  ok('halaman 404 menyebut alamat sudah tidak digunakan', /sudah tidak digunakan/i.test(r.text));
  ok('halaman 404 memuat tautan ke alamat kustom', /href="[^"]*\/iuran-siswa-spc"/.test(r.text), (r.text.match(/href="[^"]*iuran-siswa-spc"/) || ['-'])[0]);
  ok('halaman 404 ber-branding sekolah', r.text.includes(schoolName));
  ok('halaman 404 noindex', /name="robots" content="noindex"/.test(r.text));
  r = await req('GET', '/portal/', null, { cookie: '' });
  ok('/portal/ (dengan garis miring) juga 404', r.status === 404, String(r.status));
  r = await req('GET', '/portal/siswa?q=sis', null, { cookie: '' });
  ok('sub-route internal /portal/siswa ikut ditutup', r.status === 404, String(r.status));

  /* ============ 3. alamat kustom tetap berfungsi ============ */
  r = await req('GET', '/iuran-siswa-spc', null, { cookie: '' });
  ok('alamat kustom 200', r.status === 200 && /portal-head/.test(r.text), String(r.status));
  ok('judul tab memakai nama sekolah', pageTitle(r.text).endsWith(`· ${schoolName}`), pageTitle(r.text));
  r = await req('GET', '/iuran-siswa-spc/siswa?q=sis', null, { cookie: '' });
  ok('autocomplete lewat alamat kustom tetap jalan', r.status === 200 && /Siswa Alias/.test(r.text), String(r.status) + ' ' + r.text.slice(0, 80));
  r = await req('POST', '/iuran-siswa-spc/pesan', { siswa_id: String(siswa.id), pesan: 'Catatan uji alamat kustom', kontak: '0812' }, { cookie: '' });
  ok('kirim catatan lewat alamat kustom diterima', r.status === 303 && /ok=/.test(r.loc), dec(r.loc).slice(0, 120));
  ok('catatan tersimpan', db.prepare("SELECT COUNT(*) c FROM portal_pesan WHERE pesan LIKE 'Catatan uji alamat kustom%'").get().c >= 1);

  /* token pribadi tetap jalan */
  const pv = await req('GET', '/iuran/wa/preview?siswa_id=' + siswa.id);
  const token = (String((JSON.parse(pv.text) || {}).pesan || '').match(/token=([^"&\s]+)/) || [])[1] || '';
  ok('token pribadi terbit', token.length > 10, token.slice(0, 12));
  r = await req('GET', '/iuran-siswa-spc?token=' + encodeURIComponent(token), null, { cookie: '' });
  ok('tautan bertoken di alamat kustom 200 & menampilkan siswa', r.status === 200 && /Siswa Alias/.test(r.text), String(r.status));
  r = await req('GET', '/portal?token=' + encodeURIComponent(token), null, { cookie: '' });
  ok('tautan bertoken lewat /portal juga 404', r.status === 404, String(r.status));

  /* ============ 4. portal pegawai & slip tidak terpengaruh ============ */
  const pPeg = await req('GET', '/piutang-pegawai-spc', null, { cookie: '' });
  ok('portal piutang pegawai (alamat kustom) tetap 200', pPeg.status === 200, String(pPeg.status));
  const pSlip = await req('GET', '/slip-honor-spc', null, { cookie: '' });
  ok('portal slip gaji (alamat kustom) tetap 200', pSlip.status === 200, String(pSlip.status));
  ok('alamat bawaan /portal-pegawai tetap 200', (await req('GET', '/portal-pegawai', null, { cookie: '' })).status === 200);
  ok('alamat bawaan /portal-slip tetap 200', (await req('GET', '/portal-slip', null, { cookie: '' })).status === 200);

  /* ============ 5. mode 'on' → alamat bawaan hidup lagi ============ */
  r = await req('POST', '/sekolah/portal-slug', { portal_slug: 'iuran-siswa-spc', portal_pegawai_slug: 'piutang-pegawai-spc', portal_slip_slug: 'slip-honor-spc', portal_default_alias: 'on' });
  ok('mode "on" tersimpan', r.status === 303 && /ok=/.test(r.loc), dec(r.loc));
  r = await req('GET', '/portal', null, { cookie: '' });
  ok('mode "on" → /portal 200 kembali', r.status === 200 && /portal-head/.test(r.text), String(r.status));
  ok('audit mencatat status alamat bawaan', /alamat bawaan \/portal aktif/i.test(
    String((db.prepare("SELECT detail FROM audit WHERE aksi='EDIT' ORDER BY id DESC LIMIT 1").get() || {}).detail)));

  /* ============ 6. mode 'off' → 404 walau slug default ============ */
  r = await req('POST', '/sekolah/portal-slug', { portal_slug: 'portal', portal_pegawai_slug: 'portal-pegawai', portal_slip_slug: 'portal-slip', portal_default_alias: 'off' });
  ok('mode "off" + slug default tersimpan', r.status === 303 && /ok=/.test(r.loc), dec(r.loc));
  r = await req('GET', '/portal', null, { cookie: '' });
  ok('mode "off" → /portal 404 walau slug "portal"', r.status === 404, String(r.status));
  ok('pesan 404 mengarahkan ke alamat kustom', /\/portal"/.test(r.text) || /href="[^"]*\/portal"/.test(r.text));
  r = await req('POST', '/sekolah/portal-slug', { portal_slug: 'iuran-siswa-spc', portal_pegawai_slug: 'piutang-pegawai-spc', portal_slip_slug: 'slip-honor-spc', portal_default_alias: 'auto' });
  r = await req('GET', '/iuran-siswa-spc', null, { cookie: '' });
  ok('kembali ke mode auto + slug kustom → alamat kustom 200', r.status === 200, String(r.status));

  /* ============ 7. pengguna sekolah (login) juga tidak bisa membuka /portal ============ */
  r = await req('GET', '/portal');
  ok('login pengguna sekolah: /portal 404', r.status === 404 && /sudah tidak digunakan/i.test(r.text), String(r.status));
  r = await req('GET', '/iuran-siswa-spc');
  ok('login pengguna sekolah: alamat kustom 200', r.status === 200, String(r.status));
  r = await req('GET', '/portal-publik');
  ok('halaman pengaturan tetap dapat dibuka pengguna sekolah', r.status === 200, String(r.status));

  /* ============ 8. prioritas status Super Admin ============ */
  cookie = '';
  await req('POST', '/super-admin/login', { email: 'super@simkeu.id', password: 'SuperAdmin2026!' });
  await req('POST', '/super-admin/portal-publik/1/status', { status: 'nonaktif', note: 'uji ronde 32' });
  r = await req('GET', '/iuran-siswa-spc', null, { cookie: '' });
  ok('Super Admin nonaktif → alamat kustom 404 (menang atas setelan sekolah)', r.status === 404 && /Administrator Pusat/.test(r.text), String(r.status));
  r = await req('GET', '/portal', null, { cookie: '' });
  ok('/portal tetap 404 saat portal diblokir pusat', r.status === 404, String(r.status));
  await req('POST', '/super-admin/portal-publik/1/status', { status: 'aktif' });
  r = await req('GET', '/iuran-siswa-spc', null, { cookie: '' });
  ok('setelah diaktifkan lagi → alamat kustom 200', r.status === 200, String(r.status));

  /* ============ 9. UI tenant ============ */
  cookie = '';
  await req('POST', '/login', { kode: 'SK01', email: 'admin@sekolah.sch.id', password: 'admin123' });
  r = await req('GET', '/portal-publik');
  ok('form tenant punya pilihan alamat bawaan', /name="portal_default_alias"/.test(r.text));
  ok('tiga mode tersedia (auto/on/off)', /value="auto"/.test(r.text) && /value="on"/.test(r.text) && /value="off"/.test(r.text));
  ok('menampilkan status alamat bawaan saat ini', /Saat ini:/.test(r.text) && /nonaktif/.test(r.text), (r.text.match(/Saat ini:[^<]*/) || ['-'])[0]);
  ok('menampilkan alamat portal yang berlaku', r.text.includes('/iuran-siswa-spc'));

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
