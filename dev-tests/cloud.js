'use strict';
/* Ronde 20 — Modul Manajemen Sistem, Integrasi & Backup Data (Google Drive)
   1. Halaman Pengaturan Backup (kredensial JSON + Folder ID, admin only)
   2. Auto-backup ZIP ke Google Drive (service account JWT)
   3. Penamaan dinamis Backup_SIMKEU_03Nov2026_0600.zip
   4. Retensi otomatis 30 hari (hanya berkas backup milik aplikasi)
   5. Trigger: terjadwal 06:00 & 15:00 (tanpa memicu dari simpan transaksi) + manual
*/
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const results = [];
const realFetch = global.fetch;
function ok(name, cond, extra = '') {
  results.push({ name, ok: !!cond, extra });
  if (!cond) console.log('FAIL', name, extra);
}

/* ================================================================
   BAGIAN A — unit test gdrive.js dengan fetch tiruan (tanpa jaringan)
   ================================================================ */
async function unitTests() {
  const gdrive = require('../gdrive');
  const bd = require('../backupdata');

  /* --- nama berkas dinamis --- */
  const name = bd.backupFileName(new Date(2026, 10, 3, 6, 0, 0));
  ok('nama berkas dinamis sesuai contoh', name === 'Backup_SIMKEU_03Nov2026_0600.zip', name);
  ok('nama berkas cocok pola retensi', bd.BACKUP_NAME_RE.test(name), name);
  ok('nama berkas sore 15:00', bd.backupFileName(new Date(2026, 10, 3, 15, 0)) === 'Backup_SIMKEU_03Nov2026_1500.zip');
  ok('berkas lain TIDAK cocok pola backup', !bd.BACKUP_NAME_RE.test('catatan-rapat.zip'));

  /* --- kredensial --- */
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const credJson = JSON.stringify({
    type: 'service_account', project_id: 'simkeu-backup',
    private_key_id: 'abc', private_key: pem,
    client_email: 'backup@simkeu-backup.iam.gserviceaccount.com',
    token_uri: 'https://oauth2.googleapis.com/token'
  });
  const cred = gdrive.parseCredentials(credJson);
  ok('parse kredensial: email terbaca', cred.client_email === 'backup@simkeu-backup.iam.gserviceaccount.com');
  ok('parse kredensial: private key utuh', cred.private_key === pem);
  let threw = '';
  try { gdrive.parseCredentials('{bukan json'); } catch (e) { threw = e.message; }
  ok('JSON rusak ditolak dengan pesan jelas', /bukan JSON yang valid/.test(threw), threw);
  threw = '';
  try { gdrive.parseCredentials('{"type":"service_account"}'); } catch (e) { threw = e.message; }
  ok('JSON tanpa client_email ditolak', /client_email/.test(threw), threw);
  threw = '';
  try { gdrive.parseCredentials(JSON.stringify({ client_email: 'a@b.c', private_key: 'bukan-pem' })); } catch (e) { threw = e.message; }
  ok('private_key non-PEM ditolak', /private_key/.test(threw), threw);
  const sum = gdrive.credSummary(credJson);
  ok('credSummary mengembalikan email', sum.ok && sum.email === cred.client_email);
  ok('credSummary menandai kredensial kosong', gdrive.credSummary('').ok === false);

  /* --- fetch tiruan --- */
  const calls = [];
  let queue = [];
  const reply = (status, obj) => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof obj === 'string' ? obj : JSON.stringify(obj)) });
  global.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    const next = queue.shift();
    if (!next) throw new Error('fetch tak terduga: ' + url);
    return next;
  };

  /* --- token OAuth2 (JWT RS256) --- */
  gdrive._resetTokenCache();
  queue = [reply(200, { access_token: 'tok-123', expires_in: 3600 })];
  const tok = await gdrive.accessToken(cred);
  ok('access token diperoleh', tok === 'tok-123');
  ok('permintaan token memakai grant_type jwt-bearer', String(calls[0].opts.body).includes('jwt-bearer'));
  const assertion = new URLSearchParams(String(calls[0].opts.body)).get('assertion');
  ok('assertion berbentuk JWT 3 bagian', (assertion || '').split('.').length === 3);
  const payload = JSON.parse(Buffer.from(assertion.split('.')[1], 'base64url').toString());
  ok('JWT iss = client_email', payload.iss === cred.client_email, payload.iss);
  ok('JWT scope drive', payload.scope === 'https://www.googleapis.com/auth/drive');
  const tok2 = await gdrive.accessToken(cred);
  ok('token di-cache (tidak minta ulang)', tok2 === 'tok-123' && calls.length === 1, 'calls=' + calls.length);

  /* --- unggah ZIP multipart --- */
  calls.length = 0;
  queue = [reply(200, { id: 'file-1', name, size: 1234, createdTime: '2026-11-03T06:00:00Z' })];
  const up = await gdrive.uploadBackup({ cred, folderId: 'FOLDER123456' }, Buffer.from('PK-isiberkas'), name);
  ok('unggahan mengembalikan id berkas', up.id === 'file-1');
  const upUrl = calls[0].url;
  ok('endpoint upload multipart', /upload\/drive\/v3\/files\?uploadType=multipart/.test(upUrl), upUrl);
  ok('unggahan memakai supportsAllDrives', /supportsAllDrives=true/.test(upUrl));
  ok('header Authorization Bearer', calls[0].opts.headers.Authorization === 'Bearer tok-123');
  const bodyStr = Buffer.from(calls[0].opts.body).toString('latin1');
  ok('metadata memuat nama berkas dinamis', bodyStr.includes(name));
  ok('metadata memuat folder tujuan', bodyStr.includes('FOLDER123456'));
  ok('isi ZIP ikut terkirim', bodyStr.includes('PK-isiberkas'));

  /* --- unggah besar memakai resumable upload (multipart dibatasi 5 MB) --- */
  calls.length = 0;
  queue = [
    { ok: true, status: 200, headers: { get: k => (/location/i.test(k) ? 'https://upload.example/session-1' : null) }, text: async () => '' },
    reply(200, { id: 'file-big', name: 'big.zip', size: 6e6 })
  ];
  const big = Buffer.alloc(6 * 1024 * 1024, 7);
  const upBig = await gdrive.uploadBackup({ cred, folderId: 'FOLDER123456' }, big, name);
  ok('berkas besar memakai resumable upload', /uploadType=resumable/.test(calls[0].url), calls[0].url);
  ok('sesi unggah diikuti PUT ke URL Location', calls[1].url === 'https://upload.example/session-1' && calls[1].opts.method === 'PUT');
  ok('isi berkas besar terkirim utuh', Buffer.from(calls[1].opts.body).length === big.length);
  ok('id berkas besar dikembalikan', upBig.id === 'file-big');

  /* --- pesan kesalahan kuota akun layanan dipahami admin --- */
  const quotaErr = gdrive._driveError(403, { error: { message: 'Service Accounts do not have storage quota.', errors: [{ reason: 'storageQuotaExceeded' }] } }, '');
  ok('galat kuota akun layanan diberi solusi Shared Drive', /Shared Drive/.test(quotaErr.message), quotaErr.message);

  /* --- daftar & retensi --- */
  const now = Date.now();
  const iso = ms => new Date(ms).toISOString();
  calls.length = 0;
  queue = [reply(200, {
    files: [
      { id: 'a', name: 'Backup_SIMKEU_01Oct2026_0600.zip', size: '100', createdTime: iso(now - 45 * 86400000) },
      { id: 'b', name: 'Backup_SIMKEU_20Oct2026_1500.zip', size: '200', createdTime: iso(now - 10 * 86400000) },
      { id: 'c', name: 'Backup_SIMKEU_15Sep2026_0600.zip', size: '300', createdTime: iso(now - 40 * 86400000) },
      { id: 'x', name: 'dokumen-lain.zip', size: '999', createdTime: iso(now - 90 * 86400000) }
    ]
  })];
  const list = await gdrive.listBackups({ cred, folderId: 'FOLDER123456' });
  ok('hanya berkas backup aplikasi yang dihitung', list.length === 3, 'n=' + list.length);
  ok('query dibatasi ke folder tujuan', decodeURIComponent(calls[0].url).includes("'FOLDER123456' in parents"));

  calls.length = 0;
  queue = [
    reply(200, {
      files: [
        { id: 'a', name: 'Backup_SIMKEU_01Oct2026_0600.zip', size: '100', createdTime: iso(now - 45 * 86400000) },
        { id: 'b', name: 'Backup_SIMKEU_20Oct2026_1500.zip', size: '200', createdTime: iso(now - 10 * 86400000) },
        { id: 'c', name: 'Backup_SIMKEU_15Sep2026_0600.zip', size: '300', createdTime: iso(now - 40 * 86400000) }
      ]
    }),
    reply(204, ''),
    reply(204, '')
  ];
  const clean = await gdrive.cleanupOld({ cred, folderId: 'FOLDER123456' }, { days: 30 });
  ok('retensi menghapus 2 berkas > 30 hari', clean.deleted.length === 2, JSON.stringify(clean.deleted));
  ok('retensi mempertahankan berkas baru', !clean.deleted.includes('Backup_SIMKEU_20Oct2026_1500.zip'));
  const delUrls = calls.filter(c => c.opts.method === 'DELETE').map(c => c.url);
  ok('DELETE dipanggil untuk tiap berkas lama', delUrls.length === 2, delUrls.join(','));
  ok('DELETE memakai supportsAllDrives', delUrls.every(u => u.includes('supportsAllDrives=true')));
  ok('berkas non-backup tidak pernah dihapus', !delUrls.some(u => u.includes('/x')));

  /* --- konfigurasi dari DB + eksekusi + jadwal --- */
  const tmp = path.join(os.tmpdir(), 'smk-cloud-unit-' + Date.now() + '.sqlite');
  process.env.DB_PATH = tmp;
  const dbm = require('../db');
  dbm.setSetting('gdrive_credentials', credJson);
  dbm.setSetting('gdrive_folder_id', 'FOLDER123456');
  dbm.setSetting('gdrive_retensi_hari', '30');
  ok('konfigurasi terdeteksi lengkap', gdrive.isConfigured(dbm) === true);
  ok('jam jadwal default 06:00 & 15:00', gdrive.scheduleTimes(dbm).join(',') === '06:00,15:00');
  const nx = gdrive.nextRun(dbm);
  ok('jadwal berikutnya di masa depan', nx && nx.getTime() > Date.now(), nx && nx.toString());

  gdrive._resetTokenCache();
  calls.length = 0;
  queue = [
    reply(200, { access_token: 'tok-xyz', expires_in: 3600 }),        // token
    reply(200, { id: 'file-9', name: 'x', createdTime: iso(now) }),   // upload
    reply(200, {                                                       // list untuk retensi
      files: [
        { id: 'old', name: 'Backup_SIMKEU_01Sep2026_0600.zip', size: '10', createdTime: iso(now - 60 * 86400000) },
        { id: 'new', name: 'Backup_SIMKEU_02Nov2026_1500.zip', size: '10', createdTime: iso(now - 86400000) }
      ]
    }),
    reply(204, '')                                                     // delete berkas lama
  ];
  const run = await gdrive.runBackup(dbm, { trigger: 'manual', user: { nama: 'Admin Uji' } });
  ok('runBackup manual sukses', run.ok === true, run.error || '');
  ok('runBackup mengembalikan nama berkas dinamis', bd.BACKUP_NAME_RE.test(run.name || ''), run.name);
  ok('runBackup menghapus 1 berkas lama', run.cleanup && run.cleanup.deleted.length === 1, JSON.stringify(run.cleanup));
  const hist = gdrive.history(dbm, 5);
  ok('riwayat cloud_backup tercatat', hist.length === 1 && hist[0].status === 'sukses', JSON.stringify(hist[0] || {}));
  ok('riwayat mencatat pemicu manual & pengguna', hist[0].pemicu === 'manual' && hist[0].user_nama === 'Admin Uji');
  ok('audit BACKUP CLOUD tertulis', dbm.db.prepare("SELECT COUNT(*) c FROM audit WHERE aksi='BACKUP CLOUD'").get().c >= 1);

  /* --- kegagalan tidak merusak apa pun --- */
  dbm.setSetting('gdrive_credentials', '');
  const bad = await gdrive.runBackup(dbm, { trigger: 'otomatis' });
  ok('tanpa kredensial → gagal dengan pesan jelas', bad.ok === false && /belum diisi/.test(bad.error), bad.error);
  ok('kegagalan tercatat di riwayat', gdrive.history(dbm, 1)[0].status === 'gagal');

  /* --- jadwal otomatis: tepat satu kali per slot --- */
  dbm.setSetting('gdrive_credentials', credJson);
  dbm.setSetting('gdrive_auto', '1');
  const d = new Date();
  const hhmm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  dbm.setSetting('gdrive_times', hhmm);
  dbm.setSetting('gdrive_done', '[]');
  gdrive._resetTokenCache();
  calls.length = 0;
  queue = [
    reply(200, { access_token: 'tok-auto', expires_in: 3600 }),
    reply(200, { id: 'file-auto', name: 'x', createdTime: iso(now) }),
    reply(200, { files: [] })
  ];
  const auto1 = await gdrive.checkSchedule(dbm);
  ok('scheduler menjalankan backup pada jam jadwal', auto1 && auto1.ok === true, auto1 && auto1.error);
  calls.length = 0;
  const auto2 = await gdrive.checkSchedule(dbm);
  ok('slot yang sama tidak dijalankan dua kali', auto2 === null);
  dbm.setSetting('gdrive_auto', '0');
  dbm.setSetting('gdrive_done', '[]');
  const auto3 = await gdrive.checkSchedule(dbm);
  ok('sakelar jadwal nonaktif → tidak ada backup', auto3 === null);

  try { dbm.db.close(); } catch (e) { }
  for (const f of [tmp, tmp + '-wal', tmp + '-shm']) { try { fs.unlinkSync(f); } catch (e) { } }
  global.fetch = realFetch;   // kembalikan fetch asli untuk tes HTTP
}

/* ================================================================
   BAGIAN B — integrasi HTTP (server sungguhan, tanpa jaringan Google)
   ================================================================ */
async function httpTests() {
  const PORT = 3691;
  const DB = process.env.R20_DB || path.join(os.tmpdir(), 'smk-cloud-' + Date.now() + '.sqlite');
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT, DB_PATH: DB }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  srv.stdout.on('data', d => { log += d; });
  srv.stderr.on('data', d => { log += d; });
  const base = `http://127.0.0.1:${PORT}`;
  let cookie = '';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const decode = s => { try { return decodeURIComponent(s); } catch (e) { return s; } };
  async function req(method, url, body) {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    let payload = null;
    if (body) {
      const usp = new URLSearchParams();
      for (const [k, v] of Object.entries(body)) usp.append(k, v);
      payload = usp.toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: r.status, text: await r.text(), loc: r.headers.get('location') || '' };
  }

  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }

    /* login admin */
    let r = await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
    ok('login admin', r.status === 303);

    /* halaman pengaturan backup */
    r = await req('GET', '/pengaturan-backup');
    ok('halaman Pengaturan Backup 200', r.status === 200, 'status ' + r.status);
    ok('form kredensial JSON tersedia', r.text.includes('name="gdrive_credentials"'));
    ok('input Folder ID tersedia', r.text.includes('name="gdrive_folder_id"'));
    ok('keterangan jadwal 06:00 & 15:00', r.text.includes('06:00') && r.text.includes('15:00'));
    ok('tombol manual tersedia', r.text.includes('Backup &amp; Sinkronisasi Manual'));
    ok('contoh nama berkas versioning ditampilkan', /Backup_SIMKEU_\d{2}[A-Za-z]{3}\d{4}_\d{4}\.zip/.test(r.text));
    ok('menu Pengaturan Backup tampil di sidebar', r.text.includes('/pengaturan-backup'));
    ok('halaman /backup menautkan pengaturan cloud', (await req('GET', '/backup')).text.includes('/pengaturan-backup'));

    /* simpan kredensial tidak valid → ditolak, tidak tersimpan */
    r = await req('POST', '/pengaturan-backup/simpan', {
      gdrive_credentials: '{bukan json', gdrive_folder_id: 'FOLDER123456', gdrive_auto: '1', gdrive_times: '06:00,15:00', gdrive_retensi_hari: '30'
    });
    ok('kredensial rusak ditolak', /err=/.test(r.loc) && decode(r.loc).includes('bukan JSON yang valid'), r.loc);

    /* simpan konfigurasi valid (folder ID diambil dari URL Drive) */
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const credJson = JSON.stringify({
      type: 'service_account', project_id: 'simkeu-backup',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      client_email: 'backup@simkeu-backup.iam.gserviceaccount.com',
      token_uri: 'https://oauth2.googleapis.com/token'
    });
    r = await req('POST', '/pengaturan-backup/simpan', {
      gdrive_credentials: credJson,
      gdrive_folder_id: 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345?usp=sharing',
      gdrive_auto: '1', gdrive_times: '06:00, 15:00', gdrive_retensi_hari: '30'
    });
    ok('kredensial valid disimpan', /ok=/.test(r.loc), r.loc);

    r = await req('GET', '/pengaturan-backup');
    ok('email service account ditampilkan', r.text.includes('backup@simkeu-backup.iam.gserviceaccount.com'));
    ok('Folder ID diekstrak dari URL', r.text.includes('1AbCdEfGhIjKlMnOpQrStUvWxYz012345'));
    ok('kunci privat TIDAK dirender ulang di HTML', !r.text.includes('BEGIN PRIVATE KEY'));
    ok('status kredensial tersimpan', r.text.includes('Tersimpan'));

    /* jam tidak valid ditolak */
    r = await req('POST', '/pengaturan-backup/simpan', { gdrive_times: '25:99' });
    ok('jam eksekusi tidak valid ditolak', /err=/.test(r.loc) && decode(r.loc).includes('tidak valid'), r.loc);
    /* nilai jam yang sudah tersimpan tidak berubah oleh POST gagal di atas */
    const Database = require('better-sqlite3');
    const db = new Database(DB);
    const timesSetting = db.prepare("SELECT v FROM settings WHERE k='gdrive_times'").get().v;
    ok('pengaturan lama tetap utuh saat validasi gagal', timesSetting === '06:00,15:00', timesSetting);
    const folderSetting = db.prepare("SELECT v FROM settings WHERE k='gdrive_folder_id'").get().v;
    ok('folder ID tersimpan tanpa URL', folderSetting === '1AbCdEfGhIjKlMnOpQrStUvWxYz012345', folderSetting);

    /* RBAC: staf tidak boleh membuka halaman pengaturan backup */
    const staffEmail = 'staf-cloud@sekolah.sch.id';
    const hash = require('../lib').hashPassword('staf12345');
    db.prepare("INSERT INTO users (nama,email,password,role,aktif,jabatan,created_at) VALUES (?,?,?,?,1,?,?)")
      .run('Staf Cloud', staffEmail, hash, 'staff', 'Staf', '2026-01-01 00:00:00');
    db.close();
    cookie = '';
    await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' }); // pastikan cookie admin baru
    cookie = '';
    r = await req('POST', '/login', { email: staffEmail, password: 'staf12345' });
    ok('login staf', r.status === 303);
    r = await req('GET', '/pengaturan-backup');
    ok('staf ditolak (403) dari Pengaturan Backup', r.status === 403, 'status ' + r.status);
    r = await req('GET', '/backup');
    ok('menu baru tidak muncul untuk staf', !r.text.includes('/pengaturan-backup'));

    /* kembali sebagai admin */
    cookie = '';
    await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });

    /* hapus kredensial lalu jalankan manual → pesan jelas (tanpa memanggil Google) */
    r = await req('POST', '/pengaturan-backup/simpan', { hapus_kredensial: '1', gdrive_folder_id: 'FOLDER123456', gdrive_times: '06:00,15:00', gdrive_retensi_hari: '30' });
    ok('kredensial dapat dihapus', /ok=/.test(r.loc), r.loc);
    r = await req('POST', '/pengaturan-backup/jalan');
    ok('backup manual tanpa kredensial gagal dengan pesan jelas', /err=/.test(r.loc) && decode(r.loc).includes('belum diisi'), r.loc);
    r = await req('POST', '/pengaturan-backup/uji');
    ok('uji koneksi tanpa kredensial memberi pesan jelas', /err=/.test(r.loc) && decode(r.loc).includes('belum diisi'), r.loc);
    r = await req('POST', '/pengaturan-backup/bersihkan');
    ok('retensi manual tanpa kredensial gagal jelas', /err=/.test(r.loc), r.loc);

    /* riwayat gagal tercatat di halaman */
    r = await req('GET', '/pengaturan-backup');
    ok('riwayat backup cloud tampil', r.text.includes('Riwayat Backup Cloud') && r.text.includes('Gagal'));

    /* trigger tidak boleh muncul di alur simpan transaksi */
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'transaksi.js'), 'utf8');
    ok('simpan transaksi tidak memicu backup (tanpa require gdrive)', !/gdrive|runBackup/.test(src));
    ok('modul gdrive tidak di-require dari route transaksi/payroll', ['transaksi', 'payroll', 'iuran'].every(f =>
      !/gdrive/.test(fs.readFileSync(path.join(__dirname, '..', 'routes', f + '.js'), 'utf8'))));
  } finally {
    srv.kill();
    await sleep(400);
    for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch (e) { } }
  }
}

(async () => {
  await unitTests();
  await httpTests();
  const fail = results.filter(r => !r.ok).length;
  console.log(`\n=== RONDE 20 · ${results.length} cek · ${results.length - fail} lulus · ${fail} gagal ===`);
  if (fail) process.exit(1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
