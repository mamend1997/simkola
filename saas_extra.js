'use strict';
/**
 * ==================================================================
 * CONTROL PLANE — fitur lanjutan (dipasang ke modul saas.js)
 * ------------------------------------------------------------------
 * Bagian ini menangani hal-hal lintas sekolah yang dipakai bersama:
 *   · Master Petunjuk Pengguna (dibaca semua sekolah, read-only)
 *   · Pengumuman global (banner / pop-up) & Maintenance Mode
 *   · Tiket kendala (helpdesk) sekolah ↔ Super Admin
 *   · WhatsApp Gateway pusat (pengingat H-7 & status pembayaran)
 *   · portal_slug (unik antar sekolah) + custom domain
 *   · Audit Logs terpusat (query + filter)
 *   · Notifikasi kredensial sekali-tampil setelah reset password
 * ==================================================================
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const dns = require('dns');

module.exports = function augment(saas) {
  const {
    S, lib, dbm, get, set, allTenants, tenantById, logSaas, todayISO, addDays, daysBetween, PAKET
  } = saas;

  /* ================= skema tambahan ================= */
  S.exec(`
CREATE TABLE IF NOT EXISTS master_guides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  judul TEXT NOT NULL,
  kategori TEXT,
  ringkas TEXT,
  konten TEXT,
  video_url TEXT,
  lampiran_url TEXT,
  urutan INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1,
  dibuat_oleh TEXT, created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  judul TEXT NOT NULL,
  isi TEXT,
  tipe TEXT NOT NULL DEFAULT 'banner',
  warna TEXT NOT NULL DEFAULT 'info',
  aktif INTEGER NOT NULL DEFAULT 1,
  mulai TEXT, selesai TEXT,
  dibuat_oleh TEXT, created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kode TEXT,
  tenant_id INTEGER NOT NULL,
  kategori TEXT,
  judul TEXT NOT NULL,
  deskripsi TEXT,
  bukti_url TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  prioritas TEXT NOT NULL DEFAULT 'normal',
  dibuat_oleh TEXT, created_at TEXT, updated_at TEXT,
  ditutup_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tickets_tenant ON tickets(tenant_id, id);
CREATE TABLE IF NOT EXISTS ticket_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  dari TEXT NOT NULL DEFAULT 'tenant',
  nama TEXT, pesan TEXT, lampiran_url TEXT, created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ticket_msg ON ticket_messages(ticket_id, id);
`);
  const cols = (t) => S.pragma(`table_info("${t}")`).map(c => c.name);
  const addCol = (t, name, ddl) => { if (!cols(t).includes(name)) S.exec(`ALTER TABLE ${t} ADD COLUMN ${name} ${ddl}`); };
  addCol('tenants', 'portal_slug', 'TEXT');
  addCol('tenants', 'custom_domain', 'TEXT');
  addCol('tenants', 'custom_domain_status', "TEXT NOT NULL DEFAULT ''");
  addCol('tenants', 'tg_token', 'TEXT');
  addCol('tenants', 'tg_chat', 'TEXT');
  addCol('tenants', 'tg_aktif', 'INTEGER NOT NULL DEFAULT 1');
  addCol('tenants', 'tg_slots', "TEXT NOT NULL DEFAULT '06:00,15:00'");
  addCol('tenants', 'tg_last', 'TEXT');
  addCol('tenants', 'wa_notify', 'INTEGER NOT NULL DEFAULT 1');
  S.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_portal_slug ON tenants(portal_slug) WHERE portal_slug IS NOT NULL AND portal_slug<>\'\'');
  S.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_custom_domain ON tenants(custom_domain) WHERE custom_domain IS NOT NULL AND custom_domain<>\'\'');

  const DEFAULTS = {
    maintenance_aktif: '0',
    maintenance_pesan: 'Kami sedang melakukan pemeliharaan sistem untuk meningkatkan layanan. Silakan kembali beberapa saat lagi.',
    maintenance_selesai: '',
    maint_last_notice: '',
    wa_api_url: '', wa_api_token: '', wa_sender: '', wa_payload: 'form', wa_aktif: '0', wa_demo: '1',
    saas_base_url: ''
  };
  for (const [k, v] of Object.entries(DEFAULTS)) S.prepare('INSERT OR IGNORE INTO saas_settings (k,v) VALUES (?,?)').run(k, v);

  /* ================= slug & domain ================= */
  const RESERVED = new Set([
    // seluruh halaman aplikasi sekolah (tidak boleh dipakai sebagai slug portal)
    ...(dbm.RESERVED_SLUGS ? Array.from(dbm.RESERVED_SLUGS) : []),
    'super-admin', 'login', 'logout', 'register', 'daftar', 'portal', 'portal-pegawai', 'portal-slip',
    'akun', 'info-layanan', 'perpanjang', 'assets', 'files', 'favicon.ico', 'api', 'admin', 'www',
    'app', 'static', 'public', 'help', 'bantuan', 'tiket', 'dashboard', 'sitemap.xml', 'robots.txt'
  ]);

  function slugify(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'sekolah';
  }
  function portalSlugTaken(slug, exceptId) {
    const s = String(slug || '').trim().toLowerCase();
    if (!s) return false;
    const r = S.prepare('SELECT id FROM tenants WHERE lower(COALESCE(portal_slug,\'\'))=?').get(s);
    return !!(r && Number(r.id) !== Number(exceptId || 0));
  }
  function portalSlugError(raw, exceptId) {
    const s = String(raw || '').trim().toLowerCase();
    if (!s) return 'Alamat portal wajib diisi.';
    if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(s)) {
      return 'Alamat portal hanya boleh huruf kecil, angka, dan tanda hubung (-), panjang 3–40 karakter.';
    }
    if (RESERVED.has(s)) return 'Alamat "' + s + '" dipakai halaman lain aplikasi. Pilih alamat lain.';
    if (portalSlugTaken(s, exceptId)) return 'Alamat "' + s + '" sudah dipakai sekolah lain. Pilih alamat unik.';
    return null;
  }
  /** slug unik dari nama sekolah: "SDN 1 Jakarta" → "sdn-1-jakarta", tambah -2 bila bentrok */
  function slugFromName(nama, exceptId) {
    const base = slugify(nama);
    if (!portalSlugError(base, exceptId)) return base;
    for (let i = 2; i <= 99; i++) {
      const cand = (base.slice(0, 36) + '-' + i).replace(/-+/g, '-');
      if (!portalSlugError(cand, exceptId)) return cand;
    }
    return (base.slice(0, 30) + '-' + Date.now().toString(36).slice(-4));
  }
  function setPortalSlug(id, slug, user) {
    const t = tenantById(id);
    if (!t) throw new Error('Sekolah tidak ditemukan.');
    const err = portalSlugError(slug, id);
    if (err) throw new Error(err);
    S.prepare('UPDATE tenants SET portal_slug=?,updated_at=? WHERE id=?').run(String(slug).trim().toLowerCase(), lib.nowStamp(), id);
    syncTenantSetting(id, 'portal_slug', String(slug).trim().toLowerCase());
    logSaas(user, 'UBAH SLUG', 'tenant', `${t.nama}: alamat portal → /${slug}`, id);
    return tenantById(id);
  }

  function syncTenantSetting(tenantId, key, value) {
    try {
      const conn = dbm.openTenantConn(tenantId, (tenantById(tenantId) || {}).db_file);
      conn.prepare('INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(String(key), String(value ?? ''));
    } catch (e) { }
  }

  function normalizeDomain(raw) {
    return String(raw || '').trim().toLowerCase()
      .replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');
  }
  function domainError(raw, exceptId) {
    const d = normalizeDomain(raw);
    if (!d) return 'Domain wajib diisi.';
    if (!/^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/.test(d)) return 'Format domain tidak valid (contoh: keuangan.sman1.sch.id).';
    if (d.split('.').length < 2) return 'Domain harus memuat titik, mis. sekolah.sch.id.';
    const r = S.prepare("SELECT id FROM tenants WHERE lower(COALESCE(custom_domain,''))=?").get(d);
    if (r && Number(r.id) !== Number(exceptId || 0)) return 'Domain ini sudah dipakai sekolah lain.';
    return null;
  }
  function setCustomDomain(id, domain, user, status) {
    const t = tenantById(id);
    if (!t) throw new Error('Sekolah tidak ditemukan.');
    const d = normalizeDomain(domain);
    if (!d) {
      S.prepare("UPDATE tenants SET custom_domain=NULL,custom_domain_status='',updated_at=? WHERE id=?").run(lib.nowStamp(), id);
      syncTenantSetting(id, 'custom_domain', ''); syncTenantSetting(id, 'custom_domain_status', '');
      logSaas(user, 'HAPUS DOMAIN', 'tenant', `${t.nama}: domain khusus dihapus`, id);
      return tenantById(id);
    }
    const err = domainError(d, id);
    if (err) throw new Error(err);
    const st = String(status || 'pending').toLowerCase();
    S.prepare('UPDATE tenants SET custom_domain=?,custom_domain_status=?,updated_at=? WHERE id=?').run(d, st, lib.nowStamp(), id);
    syncTenantSetting(id, 'custom_domain', d);
    syncTenantSetting(id, 'custom_domain_status', st.toUpperCase());
    logSaas(user, status ? 'VERIFIKASI DOMAIN' : 'AJUKAN DOMAIN', 'tenant', `${t.nama}: ${d} (${st})`, id);
    return tenantById(id);
  }
  function tenantByDomain(host) {
    const h = normalizeDomain(host);
    if (!h) return null;
    const r = S.prepare('SELECT * FROM tenants WHERE lower(COALESCE(custom_domain,\'\'))=?').get(h);
    if (!r) return null;
    return { tenant: r, verified: String(r.custom_domain_status || '').toUpperCase() === 'VERIFIED' };
  }
  function tenantByPortalSlug(slug) {
    const s = String(slug || '').trim().toLowerCase();
    if (!s) return null;
    return S.prepare('SELECT * FROM tenants WHERE lower(COALESCE(portal_slug,\'\'))=?').get(s) || null;
  }
  /** cek DNS: CNAME ke target platform atau A record ke IP server */
  async function checkDns(domain) {
    const d = normalizeDomain(domain);
    const out = { domain: d, cname: [], a: [], ok: false, note: '' };
    const target = normalizeDomain(process.env.PORTAL_CNAME_TARGET || get('saas_base_url', '') || '');
    try { out.cname = await dns.promises.resolveCname(d); } catch (e) { out.cname = []; }
    try { out.a = await dns.promises.resolve4(d); } catch (e) { out.a = []; }
    const ip = String(process.env.SERVER_IP || '').trim();
    if (target && out.cname.some(c => normalizeDomain(c) === target)) { out.ok = true; out.note = 'CNAME mengarah ke ' + target; }
    else if (ip && out.a.includes(ip)) { out.ok = true; out.note = 'A record mengarah ke ' + ip; }
    else if (!out.cname.length && !out.a.length) { out.note = 'DNS belum mengarah (NXDOMAIN / belum propagasi).'; }
    else { out.note = 'DNS ditemukan tetapi belum mengarah ke server: ' + (out.cname.concat(out.a).join(', ') || '-'); }
    return out;
  }

  /* ================= Master Petunjuk Pengguna ================= */
  function guideRows(opts = {}) {
    let sql = 'SELECT * FROM master_guides';
    const where = [], args = [];
    if (opts.publishedOnly) where.push('published=1');
    if (opts.kategori) { where.push('kategori=?'); args.push(String(opts.kategori)); }
    if (opts.q) { where.push('(lower(judul) LIKE ? OR lower(COALESCE(ringkas,\'\')) LIKE ?)'); args.push('%' + String(opts.q).toLowerCase() + '%', '%' + String(opts.q).toLowerCase() + '%'); }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY urutan, id';
    return S.prepare(sql).all(...args);
  }
  function guideById(id) { return id ? S.prepare('SELECT * FROM master_guides WHERE id=?').get(Number(id)) || null : null; }
  function guideSave(d) {
    const judul = String(d.judul || '').trim();
    if (!judul) return null;
    const now = lib.nowStamp();
    const urut = Number(d.urutan);
    const fields = [
      judul, String(d.kategori || '').trim(), String(d.ringkas || ''),
      String(d.konten || ''), String(d.video_url || '').trim(), String(d.lampiran_url || '').trim(),
      Number.isFinite(urut) ? urut : 0, d.published ? 1 : 0, String(d.oleh || ''), now
    ];
    if (d.id && guideById(d.id)) {
      S.prepare(`UPDATE master_guides SET judul=?,kategori=?,ringkas=?,konten=?,video_url=?,lampiran_url=?,
        urutan=?,published=?,dibuat_oleh=?,updated_at=? WHERE id=?`).run(...fields, Number(d.id));
      return guideById(d.id);
    }
    const info = S.prepare(`INSERT INTO master_guides (judul,kategori,ringkas,konten,video_url,lampiran_url,urutan,published,dibuat_oleh,updated_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(...fields, now);
    return guideById(Number(info.lastInsertRowid));
  }
  function guideDelete(id) {
    const row = guideById(id);
    if (row) S.prepare('DELETE FROM master_guides WHERE id=?').run(row.id);
    return row;
  }
  function guideReorder(ids) {
    const upd = S.prepare('UPDATE master_guides SET urutan=? WHERE id=?');
    ids.forEach((id, i) => upd.run(i + 1, Number(id)));
    return ids.length;
  }

  /* ================= Pengumuman global ================= */
  function announcementRows(opts = {}) {
    try { return S.prepare('SELECT * FROM announcements ORDER BY id DESC').all(); } catch (e) { return []; }
  }
  function announcementById(id) { return id ? S.prepare('SELECT * FROM announcements WHERE id=?').get(Number(id)) || null : null; }
  function announcementSave(d) {
    const judul = String(d.judul || '').trim();
    if (!judul) return null;
    const now = lib.nowStamp();
    const tipe = d.tipe === 'popup' ? 'popup' : 'banner';
    const warna = ['info', 'ok', 'warn', 'err'].includes(String(d.warna)) ? String(d.warna) : 'info';
    const vals = [judul, String(d.isi || ''), tipe, warna, d.aktif ? 1 : 0,
      String(d.mulai || '').trim(), String(d.selesai || '').trim(), String(d.oleh || ''), now];
    if (d.id && announcementById(d.id)) {
      S.prepare(`UPDATE announcements SET judul=?,isi=?,tipe=?,warna=?,aktif=?,mulai=?,selesai=?,dibuat_oleh=?,updated_at=? WHERE id=?`)
        .run(...vals, Number(d.id));
      return announcementById(d.id);
    }
    const info = S.prepare(`INSERT INTO announcements (judul,isi,tipe,warna,aktif,mulai,selesai,dibuat_oleh,updated_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(...vals, now);
    return announcementById(Number(info.lastInsertRowid));
  }
  function announcementDelete(id) {
    const row = announcementById(id);
    if (row) S.prepare('DELETE FROM announcements WHERE id=?').run(row.id);
    return row;
  }
  /** pengumuman yang tampil sekarang (dipakai ui.layout di seluruh sekolah) */
  function visibleAnnouncements(tenantId) {
    const today = todayISO();
    try {
      return S.prepare("SELECT * FROM announcements WHERE aktif=1 ORDER BY id DESC").all()
        .filter(a => (!a.mulai || String(a.mulai).slice(0, 10) <= today) && (!a.selesai || String(a.selesai).slice(0, 10) >= today))
        .slice(0, 4)
        .map(a => ({ id: a.id, judul: a.judul, isi: a.isi, tipe: a.tipe, warna: a.warna }));
    } catch (e) { return []; }
  }

  /* ================= Maintenance mode ================= */
  function maintenance() {
    const aktif = String(get('maintenance_aktif', '0')) === '1';
    return {
      aktif,
      pesan: String(get('maintenance_pesan', '') || ''),
      selesai: String(get('maintenance_selesai', '') || ''),
      mulai: String(get('maintenance_aktif_sejak', '') || '')
    };
  }
  function setMaintenance(on, pesan, selesai, user) {
    if (on) {
      if (!String(pesan || '').trim()) throw new Error('Pesan pemberitahuan maintenance wajib diisi.');
      set('maintenance_aktif', '1');
      set('maintenance_pesan', String(pesan).trim());
      set('maintenance_selesai', String(selesai || '').trim());
      set('maintenance_aktif_sejak', lib.nowStamp());
      logSaas(user, 'MAINTENANCE ON', 'saas', 'Mode perbaikan diaktifkan untuk seluruh sekolah');
    } else {
      set('maintenance_aktif', '0');
      set('maintenance_selesai', '');
      logSaas(user, 'MAINTENANCE OFF', 'saas', 'Mode perbaikan dimatikan');
    }
    return maintenance();
  }

  /* ================= Tiket kendala ================= */
  const TICKET_STATUS = { open: 'Open', in_progress: 'In Progress', resolved: 'Resolved' };
  const TICKET_KATEGORI = ['Bug / Error Aplikasi', 'Data Tidak Sesuai', 'Tidak Bisa Login', 'Laporan & Cetak',
    'Iuran / SPP', 'Payroll / Honor', 'Permintaan Fitur', 'Lainnya'];

  function ticketKode(id) { return 'TKT-' + String(id).padStart(5, '0'); }
  function ticketCreate(tenantId, d) {
    const judul = String(d.judul || '').trim();
    if (!judul) throw new Error('Judul kendala wajib diisi.');
    if (!String(d.deskripsi || '').trim()) throw new Error('Deskripsi kendala wajib diisi.');
    const now = lib.nowStamp();
    const info = S.prepare(`INSERT INTO tickets (tenant_id,kategori,judul,deskripsi,bukti_url,status,prioritas,dibuat_oleh,created_at,updated_at)
      VALUES (?,?,?,?,?,'open',?,?,?,?)`).run(
      Number(tenantId), String(d.kategori || 'Lainnya'), judul, String(d.deskripsi || ''),
      String(d.bukti_url || ''), String(d.prioritas || 'normal'), String(d.oleh || ''), now, now);
    const id = Number(info.lastInsertRowid);
    S.prepare('UPDATE tickets SET kode=? WHERE id=?').run(ticketKode(id), id);
    return ticketById(id);
  }
  function ticketById(id) { return id ? S.prepare('SELECT * FROM tickets WHERE id=?').get(Number(id)) || null : null; }
  function ticketsOf(tenantId) {
    return S.prepare('SELECT * FROM tickets WHERE tenant_id=? ORDER BY id DESC').all(Number(tenantId) || 0);
  }
  function ticketsAll(opts = {}) {
    let sql = `SELECT t.*, s.nama sekolah_nama, s.school_code FROM tickets t JOIN tenants s ON s.id=t.tenant_id`;
    const where = [], args = [];
    if (opts.status) { where.push('t.status=?'); args.push(String(opts.status)); }
    if (opts.tenantId) { where.push('t.tenant_id=?'); args.push(Number(opts.tenantId)); }
    if (opts.q) {
      where.push('(lower(t.judul) LIKE ? OR lower(COALESCE(t.deskripsi,\'\')) LIKE ? OR lower(COALESCE(s.nama,\'\')) LIKE ? OR lower(COALESCE(t.kode,\'\')) LIKE ?)');
      const q = '%' + String(opts.q).toLowerCase() + '%';
      args.push(q, q, q, q);
    }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY CASE t.status WHEN \'open\' THEN 0 WHEN \'in_progress\' THEN 1 ELSE 2 END, t.id DESC LIMIT 300';
    return S.prepare(sql).all(...args);
  }
  function ticketMessages(ticketId) {
    return S.prepare('SELECT * FROM ticket_messages WHERE ticket_id=? ORDER BY id').all(Number(ticketId) || 0);
  }
  function ticketMessageAdd(ticketId, { dari, nama, pesan, lampiran_url }) {
    const t = ticketById(ticketId);
    if (!t) throw new Error('Tiket tidak ditemukan.');
    if (!String(pesan || '').trim() && !lampiran_url) throw new Error('Pesan balasan tidak boleh kosong.');
    const now = lib.nowStamp();
    S.prepare('INSERT INTO ticket_messages (ticket_id,dari,nama,pesan,lampiran_url,created_at) VALUES (?,?,?,?,?,?)')
      .run(t.id, dari === 'admin' ? 'admin' : 'tenant', String(nama || ''), String(pesan || ''), String(lampiran_url || ''), now);
    // balasan pertama dari Super Admin otomatis memindahkan status ke "in_progress"
    if (dari === 'admin' && t.status === 'open') {
      S.prepare("UPDATE tickets SET status='in_progress',updated_at=? WHERE id=?").run(now, t.id);
    } else {
      S.prepare('UPDATE tickets SET updated_at=? WHERE id=?').run(now, t.id);
    }
    return ticketById(t.id);
  }
  function ticketStatus(id, status, user) {
    const t = ticketById(id);
    if (!t) throw new Error('Tiket tidak ditemukan.');
    const st = TICKET_STATUS[status] ? status : 'open';
    S.prepare('UPDATE tickets SET status=?,updated_at=?,ditutup_at=? WHERE id=?')
      .run(st, lib.nowStamp(), st === 'resolved' ? lib.nowStamp() : null, t.id);
    logSaas(user, 'STATUS TIKET', 'tiket', `${t.kode} → ${TICKET_STATUS[st]}`, t.tenant_id);
    return ticketById(id);
  }

  /* ================= WhatsApp gateway pusat ================= */
  function waConfig() {
    return {
      url: String(process.env.SAAS_WA_URL || get('wa_api_url', '') || '').trim(),
      token: String(process.env.SAAS_WA_TOKEN || get('wa_api_token', '') || '').trim(),
      sender: String(process.env.SAAS_WA_SENDER || get('wa_sender', '') || '').trim(),
      payload: String(get('wa_payload', 'form') || 'form').toLowerCase(),
      aktif: String(get('wa_aktif', '0')) === '1',
      demo: String(get('wa_demo', '1')) === '1'
    };
  }
  function normalizePhone(raw) {
    let s = String(raw || '').replace(/[^\d+]/g, '');
    if (!s) return '';
    if (s.startsWith('+')) s = s.slice(1);
    if (s.startsWith('0')) s = '62' + s.slice(1);
    if (s.startsWith('8')) s = '62' + s;
    return s;
  }
  async function sendWA(phone, message) {
    const cfg = waConfig();
    const target = normalizePhone(phone);
    if (!target) return { ok: false, reason: 'Nomor WhatsApp tidak valid.' };
    if (!cfg.url || !cfg.aktif) return { ok: false, demo: cfg.demo, reason: 'WA Gateway belum diaktifkan pada panel Super Admin.' };
    try {
      let r;
      if (cfg.payload === 'json') {
        r = await fetch(cfg.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(cfg.token ? { Authorization: cfg.token } : {}) },
          body: JSON.stringify({ target, phone: target, message, sender: cfg.sender })
        });
      } else {
        const form = new URLSearchParams({ target, message });
        if (cfg.sender) form.set('sender', cfg.sender);
        r = await fetch(cfg.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(cfg.token ? { Authorization: cfg.token } : {}) },
          body: form.toString()
        });
      }
      const text = await r.text();
      let j = null;
      try { j = JSON.parse(text); } catch (e) { }
      const okBody = j ? (j.status === true || j.status === 'true' || j.success === true || j.ok === true) : r.ok;
      if (!r.ok || !okBody) return { ok: false, reason: (j && (j.reason || j.message || j.error)) || ('HTTP ' + r.status), raw: text.slice(0, 300) };
      return { ok: true, target, raw: text.slice(0, 300) };
    } catch (e) {
      return { ok: false, reason: String(e && e.message || e) };
    }
  }
  /** kirim WA ke admin sekolah (dipakai cron H-7 & status pembayaran) */
  async function notifyTenantAdmin(tenantId, message, opts = {}) {
    const t = tenantById(tenantId);
    if (!t) return { ok: false, reason: 'Sekolah tidak ditemukan.' };
    if (!Number(t.wa_notify !== 0)) return { ok: false, reason: 'Notifikasi WA sekolah dimatikan.' };
    const phone = String(t.contact_telp || opts.phone || '').trim();
    if (!phone) return { ok: false, reason: 'Nomor WhatsApp admin sekolah belum diisi.' };
    const r = await sendWA(phone, message);
    logSaas(null, r.ok ? 'WA TERKIRIM' : 'WA GAGAL', 'wa', `${t.nama} → ${normalizePhone(phone)}: ${r.ok ? 'terkirim' : r.reason}`, t.id);
    return Object.assign({ tenant: t.nama, phone }, r);
  }

  /* ================= audit log ================= */
  function auditRows(opts = {}) {
    const where = [], args = [];
    if (opts.tenantId) { where.push('tenant_id=?'); args.push(Number(opts.tenantId)); }
    if (opts.aksi) { where.push('aksi=?'); args.push(String(opts.aksi)); }
    if (opts.q) {
      where.push('(lower(COALESCE(user_nama,\'\')) LIKE ? OR lower(COALESCE(detail,\'\')) LIKE ? OR lower(COALESCE(tenant_nama,\'\')) LIKE ?)');
      const q = '%' + String(opts.q).toLowerCase() + '%';
      args.push(q, q, q);
    }
    if (opts.from) { where.push('substr(created_at,1,10) >= ?'); args.push(String(opts.from).slice(0, 10)); }
    if (opts.to) { where.push('substr(created_at,1,10) <= ?'); args.push(String(opts.to).slice(0, 10)); }
    const sql = 'SELECT * FROM audit_log' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY id DESC LIMIT ' + (Number(opts.limit) || 200);
    try { return S.prepare(sql).all(...args); } catch (e) { return []; }
  }
  function auditActions() {
    try { return S.prepare('SELECT aksi, COUNT(*) c FROM audit_log GROUP BY aksi ORDER BY c DESC LIMIT 40').all(); } catch (e) { return []; }
  }

  /* ================= notifikasi kredensial (reset password) ================= */
  const credNotices = new Map();   // token sesi super admin → { ...kredensial, exp }
  function credNoticeSet(sessionToken, data) {
    credNotices.set(String(sessionToken), Object.assign({}, data, { exp: Date.now() + 10 * 60 * 1000 }));
  }
  function credNoticeTake(sessionToken) {
    const k = String(sessionToken || '');
    const v = credNotices.get(k);
    if (!v) return null;
    credNotices.delete(k);
    if (v.exp < Date.now()) return null;
    return v;
  }

  /* ================= backup log (Telegram) ================= */
  function backupLogAdd(row) {
    try {
      S.prepare(`INSERT INTO saas_backup_log (scope,tenant_id,nama_berkas,ukuran,status,pesan,pemicu,tujuan,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(
        String(row.scope || 'saas'), row.tenant_id || null, String(row.nama_berkas || ''), Number(row.ukuran || 0),
        String(row.status || 'gagal'), String(row.pesan || ''), String(row.pemicu || 'jadwal'),
        String(row.tujuan || ''), lib.nowStamp());
      return true;
    } catch (e) { return false; }
  }
  function backupLogRows(scope, limit = 15) {
    try {
      return S.prepare('SELECT * FROM saas_backup_log WHERE scope=? ORDER BY id DESC LIMIT ?').all(String(scope || 'saas'), Number(limit) || 15);
    } catch (e) { return []; }
  }

  /* ================= password acak aman ================= */
  function randomPassword(len = 12) {
    const lower = 'abcdefghijkmnopqrstuvwxyz';
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const digit = '23456789';
    const sym = '#@$%&*!?';
    const all = lower + upper + digit + sym;
    const pick = s => s[Math.floor(Math.random() * s.length)];
    let out = [pick(upper), pick(lower), pick(digit), pick(sym)];
    while (out.length < len) out.push(pick(all));
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out.join('');
  }

  return {
    RESERVED, slugify, slugFromName, portalSlugTaken, portalSlugError, setPortalSlug,
    tenantByPortalSlug, normalizeDomain, domainError, setCustomDomain, tenantByDomain, checkDns,
    guideRows, guideById, guideSave, guideDelete, guideReorder,
    announcementRows, announcementById, announcementSave, announcementDelete, visibleAnnouncements,
    maintenance, setMaintenance,
    TICKET_STATUS, TICKET_KATEGORI, ticketKode, ticketCreate, ticketById, ticketsOf, ticketsAll,
    ticketMessages, ticketMessageAdd, ticketStatus,
    waConfig, sendWA, notifyTenantAdmin, normalizePhone,
    auditRows, auditActions,
    credNoticeSet, credNoticeTake,
    backupLogAdd, backupLogRows, syncTenantSetting, randomPassword
  };
};
