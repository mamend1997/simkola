'use strict';
process.env.TZ = process.env.TZ || 'Asia/Jakarta';

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'r50-'));
const DB = path.join(TMP, 'school.db');
const SDB = path.join(TMP, 'saas.db');
const PORT = process.env.R50_PORT || 3790;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, DB_PATH: DB, SAAS_DB_PATH: SDB, DEMO_DB_PATH: path.join(TMP, 'demo.db') },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
let cookie = '';
let pass = 0, fail = 0;
const fails = [];
const ok = (name, condition, detail = '') => {
  if (condition) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function req(method, url, body, noCookie = false) {
  const headers = {};
  if (!noCookie && cookie) headers.Cookie = cookie;
  let payload = null;
  if (body) {
    payload = new URLSearchParams(body).toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
  const setCookie = r.headers.get('set-cookie');
  if (setCookie && !noCookie) cookie = setCookie.split(';')[0];
  return { status: r.status, text: await r.text(), loc: r.headers.get('location') || '' };
}

(async () => {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { }
    await sleep(150);
  }
  const db = new Database(DB);
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);

  let r = await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login admin', r.status === 303, String(r.status));
  const activeTa = one('SELECT * FROM tahun_ajaran WHERE aktif=1 ORDER BY id LIMIT 1')
    || one('SELECT * FROM tahun_ajaran ORDER BY id DESC LIMIT 1');
  if (!activeTa) throw new Error('test database has no academic year');
  run('INSERT INTO tahun_ajaran (nama,tanggal_mulai,tanggal_selesai,aktif) VALUES (?,?,?,0)',
    'TA Historis R50', '2025-07-01', '2026-06-30');
  const oldTa = one("SELECT * FROM tahun_ajaran WHERE nama='TA Historis R50'");

  const createBku = (nama, kode, taId, rab) => {
    run(`INSERT INTO bku (nama,jenis,kode,tahun_ajaran_id,saldo_awal,rab,status,urutan,created_at)
      VALUES (?,'kegiatan',?,?,0,?,'aktif',90,?)`, nama, kode, taId, rab, '2026-07-01 08:00:00');
    return Number(one('SELECT last_insert_rowid() id').id);
  };
  const bkuId = createBku('BKU RAB R50', 'K50', activeTa.id, 1000000);
  const secondBkuId = createBku('BKU Tujuan R50', 'K51', activeTa.id, 0);
  r = await req('POST', '/bku/save', {
    id: bkuId, nama: 'BKU RAB R50', jenis: 'kegiatan', kode: 'K50',
    tahun_ajaran_id: activeTa.id, saldo_awal: '0', rab: '1000000'
  });
  ok('form Master BKU menyimpan pagu RAB', r.status === 303
    && Number(one('SELECT rab FROM bku WHERE id=?', bkuId).rab) === 1000000);
  run('INSERT INTO siswa (nisn,nama,jenis_kelamin,tahun_ajaran_id,status,created_at) VALUES (?,?,?,?,?,?)',
    '950000001', 'Siswa Uji R50', 'L', oldTa.id, 'aktif', '2025-07-01 08:00:00');
  const siswaId = Number(one('SELECT last_insert_rowid() id').id);
  run('INSERT INTO iuran_grup (nama,jenis,tahun_ajaran_id,aktif,created_at) VALUES (?,?,?,?,?)',
    'Grup Historis R50', 'nonbulanan', oldTa.id, 1, '2025-07-01 08:00:00');
  const grupId = Number(one('SELECT last_insert_rowid() id').id);
  run('INSERT INTO iuran_tagihan (grup_id,siswa_id,tahun_ajaran_id,nominal,created_at) VALUES (?,?,?,?,?)',
    grupId, siswaId, oldTa.id, 500000, '2025-07-01 08:00:00');
  const tagihanId = Number(one('SELECT last_insert_rowid() id').id);
  run(`INSERT INTO iuran_bayar (tagihan_id,siswa_id,tanggal,jumlah,potongan,dibayar,metode,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`, tagihanId, siswaId, '2025-07-15', 125000, 0, 125000, 'tunai', 'posted', '2025-07-15 09:00:00');
  run('INSERT INTO bku_iuran_grup (bku_id,grup_id) VALUES (?,?)', bkuId, grupId);
  run(`INSERT INTO transaksi (bku_id,tanggal,jenis,nominal,uraian,status,created_at)
    VALUES (?,?,'pengeluaran',?,'Belanja RAB R50','posted',?)`, bkuId, '2026-08-01', 700000, '2026-08-01 09:00:00');
  run(`INSERT INTO transaksi (bku_id,tanggal,jenis,nominal,uraian,status,created_at)
    VALUES (?,?,'pengeluaran',?,'Belanja RAB R50 kedua','posted',?)`, bkuId, '2026-08-02', 500000, '2026-08-02 09:00:00');

  r = await req('GET', `/bku/${bkuId}`);
  ok('Detail BKU merangkum tagihan lintas tahun ajaran', r.status === 200
    && r.text.includes('Ringkasan Grup Iuran Terhubung')
    && r.text.includes('TA Historis R50')
    && r.text.includes('Rp 500.000')
    && r.text.includes('Rp 125.000')
    && r.text.includes('Rp 375.000'));
  ok('RAB menandai pengeluaran terposting yang melampaui pagu', r.text.includes('Melebihi RAB')
    && r.text.includes('Rp 200.000'));
  run('UPDATE transaksi SET nominal=400000 WHERE bku_id=?', bkuId);
  r = await req('GET', `/bku/${bkuId}`);
  ok('RAB kembali dalam pagu setelah realisasi turun', r.text.includes('Dalam RAB'));
  run('UPDATE bku SET rab=0 WHERE id=?', bkuId);
  r = await req('GET', `/bku/${bkuId}`);
  ok('RAB nol ditampilkan sebagai belum diatur', r.text.includes('RAB belum diatur'));

  r = await req('GET', `/iuran/data/${siswaId}?ta=${oldTa.id}`);
  ok('BKU terhubung jadi default pada pembayaran dan pilihan item', r.status === 200
    && new RegExp(`<option value="${bkuId}" selected>`).test(r.text)
    && new RegExp(`data-bku="${bkuId}"`).test(r.text)
    && r.text.includes('masih bisa diubah'));
  r = await req('POST', '/bku/grup-iuran', { bku_id: secondBkuId, grup_id: String(grupId) });
  ok('Menghubungkan ulang grup memindahkannya dari BKU lama', r.status === 303
    && Number(one('SELECT bku_id FROM bku_iuran_grup WHERE grup_id=?', grupId).bku_id) === secondBkuId);
  ok('tabel relasi BKU–Grup Iuran masuk daftar backup', require('../backupdata').TABLES.includes('bku_iuran_grup'));

  const errors = log.split('\n').filter(line => /Unhandled|TypeError|ReferenceError|SyntaxError/.test(line));
  ok('server tidak mencatat error runtime', errors.length === 0, errors.slice(0, 2).join(' | '));
  db.close();
  srv.kill('SIGTERM');
  console.log(`\n=== ${pass} lulus, ${fail} gagal ===`);
  if (fail) { console.log('Gagal:\n - ' + fails.join('\n - ')); process.exitCode = 1; }
})().catch(e => {
  console.error('FATAL', e);
  console.log(log.slice(-4000));
  try { srv.kill('SIGTERM'); } catch (x) { }
  process.exitCode = 1;
});
