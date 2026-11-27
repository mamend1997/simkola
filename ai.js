'use strict';

const crypto = require('crypto');

function escLike(v) { return String(v == null ? '' : v).trim(); }

function ensureTables(dbm) {
  dbm.db.exec(`
    CREATE TABLE IF NOT EXISTS ai_chat (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      user_nama TEXT,
      role TEXT,
      page TEXT,
      message TEXT,
      answer TEXT,
      actions TEXT,
      tool_used TEXT,
      created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ai_chat_user ON ai_chat(user_id, created_at);
    CREATE TABLE IF NOT EXISTS ai_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      scope TEXT,
      hits INTEGER NOT NULL DEFAULT 0,
      window_at TEXT,
      updated_at TEXT,
      UNIQUE(user_id, scope)
    );
  `);
}

function historyAdd(dbm, req, data) {
  ensureTables(dbm);
  dbm.db.prepare(`INSERT INTO ai_chat (user_id,user_nama,role,page,message,answer,actions,tool_used,created_at)
    VALUES (?,?,?,?,?,?,?,?,now_wib())`).run(
    req.user ? req.user.id : null,
    req.user ? req.user.nama : 'Pengunjung',
    req.user ? req.user.role : '',
    escLike(data.page).slice(0, 120),
    escLike(data.message).slice(0, 4000),
    escLike(data.answer).slice(0, 12000),
    JSON.stringify(data.actions || []),
    escLike(data.toolUsed).slice(0, 120)
  );
}

function historyList(dbm, req, limit = 30) {
  ensureTables(dbm);
  return dbm.db.prepare(`SELECT id,page,message,answer,actions,tool_used,created_at
    FROM ai_chat WHERE user_id=? ORDER BY id DESC LIMIT ?`).all(req.user.id, Math.max(1, Math.min(100, Number(limit) || 30))).reverse();
}

function historyClear(dbm, req) {
  ensureTables(dbm);
  const r = dbm.db.prepare('DELETE FROM ai_chat WHERE user_id=?').run(req.user.id);
  try { dbm.logAudit(req.user, 'HAPUS RIWAYAT AI', 'ai', `${r.changes || 0} percakapan dihapus`); } catch (e) {}
  return r.changes || 0;
}

function rateLimit(dbm, saas, req) {
  ensureTables(dbm);
  const limit = Math.max(1, Math.min(300, Number(saas.get('ai_limit_per_hour', '20')) || 20));
  const hour = libNowHour();
  const scope = 'h:' + hour;
  const row = dbm.db.prepare('SELECT hits FROM ai_usage WHERE user_id=? AND scope=?').get(req.user.id, scope);
  const hits = row ? Number(row.hits || 0) : 0;
  if (hits >= limit) return { ok: false, limit, hits, resetText: '1 jam dari batas saat ini' };
  dbm.db.prepare(`INSERT INTO ai_usage (user_id,scope,hits,window_at,updated_at)
    VALUES (?,?,1,now_wib(),now_wib())
    ON CONFLICT(user_id,scope) DO UPDATE SET hits=hits+1,updated_at=now_wib()`)
    .run(req.user.id, scope);
  return { ok: true, limit, hits: hits + 1 };
}

function libNowHour() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}`;
  return iso;
}

function rupiah(n) {
  return 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');
}

function contextSummary(dbm, req) {
  const ta = dbm.taOf(req) || dbm.activeTahun() || null;
  const taId = ta ? ta.id : null;
  const out = { ta: ta ? ta.nama : '-', taId, pendingTransaksi: 0, siswaAktif: 0, tunggakanIuran: 0, bkuTidakDitutup: 0, pembayaranIuranAntrean: 0 };
  try { out.pendingTransaksi = dbm.db.prepare("SELECT COUNT(*) c FROM transaksi WHERE status='pending'").get().c; } catch (e) {}
  try { out.siswaAktif = dbm.db.prepare("SELECT COUNT(*) c FROM siswa WHERE lower(status)= 'aktif'").get().c; } catch (e) {}
  try {
    if (typeof dbm.sppTunggakan === 'function') out.tunggakanIuran = dbm.sppTunggakan(taId) || 0;
  } catch (e) {}
  try {
    if (typeof dbm.unclosedPeriods === 'function') out.bkuTidakDitutup = (dbm.unclosedPeriods(taId) || []).length;
  } catch (e) {}
  try { out.pembayaranIuranAntrean = dbm.db.prepare("SELECT COUNT(*) c FROM iuran_bayar WHERE status='pending'").get().c; } catch (e) {}
  return out;
}

function toolStatusBku(dbm) {
  const rows = dbm.db.prepare(`SELECT b.nama,COALESCE(b.status,'aktif') status,
    COALESCE((SELECT SUM(CASE WHEN t.jenis='masuk' AND t.status<>'void' THEN t.nominal ELSE 0 END) FROM transaksi t WHERE t.bku_id=b.id),0) masuk,
    COALESCE((SELECT SUM(CASE WHEN t.jenis='keluar' AND t.status<>'void' THEN t.nominal ELSE 0 END) FROM transaksi t WHERE t.bku_id=b.id),0) keluar
    FROM bku b ORDER BY b.urutan,b.nama LIMIT 30`).all();
  return rows.map(r => `${r.nama}: ${r.status}; masuk ${rupiah(r.masuk)}, keluar ${rupiah(r.keluar)}`).join('\n');
}

function toolCariSiswa(dbm, query) {
  const q = '%' + escLike(query).replace(/[%_]/g, '') + '%';
  const rows = dbm.db.prepare(`SELECT s.nama,s.nisn,s.status,k.nama_kelas kelas
    FROM siswa s LEFT JOIN kelas k ON k.id=s.kelas_id
    WHERE s.nama LIKE ? OR s.nisn LIKE ? ORDER BY s.nama LIMIT 10`).all(q, q);
  return rows.length ? rows.map(r => `${r.nama} | NISN ${r.nisn || '-'} | ${r.kelas || '-'} | ${r.status || '-'}`).join('\n') : 'Tidak ada siswa yang cocok.';
}

function toolRekapIuran(dbm, req) {
  const ta = dbm.taOf(req) || dbm.activeTahun() || null;
  const taId = ta ? ta.id : null;
  let rows = [];
  try { rows = dbm.iuranTagihanRows({ taId, aktifOnly: true }) || []; } catch (e) {}
  let tagihan = 0, bayar = 0;
  rows.forEach(r => { tagihan += Number(r.nominal || r.tagihan || 0); bayar += Number(r.dibayar || r.bayar || r.total_bayar || 0); });
  return `TA ${ta ? ta.nama : '-'}: tagihan ${rupiah(tagihan)}, dibayar ${rupiah(bayar)}, sisa ${rupiah(Math.max(0, tagihan - bayar))}.`;
}

function toolPetunjuk(dbm, query) {
  try {
    const term = '%' + escLike(query).replace(/[%_]/g, '') + '%';
    const rows = dbm.db.prepare(`SELECT judul,ringkas,aktif FROM master_guides WHERE judul LIKE ? OR ringkas LIKE ? ORDER BY urutan,judul LIMIT 5`).all(term, term);
    return rows.length ? rows.map(r => `${r.judul}${r.ringkas ? ': ' + r.ringkas : ''}`).join('\n') : 'Tidak ada petunjuk yang cocok.';
  } catch (e) { return 'Petunjuk pengguna belum tersedia.'; }
}

function detectTools(dbm, req, message) {
  const m = escLike(message).toLowerCase();
  let type = '';
  let text = '';
  if (/cari|nama siswa|nisn|siswa bernama|sisw[a]?/.test(m)) {
    const words = m.match(/[a-zA-Z0-9]{3,}/g) || [];
    const query = words.filter(w => !['cari','nama','siswa','nisn','yang','mencari','tolong','berapa'].includes(w)).join(' ').slice(0, 80);
    type = 'cari_siswa'; text = toolCariSiswa(dbm, query);
  } else if (/iuran|tunggakan|tagihan|spp/.test(m)) {
    type = 'rekap_iuran'; text = toolRekapIuran(dbm, req);
  } else if (/bku|saldo|kas|transaksi/.test(m)) {
    type = 'status_bku'; text = toolStatusBku(dbm);
  } else if (/petunjuk|cara|bagaimana|tutorial|panduan/.test(m)) {
    type = 'cari_petunjuk'; text = toolPetunjuk(dbm, message);
  }
  return { type, text };
}

function draftToken(dbm, req, payload) {
  ensureTables(dbm);
  dbm.db.exec(`CREATE TABLE IF NOT EXISTS ai_action_draft (
    token TEXT PRIMARY KEY, user_id INTEGER, action TEXT, payload TEXT,
    expires_at TEXT, status TEXT DEFAULT 'pending', created_at TEXT
  )`);
  const token = crypto.randomBytes(18).toString('hex');
  dbm.db.prepare(`INSERT INTO ai_action_draft (token,user_id,action,payload,expires_at,status,created_at)
    VALUES (?,?,?,?,?,'pending',now_wib())`).run(token, req.user.id, escLike(payload.action).slice(0, 40), JSON.stringify(payload.data || {}).slice(0, 4000), libLaterMinutes(15));
  return token;
}

function libLaterMinutes(minutes) {
  const d = new Date(Date.now() + Number(minutes || 15) * 60000);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function draftGet(dbm, req, token) {
  ensureTables(dbm);
  return dbm.db.prepare(`SELECT * FROM ai_action_draft WHERE token=? AND user_id=?`).get(token, req.user.id) || null;
}

module.exports = {
  ensureTables, historyAdd, historyList, historyClear, rateLimit,
  contextSummary, detectTools, draftToken, draftGet,
  toolStatusBku, toolCariSiswa, toolRekapIuran, toolPetunjuk
};
