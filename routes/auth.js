'use strict';

module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can, setSession, COOKIE, roleLabel, permissionMatrix, renderError, uploadMedia, saas }) => {
  const { db } = dbm;

  function authShell({ base, content, sideTitle, sideDesc }) {
    // branding halaman login = branding layanan (bukan milik satu sekolah)
    const appName = saas ? saas.appName() : 'SIMKEU Cloud';
    const appLogo = saas ? saas.appLogo() : '';
    const tema = saas ? saas.tema() : '#F97316';
    return `<!DOCTYPE html><html lang="id"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${lib.esc(appName)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${base}/assets/app.css?v=${ui.ASSET_V}">
${ui.themeCss(tema)}
<link rel="icon" type="image/png" href="${base}/favicon.ico">
<link rel="apple-touch-icon" href="${base}/favicon.ico">
<meta name="theme-color" content="${lib.esc(tema)}">
</head><body>
<div class="auth-wrap">
  <aside class="auth-aside">
    <div class="inner">
      <div class="flex" style="gap:12px">
        <div style="width:46px;height:46px;border-radius:14px;overflow:hidden;background:rgba(255,255,255,.2);display:grid;place-items:center;border:1px solid rgba(255,255,255,.3)">${appLogo ? `<img src="${lib.esc(appLogo)}" alt="Logo" style="width:100%;height:100%;object-fit:contain">` : ui.icon('wallet')}</div>
        <div>
          <div style="font-weight:800;font-size:17px;letter-spacing:-.02em">${lib.esc(appName)}</div>
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.16em;opacity:.8">Sistem Informasi Keuangan</div>
        </div>
      </div>
      <h1>${sideTitle}</h1>
      <p>${sideDesc}</p>
      <div class="auth-feats">
        <div class="auth-feat"><div class="fi">${ui.icon('book')}</div><div><b>BKU & Buku Pembantu</b><br><span style="opacity:.82">Umum, bank, pajak, tunai & 11 BKU kegiatan khusus.</span></div></div>
        <div class="auth-feat"><div class="fi">${ui.icon('shield')}</div><div><b>RBAC & Audit Trail</b><br><span style="opacity:.82">Hak akses per role, approval pengeluaran besar, log aktivitas.</span></div></div>
        <div class="auth-feat"><div class="fi">${ui.icon('file')}</div><div><b>Laporan Siap Cetak</b><br><span style="opacity:.82">BKU, rekonsiliasi kas, LRA, piutang & SPP — PDF dan Excel.</span></div></div>
      </div>
    </div>
  </aside>
  <main class="auth-main"><div class="auth-card">${content}</div></main>
</div>
<script src="${base}/assets/app.js?v=${ui.ASSET_V}"></script>
</body></html>`;
  }

  /* ---------------- LOGIN MULTI-TENANT: Kode Sekolah + Username + Password ---------------- */
  get('/login', (req, res) => {
    const base = req.BASE;
    const q = req.query;
    const err = q.get('err'), ok = q.get('ok');
    const kode = String(q.get('kode') || '').toUpperCase().slice(0, 4);
    const appName = saas.appName();
    // bila layanan baru dipakai SATU sekolah, tampilkan identitas sekolah itu di halaman login
    let brandLogo = '', brandNama = '';
    try {
      const tenants = saas.allTenants();
      if (tenants.length === 1) {
        const t0 = tenants[0];
        const st0 = dbm.openTenantConn(t0.id, t0.db_file).prepare("SELECT k,v FROM settings WHERE k IN ('sekolah_logo','sekolah_nama')").all();
        const get = k => (st0.find(r => r.k === k) || {}).v || '';
        brandLogo = get('sekolah_logo');
        brandNama = get('sekolah_nama');
      }
    } catch (e) { }
    res.html(authShell({
      base,
      sideTitle: 'Kelola keuangan sekolah dengan rapi, aman, dan transparan.',
      sideDesc: 'Satu tempat untuk transaksi harian, anggaran, piutang, sampai pelaporan pertanggungjawaban dana sekolah.',
      content: `
      <div class="auth-login-head">
        ${brandLogo ? `<img src="${lib.esc(brandLogo)}" alt="Logo" class="auth-logo-img">` : `<div class="auth-logo-ph">${ui.icon('school')}</div>`}
        <div class="auth-welcome">Selamat datang di ${lib.esc(appName)}${brandNama ? ' ' + lib.esc(brandNama) : ''}</div>
        <div class="small muted">Sistem Informasi Manajemen Keuangan Sekolah</div>
      </div>
      ${err ? `<div class="alert err">${ui.icon('alert')}<div>${lib.esc(err)}</div></div>` : ''}
      ${ok ? `<div class="alert ok">${ui.icon('check')}<div>${lib.esc(ok)}</div></div>` : ''}
      <h2>Masuk ke Akun Sekolah</h2>
      <p class="muted small" style="margin-bottom:22px">Masukkan <b>Kode Sekolah</b> 4 karakter yang Anda terima saat pendaftaran.</p>
      <form method="post" action="${base}/login">
        <div class="field"><label>Kode Sekolah</label>
          <input type="text" name="kode" required maxlength="4" value="${lib.esc(kode)}" placeholder="SK01"
            style="text-transform:uppercase;letter-spacing:.28em;font-weight:700" autocomplete="organization"></div>
        <div class="field"><label>Username / Email</label><input type="text" name="email" required placeholder="admin@sekolah.sch.id" autocomplete="username"></div>
        <div class="field"><label>Password</label><input type="password" name="password" required placeholder="••••••••" autocomplete="current-password"></div>
        <button class="btn btn-primary btn-block" type="submit" style="margin-top:6px">Masuk</button>
      </form>
      <p class="small muted" style="margin-top:18px;text-align:center">Belum punya akun sekolah?
        <a href="${base}/register" style="color:var(--o-700);font-weight:700">Daftarkan sekolah Anda</a></p>
      <p class="small" style="margin-top:6px;text-align:center"><a href="${base}/portal" style="color:var(--o-700);font-weight:600">Cek Tagihan Iuran Siswa (Portal Orang Tua)</a></p>
      <p class="small muted" style="margin-top:14px;text-align:center;font-size:11px">Super Admin Pusat? <a href="${base}/super-admin/login" style="color:var(--o-700);font-weight:600">Masuk di sini</a></p>`
    }));
  });

  post('/login', (req, res) => {
    const base = req.BASE;
    const kode = String(req.body.kode || '').trim().toUpperCase();
    const ident = String(req.body.email || '').trim();
    const password = String(req.body.password || '');
    const fail = msg => res.redirect(base + '/login?err=' + encodeURIComponent(msg) + (kode ? '&kode=' + encodeURIComponent(kode) : ''));
    // Kompatibilitas: tautan/ bookmark lama tanpa kode sekolah tetap dilayani
    // oleh sekolah pertama (SK01). Bila kode diisi, isolasi tetap ketat per sekolah.
    const tenant = kode ? saas.tenantByCode(kode) : saas.tenantById(1);
    if (!tenant) return fail(kode ? ('Kode sekolah "' + kode + '" tidak ditemukan. Periksa kembali kode dari admin sekolah Anda.') : 'Kode sekolah wajib diisi (4 karakter).');
    const conn = dbm.openTenantConn(tenant.id, tenant.db_file);
    const u = conn.prepare("SELECT * FROM users WHERE lower(email)=lower(?) OR lower(COALESCE(username,''))=lower(?) ORDER BY id LIMIT 1").get(ident, ident);
    if (!u || !lib.verifyPassword(password, u.password)) return fail('Username atau password salah' + (kode ? ' untuk sekolah ' + kode : '') + '.');
    if (!u.aktif) return fail('Akun Anda dinonaktifkan. Hubungi admin sekolah.');
    // hitung draf pengeluaran baru di database sekolah tersebut
    const alert = dbm.runAsTenant(tenant, () => {
      const pendingRow = db.prepare("SELECT COUNT(*) c FROM transaksi WHERE status='pending'").get();
      return pendingRow ? pendingRow.c : 0;
    });
    const t = setSession(u.id, tenant.id, alert);
    dbm.runAsTenant(tenant, () => {
      dbm.logAudit(u, 'LOGIN', 'auth', `${u.nama} masuk ke aplikasi (${tenant.nama})`);
    });
    res.set('Set-Cookie', `${COOKIE}=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 14}`);
    res.redirect(base + '/');
  });

  /* ---------------- PENDAFTARAN MANDIRI SEKOLAH BARU ---------------- */
  function registerForm(req, res, { err } = {}) {
    const base = req.BASE;
    const q = req.query;
    const v = k => lib.esc(q.get(k) || '');
    res.html(authShell({
      base,
      sideTitle: 'Daftarkan sekolah Anda dalam 1 menit.',
      sideDesc: 'Dapatkan kode sekolah 4 karakter, akun admin, dan database keuangan yang terisolasi penuh dari sekolah lain.',
      content: `
      <div class="auth-login-head">
        <div class="auth-logo-ph">${ui.icon('school')}</div>
        <div class="auth-welcome">Pendaftaran Sekolah Baru</div>
        <div class="small muted">${lib.esc(saas.appName())} · uji coba ${saas.trialDays()} hari</div>
      </div>
      ${err ? `<div class="alert err">${ui.icon('alert')}<div>${lib.esc(err)}</div></div>` : ''}
      <form method="post" action="${base}/register">
        <div class="row2">
          <div class="field"><label>Nama Sekolah</label><input type="text" name="nama" value="${v('nama')}" required placeholder="SMK Negeri 1 Contoh"></div>
          <div class="field"><label>Nama Kepala Sekolah</label><input type="text" name="kepala" value="${v('kepala')}" placeholder="Opsional"></div>
        </div>
        <div class="field"><label>Alamat Sekolah</label><input type="text" name="alamat" value="${v('alamat')}" placeholder="Jl. Pendidikan No. 1, Kota"></div>
        <div class="row2">
          <div class="field"><label>Nama Admin</label><input type="text" name="admin_nama" value="${v('admin_nama')}" required placeholder="Nama bendahara/admin"></div>
          <div class="field"><label>Email Admin (untuk login)</label><input type="email" name="admin_email" value="${v('admin_email')}" required placeholder="admin@sekolah.sch.id"></div>
        </div>
        <div class="row2">
          <div class="field"><label>Password Admin</label><input type="password" name="admin_password" required minlength="6" placeholder="minimal 6 karakter"></div>
          <div class="field"><label>Ulangi Password</label><input type="password" name="admin_password2" required minlength="6" placeholder="ulangi password"></div>
        </div>
        <div class="field"><label>Nomor WhatsApp / Telepon</label><input type="text" name="telp" value="${v('telp')}" placeholder="08xx"></div>
        <div class="field"><label>Paket Langganan</label>
          <select name="paket">
            <option value="standard">Standard — BKU, transaksi, laporan, piutang, aset, backup</option>
            <option value="pro">Pro — semua fitur (iuran siswa, payroll, akademik, ekskul, beasiswa)</option>
          </select></div>
        ${saas.trialDays() > 0 ? `<div class="alert info">${ui.icon('info')}<div>Masa uji coba <b>${saas.trialDays()} hari</b> aktif otomatis. Kode sekolah 4 karakter dibuatkan sistem dan ditampilkan setelah pendaftaran.</div></div>` : ''}
        <button class="btn btn-primary btn-block" type="submit">Daftarkan Sekolah</button>
      </form>
      <p class="small muted" style="margin-top:16px;text-align:center">Sudah punya akun? <a href="${base}/login" style="color:var(--o-700);font-weight:700">Masuk</a></p>`
    }));
  }

  get('/register', (req, res) => registerForm(req, res));
  get('/daftar', (req, res) => registerForm(req, res));

  post('/register', (req, res) => {
    const base = req.BASE;
    const b = req.body || {};
    const back = q => base + '/register?' + Object.keys(q).map(k => k + '=' + encodeURIComponent(q[k] || '')).join('&');
    const nama = String(b.nama || '').trim();
    const email = String(b.admin_email || '').trim();
    const p1 = String(b.admin_password || ''), p2 = String(b.admin_password2 || '');
    if (!nama) return res.redirect(back({ err: 'Nama sekolah wajib diisi.', nama, admin_email: email }));
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.redirect(back({ err: 'Email admin tidak valid.', nama }));
    if (p1.length < 6) return res.redirect(back({ err: 'Password minimal 6 karakter.', nama, admin_email: email }));
    if (p1 !== p2) return res.redirect(back({ err: 'Konfirmasi password tidak sama.', nama, admin_email: email }));
    try {
      const tenant = saas.createTenant({
        nama, admin_email: email, admin_password: p1,
        admin_nama: String(b.admin_nama || 'Administrator Sekolah').trim(),
        alamat: String(b.alamat || ''), kepala: String(b.kepala || ''),
        contact_telp: String(b.telp || ''), paket: b.paket === 'pro' ? 'pro' : 'standard',
        trial: true
      });
      res.redirect(base + '/login?ok=' + encodeURIComponent(
        `Pendaftaran berhasil! Kode Sekolah Anda: ${tenant.school_code}. Simpan kode ini untuk login.`) + '&kode=' + encodeURIComponent(tenant.school_code));
    } catch (e) {
      res.redirect(back({ err: e.message, nama, admin_email: email }));
    }
  });

  post('/logout', (req, res) => {
    const c = String(req.headers.cookie || '');
    const m = c.match(/simkeu_sid=([^;]+)/);
    if (m) saas.destroySession(decodeURIComponent(m[1]));
    res.set('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0`);
    res.redirect(req.BASE + '/login?ok=' + encodeURIComponent('Anda telah keluar dari aplikasi.'));
  });

  /* profil sendiri */
  get('/akun', (req, res) => {
    const c = ctx(req);
    // akun demo memakai database dummy: identitas diambil dari sesi, bukan dari database dummy
    const u = req.user.role === 'demo'
      ? Object.assign({}, req.user)
      : dbm.mainDb.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    const isDemo = u.role === 'demo';
    page(req, res, {
      title: 'Akun Saya', sub: 'Kelola profil dan password Anda', active: 'akun',
      content: `<div class="split"><div class="card">
        <div class="card-head"><div><h3>Foto Profil</h3><div class="sub">JPG/PNG, maksimal 5 MB</div></div></div>
        <div class="flex" style="gap:18px;align-items:flex-start;flex-wrap:wrap">
          <div style="text-align:center">
            <div data-avatar-preview="foto_b64">${ui.avatar(u, 'avatar avatar-xl')}</div>
            <div class="avatar-preview-note">Pratinjau avatar</div>
          </div>
          <div style="flex:1;min-width:220px">
            <form method="post" action="${c.base}/akun/foto">
              <input type="hidden" name="foto_b64" id="foto_b64">
              <div class="field" style="margin-bottom:8px"><label>Pilih foto (JPG/PNG, maks 5 MB)</label>
                <input type="file" accept="image/*" data-avatar="foto_b64" data-max="5">
                <div class="avatar-pos" data-avatar-pos="foto_b64" style="display:${u.foto ? 'flex' : 'none'}">
                  <span class="small muted" style="align-self:center;margin-right:2px">Posisi:</span>
                  <button type="button" data-pos="0">Atas</button>
                  <button type="button" data-pos="0.5" class="on">Tengah</button>
                  <button type="button" data-pos="1">Bawah</button>
                </div>
                <div class="hint" id="foto_b64-info">Foto otomatis dipotong persegi mengikuti pratinjau di samping — yang Anda lihat itulah avatar yang tersimpan.</div></div>
              <button class="btn btn-primary btn-block">${ui.icon('upload')}Simpan Foto Profil</button>
            </form>
            ${u.foto ? `<form method="post" action="${c.base}/akun/foto" data-confirm="Hapus foto profil?"><input type="hidden" name="hapus" value="1"><button class="btn btn-danger btn-block mt-1">${ui.icon('trash')}Hapus Foto</button></form>` : ''}
          </div>
        </div>
        <hr class="sep">
        <div class="card-head"><div><h3>Profil</h3><div class="sub">Data akun yang sedang aktif</div></div></div>
        <form method="post" action="${c.base}/akun">
          <div class="row2">
            <div class="field"><label>Nama Lengkap</label><input type="text" name="nama" value="${lib.esc(u.nama)}" required></div>
            <div class="field"><label>Email</label><input type="email" name="email" value="${lib.esc(u.email)}" required></div>
          </div>
          <div class="field"><label>Role</label><input type="text" value="${lib.esc(roleLabel(u.role))}" readonly></div>
          ${isDemo ? `<div class="alert info">${ui.icon('lock')}<div><b>Akun Demo tidak dapat mengubah kata sandinya sendiri.</b>
            Kata sandi akun demo hanya dapat diatur &amp; diubah oleh Super Admin melalui menu <b>Pengguna &amp; Hak Akses</b>.
            Akun ini juga memakai <b>database dummy</b> terpisah, sehingga semua perubahan tidak memengaruhi data sekolah.</div></div>`
      : `<div class="row2">
            <div class="field"><label>Password Baru</label><input type="password" name="password" placeholder="Kosongkan jika tidak diubah" minlength="6"></div>
            <div class="field"><label>Ulangi Password Baru</label><input type="password" name="password2" placeholder="Ulangi password baru"></div>
          </div>`}
          <div class="form-actions"><button class="btn btn-primary">${ui.icon('save')}Simpan Perubahan</button></div>
        </form>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Hak Akses Role Anda</h3><div class="sub">${lib.esc(roleLabel(u.role))}</div></div></div>
        ${permissionList(u.role)}
        <p class="help mt-2">Terakhir masuk: ${lib.esc(u.last_login || '-')}</p>
      </div></div>`
    });
  });

  post('/akun', (req, res) => {
    const { nama, email, password, password2 } = req.body;
    const me = req.user.role === 'demo'
      ? { role: 'demo' }
      : dbm.mainDb.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (me && me.role === 'demo' && password) {
      return res.redirect(req.BASE + '/akun?err=' + encodeURIComponent('Akun Demo tidak dapat mengubah kata sandi sendiri. Hubungi Super Admin.'));
    }
    if (!nama || !email) return res.redirect(req.BASE + '/akun?err=' + encodeURIComponent('Nama dan email wajib diisi.'));
    const dup = dbm.mainDb.prepare('SELECT id FROM users WHERE lower(email)=lower(?) AND id<>?').get(String(email).trim(), req.user.id);
    if (dup) return res.redirect(req.BASE + '/akun?err=' + encodeURIComponent('Email sudah dipakai akun lain.'));
    if (password) {
      if (String(password).length < 6) return res.redirect(req.BASE + '/akun?err=' + encodeURIComponent('Password minimal 6 karakter.'));
      if (password !== password2) return res.redirect(req.BASE + '/akun?err=' + encodeURIComponent('Konfirmasi password tidak sama.'));
      dbm.mainDb.prepare('UPDATE users SET nama=?,email=?,password=? WHERE id=?').run(String(nama).trim(), String(email).trim(), lib.hashPassword(password), req.user.id);
    } else {
      dbm.mainDb.prepare('UPDATE users SET nama=?,email=? WHERE id=?').run(String(nama).trim(), String(email).trim(), req.user.id);
    }
    dbm.logAudit(req.user, 'EDIT', 'pengguna', `Memperbarui profil sendiri (${email})`);
    res.redirect(req.BASE + '/akun?ok=' + encodeURIComponent('Profil berhasil diperbarui.'));
  });

  post('/akun/foto', async (req, res) => {
    if (req.body.hapus) {
      dbm.mainDb.prepare('UPDATE users SET foto=NULL WHERE id=?').run(req.user.id);
      dbm.logAudit(req.user, 'EDIT', 'pengguna', 'Menghapus foto profil');
      return res.redirect(req.BASE + '/akun?ok=' + encodeURIComponent('Foto profil dihapus.'));
    }
    if (!req.body.foto_b64) return res.redirect(req.BASE + '/akun?err=' + encodeURIComponent('Pilih berkas foto terlebih dahulu.'));
    try {
      const m = String(req.body.foto_b64).match(/^data:(image\/[^;]+);base64,/);
      if (!m) throw new Error('Berkas bukan gambar yang valid.');
      const ext = (m[1].split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
      const url = await uploadMedia(req.body.foto_b64, `foto-${req.user.id}-${Date.now()}.${ext}`);
      dbm.mainDb.prepare('UPDATE users SET foto=? WHERE id=?').run(url, req.user.id);
      dbm.logAudit(req.user, 'EDIT', 'pengguna', 'Memperbarui foto profil');
      res.redirect(req.BASE + '/akun?ok=' + encodeURIComponent('Foto profil diperbarui.'));
    } catch (e) {
      res.redirect(req.BASE + '/akun?err=' + encodeURIComponent(e.message));
    }
  });

  function permissionList(role) {
    const map = permissionMatrix();
    let html = '<div class="list">';
    for (const m of dbm.MODULES) {
      const acts = dbm.ACTIONS.filter(a => (map[`${role}|${m.key}|${a}`] || 0) === 1);
      html += `<div class="list-row"><div class="dot-s" style="background:${acts.length ? 'var(--o-500)' : '#DDD2C9'}"></div>
        <div><div class="nm">${lib.esc(m.label)}</div><div class="mt">${acts.length ? acts.map(a => labelAction(a)).join(' · ') : 'Tidak ada akses'}</div></div>
        ${acts.length ? ui.badge('Aktif', 'green') : ui.badge('Terkunci', 'gray')}</div>`;
    }
    return html + '</div>';
  }
  function labelAction(a) {
    return ({ view: 'Lihat', create: 'Tambah', edit: 'Edit', delete: 'Hapus', approve: 'Approval', export: 'Export' })[a] || a;
  }
};
