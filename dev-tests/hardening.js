'use strict';
process.env.TZ = process.env.TZ || 'Asia/Jakarta';

const assert = require('assert');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const queue = require('../queue');
const bd = require('../backupdata');
const paygw = require('../paygw');
const X = require('../xlsx-read');
const lib = require('../lib');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'simkeu-hardening-'));
const PORT = 3900 + Math.floor(Math.random() * 1000);
const DB = path.join(TMP, 'school.db');
const SAAS_DB = path.join(TMP, 'saas.db');
const ADMIN_EMAIL = 'mfa-test@simkola.test';
const ADMIN_PASSWORD = 'MfaTest!2026Strong';
const BASE = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: {
    ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS_DB,
    DEMO_DB_PATH: path.join(TMP, 'demo.db'), SAAS_ADMIN_EMAIL: ADMIN_EMAIL,
    SAAS_ADMIN_PASSWORD: ADMIN_PASSWORD
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverLog = '';
server.stdout.on('data', d => { serverLog += d; });
server.stderr.on('data', d => { serverLog += d; });
let checks = 0;

function check(name, fn) {
  fn();
  checks++;
  console.log(`  ✓ ${name}`);
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(method, url, body, cookie = '', origin = '', extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (cookie) headers.Cookie = cookie;
  if (origin) headers.Origin = origin;
  let payload;
  if (body) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(body);
  }
  const response = await fetch(BASE + url, { method, headers, body: payload, redirect: 'manual' });
  return {
    status: response.status,
    text: await response.text(),
    location: response.headers.get('location') || '',
    setCookie: response.headers.get('set-cookie') || ''
  };
}
function cookieValue(header, name) {
  const match = new RegExp('(?:^|[,;]\\s*)' + name + '=([^;,]*)').exec(header);
  return match ? match[1] : '';
}
function base32Decode(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0;
  const bytes = [];
  for (const char of String(secret).replace(/=+$/g, '')) {
    const n = alphabet.indexOf(char);
    if (n < 0) throw new Error('Invalid Base32 test secret');
    value = (value << 5) | n;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
function totp(secret) {
  const counter = BigInt(Math.floor(Date.now() / 30000));
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(counter);
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const binary = ((hmac[offset] & 127) << 24) | ((hmac[offset + 1] & 255) << 16)
    | ((hmac[offset + 2] & 255) << 8) | (hmac[offset + 3] & 255);
  return String(binary % 1000000).padStart(6, '0');
}

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(BASE + '/healthz');
      if (r.status === 200) return;
    } catch (e) { }
    if (server.exitCode !== null) throw new Error('Server exited during startup:\n' + serverLog);
    await sleep(150);
  }
  throw new Error('Server did not become ready:\n' + serverLog);
}

async function main() {
  console.log('Hardening regression checks');
  await waitForServer();
  const health = await fetch(BASE + '/healthz');
  check('healthz reports readiness without private details', () => {
    assert.strictEqual(health.status, 200);
  });
  check('sandbox and unconfigured gateway callbacks fail closed', () => {
    assert.strictEqual(paygw.verifyCallback({ provider: 'sandbox' }, { paid: true }), false);
    assert.strictEqual(paygw.verifyCallback({ provider: 'midtrans' }, {}), false);
    assert.strictEqual(paygw.verifyCallback({ provider: 'duitku' }, {}), false);
    assert.strictEqual(paygw.verifyCallback({ provider: 'xendit' }, {}), false);
    assert.strictEqual(paygw.verifyCallback({ provider: 'kasera' }, {}), false);
    const midtrans = { order_id: 'O-1', status_code: '200', gross_amount: '1000.00' };
    midtrans.signature_key = crypto.createHash('sha512')
      .update(`${midtrans.order_id}${midtrans.status_code}${midtrans.gross_amount}mid-key`).digest('hex');
    assert.strictEqual(paygw.verifyCallback({ provider: 'midtrans', key: 'mid-key' }, midtrans), true);
    const duitku = { amount: '1000', merchantOrderId: 'O-2' };
    duitku.signature = crypto.createHash('md5').update(`M1${duitku.amount}${duitku.merchantOrderId}dui-key`).digest('hex');
    assert.strictEqual(paygw.verifyCallback({ provider: 'duitku', merchant: 'M1', key: 'dui-key' }, duitku), true);
    assert.strictEqual(paygw.verifyCallback({ provider: 'xendit', callback: 'x-token' }, {}, { 'x-callback-token': 'x-token' }), true);
  });

  let r = await request('POST', '/super-admin/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, '', '', { 'x-forwarded-proto': 'https' });
  check('first Super Admin login requires MFA setup', () => {
    assert.strictEqual(r.status, 303);
    assert.match(r.location, /\/super-admin\/mfa-setup$/);
    assert.ok(cookieValue(r.setCookie, 'simkeu_mfa'));
    assert.match(r.setCookie, /;\s*Secure/i);
  });
  const setupCookie = `simkeu_mfa=${cookieValue(r.setCookie, 'simkeu_mfa')}`;
  r = await request('GET', '/super-admin/mfa-setup', null, setupCookie);
  const secretMatch = /class="mono"[^>]*>([A-Z2-7]+)<\/p>/.exec(r.text);
  check('MFA setup displays authenticator secret and QR', () => {
    assert.strictEqual(r.status, 200);
    assert.ok(secretMatch);
    assert.match(r.text, /data:image\/png;base64,/);
  });

  const origin = BASE;
  r = await request('POST', '/super-admin/mfa-setup', { code: totp(secretMatch[1]) }, setupCookie, origin);
  const saasCookieValue = cookieValue(r.setCookie, 'simkeu_saas');
  check('TOTP enrollment issues one-time recovery codes and authenticated session', () => {
    assert.strictEqual(r.status, 200);
    assert.match(r.text, /MFA berhasil diaktifkan/);
    assert.strictEqual((r.text.match(/<code\b/g) || []).length, 10);
    assert.ok(saasCookieValue);
  });
  const saasCookie = `simkeu_saas=${saasCookieValue}`;
  const recovery = (/<code[^>]*>([a-f0-9-]+)<\/code>/.exec(r.text) || [])[1];
  check('recovery code is present once after enrollment', () => assert.ok(recovery));

  r = await request('POST', '/super-admin/logout', {}, saasCookie, 'https://attacker.invalid');
  check('cross-origin state-changing request is rejected', () => assert.strictEqual(r.status, 403));
  r = await request('GET', '/super-admin/keamanan', null, saasCookie);
  check('rejected CSRF request leaves the Super Admin session active', () => {
    assert.strictEqual(r.status, 200);
    assert.match(r.text, /Verifikasi Dua Langkah/);
  });

  await request('POST', '/super-admin/logout', {}, saasCookie, origin);
  r = await request('POST', '/super-admin/login', {
    email: ADMIN_EMAIL, password: ADMIN_PASSWORD, mfa_code: recovery
  });
  const recoveryLoginCookie = cookieValue(r.setCookie, 'simkeu_saas');
  check('one-time recovery code can complete login', () => {
    assert.strictEqual(r.status, 303);
    assert.ok(recoveryLoginCookie);
  });
  await request('POST', '/super-admin/logout', {}, `simkeu_saas=${recoveryLoginCookie}`, origin);
  r = await request('POST', '/super-admin/login', {
    email: ADMIN_EMAIL, password: ADMIN_PASSWORD, mfa_code: recovery
  });
  check('used recovery code cannot be reused', () => {
    assert.strictEqual(r.status, 200);
    assert.match(r.text, /Kode authenticator atau pemulihan tidak valid/);
  });

  r = await request('POST', '/super-admin/login', {
    email: ADMIN_EMAIL, password: ADMIN_PASSWORD, mfa_code: totp(secretMatch[1])
  });
  const loginCookie = cookieValue(r.setCookie, 'simkeu_saas');
  check('authenticator code works after setup', () => {
    assert.strictEqual(r.status, 303);
    assert.ok(loginCookie);
  });
  const schoolDb = new Database(DB, { readonly: true });
  const schoolDump = bd.dumpAll(schoolDb);
  schoolDb.close();
  r = await request('POST', '/super-admin/backup/validate', {
    file_b64: Buffer.from(JSON.stringify(schoolDump)).toString('base64'),
    tenant_id: '1'
  }, `simkeu_saas=${loginCookie}`, origin);
  check('Super Admin backup dry-run validates without restoring', () => {
    assert.strictEqual(r.status, 303);
    assert.match(decodeURIComponent(r.location), /Validasi JSON berhasil/);
  });

  for (let i = 0; i < 5; i++) {
    await request('POST', '/super-admin/login', { email: ADMIN_EMAIL, password: 'wrong-password' });
  }
  r = await request('POST', '/super-admin/login', {
    email: ADMIN_EMAIL, password: ADMIN_PASSWORD, mfa_code: totp(secretMatch[1])
  });
  check('failed login attempts trigger a temporary rate limit', () => {
    assert.strictEqual(r.status, 200);
    assert.match(r.text, /Terlalu banyak percobaan masuk/);
  });

  const schoolCookieLogin = await request('POST', '/login', {
    kode: 'SK01', email: 'admin@sekolah.sch.id', password: 'admin123'
  }, '', '', { 'x-forwarded-proto': 'https' });
  const schoolCookie = `simkeu_sid=${cookieValue(schoolCookieLogin.setCookie, 'simkeu_sid')}`;
  check('school login remains available after security changes', () => {
    assert.strictEqual(schoolCookieLogin.status, 303);
    assert.ok(schoolCookie.includes('simkeu_sid=') && !schoolCookie.endsWith('='));
    assert.match(schoolCookieLogin.setCookie, /;\s*Secure/i);
  });
  r = await request('POST', '/transaksi/save', {}, schoolCookie, 'https://attacker.invalid');
  check('tenant state changes also reject cross-origin requests', () => assert.strictEqual(r.status, 403));
  for (let i = 0; i < 5; i++) {
    await request('POST', '/login', {
      kode: 'SK01', email: 'admin@sekolah.sch.id', password: 'wrong-password'
    });
  }
  r = await request('POST', '/login', {
    kode: 'SK01', email: 'admin@sekolah.sch.id', password: 'admin123'
  });
  check('school login failures are rate-limited per identity', () => {
    assert.strictEqual(r.status, 303);
    assert.match(r.location, /Terlalu%20banyak%20percobaan/);
  });

  const qdb = new Database(':memory:');
  queue.init(qdb);
  qdb.prepare("INSERT INTO saas_jobs (jenis,status,created_at) VALUES ('old','done',?),('recent','done',?),('old-failed','failed',?)")
    .run(lib.plusDaysStamp(-10), lib.plusDaysStamp(-2), lib.plusDaysStamp(-10));
  check('queue retention deletes only completed jobs outside the requested window', () => {
    assert.strictEqual(queue.clearDone(7), 1);
    assert.strictEqual(qdb.prepare("SELECT COUNT(*) c FROM saas_jobs WHERE status='done'").get().c, 1);
    assert.strictEqual(qdb.prepare("SELECT COUNT(*) c FROM saas_jobs WHERE status='failed'").get().c, 1);
  });
  qdb.prepare("INSERT INTO saas_jobs (jenis,status,created_at) VALUES ('old-done','done',?)")
    .run(lib.plusDaysStamp(-40));
  check('daily queue cleanup applies the 30-day completed-job policy', () => {
    assert.strictEqual(queue.cleanupOldDone(), 1);
    assert.strictEqual(qdb.prepare("SELECT COUNT(*) c FROM saas_jobs WHERE status='done'").get().c, 0);
  });
  qdb.close();

  const bdb = new Database(':memory:');
  for (const table of bd.TABLES) bdb.exec(`CREATE TABLE "${table}" (id INTEGER PRIMARY KEY, value TEXT)`);
  bdb.prepare('INSERT INTO settings (value) VALUES (?)').run('backup-test');
  const dump = bd.dumpAll(bdb);
  const report = bd.validateDump(bdb, dump);
  check('backup dump reads a consistent complete table set', () => {
    assert.strictEqual(report.tables, bd.TABLES.length);
    assert.strictEqual(report.rows, 1);
  });
  const zip = bd.buildDatabaseZip(bdb);
  const entries = X.unzipEntries(zip.buffer);
  check('backup ZIP manifest verifies its database checksum', () => {
    assert.ok(bd.verifyZipManifest(entries));
    const tampered = { ...entries, 'database.json': Buffer.concat([entries['database.json'], Buffer.from('x')]) };
    assert.throws(() => bd.verifyZipManifest(tampered), /Checksum/);
  });
  const invalid = JSON.parse(JSON.stringify(dump));
  invalid.tables.settings = [{ id: 1, missing_column: 'x' }];
  check('restore validation rejects incompatible columns before writes', () => {
    assert.throws(() => bd.validateDump(bdb, invalid), /Kolom/);
  });
  const incompleteDb = new Database(':memory:');
  incompleteDb.exec('CREATE TABLE settings (id INTEGER PRIMARY KEY, value TEXT)');
  check('backup export fails visibly when an expected table is unavailable', () => {
    assert.throws(() => bd.dumpAll(incompleteDb));
  });
  incompleteDb.close();
  bdb.close();

  console.log(`\n${checks} hardening checks passed.`);
}

main().catch(error => {
  console.error('Hardening checks failed:', error);
  if (serverLog) console.error(serverLog);
  process.exitCode = 1;
}).finally(() => {
  try { server.kill('SIGTERM'); } catch (e) { }
  setTimeout(() => {
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { }
  }, 300);
});
