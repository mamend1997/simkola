'use strict';
/* Ronde 29 — Zona waktu aplikasi WIB (Asia/Jakarta)

   1. Proses & pustaka memakai Asia/Jakarta (TZ), offset +07:00, label WIB
   2. lib.nowStamp()/todayISO() = jam dinding WIB (bukan UTC); stempel tampil "DD-MM-YYYY HH:mm:ss WIB"
   3. SQL: fungsi now_wib()/today_wib() terdaftar di setiap koneksi (CURRENT_TIMESTAMP SQLite selalu UTC → tidak dipakai)
   4. Record baru (audit_log & transaksi/BKU) memakai jam WIB
   5. Migrasi sekali jalan: stempel waktu lama (UTC) digeser +7 jam, idempoten, bisa dinonaktifkan TZ_SHIFT_LEGACY=0
   6. Penjadwalan (pengingat WA) memakai jam WIB, bukan UTC
   7. Sesi login & OTP kedaluwarsa memakai jam WIB yang sama (tidak langsung kedaluwarsa)
   8. APP_TIMEZONE dapat diubah (WITA) & nilai tak dikenal kembali ke Asia/Jakarta
*/
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');

/* zona waktu test = WIB supaya perhitungan pembanding akurat */
process.env.TZ = 'Asia/Jakarta';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'r29-'));
const DB = path.join(TMP, 'k.sqlite');
const SAAS = path.join(TMP, 's.db');
const PORT = 3655;
const ROOT = path.join(__dirname, '..');
const base = `http://127.0.0.1:${PORT}`;

const results = [];
function ok(name, cond, extra = '') { results.push({ name, ok: !!cond, extra }); if (!cond) console.log('FAIL', name, '→', extra); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dec = s => { try { return decodeURIComponent(String(s)); } catch (e) { return String(s); } };
const p2 = n => String(n).padStart(2, '0');
/** jam dinding WIB dari sebuah Date */
function wibParts(d = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const o = {};
  for (const x of fmt.formatToParts(d)) if (x.type !== 'literal') o[x.type] = x.value;
  return o;
}
const wibStamp = (d = new Date()) => { const o = wibParts(d); return `${o.year}-${o.month}-${o.day} ${o.hour}:${o.minute}:${o.second}`; };
const wibToday = (d = new Date()) => { const o = wibParts(d); return `${o.year}-${o.month}-${o.day}`; };
/** selisih menit antara dua stempel "YYYY-MM-DD HH:MM:SS" */
function diffMin(a, b) {
  const t = s => new Date(String(s).replace(' ', 'T') + 'Z').getTime();
  return Math.round((t(a) - t(b)) / 60000);
}

function spawnServer(dbPath, saasPath, port, extraEnv = {}) {
  const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: {
      ...process.env, PORT: port, DB_PATH: dbPath, SAAS_DB_PATH: saasPath,
      DEMO_DB_PATH: path.join(TMP, 'demo-' + port + '.sqlite'), ...extraEnv
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.log = '';
  srv.stdout.on('data', d => { srv.log += d; });
  srv.stderr.on('data', d => { srv.log += d; });
  return srv;
}
async function waitUp(port) {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/login`)).status === 200) return true; } catch (e) { }
    await sleep(150);
  }
  return false;
}
/** jalankan skrip kecil di proses Node terpisah (env bersih, cwd = folder aplikasi) */
function nodeRun(script, env = {}) {
  const r = spawnSync(process.execPath, ['-e', script], {
    cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 90000
  });
  return { out: String(r.stdout || '').trim(), err: String(r.stderr || '').trim(), code: r.status };
}

(async () => {
  const srv = spawnServer(DB, SAAS, PORT);
  const up = await waitUp(PORT);
  ok('server start', up, srv.log.slice(-400));

  /* ============ 1. ZONA WAKTU PROSES & PUSTAKA ============ */
  ok('log startup mencantumkan WIB +07:00', /\[tz\] Asia\/Jakarta \(WIB \+07:00\)/.test(srv.log), srv.log.split('\n').slice(0, 4).join(' | '));
  ok('log startup mencantumkan jam WIB sekarang', /sekarang \d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2} WIB/.test(srv.log));

  const libProbe = nodeRun(`
    const lib = require('./lib');
    console.log(JSON.stringify({
      tz: process.env.TZ, envTz: process.env.APP_TIMEZONE,
      label: lib.tzLabel(), offset: lib.tzOffset(),
      now: lib.nowStamp(), today: lib.todayISO(),
      stamp: lib.stampID('2026-11-04 09:05:07'),
      short: lib.stampShort('2026-11-04 09:05:07'),
      plus: lib.plusMinutesStamp(10)
    }));
  `, { APP_TIMEZONE: 'Asia/Jakarta' });
  let probe = {};
  try { probe = JSON.parse(libProbe.out); } catch (e) { }
  ok('proses memakai TZ Asia/Jakarta', probe.tz === 'Asia/Jakarta', libProbe.out + libProbe.err);
  ok('APP_TIMEZONE tersimpan di env proses', probe.envTz === 'Asia/Jakarta', probe.envTz);
  ok('label zona = WIB & offset +07:00', probe.label === 'WIB' && probe.offset === '+07:00', `${probe.label}/${probe.offset}`);
  ok('nowStamp() = jam dinding WIB', Math.abs(diffMin(probe.now, wibStamp())) <= 2, `${probe.now} vs ${wibStamp()}`);
  ok('todayISO() = tanggal WIB', probe.today === wibToday(), `${probe.today} vs ${wibToday()}`);
  ok('format tampilan "DD-MM-YYYY HH:mm:ss WIB"', probe.stamp === '04-11-2026 09:05:07 WIB', probe.stamp);
  ok('format ringkas "DD-MM-YYYY HH:mm"', probe.short === '04-11-2026 09:05', probe.short);
  ok('plusMinutesStamp memakai jam WIB', probe.plus && probe.plus.slice(0, 10) === wibToday() && diffMin(probe.plus, probe.now) === 10, probe.plus);

  /* ============ 2. SQL: now_wib()/today_wib() ============ */
  const sqlProbe = nodeRun(`
    process.env.DB_PATH = ${JSON.stringify(DB)};
    process.env.SAAS_DB_PATH = ${JSON.stringify(SAAS)};
    const dbm = require('./db');
    const row = dbm.db.prepare("SELECT now_wib() n, today_wib() t, datetime('now') utc, datetime('now','localtime') loc").get();
    console.log(JSON.stringify(row));
  `, { DB_PATH: DB, SAAS_DB_PATH: SAAS });
  let sqlRow = {};
  try { sqlRow = JSON.parse(sqlProbe.out.split('\n').pop()); } catch (e) { }
  ok('fungsi SQL now_wib() tersedia', !!sqlRow.n, sqlProbe.out.slice(0, 160) + sqlProbe.err.slice(0, 160));
  ok('now_wib() = jam WIB (bukan UTC)', sqlRow.n && diffMin(sqlRow.n, wibStamp()) <= 2 && diffMin(sqlRow.n, sqlRow.utc) >= 400, `${sqlRow.n} vs utc ${sqlRow.utc}`);
  ok('today_wib() = tanggal WIB', sqlRow.t === wibToday(), `${sqlRow.t} vs ${wibToday()}`);
  ok("datetime('now','localtime') ikut TZ proses", sqlRow.loc && diffMin(sqlRow.loc, sqlRow.n) <= 1, `${sqlRow.loc} vs ${sqlRow.n}`);

  /* ============ 3. RECORD BARU: audit_log & transaksi (BKU) ============ */
  let cookie = '';
  async function req(method, url, body, opt = {}) {
    const headers = { Cookie: cookie };
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

  const db = new Database(DB, { readonly: false });
  const ta = db.prepare('SELECT * FROM tahun_ajaran ORDER BY id LIMIT 1').get();
  const bku = db.prepare('SELECT * FROM bku WHERE auto_mode=0 OR auto_mode IS NULL ORDER BY id LIMIT 1').get();
  const coa = db.prepare("SELECT * FROM coa WHERE kategori='pendapatan' LIMIT 1").get();

  let r = await req('POST', '/login', { kode: 'SK01', email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login admin sekolah', r.status === 303 && !/err=/.test(r.loc), dec(r.loc));

  r = await req('POST', '/transaksi/save', {
    bku_id: String(bku.id), tanggal: wibToday(), jenis: 'pemasukan', coa_id: String(coa.id),
    nominal: '1.500.000', uraian: 'Uji zona waktu WIB', metode: 'tunai', nama_pihak: 'Penguji WIB'
  });
  ok('simpan transaksi pemasukan', r.status === 303 && !/err=/.test(r.loc), dec(r.loc));
  const trx = db.prepare("SELECT * FROM transaksi WHERE uraian='Uji zona waktu WIB' ORDER BY id DESC LIMIT 1").get();
  ok('transaksi tersimpan', !!trx);
  ok('transaksi.created_at memakai jam WIB', trx && Math.abs(diffMin(trx.created_at, wibStamp())) <= 3,
    trx && `${trx.created_at} vs ${wibStamp()}`);
  ok('transaksi.tanggal = tanggal WIB', trx && trx.tanggal === wibToday(), trx && trx.tanggal);

  const audit = db.prepare("SELECT * FROM audit ORDER BY id DESC LIMIT 1").get();
  ok('audit_log.created_at memakai jam WIB', audit && Math.abs(diffMin(audit.created_at, wibStamp())) <= 3,
    audit && `${audit.created_at} vs ${wibStamp()}`);
  ok('audit_log tidak memakai jam UTC', audit && diffMin(wibStamp(), audit.created_at) < 400);

  const auditPage = await req('GET', '/audit');
  const auditHtml = auditPage.text;
  ok('halaman audit menampilkan "DD-MM-YYYY HH:mm:ss WIB"',
    /\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2} WIB/.test(auditHtml), (auditHtml.match(/\d{2}-\d{2}-\d{4}[^<]{0,20}/) || ['-'])[0]);

  /* ============ 4. SESI LOGIN: kedaluwarsa WIB ============ */
  const ctl = new Database(SAAS, { readonly: true });
  const sess = ctl.prepare('SELECT * FROM sessions ORDER BY rowid DESC LIMIT 1').get();
  ok('sesi tersimpan', !!sess);
  ok('expires_at sesi ≈ 14 hari (jam WIB)', sess && Math.abs(diffMin(sess.expires_at, wibStamp()) - 14 * 1440) <= 5,
    sess && `${sess.expires_at} vs ${wibStamp()}`);
  ok('sesi tidak langsung kedaluwarsa', sess && String(sess.expires_at) > wibStamp());

  /* ============ 5. OTP: kedaluwarsa WIB (dulu selalu dianggap kedaluwarsa) ============ */
  const otpDb = path.join(TMP, 'otp.sqlite');
  const otpProbe = nodeRun(`
    const dbm = require('./db');
    const c = dbm.otpCreate('piutang', 1, '628111222333', 10);
    const v = dbm.otpVerify(c.token, c.kode);
    console.log(JSON.stringify({ exp: c.expires_at, now: require('./lib').nowStamp(), ok: v.ok, err: v.err || '' }));
  `, { DB_PATH: otpDb, SAAS_DB_PATH: path.join(TMP, 'otp-saas.db') });
  let otp = {};
  try { otp = JSON.parse(otpProbe.out.split('\n').pop()); } catch (e) { }
  ok('OTP baru belum kedaluwarsa (jam WIB konsisten)', otp.ok === true, otpProbe.out.slice(0, 200) + otpProbe.err.slice(0, 200));
  ok('OTP expires_at memakai jam WIB', otp.exp && Math.abs(diffMin(otp.exp, otp.now) - 10) <= 2, `${otp.exp} vs ${otp.now}`);

  /* ============ 6. PENJADWALAN PENGINGAT memakai jam WIB ============ */
  // data minimal: 1 siswa dengan tunggakan
  await req('POST', '/kelas/save', { nama: 'XII WIB 1', tingkat: 'XII', wali_kelas: 'W', aktif: '1' });
  const kelas = db.prepare("SELECT * FROM kelas WHERE nama='XII WIB 1'").get();
  await req('POST', '/siswa/save', {
    nisn: '9001', nama: 'Siswa WIB', jenis_kelamin: 'L', tanggal_lahir: '2008-01-01',
    kelas_id: kelas.id, parent_phone: '081200000001'
  });
  const siswa = db.prepare("SELECT * FROM siswa WHERE nisn='9001'").get();
  await req('POST', '/iuran/save', {
    nama: 'SPP WIB', jenis: 'bulanan', mode_nominal: 'rata', nominal_rata: '100000', aktif: '1',
    tahun_ajaran_id: String(ta.id), jatuh_tempo: '10'
  });
  const grup = db.prepare("SELECT * FROM iuran_grup WHERE nama='SPP WIB'").get();
  await req('POST', `/iuran/grup/${grup.id}/tetapkan`, { kelas_id: String(kelas.id), siswa_id: [String(siswa.id)] });

  const wibNow = wibParts();
  const jamWib = `${wibNow.hour}:${wibNow.minute}`;
  // jam disetel ke jam WIB sekarang → harus dianggap jatuh tempo
  await req('POST', '/iuran/pengingat/simpan', {
    reminder_aktif: '1', reminder_mode: 'tanggal', reminder_tanggal: String(Number(wibNow.day)),
    reminder_tempo_hari: '3', reminder_jam: jamWib, reminder_template: 'Halo {nama_siswa}, tunggakan {nominal_tunggakan}. {link_portal}',
    reminder_base_url: '', iuran_jatuh_tempo: '10', wa_log_retensi: '90'
  });
  let set = db.prepare("SELECT v FROM settings WHERE k='reminder_jam'").get();
  ok('jam pengingat tersimpan', set && set.v === jamWib, set && set.v);
  r = await req('POST', '/iuran/pengingat/jadwal', {});
  ok('jadwal dijalankan pada jam WIB sekarang', /ok=/.test(r.loc) && /antrean|dijalankan|pesan/i.test(dec(r.loc)), dec(r.loc));
  const logWib = db.prepare("SELECT COUNT(*) c FROM wa_reminder_log").get().c;
  ok('pesan pengingat masuk antrean', logWib >= 1, String(logWib));

  // jam disetel 40 menit lalu (di luar toleransi 15 menit) → tidak boleh dijalankan
  const past = new Date(Date.now() - 40 * 60000);
  const pastWib = wibParts(past);
  await req('POST', '/iuran/pengingat/simpan', {
    reminder_aktif: '1', reminder_mode: 'tanggal', reminder_tanggal: String(Number(wibNow.day)),
    reminder_tempo_hari: '3', reminder_jam: `${pastWib.hour}:${pastWib.minute}`, reminder_template: 'Halo {nama_siswa}',
    reminder_base_url: '', iuran_jatuh_tempo: '10', wa_log_retensi: '90'
  });
  db.prepare('DELETE FROM wa_reminder_log').run();
  r = await req('POST', '/iuran/pengingat/jadwal', {});
  ok('jam yang sudah lewat (WIB) tidak dijalankan', /warn=/.test(r.loc), dec(r.loc));
  ok('tidak ada pesan baru saat jadwal lewat', db.prepare("SELECT COUNT(*) c FROM wa_reminder_log").get().c === 0);
  // bukti jam server = WIB (bukan UTC): selisih jam WIB vs UTC ±7 jam
  ok('selisih jam proses vs UTC = 7 jam', Number(wibNow.hour) === Number(new Date().getUTCHours()) + 7
    || Number(wibNow.hour) === (Number(new Date().getUTCHours()) + 7) % 24,
    `WIB ${wibNow.hour} vs UTC ${new Date().getUTCHours()}`);

  const legacyPort = PORT + 1;
  /* ============ 7. MIGRASI stempel waktu lama ============ */
  const legacyDb = path.join(TMP, 'legacy.sqlite');
  const legacySaas = path.join(TMP, 'legacy-saas.db');
  // 1) start sekali supaya skema asli aplikasi terbentuk
  const seedSrv = spawnServer(legacyDb, legacySaas, legacyPort);
  await waitUp(legacyPort);
  seedSrv.kill();
  await sleep(400);
  // 2) tiru database LAMA: stempel UTC + penanda migrasi dihapus
  const leg = new Database(legacyDb);
  leg.prepare("DELETE FROM settings WHERE k='mig_tz_wib_v1'").run();
  leg.prepare("UPDATE bku SET created_at='2026-11-01 02:30:15'").run();
  const taRow = leg.prepare('SELECT * FROM tahun_ajaran ORDER BY id LIMIT 1').get();
  const tglAsli = String(taRow.tanggal_mulai || '');
  const insAudit = leg.prepare("INSERT INTO audit (user_nama,aksi,modul,detail,created_at) VALUES ('admin','EDIT','uji','baris lama','2026-11-01 01:00:00')").run();
  const auditId = { id: Number(insAudit.lastInsertRowid) };
  leg.close();

  const legacySrv = spawnServer(legacyDb, legacySaas, legacyPort);
  await waitUp(legacyPort);
  const ldb = new Database(legacyDb, { readonly: true });
  const lAudit = ldb.prepare('SELECT created_at FROM audit WHERE id=?').get(auditId.id);
  const lBku = ldb.prepare('SELECT created_at FROM bku ORDER BY id LIMIT 1').get();
  const lFlag = ldb.prepare("SELECT v FROM settings WHERE k='mig_tz_wib_v1'").get();
  const lTa = ldb.prepare('SELECT tanggal_mulai FROM tahun_ajaran ORDER BY id LIMIT 1').get();
  ok('audit lama digeser +7 jam', lAudit && lAudit.created_at === '2026-11-01 08:00:00', lAudit && lAudit.created_at);
  ok('bku lama digeser +7 jam', lBku && lBku.created_at === '2026-11-01 09:30:15', lBku && lBku.created_at);
  ok('kolom tanggal murni TIDAK digeser', lTa && lTa.tanggal_mulai === tglAsli && /^\d{4}-\d{2}-\d{2}$/.test(lTa.tanggal_mulai),
    `${lTa && lTa.tanggal_mulai} (asli ${tglAsli})`);
  ok('penanda migrasi tersimpan', !!lFlag && String(lFlag.v).length > 0);
  ok('log migrasi muncul sekali', /\[tz-migrasi\] \d+ stempel waktu lama digeser \+7 jam/.test(legacySrv.log),
    (legacySrv.log.match(/\[tz-migrasi\][^\n]*/) || ['-'])[0]);
  ldb.close();
  legacySrv.kill();
  await sleep(400);

  // jalankan ulang → tidak boleh bergeser dua kali (idempoten)
  const legacySrv2 = spawnServer(legacyDb, legacySaas, legacyPort);
  await waitUp(legacyPort);
  const ldb2 = new Database(legacyDb, { readonly: true });
  ok('migrasi idempoten (tidak bergeser 2x)',
    ldb2.prepare('SELECT created_at FROM bku ORDER BY id LIMIT 1').get().created_at === '2026-11-01 09:30:15',
    ldb2.prepare('SELECT created_at FROM bku ORDER BY id LIMIT 1').get().created_at);
  ok('log migrasi tidak berulang', !/\[tz-migrasi\]/.test(legacySrv2.log), (legacySrv2.log.match(/\[tz-migrasi\][^\n]*/) || ['-'])[0]);
  ldb2.close();
  legacySrv2.kill();
  await sleep(300);

  // TZ_SHIFT_LEGACY=0 → tidak menggeser
  const noShiftDb = path.join(TMP, 'noshift.sqlite');
  const noShiftSaas = path.join(TMP, 'noshift-saas.db');
  const seedSrv2 = spawnServer(noShiftDb, noShiftSaas, legacyPort);
  await waitUp(legacyPort);
  seedSrv2.kill();
  await sleep(400);
  const ns = new Database(noShiftDb);
  ns.prepare("DELETE FROM settings WHERE k='mig_tz_wib_v1'").run();
  const insNs = ns.prepare("INSERT INTO audit (user_nama,aksi,modul,detail,created_at) VALUES ('admin','EDIT','uji','baris lama','2026-11-01 01:00:00')").run();
  const nsId = { id: Number(insNs.lastInsertRowid) };
  ns.close();
  const noShiftSrv = spawnServer(noShiftDb, noShiftSaas, legacyPort, { TZ_SHIFT_LEGACY: '0' });
  await waitUp(legacyPort);
  const ndb = new Database(noShiftDb, { readonly: true });
  ok('TZ_SHIFT_LEGACY=0 → stempel lama tidak digeser',
    ndb.prepare('SELECT created_at FROM audit WHERE id=?').get(nsId.id).created_at === '2026-11-01 01:00:00',
    ndb.prepare('SELECT created_at FROM audit WHERE id=?').get(nsId.id).created_at);
  ndb.close();
  noShiftSrv.kill();
  await sleep(300);

  /* ============ 8. APP_TIMEZONE kustom & tidak valid ============ */
  const wita = nodeRun(`const lib=require('./lib');console.log(JSON.stringify({tz:process.env.TZ,label:lib.tzLabel(),offset:lib.tzOffset()}));`,
    { APP_TIMEZONE: 'Asia/Makassar' });
  let w = {};
  try { w = JSON.parse(wita.out); } catch (e) { }
  ok('APP_TIMEZONE=Asia/Makassar → WITA +08:00', w.tz === 'Asia/Makassar' && w.label === 'WITA' && w.offset === '+08:00', wita.out + wita.err);

  const bad = nodeRun(`const lib=require('./lib');console.log(JSON.stringify({tz:process.env.TZ,warn:require('./tz').warning}));`,
    { APP_TIMEZONE: 'Mars/Olympus' });
  let b = {};
  try { b = JSON.parse(bad.out); } catch (e) { }
  ok('APP_TIMEZONE tak dikenal → kembali Asia/Jakarta', b.tz === 'Asia/Jakarta', bad.out + bad.err);
  ok('peringatan zona waktu tak dikenal tersedia', /tidak dikenal/.test(String(b.warn || '')), String(b.warn));

  const alias = nodeRun(`const lib=require('./lib');console.log(JSON.stringify({tz:process.env.TZ,label:lib.tzLabel()}));`,
    { APP_TIMEZONE: 'WIB' });
  let a = {};
  try { a = JSON.parse(alias.out); } catch (e) { }
  ok('alias "WIB" diterima', a.tz === 'Asia/Jakarta' && a.label === 'WIB', alias.out + alias.err);

  /* ============ 9. Kesimpulan ============ */
  try { db.close(); ctl.close(); srv.kill(); } catch (e) { }
  const pass = results.filter(x => x.ok).length;
  console.log(`\nround29: ${pass}/${results.length} cek lulus`);
  if (pass !== results.length) {
    console.log('GAGAL:', results.filter(x => !x.ok).map(x => x.name).join(' | '));
    console.log('LOG SERVER:\n' + srv.log.split('\n').slice(-20).join('\n'));
  }
  setTimeout(() => process.exit(pass === results.length ? 0 : 1), 300);
})().catch(e => { console.error(e); process.exit(1); });
