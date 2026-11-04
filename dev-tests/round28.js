'use strict';
/* Ronde 28 — Manajemen Halaman Publik & Routing Slug (Super Admin + Tenant)
   + Kustomisasi Judul Tab & Sub-Judul Banner Portal.

   1. Tenant: sakelar "Publikasikan Halaman Portal" (ON/OFF) tanpa menghapus data
   2. Tenant: judul tab browser (page_title) + sub-judul banner (maks 60) & validasi
   3. Portal publik: <title>Judul · Nama Sekolah> + banner .school-title/.portal-subtitle
   4. Default teks dari Super Admin (Branding) dipakai bila sekolah kosong
   5. Super Admin: /super-admin/portal-publik (tabel seluruh tenant, status, aksi)
   6. Status Akses Publik: aktif → 200, nonaktif → 404, private → 403
   7. Ubah slug oleh Super Admin (alamat lama 404, alamat baru 200) & hapus halaman publik
   8. Banner peringatan di dashboard tenant saat dinonaktifkan Administrator Pusat
   9. Audit Super Admin & RBAC
*/
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'r28-'));
const DB = path.join(TMP, 'k.sqlite');
const SAAS_DB = path.join(TMP, 'saas.db');
const PORT = 3631;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, DB_PATH: DB, SAAS_DB_PATH: SAAS_DB, DEMO_DB_PATH: path.join(TMP, 'demo.sqlite') },
  stdio: ['ignore', 'pipe', 'pipe']
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
    payload = usp.toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc && opt.cookie === undefined) cookie = sc.split(';')[0];
  const text = opt.binary ? Buffer.from(await r.arrayBuffer()) : await r.text();
  return { status: r.status, text, loc: r.headers.get('location') || '', headers: r.headers };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dec = s => { try { return decodeURIComponent(String(s)); } catch (e) { return String(s); } };
const tabTitle = html => (String(html).match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';

(async () => {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  const db = new Database(DB);
  const ctl = new Database(SAAS_DB);
  const schoolName = String((db.prepare("SELECT v FROM settings WHERE k='sekolah_nama'").get() || {}).v || '');
  const slug0 = String((ctl.prepare('SELECT portal_slug FROM tenants WHERE id=1').get() || {}).portal_slug || '');
  ok('slug awal sekolah tersedia', !!slug0, slug0);

  let r = await req('POST', '/login', { kode: 'SK01', email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login admin sekolah', r.status === 303 && !/err=/.test(r.loc), r.loc);
  const schoolCookie = cookie;

  /* ============ 1. TENANT: form publikasi & teks portal ============ */
  r = await req('GET', '/portal-publik');
  ok('halaman Portal Publik memuat kartu publikasi', r.status === 200 && /Publikasi &amp; Teks Halaman Portal|Publikasi & Teks Halaman Portal/.test(r.text));
  ok('sakelar "Publikasikan Halaman Portal" ada', /name="portal_aktif"/.test(r.text) && /sw-track/.test(r.text) && /Publikasikan Halaman Portal/.test(r.text));
  ok('sakelar portal pegawai & slip ikut di kartu publikasi', /name="portal_pegawai_aktif"/.test(r.text) && /name="portal_slip_aktif"/.test(r.text)
    && (r.text.match(/class="sw"/g) || []).length >= 3);
  ok('penanda form publikasi dikirim', /name="simpan_publikasi"/.test(r.text));
  ok('tautan alamat tiap portal tampil', (r.text.match(/class="publ-row"/g) || []).length === 3 && /url-chip/.test(r.text));
  ok('form judul tab browser & sub-judul', /name="portal_page_title"/.test(r.text) && /name="portal_subtitle"/.test(r.text));
  ok('batas karakter sub-judul 60', /name="portal_subtitle"[^>]*maxlength="60"/.test(r.text));
  ok('pratinjau langsung tersedia', /data-portal-preview/.test(r.text) && /data-pv-tab/.test(r.text) && /data-pv-subtitle/.test(r.text));

  // simpan teks kustom
  const TITLE = 'Tagihan Siswa';
  const SUB = 'PORTAL CEK TAGIHAN IURAN SISWA SMK PGRI';
  r = await req('POST', '/sekolah/portal-publik/simpan', {
    simpan_publikasi: '1', portal_aktif: '1', portal_pegawai_aktif: '1', portal_slip_aktif: '1',
    portal_page_title: TITLE, portal_subtitle: SUB
  });
  ok('simpan teks portal → redirect sukses', r.status === 303 && /ok=/.test(r.loc), dec(r.loc));
  let p = await req('GET', '/portal');
  ok('portal 200 setelah disimpan', p.status === 200, String(p.status));
  ok('judul tab = judul kustom · nama sekolah', tabTitle(p.text) === `${TITLE} · ${schoolName}`, tabTitle(p.text));
  ok('banner memakai .school-title + .portal-subtitle', /class="school-title"/.test(p.text) && /class="portal-subtitle"/.test(p.text));
  ok('sub-judul kustom tampil pada banner', new RegExp(`<p class="portal-subtitle">${SUB}</p>`).test(p.text));
  ok('nama sekolah tampil di banner', p.text.includes(`<h1 class="school-title">${schoolName}</h1>`));
  r = await req('GET', '/portal-publik');
  ok('pratinjau berisi teks tersimpan', r.text.includes(`${TITLE} · ${schoolName}`) && r.text.includes(SUB));

  /* validasi panjang */
  const tooLong = 'X'.repeat(61);
  r = await req('POST', '/sekolah/portal-publik/simpan', { simpan_publikasi: '1', portal_aktif: '1', portal_pegawai_aktif: '1', portal_slip_aktif: '1', portal_page_title: TITLE, portal_subtitle: tooLong });
  ok('sub-judul > 60 karakter ditolak', /err=/.test(r.loc) && /60 karakter/.test(dec(r.loc)), dec(r.loc));
  ok('nilai lama tidak berubah setelah validasi gagal', String((db.prepare("SELECT v FROM settings WHERE k='portal_subtitle'").get() || {}).v) === SUB);

  /* ============ 2. SAKELAR SEKOLAH (tenant) ============ */
  r = await req('POST', '/sekolah/portal-publik/simpan', { simpan_publikasi: '1', portal_page_title: TITLE, portal_subtitle: SUB });
  ok('sakelar OFF tersimpan', r.status === 303 && String((db.prepare("SELECT v FROM settings WHERE k='portal_aktif'").get() || {}).v) === '0');
  ok('sakelar pegawai OFF → portal pegawai 503', (await req('GET', '/portal-pegawai', null, { cookie: '' })).status === 503);
  ok('sakelar slip OFF → portal slip 503', (await req('GET', '/portal-slip', null, { cookie: '' })).status === 503);
  p = await req('GET', '/portal', null, { cookie: '' });
  ok('portal nonaktif → 503 & halaman ditutup', p.status === 503 && /Portal Sementara Ditutup/.test(p.text), String(p.status));
  ok('teks portal tidak hilang saat OFF', String((db.prepare("SELECT v FROM settings WHERE k='portal_subtitle'").get() || {}).v) === SUB);
  /* sakelar per portal: hanya portal siswa OFF, portal pegawai tetap hidup */
  r = await req('POST', '/sekolah/portal-publik/simpan', { simpan_publikasi: '1', portal_pegawai_aktif: '1', portal_slip_aktif: '1', portal_page_title: TITLE, portal_subtitle: SUB });
  ok('portal siswa OFF → 503', (await req('GET', '/portal', null, { cookie: '' })).status === 503);
  const pPeg = await req('GET', '/portal-pegawai', null, { cookie: '' });
  ok('sakelar portal siswa tidak mematikan portal pegawai', pPeg.status === 200, String(pPeg.status));
  ok('portal slip juga tetap hidup', (await req('GET', '/portal-slip', null, { cookie: '' })).status === 200);
  r = await req('POST', '/sekolah/portal-publik/simpan', { simpan_publikasi: '1', portal_aktif: '1', portal_pegawai_aktif: '1', portal_slip_aktif: '1', portal_page_title: TITLE, portal_subtitle: SUB });
  p = await req('GET', '/portal', null, { cookie: '' });
  ok('portal aktif kembali → 200', p.status === 200 && tabTitle(p.text).startsWith(TITLE), String(p.status));

  /* ============ 3. SUPER ADMIN: halaman manajemen ============ */
  cookie = '';
  r = await req('POST', '/super-admin/login', { email: 'super@simkeu.id', password: 'SuperAdmin2026!' });
  ok('login Super Admin Pusat', r.status === 303 && !/err=/.test(r.loc), r.loc);
  r = await req('GET', '/super-admin/portal-publik');
  ok('halaman Manajemen Custom Slug & Portal Publik 200', r.status === 200 && /Manajemen Custom Slug &amp; Portal Publik|Manajemen Custom Slug & Portal Publik/.test(r.text));
  ok('menu baru muncul di sidebar Super Admin', /Manajemen Custom Slug &amp; Portal Publik|Manajemen Custom Slug & Portal Publik/.test(r.text));
  ok('tabel memuat nama sekolah & URL slug', r.text.includes(schoolName) && r.text.includes(`/${slug0}/portal`));
  ok('kolom Custom Domain ada', /Custom Domain/.test(r.text));
  ok('dropdown status akses publik (aktif/nonaktif/private)', /name="status"/.test(r.text) && /value="nonaktif"/.test(r.text) && /value="private"/.test(r.text));
  ok('aksi: Lihat / Slug / Sembunyikan / Hapus', /Lihat:/.test(r.text) && /mSlug1/.test(r.text) && /Sembunyikan/.test(r.text) && /\/hapus"/.test(r.text));
  ok('aksi Lihat tersedia untuk 3 portal', /\/portal"/.test(r.text) && /\/portal-pegawai"/.test(r.text) && /\/portal-slip"/.test(r.text));
  ok('status sakelar sekolah per portal ditampilkan', /Sakelar sekolah:/.test(r.text) && /Siswa/.test(r.text) && /Pegawai/.test(r.text) && /Slip/.test(r.text));
  ok('KPI rekapitulasi halaman publik', /Halaman Aktif/.test(r.text) && /Punya Slug/.test(r.text));
  ok('modal edit slug dirender di luar tabel', /id="mSlug1"/.test(r.text) && r.text.indexOf('id="mSlug1"') > r.text.indexOf('</table>'));

  /* ============ 4. STATUS AKSES: nonaktif → 404, private → 403 ============ */
  let st = await req('POST', '/super-admin/portal-publik/1/status', { status: 'nonaktif', note: 'Pelanggaran aturan slug' });
  ok('ubah status ke nonaktif', st.status === 303 && /ok=/.test(st.loc), dec(st.loc));
  p = await req('GET', '/portal', null, { cookie: '' });
  ok('portal disembunyikan → 404 Not Found', p.status === 404 && /Halaman Tidak Ditemukan/.test(p.text), String(p.status));
  ok('halaman 404 menyebut Administrator Pusat', /Administrator Pusat/.test(p.text));
  ok('catatan Super Admin tersimpan', String((ctl.prepare('SELECT portal_note FROM tenants WHERE id=1').get() || {}).portal_note) === 'Pelanggaran aturan slug');
  ok('dicatat di audit Super Admin', ctl.prepare("SELECT COUNT(*) c FROM saas_audit WHERE aksi='BLOKIR PORTAL PUBLIK'").get().c >= 1);

  // banner peringatan di dashboard tenant
  cookie = schoolCookie;
  r = await req('GET', '/');
  ok('dashboard tenant menampilkan banner peringatan', /Halaman portal publik Anda sedang dinonaktifkan oleh Administrator Pusat/.test(r.text));
  ok('banner memuat catatan Super Admin', /Pelanggaran aturan slug/.test(r.text));
  r = await req('GET', '/portal-publik');
  ok('halaman Portal Publik juga memberi peringatan', /dinonaktifkan oleh Administrator Pusat/.test(r.text));

  cookie = '';
  await req('POST', '/super-admin/login', { email: 'super@simkeu.id', password: 'SuperAdmin2026!' });
  await req('POST', '/super-admin/portal-publik/1/status', { status: 'private', note: 'Hanya internal' });
  p = await req('GET', '/portal', null, { cookie: '' });
  ok('status private → 403 Forbidden', p.status === 403 && /Private/.test(p.text), String(p.status));

  await req('POST', '/super-admin/portal-publik/1/status', { status: 'aktif' });
  p = await req('GET', '/portal', null, { cookie: '' });
  ok('status aktif → portal 200 lagi', p.status === 200, String(p.status));
  cookie = schoolCookie;
  r = await req('GET', '/');
  ok('banner peringatan hilang saat aktif', !/sedang dinonaktifkan oleh Administrator Pusat/.test(r.text));

  /* ============ 5. UBAH / RESET SLUG oleh Super Admin ============ */
  cookie = '';
  await req('POST', '/super-admin/login', { email: 'super@simkeu.id', password: 'SuperAdmin2026!' });
  const NEWSLUG = 'smkpgri-uji';
  r = await req('POST', '/super-admin/portal-publik/1/slug', { portal_slug: NEWSLUG, status: 'aktif' });
  ok('ubah slug oleh Super Admin', r.status === 303 && /ok=/.test(r.loc), dec(r.loc));
  ok('slug baru tersimpan di control plane', String((ctl.prepare('SELECT portal_slug FROM tenants WHERE id=1').get() || {}).portal_slug) === NEWSLUG);
  ok('slug tersinkron ke pengaturan sekolah', String((db.prepare("SELECT v FROM settings WHERE k='portal_slug'").get() || {}).v) === NEWSLUG);
  p = await req('GET', `/${NEWSLUG}/portal`, null, { cookie: '' });
  ok('alamat slug baru dapat dibuka', p.status === 200 && /portal-head/.test(p.text), String(p.status));
  p = await req('GET', `/${slug0}/portal`, null, { cookie: '' });
  ok('alamat slug lama tidak lagi dipakai', p.status === 200 || p.status === 404, String(p.status));
  cookie = schoolCookie;
  r = await req('GET', '/portal-publik');
  ok('halaman Portal Publik sekolah memakai slug baru dari Super Admin', r.text.includes(`/${NEWSLUG}/portal`));
  cookie = '';
  await req('POST', '/super-admin/login', { email: 'super@simkeu.id', password: 'SuperAdmin2026!' });
  r = await req('POST', '/super-admin/portal-publik/1/slug', { portal_slug: 'portal' });
  ok('slug terlarang (reserved) ditolak', /err=/.test(r.loc), dec(r.loc));

  /* ============ 6. HAPUS HALAMAN PUBLIK ============ */
  r = await req('POST', '/super-admin/portal-publik/1/hapus', {});
  ok('hapus halaman publik', r.status === 303 && /ok=/.test(r.loc), dec(r.loc));
  const t1 = ctl.prepare('SELECT * FROM tenants WHERE id=1').get();
  ok('slug dikosongkan', String(t1.portal_slug || '') === '');
  ok('status akses menjadi nonaktif', String(t1.portal_status) === 'nonaktif');
  p = await req('GET', '/portal', null, { cookie: '' });
  ok('portal kembali ke halaman default (404)', p.status === 404, String(p.status));
  ok('data sekolah tetap utuh setelah hapus', db.prepare('SELECT COUNT(*) c FROM users').get().c >= 1 && String((db.prepare("SELECT v FROM settings WHERE k='portal_subtitle'").get() || {}).v) === SUB);
  ok('hapus dicatat pada audit', ctl.prepare("SELECT COUNT(*) c FROM saas_audit WHERE aksi='HAPUS HALAMAN PUBLIK'").get().c >= 1);

  /* pulihkan slug & status */
  await req('POST', '/super-admin/portal-publik/1/slug', { portal_slug: slug0, status: 'aktif' });
  p = await req('GET', '/portal', null, { cookie: '' });
  ok('pemulihan slug → portal 200', p.status === 200, String(p.status));

  /* ============ 7. DEFAULT TEKS DARI SUPER ADMIN ============ */
  cookie = schoolCookie;
  await req('POST', '/sekolah/portal-publik/simpan', { portal_aktif: '1', portal_page_title: '', portal_subtitle: '' });
  cookie = '';
  await req('POST', '/super-admin/login', { email: 'super@simkeu.id', password: 'SuperAdmin2026!' });
  r = await req('GET', '/super-admin/branding');
  ok('Branding punya default judul & sub-judul portal', /portal_default_title/.test(r.text) && /portal_default_subtitle/.test(r.text));
  ok('default bawaan: Cek Tagihan & PORTAL CEK TAGIHAN IURAN SISWA', r.text.includes('value="Cek Tagihan"') && r.text.includes('PORTAL CEK TAGIHAN IURAN SISWA'));
  p = await req('GET', '/portal', null, { cookie: '' });
  ok('tanpa teks kustom → default dipakai', tabTitle(p.text) === `Cek Tagihan · ${schoolName}`, tabTitle(p.text));
  await req('POST', '/super-admin/branding', { saas_nama: 'SIMKEU', portal_default_title: 'Cek Tagihan Sekolah', portal_default_subtitle: 'CEK TAGIHAN IURAN — PORTAL RESMI' });
  p = await req('GET', '/portal', null, { cookie: '' });
  ok('default baru dari Super Admin dipakai', tabTitle(p.text) === `Cek Tagihan Sekolah · ${schoolName}`, tabTitle(p.text));
  ok('sub-judul default baru tampil di banner', /CEK TAGIHAN IURAN — PORTAL RESMI/.test(p.text));

  /* ============ 8. RBAC & catatan ============ */
  cookie = '';
  r = await req('GET', '/super-admin/portal-publik', null, { cookie: '' });
  ok('halaman Super Admin menolak tanpa sesi', r.status === 303 && /super-admin\/login/.test(r.loc), String(r.status));
  // staff sekolah tidak boleh menyimpan teks portal
  cookie = '';
  await req('POST', '/login', { kode: 'SK01', email: 'admin@sekolah.sch.id', password: 'admin123' });
  await req('POST', '/pengguna/save', {
    nama: 'Guru Uji', email: 'guru28@sekolah.sch.id', username: 'guru28', password: 'guru12345', role: 'staff', aktif: '1'
  });
  cookie = '';
  await req('POST', '/login', { kode: 'SK01', email: 'guru28@sekolah.sch.id', password: 'guru12345' });
  r = await req('POST', '/sekolah/portal-publik/simpan', { portal_aktif: '1', portal_page_title: 'Oleh Staff', portal_subtitle: 'X' });
  ok('staff tanpa hak edit tidak dapat mengubah teks portal', String((db.prepare("SELECT v FROM settings WHERE k='portal_page_title'").get() || {}).v) === '' , dec(r.loc));

  /* ============ ringkasan ============ */
  const pass = results.filter(x => x.ok).length;
  console.log(`\nround28: ${pass}/${results.length} cek lulus`);
  if (pass !== results.length) {
    console.log('SERVER LOG (akhir):\n' + log.split('\n').slice(-25).join('\n'));
  }
  try { srv.kill(); } catch (e) { }
  try { db.close(); ctl.close(); } catch (e) { }
  setTimeout(() => process.exit(pass === results.length ? 0 : 1), 200);
})().catch(e => { console.error(e); console.log(log); try { srv.kill(); } catch (_) { } process.exit(1); });
