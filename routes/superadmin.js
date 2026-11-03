'use strict';
/**
 * ==================================================================
 * PORTAL SUPER ADMIN PUSAT  →  /super-admin
 * ------------------------------------------------------------------
 * Route terpisah dari portal sekolah. Semua halaman dilindungi sesi
 * control-plane (cookie simkeu_saas) dengan peran super_admin.
 *
 *   /super-admin                 dashboard SaaS
 *   /super-admin/sekolah         daftar + tambah sekolah
 *   /super-admin/sekolah/:id     detail: paket, masa aktif, lifetime, fitur
 *   /super-admin/pembayaran      persetujuan pembayaran (QRIS manual)
 *   /super-admin/qris            pengaturan QRIS / DANA Bisnis
 *   /super-admin/backup          auto-backup database via email (SMTP)
 * ==================================================================
 */
const mailer = require('../mailer');

const COOKIE = 'simkeu_saas';

module.exports = ({ get, post, dbm, lib, ui, saas, uploadMedia }) => {
  const { esc, rupiah, tglID, nowStamp } = lib;
  const S = saas.db;

  /* ---------------- sesi super admin ---------------- */
  function parseCookie(req, name) {
    const out = {};
    String(req.headers.cookie || '').split(';').forEach(p => {
      const i = p.indexOf('=');
      if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
    });
    return out[name] || '';
  }
  function me(req) {
    const tok = parseCookie(req, COOKIE);
    const s = saas.getSession(tok);
    if (!s || s.kind !== 'saas') return null;
    const u = saas.adminById(s.user_id);
    return u && u.aktif ? u : null;
  }
  function requireAdmin(req, res) {
    const u = me(req);
    if (!u) {
      res.redirect(req.BASE + '/super-admin/login?err=' + encodeURIComponent('Silakan masuk sebagai Super Admin Pusat.'));
      return null;
    }
    return u;
  }
  function flash(path, key, msg) {
    const sep = path.includes('?') ? '&' : '?';
    return path + sep + key + '=' + encodeURIComponent(msg);
  }

  /* ---------------- layout ---------------- */
  const MENU = [
    { href: '/super-admin', label: 'Dashboard', icon: 'dashboard' },
    { href: '/super-admin/sekolah', label: 'Daftar Sekolah', icon: 'school' },
    { href: '/super-admin/pembayaran', label: 'Pembayaran', icon: 'card' },
    { href: '/super-admin/qris', label: 'QRIS & Harga', icon: 'tag' },
    { href: '/super-admin/backup', label: 'Backup Email', icon: 'cloud' }
  ];

  function shell(req, { title, sub = '', active = '', content, user }) {
    const base = req.BASE;
    const q = req.query;
    const ok = q.get('ok'), err = q.get('err');
    const stats = saas.stats();
    const nav = MENU.map(m => `<a href="${base}${m.href}" class="sa-nav${active === m.href ? ' on' : ''}">${ui.icon(m.icon)}<span>${esc(m.label)}</span>
      ${m.href === '/super-admin/pembayaran' && stats.menunggu ? `<b class="sa-pill">${stats.menunggu}</b>` : ''}</a>`).join('');
    return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Super Admin</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${base}/assets/app.css?v=${ui.ASSET_V}">
<link rel="icon" href="${base}/favicon.ico">
<style>
.sa-wrap{display:grid;grid-template-columns:248px 1fr;min-height:100vh;gap:0}
.sa-side{background:#141127;color:#EDE9FE;padding:22px 16px;display:flex;flex-direction:column;gap:18px}
.sa-brand{display:flex;align-items:center;gap:11px;font-weight:800;letter-spacing:-.02em;font-size:15px}
.sa-mark{width:38px;height:38px;border-radius:12px;background:linear-gradient(135deg,#6366F1,#8B5CF6);display:grid;place-items:center;color:#fff}
.sa-nav{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:11px;color:#C7C2E8;font-weight:600;font-size:13.5px;text-decoration:none}
.sa-nav:hover{background:rgba(255,255,255,.07);color:#fff}
.sa-nav.on{background:linear-gradient(135deg,#6366F1,#8B5CF6);color:#fff}
.sa-nav svg{width:17px;height:17px;flex:0 0 17px}
.sa-pill{margin-left:auto;background:#F97316;color:#fff;border-radius:999px;padding:1px 7px;font-size:11px}
.sa-main{padding:26px 30px 48px;min-width:0}
.sa-top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:20px}
.sa-top h1{font-size:23px;margin:0;letter-spacing:-.03em}
.sa-top .sub{color:#8A8598;font-size:13px;margin-top:4px}
.sa-user{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.7);border:1px solid var(--line);padding:7px 12px;border-radius:12px;font-size:12.5px}
.sa-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px}
.sa-kpi{padding:18px;border-radius:16px;background:#fff;border:1px solid var(--line)}
.sa-kpi .v{font-size:23px;font-weight:800;letter-spacing:-.03em}
.sa-kpi .l{font-size:11.5px;text-transform:uppercase;letter-spacing:.1em;color:#8A8598;font-weight:700}
@media (max-width:900px){ .sa-wrap{grid-template-columns:1fr} .sa-side{flex-direction:row;flex-wrap:wrap;padding:14px} .sa-nav span{display:none} .sa-main{padding:18px 16px 40px} }
.lb{position:fixed;inset:0;background:rgba(17,12,32,.86);display:none;place-items:center;z-index:99;padding:24px}
.lb.on{display:grid}
.lb img{max-width:min(92vw,720px);max-height:86vh;border-radius:12px;background:#fff}
.lb-x{position:absolute;top:18px;right:22px;color:#fff;font-size:26px;cursor:pointer;line-height:1}
</style></head><body>
<div class="sa-wrap">
  <aside class="sa-side">
    <div class="sa-brand"><div class="sa-mark">${ui.icon('shield')}</div><div>Super Admin<br><span style="font-weight:600;font-size:11px;opacity:.7">${esc(saas.appName())}</span></div></div>
    ${nav}
    <div style="margin-top:auto;font-size:11.5px;opacity:.6;line-height:1.6">
      ${stats.total} sekolah terdaftar<br>${stats.aktif} aktif · ${stats.suspended} ditangguhkan
    </div>
  </aside>
  <main class="sa-main">
    <div class="sa-top">
      <div><h1>${esc(title)}</h1>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>
      <div class="flex" style="gap:10px;align-items:center;flex-wrap:wrap">
        <div class="sa-user">${ui.icon('users')}<div><b>${esc((user || {}).nama || '')}</b><div class="t-sub">Super Admin Pusat</div></div></div>
        <form method="post" action="${base}/super-admin/logout"><button class="btn btn-sm">Keluar</button></form>
      </div>
    </div>
    ${ok ? `<div class="alert ok">${ui.icon('check')}<div>${esc(ok)}</div></div>` : ''}
    ${err ? `<div class="alert err">${ui.icon('alert')}<div>${esc(err)}</div></div>` : ''}
    ${content}
  </main>
</div>
<script src="${base}/assets/app.js?v=${ui.ASSET_V}"></script>
<script>
document.querySelectorAll('[data-proof]').forEach(function(el){
  el.addEventListener('click', function(e){
    e.preventDefault();
    var lb = document.getElementById('lb');
    lb.querySelector('img').src = el.getAttribute('data-proof');
    lb.classList.add('on');
  });
});
document.addEventListener('click', function(e){ if(e.target.id==='lb'||e.target.classList.contains('lb-x')) document.getElementById('lb').classList.remove('on'); });
</script>
<div class="lb" id="lb"><span class="lb-x">&times;</span><img alt="Bukti pembayaran"></div>
</body></html>`;
  }

  /* ---------------- login ---------------- */
  function loginPage(req, res, { err } = {}) {
    const base = req.BASE;
    const appName = saas.appName();
    res.html(`<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Masuk Super Admin · ${esc(appName)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${base}/assets/app.css?v=${ui.ASSET_V}"><link rel="icon" href="${base}/favicon.ico">
</head><body style="display:grid;place-items:center;min-height:100vh;margin:0;padding:24px">
<div class="card" style="width:100%;max-width:420px;padding:30px">
  <div class="flex" style="gap:12px;align-items:center;margin-bottom:18px">
    <div style="width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,#6366F1,#8B5CF6);display:grid;place-items:center;color:#fff">${ui.icon('shield')}</div>
    <div><div style="font-weight:800;letter-spacing:-.02em">Super Admin Pusat</div><div class="small muted">${esc(appName)}</div></div>
  </div>
  ${err ? `<div class="alert err">${ui.icon('alert')}<div>${esc(err)}</div></div>` : ''}
  <form method="post" action="${base}/super-admin/login">
    <div class="field"><label>Email</label><input type="email" name="email" required autocomplete="username" placeholder="super@simkeu.id"></div>
    <div class="field"><label>Password</label><input type="password" name="password" required autocomplete="current-password" placeholder="••••••••"></div>
    <button class="btn btn-primary btn-block">Masuk</button>
  </form>
  <p class="small muted" style="margin-top:16px;text-align:center"><a href="${base}/login">← Portal sekolah</a></p>
</div></body></html>`);
  }

  get('/super-admin/login', (req, res) => {
    if (me(req)) return res.redirect(req.BASE + '/super-admin');
    loginPage(req, res, { err: req.query.get('err') });
  });

  post('/super-admin/login', (req, res) => {
    const email = String(req.body.email || '').trim();
    const pass = String(req.body.password || '');
    const u = saas.findAdmin(email);
    if (!u || !lib.verifyPassword(pass, u.password)) {
      return res.redirect(req.BASE + '/super-admin/login?err=' + encodeURIComponent('Email atau password salah.'));
    }
    if (!u.aktif) return res.redirect(req.BASE + '/super-admin/login?err=' + encodeURIComponent('Akun super admin dinonaktifkan.'));
    const token = saas.createSession({ userId: u.id, kind: 'saas' });
    S.prepare('UPDATE saas_users SET last_login=? WHERE id=?').run(nowStamp(), u.id);
    saas.logSaas(u, 'LOGIN', 'auth', 'Super Admin Pusat masuk');
    res.set('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 14}`);
    res.redirect(req.BASE + '/super-admin');
  });

  post('/super-admin/logout', (req, res) => {
    saas.destroySession(parseCookie(req, COOKIE));
    res.set('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0`);
    res.redirect(req.BASE + '/super-admin/login?ok=' + encodeURIComponent('Anda telah keluar.'));
  });

  /** keluar dari mode "login as tenant" (kembali ke portal super admin) */
  get('/super-admin/kembali', (req, res) => {
    const sid = parseCookie(req, 'simkeu_sid');
    if (sid) saas.destroySession(sid);
    res.set('Set-Cookie', 'simkeu_sid=; Path=/; Max-Age=0');
    res.redirect(req.BASE + '/super-admin');
  });

  /* ---------------- ganti password super admin ---------------- */
  post('/super-admin/password', (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    const lama = String(req.body.password_lama || '');
    const baru = String(req.body.password_baru || '');
    const ulang = String(req.body.password_ulang || '');
    const back = m => res.redirect(req.BASE + flash('/super-admin', 'err', m));
    if (!lib.verifyPassword(lama, u.password)) return back('Password lama tidak sesuai.');
    if (baru.length < 8) return back('Password baru minimal 8 karakter.');
    if (baru !== ulang) return back('Konfirmasi password baru tidak sama.');
    saas.setAdminPassword(u.id, baru);
    saas.logSaas(u, 'GANTI PASSWORD', 'auth', 'Super Admin Pusat mengganti password');
    res.redirect(req.BASE + flash('/super-admin', 'ok', 'Password Super Admin berhasil diganti.'));
  });

  /* ---------------- dashboard ---------------- */
  get('/super-admin', (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    const st = saas.stats();
    const list = saas.allTenants();
    const rows = list.slice(0, 8).map(t => {
      const s = saas.statusOf(t);
      return `<tr>
        <td><a href="${req.BASE}/super-admin/sekolah/${t.id}"><b>${esc(t.nama)}</b></a><div class="t-sub">${esc(t.contact_email || '')}</div></td>
        <td><span class="mono" style="letter-spacing:.12em;font-weight:700">${esc(t.school_code)}</span></td>
        <td>${esc(saas.PAKET[t.paket] || t.paket)}</td>
        <td class="nowrap">${Number(t.is_lifetime_free) ? 'Lifetime' : esc(tglID(t.expires_at || '-'))}</td>
        <td>${ui.badge(s.label, s.color)}</td>
      </tr>`;
    }).join('');
    const menunggu = saas.paymentsAll('pending');
    const content = `
    <div class="sa-grid mb-3">
      ${[['Total Sekolah', st.total], ['Sekolah Aktif', st.aktif], ['Lifetime', st.lifetime], ['Ditangguhkan', st.suspended],
        ['Menunggu Verifikasi', st.menunggu], ['Pendapatan Bulan Ini', rupiah(st.pendapatan)]]
        .map(([l, v]) => `<div class="sa-kpi"><div class="l">${esc(l)}</div><div class="v">${typeof v === 'number' ? v : esc(v)}</div></div>`).join('')}
    </div>
    ${menunggu.length ? `<div class="card mb-3" style="border-color:#F7DFB5;background:#FFFDF7">
      <div class="card-head"><div><h3>${ui.icon('clock', 'i-sm')} ${menunggu.length} pengajuan pembayaran menunggu</h3>
        <div class="sub">Verifikasi bukti transfer lalu setujui untuk memperpanjang masa aktif</div></div>
        <a class="btn btn-sm btn-primary" href="${req.BASE}/super-admin/pembayaran">Buka Persetujuan</a></div>
    </div>` : ''}
    <div class="card mb-3">
      <div class="card-head"><div><h3>Keamanan Akun Super Admin</h3>
        <div class="sub">Ganti sandi bawaan segera setelah pemasangan</div></div></div>
      <form method="post" action="${req.BASE}/super-admin/password">
        <div class="row3">
          <div class="field"><label>Password Lama</label><input type="password" name="password_lama" required autocomplete="current-password"></div>
          <div class="field"><label>Password Baru (min. 8 karakter)</label><input type="password" name="password_baru" required minlength="8" autocomplete="new-password"></div>
          <div class="field"><label>Ulangi Password Baru</label><input type="password" name="password_ulang" required minlength="8" autocomplete="new-password"></div>
        </div>
        <div class="form-actions"><button class="btn">${ui.icon('lock')}Ganti Password</button></div>
      </form>
    </div>
    <div class="card">
      <div class="card-head"><div><h3>Sekolah Terdaftar</h3><div class="sub">8 sekolah terbaru · kelola di menu Daftar Sekolah</div></div>
        <a class="btn btn-sm btn-primary" href="${req.BASE}/super-admin/sekolah">${ui.icon('plus')}Tambah Sekolah</a></div>
      <div class="table-wrap"><table><thead><tr><th>Nama Sekolah</th><th>Kode</th><th>Paket</th><th>Masa Aktif</th><th>Status</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5" class="muted" style="text-align:center;padding:18px">Belum ada sekolah.</td></tr>`}</tbody></table></div>
    </div>`;
    res.html(shell(req, { title: 'Dashboard SaaS', sub: 'Ringkasan seluruh sekolah yang memakai layanan', active: '/super-admin', content, user: u }));
  });

  /* ---------------- daftar sekolah ---------------- */
  get('/super-admin/sekolah', (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    const list = saas.allTenants();
    const rows = list.map(t => {
      const s = saas.statusOf(t);
      const on = saas.enabledKeys(t).length;
      return `<tr>
        <td><a href="${req.BASE}/super-admin/sekolah/${t.id}"><b>${esc(t.nama)}</b></a>
          <div class="t-sub">${esc(t.contact_email || '')}${t.contact_telp ? ' · ' + esc(t.contact_telp) : ''}</div></td>
        <td class="mono">#${t.id}</td>
        <td class="mono" style="font-weight:700;letter-spacing:.12em">${esc(t.school_code)}</td>
        <td><span class="badge ${t.paket === 'pro' ? 'violet' : 'blue'} plain">${esc(saas.PAKET[t.paket] || t.paket)}</span></td>
        <td class="nowrap">${Number(t.is_lifetime_free) ? '<b>Lifetime</b>' : esc(tglID(t.expires_at || '-'))}</td>
        <td>${ui.badge(s.label, s.color)}</td>
        <td class="num">${on}/${saas.FEATURES.length}</td>
        <td class="nowrap">
          <form method="post" action="${req.BASE}/super-admin/sekolah/${t.id}/masuk" style="display:inline">
            <button class="btn btn-sm" title="Masuk sebagai sekolah ini">${ui.icon('login')}Masuk</button></form>
        </td>
      </tr>`;
    }).join('');
    const formFields = `
        <div class="row3">
          <div class="field"><label>Nama Sekolah *</label><input type="text" name="nama" required placeholder="SMK Negeri 1 Contoh"></div>
          <div class="field"><label>Kode Sekolah (4 karakter)</label><input type="text" name="school_code" maxlength="4" placeholder="otomatis (SK02)" style="text-transform:uppercase"></div>
          <div class="field"><label>Paket</label><select name="paket"><option value="standard">Standard</option><option value="pro">Pro (semua fitur)</option></select></div>
        </div>
        <div class="row3">
          <div class="field"><label>Nama Admin Sekolah *</label><input type="text" name="admin_nama" required placeholder="Bendahara / Admin"></div>
          <div class="field"><label>Email Admin (login) *</label><input type="email" name="admin_email" required placeholder="admin@sekolah.sch.id"></div>
          <div class="field"><label>Password Admin *</label><input type="text" name="admin_password" required minlength="6" placeholder="minimal 6 karakter"></div>
        </div>
        <div class="row3">
          <div class="field"><label>Telepon / WhatsApp</label><input type="text" name="telp" placeholder="08xx"></div>
          <div class="field"><label>Masa Aktif (hari)</label><input type="number" name="days" value="${saas.trialDays() || 30}" min="1" max="3650"></div>
          <div class="field"><label>Opsi</label>
            <label class="check" style="margin-top:6px"><input type="checkbox" name="is_lifetime_free" value="1"> Akses Lifetime (gratis)</label></div>
        </div>
        <div class="field"><label>Alamat</label><input type="text" name="alamat" placeholder="Jl. Pendidikan No. 1"></div>`;
    const addModal = ui.modal('mTambahSekolah', {
      title: 'Tambah Sekolah Manual',
      body: `<form method="post" action="${req.BASE}/super-admin/sekolah/tambah" id="fSekolahBaru">${formFields}
        <div class="form-actions"><button class="btn btn-primary">${ui.icon('plus')}Simpan Sekolah</button></div></form>`,
      wide: true
    });
    const content = `
    <div class="card">
      <div class="card-head"><div><h3>Daftar Sekolah (${list.length})</h3><div class="sub">Nama, tenant_id, kode, paket, masa aktif & status</div></div>
        ${ui.openModalBtn('mTambahSekolah', 'Tambah Sekolah')}</div>
      <div class="table-wrap"><table><thead><tr><th>Sekolah</th><th>tenant_id</th><th>Kode</th><th>Paket</th><th>Masa Aktif</th><th>Status</th><th class="num">Fitur</th><th>Aksi</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="8" class="muted" style="text-align:center;padding:18px">Belum ada sekolah.</td></tr>`}</tbody></table></div>
      ${addModal}
      <p class="help mt-1">Data setiap sekolah tersimpan di database terpisah (<code>data/tenants/tenant-&lt;id&gt;.sqlite</code>), sehingga tidak mungkin saling terlihat.</p>
    </div>`;
    res.html(shell(req, { title: 'Daftar Sekolah', sub: 'Tenant, kode akses, paket & status langganan', active: '/super-admin/sekolah', content, user: u }));
  });

  post('/super-admin/sekolah/tambah', (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const t = saas.createTenant({
        nama: req.body.nama, school_code: req.body.school_code,
        paket: req.body.paket, admin_nama: req.body.admin_nama,
        admin_email: req.body.admin_email, admin_password: req.body.admin_password,
        contact_nama: req.body.admin_nama, contact_telp: req.body.telp, alamat: req.body.alamat,
        days: Number(req.body.days) || 30, is_lifetime_free: req.body.is_lifetime_free ? 1 : 0,
        trial: false, user: u
      });
      res.redirect(req.BASE + flash('/super-admin/sekolah/' + t.id, 'ok',
        `Sekolah dibuat. Kode Sekolah: ${t.school_code} — berikan kode ini ke admin sekolah untuk login.`));
    } catch (e) {
      res.redirect(req.BASE + flash('/super-admin/sekolah', 'err', e.message));
    }
  });

  /* ---------------- detail sekolah ---------------- */
  get('/super-admin/sekolah/:id', (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    const t = saas.tenantById(req.params.id);
    if (!t) return res.redirect(req.BASE + flash('/super-admin/sekolah', 'err', 'Sekolah tidak ditemukan.'));
    const st = saas.statusOf(t);
    const on = saas.tenantFeatures(t);
    const featureBox = (std) => saas.FEATURES.filter(f => f.std === std).map(f => `
      <label class="check" style="display:flex;align-items:center;gap:8px;padding:7px 0">
        <input type="checkbox" name="fitur" value="${f.key}" ${on[f.key] ? 'checked' : ''}>
        <span>${esc(f.label)}</span></label>`).join('');
    const riwayat = saas.paymentsOf(t.id, 20);
    const content = `
    <div class="split">
      <div>
        <div class="card mb-3">
          <div class="card-head"><div><h3>Data Sekolah</h3><div class="sub">tenant_id ${t.id} · terdaftar ${esc(tglID(t.registered_at || '-'))}</div></div>
            ${ui.badge(st.label, st.color)}</div>
          <form method="post" action="${req.BASE}/super-admin/sekolah/${t.id}/simpan">
            <div class="row3">
              <div class="field"><label>Nama Sekolah</label><input type="text" name="nama" value="${esc(t.nama)}" required></div>
              <div class="field"><label>Kode Sekolah</label><input type="text" name="school_code" value="${esc(t.school_code)}" maxlength="4" style="text-transform:uppercase" required></div>
              <div class="field"><label>Paket</label><select name="paket">
                <option value="standard" ${t.paket === 'standard' ? 'selected' : ''}>Standard</option>
                <option value="pro" ${t.paket === 'pro' ? 'selected' : ''}>Pro</option></select></div>
            </div>
            <div class="row3">
              <div class="field"><label>Status</label><select name="status">
                <option value="active" ${t.status === 'active' ? 'selected' : ''}>Aktif</option>
                <option value="suspended" ${t.status === 'suspended' ? 'selected' : ''}>Ditangguhkan</option></select></div>
              <div class="field"><label>Masa Aktif s.d.</label><input type="date" name="expires_at" value="${esc(String(t.expires_at || '').slice(0, 10))}"></div>
              <div class="field"><label>Telepon</label><input type="text" name="contact_telp" value="${esc(t.contact_telp || '')}"></div>
            </div>
            <div class="row2">
              <div class="field"><label>Email Admin</label><input type="email" name="contact_email" value="${esc(t.contact_email || '')}"></div>
              <div class="field"><label>Nama Kontak</label><input type="text" name="contact_nama" value="${esc(t.contact_nama || '')}"></div>
            </div>
            <div class="field"><label>Alamat</label><input type="text" name="alamat" value="${esc(t.alamat || '')}"></div>
            <div class="form-actions"><button class="btn btn-primary">${ui.icon('save')}Simpan Perubahan</button></div>
          </form>
        </div>
        <div class="card mb-3">
          <div class="card-head"><div><h3>Kontrol Fitur (Feature Flagging)</h3>
            <div class="sub">Centang = tersedia. Fitur yang tidak dicentang disembunyikan dari menu &amp; diblokir lewat URL langsung.</div></div></div>
          <form method="post" action="${req.BASE}/super-admin/sekolah/${t.id}/fitur">
            <div class="row2">
              <div><div class="t-sub" style="font-weight:700;text-transform:uppercase;letter-spacing:.1em;font-size:11px;margin-bottom:6px">Paket Standard</div>${featureBox(1)}</div>
              <div><div class="t-sub" style="font-weight:700;text-transform:uppercase;letter-spacing:.1em;font-size:11px;margin-bottom:6px">Fitur Pro</div>${featureBox(0)}</div>
            </div>
            <div class="form-actions"><button class="btn btn-primary">${ui.icon('check')}Simpan Fitur</button></div>
          </form>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Riwayat Pembayaran</h3><div class="sub">20 transaksi terakhir</div></div></div>
          <div class="table-wrap short"><table><thead><tr><th>Tanggal</th><th>Jenis</th><th>Durasi</th><th class="num">Nominal</th><th>Status</th><th>Catatan</th></tr></thead><tbody>
          ${riwayat.length ? riwayat.map(p => `<tr>
            <td class="nowrap">${esc(tglID(p.dibuat_at || p.created_at))}</td>
            <td>${p.jenis === 'tagihan' ? 'Tagihan' : 'Perpanjangan'}</td>
            <td>${p.durasi >= 365 ? '12 bln' : '1 bln'}</td>
            <td class="num">${rupiah(p.nominal)}</td>
            <td>${ui.badge((saas.PAY_STATUS[p.status] || {}).label || p.status, (saas.PAY_STATUS[p.status] || {}).color || 'gray')}</td>
            <td class="small">${esc(p.alasan || p.catatan || '-')}</td></tr>`).join('')
        : `<tr><td colspan="6" class="muted" style="text-align:center;padding:16px">Belum ada transaksi.</td></tr>`}
          </tbody></table></div>
        </div>
      </div>
      <div>
        <div class="card mb-3">
          <div class="card-head"><div><h3>Akses Lifetime</h3><div class="sub">Manual override</div></div></div>
          <div class="alert ${Number(t.is_lifetime_free) ? 'ok' : 'info'}">${ui.icon(Number(t.is_lifetime_free) ? 'check' : 'info')}
            <div>${Number(t.is_lifetime_free)
        ? '<b>Status: Aktif (Lifetime).</b> Sekolah kebal auto-suspend, tidak ditagih, dan tombol perpanjang disembunyikan.'
        : 'Sekolah berlangganan normal: tagihan H-7 diterbitkan otomatis dan akun ditangguhkan bila melewati masa aktif.'}</div></div>
          <form method="post" action="${req.BASE}/super-admin/sekolah/${t.id}/lifetime">
            <input type="hidden" name="on" value="${Number(t.is_lifetime_free) ? '0' : '1'}">
            <button class="btn ${Number(t.is_lifetime_free) ? '' : 'btn-primary'} btn-block">
              ${Number(t.is_lifetime_free) ? 'Matikan Lifetime (kembali berlangganan)' : 'Set Lifetime (akses gratis selamanya)'}</button>
          </form>
        </div>
        <div class="card mb-3">
          <div class="card-head"><div><h3>Bantuan Teknis</h3><div class="sub">Masuk sebagai sekolah ini</div></div></div>
          <p class="small muted">Gunakan untuk mendampingi admin sekolah. Tindakan Anda tercatat pada audit log sekolah.</p>
          <form method="post" action="${req.BASE}/super-admin/sekolah/${t.id}/masuk">
            <button class="btn btn-block">${ui.icon('login')}Login As Tenant</button></form>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Ringkasan</h3></div></div>
          <div class="list">
            <div class="list-row"><div><div class="mt">Kode Sekolah</div><div class="nm mono" style="letter-spacing:.16em">${esc(t.school_code)}</div></div></div>
            <div class="list-row"><div><div class="mt">Paket</div><div class="nm">${esc(saas.PAKET[t.paket] || t.paket)}</div></div></div>
            <div class="list-row"><div><div class="mt">Masa aktif</div><div class="nm">${Number(t.is_lifetime_free) ? 'Lifetime' : esc(tglID(t.expires_at || '-'))}</div></div></div>
            <div class="list-row"><div><div class="mt">Fitur aktif</div><div class="nm">${saas.enabledKeys(t).length} / ${saas.FEATURES.length}</div></div></div>
            <div class="list-row"><div><div class="mt">Database</div><div class="nm mono small">${esc(t.db_file || '-')}</div></div></div>
          </div>
          ${Number(t.id) === 1 ? `<div class="alert info mt-2">${ui.icon('lock')}<div>Sekolah pertama (data produksi) tidak dapat dihapus.</div></div>`
        : `<form method="post" action="${req.BASE}/super-admin/sekolah/${t.id}/hapus" data-confirm="Hapus sekolah ${esc(t.nama)}? Database sekolah akan dilepas dari daftar (cadangan .dihapus tetap disimpan).">
              <button class="btn btn-danger btn-block">${ui.icon('trash')}Hapus Sekolah</button></form>`}
        </div>
      </div>
    </div>`;
    res.html(shell(req, { title: t.nama, sub: 'Kode ' + t.school_code + ' · tenant_id ' + t.id, active: '/super-admin/sekolah', content, user: u }));
  });

  post('/super-admin/sekolah/:id/simpan', (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    const t = saas.tenantById(req.params.id);
    if (!t) return res.redirect(req.BASE + flash('/super-admin/sekolah', 'err', 'Sekolah tidak ditemukan.'));
    try {
      const b = req.body;
      const patch = {
        nama: b.nama, school_code: b.school_code, paket: b.paket, status: b.status,
        expires_at: b.expires_at || null,
        is_lifetime_free: t.is_lifetime_free,
        contact_nama: b.contact_nama, contact_email: b.contact_email, contact_telp: b.contact_telp, alamat: b.alamat,
        features: t.features, user: u
      };
      saas.updateTenant(t.id, patch);
      res.redirect(req.BASE + flash('/super-admin/sekolah/' + t.id, 'ok', 'Data sekolah diperbarui.'));
    } catch (e) {
      res.redirect(req.BASE + flash('/super-admin/sekolah/' + t.id, 'err', e.message));
    }
  });

  post('/super-admin/sekolah/:id/fitur', (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const picked = [].concat(req.body.fitur || []);
      const map = {};
      for (const f of saas.FEATURES) map[f.key] = picked.includes(f.key) ? 1 : 0;
      saas.setFeatures(req.params.id, map, u);
      res.redirect(req.BASE + flash('/super-admin/sekolah/' + req.params.id, 'ok', 'Kontrol fitur disimpan. Menu & URL sekolah langsung menyesuaikan.'));
    } catch (e) {
      res.redirect(req.BASE + flash('/super-admin/sekolah/' + req.params.id, 'err', e.message));
    }
  });

  post('/super-admin/sekolah/:id/lifetime', (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const t = saas.setLifetime(req.params.id, req.body.on === '1', u);
      res.redirect(req.BASE + flash('/super-admin/sekolah/' + t.id, 'ok',
        Number(t.is_lifetime_free) ? 'Status LIFETIME aktif — sekolah bebas tagihan & auto-suspend.' : 'Status lifetime dimatikan.'));
    } catch (e) {
      res.redirect(req.BASE + flash('/super-admin/sekolah/' + req.params.id, 'err', e.message));
    }
  });

  post('/super-admin/sekolah/:id/hapus', (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      saas.deleteTenant(req.params.id, u);
      res.redirect(req.BASE + flash('/super-admin/sekolah', 'ok', 'Sekolah dihapus dari daftar.'));
    } catch (e) {
      res.redirect(req.BASE + flash('/super-admin/sekolah/' + req.params.id, 'err', e.message));
    }
  });

  /* ---------------- login as tenant ---------------- */
  post('/super-admin/sekolah/:id/masuk', (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    const t = saas.tenantById(req.params.id);
    if (!t) return res.redirect(req.BASE + flash('/super-admin/sekolah', 'err', 'Sekolah tidak ditemukan.'));
    try {
      const conn = dbm.openTenantConn(t.id, t.db_file);
      const target = conn.prepare("SELECT id,nama FROM users WHERE role='super_admin' AND aktif=1 ORDER BY id LIMIT 1").get();
      if (!target) throw new Error('Sekolah ini belum punya akun admin aktif.');
      const token = saas.createSession({ userId: target.id, tenantId: t.id, kind: 'tenant' });
      S.prepare('UPDATE sessions SET imp_by=? WHERE token=?').run(u.id, token);
      saas.logSaas(u, 'LOGIN AS TENANT', 'tenant', `Masuk sebagai ${t.nama} untuk bantuan teknis`, t.id);
      res.set('Set-Cookie', `simkeu_sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 8}`);
      res.redirect(req.BASE + '/');
    } catch (e) {
      res.redirect(req.BASE + flash('/super-admin/sekolah/' + t.id, 'err', e.message));
    }
  });

  /* ---------------- pembayaran ---------------- */
  get('/super-admin/pembayaran', (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    const filter = String(req.query.get('status') || 'pending');
    const rows = (filter === 'all' ? saas.paymentsAll() : saas.paymentsAll(filter)).map(p => `<tr>
      <td><b>${esc(p.sekolah_nama)}</b><div class="t-sub">${esc(p.no_invoice || '-')} · ${esc(tglID(p.dibuat_at || p.created_at))}</div></td>
      <td class="mono" style="font-weight:700">${esc(p.school_code)}</td>
      <td>${p.durasi >= 365 ? '12 Bulan' : '1 Bulan'}</td>
      <td class="num">${rupiah(p.nominal)}</td>
      <td>${p.bukti_url
        ? `<button type="button" class="btn btn-sm" data-proof="${esc(p.bukti_url)}">${ui.icon('search')}Lihat Bukti</button>`
        : '<span class="muted small">tanpa bukti</span>'}</td>
      <td>${ui.badge((saas.PAY_STATUS[p.status] || {}).label || p.status, (saas.PAY_STATUS[p.status] || {}).color || 'gray')}
        ${p.alasan ? `<div class="t-sub">${esc(p.alasan)}</div>` : ''}</td>
      <td class="nowrap">
        ${p.status === 'pending' ? `
        <form method="post" action="${req.BASE}/super-admin/pembayaran/${p.id}/approve" style="display:inline"
          data-confirm="Setujui pembayaran ${esc(p.sekolah_nama)} (${p.durasi >= 365 ? '365' : '30'} hari)? Masa aktif otomatis ditambah dan akun dibuka kembali.">
          <button class="btn btn-sm btn-primary">${ui.icon('check')}Setujui</button></form>
        <form method="post" action="${req.BASE}/super-admin/pembayaran/${p.id}/reject" style="display:inline"
          data-confirm="Tolak pengajuan ini? Isi alasan pada kolom di samping.">
          <input type="hidden" name="alasan" value="Bukti pembayaran tidak valid / dana belum masuk">
          <button class="btn btn-sm btn-danger">${ui.icon('x')}Tolak</button></form>`
        : `<span class="t-sub">${esc(p.direview_oleh || '')}</span>`}
      </td>
    </tr>`).join('');
    const content = `
    <div class="card mb-3">
      <div class="card-head"><div><h3>Persetujuan Pembayaran</h3><div class="sub">Verifikasi bukti transfer perpanjangan (QRIS / DANA Bisnis)</div></div>
        <div class="flex" style="gap:6px">
          ${['pending', 'approved', 'rejected', 'all'].map(s => `<a class="btn btn-sm ${filter === s ? 'btn-primary' : ''}" href="${req.BASE}/super-admin/pembayaran?status=${s}">${s === 'all' ? 'Semua' : (saas.PAY_STATUS[s] || {}).label}</a>`).join('')}
        </div></div>
      <div class="table-wrap"><table><thead><tr><th>Sekolah</th><th>Kode</th><th>Durasi</th><th class="num">Nominal</th><th>Bukti Transfer</th><th>Status</th><th>Aksi</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="7" class="muted" style="text-align:center;padding:20px">Tidak ada pengajuan pada filter ini.</td></tr>`}</tbody></table></div>
    </div>
    <div class="card">
      <div class="card-head"><div><h3>Penagihan &amp; Pembekuan Otomatis</h3><div class="sub">Cron harian: tagihan H-7 &amp; suspend otomatis</div></div></div>
      <p class="small muted">Cron berjalan otomatis setiap hari. Tombol di bawah menjalankan pemeriksaan sekarang (idempoten — tidak membuat tagihan ganda).</p>
      <form method="post" action="${req.BASE}/super-admin/jalan-tagihan"><button class="btn">${ui.icon('refresh')}Jalankan Pemeriksaan Tagihan Sekarang</button></form>
    </div>`;
    res.html(shell(req, { title: 'Pembayaran & Penagihan', sub: 'Verifikasi pembayaran perpanjangan', active: '/super-admin/pembayaran', content, user: u }));
  });

  post('/super-admin/pembayaran/:id/approve', (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const r = saas.approvePayment(req.params.id, u);
      res.redirect(req.BASE + flash('/super-admin/pembayaran', 'ok',
        `Pembayaran disetujui. ${r.tenant.nama} aktif sampai ${r.end} dan pemblokiran dibuka.`));
    } catch (e) {
      res.redirect(req.BASE + flash('/super-admin/pembayaran', 'err', e.message));
    }
  });

  post('/super-admin/pembayaran/:id/reject', (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      saas.rejectPayment(req.params.id, req.body.alasan, u);
      res.redirect(req.BASE + flash('/super-admin/pembayaran', 'ok', 'Pengajuan ditolak. Alasan tampil di menu Info Layanan sekolah.'));
    } catch (e) {
      res.redirect(req.BASE + flash('/super-admin/pembayaran', 'err', e.message));
    }
  });

  post('/super-admin/jalan-tagihan', (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const r = saas.runDailyJobs();
      res.redirect(req.BASE + flash('/super-admin/pembayaran', 'ok', `Pemeriksaan selesai: ${r.invoices} tagihan baru, ${r.suspended} sekolah ditangguhkan.`));
    } catch (e) {
      res.redirect(req.BASE + flash('/super-admin/pembayaran', 'err', e.message));
    }
  });

  /* ---------------- QRIS & harga ---------------- */
  get('/super-admin/qris', (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    const img = saas.get('qris_image', '');
    const content = `
    <div class="split">
      <div class="card">
        <div class="card-head"><div><h3>QRIS / DANA Bisnis</h3><div class="sub">Tampil otomatis di halaman checkout seluruh sekolah</div></div></div>
        <form method="post" action="${req.BASE}/super-admin/qris">
          <div class="field"><label>Gambar Barcode QRIS (.png / .jpg / .jpeg, maks 5 MB)</label>
            <input type="file" accept="image/png,image/jpeg" data-b64="qris_b64" data-max="5">
            <input type="hidden" name="qris_b64" id="qris_b64">
            <div class="hint" id="qris_b64-info">Kosongkan bila tidak ingin mengganti gambar yang sudah ada.</div></div>
          <div class="row2">
            <div class="field"><label>Nama Pemilik Rekening / QRIS</label><input type="text" name="qris_nama" value="${esc(saas.get('qris_nama', ''))}" placeholder="Yayasan Pendidikan Contoh"></div>
            <div class="field"><label>Nomor Rekening / DANA</label><input type="text" name="qris_nomor" value="${esc(saas.get('qris_nomor', ''))}" placeholder="0812xxxx / 1234567890"></div>
          </div>
          <div class="field"><label>Instruksi Pembayaran</label>
            <textarea name="qris_instruksi" rows="3" placeholder="Contoh: scan QRIS, lalu unggah bukti transfer...">${esc(saas.get('qris_instruksi', ''))}</textarea></div>
          <hr class="sep">
          <div class="row2">
            <div class="field"><label>Harga 1 Bulan (Rp)</label><input type="text" name="harga_bulan" data-money value="${esc(saas.get('harga_bulan', '150000'))}"></div>
            <div class="field"><label>Harga 12 Bulan (Rp)</label><input type="text" name="harga_tahun" data-money value="${esc(saas.get('harga_tahun', '1500000'))}"></div>
          </div>
          <div class="row2">
            <div class="field"><label>Masa Uji Coba Sekolah Baru (hari)</label><input type="number" name="trial_hari" value="${esc(saas.get('trial_hari', '30'))}" min="0" max="365"></div>
            <div class="field"><label>Nama Layanan (judul halaman login)</label><input type="text" name="saas_nama" value="${esc(saas.appName())}"></div>
          </div>
          <div class="form-actions"><button class="btn btn-primary">${ui.icon('save')}Simpan Pengaturan</button></div>
        </form>
      </div>
      <div>
        <div class="card mb-3">
          <div class="card-head"><div><h3>Pratinjau QRIS</h3><div class="sub">Yang dilihat sekolah saat checkout</div></div></div>
          ${img ? `<div style="text-align:center;background:#fff;border:1px solid var(--line);border-radius:14px;padding:12px">
              <img src="${esc(img)}" alt="QRIS" style="max-width:100%;max-height:300px;object-fit:contain"></div>`
        : `<div class="alert warn">${ui.icon('alert')}<div>Belum ada gambar QRIS. Halaman checkout sekolah akan menampilkan instruksi manual.</div></div>`}
          <div class="list mt-2">
            <div class="list-row"><div><div class="mt">Nama Pemilik</div><div class="nm">${esc(saas.get('qris_nama', '-'))}</div></div></div>
            <div class="list-row"><div><div class="mt">Nomor</div><div class="nm mono">${esc(saas.get('qris_nomor', '-'))}</div></div></div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Ringkasan Harga</h3></div></div>
          <div class="list">
            <div class="list-row"><div><div class="mt">1 Bulan (+30 hari)</div><div class="nm">${rupiah(saas.priceOf(30))}</div></div></div>
            <div class="list-row"><div><div class="mt">12 Bulan (+365 hari)</div><div class="nm">${rupiah(saas.priceOf(365))}</div></div></div>
            <div class="list-row"><div><div class="mt">Uji coba sekolah baru</div><div class="nm">${saas.trialDays()} hari</div></div></div>
          </div>
        </div>
      </div>
    </div>`;
    res.html(shell(req, { title: 'QRIS & Harga Layanan', sub: 'Metode pembayaran perpanjangan SaaS', active: '/super-admin/qris', content, user: u }));
  });

  post('/super-admin/qris', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    const b = req.body || {};
    try {
      const hb = lib.parseMoney ? lib.parseMoney(b.harga_bulan) : Number(b.harga_bulan);
      const ht = lib.parseMoney ? lib.parseMoney(b.harga_tahun) : Number(b.harga_tahun);
      if (Number(hb) < 0 || Number(ht) < 0) throw new Error('Harga tidak boleh negatif.');
      let img = String(saas.get('qris_image', ''));
      const b64 = String(b.qris_b64 || '');
      if (b64) {
        const m = b64.match(/^data:(image\/(png|jpe?g));base64,/i);
        if (!m) throw new Error('Gambar QRIS harus berformat PNG atau JPG.');
        const ext = m[2].toLowerCase().replace('jpeg', 'jpg');
        img = await uploadMedia(b64, `qris-${Date.now()}.${ext}`);
      }
      saas.set('qris_image', img);
      saas.set('qris_nama', String(b.qris_nama || ''));
      saas.set('qris_nomor', String(b.qris_nomor || ''));
      saas.set('qris_instruksi', String(b.qris_instruksi || ''));
      saas.set('harga_bulan', String(Math.round(Number(hb) || 0)));
      saas.set('harga_tahun', String(Math.round(Number(ht) || 0)));
      saas.set('trial_hari', String(Math.max(0, Number(b.trial_hari) || 0)));
      if (b.saas_nama) saas.set('saas_nama', String(b.saas_nama).trim());
      saas.logSaas(u, 'EDIT QRIS', 'saas', 'Memperbarui QRIS, instruksi & harga layanan');
      res.redirect(req.BASE + flash('/super-admin/qris', 'ok', 'Pengaturan QRIS & harga disimpan.'));
    } catch (e) {
      res.redirect(req.BASE + flash('/super-admin/qris', 'err', e.message));
    }
  });

  /* ---------------- backup via email (Super Admin) ---------------- */
  get('/super-admin/backup', (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    const cfg = mailer.saasMailConfig(saas);
    const log = S.prepare('SELECT * FROM saas_backup_log ORDER BY id DESC LIMIT 10').all();
    const content = `
    <div class="split">
      <div class="card">
        <div class="card-head"><div><h3>Auto-Backup Database via Email</h3>
          <div class="sub">Backup SELURUH SaaS (control plane + semua sekolah) 2× sehari</div></div>
          ${cfg.aktif ? ui.badge('Aktif', 'green') : ui.badge('Nonaktif', 'gray')}</div>
        <div class="alert info">${ui.icon('info')}<div>Jadwal otomatis <b>06:00</b> &amp; <b>15:00</b>. Nama berkas <code>Backup_SIMKEU_DDMMYYYY_HHMM.zip</code>.
          Berkas .zip langsung dihapus dari server setelah email terkirim (auto-cleanup) agar penyimpanan tidak penuh.</div></div>
        <form method="post" action="${req.BASE}/super-admin/backup/simpan">
          <div class="row2">
            <div class="field"><label>Email Penerima Backup</label><input type="email" name="mail_to" value="${esc(cfg.to)}" placeholder="owner@domain.com" required></div>
            <div class="field"><label>Email Pengirim</label><input type="email" name="mail_from" value="${esc(cfg.from)}" placeholder="backup@domain.com"></div>
          </div>
          <div class="row3">
            <div class="field"><label>SMTP Host</label><input type="text" name="mail_host" value="${esc(cfg.host)}" placeholder="smtp.gmail.com"></div>
            <div class="field"><label>SMTP Port</label><input type="text" name="mail_port" value="${esc(cfg.port)}" placeholder="587"></div>
            <div class="field"><label>Enkripsi</label><select name="mail_secure">
              <option value="0" ${cfg.secure === '0' ? 'selected' : ''}>STARTTLS (587)</option>
              <option value="1" ${cfg.secure === '1' ? 'selected' : ''}>SSL/TLS (465)</option></select></div>
          </div>
          <div class="row2">
            <div class="field"><label>Email Pengirim (akun SMTP)</label><input type="text" name="mail_user" value="${esc(cfg.user)}" placeholder="backup@gmail.com"></div>
            <div class="field"><label>App Password</label><input type="password" name="mail_pass" value="${esc(cfg.pass)}" autocomplete="new-password" placeholder="app password"></div>
          </div>
          <label class="check mb-2"><input type="checkbox" name="mail_aktif" value="1" ${cfg.aktif ? 'checked' : ''}> Aktifkan pengiriman otomatis 06:00 &amp; 15:00</label>
          <div class="form-actions"><button class="btn btn-primary">${ui.icon('save')}Simpan Pengaturan</button></div>
        </form>
        <div class="flex mt-2" style="gap:10px;flex-wrap:wrap">
          <form method="post" action="${req.BASE}/super-admin/backup/uji"><button class="btn">${ui.icon('check')}Uji Kirim Email</button></form>
          <form method="post" action="${req.BASE}/super-admin/backup/kirim"><button class="btn btn-primary">${ui.icon('upload')}Backup &amp; Kirim Sekarang</button></form>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Riwayat Pengiriman</h3><div class="sub">10 terakhir</div></div></div>
        <div class="table-wrap short"><table><thead><tr><th>Waktu</th><th>Berkas</th><th class="num">Ukuran</th><th>Status</th><th>Pesan</th></tr></thead><tbody>
          ${log.length ? log.map(r => `<tr>
            <td class="nowrap small">${esc(r.created_at || '')}</td>
            <td class="mono small">${esc(r.nama_berkas || '-')}</td>
            <td class="num">${r.ukuran ? Math.round(r.ukuran / 1024) + ' KB' : '-'}</td>
            <td>${r.status === 'sukses' ? ui.badge('Sukses', 'green') : ui.badge('Gagal', 'red')}</td>
            <td class="small">${esc((r.pesan || '').slice(0, 90))}</td></tr>`).join('')
        : `<tr><td colspan="5" class="muted" style="text-align:center;padding:16px">Belum ada riwayat.</td></tr>`}
        </tbody></table></div>
        <div class="alert info mt-2">${ui.icon('info')}<div>Setiap sekolah juga dapat mengatur backup emailnya sendiri di menu <b>Info Layanan</b>.</div></div>
      </div>
    </div>`;
    res.html(shell(req, { title: 'Backup Email', sub: 'Auto-backup database via SMTP', active: '/super-admin/backup', content, user: u }));
  });

  post('/super-admin/backup/simpan', (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    const b = req.body || {};
    try {
      const aktif = b.mail_aktif ? '1' : '0';
      const host = String(b.mail_host || '').trim();
      const port = Number(b.mail_port) || 587;
      if (aktif === '1') {
        const chk = mailer.validateConfig({ host, port, from: b.mail_from || b.mail_user, user: b.mail_user });
        if (chk) throw new Error(chk);
        if (!String(b.mail_to || '').trim()) throw new Error('Email penerima backup wajib diisi.');
      }
      saas.set('mail_to', b.mail_to || '');
      saas.set('mail_host', host);
      saas.set('mail_port', String(port));
      saas.set('mail_secure', b.mail_secure === '1' ? '1' : '0');
      saas.set('mail_from', b.mail_from || b.mail_user || '');
      saas.set('mail_user', b.mail_user || '');
      saas.set('mail_pass', b.mail_pass || '');
      saas.set('mail_aktif', aktif);
      saas.logSaas(u, 'EDIT BACKUP EMAIL', 'saas', 'Memperbarui pengaturan SMTP backup');
      res.redirect(req.BASE + flash('/super-admin/backup', 'ok', 'Pengaturan backup email disimpan.'));
    } catch (e) {
      res.redirect(req.BASE + flash('/super-admin/backup', 'err', e.message));
    }
  });

  post('/super-admin/backup/uji', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    const cfg = mailer.saasMailConfig(saas);
    try {
      await mailer.send(
        { host: cfg.host, port: cfg.port, secure: cfg.secure, user: cfg.user, pass: cfg.pass, from: cfg.from },
        { to: cfg.to, subject: 'Uji Kirim Email — Backup SaaS SIMKEU', text: 'Uji pengiriman email dari panel Super Admin.\nWaktu: ' + nowStamp() }
      );
      res.redirect(req.BASE + flash('/super-admin/backup', 'ok', 'Email uji terkirim ke ' + cfg.to + '.'));
    } catch (e) {
      res.redirect(req.BASE + flash('/super-admin/backup', 'err', 'Gagal kirim: ' + e.message));
    }
  });

  post('/super-admin/backup/kirim', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const r = await mailer.sendSaasBackup(dbm, saas, { trigger: 'manual', user: u.nama });
      res.redirect(req.BASE + flash('/super-admin/backup', 'ok',
        `Backup ${r.nama} (${r.tenants} sekolah, ${Math.round(r.ukuran / 1024)} KB) terkirim ke ${r.to}.`));
    } catch (e) {
      res.redirect(req.BASE + flash('/super-admin/backup', 'err', 'Backup gagal: ' + e.message));
    }
  });
};
