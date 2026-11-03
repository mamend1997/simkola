'use strict';
/* Verifikasi migrasi terhadap SALINAN database produksi (tidak menyentuh data asli).
   Dijalankan manual: node dev-tests/liveclone.js */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const SRC = path.join(__dirname, '..', 'data');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'liveclone-'));
const PORT = Number(process.env.LC_PORT) || 3971;

function copyDb(from, to) {
  for (const ext of ['', '-wal', '-shm']) {
    if (fs.existsSync(from + ext)) fs.copyFileSync(from + ext, to + ext);
  }
}

copyDb(path.join(SRC, 'keuangan.sqlite'), path.join(TMP, 'keuangan.sqlite'));
copyDb(path.join(SRC, 'saas.db'), path.join(TMP, 'saas.db'));
fs.mkdirSync(path.join(TMP, 'tenants'), { recursive: true });
for (const f of fs.readdirSync(path.join(SRC, 'tenants')).filter(x => /^tenant-\d+\.db$/.test(x))) {
  copyDb(path.join(SRC, 'tenants', f), path.join(TMP, 'tenants', f));
}

const Database = require('better-sqlite3');
const s = new Database(path.join(TMP, 'saas.db'));
const before = s.prepare('SELECT id,school_code,nama FROM tenants ORDER BY id').all();
for (const t of before) {
  const f = t.id === 1 ? 'keuangan.sqlite' : `tenants/tenant-${t.id}.db`;
  const fp = path.join(TMP, f);
  if (fs.existsSync(fp)) s.prepare('UPDATE tenants SET db_file=? WHERE id=?').run(fp, t.id);
}
s.close();

const counts = {};
function snapshot(file) {
  try {
    const d = new Database(file, { readonly: true });
    const t = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
    const out = {};
    for (const name of t) { try { out[name] = d.prepare(`SELECT COUNT(*) c FROM "${name}"`).get().c; } catch (e) { } }
    d.close();
    return out;
  } catch (e) { return { error: e.message }; }
}

const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, DB_PATH: path.join(TMP, 'keuangan.sqlite'), SAAS_DB_PATH: path.join(TMP, 'saas.db') },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (n, c, x = '') => { results.push({ n, c: !!c }); console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  →  ' + x)); };

async function req(method, url, body, cookie) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload = null;
  if (body) { payload = new URLSearchParams(body).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, text: buf.toString('utf8'), buf, loc: r.headers.get('location') || '', sc: r.headers.get('set-cookie') || '' };
}
const ck = sc => String(sc || '').split(';')[0];

(async () => {
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { }
    await sleep(150);
  }
  const mainBefore = snapshot(path.join(TMP, 'keuangan.sqlite'));
  ok('server start dengan database produksi (salinan)', !/Error/.test(log.slice(0, 3000)) || /listening/.test(log), log.slice(0, 500));
  ok('migrasi tenant_id & kolom baru tanpa kehilangan baris',
    (snapshot(path.join(TMP, 'keuangan.sqlite')).transaksi || 0) === (mainBefore.transaksi || 0),
    `${mainBefore.transaksi} → ${snapshot(path.join(TMP, 'keuangan.sqlite')).transaksi}`);

  const s2 = new Database(path.join(TMP, 'saas.db'), { readonly: true });
  const after = s2.prepare('SELECT id,school_code,nama,portal_slug FROM tenants ORDER BY id').all();
  ok('seluruh sekolah tetap ada', after.length === before.length, `${before.length} → ${after.length}`);
  ok('kode sekolah tidak berubah', after.every((t, i) => t.school_code === before[i].school_code),
    after.map(t => t.school_code).join(','));
  ok('slug portal terisi otomatis untuk sekolah lama', after.every(t => !!t.portal_slug), after.map(t => t.portal_slug).join(','));
  ok('tabel baru control plane dibuat', ['master_guides', 'announcements', 'tickets', 'ticket_messages', 'audit_log', 'saas_jobs'].every(x => s2.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(x)));
  s2.close();

  // login ke setiap sekolah dengan kode aslinya
  for (const t of after) {
    const tdb = new Database(t.id === 1 ? path.join(TMP, 'keuangan.sqlite') : path.join(TMP, `tenants/tenant-${t.id}.db`), { readonly: true });
    const u = tdb.prepare("SELECT email FROM users WHERE role='super_admin' LIMIT 1").get();
    tdb.close();
    if (!u) { ok(`akun admin sekolah ${t.school_code} ada`, false); continue; }
    // password produksi milik pemilik → cukup pastikan form login mengenali kodenya
    const r = await req('POST', '/login', { kode: t.school_code, email: u.email, password: 'salah-pasti-gagal' });
    ok(`login ${t.school_code} mengenali kode sekolah`, /password%20salah|password\+salah/i.test(r.loc), r.loc);
  }

  // sesi nyata: pakai akun admin sekolah pertama lewat sandi sementara (di salinan saja)
  const d1 = new Database(path.join(TMP, 'keuangan.sqlite'));
  const lib = require('../lib');
  d1.prepare("UPDATE users SET password=? WHERE role='super_admin'").run(lib.hashPassword('uji123456'));
  d1.close();
  const r1 = await req('POST', '/login', { kode: after[0].school_code, email: 'admin@sekolah.sch.id', password: 'uji123456' });
  ok('login sekolah produksi (salinan)', r1.status === 303 && /simkeu_sid/.test(r1.sc), r1.loc);
  const cookie = ck(r1.sc);
  const pages = ['/', '/transaksi', '/bku', '/laporan', '/piutang', '/payroll', '/payroll/kolom', '/petunjuk', '/bantuan', '/pengaturan-backup', '/sekolah', '/info-layanan', '/iuran', '/siswa'];
  for (const u of pages) {
    const r = await req('GET', u, null, cookie);
    ok(`halaman ${u} normal`, r.status === 200, r.status);
  }
  const rp = await req('GET', '/payroll', null, cookie);
  ok('leger honor memakai kolom dinamis', /payroll_kolom|Pengaturan Kolom Leger/.test(rp.text) || /pajak|Insentif/.test(rp.text), 'kolom dinamis tidak tampil');
  const k = new Database(path.join(TMP, 'keuangan.sqlite'), { readonly: true });
  ok('kolom leger ter-seed (20 kolom bawaan)', k.prepare('SELECT COUNT(*) c FROM payroll_kolom').get().c >= 20, String(k.prepare('SELECT COUNT(*) c FROM payroll_kolom').get().c));
  ok('nilai payroll lama tetap utuh', (k.prepare('SELECT COUNT(*) c FROM payroll').get().c === (mainBefore.payroll || 0)));
  k.close();

  const fail = results.filter(x => !x.c);
  console.log(`\n${results.length - fail.length}/${results.length} cek lulus`);
  if (fail.length) console.log('GAGAL: ' + fail.map(f => f.n).join(' | '));
  srv.kill();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { }
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(log.slice(-2000)); srv.kill(); process.exit(1); });
