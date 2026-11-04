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
${ui.fontLinks()}
${ui.logoPreconnect([appLogo])}
${appLogo ? `<link rel="preload" as="image" href="${lib.esc(appLogo)}" fetchpriority="high">` : ''}
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
        <div style="width:46px;height:46px;border-radius:14px;overflow:hidden;background:rgba(255,255,255,.2);display:grid;place-items:center;border:1px solid rgba(255,255,255,.3)">${appLogo ? `<img src="${lib.esc(appLogo)}" alt="Logo" width="46" height="46" fetchpriority="high" decoding="async" style="width:100%;height:100%;object-fit:contain">` : ui.icon('wallet')}</div>
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
<script src="${base}/assets/app.js?v=${ui.ASSET_V}" defer></script>
</body></html>`;
  }

  /* ---------------- LOGIN MULTI-TENANT: Kode Sekolah + Username + Password ---------------- */
  get('/login', (req, res) => {
    const base = req.BASE;
    const q = req.query;
    const err = q.get('err'), ok = q.get('ok');
    const kode = String(q.get('kode') || '').toUpperCase().slice(0, 4);
    const appName = saas.appName();
    // portal login UTAMA selalu memakai branding DEFAULT sistem (diatur Super Admin),
    // bukan logo sekolah — logo sekolah hanya tampil setelah masuk ke sekolahnya.
    const sysLogo = saas.appLogo();
    res.html(authShell({
      base,
      sideTitle: 'Kelola keuangan sekolah dengan rapi, aman, dan transparan.',
      sideDesc: 'Satu tempat untuk transaksi harian, anggaran, piutang, sampai pelaporan pertanggungjawaban dana sekolah.',
      content: `
      <div class="auth-login-head">
        ${sysLogo ? `<img src="${lib.esc(sysLogo)}" alt="Logo" class="auth-logo-img" width="96" height="96" fetchpriority="high" decoding="async">` : `<div class="auth-logo-ph">${ui.icon('school')}</div>`}
        <div class="auth-welcome">Selamat datang di ${lib.esc(appName)}</div>
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
        <a href="${base}/register" style="color:var(--o-700);font-weight:700">Daftarkan sekolah Anda</a></p>`
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
    const defPkg = saas.defaultPackage();
    const pkgs = saas.packageRows();
    // paket terpilih: dari query (bila valid) → selain itu paket default bila bisa daftar mandiri
    // → selain itu paket pertama yang boleh daftar mandiri (agar sekolah baru tetap bisa langsung daftar)
    const qPkg = saas.packageByKode(v('paket'));
    const selPkg = qPkg
      || (saas.packageSelfTrial(defPkg) ? defPkg : (pkgs.filter(p => saas.packageSelfTrial(p))[0] || defPkg));
    const rupiah = lib.rupiah;
    const pkCards = pkgs.map(p => {
      const selfTrial = saas.packageSelfTrial(p);
      const feats = saas.packageFeatureLabels(p);
      const trialHari = saas.packageTrialDays(p);
      const wa = saas.waAdminLink(p);
      return `<label class="pk-pick" data-pkg="${lib.esc(p.kode)}" data-self="${selfTrial ? 1 : 0}" data-wa="${lib.esc(wa || '')}">
        <input type="radio" name="paket" value="${lib.esc(p.kode)}" ${p.kode === selPkg.kode ? 'checked' : ''}>
        <div class="pk-card${p.kode === selPkg.kode ? ' on' : ''}">
          <div class="between" style="gap:8px">
            <div class="t-strong" style="font-size:15px">${lib.esc(p.nama)}</div>
            ${selfTrial ? ui.badge('Daftar langsung', 'green') : ui.badge('Berbayar', 'amber')}
          </div>
          <div class="pk-price" style="margin-top:6px">${rupiah(p.harga_bulan)}<span class="t-sub" style="font-size:12px;font-weight:600"> / bulan</span></div>
          <div class="small muted">${rupiah(p.harga_tahun)} / 12 bulan</div>
          ${p.keterangan ? `<div class="small" style="margin-top:6px">${lib.esc(p.keterangan)}</div>` : ''}
          <ul class="pk-feats">${feats.slice(0, 10).map(f => `<li>${lib.esc(f)}</li>`).join('')}${feats.length > 10 ? `<li>+ ${feats.length - 10} fitur lainnya</li>` : ''}</ul>
          <div class="hint" style="margin-top:8px">${selfTrial
        ? `Bisa langsung daftar & gratis ${trialHari} hari uji coba.`
        : 'Aktivasi setelah pembayaran (hubungi admin via WhatsApp).'}</div>
        </div>
      </label>`;
    }).join('');
    const pkNoteDefault = selPkg && saas.packageSelfTrial(selPkg)
      ? `Paket <b>${lib.esc(selPkg.nama)}</b>: langsung daftar dan dapat masa uji coba <b>${saas.packageTrialDays(selPkg)} hari</b> tanpa biaya.`
      : `Paket <b>${lib.esc(selPkg ? selPkg.nama : defPkg.nama)}</b> berbayar — klik tombol WhatsApp untuk pembayaran &amp; aktivasi.`;
    const cap = saas.captchaConfig();
    const capSite = cap.siteKey;
    let captchaHtml = '';
    if (cap.provider === 'turnstile' && capSite) {
      captchaHtml = `<input type="hidden" name="cf-turnstile-response" id="cfToken">
        <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
        <div class="cf-turnstile" data-sitekey="${lib.esc(capSite)}" data-callback="__capOk" style="margin-bottom:10px"></div>
        <script>function __capOk(t){var e=document.getElementById('cfToken');if(e)e.value=t;}</script>`;
    } else if (cap.provider === 'recaptcha' && capSite) {
      captchaHtml = `<input type="hidden" name="recaptcha_token" id="rcToken">
        <script src="https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(capSite)}"></script>
        <script>
          document.addEventListener('submit', function (ev) {
            var f = ev.target, t = document.getElementById('rcToken');
            if (!f || !f.action || !/register/.test(f.action) || (t && t.value)) return;
            ev.preventDefault();
            grecaptcha.ready(function () {
              grecaptcha.execute(${JSON.stringify(capSite)}, { action: 'register' }).then(function (tok) {
                t.value = tok; f.submit();
              });
            });
          }, true);
        </script>`;
    }
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
        <div class="field"><label>Jenjang Pendidikan</label>
          <select name="jenjang">
            ${Object.entries(dbm.JENJANG).map(([k, val]) => `<option value="${lib.esc(k)}" ${v('jenjang') === lib.esc(k) ? 'selected' : ''}>${lib.esc(val.label)}${val.preset.length ? ' — tingkat ' + val.preset.join(', ') : ''}</option>`).join('')}
          </select>
          <div class="hint">Preset tingkat kelas otomatis mengikuti jenjang ini.</div></div>
        <hr class="sep">
        <div class="t-strong" style="margin-bottom:8px">Pilih Paket Langganan</div>
        <div class="pk-grid">
          ${pkCards}
        </div>
        <div class="alert info" id="pkNote">${ui.icon('info')}<div id="pkNoteBody">${pkNoteDefault}</div></div>
        ${captchaHtml}
        <button class="btn btn-primary btn-block" type="submit" id="btnDaftar">Daftarkan Sekolah</button>
        <a class="btn btn-success btn-block" id="btnWa" style="display:none;background:#25D366;border-color:#25D366;color:#fff"
          target="_blank" rel="noopener" href="#">${ui.icon('send')}Langganan via WhatsApp Admin</a>
      </form>
      <p class="small muted" style="margin-top:16px;text-align:center">Sudah punya akun? <a href="${base}/login" style="color:var(--o-700);font-weight:700">Masuk</a></p>
      <script>
      (function () {
        var wraps = Array.prototype.slice.call(document.querySelectorAll('.pk-pick'));
        var btnDaftar = document.getElementById('btnDaftar');
        var btnWa = document.getElementById('btnWa');
        var note = document.getElementById('pkNoteBody');
        function sync() {
          var sel = wraps.filter(function (w) { return w.querySelector('input').checked; })[0] || wraps[0];
          if (!sel) return;
          wraps.forEach(function (w) { w.querySelector('.pk-card').classList.toggle('on', w === sel); });
          var self = sel.getAttribute('data-self') === '1';
          var wa = sel.getAttribute('data-wa') || '';
          if (btnDaftar) btnDaftar.style.display = self ? '' : 'none';
          if (btnWa) {
            btnWa.style.display = self ? 'none' : '';
            if (wa) { btnWa.setAttribute('href', wa); btnWa.removeAttribute('aria-disabled'); }
            else { btnWa.setAttribute('href', '#'); btnWa.setAttribute('aria-disabled', 'true'); }
          }
          if (note) {
            var nm = sel.querySelector('.pk-card .t-strong').textContent.trim();
            note.innerHTML = self
              ? 'Paket <b>' + nm + '</b>: langsung daftar dan dapat masa uji coba tanpa biaya.'
              : (wa ? 'Paket <b>' + nm + '</b> berbayar — klik tombol WhatsApp untuk pembayaran &amp; aktivasi.'
                    : 'Paket <b>' + nm + '</b> berbayar. Nomor admin belum diatur — hubungi sekolah lain yang sudah aktif.');
          }
        }
        wraps.forEach(function (w) {
          w.querySelector('input').addEventListener('change', sync);
          w.addEventListener('click', function (e) {
            if (e.target && e.target.tagName === 'INPUT') return;
            w.querySelector('input').checked = true;
            sync();
          });
        });
        sync();
      })();
      </script>`
    }));
  }

  get('/register', (req, res) => registerForm(req, res));
  get('/daftar', (req, res) => registerForm(req, res));

  post('/register', async (req, res) => {
    const base = req.BASE;
    const b = req.body || {};
    const back = q => base + '/register?' + Object.keys(q).map(k => k + '=' + encodeURIComponent(q[k] || '')).join('&');
    const nama = String(b.nama || '').trim();
    const email = String(b.admin_email || '').trim();
    const p1 = String(b.admin_password || ''), p2 = String(b.admin_password2 || '');
    const keep = { nama, admin_email: email, admin_nama: b.admin_nama, alamat: b.alamat, kepala: b.kepala, telp: b.telp, jenjang: b.jenjang };
    const ip = saas.clientIpOf(req);

    // ---- 1) RATE LIMIT / IP THROTTLING (maks. N pendaftaran per jam, blokir X jam) ----
    const status = saas.regStatus(ip);
    if (status.blocked) {
      return res.redirect(back(Object.assign({}, keep, {
        err: `Terlalu banyak permintaan pendaftaran. Silakan coba beberapa saat lagi (${status.retryMin} menit).`
      })));
    }

    // ---- 2) CAPTCHA (reCAPTCHA v3 / Turnstile) bila dikonfigurasi ----
    const capErr = await saas.verifyCaptcha(b.cfTurnstileResponse || b['cf-turnstile-response'] || b.recaptcha_token, ip);
    if (capErr) {
      saas.regLog(ip, email, 'captcha');
      return res.redirect(back(Object.assign({}, keep, { err: capErr })));
    }

    // ---- 3) validasi isian ----
    const fail = msg => { saas.regLog(ip, email, 'gagal'); return res.redirect(back(Object.assign({}, keep, { err: msg }))); };
    if (!nama) return fail('Nama sekolah wajib diisi.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('Email admin tidak valid.');
    if (p1.length < 6) return fail('Password minimal 6 karakter.');
    if (p1 !== p2) return fail('Konfirmasi password tidak sama.');
    const jenjang = dbm.JENJANG[String(b.jenjang || '')] ? String(b.jenjang) : '';

    // ---- 3b) PAKET: hanya paket "daftar mandiri" yang boleh langsung mendaftar.
    // Paket berbayar diarahkan ke WhatsApp admin (sesuai harga paket) tanpa membuat tenant.
    const pkgSel = saas.packageByKode(String(b.paket || '').trim()) || saas.defaultPackage();
    if (!saas.packageSelfTrial(pkgSel)) {
      const wa = saas.waAdminLink(pkgSel, { sekolah: nama, admin: String(b.admin_nama || '').trim() });
      saas.regLog(ip, email, 'wa');
      if (wa) return res.redirect(wa);
      return fail(`Paket ${pkgSel.nama} berbayar. Nomor WhatsApp admin belum diatur — hubungi pengelola layanan untuk aktivasi.`);
    }

    // ---- 4) batas per jam (setelah validasi dasar) ----
    const hit = saas.regHit(ip, email, 'sukses');
    if (hit.blocked) {
      return res.redirect(back(Object.assign({}, keep, {
        err: `Terlalu banyak permintaan pendaftaran. Silakan coba beberapa saat lagi (${hit.retryMin || saas.regLimits().blockHours * 60} menit).`
      })));
    }

    try {
      const tenant = saas.createTenant({
        nama, admin_email: email, admin_password: p1,
        admin_nama: String(b.admin_nama || 'Administrator Sekolah').trim(),
        alamat: String(b.alamat || ''), kepala: String(b.kepala || ''),
        contact_telp: String(b.telp || ''), jenjang,
        paket: b.paket, trial: true
      });
      /* ================================================================
         SETELAH DAFTAR: langsung masuk sebagai Admin Sekolah yang baru dibuat.
         Kredensial (kode sekolah 4 karakter, username, password) disimpan pada
         baris sesi — bukan di URL — lalu ditampilkan SEKALI di dashboard.
         Bila pembuatan sesi gagal, pengguna diarahkan ke halaman sukses
         berisi kredensial yang sama (token sekali pakai, kedaluwarsa 30 menit).
         ================================================================ */
      const admin = (() => {
        try {
          return dbm.runAsTenant(tenant, () => db.prepare(
            "SELECT * FROM users WHERE role='super_admin' ORDER BY id LIMIT 1").get());
        } catch (e) { console.error('[daftar] admin sekolah tidak ditemukan:', e.message); return null; }
      })();
      const kredensial = {
        kode: tenant.school_code,
        sekolah: tenant.nama,
        username: (admin && (admin.username || admin.email)) || email,
        nama: (admin && admin.nama) || String(b.admin_nama || 'Administrator Sekolah').trim(),
        password: p1,
        at: lib.nowStamp()
      };
      let token = null;
      if (admin && admin.aktif) {
        try { token = setSession(admin.id, tenant.id, 0, JSON.stringify(kredensial)); } catch (e) { console.error('[daftar] gagal membuat sesi:', e.message); }
      }
      try {
        dbm.runAsTenant(tenant, () => dbm.logAudit(admin || null, 'DAFTAR', 'auth',
          `Pendaftaran sekolah ${tenant.nama} (${tenant.school_code}) — admin ${email}`
          + (token ? ' langsung masuk ke dashboard' : ' diarahkan ke halaman kredensial')));
      } catch (e) { }
      if (token) {
        res.set('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 14}`);
        return res.redirect(base + '/?welcome=1');
      }
      // ---- fallback: halaman sukses berisi kredensial (token sekali pakai) ----
      const sKey = require('crypto').randomBytes(12).toString('hex');
      successStore.set(sKey, { ...kredensial, exp: Date.now() + 30 * 60 * 1000 });
      return res.redirect(base + '/daftar/sukses?t=' + sKey);
    } catch (e) {
      res.redirect(back(Object.assign({}, keep, { err: e.message })));
    }
  });

  /* ================================================================
     HALAMAN SUKSES PENDAFTARAN (fallback / tautan ulang)
     Menampilkan Kode Sekolah, Username, dan Password dalam satu kartu.
     Data disimpan di memori 30 menit & sekali pakai — tidak pernah di URL.
     ================================================================ */
  const successStore = new Map();
  function takeSuccess(key) {
    const k = String(key || '');
    if (!k) return null;
    const v = successStore.get(k);
    if (!v) return null;
    successStore.delete(k);
    if (v.exp && v.exp < Date.now()) return null;
    return v;
  }
  get('/daftar/sukses', (req, res) => {
    const base = req.BASE;
    const data = takeSuccess(req.query.get('t'));
    const kodeUrl = String(req.query.get('kode') || '').trim().toUpperCase().slice(0, 4);
    const usernameUrl = String(req.query.get('u') || '').trim();
    if (!data && !kodeUrl) return res.redirect(base + '/login?err=' + encodeURIComponent('Halaman kredensial pendaftaran sudah kedaluwarsa. Silakan masuk dengan kode sekolah Anda.'));
    const kode = data ? data.kode : kodeUrl;
    const username = data ? data.username : (usernameUrl || '-');
    const sekolah = data ? data.sekolah : '';
    const nama = data ? data.nama : '';
    const pwd = data ? data.password : '';
    res.html(authShell({
      base,
      sideTitle: 'Pendaftaran berhasil!',
      sideDesc: 'Simpan kredensial di samping, lalu masuk ke dashboard keuangan sekolah Anda.',
      content: `
      <div class="auth-login-head">
        <div class="auth-logo-ph" style="background:#DCFCE7;color:#15803D">${ui.icon('check')}</div>
        <div class="auth-welcome">Sekolah berhasil didaftarkan</div>
        <div class="small muted">${lib.esc(nama || 'Administrator Sekolah')}${sekolah ? ' · ' + lib.esc(sekolah) : ''}</div>
      </div>
      <div class="alert ok">${ui.icon('check')}<div>Akun sekolah sudah aktif. <b>Simpan kredensial</b> berikut untuk masuk kembali kapan saja.</div></div>
      <div class="cred-box">
        <div class="cred-row">
          <div><div class="cred-lbl">Kode Sekolah</div>
            <div class="cred-val mono" data-cred="kode">${lib.esc(kode)}</div></div>
          <button type="button" class="btn btn-sm" data-copy="${lib.esc(kode)}">${ui.icon('file')}Salin</button>
        </div>
        <div class="cred-row">
          <div><div class="cred-lbl">Username</div>
            <div class="cred-val mono" data-cred="user">${lib.esc(username)}</div></div>
          <button type="button" class="btn btn-sm" data-copy="${lib.esc(username)}">${ui.icon('file')}Salin</button>
        </div>
        <div class="cred-row">
          <div><div class="cred-lbl">Password</div>
            <div class="cred-val mono" data-cred="pwd" data-pw>${pwd ? '•'.repeat(pwd.length) : '(password yang Anda pilih saat mendaftar)'}</div></div>
          ${pwd ? `<div class="flex" style="gap:6px">
            <button type="button" class="btn btn-sm" data-pw-toggle>${ui.icon('eye')}Lihat</button>
            <button type="button" class="btn btn-sm" data-copy="${lib.esc(pwd)}">${ui.icon('file')}Salin</button></div>` : ''}
        </div>
      </div>
      <p class="help" style="margin-top:10px">Demi keamanan, password hanya ditampilkan sekali di halaman ini. Bila lupa, minta Administrator Pusat meresetnya.</p>
      <a class="btn btn-primary btn-block" href="${base}/login?kode=${lib.esc(kode)}" style="margin-top:6px">${ui.icon('login')}Masuk ke Dashboard Sekolah</a>
      <p class="small muted" style="margin-top:14px;text-align:center">Alamat masuk: <b>${base}/login</b></p>`
    }));
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
    const u = dbm.mainDb.prepare('SELECT * FROM users WHERE id=?').get(req.user.id) || req.user;
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
