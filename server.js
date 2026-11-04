'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const perf = require('./perf');
const { URL } = require('url');

const envCfg = require('./env');
const lib = require('./lib');
const dbm = require('./db');
const ui = require('./ui');
const saas = require('./saas');
const storage = require('./storage');
const queue = require('./queue');

const PORT = process.env.PORT || 3120;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 30 * 1024 * 1024;
const MEDIA_BASE = String(process.env.APP_MEDIA_URL || 'http://127.0.0.1:4310').replace(/\/+$/, '');

/* ---------------- helper ---------------- */
function clientIp(req) {
  const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = f || String(req.socket && req.socket.remoteAddress || '');
  return ip.replace(/^::ffff:/, '').slice(0, 60);
}

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
function setSession(userId, tenantId, alertPending, welcome) {
  const t = saas.createSession({ userId, tenantId, kind: 'tenant', alertPending: alertPending || 0, welcome });
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

/* ---------------- upload berkas (terisolasi per sekolah) ---------------- */
/**
 * Nama berkas selalu memuat tenant_id + stempel waktu + acak (lihat storage.js)
 * sehingga berkas sekolah berbeda tidak pernah saling menimpa.
 */
async function uploadMedia(base64, filename, opts = {}) {
  const conn = dbm.currentTenantConn();
  const tenantId = Number(opts.tenantId || (conn && conn.__tenantId) || 1);
  const jenis = opts.jenis || 'lain';
  if (!process.env.APP_MEDIA_TOKEN && !opts.allowLocal) {
    // tanpa token media (mode lokal) tetap disimpan di storage/tenants/<id>/...
  }
  const r = await storage.saveUpload({ base64, filename, jenis, tenantId });
  return r.url;
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
  // pengumuman global dari Super Admin (banner top bar + pop-up sekali per sesi)
  const notices = saas.visibleAnnouncements(tenant ? tenant.id : null);
  res.html(ui.layout({
    title, sub, user: c.user, active, base: c.base, content,
    query: req.query, roleLabel: c.roleLabel, pendingCount: c.pendingCount,
    can: (m, a) => can(req.user, m, a || 'view'),
    logoStamp: c.settings.sekolah_logo || '',
    taList: c.taList, taId: c.taId, path: req.url,
    // tampilan global (tema, nama & logo aplikasi, penataan menu) selalu dari database sekolah aktif
    navHidden: String(c.settings.nav_hidden || ''),
    navCfg: dbm.navUi(),
    tema: dbm.temaWarnaGlobal(),
    appName: dbm.appNamaGlobal(),
    appLogo: dbm.appLogoGlobal(),
    appLogoSmall: dbm.mainSetting('app_logo_small', ''),
    mode: String(c.settings.mode_tema || 'light') === 'dark' ? 'dark' : 'light',
    // multi-tenant: fitur yang aktif untuk sekolah ini + penanda mode bantuan super admin
    features: saas.enabledKeys(tenant),
    tenantInfo: tenant ? { nama: tenant.nama, kode: tenant.school_code, status: st, paket: tenant.paket } : null,
    impersonate: (req.sessionRow && req.sessionRow.imp_by)
      ? { nama: (saas.adminById(req.sessionRow.imp_by) || {}).nama || 'Super Admin' }
      : null,
    announcements: notices
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

/* ---------------- favicon: logo tenant atau branding default sistem ---------------- */
const favCache = { url: null, buf: null, mime: '', at: 0 };
const favSysCache = { url: null, buf: null, mime: '', at: 0 };
/** favicon DEFAULT sistem (dipakai portal login utama / panel Super Admin) */
async function sysFavicon() {
  const fav = String(saas.get('saas_favicon', '') || '');
  const logo = String(saas.get('saas_logo', '') || '');
  const src = fav || logo;
  const now = Date.now();
  if (src && favSysCache.url === src && favSysCache.buf && now - favSysCache.at < 30 * 60 * 1000) return favSysCache;
  if (src) {
    try {
      const r = await fetch(src, { signal: AbortSignal.timeout(4000) });
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        const ct = String(r.headers.get('content-type') || 'image/png').split(';')[0];
        if (buf.length && /^image\//.test(ct)) {
          Object.assign(favSysCache, { url: src, buf, mime: ct, at: now });
          return favSysCache;
        }
      }
    } catch (e) { }
  }
  // fallback: SVG inisial nama aplikasi
  const nama = String(saas.appName() || 'SIMKEU').trim();
  const ini = (nama.charAt(0) || 'S').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6366F1"/><stop offset="1" stop-color="#8B5CF6"/></linearGradient></defs><rect width="100" height="100" rx="24" fill="url(#g)"/><text x="50" y="70" font-family="Inter,Arial,sans-serif" font-size="52" font-weight="800" fill="#fff" text-anchor="middle">${ini}</text></svg>`;
  Object.assign(favSysCache, { url: 'sys', buf: Buffer.from(svg, 'utf8'), mime: 'image/svg+xml', at: now });
  return favSysCache;
}

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
require('./routes/master')({ get, post, dbm, lib, ui, page, ctx, guard, can, uploadMedia, flashUrl, saas, refreshPortalMap: portalMapRebuild });
require('./routes/aset_akun')({ get, post, dbm, lib, ui, page, ctx, guard, can, uploadMedia, flashUrl });
require('./routes/transaksi')({ get, post, dbm, lib, ui, page, ctx, guard, can, uploadMedia, flashUrl });
require('./routes/rekon')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/piutang')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/piutang_lain')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/piutang_lainnya')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/pegawai')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/payroll')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/payroll_kolom')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/beasiswa')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/tutup')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/bku_detail')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/import')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/laporan')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl, saas });
require('./routes/sistem')({ get, post, dbm, lib, ui, page, ctx, guard, can, permissionMatrix, uploadMedia, flashUrl });
require('./routes/desain')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/akademik')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/kelas_tingkat')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/iuran')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/reminder')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/ekskul')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/trash')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/mutasi')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/portal')({ get, post, dbm, lib, ui, guard, flashUrl, saas });
require('./routes/portal_pegawai')({ get, post, dbm, lib, ui });
require('./routes/catatan')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl });
require('./routes/panduan')({ get, post, dbm, lib, ui, page, ctx, guard, can, uploadMedia, flashUrl, saas });
require('./routes/layanan')({ get, post, dbm, lib, ui, page, ctx, guard, uploadMedia, flashUrl, saas });
require('./routes/backup_tg')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl, saas });
require('./routes/tiket')({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl, saas, uploadMedia });
require('./routes/superadmin')({ get, post, dbm, lib, ui, saas, queue, uploadMedia, renderError, refreshPortalMap: portalMapRebuild });
require('./routes/superadmin_db')({ get, post, dbm, lib, ui, saas });

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

/* ---------------- halaman sistem: maintenance & domain belum terverifikasi ---------------- */
function maintenancePage({ base, m }) {
  const nama = saas.appName();
  return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sistem Dalam Perbaikan</title>
<link rel="stylesheet" href="${base}/assets/app.css?v=${ui.ASSET_V}"><link rel="icon" href="${base}/favicon.ico">
<style>body{display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}
.mt-card{max-width:600px;width:100%;text-align:center;padding:38px 32px}
.mt-ico{width:76px;height:76px;margin:0 auto 18px;border-radius:24px;display:grid;place-items:center;
background:linear-gradient(135deg,#F59E0B,#EA580C);color:#fff;font-size:34px}
.mt-card h1{font-size:25px;margin:0 0 10px;letter-spacing:-.02em}
.mt-card p{line-height:1.7;margin:0 auto 20px;max-width:460px;color:var(--muted,#6B6577)}
.mt-eta{display:inline-block;background:#FFF7ED;color:#C2410C;font-weight:700;font-size:12.5px;
padding:8px 14px;border-radius:999px;margin-bottom:18px}</style></head>
<body><div class="card mt-card">
  <div class="mt-ico">&#9881;</div>
  <h1>Sistem Dalam Perbaikan</h1>
  <p>${lib.esc(m.pesan || 'Kami sedang melakukan pemeliharaan sistem. Silakan kembali beberapa saat lagi.')}</p>
  ${m.selesai ? `<div class="mt-eta">Perkiraan selesai: ${lib.esc(m.selesai)}</div>` : ''}
  <div class="flex" style="justify-content:center;gap:10px;flex-wrap:wrap">
    <a class="btn" href="${base}/">Coba Lagi</a>
    <a class="btn" href="${base}/login">Halaman Masuk</a>
  </div>
  <p class="small muted" style="margin-top:20px">${lib.esc(nama)} · pemeliharaan terjadwal oleh Super Admin Pusat</p>
</div></body></html>`;
}

function domainPendingPage({ base, tenant }) {
  return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Domain Belum Terverifikasi</title>
<link rel="stylesheet" href="${base}/assets/app.css?v=${ui.ASSET_V}"><link rel="icon" href="${base}/favicon.ico">
</head><body style="display:grid;place-items:center;min-height:100vh;margin:0;padding:24px">
<div class="card" style="max-width:560px;width:100%;padding:34px;text-align:center">
  <div style="width:64px;height:64px;border-radius:20px;margin:0 auto 16px;display:grid;place-items:center;background:#FEF3C7;color:#B45309;font-size:28px">!</div>
  <h2 style="margin:0 0 8px;font-size:22px">Domain Belum Terverifikasi</h2>
  <p class="muted" style="line-height:1.7;margin:0 auto 18px;max-width:420px">
    Domain ini terdaftar untuk <b>${lib.esc(tenant.nama)}</b> tetapi statusnya belum VERIFIED atau
    DNS belum mengarah ke server. Hubungi Super Admin Pusat untuk menyelesaikan verifikasi.</p>
  <a class="btn btn-primary" href="${base}/login">Buka halaman masuk</a>
</div></body></html>`;
}

/* ---------------- portal publik per sekolah (slug bisa diubah tiap tenant) ---------------- */
let portalMapCache = { at: 0, map: {} };
/** peta slug portal (unik antar sekolah) → tenant; slug kanonik ada di control plane */
function portalSlugMap(force = false) {
  if (!force && Date.now() - portalMapCache.at < 60000) return portalMapCache.map;
  const map = {};
  let tenants = [];
  try { tenants = saas.allTenants(); } catch (e) { tenants = []; }
  // 1) slug kanonik tiap sekolah (control plane) → /portal
  for (const t of tenants) {
    const slug = String(t.portal_slug || '').trim().toLowerCase();
    if (slug && !map[slug]) map[slug] = { path: '/portal', tenantId: t.id, canonical: true };
  }
  // 2) slug portal pada pengaturan sekolah (alamat lama tetap didukung)
  for (const t of tenants) {
    try {
      const conn = dbm.openTenantConn(t.id, t.db_file);
      const rows = conn.prepare("SELECT k,v FROM settings WHERE k IN ('portal_slug','portal_pegawai_slug','portal_slip_slug')").all();
      const g = (k, d) => { const r = rows.find(x => x.k === k); return String((r && r.v) || d).trim().toLowerCase(); };
      const add = (slug, path) => { if (slug && !map[slug]) map[slug] = { path, tenantId: t.id }; };
      add(g('portal_pegawai_slug', 'portal-pegawai'), '/portal-pegawai');
      add(g('portal_slip_slug', 'portal-slip'), '/portal-slip');
      add(g('portal_slug', 'portal'), '/portal');
    } catch (e) { }
  }
  portalMapCache = { at: Date.now(), map };
  return map;
}
function portalMapRebuild() { return portalSlugMap(true); }

const ALWAYS_ALLOWED = ['/info-layanan', '/perpanjang', '/akun', '/logout', '/login'];
function isPublicPath(pathname) {
  if (['/login', '/register', '/daftar', '/logout'].includes(pathname)) return true;
  // halaman sukses pendaftaran (kredensial) — tanpa sesi, token sekali pakai
  return pathname === '/daftar/sukses';
}

/* ---------------- server ---------------- */
function notFoundSchool(base, host) {
  return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>404 · Sekolah Tidak Ditemukan</title>
<link rel="stylesheet" href="${base}/assets/app.css?v=${ui.ASSET_V}"><link rel="icon" href="${base}/favicon.ico">
</head><body style="display:grid;place-items:center;min-height:100vh;margin:0;padding:24px">
<div class="card" style="max-width:520px;width:100%;padding:36px;text-align:center">
  <div style="font-size:58px;font-weight:800;color:var(--o-500);line-height:1;letter-spacing:-.04em">404</div>
  <h2 style="margin:10px 0 8px;font-size:21px">Sekolah Tidak Ditemukan</h2>
  <p class="muted" style="line-height:1.7;margin:0 auto 18px;max-width:400px">
    Alamat <b>${lib.esc(host || '')}</b> tidak terdaftar pada layanan ini. Periksa kembali tautan portal sekolah Anda.</p>
  <a class="btn btn-primary" href="${base}/login">Halaman Masuk</a>
</div></body></html>`;
}

/* ---------------- halaman status portal publik (akses ditolak) ---------------- */
function portalAccessPage({ base, tenant, access }) {
  const t = tenant || {};
  let logo = '', nama = t.nama || 'Sekolah';
  try {
    const conn = dbm.openTenantConn(t.id, t.db_file);
    const rows = conn.prepare("SELECT k,v FROM settings WHERE k IN ('sekolah_logo','sekolah_nama')").all();
    const g = k => String(((rows.find(x => x.k === k) || {}).v) || '');
    logo = g('sekolah_logo'); if (g('sekolah_nama')) nama = g('sekolah_nama');
  } catch (e) { }
  const INFO = {
    hidden: {
      badge: '404', title: 'Halaman Tidak Ditemukan',
      desc: 'Halaman portal publik sekolah ini sedang <b>disembunyikan</b> oleh Administrator Pusat, sehingga tidak dapat diakses umum.'
    },
    deleted: {
      badge: '404', title: 'Halaman Publik Tidak Tersedia',
      desc: 'Alamat portal publik sekolah ini sudah <b>dihapus</b>. Silakan hubungi petugas sekolah untuk informasi tagihan.'
    },
    private: {
      badge: '403', title: 'Halaman Publik Bersifat Private',
      desc: 'Halaman portal sekolah ini ditetapkan <b>Private</b> oleh Administrator Pusat — hanya untuk kalangan internal sekolah.'
    },
    unpublished: {
      badge: '503', title: 'Portal Sementara Ditutup',
      desc: 'Pengelola sekolah menonaktifkan halaman portal publik. Silakan hubungi bendahara sekolah untuk informasi tagihan.'
    }
  };
  const info = INFO[access.mode] || INFO.hidden;
  const mark = logo
    ? `<img src="${lib.esc(logo)}" alt="Logo" width="64" height="64" style="max-width:64px;max-height:64px;object-fit:contain">`
    : `<div style="width:58px;height:58px;border-radius:18px;margin:0 auto;display:grid;place-items:center;background:#FFF1E6;color:#EA580C;font-size:24px;font-weight:800">${lib.esc(String(nama).charAt(0))}</div>`;
  return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${lib.esc(info.title)} · ${lib.esc(nama)}</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="${base}/assets/app.css?v=${ui.ASSET_V}"><link rel="icon" href="${base}/favicon.ico">
</head><body style="display:grid;place-items:center;min-height:100vh;margin:0;padding:24px">
<div class="card" style="max-width:540px;width:100%;padding:34px;text-align:center">
  ${mark}
  <div style="font-weight:800;letter-spacing:-.02em;margin-top:12px">${lib.esc(nama)}</div>
  <div style="font-size:52px;font-weight:800;color:var(--o-500);line-height:1;letter-spacing:-.05em;margin:14px 0 6px">${lib.esc(info.badge)}</div>
  <h2 style="margin:0 0 8px;font-size:21px">${lib.esc(info.title)}</h2>
  <p class="muted" style="line-height:1.7;margin:0 auto 18px;max-width:400px">${info.desc}</p>
  <a class="btn btn-primary" href="${base}/login">Halaman Masuk Sekolah</a>
</div></body></html>`;
}

const server = http.createServer(async (req, res) => {
  const base = String(req.headers['x-public-base-path'] || '').replace(/\/$/, '');
  req.BASE = base;
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (e) { return makeRes(res).html('Bad request', 400); }
  const pathname0 = decodeURIComponent(url.pathname);
  req.query = url.searchParams;

  // ---- static assets (tidak bergantung tenant) ----
  // Minifikasi + kompresi (gzip/brotli) + Cache-Control immutable bila URL memakai ?v=<versi>
  if (pathname0.startsWith('/assets/')) {
    const name = pathname0.slice('/assets/'.length).replace(/[^a-zA-Z0-9._-]/g, '');
    const fp = path.join(PUBLIC_DIR, name);
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      const mime = name.endsWith('.css') ? 'text/css; charset=utf-8'
        : name.endsWith('.js') ? 'application/javascript; charset=utf-8'
          : name.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
      const versioned = url.searchParams.has('v');
      if (perf.sendAsset(req, res, fp, mime, versioned)) return;
      res.writeHead(200, {
        'Content-Type': mime, 'Cache-Control': perf.cacheControl(versioned),
        'Vary': 'Accept-Encoding'
      });
      return fs.createReadStream(fp).pipe(res);
    }
    res.writeHead(404); return res.end('not found');
  }

  const R = makeRes(res);
  const session = readSession(req);
  const isSuperPath = pathname0 === '/super-admin' || pathname0.startsWith('/super-admin/');

  // ---- penentuan tenant dari HOST (custom domain) ----
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const dom = (() => { try { return saas.tenantByDomain(host); } catch (e) { return null; } })();
  if (dom && !dom.verified && !isSuperPath) {
    return R.html(domainPendingPage({ base, tenant: dom.tenant }), 404);
  }
  const hostTenant = dom && dom.verified ? dom.tenant : null;

  // ---- favicon: logo sekolah (bila ada konteks sekolah), selain itu branding default ----
  if (pathname0 === '/favicon.ico' || pathname0 === '/favicon.svg' || pathname0 === '/favicon.png') {
    const segsFav = pathname0.split('/').filter(Boolean);
    const slugFav = segsFav[0] || '';
    let tFav = (session && session.tenant) || hostTenant || null;
    if (!tFav && slugFav && !isSuperPath) {
      try {
        const m = portalSlugMap();
        const hit = m[slugFav] || portalSlugMap(true)[slugFav];
        if (hit) tFav = saas.tenantById(hit.tenantId || hit.id);
      } catch (e) { }
    }
    try {
      const fav = tFav ? await dbm.runAsTenant(tFav, async () => faviconResponse()) : await sysFavicon();
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

  /* ================= MODE PERBAIKAN (MAINTENANCE) ================= */
  const maint = (() => { try { return saas.maintenance(); } catch (e) { return { aktif: false }; } })();
  if (maint.aktif && !isSuperPath) {
    if (!storage.__filesPath || !pathname0.startsWith('/files/')) {
      return R.html(maintenancePage({ base, m: maint }), 503);
    }
  }

  /* ================= PORTAL SUPER ADMIN PUSAT (dedicated route) ================= */
  if (isSuperPath) {
    try {
      req.saasSession = session && session.row.kind === 'saas' ? session.row : null;
      req.saasUser = req.saasSession ? saas.adminById(req.saasSession.user_id) : null;
      req.body = {};
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) req.body = await readBody(req);
      return await dbm.runWithMeta({ ip: clientIp(req), tenantId: null }, () => runRoute(pathname0));
    } catch (err) { return handleError(err, pathname0); }
  }

  /* ================= BERKAS TERISOLASI PER SEKOLAH (mode lokal) ================= */
  if (pathname0.startsWith('/files/')) {
    const segs = pathname0.split('/').filter(Boolean); // files / tenant / jenis / name
    if (segs.length === 4) {
      const fp = storage.localFile(segs[1], segs[2], segs[3]);
      if (fp) {
        const ext = path.extname(fp).toLowerCase();
        const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
          : ext === '.webp' ? 'image/webp' : ext === '.pdf' ? 'application/pdf'
            : ext === '.svg' ? 'image/svg+xml' : 'application/octet-stream';
        // nama berkas unik per unggahan → aman di-cache selamanya
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=31536000, immutable' });
        return fs.createReadStream(fp).pipe(res);
      }
    }
    return R.html(renderError(404, 'Berkas tidak ditemukan', 'Berkas mungkin sudah dihapus.'), 404);
  }

  try {
    req.body = {};
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) req.body = await readBody(req);

    /* ---------- belum login: halaman publik + portal orang tua (slug per sekolah) ---------- */
    if (!session) {
      const segs = pathname0.split('/').filter(Boolean);
      const first = segs[0] || '';
      const kode = String((req.query.get && req.query.get('kode')) || (req.body && req.body.kode) || '').trim();
      const tByCode = kode ? saas.tenantByCode(kode) : null;
      const canonical = ['/portal', '/portal-pegawai', '/portal-slip'];
      const subRoutes = new Set(['siswa', 'pesan', 'cari', 'otp', 'verifikasi', 'hasil', 'cetak', 'nama']);
      const slugMap = (function () { const m = portalSlugMap(); return m[first] ? m : portalSlugMap(true); })();

      // bentuk URL: /<slug>/portal, /portal/<slug>, /<slug>/portal-pegawai/<...>
      let portalPath = null, portalTenant = null;
      if (hostTenant) {
        // domain khusus terverifikasi: portal berada di akar domain
        if (pathname0 === '/' ) { portalPath = '/portal'; portalTenant = hostTenant; }
        for (const c of canonical) {
          if (pathname0 === c || pathname0.startsWith(c + '/')) { portalPath = pathname0; portalTenant = portalTenant || hostTenant; break; }
        }
      }
      if (!portalPath) {
        for (const c of canonical) {
          if (pathname0 !== c && !pathname0.startsWith(c + '/')) continue;
          // '/portal/<slug>' bukan route kanonik → biarkan diurai sebagai slug di bawah
          if (c === '/portal' && segs.length >= 2 && !subRoutes.has(segs[1])) continue;
          portalPath = pathname0;
          break;
        }
      }
      // /portal/<slug>  (kecuali sub-route internal seperti /portal/siswa)
      if (!portalPath && first === 'portal' && segs[1] && !subRoutes.has(segs[1])) {
        const t = saas.tenantByPortalSlug(segs[1]);
        if (!t) return R.html(notFoundSchool(base, segs[1]), 404);
        portalPath = '/portal' + (segs.length > 2 ? '/' + segs.slice(2).join('/') : '');
        portalTenant = t;
      }
      // alamat per sekolah: /<slug> (kanonik → /portal) atau /<slug-portal-lama>
      if (!portalPath) {
        const hit = slugMap[first];
        if (hit) {
          const rest = pathname0.slice(first.length + 1);   // '' | 'portal' | 'siswa' | 'portal-pegawai/x'
          if (hit.canonical) {
            if (!rest) portalPath = '/portal';
            else if (/^(portal|portal-pegawai|portal-slip)(\/|$)/.test(rest)) portalPath = '/' + rest;
          } else {
            portalPath = hit.path + (rest ? '/' + rest : '');
          }
          if (portalPath) portalTenant = saas.tenantById(hit.tenantId);
        }
      }
      // /<slug>/portal...
      if (!portalPath && segs.length >= 2) {
        const rest = '/' + segs.slice(1).join('/');
        const isPortalShape = ['/portal', '/portal-pegawai', '/portal-slip'].some(c => rest === c || rest.startsWith(c + '/'));
        if (isPortalShape) {
          const t = saas.tenantByPortalSlug(segs[0]);
          if (!t) return R.html(notFoundSchool(base, segs[0]), 404);
          portalPath = rest;
          portalTenant = t;
        }
      }
      if (!portalPath && kode) {
        const hit = slugMap[first];
        if (hit) { portalPath = hit.path + pathname0.slice(first.length + 1); portalTenant = saas.tenantById(hit.tenantId); }
      }
      if (portalPath) {
        const t = tByCode || portalTenant || saas.tenantById(1);
        if (!t) return R.html(renderError(503, 'Belum ada sekolah', 'Belum ada sekolah yang terdaftar pada layanan ini.'), 503);
        /* ---- validasi akses halaman publik (Super Admin override + sakelar sekolah) ---- */
        const access = (() => { try { return saas.portalAccess(t, portalPath); } catch (e) { return { ok: true }; } })();
        if (!access.ok) return R.html(portalAccessPage({ base, tenant: t, access }), access.status);
        return await dbm.runAsTenant(t, async () => {
          req.tenant = t;
          req.TA = null; req.taId = null;
          try {
            await dbm.runWithMeta({ ip: clientIp(req), tenantId: t.id, tenantNama: t.nama }, () => runRoute(portalPath));
          } catch (err) { handleError(err, portalPath); }
        });
      }
      if (!isPublicPath(pathname0)) {
        if (req.method === 'POST') return R.redirect(base + '/login?err=' + encodeURIComponent('Sesi Anda berakhir. Silakan masuk kembali.'));
        return R.redirect(base + '/login');
      }
      req.tenant = null;
      return await dbm.runWithMeta({ ip: clientIp(req) }, () => runRoute(pathname0));
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
      return await dbm.runWithMeta({ ip: clientIp(req), tenantId: tenant.id, tenantNama: tenant.nama }, async () => {
        try {
          // ---- keamanan sesi: sesi harus benar-benar milik sekolah ini ----
          if (Number(session.row.tenant_id) !== Number(tenant.id)) {
            saas.destroySession(session.row.token);
            R.set('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0`);
            return R.redirect(base + '/login?err=' + encodeURIComponent('Sesi tidak valid untuk sekolah ini. Silakan masuk kembali.'));
          }
          const u = loadTenantUser(session.row);
          if (!u) {
            saas.destroySession(session.row.token);
            R.set('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0`);
            return R.redirect(base + '/login?err=' + encodeURIComponent('Akun Anda tidak aktif. Hubungi admin sekolah.'));
          }
          if (u.tenant_id !== undefined && u.tenant_id !== null && Number(u.tenant_id) !== Number(tenant.id)) {
            saas.destroySession(session.row.token);
            return R.redirect(base + '/login?err=' + encodeURIComponent('Akun tidak terikat pada sekolah ini.'));
          }
          req.user = u;

          // ---- pemblokiran otomatis (masa aktif habis / ditangguhkan) ----
          if (saas.isBlocked(tenant) && !ALWAYS_ALLOWED.some(p => pathname === p || pathname.startsWith(p + '/'))) {
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

          // ---- halaman publik yang diblokir/dihapus Super Admin tetap tertutup (termasuk sesi sekolah) ----
          if (/^\/(portal|portal-pegawai|portal-slip)(\/|$)/.test(pathname)) {
            const acc = (() => { try { return saas.portalAccess(tenant, pathname); } catch (e) { return { ok: true }; } })();
            if (!acc.ok) return R.html(portalAccessPage({ base, tenant, access: acc }), acc.status);
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
    });
  } catch (err) {
    handleError(err, pathname0);
  }
});

/* ---------------- startup: control plane, queue, penjadwalan backup ---------------- */
try {
  queue.init(saas.db);
  queue.start(30000);
  require('./backup_tg').registerJobs(dbm, saas, queue);
} catch (e) { console.error('[queue-init]', e.message); }

/* pengingat tagihan WhatsApp: worker antrean (jeda acak 2–5 detik) + penjadwalan otomatis */
try {
  require('./reminder').startWorker(dbm, saas);
  require('./reminder').startScheduler(dbm, saas);
} catch (e) { console.error('[wa-reminder-start]', e.message); }

try {
  const admin = saas.ensureBootstrap();
  if (admin && admin.created) {
    console.log('[saas] akun Super Admin Pusat dibuat: ' + admin.email + ' (sandi awal dari SAAS_ADMIN_PASSWORD / default)');
  }
} catch (e) { console.error('[saas]', e.message); }

server.listen(PORT, () => {
  // zona waktu proses (WIB) — dipakai Date, SQLite localtime, worker WA & penjadwalan
  console.log(require('./tz').startupLine());
  if (require('./tz').warning) console.warn('[tz] ' + require('./tz').warning);
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
    // pekerjaan berat (tagihan + pengingat WA) diantrekan, bukan dijalankan inline
    queue.push('billing.daily', { tanggal: today });
    saas.set('last_daily', today);
  } catch (e) { console.error('[saas-billing]', e.message); }
}
setTimeout(runBillingTick, 15000).unref();
setInterval(runBillingTick, 30 * 60 * 1000).unref();

/* auto-backup Telegram: penjadwalan 2x sehari (06:00 & 15:00) melalui queue worker
   supaya banyak sekolah tidak membebani satu request (lihat queue.js + backup_tg.js). */
try { require('./backup_tg').startScheduler(dbm, saas); } catch (e) { console.error('[backup-tg]', e.message); }
