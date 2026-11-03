'use strict';
const X = require('../xlsx-read');
const fs = require('fs');
const path = require('path');
const envCfg = require('../env');
const bd = require('../backupdata');
const gdrive = require('../gdrive');

module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can, permissionMatrix, uploadMedia }) => {
  const { db } = dbm;
  const { esc, rupiah, tglID, nowStamp } = lib;
  // daftar tabel & pembentuk ZIP backup dipakai bersama dengan integrasi Google Drive
  const TABLES = bd.TABLES;
  const csvOf = rows => bd.csvOf(rows);
  const dumpAll = () => bd.dumpAll(db);

  /* ------------------------------------------------------------------
     EXPORT DATABASE (.sql) — dump SQL portabel, bisa diimpor ke
     SQLite/MySQL (dengan penyesuaian tipe) di hosting lain.
     ------------------------------------------------------------------ */
  function sqlValue(v) {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
    if (Buffer.isBuffer(v)) return "X'" + v.toString('hex') + "'";
    return "'" + String(v).replace(/'/g, "''") + "'";
  }
  function sqlDump() {
    const out = [];
    out.push('-- ================================================================');
    out.push('-- SIMKEU Sekolah — Export Database');
    out.push('-- Dibuat: ' + nowStamp());
    out.push('-- Berkas ini berisi struktur + seluruh isi tabel (portabel).');
    out.push('-- Impor: sqlite3 keuangan.sqlite < database.sql');
    out.push('-- ================================================================');
    out.push('PRAGMA foreign_keys=OFF;');
    out.push('BEGIN TRANSACTION;');
    const objs = db.prepare(`SELECT type,name,sql FROM sqlite_master
      WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
      ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name`).all();
    for (const o of objs) {
      if (o.type === 'table') out.push(`DROP TABLE IF EXISTS "${o.name}";`);
      if (o.type === 'index') out.push(`DROP INDEX IF EXISTS "${o.name}";`);
    }
    const tables = objs.filter(o => o.type === 'table');
    for (const o of tables) out.push(o.sql.trim() + ';');
    for (const o of objs) if (o.type !== 'table') out.push(o.sql.trim() + ';');
    let total = 0;
    for (const o of tables) {
      let rows = [];
      try { rows = db.prepare(`SELECT * FROM "${o.name}"`).all(); } catch (e) { continue; }
      if (!rows.length) continue;
      const cols = Object.keys(rows[0]);
      const colSql = cols.map(c => `"${c}"`).join(',');
      for (const r of rows) {
        out.push(`INSERT INTO "${o.name}" (${colSql}) VALUES (${cols.map(c => sqlValue(r[c])).join(',')});`);
        total++;
      }
    }
    out.push('COMMIT;');
    out.push(`-- total ${total} baris dari ${tables.length} tabel`);
    return { sql: out.join('\n') + '\n', rows: total, tables: tables.length };
  }

  /* ------------------------------------------------------------------
     DOWNLOAD SOURCE CODE (.zip) — seluruh berkas program aplikasi
     (kode server, routes, aset publik, tes, dokumentasi). Berkas
     rahasia (.env) & database TIDAK disertakan.
     ------------------------------------------------------------------ */
  const SRC_INCLUDE_FILES = [
    'server.js', 'env.js', 'db.js', 'lib.js', 'ui.js', 'wa.js', 'xlsx-read.js',
    'importer.js', 'impcache.js', 'printcfg.js', 'package.json', 'package-lock.json',
    '.env.example', '.gitignore', 'AGENTS.md', 'README.md'
  ];
  const SRC_INCLUDE_DIRS = ['routes', 'public', 'dev-tests'];
  const SRC_EXCLUDE_FILES = new Set(['.env', '.env.local', '.vibecoder-media-token']);
  const SRC_EXCLUDE_DIRS = new Set(['node_modules', '.git', 'data', '.cache', '.vscode']);
  const MAX_SRC_BYTES = 3 * 1024 * 1024;
  function collectSource() {
    const files = [];
    const root = path.join(__dirname, '..');
    const put = (abs, rel) => {
      try {
        const st = fs.statSync(abs);
        if (!st.isFile() || st.size > MAX_SRC_BYTES) return;
        files.push({ name: rel.replace(/\\/g, '/'), data: fs.readFileSync(abs) });
      } catch (e) { }
    };
    const walk = (dirAbs, dirRel) => {
      let entries = [];
      try { entries = fs.readdirSync(dirAbs, { withFileTypes: true }); } catch (e) { return; }
      for (const en of entries) {
        const abs = path.join(dirAbs, en.name);
        const rel = dirRel ? dirRel + '/' + en.name : en.name;
        if (en.isDirectory()) {
          if (SRC_EXCLUDE_DIRS.has(en.name)) continue;
          walk(abs, rel);
        } else if (en.isFile()) {
          if (SRC_EXCLUDE_FILES.has(en.name)) continue;
          if (/\.(sqlite|sqlite3|db)(-wal|-shm)?$/i.test(en.name)) continue;
          if (/^\.tmp-/.test(en.name)) continue;
          put(abs, rel);
        }
      }
    };
    for (const f of SRC_INCLUDE_FILES) {
      const abs = path.join(root, f);
      if (fs.existsSync(abs)) put(abs, f);
    }
    for (const d of SRC_INCLUDE_DIRS) {
      const abs = path.join(root, d);
      if (fs.existsSync(abs)) walk(abs, d);
    }
    return files;
  }

  function modalCollector() {
    const list = [];
    const put = (id, opts) => { list.push(ui.modal(id, opts)); return ''; };
    put.html = () => list.join('');
    return put;
  }

  const ACTION_LABEL = { view: 'Lihat', create: 'Tambah', edit: 'Edit', delete: 'Hapus', approve: 'Approval', export: 'Export' };

  /* ================= PENGGUNA & HAK AKSES ================= */
  get('/pengguna', (req, res) => {
    guard(req, res, 'pengguna', 'view');
    const c = ctx(req);
    const users = db.prepare('SELECT * FROM users ORDER BY id').all();
    const matrix = permissionMatrix();
    const editU = req.query.get('edit') ? db.prepare('SELECT * FROM users WHERE id=?').get(req.query.get('edit')) : null;
    const totalAktif = users.filter(u => u.aktif).length;
    const late = modalCollector();

    const userForm = (u, mid) => `<form method="post" action="${c.base}/pengguna/save" id="f${mid}">
      <input type="hidden" name="id" value="${u ? u.id : ''}">
      <div class="row2">
        <div class="field"><label>Nama Lengkap</label><input name="nama" value="${esc(u ? u.nama : '')}" required></div>
        <div class="field"><label>Email</label><input type="email" name="email" value="${esc(u ? u.email : '')}" required></div>
      </div>
      <div class="row2">
        <div class="field"><label>Role</label><select name="role">
          ${Object.entries(dbm.ROLE_LABEL).map(([k, v]) => `<option value="${k}" ${u && u.role === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
        </select>
        <div class="hint">Role <b>Akun Demo</b> memakai database dummy terpisah (sandbox) dan tidak dapat mengubah kata sandinya sendiri.</div></div>
        <div class="field"><label>Jabatan</label><input name="jabatan" value="${esc(u ? u.jabatan : '')}" placeholder="Bendahara / Staf TU"></div>
      </div>
      <div class="field"><label>Password ${u ? '(kosongkan jika tidak diubah)' : ''}</label><input type="password" name="password" minlength="6" ${u ? '' : 'required'} placeholder="Minimal 6 karakter"></div>
      <div class="field"><label>Foto Pengguna (opsional)</label>
        <div class="flex" style="gap:14px;align-items:flex-start">
          <div style="text-align:center">
            <div data-avatar-preview="foto_b64_${mid}">${ui.avatar(u || { nama: '?' }, 'avatar avatar-lg')}</div>
            <div class="avatar-preview-note" style="font-size:10.5px">Pratinjau</div>
          </div>
          <div style="flex:1">
            <input type="hidden" name="foto_b64" id="foto_b64_${mid}">
            <input type="file" accept="image/*" data-avatar="foto_b64_${mid}" data-max="5">
            <div class="avatar-pos" data-avatar-pos="foto_b64_${mid}" style="display:${u && u.foto ? 'flex' : 'none'}">
              <span class="small muted" style="align-self:center;margin-right:2px">Posisi:</span>
              <button type="button" data-pos="0">Atas</button>
              <button type="button" data-pos="0.5" class="on">Tengah</button>
              <button type="button" data-pos="1">Bawah</button>
            </div>
            <div class="hint" id="foto_b64_${mid}-info">${u && u.foto ? 'Foto sudah ada — unggah baru untuk mengganti.' : 'JPG/PNG maks 5 MB, otomatis dipotong persegi.'}</div>
          </div>
        </div></div>
      <label class="check"><input type="checkbox" name="aktif" value="1" ${!u || u.aktif ? 'checked' : ''}> Akun aktif (dapat login)</label>
    </form>`;

    const matrixTable = role => {
      let rows = '';
      for (const m of dbm.MODULES) {
        rows += `<tr><td class="t-strong">${esc(m.label)}</td>`;
        for (const a of dbm.ACTIONS) {
          const key = `${role}|${m.key}|${a}`;
          const allowed = (matrix[key] || 0) === 1;
          rows += `<td class="chkcell"><input type="checkbox" name="p_${role}_${m.key}_${a}" value="1" data-role="${role}" data-mod="${m.key}" ${allowed ? 'checked' : ''} ${c.can('pengguna', 'edit') ? '' : 'disabled'}></td>`;
        }
        rows += '</tr>';
      }
      return `<div class="card mb-3">
        <div class="card-head"><div><h3>${esc(dbm.ROLE_LABEL[role])}</h3><div class="sub">Hak akses per modul · ${role === 'kepala_sekolah' ? 'read-only + approval + export laporan'
        : role === 'demo' ? 'database dummy terpisah · pilih menu yang boleh dicoba akun demo'
          : 'hanya input transaksi pada BKU aktif'}</div></div>
          <label class="check small">${c.can('pengguna', 'edit') ? `<input type="checkbox" data-toggle-col="${role}" ${'title="Centang / hapus semua untuk role ini"'}> Pilih semua` : ''}</label></div>
        <div class="table-wrap"><table class="matrix"><thead><tr><th>Modul</th>${dbm.ACTIONS.map(a => `<th class="center">${ACTION_LABEL[a]}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody></table></div></div>`;
    };

    const content = `
    <div class="kpi-grid mb-3" style="grid-template-columns:repeat(3,minmax(0,1fr))">
      <div class="kpi ic-orange"><div class="ico">${ui.icon('users')}</div><div class="lbl">Total Pengguna</div><div class="val" style="font-size:20px">${users.length}</div></div>
      <div class="kpi ic-green"><div class="ico">${ui.icon('check')}</div><div class="lbl">Akun Aktif</div><div class="val" style="font-size:20px">${totalAktif}</div></div>
      <div class="kpi ic-blue"><div class="ico">${ui.icon('shield')}</div><div class="lbl">Role Terdefinisi</div><div class="val" style="font-size:20px">${Object.keys(dbm.ROLE_LABEL).length}</div></div>
    </div>

    <div class="card mb-3">
      <div class="card-head"><div><h3>Daftar Pengguna</h3><div class="sub">Kelola akun, role, dan status aktif</div></div>
        <div class="toolbar">
          <input placeholder="Cari nama / email" data-table-search="#tblUser" style="width:220px">
          ${c.can('pengguna', 'create') ? ui.openModalBtn('mAddUser', 'Tambah Pengguna') : ''}
        </div></div>
      <div class="table-wrap sticky-head"><table id="tblUser"><thead><tr><th>Nama</th><th>Email</th><th>Role</th><th>Status</th><th>Login Terakhir</th><th class="right">Aksi</th></tr></thead><tbody>
        ${users.map(u => `<tr>
          <td><div class="flex">${ui.avatar(u)}
            <div><div class="t-strong">${esc(u.nama)}</div><div class="t-sub">${esc(u.jabatan || '-')}</div></div></div></td>
          <td>${esc(u.email)}</td>
          <td>${ui.badge(dbm.ROLE_LABEL[u.role] || u.role, u.role === 'super_admin' ? 'orange' : u.role === 'kepala_sekolah' ? 'blue' : 'gray')}</td>
          <td>${u.aktif ? ui.badge('Aktif', 'green') : ui.badge('Nonaktif', 'red')}</td>
          <td class="t-sub">${esc(u.last_login || 'Belum pernah')}</td>
          <td class="right nowrap">
            <button class="btn btn-sm" data-open="mRole${u.id}" ${c.can('pengguna', 'edit') ? '' : 'disabled'}>${ui.icon('shield')}Role</button>
            <a class="btn btn-sm btn-icon" href="${c.base}/pengguna?edit=${u.id}" title="Edit">${ui.icon('edit')}</a>
            ${c.can('pengguna', 'delete') && u.id !== req.user.id ? `<form method="post" action="${c.base}/pengguna/delete" style="display:inline" data-confirm="Hapus pengguna ${esc(u.nama)}?"><input type="hidden" name="id" value="${u.id}"><button class="btn btn-sm btn-danger">${ui.icon('trash')}</button></form>` : ''}
          </td></tr>
          ${late('mRole' + u.id, {
      title: 'Ubah Role Pengguna',
      body: `<div class="kv mb-2"><dt>Nama</dt><dd>${esc(u.nama)}</dd><dt>Email</dt><dd>${esc(u.email)}</dd></div>
        <form method="post" action="${c.base}/pengguna/role" id="fr${u.id}"><input type="hidden" name="id" value="${u.id}">
        <div class="field"><label>Role Baru</label><select name="role">${Object.entries(dbm.ROLE_LABEL).map(([k, v]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
        <div class="field"><label>Status Akun</label><select name="aktif"><option value="1" ${u.aktif ? 'selected' : ''}>Aktif</option><option value="0" ${!u.aktif ? 'selected' : ''}>Nonaktif</option></select></div></form>`,
      footer: `<button class="btn" data-close="mRole${u.id}">Batal</button><button class="btn btn-primary" form="fr${u.id}">Simpan</button>`
    })}`).join('')}
      </tbody></table></div>
      ${late.html()}
    </div>

    <div class="between mb-2"><div><h3>Pengaturan Hak Akses per Role (Permission Matrix)</h3>
      <div class="sub muted small">Super Admin / Bendahara Utama selalu memiliki akses penuh. Ubah centang lalu simpan.</div></div></div>
    <form method="post" action="${c.base}/pengguna/permissions">
      ${matrixTable('kepala_sekolah')}
      ${matrixTable('staff')}
      ${matrixTable('demo')}
      <div class="alert info" style="margin:12px 0 0">${ui.icon('shield')}<div><b>Akun Demo (Sandbox).</b>
        Pengguna dengan role <b>Akun Demo</b> masuk ke <b>database dummy terpisah</b> — semua transaksi, iuran, honor &amp; pengaturan yang mereka ubah
        <b>tidak memengaruhi data sekolah</b>. Centang modul/menu yang boleh mereka akses pada tabel <b>Akun Demo</b> di atas
        (modul sistem seperti Pengguna, Identitas Sekolah, Backup &amp; Audit diblokir secara bawaan).
        Kata sandi akun demo hanya dapat diatur admin melalui tombol Edit pada daftar pengguna — akun demo tidak bisa mengubah sandinya sendiri.</div></div>
      ${c.can('pengguna', 'edit') ? `<div class="form-actions" style="border:0"><button class="btn btn-primary">${ui.icon('save')}Simpan Permission Matrix</button></div>` : ''}
    </form>

    <div class="card mt-3">
      <div class="card-head"><div><h3>Pengaturan Sistem</h3><div class="sub">Ambang approval, nominal tunjangan &amp; registrasi</div></div>
        <div class="toolbar">
          <a class="btn btn-sm btn-primary" href="${c.base}/tarif-honor" title="Pengaturan Nominal Tunjangan &amp; Honor">${ui.icon('wallet')}Nominal Tunjangan &amp; Honor</a>
          <a class="btn btn-sm" href="${c.base}/tampilan-menu">${ui.icon('menu')}Pengaturan Tampilan Navigation / Menu</a>
        </div></div>
      <form method="post" action="${c.base}/pengguna/settings">
        <div class="row2">
          <div class="field"><label>Batas Nominal Pengeluaran yang Butuh Approval (Rp)</label>
            ${ui.moneyInput('approval_threshold', dbm.getSetting('approval_threshold', '5000000'))}
            <div class="hint">Pengeluaran di atas nominal ini berstatus <b>Pending</b> sampai disetujui Kepala Sekolah.</div></div>
          <div class="field"><label>Registrasi Akun</label>
            <input value="Ditutup — akun dibuat oleh Super Admin" readonly>
            <div class="hint">Pendaftaran mandiri dari halaman login sudah tidak tersedia.</div></div>
        </div>
        <hr class="sep">
        <div class="t-strong mb-1">Portal Publik &amp; OTP WhatsApp</div>
        <div class="row2">
          <div class="field"><label>Portal Cek Tagihan Siswa</label>
            <label class="check"><input type="checkbox" name="portal_aktif" value="1" ${dbm.getSetting('portal_aktif', '1') === '1' ? 'checked' : ''}> Aktifkan portal tagihan siswa (orang tua)</label>
            <div class="hint">Alamat: <a href="${c.base}/${dbm.portalSlugs().siswa}" target="_blank">${c.base}/${dbm.portalSlugs().siswa}</a>
              — ubah di menu <a href="${c.base}/sekolah">Identitas Sekolah</a></div></div>
          <div class="field"><label>Portal Pegawai</label>
            <label class="check"><input type="checkbox" name="portal_pegawai_aktif" value="1" ${dbm.getSetting('portal_pegawai_aktif', '1') === '1' ? 'checked' : ''}> Aktifkan portal piutang pegawai</label>
            <div class="hint">Alamat: <a href="${c.base}/${dbm.portalSlugs().pegawai}" target="_blank">${c.base}/${dbm.portalSlugs().pegawai}</a></div>
            <label class="check"><input type="checkbox" name="portal_slip_aktif" value="1" ${dbm.getSetting('portal_slip_aktif', '1') === '1' ? 'checked' : ''}> Aktifkan portal slip gaji pegawai</label>
            <div class="hint">Alamat: <a href="${c.base}/${dbm.portalSlugs().slip}" target="_blank">${c.base}/${dbm.portalSlugs().slip}</a></div></div>
        </div>
        <div class="row2">
          <div class="field"><label>URL Gateway WhatsApp (OTP)</label>
            <input name="wa_api_url" value="${esc(dbm.getSetting('wa_api_url', ''))}" placeholder="https://api.fonnte.com/send">
            <div class="hint">Endpoint HTTP POST pengirim pesan WhatsApp (mis. Fonnte / Wablas / gateway internal).</div></div>
          <div class="field"><label>Token / API Key Gateway</label>
            <input name="wa_api_token" value="${esc(dbm.getSetting('wa_api_token', ''))}" placeholder="token rahasia">
            <div class="hint">Dikirim sebagai header <code>Authorization</code>. Kosongkan bila gateway tidak memerlukan token.</div></div>
        </div>
        <div class="row2">
          <div class="field"><label>Format Body Gateway</label>
            <select name="wa_api_payload">
              <option value="form" ${dbm.getSetting('wa_api_payload', 'form') === 'form' ? 'selected' : ''}>form-urlencoded (target, message)</option>
              <option value="json" ${dbm.getSetting('wa_api_payload', 'form') === 'json' ? 'selected' : ''}>JSON (target, message)</option>
            </select></div>
          <div class="field"><label>Mode Uji Tanpa Gateway</label>
            <label class="check"><input type="checkbox" name="wa_demo_tampil" value="1" ${dbm.getSetting('wa_demo_tampil', '1') === '1' ? 'checked' : ''}> Tampilkan kode OTP di layar bila gateway belum diatur</label>
            <div class="hint">Untuk pengujian. <b>Matikan</b> setelah gateway WhatsApp aktif agar kode tidak tampil ke publik.</div></div>
        </div>
        <div class="alert info">${ui.icon('info')}<div>Kode OTP 4 digit dikirim ke nomor WhatsApp pada <b>master Data Pegawai</b>.
          Pastikan setiap pegawai memiliki <b>tanggal lahir</b> &amp; <b>nomor WhatsApp aktif</b> agar dapat memakai portal.</div></div>
        <div class="form-actions" style="border:0"><button class="btn btn-primary">${ui.icon('save')}Simpan Pengaturan</button></div>
      </form>
    </div>

    ${ui.modal('mAddUser', {
      title: 'Tambah Pengguna Baru', body: userForm(null, 'mAddUser'),
      footer: `<button class="btn" data-close="mAddUser">Batal</button><button class="btn btn-primary" form="fmAddUser">Simpan</button>`
    })}
    ${editU ? ui.modal('mEditUser', {
      title: 'Edit Pengguna', body: userForm(editU, 'mEditUser'),
      footer: `<button class="btn" data-close="mEditUser">Batal</button><button class="btn btn-primary" form="fmEditUser">Simpan</button>`
    }).replace('class="modal" id="mEditUser"', 'class="modal show" id="mEditUser"') : ''}`;
    page(req, res, { title: 'Pengguna & Hak Akses', sub: 'Manajemen akun, role, dan permission matrix', active: 'pengguna', content });
  });

  post('/pengguna/save', async (req, res) => {
    if (!guard(req, res, 'pengguna', req.body.id ? 'edit' : 'create')) return;
    const { id, nama, email, role, jabatan, password, aktif } = req.body;
    if (!nama || !email) return res.redirect(req.BASE + '/pengguna?err=' + encodeURIComponent('Nama dan email wajib diisi.'));
    const dup = db.prepare('SELECT id FROM users WHERE lower(email)=lower(?) AND id<>?').get(String(email).trim(), id || 0);
    if (dup) return res.redirect(req.BASE + '/pengguna?err=' + encodeURIComponent('Email sudah dipakai pengguna lain.'));
    let fotoUrl = null;
    if (req.body.foto_b64) {
      try {
        const m = String(req.body.foto_b64).match(/^data:(image\/[^;]+);base64,/);
        if (!m) throw new Error('Berkas foto tidak valid.');
        const ext = (m[1].split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
        fotoUrl = await uploadMedia(req.body.foto_b64, `foto-user-${Date.now()}.${ext}`);
      } catch (e) {
        return res.redirect(req.BASE + '/pengguna?err=' + encodeURIComponent('Gagal mengunggah foto: ' + e.message));
      }
    }
    if (id) {
      db.prepare('UPDATE users SET nama=?,email=?,role=?,jabatan=?,aktif=? WHERE id=?')
        .run(nama, email, role, jabatan || '', aktif ? 1 : 0, id);
      if (fotoUrl) db.prepare('UPDATE users SET foto=? WHERE id=?').run(fotoUrl, id);
      if (password) db.prepare('UPDATE users SET password=? WHERE id=?').run(lib.hashPassword(password), id);
      if (Number(id) === req.user.id && !aktif) {
        dbm.logAudit(req.user, 'EDIT', 'pengguna', 'Menonaktifkan akun sendiri');
      }
      dbm.logAudit(req.user, 'EDIT', 'pengguna', `Edit pengguna ${email} (role ${role})${password ? ', password direset' : ''}`);
    } else {
      if (!password || String(password).length < 6) return res.redirect(req.BASE + '/pengguna?err=' + encodeURIComponent('Password minimal 6 karakter.'));
      db.prepare('INSERT INTO users (nama,email,password,role,aktif,jabatan,created_at,foto) VALUES (?,?,?,?,?,?,?,?)')
        .run(nama, email, lib.hashPassword(password), role || 'staff', aktif ? 1 : 0, jabatan || '', nowStamp(), fotoUrl);
      dbm.logAudit(req.user, 'TAMBAH', 'pengguna', `Tambah pengguna ${email} (role ${role})`);
    }
    res.redirect(req.BASE + '/pengguna?ok=' + encodeURIComponent('Data pengguna disimpan.'));
  });

  post('/pengguna/role', (req, res) => {
    if (!guard(req, res, 'pengguna', 'edit')) return;
    const { id, role, aktif } = req.body;
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if (!u) return res.redirect(req.BASE + '/pengguna?err=' + encodeURIComponent('Pengguna tidak ditemukan.'));
    if (u.role === 'super_admin' && role !== 'super_admin') {
      const admins = db.prepare("SELECT COUNT(*) c FROM users WHERE role='super_admin' AND aktif=1").get().c;
      if (admins <= 1) return res.redirect(req.BASE + '/pengguna?err=' + encodeURIComponent('Tidak bisa mengubah role Super Admin terakhir.'));
    }
    db.prepare('UPDATE users SET role=?, aktif=? WHERE id=?').run(role, aktif === '1' ? 1 : 0, id);
    dbm.logAudit(req.user, 'EDIT', 'pengguna', `Mengubah role ${u.email}: ${u.role} → ${role}, status ${aktif === '1' ? 'aktif' : 'nonaktif'}`);
    res.redirect(req.BASE + '/pengguna?ok=' + encodeURIComponent('Role pengguna diperbarui.'));
  });

  post('/pengguna/delete', (req, res) => {
    if (!guard(req, res, 'pengguna', 'delete')) return;
    if (String(req.body.id) === String(req.user.id)) return res.redirect(req.BASE + '/pengguna?err=' + encodeURIComponent('Anda tidak dapat menghapus akun sendiri.'));
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.body.id);
    if (u && u.role === 'super_admin') {
      const admins = db.prepare("SELECT COUNT(*) c FROM users WHERE role='super_admin'").get().c;
      if (admins <= 1) return res.redirect(req.BASE + '/pengguna?err=' + encodeURIComponent('Tidak bisa menghapus Super Admin terakhir.'));
    }
    db.prepare('DELETE FROM users WHERE id=?').run(req.body.id);
    dbm.logAudit(req.user, 'HAPUS', 'pengguna', `Menghapus pengguna ${u ? u.email : req.body.id}`);
    res.redirect(req.BASE + '/pengguna?ok=' + encodeURIComponent('Pengguna dihapus.'));
  });

  post('/pengguna/permissions', (req, res) => {
    if (!guard(req, res, 'pengguna', 'edit')) return;
    db.transaction(() => {
      const upd = db.prepare('INSERT INTO permissions (role,module,action,allowed) VALUES (?,?,?,?) ON CONFLICT(role,module,action) DO UPDATE SET allowed=excluded.allowed');
      for (const role of ['kepala_sekolah', 'staff', 'demo']) {
        for (const m of dbm.MODULES) {
          for (const a of dbm.ACTIONS) {
            const val = req.body[`p_${role}_${m.key}_${a}`] ? 1 : 0;
            upd.run(role, m.key, a, val);
          }
        }
      }
    })();
    dbm.logAudit(req.user, 'EDIT', 'pengguna', 'Memperbarui permission matrix role Kepala Sekolah, Staff & Akun Demo');
    res.redirect(req.BASE + '/pengguna?ok=' + encodeURIComponent('Permission matrix diperbarui.'));
  });

  post('/pengguna/settings', (req, res) => {
    if (!guard(req, res, 'pengguna', 'edit')) return;
    const ambang = lib.parseMoney(req.body.approval_threshold);
    dbm.setSetting('approval_threshold', String(ambang));
    if (req.body.wa_api_url !== undefined) {
      dbm.setSetting('wa_api_url', String(req.body.wa_api_url || '').trim());
      dbm.setSetting('wa_api_token', String(req.body.wa_api_token || '').trim());
      dbm.setSetting('wa_api_payload', req.body.wa_api_payload === 'json' ? 'json' : 'form');
      dbm.setSetting('wa_demo_tampil', req.body.wa_demo_tampil ? '1' : '0');
      dbm.setSetting('portal_aktif', req.body.portal_aktif ? '1' : '0');
      dbm.setSetting('portal_pegawai_aktif', req.body.portal_pegawai_aktif ? '1' : '0');
      dbm.setSetting('portal_slip_aktif', req.body.portal_slip_aktif ? '1' : '0');
    }
    dbm.logAudit(req.user, 'EDIT', 'pengguna', `Pengaturan sistem: ambang approval Rp ${ambang}${req.body.wa_api_url !== undefined ? ' + portal publik & gateway WhatsApp' : ''}`);
    res.redirect(req.BASE + '/pengguna?ok=' + encodeURIComponent('Pengaturan sistem disimpan.'));
  });

  /* ================= PENGATURAN TAMPILAN MENU (SIDEBAR) ================= */
  get('/tampilan-menu', (req, res) => {
    guard(req, res, 'pengguna', 'view');
    const c = ctx(req);
    if (req.query.get('reset') === '1' && c.can('pengguna', 'edit')) {
      dbm.setMainSetting('nav_hidden', '');
      dbm.setNavUiGlobal({});
      dbm.logAudit(req.user, 'EDIT', 'pengguna', 'Pengaturan tampilan menu: semua menu ditampilkan & urutan dikembalikan ke bawaan');
      return res.redirect(req.BASE + '/tampilan-menu?ok=' + encodeURIComponent('Semua menu ditampilkan kembali (urutan, judul & ikon kembali ke bawaan).'));
    }
    const hidden = ui.navVisibility(dbm.mainSetting('nav_hidden', ''));
    const uiCfg = dbm.navUiGlobal();
    const canEdit = c.can('pengguna', 'edit');
    const catalog = ui.navOrdered(uiCfg);
    const totalItems = catalog.reduce((s, g) => s + g.items.length, 0);
    const shown = totalItems - catalog.reduce((s, g) => s + g.items.filter(i => hidden.has(i.href)).length, 0);
    let idx = 0;
    const groupsHtml = catalog.map((g, gi) => {
      const items = g.items.map(it => {
        const i = idx++;
        const orig = (ui.NAV.find(x => x.id === g.id) || { items: [] }).items.find(x => x.href === it.href) || {};
        return `<tr class="drag-row" draggable="true" data-href="${esc(it.href)}" data-group="${esc(g.id)}">
          <td class="drag-cell"><span class="drag-handle" title="Tarik untuk menggeser posisi">⋮⋮</span>
            <span class="row-num" data-rownum>${i + 1}</span></td>
          <td class="center"><input type="checkbox" name="show" value="${esc(it.href)}" data-check-group="nav" ${hidden.has(it.href) ? '' : 'checked'} ${canEdit ? '' : 'disabled'}></td>
          <td class="menu-ico-cell">
            <input type="hidden" name="h_${i}" value="${esc(it.href)}">
            <input type="hidden" name="ico_${i}" id="ico_${i}" value="">
            <input type="hidden" name="ico_lama_${i}" value="${esc(it.iconUrl || '')}">
            <div class="menu-ico-preview" data-ico-preview="${i}">${it.iconUrl
            ? `<img src="${esc(it.iconUrl)}" alt="" onerror="this.remove()">`
            : ui.icon(orig.icon || it.icon || 'info')}</div>
            ${canEdit ? `<div class="menu-ico-tools">
              <input type="file" accept="image/png" data-b64="ico_${i}" data-max="2" data-ico-input="${i}" title="Unggah ikon PNG">
              ${it.iconUrl ? `<label class="check xs"><input type="checkbox" name="rm_ico_${i}" value="1"> hapus</label>` : ''}
            </div>` : ''}
          </td>
          <td><div class="t-strong">${esc(orig.label || it.label)}</div>
            <div class="t-sub mono">${esc(it.href)}${orig.activeKey ? ` · kunci: ${esc(orig.activeKey)}` : ''}</div></td>
          <td>${canEdit ? `<input name="lbl_${i}" value="${esc(it.label)}" maxlength="60" placeholder="${esc(orig.label || '')}" class="menu-label-input">` : esc(it.label)}</td>
          <td class="right nowrap">${canEdit ? `<button type="button" class="btn btn-sm btn-icon" data-row-up title="Naikkan">▲</button>
            <button type="button" class="btn btn-sm btn-icon" data-row-down title="Turunkan">▼</button>` : ''}</td>
        </tr>`;
      }).join('');
      const shownInGroup = g.items.filter(i => !hidden.has(i.href)).length;
      return `<div class="card mb-2 menu-group" draggable="${canEdit ? 'true' : 'false'}" data-groupid="${esc(g.id)}" data-goi="${gi}">
        <div class="card-head">
          <div class="flex" style="gap:10px">
            ${canEdit ? `<span class="drag-handle group-handle" title="Tarik untuk menggeser kelompok menu">⋮⋮</span>` : ''}
            <div><h3>${esc(g.group)}</h3><div class="sub">${g.items.length} menu · ${shownInGroup} ditampilkan</div></div>
          </div>
          ${canEdit ? `<div class="toolbar">
            <button type="button" class="btn btn-sm btn-icon" data-group-up title="Naikkan kelompok">▲</button>
            <button type="button" class="btn btn-sm btn-icon" data-group-down title="Turunkan kelompok">▼</button>
            <button type="button" class="btn btn-sm" data-menu-all="1">${ui.icon('check')}Tampilkan</button>
            <button type="button" class="btn btn-sm" data-menu-none="1">${ui.icon('x')}Sembunyikan</button>
          </div>` : ''}
        </div>
        <div class="table-wrap"><table class="menu-tbl"><thead><tr>
          <th style="width:74px">Urutan</th><th style="width:52px" class="center">Tampil</th>
          <th style="width:190px">Ikon (PNG)</th><th>Menu Asli</th><th style="width:260px">Judul Tampilan</th><th class="right" style="width:110px">Geser</th>
        </tr></thead><tbody>${items}</tbody></table></div>
      </div>`;
    }).join('');

    const content = `<div class="alert info mb-2">${ui.icon('info')}<div><b>Kelola tampilan menu.</b>
      Geser baris (drag &amp; drop) atau pakai tombol ▲▼ untuk mengubah <b>posisi menu</b>, ubah <b>judul tampilan</b> di kolom kanan,
      dan unggah <b>ikon PNG</b> pengganti. Centang <b>Tampil</b> untuk menampilkan menu. Perubahan berlaku untuk semua pengguna
      (hak akses per role tetap berlaku).</div></div>
    <form method="post" action="${c.base}/tampilan-menu" id="fMenu">
      <input type="hidden" name="nav_order" id="nav_order" value="">
      <input type="hidden" name="group_order" id="group_order" value="">
      <div class="card mb-3">
        <div class="card-head"><div><h3>Ringkasan Tampilan Menu</h3><div class="sub">${shown} dari ${totalItems} menu ditampilkan</div></div>
          ${canEdit ? `<div class="toolbar">
            <label class="check small"><input type="checkbox" data-check-group-box="nav" ${hidden.size === 0 ? 'checked' : ''}> Pilih semua menu</label>
            <a class="btn btn-sm" href="${c.base}/tampilan-menu?reset=1">${ui.icon('refresh')}Reset ke Bawaan</a>
          </div>` : ''}</div>
        <div class="help">Rekomendasi ikon: berkas <b>PNG persegi 64 × 64 px</b> (maksimal 2 MB, latar transparan) agar tajam di layar Retina.
          Ikon SVG bawaan tetap dipakai bila tidak ada ikon PNG.</div>
        ${canEdit ? `<div class="form-actions" style="margin-top:8px"><button class="btn btn-primary">${ui.icon('save')}Simpan Pengaturan Tampilan</button></div>` : ''}
      </div>
      ${groupsHtml}
      ${canEdit ? `<div class="form-actions"><button class="btn btn-primary">${ui.icon('save')}Simpan Pengaturan Tampilan</button></div>` : ''}
    </form>`;
    page(req, res, { title: 'Pengaturan Tampilan Menu', sub: 'Geser posisi, ubah judul & ikon PNG setiap menu', active: 'tampilan_menu', content });
  });

  post('/tampilan-menu', async (req, res) => {
    if (!guard(req, res, 'pengguna', 'edit')) return;
    const catalog = ui.navOrdered(dbm.navUiGlobal());
    const all = ui.navCatalog().flatMap(g => g.items.map(i => i.href));
    const shown = new Set([].concat(req.body.show || []).map(String));
    const hidden = all.filter(h => !shown.has(h));

    // urutan & judul: field berindeks (h_0..h_n, lbl_0..) mengikuti urutan DOM
    const rows = [];
    for (let i = 0; req.body['h_' + i] !== undefined; i++) {
      const href = String(req.body['h_' + i] || '');
      if (!href) continue;
      rows.push({ href, label: String(req.body['lbl_' + i] || '').trim().slice(0, 60), idx: i });
    }
    const orderHrefs = String(req.body.nav_order || '').split(',').map(s => s.trim()).filter(Boolean);
    const orderFinal = orderHrefs.length ? orderHrefs : rows.map(r => r.href);
    // bila field h_ tidak ikut terkirim (mis. pengiriman programatik), pakai urutan nav_order
    if (!rows.length) {
      orderFinal.forEach((href, i) => rows.push({ href, label: String(req.body['lbl_' + i] || '').trim().slice(0, 60), idx: i }));
    }

    const order = {};
    orderFinal.forEach((href, i) => { if (all.includes(href)) order[href] = i + 1; });

    const groupOrderRaw = String(req.body.group_order || '').split(',').map(s => s.trim()).filter(Boolean);
    const groups = {};
    (groupOrderRaw.length ? groupOrderRaw : ui.navCatalog().map(g => g.id)).forEach((gid, i) => { groups[gid] = i + 1; });

    const orig = new Map(ui.navCatalog().flatMap(g => g.items.map(it => [it.href, it])));
    const labels = {};
    const icons = {};
    let gagal = '';
    for (const r of rows) {
      const o = orig.get(r.href);
      if (o && r.label && r.label !== o.label) labels[r.href] = r.label;
      const lama = String(req.body['ico_lama_' + r.idx] || '');
      let url = req.body['rm_ico_' + r.idx] ? '' : lama;
      const b64 = String(req.body['ico_' + r.idx] || '');
      if (b64 && !gagal) {
        try {
          if (!/^data:image\/png;base64,/i.test(b64)) throw new Error('Ikon harus berkas PNG.');
          url = await uploadMedia(b64, `ikon-menu-${r.href.replace(/[^\w]/g, '') || 'x'}-${Date.now()}.png`);
        } catch (e) { gagal = e.message; }
      }
      if (url) icons[r.href] = url;
    }
    dbm.setNavUiGlobal({ order, groups, labels, icons });
    dbm.setMainSetting('nav_hidden', hidden.join(','));
    dbm.logAudit(req.user, 'EDIT', 'pengguna',
      `Pengaturan tampilan menu: ${all.length - hidden.length}/${all.length} menu ditampilkan, ${Object.keys(labels).length} judul diubah, ${Object.keys(icons).length} ikon kustom`);
    const msg = `Pengaturan tampilan menu disimpan.${gagal ? ' Sebagian ikon gagal diunggah: ' + gagal : ''}`;
    res.redirect(req.BASE + '/tampilan-menu?' + (gagal ? 'warn=' : 'ok=') + encodeURIComponent(msg));
  });

  /* ================= AUDIT LOG ================= */
  get('/audit', (req, res) => {
    guard(req, res, 'audit', 'view');
    const c = ctx(req);
    const mod = req.query.get('mod') || '';
    const q = req.query.get('q') || '';
    let sql = 'SELECT * FROM audit WHERE 1=1';
    const args = [];
    if (mod) { sql += ' AND modul=?'; args.push(mod); }
    if (q) { sql += ' AND (user_nama LIKE ? OR detail LIKE ? OR aksi LIKE ?)'; args.push('%' + q + '%', '%' + q + '%', '%' + q + '%'); }
    sql += ' ORDER BY id DESC LIMIT 400';
    const rows = db.prepare(sql).all(...args);
    const mods = db.prepare('SELECT DISTINCT modul FROM audit ORDER BY modul').all().map(r => r.modul);
    const tone = aksi => /HAPUS|TOLAK/.test(aksi) ? 'red' : /SETUJUI|LOGIN/.test(aksi) ? 'green' : /TUTUP|BUKA/.test(aksi) ? 'amber' : 'blue';
    const content = `<div class="card">
      <div class="card-head"><div><h3>Log Aktivitas Sistem</h3><div class="sub">Jejak audit: siapa, kapan, tindakan apa</div></div>
        <form method="get" action="${c.base}/audit" class="toolbar">
          <input name="q" value="${esc(q)}" placeholder="Cari user / detail" style="width:200px">
          <select name="mod"><option value="">Semua Modul</option>${mods.map(m => `<option value="${esc(m)}" ${mod === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>
          <button class="btn">${ui.icon('search')}Filter</button>
        </form></div>
      <div class="table-wrap sticky-head"><table><thead><tr><th style="width:150px">Waktu</th><th>Pengguna</th><th>Tindakan</th><th>Modul</th><th>Detail</th></tr></thead><tbody>
        ${rows.map(a => `<tr><td class="nowrap t-sub">${esc(a.created_at)}</td><td class="t-strong">${esc(a.user_nama || '-')}</td>
          <td>${ui.badge(a.aksi, tone(a.aksi), 'plain')}</td><td class="t-sub">${esc(a.modul)}</td><td>${esc(a.detail)}</td></tr>`).join('')
        || '<tr><td colspan="5" class="center muted">Belum ada aktivitas tercatat.</td></tr>'}
      </tbody></table></div>
      <p class="help mt-2">Menampilkan maksimal 400 aktivitas terbaru. Log tidak dapat dihapus dari aplikasi demi akuntabilitas.</p>
    </div>`;
    page(req, res, { title: 'Audit Log', sub: 'Rekam jejak aktivitas pengguna', active: 'audit', content });
  });

  /* ================= BACKUP & RESTORE ================= */
  get('/backup', (req, res) => {
    guard(req, res, 'backup', 'view');
    const c = ctx(req);
    const counts = TABLES.map(t => {
      try { return { t, n: db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c }; } catch (e) { return { t, n: 0 }; }
    });
    const backups = db.prepare("SELECT * FROM audit WHERE aksi IN ('BACKUP','RESTORE') ORDER BY id DESC LIMIT 6").all();
    const content = `<div class="split">
      <div class="card">
        <div class="card-head"><div><h3>Backup Menyeluruh — Database &amp; Source Code</h3><div class="sub">Satu berkas ZIP berisi seluruh basis data website + rekap CSV</div></div>
          <div class="toolbar">
            <a class="btn btn-sm btn-primary" href="${c.base}/pengaturan-backup">${ui.icon('cloud')}Pengaturan Backup (Google Drive)</a>
          </div></div>
        <div class="alert info">${ui.icon('info')}<div>Berkas ZIP memuat <b>seluruh basis data</b>: akun &amp; hak akses, BKU umum/kegiatan, transaksi, aset &amp; pinjaman, payroll, piutang, SPP &amp; beasiswa, nota (tautan), serta log aktivitas. Nama berkas otomatis memakai tanggal ekspor.</div></div>
        <div class="alert ${gdrive.isConfigured(dbm) ? 'ok' : 'warn'}">${ui.icon(gdrive.isConfigured(dbm) ? 'check' : 'alert')}<div><b>Auto-Backup Cloud:</b>
          ${gdrive.isConfigured(dbm)
        ? `terhubung ke Google Drive, jadwal <b>${esc(gdrive.scheduleTimes(dbm).join(' & '))}</b> setiap hari${dbm.getSetting('gdrive_auto', '1') === '1' ? '' : ' (jadwal otomatis sedang dinonaktifkan)'}.`
        : 'belum dikonfigurasi. Isi kredensial Service Account &amp; Folder ID pada menu Pengaturan Backup.'}</div></div>
        <div class="table-wrap mb-2"><table><thead><tr><th>Tabel</th><th class="num">Jumlah baris</th></tr></thead><tbody>
          ${counts.map(x => `<tr><td class="mono">${esc(x.t)}</td><td class="num">${x.n}</td></tr>`).join('')}
        </tbody></table></div>
        <a class="btn btn-primary btn-block" href="${c.base}/backup/download-zip" ${c.can('backup', 'create') ? '' : 'disabled'}>${ui.icon('download')}Backup Database Keseluruhan (.ZIP)</a>
        <div class="row2 mt-2">
          <a class="btn btn-block" href="${c.base}/backup/export-database" ${c.can('backup', 'create') ? '' : 'disabled'}>${ui.icon('database')}Export Database (.sql)</a>
          <a class="btn btn-block" href="${c.base}/backup/download-source" ${c.can('backup', 'create') ? '' : 'disabled'}>${ui.icon('download')}Download Source Code (.zip)</a>
        </div>
        <a class="btn btn-block mt-1" href="${c.base}/backup/download" ${c.can('backup', 'create') ? '' : 'disabled'}>${ui.icon('download')}Unduh Backup (.json)</a>
        <div class="alert warn mt-2">${ui.icon('alert')}<div><b>Export Database (.sql)</b> berisi struktur + seluruh isi tabel sebagai perintah SQL — cocok untuk migrasi ke hosting/VPS lain.
          <b>Download Source Code</b> memuat seluruh kode program (server, routes, aset publik, tes, dokumentasi) <b>tanpa</b> database, <code>node_modules</code>, dan berkas rahasia <code>.env</code>. Sertakan <code>.env.example</code> lalu isi kredensial di server baru.</div></div>
      </div>
      <div>
        <div class="card mb-3">
          <div class="card-head"><div><h3>Konfigurasi Lingkungan (.env)</h3><div class="sub">Portable — pindah hosting tanpa mengubah kode</div></div></div>
          <div class="alert info">${ui.icon('info')}<div>Kredensial database, API key WhatsApp, endpoint media, dan URL domain dibaca dari variabel lingkungan.
            Buat berkas <code>.env</code> di folder aplikasi (contoh lengkap: <code>.env.example</code>). Nilai dari <code>.env</code> diutamakan di atas pengaturan di halaman ini.</div></div>
          <div class="table-wrap"><table class="env-tbl"><thead><tr><th>Variabel</th><th>Nilai aktif</th><th>Keterangan</th></tr></thead><tbody>
            ${envCfg.describe().map(x => `<tr>
              <td>${esc(x.key)}</td>
              <td class="${x.fromEnv ? 'env-on' : 'env-off'}">${esc(String(x.value || '(kosong)'))}${x.fromEnv ? '' : ' <span class="t-sub">(default/pengaturan)</span>'}</td>
              <td class="t-sub">${esc(x.note)}</td></tr>`).join('')}
          </tbody></table></div>
          <p class="help mt-1">Berkas <code>.env</code> tidak disertakan pada Download Source Code (aman dari kebocoran kredensial).</p>
        </div>
        <div class="card mb-3">
          <div class="card-head"><div><h3>Restore Data</h3><div class="sub">Pulihkan dari berkas ZIP / JSON cadangan</div></div></div>
          <div class="alert warn">${ui.icon('alert')}<div><b>Peringatan:</b> restore akan <b>mengganti seluruh data</b> saat ini dengan isi berkas cadangan. Buat backup terbaru terlebih dahulu. Sistem otomatis menyimpan snapshot pra-restore.</div></div>
          <form method="post" action="${c.base}/backup/restore" data-confirm="PERINGATAN: seluruh data saat ini akan diganti dengan isi berkas backup. Lanjutkan restore?">
            <input type="hidden" name="file_b64" id="file_b64">
            <div class="field"><label>Berkas Backup (.zip / .json)</label>
              <input type="file" accept=".zip,.json,application/zip,application/json" data-b64="file_b64" data-max="30">
              <div class="hint" id="file_b64-info">Format ZIP hasil tombol Backup Database Keseluruhan, atau berkas .json lama.</div></div>
            <label class="check mb-2"><input type="checkbox" name="konfirmasi" value="1" required> Saya memahami seluruh data akan digantikan</label>
            <button class="btn btn-danger btn-block" ${c.can('backup', 'restore') ? '' : 'disabled'}>${ui.icon('upload')}Restore Data dari File ZIP</button>
          </form>
        </div>
        <div class="card mb-3">
          <div class="card-head"><div><h3>Data Contoh</h3><div class="sub">Untuk uji coba tampilan</div></div></div>
          <p class="small muted">Memuat contoh transaksi, anggaran, piutang, dan SPP. Hanya dapat dijalankan bila belum ada transaksi.</p>
          <form method="post" action="${c.base}/demo/seed" data-confirm="Muat data contoh ke dalam aplikasi?">
            <button class="btn btn-block" ${c.can('backup', 'create') ? '' : 'disabled'}>Muat Data Contoh</button>
          </form>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Riwayat Backup / Restore</h3><div class="sub">6 aktivitas terakhir</div></div></div>
          ${backups.length ? `<div class="list">${backups.map(b => `<div class="list-row"><div class="dot-s" style="background:var(--o-500)"></div>
            <div><div class="nm">${esc(b.aksi)}</div><div class="mt">${esc(b.created_at)} · ${esc(b.user_nama)}</div></div></div>`).join('')}</div>`
        : '<div class="help">Belum ada riwayat.</div>'}
        </div>
      </div>
    </div>`;
    page(req, res, { title: 'Backup & Restore', sub: 'Cadangan dan pemulihan data keuangan', active: 'backup', content });
  });

  get('/backup/download', (req, res) => {
    if (!guard(req, res, 'backup', 'create')) return;
    const dump = dumpAll();
    dbm.logAudit(req.user, 'BACKUP', 'backup', `Mengunduh backup data keuangan JSON (${new Date().toISOString().slice(0, 10)})`);
    const name = `backup-simkeu-${nowStamp().replace(/[^\d]/g, '')}.json`;
    res.file(Buffer.from(JSON.stringify(dump, null, 1), 'utf8'), name, 'application/json');
  });

  get('/backup/download-zip', (req, res) => {
    if (!guard(req, res, 'backup', 'create')) return;
    const dump = dumpAll();
    const files = [
      { name: 'database.json', data: JSON.stringify(dump, null, 1) },
      {
        name: 'README.txt', data: [
          'BACKUP DATABASE SIMKEU SEKOLAH',
          'Dibuat: ' + nowStamp(),
          '',
          'database.json  = salinan lengkap seluruh tabel (dipakai untuk Restore Data).',
          'data/*.csv     = rekap tiap tabel dalam format CSV untuk pemeriksaan manual.',
          '',
          'Cara restore: menu Pengaturan / Backup & Restore → Restore Data dari File ZIP → pilih berkas ini.',
          'PERINGATAN: restore mengganti seluruh data yang ada saat ini.'
        ].join('\r\n')
      }
    ];
    for (const t of TABLES) {
      const rows = dump.tables[t] || [];
      files.push({ name: `data/${t}.csv`, data: csvOf(rows) });
    }
    const buf = lib.zip(files);
    const stamp = nowStamp().slice(0, 10).replace(/-/g, '');
    const rowsCount = TABLES.reduce((s, t) => s + (dump.tables[t] || []).length, 0);
    dbm.logAudit(req.user, 'BACKUP', 'backup', `Membuat backup database keseluruhan (.zip): ${rowsCount} baris dari ${TABLES.length} tabel`);
    res.file(buf, `backup-simkeu-${stamp}.zip`, 'application/zip');
  });

  /** Export database penuh sebagai perintah SQL (portabel untuk hosting lain) */
  get('/backup/export-database', (req, res) => {
    if (!guard(req, res, 'backup', 'create')) return;
    const dump = sqlDump();
    dbm.logAudit(req.user, 'EXPORT DATABASE', 'backup', `Export database .sql: ${dump.rows} baris dari ${dump.tables} tabel`);
    const stamp = nowStamp().slice(0, 10).replace(/-/g, '');
    res.file(Buffer.from(dump.sql, 'utf8'), `simkeu-database-${stamp}.sql`, 'application/sql; charset=utf-8');
  });

  /** Download source code aplikasi (.zip) — tanpa database, node_modules, dan .env */
  get('/backup/download-source', (req, res) => {
    if (!guard(req, res, 'backup', 'create')) return;
    const files = collectSource();
    const readme = [
      'SIMKEU SEKOLAH — SOURCE CODE APLIKASI',
      'Dibuat: ' + nowStamp(),
      '',
      'Isi berkas:',
      '  server.js, db.js, lib.js, ui.js, wa.js, env.js, xlsx-read.js, importer.js, impcache.js, printcfg.js',
      '  routes/     = seluruh modul halaman & proses',
      '  public/     = aset CSS & JS',
      '  dev-tests/  = skrip pengujian otomatis (node dev-tests/regress.js)',
      '  package.json & package-lock.json',
      '  .env.example = contoh konfigurasi lingkungan',
      '',
      'CARA PASANG DI VPS / HOSTING BARU',
      '  1. Salin seluruh isi ZIP ke folder aplikasi.',
      '  2. npm install   (butuh better-sqlite3 versi 12.9.0).',
      '  3. Salin .env.example menjadi .env lalu isi DB_PATH, APP_BASE_URL,',
      '     APP_MEDIA_URL/APP_MEDIA_TOKEN, dan WA_API_URL/WA_API_TOKEN.',
      '  4. Pindahkan berkas database hasil menu "Export Database (.sql)" atau',
      '     "Backup Database Keseluruhan (.ZIP)" ke folder data/.',
      '  5. Jalankan: npm start   (port mengikuti variabel PORT).',
      '',
      'CATATAN: database, node_modules, dan berkas .env sengaja TIDAK disertakan.',
      'Gunakan menu Backup & Restore untuk memindahkan data keuangan.'
    ].join('\r\n');
    files.push({ name: 'README-SOURCE.txt', data: readme });
    const buf = lib.zip(files);
    const stamp = nowStamp().slice(0, 10).replace(/-/g, '');
    dbm.logAudit(req.user, 'DOWNLOAD SOURCE', 'backup', `Mengunduh source code aplikasi (.zip): ${files.length} berkas`);
    res.file(buf, `simkeu-source-${stamp}.zip`, 'application/zip');
  });

  post('/backup/restore', (req, res) => {
    if (!guard(req, res, 'backup', 'restore')) return;
    if (!req.body.konfirmasi) return res.redirect(req.BASE + '/backup?err=' + encodeURIComponent('Centang konfirmasi terlebih dahulu.'));
    let data;
    try {
      const raw = String(req.body.file_b64 || '');
      const b64 = raw.includes(',') ? raw.split(',').pop() : raw;
      const buf = Buffer.from(b64, 'base64');
      if (!buf.length) throw new Error('Berkas kosong.');
      if (buf[0] === 0x50 && buf[1] === 0x4b) {
        // berkas ZIP hasil "Backup Database Keseluruhan"
        const files = X.unzipEntries(buf);
        let entry = files['database.json'] || files['data/database.json'];
        if (!entry) {
          const key = Object.keys(files).find(n => /(^|\/)database\.json$/i.test(n));
          if (key) entry = files[key];
        }
        if (!entry) throw new Error('database.json tidak ditemukan di dalam ZIP.');
        data = JSON.parse(entry.toString('utf8'));
      } else {
        data = JSON.parse(buf.toString('utf8'));
      }
    } catch (e) {
      return res.redirect(req.BASE + '/backup?err=' + encodeURIComponent('Berkas backup tidak valid atau gagal dibaca: ' + e.message));
    }
    if (!data || data.app !== 'simkeu-sekolah' || !data.tables) {
      return res.redirect(req.BASE + '/backup?err=' + encodeURIComponent('Format berkas bukan backup SIMKEU Sekolah.'));
    }
    // safety snapshot before overwrite
    try {
      const snap = { app: 'simkeu-sekolah', version: 1, created_at: nowStamp(), tables: {} };
      for (const t of TABLES) snap.tables[t] = db.prepare(`SELECT * FROM ${t}`).all();
      const dir = require('path').dirname(dbm.DB_PATH || require('path').join(__dirname, '..', 'data', 'keuangan.sqlite'));
      const fsp = require('fs');
      fsp.writeFileSync(require('path').join(dir, `pre-restore-${Date.now()}.json`), JSON.stringify(snap));
      // simpan maksimal 3 snapshot pra-restore, hapus yang paling lama
      const snaps = fsp.readdirSync(dir).filter(x => x.startsWith('pre-restore-')).sort();
      while (snaps.length > 3) {
        try { fsp.unlinkSync(require('path').join(dir, snaps.shift())); } catch (e) { }
      }
    } catch (e) { }

    let restored = 0;
    db.transaction(() => {
      for (const t of TABLES) {
        if (!Array.isArray(data.tables[t])) continue;
        db.prepare(`DELETE FROM ${t}`).run();
        const rows = data.tables[t];
        if (!rows.length) continue;
        const cols = Object.keys(rows[0]).filter(k => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k));
        const stmt = db.prepare(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
        for (const row of rows) {
          stmt.run(cols.map(c => row[c] === undefined ? null : row[c]));
          restored++;
        }
      }
      // pastikan minimal ada super admin
      if (!db.prepare("SELECT COUNT(*) c FROM users WHERE role='super_admin'").get().c) {
        db.prepare('INSERT INTO users (nama,email,password,role,aktif,jabatan,created_at) VALUES (?,?,?,?,1,?,?)')
          .run('Bendahara Utama', 'admin@sekolah.sch.id', lib.hashPassword('admin123'), 'super_admin', 'Bendahara Utama', nowStamp());
      }
    })();
    // sesi lama dihapus agar konsisten dengan data pengguna hasil restore
    db.prepare('DELETE FROM sessions').run();
    dbm.logAudit(null, 'RESTORE', 'backup', `Restore data dari berkas backup (${restored} baris)`);
    res.set('Set-Cookie', 'simkeu_sid=; Path=/; Max-Age=0');
    res.redirect(req.BASE + '/login?ok=' + encodeURIComponent('Restore berhasil. Silakan masuk kembali.'));
  });
};
