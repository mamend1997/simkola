'use strict';
/**
 * ==================================================================
 * DATABASE / FILE MANAGER (SUPER ADMIN PUSAT)
 * ------------------------------------------------------------------
 *  GET  /super-admin/database          → pilih scope (control plane / sekolah)
 *  GET  /super-admin/database/tabel    → lihat struktur + isi tabel (paginasi)
 *  POST /super-admin/database/sel      → ubah satu sel (parameterized)
 *  POST /super-admin/database/hapus    → hapus satu baris (konfirmasi + audit)
 *  POST /super-admin/database/query    → konsol SQL (SELECT bebas; DDL/DML wajib konfirmasi)
 *  GET  /super-admin/database/export   → unduh isi tabel (.csv)
 *
 * Semua halaman hanya untuk sesi Super Admin Pusat (cookie simkeu_saas).
 * ==================================================================
 */
const COOKIE = 'simkeu_saas';

module.exports = ({ get, post, dbm, lib, ui, saas }) => {
  const { esc, nowStamp } = lib;
  const S = saas.db;

  function parseCookie(req, name) {
    const out = {};
    String(req.headers.cookie || '').split(';').forEach(p => {
      const i = p.indexOf('=');
      if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
    });
    return out[name] || '';
  }
  function me(req) {
    const s = saas.getSession(parseCookie(req, COOKIE));
    if (!s || s.kind !== 'saas') return null;
    const u = saas.adminById(s.user_id);
    return u && u.aktif ? u : null;
  }
  function need(req, res) {
    const u = me(req);
    if (!u) { res.redirect(req.BASE + '/super-admin/login?err=' + encodeURIComponent('Silakan masuk sebagai Super Admin Pusat.')); return null; }
    return u;
  }
  function flash(path, key, msg) { return path + (path.includes('?') ? '&' : '?') + key + '=' + encodeURIComponent(msg); }

  /* ---------------- scope: control plane atau database sekolah ---------------- */
  const NEW_TABLES = ['trash', 'backup', 'koreksi', 'audit', 'audit_log'];
  function scopeOf(raw) {
    const s = String(raw || 'saas');
    if (s === 'saas' || s === '') return { key: 'saas', conn: S, label: 'Control Plane (saas.db)', tenant: null };
    const id = Number(s.replace(/^t:/, ''));
    const t = id ? saas.tenantById(id) : null;
    if (!t) return null;
    return { key: 't:' + t.id, conn: dbm.openTenantConn(t.id, t.db_file), label: t.school_code + ' · ' + t.nama, tenant: t };
  }
  function safeName(n) { return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(n || '')); }
  function tableList(conn) {
    let rows = [];
    try { rows = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all(); } catch (e) { rows = []; }
    return rows.map(r => {
      let n = 0;
      try { n = conn.prepare(`SELECT COUNT(*) c FROM "${r.name}"`).get().c; } catch (e) { n = 0; }
      return { name: r.name, rows: n };
    });
  }
  function hasRowid(conn, table) {
    try { conn.prepare(`SELECT rowid FROM "${table}" LIMIT 1`).get(); return true; } catch (e) { return false; }
  }

  function shell(req, { title, sub, content, user, active = 'db' }) {
    const base = req.BASE;
    const q = req.query;
    const ok = q.get('ok'), err = q.get('err');
    const menu = [
      { href: '/super-admin', label: 'Dashboard', icon: 'dashboard' },
      { href: '/super-admin/sekolah', label: 'Daftar Sekolah', icon: 'school' },
      { href: '/super-admin/pembayaran', label: 'Pembayaran', icon: 'card' },
      { href: '/super-admin/paket', label: 'Paket Langganan', icon: 'layers' },
      { href: '/super-admin/menu-default', label: 'Default Tampilan Menu', icon: 'menu' },
      { href: '/super-admin/branding', label: 'Branding Sistem', icon: 'school' },
      { href: '/super-admin/qris', label: 'QRIS & Harga', icon: 'tag' },
      { href: '/super-admin/tiket', label: 'Pusat Tiket', icon: 'inbox' },
      { href: '/super-admin/pengumuman', label: 'Pengumuman & Maintenance', icon: 'bell' },
      { href: '/super-admin/petunjuk', label: 'Master Petunjuk', icon: 'book' },
      { href: '/super-admin/audit', label: 'Audit Logs', icon: 'shield' },
      { href: '/super-admin/wa', label: 'WA Gateway', icon: 'send' },
      { href: '/super-admin/backup', label: 'Backup & Restore Database System', icon: 'database' },
      { href: '/super-admin/database', label: 'Database Manager', icon: 'database' }
    ];
    const nav = menu.map(m => `<a href="${base}${m.href}" class="sa-nav${active === m.href ? ' on' : ''}">${ui.icon(m.icon)}<span>${esc(m.label)}</span></a>`).join('');
    return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Super Admin</title>
${ui.fontLinks()}
<link rel="stylesheet" href="${base}/assets/app.css?v=${ui.ASSET_V}">
<link rel="icon" href="${base}/favicon.ico">
<style>
.sa-wrap{display:grid;grid-template-columns:248px 1fr;min-height:100vh}
.sa-side{background:#141127;color:#EDE9FE;padding:22px 16px;display:flex;flex-direction:column;gap:16px}
.sa-brand{display:flex;align-items:center;gap:11px;font-weight:800;font-size:15px}
.sa-mark{width:38px;height:38px;border-radius:12px;background:linear-gradient(135deg,#6366F1,#8B5CF6);display:grid;place-items:center;color:#fff}
.sa-nav{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:11px;color:#C7C2E8;font-weight:600;font-size:13px;text-decoration:none}
.sa-nav:hover{background:rgba(255,255,255,.07);color:#fff}
.sa-nav.on{background:linear-gradient(135deg,#6366F1,#8B5CF6);color:#fff}
.sa-nav svg{width:17px;height:17px;flex:0 0 17px}
.sa-main{padding:24px 28px 48px;min-width:0}
.sa-top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:18px}
.sa-top h1{font-size:22px;margin:0;letter-spacing:-.03em}
.sa-user{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.7);border:1px solid var(--line);padding:7px 12px;border-radius:12px;font-size:12.5px}
.db-grid{display:grid;grid-template-columns:250px 1fr;gap:18px;align-items:start}
.db-tables{max-height:72vh;overflow:auto}
.db-tables a{display:flex;justify-content:space-between;gap:8px;padding:7px 10px;border-radius:9px;font-size:12.5px;color:var(--ink-2);text-decoration:none}
.db-tables a:hover{background:var(--o-50)}
.db-tables a.on{background:var(--o-100);color:var(--o-700);font-weight:700}
.db-tables .n{font-size:11px;color:var(--muted)}
.cell-in{width:100%;min-width:90px;border:1px solid transparent;background:transparent;padding:3px 4px;border-radius:6px;font:inherit;font-size:12px;color:inherit}
.cell-in:focus{border-color:var(--o-400);background:#fff;outline:none}
.sql-box{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;line-height:1.5}
@media (max-width:900px){.sa-wrap{grid-template-columns:1fr}.sa-side{flex-direction:row;flex-wrap:wrap;padding:12px}.sa-nav span{display:none}.sa-main{padding:16px}.db-grid{grid-template-columns:1fr}}
</style></head><body>
<div class="sa-wrap">
  <aside class="sa-side">
    <div class="sa-brand"><div class="sa-mark">${ui.icon('shield')}</div><div>Super Admin<br><span style="font-weight:600;font-size:11px;opacity:.7">${esc(saas.appName())}</span></div></div>
    ${nav}
  </aside>
  <main class="sa-main">
    <div class="sa-top">
      <div><h1>${esc(title)}</h1>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>
      <div class="flex" style="gap:10px;align-items:center">
        <div class="sa-user">${ui.icon('users')}<div><b>${esc((user || {}).nama || '')}</b><div class="t-sub">Super Admin Pusat</div></div></div>
        <form method="post" action="${req.BASE}/super-admin/logout"><button class="btn btn-sm">Keluar</button></form>
      </div>
    </div>
    ${ok ? `<div class="alert ok">${ui.icon('check')}<div>${esc(ok)}</div></div>` : ''}
    ${err ? `<div class="alert err">${ui.icon('alert')}<div>${esc(err)}</div></div>` : ''}
    ${content}
  </main>
</div>
<script src="${req.BASE}/assets/app.js?v=${ui.ASSET_V}" defer></script>
<script>
document.querySelectorAll('[data-confirm]').forEach(function(f){f.addEventListener('submit',function(e){if(!confirm(f.dataset.confirm))e.preventDefault();});});
document.querySelectorAll('[data-open]').forEach(function(b){b.addEventListener('click',function(){var m=document.getElementById(b.dataset.open); if(m) m.classList.add('show');});});
document.querySelectorAll('[data-close]').forEach(function(b){b.addEventListener('click',function(){var m=document.getElementById(b.dataset.close); if(m) m.classList.remove('show');});});
</script>
</body></html>`;
  }

  /* ---------------- pilih scope ---------------- */
  get('/super-admin/database', (req, res) => {
    const u = need(req, res); if (!u) return;
    const tenants = saas.allTenants();
    const content = `<div class="card mb-3">
      <div class="card-head"><div><h3>Pemilih Database</h3><div class="sub">Kontrol penuh atas control plane dan seluruh database sekolah</div></div>
        ${ui.badge('Khusus Super Admin', 'orange', 'plain')}</div>
      <div class="alert warn">${ui.icon('alert')}<div>Menu ini memberi akses langsung ke database. Setiap perubahan (edit sel, hapus baris, query SQL)
        dicatat pada <b>Audit Logs</b> Super Admin. Gunakan dengan hati-hati — perubahan tidak dapat dibatalkan.</div></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px">
        <a class="card" href="${req.BASE}/super-admin/database/tabel?scope=saas" style="text-decoration:none">
          <div class="t-sub">CONTROL PLANE</div><div class="t-strong">saas.db</div>
          <div class="small muted">${tenants.length} sekolah · ${tableList(S).length} tabel</div>
          <div class="btn btn-sm mt-1">${ui.icon('database')}Buka</div></a>
        ${tenants.map(t => `<a class="card" href="${req.BASE}/super-admin/database/tabel?scope=t:${t.id}" style="text-decoration:none">
          <div class="t-sub">${esc(t.school_code)} · ${esc(t.paket)}</div><div class="t-strong">${esc(t.nama)}</div>
          <div class="small muted">tenant-${t.id}.db</div>
          <div class="btn btn-sm mt-1">${ui.icon('database')}Buka</div></a>`).join('')}
      </div>
    </div>
    <div class="card">
      <div class="card-head"><div><h3>Konsol SQL</h3><div class="sub">SELECT bebas · DDL/DML wajib konfirmasi</div></div></div>
      <form method="post" action="${req.BASE}/super-admin/database/query">
        <div class="row2">
          <div class="field"><label>Database</label>
            <select name="scope">
              <option value="saas">Control Plane (saas.db)</option>
              ${tenants.map(t => `<option value="t:${t.id}">${esc(t.school_code)} · ${esc(t.nama)}</option>`).join('')}
            </select></div>
          <div class="field"><label>Batas hasil (SELECT)</label><input type="number" name="limit" value="100" min="1" max="1000"></div>
        </div>
        <div class="field"><label>Perintah SQL</label>
          <textarea name="sql" rows="5" class="sql-box" placeholder="SELECT * FROM transaksi ORDER BY id DESC LIMIT 20;"></textarea>
          <div class="hint">Hanya satu perintah per eksekusi. Perintah <code>ATTACH</code>, <code>DETACH</code>, dan <code>load_extension</code> diblokir.</div></div>
        <label class="check mb-2"><input type="checkbox" name="konfirmasi" value="1"> Saya memahami perintah yang menulis data akan langsung mengubah database</label>
        <button class="btn btn-primary">${ui.icon('play')}Jalankan Query</button>
      </form>
    </div>`;
    res.html(shell(req, { title: 'Database Manager', sub: 'Lihat, query, dan edit database secara langsung', content, user: u, active: '/super-admin/database' }));
  });

  /* ---------------- lihat tabel ---------------- */
  get('/super-admin/database/tabel', (req, res) => {
    const u = need(req, res); if (!u) return;
    const sc = scopeOf(req.query.get('scope'));
    if (!sc) return res.redirect(req.BASE + flash('/super-admin/database', 'err', 'Database tidak ditemukan.'));
    const list = tableList(sc.conn);
    let table = String(req.query.get('tabel') || '');
    if (!table || !safeName(table) || !list.some(x => x.name === table)) table = list.length ? list[0].name : '';
    const page = Math.max(1, Number(req.query.get('hal') || 1));
    const per = 40;
    let cols = [], rows = [], total = 0, rowid = false, errMsg = '';
    if (table) {
      rowid = hasRowid(sc.conn, table);
      try { cols = sc.conn.pragma(`table_info("${table}")`); } catch (e) { cols = []; }
      try { total = sc.conn.prepare(`SELECT COUNT(*) c FROM "${table}"`).get().c; } catch (e) { total = 0; }
      try {
        const sel = rowid ? `rowid AS "__rid", *` : '*';
        rows = sc.conn.prepare(`SELECT ${sel} FROM "${table}" ${rowid ? 'ORDER BY rowid DESC' : ''} LIMIT ? OFFSET ?`).all(per, (page - 1) * per);
      } catch (e) { errMsg = e.message; rows = []; }
    }
    const qs = extra => `${req.BASE}/super-admin/database/tabel?scope=${encodeURIComponent(sc.key)}&tabel=${encodeURIComponent(table)}${extra}`;
    const head = ['<th style="width:34px">#</th>'].concat(cols.map(c => `<th>${esc(c.name)}<div class="t-sub">${esc(String(c.type || '').toLowerCase())}${c.pk ? ' · PK' : ''}</div></th>`));
    if (rowid) head.push('<th class="right" style="width:90px">Aksi</th>');
    const body = rows.map((r, i) => {
      const rid = rowid ? r.__rid : null;
      return `<tr>${rowid ? `<td class="t-sub mono">${esc(String(rid))}</td>` : ''}
        ${cols.map(c => {
        const v = r[c.name];
        const txt = v === null || v === undefined ? '' : String(v);
        const cell = rowid
          ? `<input class="cell-in" form="fRow${i}" type="text" name="c_${esc(c.name)}" value="${esc(txt)}" title="${esc(txt.slice(0, 300))}">`
          : esc(txt.length > 120 ? txt.slice(0, 120) + '…' : txt);
        return `<td>${cell}</td>`;
      }).join('')}
        ${rowid ? `<td class="right nowrap"><button class="btn btn-sm" form="fRow${i}" title="Simpan baris">${ui.icon('save')}</button>
          <form method="post" action="${req.BASE}/super-admin/database/hapus" style="display:inline" data-confirm="Hapus baris ${esc(String(rid))} dari tabel ${esc(table)}?">
            <input type="hidden" name="scope" value="${esc(sc.key)}"><input type="hidden" name="tabel" value="${esc(table)}"><input type="hidden" name="rid" value="${esc(String(rid))}">
            <button class="btn btn-sm btn-danger">${ui.icon('trash')}</button></form></td>` : ''}
      </tr>
      ${rowid ? `<form method="post" action="${req.BASE}/super-admin/database/baris" id="fRow${i}" style="display:none">
        <input type="hidden" name="scope" value="${esc(sc.key)}"><input type="hidden" name="tabel" value="${esc(table)}"><input type="hidden" name="rid" value="${esc(String(rid))}">
      </form>` : ''}`;
    }).join('');
    const pages = Math.max(1, Math.ceil(total / per));
    const side = list.map(t => `<a class="${t.name === table ? 'on' : ''}" href="${req.BASE}/super-admin/database/tabel?scope=${encodeURIComponent(sc.key)}&tabel=${encodeURIComponent(t.name)}">
      <span>${esc(t.name)}</span><span class="n">${t.rows}</span></a>`).join('');
    const content = `<div class="card mb-3">
        <div class="card-head"><div><h3>${esc(sc.label)}</h3><div class="sub">${list.length} tabel · mode langsung (perubahan tersimpan seketika)</div></div>
          <div class="toolbar">
            <a class="btn btn-sm" href="${req.BASE}/super-admin/database">${ui.icon('refresh')}Ganti Database</a>
            ${table ? `<a class="btn btn-sm" href="${req.BASE}/super-admin/database/export?scope=${encodeURIComponent(sc.key)}&tabel=${encodeURIComponent(table)}">${ui.icon('download')}CSV</a>` : ''}
          </div></div>
        <div class="db-grid">
          <div class="card db-tables" style="box-shadow:none;padding:8px">
            <div class="t-sub" style="padding:4px 8px">DAFTAR TABEL</div>
            ${side}
          </div>
          <div style="min-width:0">
            ${errMsg ? `<div class="alert err">${ui.icon('alert')}<div>${esc(errMsg)}</div></div>` : ''}
            <div class="table-wrap"><table><thead><tr>${head.join('')}</tr></thead><tbody>
              ${body || `<tr><td colspan="${head.length + 1}" class="muted" style="text-align:center;padding:18px">Tabel kosong.</td></tr>`}
            </tbody></table></div>
            <div class="between mt-2">
              <div class="small muted">${total} baris · halaman ${page}/${pages}${rowid ? '' : ' · tabel tanpa rowid (hanya lihat)'}</div>
              <div class="pager">
                ${page > 1 ? `<a class="btn btn-sm" href="${qs('&hal=' + (page - 1))}">‹ Sebelumnya</a>` : ''}
                ${page < pages ? `<a class="btn btn-sm" href="${qs('&hal=' + (page + 1))}">Berikutnya ›</a>` : ''}
              </div>
            </div>
            <div class="alert info mt-2">${ui.icon('info')}<div><b>Edit baris:</b> ubah nilai pada kolom yang diinginkan lalu klik ikon simpan di ujung baris.
              Perubahan langsung tersimpan ke database dan dicatat pada Audit Logs. Untuk mengubah <b>struktur</b> tabel
              (tambah/ubah kolom, indeks), gunakan <b>Konsol SQL</b> di halaman Database Manager.</div></div>
          </div>
        </div>
      </div>`;
    res.html(shell(req, { title: 'Database Manager', sub: 'Lihat, query, dan edit database secara langsung', content, user: u, active: '/super-admin/database' }));
  });

  /* ---------------- ubah satu baris ---------------- */
  post('/super-admin/database/baris', (req, res) => {
    const u = need(req, res); if (!u) return;
    const sc = scopeOf(req.body.scope);
    const table = String(req.body.tabel || '');
    const back = `/super-admin/database/tabel?scope=${encodeURIComponent(req.body.scope || 'saas')}&tabel=${encodeURIComponent(table)}`;
    if (!sc || !safeName(table)) return res.redirect(req.BASE + flash(back, 'err', 'Parameter edit tidak valid.'));
    try {
      const rid = Number(req.body.rid);
      const sets = [], args = [];
      for (const [k, v] of Object.entries(req.body || {})) {
        if (!k.startsWith('c_')) continue;
        const kolom = k.slice(2);
        if (!safeName(kolom)) continue;
        sets.push(`"${kolom}"=?`);
        args.push(v === '' ? null : String(v));
      }
      if (!sets.length) return res.redirect(req.BASE + flash(back, 'err', 'Tidak ada kolom yang dikirim.'));
      args.push(rid);
      const info = sc.conn.prepare(`UPDATE "${table}" SET ${sets.join(', ')} WHERE rowid=?`).run(...args);
      saas.logSaas(u, 'EDIT DATABASE', 'database',
        `${sc.label} · ${table} rowid ${rid} kolom [${Object.keys(req.body).filter(k => k.startsWith('c_')).map(k => k.slice(2)).join(', ')}] (${info.changes} baris)`,
        sc.tenant ? sc.tenant.id : null);
      res.redirect(req.BASE + flash(back, 'ok', `Baris ${rid} diperbarui.`));
    } catch (e) {
      res.redirect(req.BASE + flash(back, 'err', 'Gagal menyimpan: ' + e.message));
    }
  });

  /* ---------------- hapus satu baris ---------------- */
  post('/super-admin/database/hapus', (req, res) => {
    const u = need(req, res); if (!u) return;
    const sc = scopeOf(req.body.scope);
    const table = String(req.body.tabel || '');
    const back = `/super-admin/database/tabel?scope=${encodeURIComponent(req.body.scope || 'saas')}&tabel=${encodeURIComponent(table)}`;
    if (!sc || !safeName(table)) return res.redirect(req.BASE + flash(back, 'err', 'Parameter hapus tidak valid.'));
    try {
      const info = sc.conn.prepare(`DELETE FROM "${table}" WHERE rowid=?`).run(Number(req.body.rid));
      saas.logSaas(u, 'HAPUS DATABASE', 'database', `${sc.label} · ${table} rowid ${req.body.rid} (${info.changes} baris)`, sc.tenant ? sc.tenant.id : null);
      res.redirect(req.BASE + flash(back, 'ok', `Baris ${req.body.rid} dihapus.`));
    } catch (e) {
      res.redirect(req.BASE + flash(back, 'err', 'Gagal menghapus: ' + e.message));
    }
  });

  /* ---------------- konsol SQL ---------------- */
  post('/super-admin/database/query', (req, res) => {
    const u = need(req, res); if (!u) return;
    const sc = scopeOf(req.body.scope);
    const back = '/super-admin/database';
    if (!sc) return res.redirect(req.BASE + flash(back, 'err', 'Database tidak ditemukan.'));
    const sql = String(req.body.sql || '').trim().replace(/;\s*$/, '');
    if (!sql) return res.redirect(req.BASE + flash(back, 'err', 'Perintah SQL masih kosong.'));
    if (/;/.test(sql)) return res.redirect(req.BASE + flash(back, 'err', 'Jalankan satu perintah per eksekusi (tanpa titik koma ganda).'));
    if (/\b(attach|detach|load_extension|pragma\s+wal_checkpoint|vacuum\s+into)\b/i.test(sql)) {
      return res.redirect(req.BASE + flash(back, 'err', 'Perintah tersebut diblokir pada Database Manager.'));
    }
    const isRead = /^(select|pragma|explain|with)\b/i.test(sql);
    if (!isRead && !req.body.konfirmasi) {
      return res.redirect(req.BASE + flash(back, 'err', 'Perintah yang menulis data wajib dicentang konfirmasinya.'));
    }
    let result;
    try {
      const stmt = sc.conn.prepare(sql);
      if (stmt.reader) {
        const limit = Math.max(1, Math.min(1000, Number(req.body.limit || 100)));
        const rows = stmt.all().slice(0, limit);
        const cols = rows.length ? Object.keys(rows[0]) : [];
        result = `<div class="table-wrap short"><table><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>
          ${rows.length ? rows.map(r => `<tr>${cols.map(c => {
          const v = r[c];
          const s = v === null || v === undefined ? '' : String(v);
          return `<td class="small">${esc(s.length > 200 ? s.slice(0, 200) + '…' : s)}</td>`;
        }).join('')}</tr>`).join('') : `<tr><td class="muted" style="text-align:center;padding:16px">Tidak ada hasil.</td></tr>`}
        </tbody></table></div>
        <div class="small muted mt-1">${rows.length} baris ditampilkan (batas ${limit}).</div>`;
      } else {
        const info = stmt.run();
        result = `<div class="alert ok">${ui.icon('check')}<div>Perintah dieksekusi. ${info.changes} baris terpengaruh.</div></div>`;
      }
      saas.logSaas(u, 'QUERY DATABASE', 'database', `${sc.label} · ${sql.slice(0, 180)}`, sc.tenant ? sc.tenant.id : null);
    } catch (e) {
      result = `<div class="alert err">${ui.icon('alert')}<div><b>Query gagal:</b> ${esc(e.message)}</div></div>`;
    }
    const content = `<div class="card mb-3">
      <div class="card-head"><div><h3>Hasil Query</h3><div class="sub">${esc(sc.label)}</div></div>
        <a class="btn btn-sm" href="${req.BASE}/super-admin/database">${ui.icon('refresh')}Kembali</a></div>
      <pre class="sql-box" style="background:var(--o-50);padding:10px;border-radius:10px;overflow:auto">${esc(sql)}</pre>
      ${result}
    </div>`;
    res.html(shell(req, { title: 'Database Manager', sub: 'Hasil eksekusi query', content, user: u, active: '/super-admin/database' }));
  });

  /* ---------------- export tabel CSV ---------------- */
  get('/super-admin/database/export', (req, res) => {
    const u = need(req, res); if (!u) return;
    const sc = scopeOf(req.query.get('scope'));
    const table = String(req.query.get('tabel') || '');
    if (!sc || !safeName(table)) return res.redirect(req.BASE + '/super-admin/database');
    try {
      const rows = sc.conn.prepare(`SELECT * FROM "${table}"`).all();
      const cols = rows.length ? Object.keys(rows[0]) : [];
      const esc2 = v => {
        const s = v === null || v === undefined ? '' : String(v);
        return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const csv = [cols.join(',')].concat(rows.map(r => cols.map(c => esc2(r[c])).join(','))).join('\r\n');
      saas.logSaas(u, 'EXPORT DATABASE', 'database', `${sc.label} · ${table} (${rows.length} baris)`, sc.tenant ? sc.tenant.id : null);
      res.file(Buffer.from(csv, 'utf8'), `${table}-${String(nowStamp()).slice(0, 10)}.csv`, 'text/csv; charset=utf-8');
    } catch (e) {
      res.redirect(req.BASE + flash('/super-admin/database', 'err', 'Gagal export: ' + e.message));
    }
  });
};
