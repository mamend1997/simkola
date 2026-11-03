'use strict';
/**
 * ==================================================================
 * CONTROL PLANE SaaS — SIMKEU Multi-Tenant
 * ------------------------------------------------------------------
 * Database terpisah (data/saas.sqlite) berisi:
 *   tenants        daftar sekolah (kode 4 karakter, paket, masa aktif, lifetime)
 *   saas_users     akun Super Admin Pusat (terpisah dari akun sekolah)
 *   sessions       SEMUA sesi login (sekolah & super admin) + tenant_id
 *   saas_payments  tagihan & pengajuan perpanjangan (QRIS manual)
 *   saas_settings  pengaturan global: QRIS, harga paket, SMTP backup, dsb.
 *
 * Data sekolah TIDAK ada di sini — setiap sekolah punya berkas SQLite
 * sendiri (lihat dbm.openTenantConn / dbm.runAsTenant).
 * ==================================================================
 */
const path = require('path');
const fs = require('fs');
const lib = require('./lib');
const dbm = require('./db');

const S = dbm.controlDb;
S.pragma('journal_mode = WAL');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_code TEXT NOT NULL UNIQUE,
  nama TEXT NOT NULL,
  paket TEXT NOT NULL DEFAULT 'standard',
  status TEXT NOT NULL DEFAULT 'active',
  is_lifetime_free INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  registered_at TEXT,
  contact_nama TEXT, contact_email TEXT, contact_telp TEXT, alamat TEXT,
  db_file TEXT,
  logo TEXT, app_nama TEXT, tema TEXT,
  features TEXT,
  trial INTEGER NOT NULL DEFAULT 0,
  catatan TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS saas_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nama TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'super_admin',
  aktif INTEGER NOT NULL DEFAULT 1, created_at TEXT, last_login TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER,
  tenant_id INTEGER,
  kind TEXT NOT NULL DEFAULT 'tenant',
  expires_at TEXT,
  ta_id INTEGER,
  alert_pending INTEGER NOT NULL DEFAULT 0,
  imp_by INTEGER,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS saas_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  no_invoice TEXT,
  jenis TEXT NOT NULL DEFAULT 'perpanjangan',
  durasi INTEGER NOT NULL DEFAULT 30,
  nominal REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  bukti_url TEXT,
  pengirim TEXT,
  catatan TEXT,
  alasan TEXT,
  source TEXT DEFAULT 'tenant',
  periode_mulai TEXT,
  periode_akhir TEXT,
  dibuat_at TEXT,
  direview_at TEXT,
  direview_oleh TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS saas_settings (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS saas_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, user_nama TEXT, aksi TEXT,
  modul TEXT, detail TEXT, tenant_id INTEGER, created_at TEXT
);
CREATE TABLE IF NOT EXISTS saas_backup_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT, tenant_id INTEGER, nama_berkas TEXT,
  ukuran INTEGER, status TEXT, pesan TEXT, pemicu TEXT, tujuan TEXT, created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_saas_pay_tenant ON saas_payments(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_saas_sess ON sessions(token);
`;

S.exec(SCHEMA);

/* ---------------- pengaturan control plane ---------------- */
function get(k, d = '') {
  const r = S.prepare('SELECT v FROM saas_settings WHERE k=?').get(k);
  return r ? r.v : d;
}
function set(k, v) {
  S.prepare('INSERT INTO saas_settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(String(k), String(v ?? ''));
}
function settings() {
  const out = {};
  for (const r of S.prepare('SELECT k,v FROM saas_settings').all()) out[r.k] = r.v;
  return out;
}

const DEFAULT_SETTINGS = {
  saas_nama: 'SIMKEU Cloud',
  saas_logo: '',
  saas_tema: '#4F46E5',
  // pembayaran perpanjangan
  qris_image: '',
  qris_nama: '',
  qris_nomor: '',
  qris_instruksi: 'Setelah melakukan pembayaran, unggah bukti transfer pada halaman perpanjangan. Verifikasi dilakukan maksimal 1x24 jam kerja.',
  harga_bulan: '150000',
  harga_tahun: '1500000',
  trial_hari: '30',
  // auto-backup email (panel super admin)
  mail_aktif: '0',
  mail_to: '', mail_host: '', mail_port: '587', mail_secure: '0',
  mail_from: '', mail_user: '', mail_pass: '',
  backup_slots: '06:00,15:00',
  backup_last: ''
};
function initSettings() {
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    S.prepare('INSERT OR IGNORE INTO saas_settings (k,v) VALUES (?,?)').run(k, v);
  }
}
initSettings();

function appName() { return String(get('saas_nama', 'SIMKEU Cloud') || 'SIMKEU Cloud').trim(); }
function appLogo() { return String(get('saas_logo', '') || '').trim(); }
function tema() { return String(get('saas_tema', '#4F46E5') || '#4F46E5').trim(); }
function priceOf(durasi) {
  return Number(get(String(Number(durasi) >= 365 ? 'harga_tahun' : 'harga_bulan', '0')) || 0);
}
function defaultPriceMonth() { return Number(get('harga_bulan', '150000') || 0); }
function trialDays() { return Math.max(0, Number(get('trial_hari', '30') || 0)); }

/* ---------------- daftar fitur (feature flagging) ---------------- */
const FEATURES = [
  { key: 'dashboard', label: 'Dashboard', std: 1 },
  { key: 'transaksi', label: 'Transaksi Keuangan & Approval', std: 1 },
  { key: 'rekon', label: 'Rekonsiliasi Bank', std: 1 },
  { key: 'mutasi_kas', label: 'Mutasi Bank & Cash', std: 1 },
  { key: 'tutup_bulanan', label: 'Tutup BKU Bulanan', std: 1 },
  { key: 'piutang', label: 'Piutang Pegawai & SPP', std: 1 },
  { key: 'bku', label: 'Master BKU & Buku Pembantu', std: 1 },
  { key: 'coa', label: 'Kode Rekening (CoA)', std: 1 },
  { key: 'anggaran', label: 'Anggaran RAPBS', std: 1 },
  { key: 'saldo_awal', label: 'Saldo Awal', std: 1 },
  { key: 'aset', label: 'Aset Riil & Ledger', std: 1 },
  { key: 'import', label: 'Import Excel BKU', std: 1 },
  { key: 'tahun_ajaran', label: 'Tahun Pelajaran & Rollover', std: 1 },
  { key: 'laporan', label: 'Laporan & Export', std: 1 },
  { key: 'pengguna', label: 'Pengguna & Hak Akses', std: 1 },
  { key: 'sekolah', label: 'Identitas, Tema & Desain Cetak', std: 1 },
  { key: 'trash', label: 'Kotak Sampah', std: 1 },
  { key: 'audit', label: 'Audit Log', std: 1 },
  { key: 'backup', label: 'Backup & Restore Manual', std: 1 },
  { key: 'panduan', label: 'Petunjuk Pengguna', std: 1 },
  { key: 'piutang_lain', label: 'Piutang Sertifikasi', std: 0 },
  { key: 'piutang_lainnya', label: 'Piutang Lainnya', std: 0 },
  { key: 'siswa', label: 'Data Siswa', std: 0 },
  { key: 'kelas', label: 'Data Kelas', std: 0 },
  { key: 'program', label: 'Program Keahlian', std: 0 },
  { key: 'mutasi_kelas', label: 'Mutasi Kelas', std: 0 },
  { key: 'iuran', label: 'Grup Iuran, SPP & Antrean Posting', std: 0 },
  { key: 'pegawai', label: 'Data Pegawai', std: 0 },
  { key: 'payroll', label: 'Payroll & Leger Honor', std: 0 },
  { key: 'ekskul', label: 'Honor Pembina Ekskul', std: 0 },
  { key: 'beasiswa', label: 'Beasiswa SPP', std: 0 },
  { key: 'catatan', label: 'Catatan Pegawai & Orang Tua', std: 0 },
  { key: 'tarif_honor', label: 'Nominal Tunjangan & Honor', std: 0 },
  { key: 'backup_cloud', label: 'Auto-Backup Cloud & Email', std: 0 }
];
const FEATURE_MAP = FEATURES.reduce((m, f) => { m[f.key] = f; return m; }, {});

/**
 * Pemetaan alamat URL → fitur. Dipakai untuk MEMBLOKIR akses langsung
 * (direct URL) ketika fitur dimatikan Super Admin. Urutan penting:
 * awalan paling spesifik lebih dulu.
 */
const PATH_FEATURES = [
  ['/piutang-lainnya', 'piutang_lainnya'], ['/piutang-lain', 'piutang_lain'],
  ['/catatan-pegawai', 'catatan'], ['/catatan-orangtua', 'catatan'], ['/pesan-orangtua', 'catatan'],
  ['/mutasi-kelas', 'mutasi_kelas'], ['/program-keahlian', 'program'],
  ['/siswa-nonaktif', 'siswa'], ['/siswa', 'siswa'],
  ['/kelas', 'kelas'],
  ['/iuran', 'iuran'], ['/spp', 'iuran'],
  ['/payroll', 'payroll'], ['/pegawai', 'pegawai'],
  ['/ekskul', 'ekskul'], ['/beasiswa', 'beasiswa'],
  ['/tarif-honor', 'tarif_honor'],
  ['/pengaturan-backup', 'backup_cloud'],
  ['/backup', 'backup'],
  ['/tutup-bulanan', 'tutup_bulanan'], ['/rekon', 'rekon'], ['/mutasi-kas', 'mutasi_kas'],
  ['/transaksi', 'transaksi'], ['/approval', 'transaksi'],
  ['/import', 'import'], ['/anggaran', 'anggaran'], ['/saldo-awal', 'saldo_awal'],
  ['/bku', 'bku'], ['/coa', 'coa'], ['/aset', 'aset'],
  ['/tahun-ajaran', 'tahun_ajaran'],
  ['/laporan', 'laporan'], ['/cetak', 'laporan'], ['/export', 'laporan'],
  ['/pengguna', 'pengguna'], ['/audit', 'audit'], ['/trash', 'trash'],
  ['/sekolah', 'sekolah'], ['/tema', 'sekolah'], ['/desain-cetak', 'sekolah'],
  ['/tampilan-menu', 'pengguna'], ['/petunjuk', 'panduan'],
  ['/piutang', 'piutang']
];

function featureDefaults(paket) {
  const out = {};
  for (const f of FEATURES) out[f.key] = paket === 'pro' ? 1 : (f.std ? 1 : 0);
  return out;
}
function parseFeatures(raw, paket) {
  const base = featureDefaults(paket);
  let obj = {};
  try { obj = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {}); } catch (e) { obj = {}; }
  const out = {};
  for (const f of FEATURES) out[f.key] = (obj[f.key] === undefined) ? base[f.key] : (Number(obj[f.key]) ? 1 : 0);
  return out;
}
function tenantFeatures(t) {
  if (!t) return featureDefaults('pro');
  return parseFeatures(t.features, t.paket || 'standard');
}
function enabledKeys(t) {
  const f = tenantFeatures(t);
  return FEATURES.filter(x => f[x.key]).map(x => x.key);
}
/** fitur yang dimatikan untuk path ini (null = tidak dibatasi) */
function blockedFeature(t, pathname) {
  if (!t) return null;
  const on = tenantFeatures(t);
  for (const [prefix, key] of PATH_FEATURES) {
    if (pathname === prefix || pathname.startsWith(prefix + '/') || pathname.startsWith(prefix + '?')) {
      return on[key] ? null : (FEATURE_MAP[key] ? FEATURE_MAP[key].label : key);
    }
  }
  return null;
}

/* ---------------- tenant (sekolah) ---------------- */
const PAKET = { standard: 'Standard', pro: 'Pro' };

function allTenants() {
  return S.prepare('SELECT * FROM tenants ORDER BY id').all();
}
function tenantById(id) {
  return S.prepare('SELECT * FROM tenants WHERE id=?').get(Number(id) || 0) || null;
}
function tenantByCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return null;
  return S.prepare('SELECT * FROM tenants WHERE upper(school_code)=?').get(c) || null;
}
function codeExists(code, exceptId) {
  const r = S.prepare('SELECT id FROM tenants WHERE upper(school_code)=upper(?)').get(String(code || ''));
  return !!(r && Number(r.id) !== Number(exceptId || 0));
}
function normalizeCode(raw) {
  return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
}
/** kode sekolah unik 4 karakter (SK01, SK02, …) */
function nextSchoolCode() {
  const used = new Set(allTenants().map(t => String(t.school_code || '').toUpperCase()));
  for (let i = 1; i <= 99; i++) {
    const c = 'SK' + String(i).padStart(2, '0');
    if (!used.has(c)) return c;
  }
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (const a of letters) for (const b of letters) {
    const c = 'S' + a + b;
    if (!used.has(c)) return c;
  }
  throw new Error('Kode sekolah sudah habis (maksimum 999 sekolah).');
}

function todayISO() { return lib.todayISO(); }
function addDays(iso, days) {
  const d = new Date(String(iso || todayISO()).slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}
function daysBetween(fromISO, toISO) {
  const a = new Date(String(fromISO).slice(0, 10) + 'T00:00:00Z');
  const b = new Date(String(toISO).slice(0, 10) + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

/** status lengkap satu sekolah (lifetime selalu menang) */
function statusOf(t) {
  if (!t) return { key: 'none', label: 'Tidak ditemukan', color: 'gray', daysLeft: null };
  const today = todayISO();
  if (Number(t.is_lifetime_free)) {
    return { key: 'lifetime', label: 'Aktif (Lifetime)', color: 'green', daysLeft: null };
  }
  const exp = t.expires_at ? String(t.expires_at).slice(0, 10) : '';
  const days = exp ? daysBetween(today, exp) : null;
  if (days !== null && days < 0) return { key: 'expired', label: 'Kadaluarsa', color: 'red', daysLeft: days };
  if (String(t.status) === 'suspended') return { key: 'suspended', label: 'Ditangguhkan', color: 'red', daysLeft: days };
  if (days !== null && days <= 7) return { key: 'soon', label: 'Segera Berakhir', color: 'amber', daysLeft: days };
  return { key: 'active', label: 'Aktif', color: 'green', daysLeft: days };
}
/** akun yang harus diblokir (lifetime kebal auto-suspend) */
function isBlocked(t) {
  if (!t) return true;
  if (Number(t.is_lifetime_free)) return false;
  const st = statusOf(t);
  return st.key === 'expired' || st.key === 'suspended';
}

function logSaas(user, aksi, modul, detail, tenantId) {
  try {
    S.prepare('INSERT INTO saas_audit (user_id,user_nama,aksi,modul,detail,tenant_id,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(user ? user.id : null, user ? user.nama : 'sistem', aksi, modul, detail || '', tenantId || null, lib.nowStamp());
  } catch (e) { }
}

/**
 * Buat sekolah baru: baris tenant di control plane + database sendiri
 * (skema lengkap, master dasar, akun admin sekolah).
 */
function createTenant(input = {}) {
  const nama = String(input.nama || '').trim();
  if (!nama) throw new Error('Nama sekolah wajib diisi.');
  const email = String(input.admin_email || '').trim();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Email admin sekolah tidak valid.');
  const paket = ['standard', 'pro'].includes(String(input.paket)) ? String(input.paket) : 'standard';
  let code = normalizeCode(input.school_code);
  if (code) {
    if (code.length !== 4) throw new Error('Kode sekolah harus 4 karakter (huruf/angka).');
    if (codeExists(code)) throw new Error('Kode sekolah ' + code + ' sudah dipakai sekolah lain.');
  } else {
    code = nextSchoolCode();
  }
  const lifetime = Number(input.is_lifetime_free) ? 1 : 0;
  const trial = input.trial === false ? false : !lifetime;
  const days = Number(input.days || (input.trial === false ? 365 : trialDays()) || 30);
  const expires = input.expires_at ? String(input.expires_at).slice(0, 10)
    : (lifetime ? null : addDays(todayISO(), days));
  const now = lib.nowStamp();

  const info = S.prepare(`INSERT INTO tenants
    (school_code,nama,paket,status,is_lifetime_free,expires_at,registered_at,contact_nama,contact_email,contact_telp,alamat,
     db_file,logo,app_nama,tema,features,trial,catatan,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(code, nama, paket, 'active', lifetime, expires, todayISO(),
      String(input.contact_nama || input.admin_nama || ''), email, String(input.contact_telp || ''),
      String(input.alamat || ''), '', String(input.logo || ''),
      String(input.app_nama || ''), String(input.tema || ''),
      JSON.stringify(featureDefaults(paket)), lifetime ? 0 : (trial ? 1 : 0),
      String(input.catatan || ''), now, now);
  const id = Number(info.lastInsertRowid);
  // berkas database sekolah baru mengikuti folder database utama (DB_PATH),
  // bukan selalu folder data aplikasi — supaya tes dengan DB sementara tidak menulis ke folder live
  const file = path.join(path.dirname(dbm.DB_PATH), 'tenants', 'tenant-' + id + '.db');
  S.prepare('UPDATE tenants SET db_file=? WHERE id=?').run(file, id);
  const tenant = tenantById(id);

  dbm.createTenantDatabase({
    id, file, school_code: code, nama,
    admin_email: email,
    admin_password: String(input.admin_password || 'sekolah123'),
    admin_nama: String(input.admin_nama || 'Administrator Sekolah'),
    alamat: String(input.alamat || ''),
    kepala: String(input.kepala || ''),
    app_nama: String(input.app_nama || ''),
    tema: String(input.tema || '')
  });
  logSaas(input.user, 'TAMBAH SEKOLAH', 'tenant', `Sekolah ${nama} (${code}) paket ${PAKET[paket]}${lifetime ? ' · LIFETIME' : ' · s.d. ' + expires}`, id);
  return tenant;
}

function updateTenant(id, patch = {}) {
  const t = tenantById(id);
  if (!t) throw new Error('Sekolah tidak ditemukan.');
  const f = Object.assign({}, t, patch);
  if (patch.school_code !== undefined) {
    const code = normalizeCode(patch.school_code);
    if (code.length !== 4) throw new Error('Kode sekolah harus 4 karakter.');
    if (codeExists(code, id)) throw new Error('Kode sekolah ' + code + ' sudah dipakai.');
    f.school_code = code;
  }
  if (f.paket && !PAKET[f.paket]) throw new Error('Paket tidak dikenal.');
  S.prepare(`UPDATE tenants SET school_code=?,nama=?,paket=?,status=?,is_lifetime_free=?,expires_at=?,
      contact_nama=?,contact_email=?,contact_telp=?,alamat=?,app_nama=?,tema=?,logo=?,catatan=?,features=?,updated_at=? WHERE id=?`)
    .run(f.school_code, String(f.nama || '').trim() || t.nama, f.paket || 'standard', f.status || 'active',
      Number(f.is_lifetime_free) ? 1 : 0, f.expires_at ? String(f.expires_at).slice(0, 10) : null,
      f.contact_nama || '', f.contact_email || '', f.contact_telp || '', f.alamat || '',
      f.app_nama || '', f.tema || '', f.logo || '', f.catatan || '',
      typeof f.features === 'string' ? f.features : JSON.stringify(f.features || featureDefaults(f.paket || 'standard')),
      lib.nowStamp(), id);
  logSaas(patch.user, 'EDIT SEKOLAH', 'tenant', `Memperbarui sekolah ${f.nama} (${f.school_code})`, id);
  return tenantById(id);
}

function setFeatures(id, map, user) {
  const t = tenantById(id);
  if (!t) throw new Error('Sekolah tidak ditemukan.');
  const clean = parseFeatures(map, t.paket);
  S.prepare('UPDATE tenants SET features=?,updated_at=? WHERE id=?').run(JSON.stringify(clean), lib.nowStamp(), id);
  const off = Object.keys(clean).filter(k => !clean[k]);
  logSaas(user, 'FITUR SEKOLAH', 'tenant', `${t.nama}: ${Object.keys(clean).length - off.length} fitur aktif` + (off.length ? `, dimatikan: ${off.join(', ')}` : ''), id);
  return clean;
}
function setLifetime(id, on, user) {
  const t = tenantById(id);
  if (!t) throw new Error('Sekolah tidak ditemukan.');
  if (Number(on)) {
    S.prepare("UPDATE tenants SET is_lifetime_free=1,status='active',expires_at=NULL,updated_at=? WHERE id=?").run(lib.nowStamp(), id);
    logSaas(user, 'LIFETIME ON', 'tenant', `${t.nama} (${t.school_code}) dibebaskan dari penagihan & auto-suspend`, id);
  } else {
    const exp = t.expires_at && String(t.expires_at).slice(0, 10) >= todayISO() ? t.expires_at : addDays(todayISO(), 30);
    S.prepare("UPDATE tenants SET is_lifetime_free=0,expires_at=?,updated_at=? WHERE id=?").run(exp, lib.nowStamp(), id);
    logSaas(user, 'LIFETIME OFF', 'tenant', `${t.nama} (${t.school_code}) kembali berlangganan, aktif s.d. ${exp}`, id);
  }
  return tenantById(id);
}
function extendTenant(id, days, user, sumber) {
  const t = tenantById(id);
  if (!t) throw new Error('Sekolah tidak ditemukan.');
  const base = t.expires_at && String(t.expires_at).slice(0, 10) > todayISO() ? String(t.expires_at).slice(0, 10) : todayISO();
  const end = addDays(base, Number(days));
  S.prepare("UPDATE tenants SET expires_at=?,status='active',updated_at=? WHERE id=?").run(end, lib.nowStamp(), id);
  logSaas(user, 'PERPANJANG', 'tenant', `${t.nama} +${days} hari → aktif s.d. ${end}${sumber ? ' (' + sumber + ')' : ''}`, id);
  return end;
}
function deleteTenant(id, user) {
  const t = tenantById(id);
  if (!t) throw new Error('Sekolah tidak ditemukan.');
  if (Number(id) === 1) throw new Error('Sekolah pertama (tenant 1) tidak boleh dihapus — berisi data produksi.');
  S.prepare('DELETE FROM saas_payments WHERE tenant_id=?').run(id);
  S.prepare('DELETE FROM sessions WHERE tenant_id=?').run(id);
  S.prepare('DELETE FROM tenants WHERE id=?').run(id);
  logSaas(user, 'HAPUS SEKOLAH', 'tenant', `${t.nama} (${t.school_code}) dihapus dari daftar`, id);
  try {
    const conn = dbm.openTenantConn(id, t.db_file);
    conn.close();
    if (t.db_file && fs.existsSync(t.db_file)) fs.renameSync(t.db_file, t.db_file + '.dihapus-' + Date.now());
  } catch (e) { }
  return true;
}

/* ---------------- tagihan & pembayaran perpanjangan ---------------- */
const PAY_STATUS = {
  pending: { label: 'Menunggu Verifikasi', color: 'amber' },
  approved: { label: 'Disetujui', color: 'green' },
  rejected: { label: 'Ditolak', color: 'red' },
  issued: { label: 'Tagihan Terbit', color: 'blue' },
  cancelled: { label: 'Dibatalkan', color: 'gray' }
};

function paymentsOf(tenantId, limit = 50) {
  return S.prepare('SELECT * FROM saas_payments WHERE tenant_id=? ORDER BY id DESC LIMIT ?').all(Number(tenantId) || 0, Number(limit) || 50);
}
function paymentsAll(status) {
  const q = `SELECT p.*, t.nama sekolah_nama, t.school_code FROM saas_payments p
    JOIN tenants t ON t.id=p.tenant_id` + (status ? ' WHERE p.status=?' : '') + ' ORDER BY p.id DESC LIMIT 300';
  return status ? S.prepare(q).all(status) : S.prepare(q).all();
}
function paymentById(id) {
  return S.prepare('SELECT p.*, t.nama sekolah_nama, t.school_code FROM saas_payments p JOIN tenants t ON t.id=p.tenant_id WHERE p.id=?').get(Number(id) || 0) || null;
}
function pendingPayment(tenantId) {
  return S.prepare("SELECT * FROM saas_payments WHERE tenant_id=? AND status='pending' ORDER BY id DESC LIMIT 1").get(Number(tenantId) || 0) || null;
}
function latestRejected(tenantId) {
  return S.prepare("SELECT * FROM saas_payments WHERE tenant_id=? AND status='rejected' ORDER BY id DESC LIMIT 1").get(Number(tenantId) || 0) || null;
}
function invoiceNo(id) {
  return 'INV-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(id).padStart(4, '0');
}

/** pengajuan perpanjangan dari sisi sekolah (QRIS manual) */
function submitPayment(tenantId, { durasi, bukti_url, pengirim, catatan }) {
  const t = tenantById(tenantId);
  if (!t) throw new Error('Sekolah tidak ditemukan.');
  if (Number(t.is_lifetime_free)) throw new Error('Sekolah ini berstatus Lifetime — tidak perlu perpanjangan.');
  const d = Number(durasi) === 365 ? 365 : 30;
  if (!bukti_url) throw new Error('Bukti transfer wajib diunggah.');
  const p = pendingPayment(tenantId);
  if (p) throw new Error('Masih ada pengajuan yang menunggu verifikasi. Tunggu persetujuan Super Admin sebelum mengirim lagi.');
  const now = lib.nowStamp();
  const info = S.prepare(`INSERT INTO saas_payments
    (tenant_id,no_invoice,jenis,durasi,nominal,status,bukti_url,pengirim,catatan,source,periode_mulai,dibuat_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(tenantId, '', 'perpanjangan', d, priceOf(d), 'pending', String(bukti_url),
      String(pengirim || ''), String(catatan || ''), 'tenant', t.expires_at || todayISO(), now, now);
  const id = Number(info.lastInsertRowid);
  S.prepare('UPDATE saas_payments SET no_invoice=? WHERE id=?').run(invoiceNo(id), id);
  logSaas(null, 'PENGAJUAN BAYAR', 'pembayaran', `${t.nama} mengirim bukti transfer ${d} hari (Rp ${priceOf(d).toLocaleString('id-ID')})`, tenantId);
  return id;
}

function approvePayment(id, user) {
  const p = paymentById(id);
  if (!p) throw new Error('Pengajuan tidak ditemukan.');
  if (p.status !== 'pending') throw new Error('Pengajuan ini sudah diproses (' + (PAY_STATUS[p.status] || {}).label + ').');
  const t = tenantById(p.tenant_id);
  const base = t.expires_at && String(t.expires_at).slice(0, 10) > todayISO() ? String(t.expires_at).slice(0, 10) : todayISO();
  const end = extendTenant(t.id, p.durasi, user || { nama: 'Super Admin' }, 'verifikasi pembayaran');
  S.prepare(`UPDATE saas_payments SET status='approved', direview_at=?, direview_oleh=?, periode_mulai=?, periode_akhir=?, alasan=''
    WHERE id=?`).run(lib.nowStamp(), (user && user.nama) || 'Super Admin', base, end, id);
  // tagihan "issued" lama untuk sekolah ini dianggap selesai
  S.prepare("UPDATE saas_payments SET status='approved' WHERE tenant_id=? AND status='issued'").run(t.id);
  return { tenant: tenantById(t.id), end };
}
function rejectPayment(id, alasan, user) {
  const p = paymentById(id);
  if (!p) throw new Error('Pengajuan tidak ditemukan.');
  if (p.status !== 'pending') throw new Error('Pengajuan ini sudah diproses.');
  if (!String(alasan || '').trim()) throw new Error('Alasan penolakan wajib diisi.');
  S.prepare("UPDATE saas_payments SET status='rejected', alasan=?, direview_at=?, direview_oleh=? WHERE id=?")
    .run(String(alasan).trim(), lib.nowStamp(), (user && user.nama) || 'Super Admin', id);
  logSaas(user, 'TOLAK BAYAR', 'pembayaran', `${p.sekolah_nama}: ${alasan}`, p.tenant_id);
  return true;
}

/** cron harian: terbitkan tagihan H-7 + tangguhkan yang sudah kedaluwarsa */
function runDailyJobs() {
  const today = todayISO();
  const out = { invoices: 0, suspended: 0 };
  for (const t of allTenants()) {
    if (Number(t.is_lifetime_free)) continue;
    const exp = t.expires_at ? String(t.expires_at).slice(0, 10) : '';
    if (!exp) continue;
    const days = daysBetween(today, exp);
    // 1) tagihan H-7 — juga diterbitkan untuk sekolah yang sudah lewat masa aktif
    //    (tagihan tetap dibutuhkan agar sekolah bisa memperpanjang)
    if (days <= 7) {
      const ada = S.prepare("SELECT id FROM saas_payments WHERE tenant_id=? AND jenis='tagihan' AND periode_mulai=? AND status='issued'")
        .get(t.id, exp);
      if (!ada) {
        const now = lib.nowStamp();
        const info = S.prepare(`INSERT INTO saas_payments
          (tenant_id,no_invoice,jenis,durasi,nominal,status,source,periode_mulai,periode_akhir,dibuat_at,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
          .run(t.id, '', 'tagihan', 30, priceOf(30), 'issued', 'cron', exp, addDays(exp, 30), now, now);
        const id = Number(info.lastInsertRowid);
        S.prepare('UPDATE saas_payments SET no_invoice=? WHERE id=?').run(invoiceNo(id), id);
        logSaas(null, 'TAGIHAN H-7', 'pembayaran', `${t.nama} — tagihan perpanjangan (aktif s.d. ${exp}, ${days} hari lagi)`, t.id);
        out.invoices++;
      }
    }
    // 2) auto-suspend setelah masa berlaku habis (lifetime sudah dilewati di atas)
    if (days < 0 && String(t.status) !== 'suspended') {
      S.prepare("UPDATE tenants SET status='suspended',updated_at=? WHERE id=?").run(lib.nowStamp(), t.id);
      logSaas(null, 'AUTO SUSPEND', 'tenant', `${t.nama} ditangguhkan otomatis (masa aktif berakhir ${exp})`, t.id);
      out.suspended++;
    }
  }
  return out;
}

/* ---------------- sesi login (control plane) ---------------- */
const SESSION_DAYS = 14;
function createSession({ userId, tenantId, kind, alertPending }) {
  const token = lib.token(24);
  const exp = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  S.prepare('INSERT INTO sessions (token,user_id,tenant_id,kind,expires_at,alert_pending,ta_id,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(token, userId || null, tenantId || null, kind || 'tenant', exp, alertPending || 0, null, lib.nowStamp());
  return token;
}
function getSession(token) {
  if (!token) return null;
  const s = S.prepare('SELECT * FROM sessions WHERE token=?').get(token);
  if (!s) return null;
  if (new Date(String(s.expires_at).replace(' ', 'T')) < new Date()) {
    S.prepare('DELETE FROM sessions WHERE token=?').run(token);
    return null;
  }
  return s;
}
function destroySession(token) {
  if (token) S.prepare('DELETE FROM sessions WHERE token=?').run(token);
}
function updateSession(token, patch = {}) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  S.prepare(`UPDATE sessions SET ${keys.map(k => k + '=?').join(',')} WHERE token=?`).run(...keys.map(k => patch[k]), token);
}

/* ---------------- akun super admin pusat ---------------- */
function ensureAdmin() {
  const email = String(process.env.SAAS_ADMIN_EMAIL || 'super@simkeu.id').trim().toLowerCase();
  const pass = String(process.env.SAAS_ADMIN_PASSWORD || 'SuperAdmin2026!');
  const ada = S.prepare('SELECT id FROM saas_users WHERE role=? LIMIT 1').get('super_admin');
  if (ada) return { created: false, email };
  S.prepare('INSERT INTO saas_users (nama,email,password,role,aktif,created_at) VALUES (?,?,?,?,1,?)')
    .run('Super Admin Pusat', email, lib.hashPassword(pass), 'super_admin', lib.nowStamp());
  return { created: true, email, password: pass };
}
function findAdmin(email) {
  return S.prepare('SELECT * FROM saas_users WHERE lower(email)=lower(?)').get(String(email || '').trim()) || null;
}
function adminById(id) {
  return S.prepare('SELECT * FROM saas_users WHERE id=?').get(Number(id) || 0) || null;
}
function setAdminPassword(id, pass) {
  S.prepare('UPDATE saas_users SET password=? WHERE id=?').run(lib.hashPassword(pass), id);
}

/* ---------------- statistik dashboard ---------------- */
function stats() {
  const list = allTenants();
  const today = todayISO();
  let aktif = 0, lifetime = 0, suspended = 0, soon = 0;
  for (const t of list) {
    const st = statusOf(t);
    if (st.key === 'lifetime') { lifetime++; aktif++; }
    else if (st.key === 'expired' || st.key === 'suspended') suspended++;
    else { aktif++; if (st.key === 'soon') soon++; }
  }
  const pendapatan = S.prepare("SELECT COALESCE(SUM(nominal),0) v FROM saas_payments WHERE status='approved' AND direview_at LIKE ?").get(today.slice(0, 7) + '%').v;
  const menunggu = S.prepare("SELECT COUNT(*) c FROM saas_payments WHERE status='pending'").get().c;
  return { total: list.length, aktif, lifetime, suspended, soon, menunggu, pendapatan };
}

/* ---------------- bootstrap control plane ---------------- */
function ensureBootstrap() {
  const admin = ensureAdmin();
  if (!allTenants().length) {
    let nama = 'Sekolah Pertama';
    try {
      const r = dbm.rootDb.prepare("SELECT v FROM settings WHERE k='sekolah_nama'").get();
      if (r && r.v) nama = r.v;
    } catch (e) { }
    const now = lib.nowStamp();
    S.prepare(`INSERT INTO tenants (id,school_code,nama,paket,status,is_lifetime_free,expires_at,registered_at,
        contact_email,db_file,features,trial,catatan,created_at,updated_at)
      VALUES (1,'SK01',?,'pro','active',1,NULL,?,?,?,?,0,?,?,?)`)
      .run(nama, todayISO(), '', dbm.DB_PATH, JSON.stringify(featureDefaults('pro')),
        'Sekolah pertama — data produksi dipindahkan apa adanya (akses gratis seumur hidup).',
        now, now);
    logSaas(null, 'MIGRASI TENANT 1', 'tenant', `Sekolah pertama "${nama}" ditetapkan sebagai tenant 1 (kode SK01, lifetime)`, 1);
  }
  return admin;
}

module.exports = {
  db: S,
  C: S,
  FEATURES, FEATURE_MAP, PATH_FEATURES, PAKET, PAY_STATUS, SESSION_DAYS,
  get, set, settings, appName, appLogo, tema, priceOf, defaultPriceMonth, trialDays,
  featureDefaults, tenantFeatures, enabledKeys, blockedFeature, parseFeatures,
  allTenants, tenantById, tenantByCode, nextSchoolCode, normalizeCode, codeExists,
  createTenant, updateTenant, setFeatures, setLifetime, extendTenant, deleteTenant,
  statusOf, isBlocked, todayISO, addDays, daysBetween, logSaas,
  paymentsOf, paymentsAll, paymentById, pendingPayment, latestRejected, submitPayment,
  approvePayment, rejectPayment, runDailyJobs, stats, invoiceNo,
  createSession, getSession, destroySession, updateSession,
  ensureAdmin, findAdmin, adminById, setAdminPassword,
  ensureBootstrap
};
