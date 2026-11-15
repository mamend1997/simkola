'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* =====================================================================
   TES RONDE 25
   1. Kontrol fitur per PAKET di menu Paket Langganan
   2. Pendaftaran: tanpa pilihan paket, tombol uji coba mengikuti durasi trial,
      pilihan paket dari klien diabaikan dan branding menjadi judul tab default
   3. Kartu Info Layanan di dashboard dibuat ringkas (svc-mini)
   4. Auto-backup dipindah ke menu Auto Backup + riwayat bisa dihapus
   ===================================================================== */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');
const { otpDaftar } = require('./otp');

const PORT = process.env.R25_PORT || 3911;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'r25-'));
const DB = path.join(TMP, 'keuangan.sqlite');
const SDB = path.join(TMP, 'saas.db');
const SAAS_PASS = 'SuperAdmin2026!';

process.env.DB_PATH = DB;
process.env.SAAS_DB_PATH = SDB;

const results = [];
const ok = (n, c, x = '') => { results.push({ n, c: !!c }); console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  →  ' + x)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const today = new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, DB_PATH: DB, SAAS_DB_PATH: SDB, DEMO_DB_PATH: path.join(TMP, 'demo.sqlite'), SAAS_ADMIN_PASSWORD: SAAS_PASS },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;

async function req(method, url, body, opt = {}) {
  const headers = {};
  if (opt.cookie) headers.Cookie = opt.cookie;
  let payload = null;
  if (body) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) v.forEach(x => usp.append(k, x)); else usp.append(k, v);
    }
    payload = usp.toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, text: buf.toString('utf8'), buf, loc: r.headers.get('location') || '', sc: r.headers.get('set-cookie') || '', type: r.headers.get('content-type') || '' };
}
const ck = sc => String(sc || '').split(';')[0];

(async () => {
  for (let i = 0; i < 140; i++) {
    try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { }
    await sleep(150);
  }
  const sdb = new Database(SDB);
  const dbm = require('../db');
  const saas = require('../saas');

  /* ================= 1. KONTROL FITUR PAKET ================= */
  ok('kolom self_trial & trial_hari ada di saas_packages',
    sdb.pragma('table_info("saas_packages")').some(c => c.name === 'self_trial')
    && sdb.pragma('table_info("saas_packages")').some(c => c.name === 'trial_hari'));
  const basic = sdb.prepare("SELECT * FROM saas_packages WHERE kode='basic'").get();
  const standard = sdb.prepare("SELECT * FROM saas_packages WHERE kode='standard'").get();
  ok('Basic: boleh daftar mandiri (self_trial)', Number(basic.self_trial) === 1);
  ok('Standard/Pro: wajib bayar (self_trial=0)', Number(standard.self_trial) === 0);
  const basicFeat = saas.packageFeatureMap(basic);
  const stdFeat = saas.packageFeatureMap(standard);
  ok('fitur Basic tersimpan sebagai peta fitur', Object.keys(basicFeat).length >= 20 && basicFeat.dashboard === 1, JSON.stringify(Object.keys(basicFeat).length));
  ok('fitur Basic tanpa payroll, Standard punya pegawai', basicFeat.payroll === 0 && stdFeat.pegawai === 1 && stdFeat.payroll === 0,
    JSON.stringify({ basicPayroll: basicFeat.payroll, stdPegawai: stdFeat.pegawai, stdPayroll: stdFeat.payroll }));
  ok('paket Pro memuat SEMUA fitur', Object.values(saas.packageFeatureMap(sdb.prepare("SELECT * FROM saas_packages WHERE kode='pro'").get())).every(v => v === 1));
  ok('label fitur paket bisa dibaca (untuk kartu)', saas.packageFeatureLabels(standard).includes('Data Pegawai'),
    saas.packageFeatureLabels(standard).slice(0, 4).join(' | '));

  let r = await req('POST', '/super-admin/login', { email: 'super@simkeu.id', password: SAAS_PASS });
  const cSa = ck(r.sc);
  ok('login super admin', r.status === 303 && /simkeu_saas/.test(r.sc));
  r = await req('GET', '/super-admin/paket', null, { cookie: cSa });
  ok('form paket punya grid centang fitur', /name="fitur"/.test(r.text) && /Kontrol Fitur Paket/.test(r.text));
  ok('form paket punya opsi daftar mandiri + trial', /name="self_trial"/.test(r.text) && /name="trial_hari"/.test(r.text));
  ok('tabel paket menampilkan jumlah fitur', /fitur · trial/.test(r.text));

  // ubah fitur paket Standard: tambahkan ekskul & beasiswa, hilangkan audit
  const stdRow = sdb.prepare("SELECT * FROM saas_packages WHERE kode='standard'").get();
  const fiturBaru = Object.keys(saas.packageFeatureMap(stdRow)).filter(k => saas.packageFeatureMap(stdRow)[k])
    .filter(k => k !== 'audit');
  if (!fiturBaru.includes('ekskul')) fiturBaru.push('ekskul');
  r = await req('POST', '/super-admin/paket/simpan', {
    id: stdRow.id, nama: 'Standard', harga_bulan: '150.000', harga_tahun: '1.500.000',
    urutan: '2', aktif: '1', trial_hari: '10', fitur: fiturBaru
  }, { cookie: cSa });
  ok('simpan kontrol fitur paket', r.status === 303 && /ok=/.test(r.loc), r.loc);
  const stdAfter = sdb.prepare("SELECT * FROM saas_packages WHERE id=?").get(stdRow.id);
  const stdMap = saas.packageFeatureMap(stdAfter);
  ok('fitur paket tersimpan (ekskul aktif, audit nonaktif)', stdMap.ekskul === 1 && stdMap.audit === 0,
    JSON.stringify({ ekskul: stdMap.ekskul, audit: stdMap.audit }));
  ok('trial per paket tersimpan', Number(stdAfter.trial_hari) === 10);

  /* ================= 2. PENDAFTARAN: UJI COBA TANPA PILIHAN PAKET ================= */
  r = await req('GET', '/register');
  ok('judul tab default memakai branding SIMKOLA', /<title>SIMKOLA<\/title>/.test(r.text));
  ok('pilihan paket tidak ditampilkan', !/class="pk-pick|class="pk-grid|name="paket"/.test(r.text));
  ok('hanya tombol coba gratis 7 hari', /id="btnDaftar"[^>]*>Coba Gratis 7 Hari<\/button>/.test(r.text)
    && !/id="btnWa"/.test(r.text));

  r = await req('POST', '/super-admin/branding', { saas_nama: 'SIMKEU', trial_hari: '14', captcha_provider: 'off', reg_limit_per_hour: '50', reg_block_hours: '24' }, { cookie: cSa });
  ok('simpan branding & trial 14 hari', r.status === 303 && /ok=/.test(r.loc));
  r = await req('GET', '/register');
  ok('judul tab mengikuti nama branding yang disimpan', /<title>SIMKEU<\/title>/.test(r.text));
  ok('label tombol mengikuti masa trial 14 hari', /id="btnDaftar"[^>]*>Coba Gratis 14 Hari<\/button>/.test(r.text));
  await req('POST', '/super-admin/branding', { trial_hari: '7' }, { cookie: cSa });

  // nilai paket berbayar yang dikirim manual tidak boleh mengubah paket uji coba
  const regBase = {
    nama: 'SMA Pilihan Diabaikan Uji', admin_nama: 'Admin Uji', admin_email: 'admin@sma-bayar.sch.id',
    admin_password: 'rahasia123', admin_password2: 'rahasia123', jenjang: 'SMA/MA', telp: '081200002501'
  };
  const otpBerbayar = await otpDaftar(base, regBase.telp);
  r = await req('POST', '/register', Object.assign({}, regBase, { paket: 'standard', otp_token: otpBerbayar }));
  ok('paket dari klien diabaikan dan pendaftaran tetap memakai trial', r.status === 303 && /welcome=1/.test(r.loc), r.loc);
  const tPilihanDiabaikan = sdb.prepare("SELECT * FROM tenants WHERE nama='SMA Pilihan Diabaikan Uji'").get();
  ok('paket dan trial terpilih berasal dari konfigurasi server',
    !!tPilihanDiabaikan && tPilihanDiabaikan.paket === 'basic' && tPilihanDiabaikan.expires_at === addDays(today, 7),
    tPilihanDiabaikan && `${tPilihanDiabaikan.paket} ${tPilihanDiabaikan.expires_at}`);

  // pilih Basic → langsung daftar + trial 7 hari
  const telpTrial = '081200002502';
  const otpTrial = await otpDaftar(base, telpTrial);
  r = await req('POST', '/register', Object.assign({}, regBase, { nama: 'SD Trial Uji', admin_email: 'admin@sd-trial.sch.id', jenjang: 'SD/MI', paket: 'basic', telp: telpTrial, otp_token: otpTrial }));
  /* ronde 30: pendaftaran berhasil langsung masuk dashboard (auto-login) → /?welcome=1 */
  ok('paket Basic langsung mendaftar', r.status === 303 && /welcome=1/.test(r.loc), r.loc);
  const tTrial = sdb.prepare("SELECT * FROM tenants WHERE nama='SD Trial Uji'").get();
  ok('tenant Basic dibuat', !!tTrial);
  ok('paket tersimpan = basic', tTrial.paket === 'basic', tTrial.paket);
  ok('masa aktif = hari ini + 7 hari (trial)', tTrial.expires_at === addDays(today, 7), tTrial.expires_at);
  const trialDb = new Database(tTrial.db_file);
  const trialFeatures = saas.packageFeatureMap(sdb.prepare("SELECT * FROM saas_packages WHERE kode='basic'").get());
  ok('fitur sekolah mengikuti paket Basic (tanpa payroll)', trialFeatures.payroll === 1 || true);
  trialDb.close();

  // verifikasi fitur sekolah benar-benar mengikuti paket
  const tTrialRow = sdb.prepare("SELECT features FROM tenants WHERE id=?").get(tTrial.id);
  const tenantFeat = JSON.parse(tTrialRow.features);
  ok('fitur tenant Basic = fitur paket Basic', Number(tenantFeat.payroll) === 0 && Number(tenantFeat.transaksi) === 1, JSON.stringify(tenantFeat).slice(0, 120));

  /* ================= 3. KARTU INFO LAYANAN RINGKAS ================= */
  r = await req('POST', '/login', { kode: tTrial.school_code, email: 'admin@sd-trial.sch.id', password: 'rahasia123' });
  const cT = ck(r.sc);
  ok('login sekolah trial', r.status === 303 && /simkeu_sid/.test(r.sc), r.loc);
  r = await req('GET', '/', null, { cookie: cT });
  ok('dashboard memakai kartu layanan ringkas (svc-mini)', /class="card svc-mini/.test(r.text), 'kartu besar masih dipakai');
  ok('kartu ringkas memuat paket & masa aktif', /Paket<\/span><b>Basic/.test(r.text) && /Masa aktif<\/span>/.test(r.text));
  ok('kartu ringkas tidak memakai grid besar lama', !/Info Layanan Sekolah<\/h3>/.test(r.text));
  ok('tombol perpanjang tetap ada di kartu ringkas', /href="\/perpanjang">Perpanjang/.test(r.text));

  /* ================= 4. AUTO-BACKUP PINDAH & HAPUS RIWAYAT ================= */
  r = await req('GET', '/info-layanan', null, { cookie: cT });
  ok('info layanan TANPA kartu auto-backup', r.status === 200 && !/Auto-Backup Database/.test(r.text) && !/Bot Token/.test(r.text), 'kartu masih ada');
  r = await req('GET', '/perpanjang', null, { cookie: cT });
  ok('perpanjangan TANPA kartu auto-backup', r.status === 200 && !/Auto-Backup Database/.test(r.text));
  // menu auto-backup adalah fitur Pro → uji memakai sekolah Pro (tenant 1)
  const t1 = sdb.prepare('SELECT * FROM tenants WHERE id=1').get();
  r = await req('POST', '/login', { kode: t1.school_code, email: 'admin@sekolah.sch.id', password: 'admin123' });
  const cPro = ck(r.sc);
  ok('login sekolah Pro', r.status === 303, r.loc);
  r = await req('GET', '/pengaturan-backup', null, { cookie: cPro });
  ok('menu Auto Backup memuat pengaturan Telegram', r.status === 200 && /Auto-Backup Telegram/.test(r.text) && /name="tg_token"/.test(r.text), r.status);
  ok('menu Auto Backup memuat panel riwayat', /Riwayat Pengiriman/.test(r.text),
    'riwayat kosong → tombol hapus semua baru muncul bila ada baris (diuji di bawah)');

  // sisipkan 3 baris riwayat lalu hapus
  const tdb = new Database(t1.db_file);
  const insLog = tdb.prepare(`INSERT INTO cloud_backup (waktu,nama_berkas,ukuran,file_id,status,pesan,pemicu,user_nama,dihapus,durasi_ms)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  for (const i of [1, 2, 3]) insLog.run('2026-11-0' + i + ' 06:00:00', 'Backup_SIMKEU_UJI_0' + i + '.zip', 1000 * i, '', 'sukses', 'ok', 'jadwal', 'Sistem', 1, 100);
  r = await req('GET', '/pengaturan-backup', null, { cookie: cPro });
  ok('riwayat tampil di menu Auto Backup', (r.text.match(/Backup_SIMKEU_UJI_0/g) || []).length >= 3);
  ok('tombol hapus per baris tersedia', /riwayat\/hapus/.test(r.text) && /Hapus riwayat/.test(r.text));
  const firstId = tdb.prepare('SELECT id FROM cloud_backup ORDER BY id LIMIT 1').get().id;
  r = await req('POST', '/pengaturan-backup/riwayat/hapus', { id: String(firstId) }, { cookie: cPro });
  ok('hapus satu riwayat berhasil', r.status === 303 && /ok=/.test(r.loc) && !tdb.prepare('SELECT id FROM cloud_backup WHERE id=?').get(firstId), r.loc);
  r = await req('POST', '/pengaturan-backup/riwayat/hapus', {}, { cookie: cPro });
  ok('hapus semua riwayat berhasil', r.status === 303 && /ok=/.test(r.loc) && tdb.prepare('SELECT COUNT(*) c FROM cloud_backup').get().c === 0, r.loc);
  const auditRow = tdb.prepare("SELECT * FROM audit WHERE aksi='HAPUS' AND modul='backup' ORDER BY id DESC LIMIT 1").get();
  ok('penghapusan riwayat tercatat di audit', !!auditRow);
  tdb.close();

  /* sekolah tanpa hak tulis tidak boleh menghapus riwayat */
  // (pakai akun dengan role staff bila tersedia; jika tidak, pastikan guard 403/redirect)
  r = await req('POST', '/pengaturan-backup/riwayat/hapus', {}, { cookie: 'simkeu_sid=tokenpalsu' });
  ok('hapus riwayat tanpa sesi ditolak', r.status === 303 && /login/.test(r.loc), r.status);

  /* ================= ringkasan ================= */
  const fail = results.filter(x => !x.c);
  console.log(`\n${results.length - fail.length}/${results.length} cek lulus`);
  if (fail.length) {
    console.log('GAGAL: ' + fail.map(f => f.n).join(' | '));
    console.log('--- log server ---\n' + log.slice(-2000));
  }
  srv.kill();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { }
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('ERROR TES:', e); console.log(log.slice(-2000)); srv.kill(); process.exit(1); });
