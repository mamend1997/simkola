'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const envCfg = require('./env');
const lib = require('./lib');
const dbm = require('./db');
const ui = require('./ui');

const PORT = process.env.PORT || 3120;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 30 * 1024 * 1024;
const MEDIA_BASE = String(process.env.APP_MEDIA_URL || 'http://127.0.0.1:4310').replace(/\/+$/, '');

/* ---------------- tiny router ---------------- */
const routes = [];
function add(method, pattern, handler) {
  const segs = pattern.split('/').filter(Boolean);
  routes.push({ method, segs, handler });
}
const get = (p, h) => add('GET', p, h);
const post = (p, h) => add('POST', p, h);
function match(method, pathname) {
  const parts = pathname.split('/').filter(Boolean);
  for (const r of routes) {
    if (r.method !== method) continue;
    if (r.segs.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < r.segs.length; i++) {
      const s = r.segs[i];
      if (s.startsWith(':')) params[s.slice(1)] = decodeURIComponent(parts[i]);
      else if (s !== parts[i]) { ok = false; break; }
    }
    if (ok) return { handler: r.handler, params };
  }
  return null;
}

/* ---------------- responses ---------------- */
function makeRes(raw) {
  const res = { raw, status: 200, headers: {} };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  res.html = (body, status = 200) => {
    raw.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      ...res.headers
    });
    raw.end(body);
  };
  res.json = (obj, status = 200) => {
    raw.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...res.headers });
    raw.end(JSON.stringify(obj));
  };
  res.redirect = (loc, status = 303) => {
    raw.writeHead(status, { Location: loc, ...res.headers });
    raw.end();
  };
  res.file = (buffer, filename, mime) => {
    raw.writeHead(200, {
      'Content-Type': mime || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
      'Content-Length': buffer.length,
      'Cache-Control': 'no-store',
      ...res.headers
    });
    raw.end(buffer);
  };
  res.notFound = () => res.html(renderError(404, 'Halaman tidak ditemukan', 'Periksa kembali alamat halaman yang Anda tuju.'), 404);
  return res;
}

function renderError(code, title, desc) {
  const ASSET_V = ui.ASSET_V;
  return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${lib.esc(title)}</title><link rel="stylesheet" href="assets/app.css?v=${ASSET_V}" onerror="this.remove()">
<style>body{display:grid;place-items:center;min-height:100vh;margin:0;font-family:Inter,system-ui,sans-serif;background:#FFFBF8;color:#2A1A12}
.b{text-align:center;max-width:440px;padding:40px}h1{font-size:64px;margin:0;color:#F97316;letter-spacing:-.04em}p{color:#8A7A70}</style>
</head><body><div class="b"><h1>${code}</h1><h2>${lib.esc(title)}</h2><p>${lib.esc(desc)}</p><p><a href="./" style="color:#EA580C;font-weight:700">Kembali ke Dashboard</a></p></div></body></html>`;
}

/* ---------------- request context ---------------- */
const COOKIE = 'simkeu_sid';

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('Ukuran data terlalu besar (maks 30 MB).')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      const ct = String(req.headers['content-type'] || '');
      if (ct.includes('application/json')) {
        try { resolve(JSON.parse(buf.toString('utf8') || '{}')); } catch (e) { resolve({}); }
        return;
      }
      const out = {};
      const s = buf.toString('utf8');
      for (const [k, v] of new URLSearchParams(s)) {
        // nama field yang dikirim berulang (mis. checkbox ceklis) dikumpulkan jadi array
        if (out[k] === undefined) out[k] = v;
        else if (Array.isArray(out[k])) out[k].push(v);
        else out[k] = [out[k], v];
      }
      resolve(out);
    });
    req.on('error', reject);
  });
}

/* ---------------- auth & permissions ---------------- */
function can(user, module, action) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  const r = dbm.db.prepare('SELECT allowed FROM permissions WHERE role=? AND module=? AND action=?').get(user.role, module, action);
  return !!(r && r.allowed);
}
function roleLabel(role) { return dbm.ROLE_LABEL[role] || role; }

function permissionMatrix() {
  const rows = dbm.db.prepare('SELECT * FROM permissions').all();
  const map = {};
  for (const r of rows) map[`${r.role}|${r.module}|${r.action}`] = r.allowed;
  return map;
}

function setSession(userId) {
  const t = lib.token(24);
  const exp = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString().replace('T', ' ').slice(0, 19);
  const prev = dbm.db.prepare('SELECT last_login FROM users WHERE id=?').get(userId);
  const since = prev && prev.last_login ? prev.last_login : '';
  const pending = since
    ? dbm.db.prepare("SELECT COUNT(*) c FROM transaksi WHERE status='pending' AND COALESCE(created_at,'') >= ?").get(since).c
    : dbm.db.prepare("SELECT COUNT(*) c FROM transaksi WHERE status='pending'").get().c;
  // tahun ajaran otomatis mengikuti bulan kalender berjalan (mis. login Oktober 2026 → 2026/2027)
  const taId = dbm.taAutoId();
  dbm.db.prepare('INSERT INTO sessions (token,user_id,expires_at,alert_pending,ta_id) VALUES (?,?,?,?,?)').run(t, userId, exp, pending, taId);
  dbm.db.prepare('UPDATE users SET last_login=? WHERE id=?').run(lib.nowStamp(), userId);
  return t;
}
function currentUser(req) {
  const c = parseCookies(req.headers.cookie);
  const t = c[COOKIE];
  if (!t) return null;
  const s = dbm.db.prepare('SELECT * FROM sessions WHERE token=?').get(t);
  if (!s) return null;
  if (new Date(s.expires_at.replace(' ', 'T')) < new Date()) {
    dbm.db.prepare('DELETE FROM sessions WHERE token=?').run(t);
    return null;
  }
  const u = dbm.db.prepare('SELECT id,nama,email,role,aktif,jabatan,foto FROM users WHERE id=?').get(s.user_id);
  if (!u || !u.aktif) return null;
  req.sessionRow = s;   // untuk notifikasi draf pengeluaran saat login
  // tahun ajaran aktif untuk sesi ini (dropdown di header)
  let taId = s.ta_id ? Number(s.ta_id) : null;
  const qta = Number((req.query && req.query.get) ? (req.query.get('ta') || 0) : 0);
  if (qta && dbm.tahunById(qta)) {
    taId = qta;
    try { dbm.db.prepare('UPDATE sessions SET ta_id=? WHERE token=?').run(qta, s.token); } catch (e) { }
  }
  if (!taId) {
    // sesi lama tanpa TA → pilih otomatis sesuai bulan berjalan
    taId = dbm.taAutoId();
    if (taId) { try { dbm.db.prepare('UPDATE sessions SET ta_id=? WHERE token=?').run(taId, s.token); } catch (e) { } }
  }
  req.taId = taId;
  req.TA = dbm.tahunById(taId) || dbm.activeTahun();
  return u;
}

/* ---------------- upload proxy (media) ---------------- */
async function uploadMedia(base64, filename) {
  const token = process.env.APP_MEDIA_TOKEN || '';
  if (!token) throw new Error('Fitur unggah berkas belum aktif (token media belum tersedia). Simpan transaksi tanpa lampiran, lalu hubungi admin.');
  const clean = String(filename || 'berkas').replace(/[^\w.\- ]+/g, '_').slice(-120);
  const b64 = String(base64).includes(',') ? String(base64).split(',').pop() : String(base64);
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) throw new Error('Berkas kosong / gagal dibaca.');
  const r = await fetch(`${MEDIA_BASE}/api/app-media/upload?filename=${encodeURIComponent(clean)}`, {
    method: 'POST',
    headers: { 'X-App-Media-Token': token, 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length },
    body: buf
  });
  let j = {};
  try { j = await r.json(); } catch (e) { }
  if (!r.ok || !j.ok) throw new Error(j.error || j.message || 'Berkas ditolak oleh server media (periksa tipe/ukuran berkas).');
  return j.url;
}

/* ---------------- shared page helpers ---------------- */
function ctx(req) {
  const s = dbm.settingsAll();
  const ta = dbm.taOf(req) || null;
  return {
    req,
    base: req.BASE,
    user: req.user,
    q: req.query,
    settings: s,
    ta,
    taId: ta ? ta.id : null,
    taList: dbm.taOptions(),
    can: (m, a) => can(req.user, m, a),
    roleLabel: roleLabel(req.user?.role),
    pendingCount: ta
      ? dbm.db.prepare('SELECT COUNT(*) c FROM transaksi t JOIN bku b ON b.id=t.bku_id WHERE t.status=\'pending\' AND b.tahun_ajaran_id=?').get(ta.id).c
      : dbm.db.prepare("SELECT COUNT(*) c FROM transaksi WHERE status='pending'").get().c
  };
}

function page(req, res, { title, sub = '', active, content }) {
  const c = ctx(req);
  res.html(ui.layout({
    title, sub, user: c.user, active, base: c.base, content,
    query: req.query, roleLabel: c.roleLabel, pendingCount: c.pendingCount,
    can: (m, a) => can(req.user, m, a || 'view'),
    logoStamp: c.settings.sekolah_logo || '',
    taList: c.taList, taId: c.taId, path: req.url,
    navHidden: c.settings.nav_hidden || ''
  }));
}

/** bangun URL tujuan + parameter flash (ok/err/warn) tanpa duplikasi */
function flashUrl(pathname, key, msg) {
  try {
    const u = new URL(pathname, 'http://local');
    ['ok', 'err', 'warn'].forEach(k => u.searchParams.delete(k));
    u.searchParams.set(key, msg);
    // pakai %20 (bukan '+') agar konsisten dengan redirect lain & mudah dibaca di log
    return u.pathname + '?' + u.searchParams.toString().replace(/\+/g, '%20');
  } catch (e) {
    return pathname + (pathname.includes('?') ? '&' : '?') + key + '=' + encodeURIComponent(msg);
  }
}

class HttpError extends Error {
  constructor(status, title, desc) { super(title); this.status = status; this.title = title; this.desc = desc; }
}
function guard(req, res, module, action) {
  if (!req.user) throw new HttpError(302, 'Perlu masuk', 'Silakan login terlebih dahulu.');
  if (!can(req.user, module, action)) {
    throw new HttpError(403, 'Akses ditolak', 'Role Anda tidak memiliki hak akses untuk tindakan ini. Hubungi Super Admin bila Anda merasa ini keliru.');
  }
  return true;
}

/* ---------------- favicon dari logo sekolah ---------------- */
const favCache = { url: null, buf: null, mime: '', at: 0 };
async function faviconResponse(pathname) {
  const logo = dbm.getSetting('sekolah_logo', '');
  const now = Date.now();
  if (logo && favCache.url === logo && favCache.buf && now - favCache.at < 30 * 60 * 1000) {
    return { buf: favCache.buf, mime: favCache.mime };
  }
  if (logo) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 4000);
      const r = await fetch(logo, { signal: ctrl.signal });
      clearTimeout(to);
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        const ct = String(r.headers.get('content-type') || 'image/png').split(';')[0];
        if (buf.length && /^image\//.test(ct)) {
          favCache.url = logo; favCache.buf = buf; favCache.mime = ct; favCache.at = now;
          return { buf, mime: ct };
        }
      }
    } catch (e) { /* fallback ke inisial */ }
  }
  // fallback: SVG inisial sekolah (warna orange)
  const nama = String(dbm.getSetting('sekolah_nama', 'Sekolah')).trim();
  const initial = (nama.replace(/^(SMA|SMK|SMP|SD|MA|MTs|S)\s+/i, '').charAt(0) || nama.charAt(0) || 'S').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FB923C"/><stop offset="1" stop-color="#EA580C"/></linearGradient></defs><rect width="100" height="100" rx="24" fill="url(#g)"/><text x="50" y="70" font-family="Inter,Arial,sans-serif" font-size="52" font-weight="800" fill="#fff" text-anchor="middle">${initial}</text></svg>`;
  return { buf: Buffer.from(svg, 'utf8'), mime: 'image/svg+xml' };
}

/* ---------------- tahun ajaran aktif (dropdown header) ---------------- */
post('/ta/pilih', (req, res) => {
  if (!req.user) return res.redirect(req.BASE + '/login');
  const id = Number(req.body.ta || 0);
  const ta = id ? dbm.tahunById(id) : null;
  if (req.sessionRow) {
    try { dbm.db.prepare('UPDATE sessions SET ta_id=? WHERE token=?').run(ta ? ta.id : null, req.sessionRow.token); } catch (e) { }
  }
  const backRaw = String(req.body.back || '');
  const back = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/.test(backRaw) && !backRaw.startsWith('//') ? backRaw : '/';
  const msg = ta ? `Tahun Pelajaran aktif: ${ta.nama}. Seluruh tampilan menyesuaikan tahun pelajaran ini.` : 'Tahun Pelajaran default digunakan.';
  res.redirect(req.BASE + flashUrl(back, 'ok', msg));
});

/* ---------------- module routes ---------------- */
require('./routes/auth')({ get, post, dbm, lib, ui, page, ctx, guard, can, setSession, COOKIE, roleLabel, permissionMatrix, uploadMedia, renderError, flashUrl });
require('./routes/dashboard')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/approval')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/master')({ get, post, dbm, lib, ui, page, ctx, guard, can, uploadMedia, flashUrl });
require('./routes/aset_akun')({ get, post, dbm, lib, ui, page, ctx, guard, can, uploadMedia, flashUrl });
require('./routes/transaksi')({ get, post, dbm, lib, ui, page, ctx, guard, can, uploadMedia, flashUrl });
require('./routes/rekon')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/piutang')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/piutang_lain')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/piutang_lainnya')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/pegawai')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/payroll')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/beasiswa')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/tutup')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/bku_detail')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/import')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/laporan')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/sistem')({ get, post, dbm, lib, ui, page, ctx, guard, can, permissionMatrix, uploadMedia, flashUrl });
require('./routes/desain')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/akademik')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/iuran')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/ekskul')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/trash')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/mutasi')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/portal')({ get, post, dbm, lib, ui, guard, flashUrl });
require('./routes/portal_pegawai')({ get, post, dbm, lib, ui });
require('./routes/catatan')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/backup_cloud')({ get, post, dbm, lib, ui, page, ctx, guard, flashUrl });

/* ---------------- server ---------------- */
const server = http.createServer(async (req, res) => {
  const base = String(req.headers['x-public-base-path'] || '').replace(/\/$/, '');
  req.BASE = base;
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (e) { return makeRes(res).html('Bad request', 400); }
  const pathname0 = decodeURIComponent(url.pathname);
  // alamat portal publik bisa diubah (mis. /portal-slip-pegawai) → dipetakan ke route kanonik
  const pathname = dbm.portalRewrite(pathname0) || pathname0;
  req.query = url.searchParams;

  // favicon dari logo sekolah
  if (pathname === '/favicon.ico' || pathname === '/favicon.svg' || pathname === '/favicon.png') {
    try {
      const fav = await faviconResponse(pathname);
      res.writeHead(200, { 'Content-Type': fav.mime, 'Cache-Control': 'public, max-age=1800' });
      return res.end(fav.buf);
    } catch (e) {
      res.writeHead(302, { Location: base + '/assets/app.css' });
      return res.end();
    }
  }

  // static assets
  if (pathname.startsWith('/assets/')) {
    const name = pathname.slice('/assets/'.length).replace(/[^a-zA-Z0-9._-]/g, '');
    const fp = path.join(PUBLIC_DIR, name);
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      const mime = name.endsWith('.css') ? 'text/css; charset=utf-8'
        : name.endsWith('.js') ? 'application/javascript; charset=utf-8'
          : name.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=3600' });
      return fs.createReadStream(fp).pipe(res);
    }
    res.writeHead(404); return res.end('not found');
  }

  const R = makeRes(res);
  try {
    req.user = currentUser(req);
    req.body = {};
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      req.body = await readBody(req);
    }

    // public pages
    if (!req.user) {
      const isPublic = ['/login', '/logout', '/portal', '/portal-pegawai', '/portal-slip'].includes(pathname)
        || pathname.startsWith('/portal/') || pathname.startsWith('/portal-pegawai/') || pathname.startsWith('/portal-slip/');
      if (!isPublic) {
        if (req.method === 'POST') return R.redirect(base + '/login?err=' + encodeURIComponent('Sesi Anda berakhir. Silakan masuk kembali.'));
        return R.redirect(base + '/login');
      }
    }

    const m = match(req.method === 'POST' ? 'POST' : 'GET', pathname);
    if (!m) return R.notFound();
    req.params = m.params;
    await m.handler(req, R);
  } catch (err) {
    if (err instanceof HttpError) {
      if (err.status === 302) return R.redirect(base + '/login?err=' + encodeURIComponent('Silakan masuk terlebih dahulu.'));
      return R.html(renderError(err.status, err.title, err.desc), err.status);
    }
    console.error('[ERROR]', pathname, err);
    const msg = String(err && err.message || err);
    if (req.method === 'POST') {
      const back = req.headers.referer || (base + '/');
      const u = new URL(back, 'http://x');
      u.searchParams.set('err', msg);
      return R.redirect(u.pathname + '?' + u.searchParams.toString());
    }
    R.html(renderError(500, 'Terjadi kesalahan', msg), 500);
  }
});

server.listen(PORT, () => {
  console.log('SIMKEU Sekolah listening on ' + PORT + (process.env.APP_BASE_URL ? ' · base ' + process.env.APP_BASE_URL : ''));
});

/* kotak sampah: buang data kedaluwarsa (>30 hari) saat start & berkala */
try { dbm.trashPurge(); } catch (e) { console.error('[trash]', e.message); }
setInterval(() => { try { dbm.trashPurge(); } catch (e) { } }, 6 * 60 * 60 * 1000).unref();

/* auto-backup Google Drive: penjadwalan internal 2× sehari (06:00 & 15:00).
   Tidak pernah dipicu oleh aksi simpan transaksi harian. */
try { require('./gdrive').startScheduler(dbm); } catch (e) { console.error('[gdrive]', e.message); }
