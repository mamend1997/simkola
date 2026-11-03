'use strict';
/**
 * ==================================================================
 * QUEUE WORKER — pekerjaan latar (cron backup, WA massal, invoicing)
 * ------------------------------------------------------------------
 * Semua proses berat TIDAK lagi dijalankan langsung di dalam request atau
 * di dalam satu loop cron besar. Job dimasukkan ke tabel `saas_jobs`
 * (control plane), lalu worker mengambil satu per satu (concurrency 1)
 * sehingga memory & waktu eksekusi tetap datar walau jumlah sekolah banyak.
 *
 * Fitur: status (pending/running/done/failed), percobaan ulang (maks 3),
 * penjadwalan tunda (`run_at`), dan pemulihan job "running" yang tertinggal
 * saat server restart (dikembalikan ke pending).
 * ==================================================================
 */
const lib = require('./lib');

const MAX_ATTEMPTS = 3;
const handlers = new Map();
let running = false;
let timer = null;
let dbRef = null;

function init(saasDb) {
  dbRef = saasDb;
  saasDb.exec(`
    CREATE TABLE IF NOT EXISTS saas_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jenis TEXT NOT NULL,
      payload TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      run_at TEXT,
      created_at TEXT,
      started_at TEXT,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_saas_jobs_status ON saas_jobs(status, id);
  `);
  // job yang tertinggal saat proses mati → kembalikan ke antrean
  saasDb.prepare("UPDATE saas_jobs SET status='pending' WHERE status='running'").run();
  return saasDb;
}

function register(jenis, fn) { handlers.set(String(jenis), fn); }

function push(jenis, payload = {}, opts = {}) {
  if (!dbRef) throw new Error('Queue belum diinisialisasi.');
  const runAt = opts.runAt || lib.nowStamp();
  const info = dbRef.prepare("INSERT INTO saas_jobs (jenis,payload,status,attempts,run_at,created_at) VALUES (?,?,'pending',0,?,?)")
    .run(String(jenis), JSON.stringify(payload || {}), runAt, lib.nowStamp());
  return Number(info.lastInsertRowid);
}

function stats() {
  if (!dbRef) return { pending: 0, running: 0, done: 0, failed: 0 };
  const rows = dbRef.prepare("SELECT status, COUNT(*) c FROM saas_jobs GROUP BY status").all();
  const out = { pending: 0, running: 0, done: 0, failed: 0 };
  for (const r of rows) out[r.status] = r.c;
  return out;
}
function recent(limit = 20) {
  if (!dbRef) return [];
  return dbRef.prepare('SELECT * FROM saas_jobs ORDER BY id DESC LIMIT ?').all(Number(limit) || 20);
}
function clearDone(days = 7) {
  if (!dbRef) return 0;
  return dbRef.prepare("DELETE FROM saas_jobs WHERE status='done' AND created_at < ?")
    .run(lib.todayISO()) && 0;
}

/** ambil satu job siap-jalan (FIFO) */
function take() {
  const row = dbRef.prepare("SELECT * FROM saas_jobs WHERE status='pending' AND (run_at IS NULL OR run_at<=?) ORDER BY id LIMIT 1")
    .get(lib.nowStamp());
  if (!row) return null;
  const upd = dbRef.prepare("UPDATE saas_jobs SET status='running',attempts=attempts+1,started_at=? WHERE id=? AND status='pending'")
    .run(lib.nowStamp(), row.id);
  if (!upd.changes) return null;
  return dbRef.prepare('SELECT * FROM saas_jobs WHERE id=?').get(row.id);
}

async function runOnce() {
  const job = take();
  if (!job) return null;
  const fn = handlers.get(job.jenis);
  let payload = {};
  try { payload = JSON.parse(job.payload || '{}'); } catch (e) { payload = {}; }
  try {
    if (!fn) throw new Error('Tidak ada handler untuk job "' + job.jenis + '".');
    const res = await fn(payload, job);
    dbRef.prepare("UPDATE saas_jobs SET status='done',finished_at=?,last_error=? WHERE id=?")
      .run(lib.nowStamp(), res && res.note ? String(res.note).slice(0, 500) : '', job.id);
    return { id: job.id, jenis: job.jenis, ok: true, result: res };
  } catch (e) {
    const attempts = Number(job.attempts) || 1;
    const failed = attempts >= MAX_ATTEMPTS;
    dbRef.prepare('UPDATE saas_jobs SET status=?,last_error=?,finished_at=? WHERE id=?')
      .run(failed ? 'failed' : 'pending', String(e && e.message || e).slice(0, 900), lib.nowStamp(), job.id);
    return { id: job.id, jenis: job.jenis, ok: false, error: String(e && e.message || e), retry: !failed };
  }
}

/** proses seluruh antrean (dipanggil manual/tes maupun oleh interval) */
async function drain(max = 50) {
  const out = [];
  for (let i = 0; i < max; i++) {
    const r = await runOnce();
    if (!r) break;
    out.push(r);
  }
  return out;
}

/** mulai worker periodik (idempoten) */
function start(intervalMs = 30000) {
  if (timer) return;
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await drain(20); } catch (e) { console.error('[queue]', e.message); }
    finally { running = false; }
  }, intervalMs);
  if (timer.unref) timer.unref();
  setTimeout(() => { if (!running) { running = true; drain(10).catch(() => { }).finally(() => { running = false; }); } }, 5000).unref();
}
function stop() { if (timer) { clearInterval(timer); timer = null; } }
function isRunning() { return running; }

module.exports = { init, register, push, stats, recent, clearDone, take, runOnce, drain, start, stop, isRunning, MAX_ATTEMPTS };
