'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const envCfg = require('./env');
const lib = require('./lib');
const dbm = require('./db');
const ui = require('./ui');
const saas = require('./saas');
const mailer = require('./mailer');

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
  const r = dbm.mainDb.prepare('SELECT allowed FROM permissions WHERE role=? AND module=? AND action=?').get(user.role, module, action);
  return !!(r && r.allowed);
}
function roleLabel(role) { return dbm.ROLE_LABEL[role] || role; }

function permissionMatrix() {
  const rows = dbm.mainDb.prepare('SELECT * FROM permissions').all();
  const map = {};
  for (const r of rows) map[`${r.role}|${r.module}|${r.action}`] = r.allowed;
  return map;
}

/* ---------------- sesi login (control plane, multi-tenant) ---------------- */
function setSession(userId, tenantId, alertPending) {
  const t = saas.createSession({ userId, tenantId, kind: 'tenant', alertPending: alertPending || 0 });
  dbm.openTenantConn(tenantId, (saas.tenantById(tenantId) || {}).db_file)
    .prepare('UPDATE users SET last_login=? WHERE id=?').run(lib.nowStamp(), userId);
  return t;
}

/** sesi dari cookie: { row, tenant } untuk sekolah, { row } untuk super admin, atau null */
function readSession(req) {
  const c = parseCookies(req.headers.cookie);
  const row = saas.getSession(c[COOKIE]);
  if (!row) return null;
  if (row.kind === 'saas') return { row };
  const tenant = saas.tenantById(row.tenant_id);
  if (!tenant) return null;
  return { row, tenant };
}

/** muat akun sekolah dari database tenant (dipanggil DI DALAM konteks tenant) */
function loadTenantUser(session) {
  const u = dbm.db.prepare('SELECT id,nama,email,role,aktif,jabatan,foto,username FROM users WHERE id=?').get(session.user_id);
  return u && u.aktif ? u : null;
}

/** tahun pelajaran aktif untuk sesi ini (dropdown header) + query ?ta= */
function resolveTa(req) {
  const s = req.sessionRow;
  let taId = s && s.ta_id ? Number(s.ta_id) : null;
  const qta = Number((req.query && req.query.get) ? (req.query.get('ta') || 0) : 0);
  if (qta && dbm.tahunById(qta)) {
    taId = qta;
    try { saas.updateSession(s.token, { ta_id: qta }); } catch (e) { }
  }
  if (!taId) {
    taId = dbm.taAutoId();
    if (taId && s) { try { saas.updateSession(s.token, { ta_id: taId }); } catch (e) { } }
  }
  req.taId = taId;
  req.TA = dbm.tahunById(taId) || dbm.activeTahun();
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
  const tenant = req.tenant || null;
  const st = saas.statusOf(tenant);
  res.html(ui.layout({
    title, sub, user: c.user, active, base: c.base, content,
    query: req.query, roleLabel: c.roleLabel, pendingCount: c.pendingCount,
    can: (m, a) => can(req.user, m, a || 'view'),
    logoStamp: c.settings.sekolah_logo || '',
    taList: c.taList, taId: c.taId, path: req.url,
    // tampilan global (tema, nama & logo aplikasi, penataan menu) selalu dari database sekolah aktif
    navHidden: dbm.mainSetting('nav_hidden', ''),
    navCfg: dbm.navUiGlobal(),
    tema: dbm.temaWarnaGlobal(),
    appName: dbm.appNamaGlobal(),
    appLogo: dbm.appLogoGlobal(),
    demoMode: !!(req.user && req.user.role === 'demo'),
    // multi-tenant: fitur yang aktif untuk sekolah ini + penanda mode bantuan super admin
    features: saas.enabledKeys(tenant),
    tenantInfo: tenant ? { nama: tenant.nama, kode: tenant.school_code, status: st, paket: tenant.paket } : null,
    impersonate: (req.sessionRow && req.sessionRow.imp_by)
      ? { nama: (saas.adminById(req.sessionRow.imp_by) || {}).nama || 'Super Admin' }
      : null
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
  const backDemo = req.user && req.user.role === 'demo';
  if (req.sessionRow && !backDemo) {
    try { saas.updateSession(req.sessionRow.token, { ta_id: ta ? ta.id : null }); } catch (e) { }
  }
  const backRaw = String(req.body.back || '');
  const back = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/.test(backRaw) && !backRaw.startsWith('//') ? backRaw : '/';
  const msg = ta ? `Tahun Pelajaran aktif: ${ta.nama}. Seluruh tampilan menyesuaikan tahun pelajaran ini.` : 'Tahun Pelajaran default digunakan.';
  res.redirect(req.BASE + flashUrl(back, 'ok', msg));
});

/* ---------------- module routes ---------------- */
require('./routes/auth')({ get, post, dbm, lib, ui, page, ctx, guard, can, setSession, COOKIE, roleLabel, permissionMatrix, uploadMedia, renderError, flashUrl, saas });
require('./routes/dashboard')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl, saas });
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
require('./routes/panduan')({ get, post, dbm, lib, ui, page, ctx, guard, can, uploadMedia, flashUrl });
require('./routes/backup_cloud')({ get, post, dbm, lib, ui, page, ctx, guard, flashUrl });
require('./routes/layanan')({ get, post, dbm, lib, ui, page, ctx, guard, uploadMedia, flashUrl, saas });
require('./routes/superadmin')({ get, post, dbm, lib, ui, saas, mailer, uploadMedia, renderError });

/* ---------------- halaman status (suspend / fitur nonaktif) ---------------- */
function statusPage({ base, badge, title, desc, tone = 'warn', actions = [] }) {
  const col = tone === 'err' ? '#DC2626' : tone === 'info' ? '#2563EB' : '#EA580C';
  const bg = tone === 'err' ? '#FEF2F2' : tone === 'info' ? '#EFF6FF' : '#FFF7ED';
  return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${lib.esc(title)}</title><link rel="stylesheet" href="${base}/assets/app.css?v=${ui.ASSET_V}">
<link rel="icon" href="${base}/favicon.ico"></head>
<body style="display:grid;place-items:center;min-height:100vh;margin:0;padding:24px">
<div class="card" style="max-width:560px;width:100%;padding:32px;text-align:center">
  <div style="display:inline-flex;align-items:center;gap:8px;background:${bg};color:${col};font-weight:700;font-size:12px;letter-spacing:.08em;text-transform:uppercase;padding:7px 14px;border-radius:999px">${lib.esc(badge || 'Informasi')}</div>
  <h2 style="margin:18px 0 8px;font-size:24px;letter-spacing:-.02em">${lib.esc(title)}</h2>
  <p class="muted" style="margin:0 auto 22px;max-width:420px;line-height:1.65">${desc}</p>
  <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
    ${actions.map(a => `<a class="btn ${a.primary ? 'btn-primary' : ''}" href="${base}${a.href}">${lib.esc(a.label)}</a>`).join('')}
  </div>
</div></body></html>`;
}

/* ---------------- portal publik per sekolah (slug bisa diubah tiap tenant) ---------------- */
let portalMapCache = { at: 0, map: {} };
function portalSlugMap(force = false) {
  if (!force && Date.now() - portalMapCache.at < 60000) return portalMapCache.map;
  const map = {};
  let tenants = [];
  try { tenants = saas.allTenants(); } catch (e) { tenants = []; }
  for (const t of tenants) {
    try {
      const conn = dbm.openTenantConn(t.id, t.db_file);
      const rows = conn.prepare("SELECT k,v FROM settings WHERE k IN ('portal_slug','portal_pegawai_slug','portal_slip_slug')").all();
      const g = (k, d) => { const r = rows.find(x => x.k === k); return (r && r.v) || d; };
      const add = (slug, path) => { if (slug && !map[slug]) map[slug] = { path, tenantId: t.id }; };
      add(g('portal_slug', 'portal'), '/portal');
      add(g('portal_pegawai_slug', 'portal-pegawai'), '/portal-pegawai');
      add(g('portal_slip_slug', 'portal-slip'), '/portal-slip');
    } catch (e) { }
  }
  portalMapCache = { at: Date.now(), map };
  return map;
}

const ALWAYS_ALLOWED = ['/info-layanan', '/perpanjang', '/akun', '/logout', '/login'];
function isPublicPath(pathname) {
  return ['/login', '/register', '/daftar', '/logout'].includes(pathname);
}

/* ---------------- server ---------------- */
const server = http.createServer(async (req, res) => {
  const base = String(req.headers['x-public-base-path'] || '').replace(/\/$/, '');
  req.BASE = base;
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (e) { return makeRes(res).html('Bad request', 400); }
  const pathname0 = decodeURIComponent(url.pathname);
  req.query = url.searchParams;

  // ---- static assets (tidak bergantung tenant) ----
  if (pathname0.startsWith('/assets/')) {
    const name = pathname0.slice('/assets/'.length).replace(/[^a-zA-Z0-9._-]/g, '');
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
  const session = readSession(req);

  // ---- favicon: logo sekolah yang sedang diakses ----
  if (pathname0 === '/favicon.ico' || pathname0 === '/favicon.svg' || pathname0 === '/favicon.png') {
    const t = (session && session.tenant) || saas.tenantById(1);
    try {
      const fav = t ? await dbm.runAsTenant(t, async () => faviconResponse()) : await faviconResponse();
      res.writeHead(200, { 'Content-Type': fav.mime, 'Cache-Control': 'public, max-age=1800' });
      return res.end(fav.buf);
    } catch (e) {
      res.writeHead(302, { Location: base + '/assets/app.css' });
      return res.end();
    }
  }

  function handleError(err, pathname) {
    if (err instanceof HttpError) {
      if (err.status === 302) return R.redirect(base + '/login?err=' + encodeURIComponent('Silakan masuk terlebih dahulu.'));
      return R.html(renderError(err.status, err.title, err.desc), err.status);
    }
    console.error('[ERROR]', pathname, err);
    const msg = String(err && err.message || err);
    if (req.method === 'POST') {
      const back = req.headers.referer || (base + '/');
      try {
        const u = new URL(back, 'http://x');
        u.searchParams.set('err', msg);
        return R.redirect(u.pathname + '?' + u.searchParams.toString());
      } catch (e) {
        return R.redirect(base + '/?err=' + encodeURIComponent(msg));
      }
    }
    R.html(renderError(500, 'Terjadi kesalahan', msg), 500);
  }

  async function runRoute(pathname) {
    const m = match(req.method === 'POST' ? 'POST' : 'GET', pathname);
    if (!m) return R.notFound();
    req.params = m.params;
    await m.handler(req, R);
  }

  /* ================= PORTAL SUPER ADMIN PUSAT (dedicated route) ================= */
  if (pathname0 === '/super-admin' || pathname0.startsWith('/super-admin/')) {
    try {
      req.saasSession = session && session.row.kind === 'saas' ? session.row : null;
      req.saasUser = req.saasSession ? saas.adminById(req.saasSession.user_id) : null;
      req.body = {};
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) req.body = await readBody(req);
      return await runRoute(pathname0);
    } catch (err) { return handleError(err, pathname0); }
  }

  try {
    req.body = {};
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) req.body = await readBody(req);

    /* ---------- belum login: halaman publik + portal orang tua ---------- */
    if (!session) {
      const first = pathname0.split('/').filter(Boolean)[0] || '';
      const kode = String((req.query.get && req.query.get('kode')) || (req.body && req.body.kode) || '').trim();
      const tByCode = kode ? saas.tenantByCode(kode) : null;
      const canonical = ['/portal', '/portal-pegawai', '/portal-slip'];
      // slug bisa baru saja diubah → bila tidak ketemu, bangun ulang peta sekali
      let slugHit = kode ? null : portalSlugMap()[first];
      if (!kode && !slugHit) slugHit = portalSlugMap(true)[first];
      let portalPath = null, portalTenant = null;
      for (const c of canonical) {
        if (pathname0 === c || pathname0.startsWith(c + '/')) { portalPath = pathname0; break; }
      }
      if (!portalPath && slugHit) {
        portalPath = slugHit.path + pathname0.slice(first.length + 1);
        portalTenant = saas.tenantById(slugHit.tenantId);
      }
      if (portalPath) {
        const t = tByCode || portalTenant || saas.tenantById(1);
        if (!t) return R.html(renderError(503, 'Belum ada sekolah', 'Belum ada sekolah yang terdaftar pada layanan ini.'), 503);
        return await dbm.runAsTenant(t, async () => {
          req.tenant = t;
          req.TA = null; req.taId = null;
          try { await runRoute(portalPath); } catch (err) { handleError(err, portalPath); }
        });
      }
      if (!isPublicPath(pathname0)) {
        if (req.method === 'POST') return R.redirect(base + '/login?err=' + encodeURIComponent('Sesi Anda berakhir. Silakan masuk kembali.'));
        return R.redirect(base + '/login');
      }
      req.tenant = null;
      return await runRoute(pathname0);
    }

    /* ---------- super admin memakai cookie sekolah? tolak dengan sopan ---------- */
    if (session.row.kind === 'saas') return R.redirect(base + '/super-admin');

    /* ---------- sudah login: seluruh request berjalan di database sekolahnya ---------- */
    const tenant = session.tenant;
    return await dbm.runAsTenant(tenant, async () => {
      let pathname = pathname0;
      try { pathname = dbm.portalRewrite(pathname0) || pathname0; } catch (e) { }
      req.tenant = tenant;
      req.sessionRow = session.row;
      try {
        const u = loadTenantUser(session.row);
        if (!u) {
          saas.destroySession(session.row.token);
          R.set('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0`);
          return R.redirect(base + '/login?err=' + encodeURIComponent('Akun Anda tidak aktif. Hubungi admin sekolah.'));
        }
        req.user = u;

        // ---- pemblokiran otomatis (masa aktif habis / ditangguhkan) ----
        if (saas.isBlocked(tenant) && !ALWAYS_ALLOWED.some(p => pathname === p || pathname.startsWith(p + '/'))) {
          const st = saas.statusOf(tenant);
          return R.html(statusPage({
            base, badge: 'Masa aktif berakhir', tone: 'err',
            title: 'Akses sekolah ditangguhkan sementara',
            desc: `Masa aktif <b>${lib.esc(tenant.nama)}</b> (${lib.esc(tenant.school_code)}) berakhir pada <b>${lib.esc(tenant.expires_at || '-')}</b>.
              Data sekolah tetap aman dan akan langsung aktif kembali setelah perpanjangan diverifikasi.`,
            actions: [{ label: 'Info Layanan & Perpanjang', href: '/info-layanan', primary: true }, { label: 'Keluar', href: '/logout' }]
          }), 403);
        }

        // ---- feature flagging: blokir akses langsung ke fitur yang dimatikan ----
        const blockedLabel = saas.blockedFeature(tenant, pathname);
        if (blockedLabel) {
          return R.html(statusPage({
            base, badge: 'Fitur tidak aktif', tone: 'warn',
            title: blockedLabel + ' belum tersedia',
            desc: `Fitur ini tidak termasuk paket <b>${lib.esc(saas.PAKET[tenant.paket] || tenant.paket)}</b> sekolah Anda.
              Hubungi Super Admin Pusat untuk mengaktifkannya.`,
            actions: [{ label: 'Kembali ke Dashboard', href: '/', primary: true }, { label: 'Info Layanan', href: '/info-layanan' }]
          }), 403);
        }

        const demoMode = u.role === 'demo';
        const run = async () => {
          if (demoMode) {
            const taDemo = dbm.activeTahun();
            req.TA = taDemo || null;
            req.taId = taDemo ? taDemo.id : null;
          } else {
            resolveTa(req);
          }
          await runRoute(pathname);
        };
        if (demoMode) {
          dbm.ensureDemoDb();
          await dbm.runAsDemo(run);
        } else await run();
      } catch (err) { handleError(err, pathname); }
    });
  } catch (err) {
    handleError(err, pathname0);
  }
});

/* ---------------- startup: control plane, penjadwalan, backup email ---------------- */
try {
  const admin = saas.ensureBootstrap();
  if (admin && admin.created) {
    console.log('[saas] akun Super Admin Pusat dibuat: ' + admin.email + ' (sandi awal dari SAAS_ADMIN_PASSWORD / default)');
  }
} catch (e) { console.error('[saas]', e.message); }

server.listen(PORT, () => {
  console.log('SIMKEU Sekolah listening on ' + PORT + (process.env.APP_BASE_URL ? ' · base ' + process.env.APP_BASE_URL : ''));
});

/* kotak sampah: buang data kedaluwarsa (>30 hari) untuk SEMUA sekolah */
function purgeAllTrash() {
  for (const t of saas.allTenants()) {
    try { dbm.runAsTenant(t, () => dbm.trashPurge()); } catch (e) { }
  }
}
try { purgeAllTrash(); } catch (e) { console.error('[trash]', e.message); }
setInterval(() => { try { purgeAllTrash(); } catch (e) { } }, 6 * 60 * 60 * 1000).unref();

/* cron harian SaaS: tagihan H-7 + penangguhan otomatis sekolah yang kedaluwarsa.
   Penanda tanggal disimpan di saas_settings supaya tidak berjalan dua kali sehari. */
function runBillingTick() {
  const today = saas.todayISO();
  if (String(saas.get('last_daily', '')) === today) return;
  try {
    const r = saas.runDailyJobs();
    saas.set('last_daily', today);
    if (r.invoices || r.suspended) console.log(`[saas] tagihan baru: ${r.invoices}, sekolah ditangguhkan: ${r.suspended}`);
  } catch (e) { console.error('[saas-billing]', e.message); }
}
setTimeout(runBillingTick, 15000).unref();
setInterval(runBillingTick, 30 * 60 * 1000).unref();

/* auto-backup database via email (SMTP) — 2x sehari 06:00 & 15:00, berkas zip
   dihapus dari disk segera setelah email terkirim. */
setTimeout(() => { mailer.checkSchedules(dbm, saas).catch(e => console.error('[backup-email]', e.message)); }, 20000).unref();
setInterval(() => { mailer.checkSchedules(dbm, saas).catch(e => console.error('[backup-email]', e.message)); }, 5 * 60 * 1000).unref();

/* auto-backup Google Drive: penjadwalan internal 2× sehari (06:00 & 15:00).
   Tidak pernah dipicu oleh aksi simpan transaksi harian. */
try { require('./gdrive').startScheduler(dbm); } catch (e) { console.error('[gdrive]', e.message); }
