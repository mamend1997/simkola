'use strict';

module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can, setSession, COOKIE, roleLabel, permissionMatrix, renderError, uploadMedia }) => {
  const { db } = dbm;

  function authShell({ base, content, sideTitle, sideDesc }) {
    return `<!DOCTYPE html><html lang="id"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SIMKEU Sekolah</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${base}/assets/app.css?v=${ui.ASSET_V}">
<link rel="icon" type="image/png" href="${base}/favicon.ico">
<link rel="apple-touch-icon" href="${base}/favicon.ico">
<meta name="theme-color" content="#F97316">
</head><body>
<div class="auth-wrap">
  <aside class="auth-aside">
    <div class="inner">
      <div class="flex" style="gap:12px">
        <div style="width:46px;height:46px;border-radius:14px;background:rgba(255,255,255,.2);display:grid;place-items:center;border:1px solid rgba(255,255,255,.3)">${ui.icon('wallet')}</div>
        <div>
          <div style="font-weight:800;font-size:17px;letter-spacing:-.02em">SIMKEU Sekolah</div>
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

  get('/login', (req, res) => {
    const base = req.BASE;
    const q = req.query;
    const err = q.get('err'), ok = q.get('ok');
    const s = dbm.settingsAll();
    const sekolah = String(s.sekolah_nama || 'SMK PGRI Cikoneng').trim();
    const logo = s.sekolah_logo
      ? `<img src="${lib.esc(s.sekolah_logo)}" alt="Logo ${lib.esc(sekolah)}" class="auth-logo-img">`
      : `<div class="auth-logo-ph">${ui.icon('school')}</div>`;
    res.html(authShell({
      base,
      sideTitle: 'Kelola keuangan sekolah dengan rapi, aman, dan transparan.',
      sideDesc: 'Satu tempat untuk transaksi harian, anggaran, piutang, sampai pelaporan pertanggungjawaban dana sekolah.',
      content: `
      <div class="auth-login-head">
        ${logo}
        <div class="auth-welcome">Selamat datang di SIMKEU Sekolah ${lib.esc(sekolah)}</div>
        <div class="small muted">Sistem Informasi Manajemen Keuangan Sekolah</div>
      </div>
      ${err ? `<div class="alert err">${ui.icon('alert')}<div>${lib.esc(err)}</div></div>` : ''}
      ${ok ? `<div class="alert ok">${ui.icon('check')}<div>${lib.esc(ok)}</div></div>` : ''}
      <h2>Masuk ke Akun Anda</h2>
      <p class="muted small" style="margin-bottom:22px">Gunakan akun yang terdaftar untuk melanjutkan pengelolaan keuangan.</p>
      <form method="post" action="${base}/login">
        <div class="field"><label>Email</label><input type="email" name="email" required placeholder="nama@sekolah.sch.id" autocomplete="username"></div>
        <div class="field"><label>Password</label><input type="password" name="password" required placeholder="••••••••" autocomplete="current-password"></div>
        <button class="btn btn-primary btn-block" type="submit" style="margin-top:6px">Masuk</button>
      </form>
      <p class="small muted" style="margin-top:18px;text-align:center">Belum memiliki akun? Hubungi Super Admin / Bendahara sekolah untuk pembuatan akun.</p>
      <p class="small" style="margin-top:10px;text-align:center"><a href="${base}/portal" style="color:var(--o-700);font-weight:600">Cek Tagihan Iuran Siswa (Portal Orang Tua)</a></p>`
    }));
  });

  post('/login', (req, res) => {
    const { email, password } = req.body;
    const u = db.prepare('SELECT * FROM users WHERE lower(email)=lower(?)').get(String(email || '').trim());
    if (!u || !lib.verifyPassword(password || '', u.password)) {
      return res.redirect(req.BASE + '/login?err=' + encodeURIComponent('Email atau password salah.'));
    }
    if (!u.aktif) return res.redirect(req.BASE + '/login?err=' + encodeURIComponent('Akun Anda dinonaktifkan. Hubungi Super Admin.'));
    const t = setSession(u.id);
    dbm.logAudit(u, 'LOGIN', 'auth', `${u.nama} masuk ke aplikasi`);
    res.set('Set-Cookie', `${COOKIE}=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 14}`);
    res.redirect(req.BASE + '/');
  });

  post('/logout', (req, res) => {
    const c = String(req.headers.cookie || '');
    const m = c.match(/simkeu_sid=([^;]+)/);
    if (m) db.prepare('DELETE FROM sessions WHERE token=?').run(decodeURIComponent(m[1]));
    res.set('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0`);
    res.redirect(req.BASE + '/login?ok=' + encodeURIComponent('Anda telah keluar dari aplikasi.'));
  });

  /* profil sendiri */
  get('/akun', (req, res) => {
    const c = ctx(req);
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
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
          <div class="row2">
            <div class="field"><label>Password Baru</label><input type="password" name="password" placeholder="Kosongkan jika tidak diubah" minlength="6"></div>
            <div class="field"><label>Ulangi Password Baru</label><input type="password" name="password2" placeholder="Ulangi password baru"></div>
          </div>
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
    if (!nama || !email) return res.redirect(req.BASE + '/akun?err=' + encodeURIComponent('Nama dan email wajib diisi.'));
    const dup = db.prepare('SELECT id FROM users WHERE lower(email)=lower(?) AND id<>?').get(String(email).trim(), req.user.id);
    if (dup) return res.redirect(req.BASE + '/akun?err=' + encodeURIComponent('Email sudah dipakai akun lain.'));
    if (password) {
      if (String(password).length < 6) return res.redirect(req.BASE + '/akun?err=' + encodeURIComponent('Password minimal 6 karakter.'));
      if (password !== password2) return res.redirect(req.BASE + '/akun?err=' + encodeURIComponent('Konfirmasi password tidak sama.'));
      db.prepare('UPDATE users SET nama=?,email=?,password=? WHERE id=?').run(String(nama).trim(), String(email).trim(), lib.hashPassword(password), req.user.id);
    } else {
      db.prepare('UPDATE users SET nama=?,email=? WHERE id=?').run(String(nama).trim(), String(email).trim(), req.user.id);
    }
    dbm.logAudit(req.user, 'EDIT', 'pengguna', `Memperbarui profil sendiri (${email})`);
    res.redirect(req.BASE + '/akun?ok=' + encodeURIComponent('Profil berhasil diperbarui.'));
  });

  post('/akun/foto', async (req, res) => {
    if (req.body.hapus) {
      db.prepare('UPDATE users SET foto=NULL WHERE id=?').run(req.user.id);
      dbm.logAudit(req.user, 'EDIT', 'pengguna', 'Menghapus foto profil');
      return res.redirect(req.BASE + '/akun?ok=' + encodeURIComponent('Foto profil dihapus.'));
    }
    if (!req.body.foto_b64) return res.redirect(req.BASE + '/akun?err=' + encodeURIComponent('Pilih berkas foto terlebih dahulu.'));
    try {
      const m = String(req.body.foto_b64).match(/^data:(image\/[^;]+);base64,/);
      if (!m) throw new Error('Berkas bukan gambar yang valid.');
      const ext = (m[1].split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
      const url = await uploadMedia(req.body.foto_b64, `foto-${req.user.id}-${Date.now()}.${ext}`);
      db.prepare('UPDATE users SET foto=? WHERE id=?').run(url, req.user.id);
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
