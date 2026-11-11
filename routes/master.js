'use strict';

module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can, uploadMedia, saas, refreshPortalMap, flashUrl }) => {
  const { db } = dbm;
  const { esc, rupiah, tglID, todayISO, nowStamp, num } = lib;
  /* daftar BKU standar — hanya cadangan saat instalasi belum punya tahun ajaran lain
     (penambahan TA baru selalu MENYALIN daftar BKU dari tahun ajaran sebelumnya). */
  const BKU_STD_UMUM = ['BKU Umum', 'Buku Kas Pembantu Bank', 'Buku Pembantu Pajak', 'Buku Pembantu Tunai', 'Rekapitulasi Barang Habis Pakai', 'Barang Modal'];
  const BKU_STD_KEGIATAN = ['BKU UKK', 'BKU PKL', 'BKU SPMB', 'BKU Bantuan', 'BKU PSTS Ganjil', 'BKU PSTS Genap', 'BKU ASAS', 'BKU ASAT', 'BKU PSAJ', 'Dana Sosial', 'Infak Jumat'];

  /** kumpulkan modal agar dirender DI LUAR tabel (form di dalam <table> akan dipecah parser HTML) */
  function modalCollector() {
    const list = [];
    const put = (id, opts) => { list.push(ui.modal(id, opts)); return ''; };
    put.html = () => list.join('');
    return put;
  }

  /* ================= PENGATURAN NOMINAL TUNJANGAN & HONOR ================= */
  get('/tarif-honor', (req, res) => {
    guard(req, res, 'sekolah', 'view');
    const c = ctx(req);
    const ro = !c.can('sekolah', 'edit');
    const s = c.settings;
    const row = (label, name, val, hint) => `<div class="field"><label>${esc(label)}</label>
      ${ui.moneyInput(name, val, ro ? 'readonly' : '')}
      <div class="hint">${hint}</div></div>`;
    const sert = dbm.sertifikasiJam(), pemb = dbm.honorPembantuJam(), wali = dbm.honorWaliJam();
    const content = `<div class="split">
      <div class="card">
        <div class="card-head"><div><h3>Pengaturan Nominal Tunjangan &amp; Honor</h3>
          <div class="sub">Tarif per jam yang dipakai otomatis pada Leger Honor &amp; Slip Gaji</div></div>
          ${ro ? ui.badge('Hanya Lihat', 'gray') : ui.badge('Berlaku otomatis', 'green')}</div>
        <form method="post" action="${c.base}/tarif-honor">
          <div class="alert info">${ui.icon('info')}<div>Semua komponen di bawah dihitung <b>otomatis</b> dari jumlah jam yang diisi pada leger
            (kolom jam), lalu dikalikan tarif per jam di halaman ini. Perubahan tarif langsung dipakai pada perhitungan berikutnya.</div></div>
          <div class="row2">
            ${row('Tarif Standar Tugas Tambahan (Rp / Jam)', 'honor_tugas_jam', s.honor_tugas_jam || 50000,
              'Tarif cadangan bila nominal Pembantu Kepsek / Wali Kelas dikosongkan.')}
            ${row('Sertifikasi (Rp / Jam)', 'sertifikasi_per_jam', s.sertifikasi_per_jam || 12500,
              `Total Sertifikasi = <b>Jumlah Jam Sertifikasi × ${rupiah(sert)}</b>`)}
          </div>
          <div class="row2">
            ${row('Pembantu Kepsek (Rp / Jam)', 'honor_pembantu_jam', s.honor_pembantu_jam || 50000,
              `Total Pembantu Kepsek = <b>Jumlah Jam × ${rupiah(pemb)}</b>`)}
            ${row('Wali Kelas (Rp / Jam)', 'honor_wali_jam', s.honor_wali_jam || 50000,
              `Total Wali Kelas = <b>Jumlah Jam × ${rupiah(wali)}</b>`)}
          </div>
          <div class="alert warn">${ui.icon('alert')}<div>Nilai tarif <b>0 / kosong</b> akan diabaikan dan dikembalikan ke nilai bawaan
            (Sertifikasi Rp 12.500 · Pembantu Kepsek &amp; Wali Kelas Rp 50.000).</div></div>
          ${ro ? '' : `<div class="form-actions"><button class="btn btn-primary">${ui.icon('save')}Simpan Pengaturan</button></div>`}
        </form>
        <hr class="sep">
        <div class="small muted">Seluruh tarif per jam (tugas tambahan, sertifikasi, pembantu kepsek &amp; wali kelas) hanya diatur di halaman ini
          — tidak ada lagi kolom ganda pada Identitas Sekolah.
          Contoh: 84 jam sertifikasi × ${rupiah(sert)} = <b>${rupiah(84 * sert)}</b>.</div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Ringkasan Pemakaian Tarif</h3><div class="sub">Periode leger yang tersimpan</div></div></div>
        ${(() => {
          const periode = (dbm.payrollPeriods() || [])[0];
          if (!periode) return ui.emptyState('Belum ada leger', 'Buat draf leger honor terlebih dahulu.');
          const tot = dbm.payrollTotals(periode);
          return `<div class="kv">
            <dt>Periode terbaru</dt><dd><b>${esc(dbm.periodeLabel(periode))}</b></dd>
            <dt>Total jam sertifikasi</dt><dd>${String(Math.round((tot.jamSertifikasi || 0) * 100) / 100).replace('.', ',')} jam</dd>
            <dt>Nominal sertifikasi</dt><dd>${rupiah(tot.sertifikasi)}</dd>
            <dt>Pembantu Kepsek</dt><dd>${rupiah(tot.pembantuKepsek)} (${tot.jamPembantu} jam)</dd>
            <dt>Wali Kelas</dt><dd>${rupiah(tot.waliKelas)} (${tot.jamWali} jam)</dd>
          </div>
          <a class="btn btn-sm mt-2" href="${c.base}/payroll?periode=${periode}">${ui.icon('eye')}Buka Leger Honor</a>`;
        })()}
      </div>
    </div>`;
    page(req, res, { title: 'Pengaturan Nominal Tunjangan & Honor', sub: 'Tarif per jam sertifikasi, pembantu kepsek & wali kelas', active: 'tarif_honor', content });
  });

  post('/tarif-honor', (req, res) => {
    if (!guard(req, res, 'sekolah', 'edit')) return;
    const set = (key, def) => {
      if (req.body[key] === undefined) return;
      const v = lib.parseMoney(req.body[key]);
      dbm.setSetting(key, v > 0 ? v : def);
    };
    set('sertifikasi_per_jam', 12500);
    set('honor_pembantu_jam', 50000);
    set('honor_wali_jam', 50000);
    set('honor_tugas_jam', 50000);
    dbm.logAudit(req.user, 'EDIT', 'sekolah',
      `Nominal tunjangan & honor: sertifikasi ${rupiah(dbm.sertifikasiJam())}/jam, pembantu kepsek ${rupiah(dbm.honorPembantuJam())}/jam, wali kelas ${rupiah(dbm.honorWaliJam())}/jam`);
    res.redirect(req.BASE + '/tarif-honor?ok=' + encodeURIComponent('Pengaturan nominal tunjangan & honor disimpan.'));
  });

  /* ================= TEMA & BRANDING APLIKASI ================= */
  const PALET_TEMA = [
    ['#F97316', 'Oranye (bawaan)'], ['#4F46E5', 'Indigo'], ['#0EA5E9', 'Biru Langit'],
    ['#10B981', 'Hijau Emerald'], ['#EF4444', 'Merah'], ['#8B5CF6', 'Violet'],
    ['#D946EF', 'Magenta'], ['#0F766E', 'Teal'], ['#B45309', 'Cokelat Emas']
  ];
  get('/tema', (req, res) => {
    guard(req, res, 'sekolah', 'view');
    const c = ctx(req);
    const ro = !c.can('sekolah', 'edit');
    const tema = dbm.temaWarnaGlobal();
    const appNama = dbm.appNamaGlobal();
    // sub-judul: isian sekolah (kosong = ikuti Branding Sistem Super Admin)
    const appSub = dbm.appSub();
    const subDefault = (saas && saas.appSub ? saas.appSub() : "") || dbm.APP_SUB_DEFAULT;
    const appLogo = dbm.appLogoGlobal();
    const modeNow = String(dbm.getSetting('mode_tema', 'light')) === 'dark' ? 'dark' : 'light';
    const content = `<div class="split">
      <div class="card">
        <div class="card-head"><div><h3>Tema Warna Aplikasi</h3><div class="sub">Warna dasar tampilan (tombol, menu aktif, grafik &amp; aksen)</div></div>
          ${ro ? ui.badge('Hanya Lihat', 'gray') : ui.badge('Berlaku seketika', 'green')}</div>
        <form method="post" action="${c.base}/tema">
          <div class="field"><label>Warna Dasar</label>
            <div class="flex" style="gap:12px;flex-wrap:wrap">
              <input type="color" name="tema_warna" value="${esc(tema)}" ${ro ? 'disabled' : ''} data-tema-pick style="width:64px;height:44px;padding:3px;border-radius:10px">
              <input type="text" name="tema_hex" value="${esc(tema)}" maxlength="7" ${ro ? 'readonly' : ''} data-tema-hex style="width:140px;font-family:ui-monospace,monospace">
              <span class="small muted">Pilih warna bebas atau pakai salah satu palet di bawah.</span>
            </div></div>
          <div class="field"><label>Palet Cepat</label>
            <div class="toolbar" style="gap:8px;flex-wrap:wrap">
              ${PALET_TEMA.map(([hex, nm]) => `<button type="button" class="btn btn-sm" data-tema-set="${hex}" title="${esc(nm)}" ${ro ? 'disabled' : ''}>
                <span style="display:inline-block;width:14px;height:14px;border-radius:4px;background:${hex};margin-right:6px;vertical-align:-2px"></span>${esc(nm)}</button>`).join('')}
            </div></div>
          <hr class="sep">
          <div class="card-head" style="padding:0 0 8px"><div><h3>Mode Tampilan</h3>
            <div class="sub">Pilih tampilan terang atau gelap untuk seluruh halaman aplikasi</div></div>
            ${modeNow === 'dark' ? ui.badge('Mode Gelap', 'gray') : ui.badge('Mode Terang', 'green')}</div>
          <div class="radio-cards" style="grid-template-columns:1fr 1fr">
            <input type="radio" id="modeLight" name="mode_tema" value="light" ${modeNow !== 'dark' ? 'checked' : ''} ${ro ? 'disabled' : ''}>
            <label for="modeLight"><span class="dot"></span>☀️ Mode Terang (Light)</label>
            <input type="radio" id="modeDark" name="mode_tema" value="dark" ${modeNow === 'dark' ? 'checked' : ''} ${ro ? 'disabled' : ''}>
            <label for="modeDark"><span class="dot"></span>🌙 Mode Gelap (Dark)</label>
          </div>
          <div class="hint" style="margin-top:8px">Mode gelap memakai latar gelap kontras tinggi pada dashboard, tabel, formulir,
            dan portal publik. Dokumen cetak tetap putih agar hasil cetak/PDF tidak berubah.</div>
          <hr class="sep">
          <div class="card-head" style="padding:0 0 8px"><div><h3>Nama Aplikasi</h3><div class="sub">Tampil pada bilah samping, judul tab browser &amp; halaman login</div></div></div>
          <div class="field"><label>Nama Aplikasi</label>
            <input name="app_nama" value="${esc(appNama)}" maxlength="60" ${ro ? 'readonly' : ''} placeholder="SIMKEU Sekolah">
            <div class="hint">Nama sekolah pada kop surat tetap diatur pada menu <a href="${c.base}/sekolah">Identitas Sekolah</a>.</div></div>
          <div class="field"><label>Teks Sub-Judul (baris kecil di bawah nama aplikasi)</label>
            <input name="app_sub" value="${esc(appSub)}" maxlength="60" ${ro ? 'readonly' : ''} placeholder="${esc(subDefault)}">
            <div class="hint">Contoh: <b>Sistem Keuangan</b>, <b>Sistem Informasi Sekolah</b>, atau motto sekolah.
              Kosongkan untuk memakai default dari Super Admin: <b>${esc(subDefault)}</b>.</div></div>
          <div class="preview-theme">
            <div class="pt-card">
              <div class="pt-title">Pratinjau Warna</div>
              <div class="pt-row"><span class="btn btn-primary btn-sm">Tombol Utama</span><span class="btn btn-sm">Tombol</span>
                <span class="badge orange">Lencana</span></div>
              <div class="pt-bar"><i></i></div>
            </div>
          </div>
          ${ro ? '' : `<div class="form-actions"><button class="btn btn-primary">${ui.icon('save')}Simpan Tema &amp; Nama</button></div>`}
        </form>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Logo Aplikasi</h3><div class="sub">Menggantikan ikon bawaan pada bilah samping &amp; halaman login</div></div></div>
        <div class="center" style="padding:14px 0 18px">
          ${appLogo ? `<img src="${esc(appLogo)}" alt="Logo aplikasi" width="150" height="150" loading="lazy" decoding="async" style="max-width:150px;max-height:150px;object-fit:contain;background:#fff;border-radius:16px;padding:8px;border:1px solid var(--line)">`
        : `<div class="brand-mark" style="margin:0 auto;width:64px;height:64px;border-radius:18px">${ui.icon('wallet')}</div>
              <p class="help mt-2">Belum ada logo aplikasi khusus — ikon bawaan dipakai.</p>`}
        </div>
        ${ro ? '' : `<form method="post" action="${c.base}/tema/logo">
          <input type="hidden" name="logo_b64" id="app_logo_b64">
          <input type="hidden" name="logo_b64_small" id="app_logo_b64_small">
          <div class="field"><label>Pilih berkas logo</label>
            <input type="file" accept="image/png,image/jpeg,image/svg+xml" data-b64="app_logo_b64" data-thumb="1" data-max="5">
            <div class="hint" id="app_logo_b64-info">Rekomendasi <b>512 × 512 px</b> (PNG transparan) agar tajam di semua ukuran. Maks 5 MB.</div></div>
          <button class="btn btn-primary btn-block">${ui.icon('upload')}Unggah Logo Aplikasi</button>
        </form>
        ${appLogo ? `<form method="post" action="${c.base}/tema/logo" data-confirm="Hapus logo aplikasi dan kembalikan ikon bawaan?"><input type="hidden" name="hapus" value="1">
          <button class="btn btn-danger btn-block mt-1">${ui.icon('trash')}Hapus Logo Aplikasi</button></form>` : ''}`}
        <hr class="sep">
        <div class="small muted">Logo <b>sekolah</b> (untuk kop surat &amp; favicon) diatur terpisah pada menu Identitas Sekolah.
          Menu dapat digeser &amp; diganti judulnya di <a href="${c.base}/tampilan-menu">Pengaturan Tampilan Menu</a>.</div>
      </div>
    </div>`;
    page(req, res, { title: 'Tema & Branding Aplikasi', sub: 'Warna dasar, nama & logo aplikasi', active: 'tema', content });
  });

  post('/tema', (req, res) => {
    if (!guard(req, res, 'sekolah', 'edit')) return;
    const raw = String(req.body.tema_warna || req.body.tema_hex || '').trim();
    const hex = /^#?[0-9a-fA-F]{6}$/.test(raw) ? ('#' + raw.replace('#', '')).toUpperCase() : null;
    if (!hex) return res.redirect(req.BASE + '/tema?err=' + encodeURIComponent('Kode warna tidak valid. Gunakan format #RRGGBB.'));
    dbm.setSetting('tema_warna', hex);
    if (req.body.mode_tema !== undefined) {
      dbm.setSetting('mode_tema', String(req.body.mode_tema) === 'dark' ? 'dark' : 'light');
    }
    if (req.body.app_nama !== undefined) {
      const nm = String(req.body.app_nama || '').trim().slice(0, 60);
      dbm.setSetting('app_nama', nm || 'SIMKEU Sekolah');
    }
    // sub-judul bilah samping: kosong = ikuti default Branding Sistem (Super Admin)
    if (req.body.app_sub !== undefined) {
      dbm.setSetting('app_sub', String(req.body.app_sub || '').replace(/\s+/g, ' ').trim().slice(0, 60));
    }
    dbm.logAudit(req.user, 'EDIT', 'sekolah', `Tema aplikasi diperbarui: warna ${hex}, mode ${String(dbm.getSetting('mode_tema', 'light')) === 'dark' ? 'gelap' : 'terang'}, nama "${dbm.appNama()}", sub-judul "${dbm.appSub() || '(default sistem)'}"`);
    res.redirect(req.BASE + '/tema?ok=' + encodeURIComponent('Tema, nama & sub-judul aplikasi disimpan.'));
  });

  post('/tema/logo', async (req, res) => {
    if (!guard(req, res, 'sekolah', 'edit')) return;
    if (req.body.hapus) {
      dbm.setSetting('app_logo', '');
      dbm.setSetting('app_logo_small', '');
      dbm.logAudit(req.user, 'EDIT', 'sekolah', 'Menghapus logo aplikasi kustom');
      return res.redirect(req.BASE + '/tema?ok=' + encodeURIComponent('Logo aplikasi dihapus.'));
    }
    if (!req.body.logo_b64) return res.redirect(req.BASE + '/tema?err=' + encodeURIComponent('Pilih berkas logo terlebih dahulu.'));
    try {
      const m = String(req.body.logo_b64).match(/^data:(image\/[^;]+);base64,/);
      if (!m) throw new Error('Berkas bukan gambar yang valid.');
      const ext = (m[1].split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
      const url = await uploadMedia(req.body.logo_b64, `logo-aplikasi-${Date.now()}.${ext}`);
      dbm.setSetting('app_logo', url);
      if (req.body.logo_b64_small) {
        try { dbm.setSetting('app_logo_small', await uploadMedia(req.body.logo_b64_small, `logo-aplikasi-kecil-${Date.now()}.webp`)); } catch (e) { }
      }
      dbm.logAudit(req.user, 'EDIT', 'sekolah', 'Mengunggah logo aplikasi kustom');
      res.redirect(req.BASE + '/tema?ok=' + encodeURIComponent('Logo aplikasi diperbarui.'));
    } catch (e) {
      res.redirect(req.BASE + '/tema?err=' + encodeURIComponent(e.message));
    }
  });

  /* ================= IDENTITAS SEKOLAH ================= */
  const isEmail = v => !v || /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v);
  /* Website diisi TANPA "https://" (contoh: www.sekolah.sch.id). Protokol ditambahkan
     otomatis saat disimpan; keduanya tetap diterima agar data lama tidak rusak. */
  const URL_BARE_RE = /^(?=.{3,190}$)([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d{2,5})?(?:\/[^\s]*)?$/i;
  const isUrl = v => {
    const t = String(v || '').trim();
    if (!t) return true;
    if (/^https?:\/\//i.test(t)) return URL_BARE_RE.test(t.replace(/^https?:\/\//i, ''));
    return URL_BARE_RE.test(t);
  };
  /** normalisasi isian website → selalu menyimpan protokol (https://) */
  const normUrl = v => {
    const t = String(v || '').trim();
    if (!t) return '';
    if (/^https?:\/\//i.test(t)) return t.replace(/\s+/g, '');
    return 'https://' + t.replace(/^\/+/, '').replace(/\s+/g, '');
  };
  /** tampilan isian website pada form → tanpa protokol */
  const urlForInput = v => String(v || '').trim().replace(/^https?:\/\//i, '');
  /** bentuk pendidikan resmi → preset tingkat kelas (agar master kelas tetap konsisten) */
  const BENTUK_JENJANG = { SMK: 'SMK', SMA: 'SMA/MA', MA: 'SMA/MA', SMP: 'SMP/MTs', MTS: 'SMP/MTs', SD: 'SD/MI', MI: 'SD/MI', PAUD: 'PAUD/TK' };
  const backPath = (req, def) => {
    const raw = String((req.body && req.body.back) || (req.query.get && req.query.get('back')) || '').trim();
    return /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/.test(raw) && !raw.startsWith('//') ? raw : def;
  };

  get('/sekolah', (req, res) => {
    guard(req, res, 'sekolah', 'view');
    const c = ctx(req);
    const s = c.settings;
    const ro = !c.can('sekolah', 'edit');
    const ident = dbm.identitasSekolah();
    const inp = (name, val, extra = '') => `<input name="${name}" value="${esc(val == null ? '' : val)}" ${ro ? 'readonly' : ''} ${extra}>`;
    const fld = (label, name, val, hint = '', extra = '') => `<div class="field"><label>${esc(label)}</label>
      ${inp(name, val, extra)}${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
    const content = `<div class="split">
      <div>
        <div class="card mb-3">
          <div class="card-head"><div><h3>Informasi Umum &amp; Kontak</h3>
            <div class="sub">Data pokok sekolah yang dipakai pada kop surat, kwitansi, laporan &amp; portal publik</div></div>
            ${ro ? ui.badge('Hanya Lihat', 'gray') : ui.badge('Identitas Resmi', 'orange')}</div>
          <form method="post" action="${c.base}/sekolah">
            ${fld('Nama Sekolah', 'sekolah_nama', s.sekolah_nama, '', 'required maxlength="150"')}
            <div class="row2">
              ${fld('NPSN (Nomor Pokok Sekolah Nasional)', 'sekolah_npsn', ident.npsn,
        'Wajib <b>8 digit angka</b> dan unik antar sekolah. Muncul di kop surat &amp; footer portal.',
        'inputmode="numeric" maxlength="8" pattern="[0-9]{8}" placeholder="20211525"')}
              ${fld('No. Telepon / WhatsApp Sekolah', 'sekolah_telp', ident.telp, 'Contoh: (0265) 773258 atau 0812xxxxxxx.', 'maxlength="40"')}
            </div>
            <div class="row2">
              ${fld('Email Resmi Sekolah', 'sekolah_email', ident.email, 'Format email akan divalidasi otomatis.', 'type="email" maxlength="120" placeholder="info@sekolah.sch.id"')}
              ${fld('Website Sekolah', 'sekolah_website', urlForInput(ident.website), 'Isi <b>tanpa</b> <code>https://</code> — contoh: <b>www.sekolah.sch.id</b> (protokol ditambahkan otomatis).', 'maxlength="150" placeholder="www.sekolah.sch.id"')}
            </div>
            <div class="field"><label>Alamat Lengkap Sekolah</label>
              <textarea name="sekolah_alamat" rows="3" ${ro ? 'readonly' : ''} placeholder="Jalan, kelurahan, kecamatan, kabupaten, kode pos">${esc(s.sekolah_alamat || '')}</textarea>
              <div class="hint">Baris baru akan ditampilkan sebagai baris terpisah pada kop surat.</div></div>
            <hr class="sep">
            <div class="row2">
              ${fld('Nama Kepala Sekolah', 'sekolah_kepala', s.sekolah_kepala, '', 'maxlength="120"')}
              ${fld('NIP / NUPTK Kepala Sekolah', 'sekolah_nip_kepala', s.sekolah_nip_kepala, '', 'maxlength="40"')}
            </div>
            <div class="row2">
              ${fld('Nama Bendahara', 'sekolah_bendahara', s.sekolah_bendahara, '', 'maxlength="120"')}
              ${fld('NIP / NUPTK Bendahara', 'sekolah_nip_bendahara', s.sekolah_nip_bendahara, '', 'maxlength="40"')}
            </div>
            <div class="form-actions">${ro ? '' : `<button class="btn btn-primary">${ui.icon('save')}Simpan Identitas Sekolah</button>`}</div>
          </form>
        </div>

        <div class="card">
          <div class="card-head"><div><h3>Legalitas &amp; Status</h3>
            <div class="sub">Bentuk pendidikan, status, dan kepemilikan sekolah</div></div></div>
          <form method="post" action="${c.base}/sekolah">
            <input type="hidden" name="bagian" value="legalitas">
            <div class="row2">
              <div class="field"><label>Bentuk Pendidikan</label>
                <select name="sekolah_bentuk" ${ro ? 'disabled' : ''}>
                  <option value="">— Pilih bentuk pendidikan —</option>
                  ${dbm.BENTUK_PENDIDIKAN.map(([k, v]) => `<option value="${k}" ${String(ident.bentuk) === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
                </select>
                <div class="hint">Mengubah bentuk pendidikan ikut menyesuaikan preset tingkat kelas (dapat diatur ulang di
                  <a href="${c.base}/kelas/tingkat">Kelas &amp; Tingkat</a>).</div></div>
              <div class="field"><label>Status Sekolah</label>
                <div class="radio-cards" style="grid-template-columns:1fr 1fr">
                  ${dbm.STATUS_SEKOLAH.map((v, i) => `<input type="radio" id="st${i}" name="sekolah_status" value="${v}" ${String(ident.status) === v ? 'checked' : ''} ${ro ? 'disabled' : ''}>
                    <label for="st${i}"><span class="dot"></span>${esc(v)}</label>`).join('')}
                </div>
                <div class="hint">Status kelembagaan sekolah (Negeri / Swasta).</div></div>
            </div>
            <div class="row2">
              <div class="field"><label>Status Kepemilikan</label>
                <input name="sekolah_kepemilikan" value="${esc(ident.kepemilikan)}" list="kepemilikanList" ${ro ? 'readonly' : ''} maxlength="80" placeholder="Yayasan / Pemerintah Daerah">
                <datalist id="kepemilikanList">${dbm.KEPEMILIKAN_OPTIONS.map(x => `<option value="${esc(x)}"></option>`).join('')}</datalist>
                <div class="hint">Contoh: Pemerintah Daerah, Yayasan, Kementerian Agama, Perorangan.</div></div>
              <div class="field"><label>Tingkat Kelas Aktif</label>
                <input type="text" value="${esc(dbm.tingkatAktif().join(', '))}" readonly>
                <div class="hint">${dbm.tingkatAktif().length} tingkat aktif · atur di <a href="${c.base}/kelas/tingkat">Pengaturan Kelas &amp; Tingkat</a>.</div></div>
            </div>
            <div class="alert info">${ui.icon('info')}<div><b>Kop Surat Resmi</b>, <b>Ukuran Kuitansi</b>, dan redaksional dokumen cetak kini diatur di
              <a href="${c.base}/desain-cetak"><b>Desain Templat Cetak</b></a>. Alamat portal, slug, dan domain diatur di
              <a href="${c.base}/portal-publik"><b>Portal Publik</b></a>.</div></div>
            <div class="form-actions">${ro ? '' : `<button class="btn btn-primary">${ui.icon('save')}Simpan Legalitas &amp; Status</button>`}</div>
          </form>
        </div>
      </div>

      <div>
        <div class="card mb-3">
          <div class="card-head"><div><h3>Pratinjau Kop Surat</h3><div class="sub">Persis seperti pada dokumen cetak</div></div>
            <a class="btn btn-sm" href="${c.base}/desain-cetak">${ui.icon('printer')}Atur Kop</a></div>
          <div class="doc" style="padding:14px;border:1px dashed var(--line-2);border-radius:12px;background:#fff">
            ${ui.kop(s)}
          </div>
          <div class="small muted mt-2">Variabel dinamis yang dapat dipakai pada teks kop, kwitansi, dan templat cetak:
            <code>{nama}</code> <code>{npsn}</code> <code>{bentuk}</code> <code>{status}</code> <code>{kepemilikan}</code>
            <code>{alamat}</code> <code>{telp}</code> <code>{email}</code> <code>{website}</code>.</div>
        </div>
        <div class="card mb-3">
          <div class="card-head"><div><h3>Logo Sekolah</h3><div class="sub">PNG/JPG · maksimal 15 MB · otomatis dioptimalkan</div></div></div>
          <div class="center" style="padding:14px 0 18px">
            ${s.sekolah_logo ? `<img src="${esc(s.sekolah_logo)}" alt="Logo" width="150" height="150" loading="lazy" decoding="async" style="max-width:150px;max-height:150px;object-fit:contain">`
        : `<div style="width:120px;height:120px;border-radius:50%;border:2px dashed var(--line-2);display:grid;place-items:center;margin:0 auto;color:var(--muted)">${ui.icon('school')}</div>
              <p class="help mt-2">Belum ada logo. Unggah logo sekolah agar kop surat tampil resmi.</p>`}
          </div>
          ${ro ? '' : `<form method="post" action="${c.base}/sekolah/logo">
            <input type="hidden" name="logo_b64" id="logo_b64">
            <div class="field"><label>Pilih berkas logo</label>
              <input type="file" accept="image/*" data-b64="logo_b64" data-max="15">
              <div class="hint" id="logo_b64-info"></div>
            </div>
            <button class="btn btn-primary btn-block">${ui.icon('upload')}Unggah Logo</button>
          </form>
          ${s.sekolah_logo ? `<form method="post" action="${c.base}/sekolah/logo" data-confirm="Hapus logo sekolah?"><input type="hidden" name="hapus" value="1">
            <button class="btn btn-danger btn-block mt-1">${ui.icon('trash')}Hapus Logo</button></form>` : ''}`}
          <hr class="sep">
          <div class="small muted">Logo otomatis dipakai pada: kop Laporan BKU, Rekonsiliasi Kas, Berita Acara, Kwitansi, favicon, dan portal publik.</div>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Menu Terkait</h3><div class="sub">Pengaturan tampilan &amp; publikasi</div></div></div>
          <div class="list">
            <a class="list-row" href="${c.base}/portal-publik"><div><div class="nm">Portal Publik</div><div class="mt">Slug alamat portal, subdomain &amp; custom domain</div></div><span class="ml-auto">${ui.icon('link')}</span></a>
            <a class="list-row" href="${c.base}/desain-cetak"><div><div class="nm">Desain Templat Cetak</div><div class="mt">Kop surat resmi &amp; ukuran kuitansi</div></div><span class="ml-auto">${ui.icon('printer')}</span></a>
            <a class="list-row" href="${c.base}/tema"><div><div class="nm">Tema &amp; Branding</div><div class="mt">Warna, logo aplikasi, mode terang/gelap</div></div><span class="ml-auto">${ui.icon('chart')}</span></a>
            <a class="list-row" href="${c.base}/tampilan-menu"><div><div class="nm">Pengaturan Tampilan Menu</div><div class="mt">Urutan, judul &amp; ikon menu</div></div><span class="ml-auto">${ui.icon('menu')}</span></a>
          </div>
        </div>
      </div>
    </div>`;
    page(req, res, { title: 'Identitas Sekolah', sub: 'Nama, NPSN, kontak & legalitas sekolah', active: 'sekolah', content });
  });

  post('/sekolah', (req, res) => {
    if (!guard(req, res, 'sekolah', 'edit')) return;
    const ident = dbm.identitasSekolah();
    // ---- validasi NPSN (8 digit & unik antar sekolah) ----
    if (req.body.sekolah_npsn !== undefined) {
      const npsn = saas && saas.npsnNormalize ? saas.npsnNormalize(req.body.sekolah_npsn) : String(req.body.sekolah_npsn || '').trim();
      const errN = saas && saas.npsnError ? saas.npsnError(npsn, req.tenant ? req.tenant.id : 0) : (npsn.length === 8 ? null : 'NPSN harus 8 digit.');
      if (errN) return res.redirect(req.BASE + '/sekolah?err=' + encodeURIComponent(errN));
    }
    if (req.body.sekolah_email !== undefined && !isEmail(String(req.body.sekolah_email || '').trim())) {
      return res.redirect(req.BASE + '/sekolah?err=' + encodeURIComponent('Format email sekolah tidak valid (contoh: info@sekolah.sch.id).'));
    }
    if (req.body.sekolah_website !== undefined && !isUrl(String(req.body.sekolah_website || '').trim())) {
      return res.redirect(req.BASE + '/sekolah?err=' + encodeURIComponent('Format website tidak valid — tulis tanpa https:// (contoh: www.sekolah.sch.id).'));
    }
    // ---- identitas umum & kontak ----
    const keys = ['sekolah_nama', 'sekolah_alamat', 'sekolah_kepala', 'sekolah_nip_kepala', 'sekolah_bendahara', 'sekolah_nip_bendahara',
      'sekolah_telp', 'sekolah_email', 'sekolah_website', 'sekolah_status', 'sekolah_kepemilikan'];
    for (const k of keys) if (req.body[k] !== undefined) dbm.setSetting(k, String(req.body[k]).trim());
    // website disimpan lengkap dengan protokol agar tautan pada kop/footer tetap valid
    if (req.body.sekolah_website !== undefined) dbm.setSetting('sekolah_website', normUrl(req.body.sekolah_website));
    if (req.body.sekolah_npsn !== undefined) {
      const npsn = saas && saas.npsnNormalize ? saas.npsnNormalize(req.body.sekolah_npsn) : String(req.body.sekolah_npsn || '').trim();
      dbm.setSetting('sekolah_npsn', npsn);
      if (saas && saas.setTenantNpsn && req.tenant) saas.setTenantNpsn(req.tenant.id, npsn);
    }
    // ---- jenjang pendidikan (kompatibilitas): langsung memilih preset tingkat kelas ----
    let presetInfo = '';
    if (req.body.jenjang_pendidikan !== undefined && !req.body.sekolah_bentuk) {
      const j = String(req.body.jenjang_pendidikan || '').trim();
      if (dbm.JENJANG[j]) {
        const before = String(dbm.getSetting('jenjang_pendidikan', ''));
        dbm.setSetting('jenjang_pendidikan', j);
        if (j !== before) {
          const r = dbm.applyJenjangPreset(j, true);
          presetInfo = r.changed ? ` Preset tingkat ${j}: ${r.list.join(', ')}.` : '';
        }
      }
    }
    // ---- bentuk pendidikan → preset tingkat kelas ----
    if (req.body.sekolah_bentuk !== undefined) {
      const b = String(req.body.sekolah_bentuk || '').trim().toUpperCase();
      if (!b || dbm.BENTUK_LABEL[b]) {
        const before = String(dbm.getSetting('sekolah_bentuk', ''));
        dbm.setSetting('sekolah_bentuk', b);
        const jenjang = BENTUK_JENJANG[b];
        if (jenjang && b !== before && dbm.JENJANG[jenjang]) {
          dbm.setSetting('jenjang_pendidikan', jenjang);
          const r = dbm.applyJenjangPreset(jenjang, true);
          presetInfo = r.changed ? ` Preset tingkat ${jenjang}: ${r.list.join(', ')}.` : '';
        }
      }
    }
    dbm.logAudit(req.user, 'EDIT', 'sekolah',
      `Memperbarui identitas resmi sekolah (NPSN ${dbm.getSetting('sekolah_npsn', '-')}, bentuk ${dbm.BENTUK_LABEL[dbm.getSetting('sekolah_bentuk', '')] || '-'})`);
    res.redirect(req.BASE + '/sekolah?ok=' + encodeURIComponent('Identitas sekolah berhasil disimpan.' + presetInfo));
  });

  post('/sekolah/logo', async (req, res) => {
    if (!guard(req, res, 'sekolah', 'edit')) return;
    if (req.body.hapus) {
      dbm.setSetting('sekolah_logo', '');
      dbm.setSetting('sekolah_logo_small', '');
      dbm.logAudit(req.user, 'EDIT', 'sekolah', 'Menghapus logo sekolah');
      return res.redirect(req.BASE + '/sekolah?ok=' + encodeURIComponent('Logo dihapus.'));
    }
    try {
      const url = await uploadMedia(req.body.logo_b64, 'logo-sekolah.' + ((String(req.body.logo_b64).match(/^data:image\/(\w+)/) || [])[1] || 'png'));
      dbm.setSetting('sekolah_logo', url);
      if (req.body.logo_b64_small) {
        try { dbm.setSetting('sekolah_logo_small', await uploadMedia(req.body.logo_b64_small, 'logo-sekolah-kecil.webp')); } catch (e) { }
      }
      dbm.logAudit(req.user, 'EDIT', 'sekolah', 'Mengunggah logo sekolah');
      res.redirect(req.BASE + '/sekolah?ok=' + encodeURIComponent('Logo berhasil diunggah.'));
    } catch (e) {
      res.redirect(req.BASE + '/sekolah?err=' + encodeURIComponent(e.message));
    }
  });

  /* ================= PORTAL PUBLIK (slug, subdomain & custom domain) ================= */
  get('/portal-publik', (req, res) => {
    guard(req, res, 'sekolah', 'view');
    const c = ctx(req);
    const s = c.settings;
    const ro = !c.can('sekolah', 'edit');
    const t = req.tenant || {};
    const localHost = String(process.env.APP_BASE_URL || req.BASE || '').replace(/\/+$/, '') || '(domain ini)';
    const platformHost = String(saas.get('saas_base_url', '') || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const baseHost = String(process.env.APP_BASE_URL || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const domStatus = String(t.custom_domain_status || '').toUpperCase();
    const domBadge = !t.custom_domain ? ui.badge('Belum Ada', 'gray')
      : domStatus === 'VERIFIED' ? ui.badge('Terverifikasi', 'green')
        : domStatus === 'FAILED' ? ui.badge('Gagal Verifikasi', 'red') : ui.badge('Menunggu Verifikasi', 'amber');
    const serverIp = (saas.serverIp && saas.serverIp()) || '(belum diatur Super Admin)';
    const cnameTarget = platformHost || 'portal.simkeu.com';
    const tenantSlug = String(t.portal_slug || '');
    /* ---- teks portal (judul tab + sub-judul banner) & status publikasi ---- */
    const txt = (saas.portalText ? saas.portalText(s) : { title: 'Cek Tagihan', subtitle: 'PORTAL CEK TAGIHAN IURAN SISWA', defaultTitle: 'Cek Tagihan', defaultSubtitle: 'PORTAL CEK TAGIHAN IURAN SISWA' });
    const namaSekolah = String(s.sekolah_nama || t.nama || 'Sekolah');
    /* status alamat bawaan /portal (otomatis nonaktif bila slug portal sudah diganti) */
    const alias = (() => { try { return dbm.portalDefaultAlias(); } catch (e) { return { on: true, mode: 'auto', slug: 'portal' }; } })();
    const publishedOn = String(s.portal_aktif || '1') === '1';
    const pegawaiOn = String(s.portal_pegawai_aktif || '1') === '1';
    const slipOn = String(s.portal_slip_aktif || '1') === '1';
    /* ---- alamat publik efektif (mengikuti slug kanonik sekolah, boleh dua bagian) ----
       Dulu tautan sakelar memakai slug internal ("/portal") sehingga bisa menunjuk alamat
       yang sudah tidak dipakai. Sekarang selalu memakai slug portal yang aktif. */
    const hostAbs = String(process.env.APP_BASE_URL || '').replace(/\/+$/, '');
    const slugCanon = String(t.portal_slug || '').trim().toLowerCase();
    const publicUrl = (kind, fallback) => {
      const path = slugCanon
        ? '/' + slugCanon + (kind === 'pegawai' ? '/portal-pegawai' : kind === 'slip' ? '/portal-slip' : '')
        : '/' + (fallback || 'portal');
      const short = (c.base || '') + path;
      return { short, full: hostAbs ? hostAbs + path : short };
    };
    const swRow = (name, on, label, sub, link, extra = '') => `<div class="publ-row">
      <label class="sw">
        <input type="checkbox" name="${name}" value="1" ${on ? 'checked' : ''} ${ro ? 'disabled' : ''}>
        <span class="sw-track"></span>
        <span class="sw-label">${esc(label)}</span>
        <span class="sw-state">${on ? 'ON' : 'OFF'}</span>
      </label>
      <div class="publ-meta">
        <a class="url-chip" href="${esc(link.full)}" target="_blank" rel="noopener">${ui.icon('link')}${esc(link.full.replace(/^https?:\/\/[^/]+/, ''))}</a>
        <span class="small muted">${sub}${extra}</span>
      </div>
    </div>`;
    const pst = (saas.portalStatusOf ? saas.portalStatusOf(t) : 'aktif');
    const pstInfo = (saas.portalStatusInfo ? saas.portalStatusInfo(t) : { label: 'Aktif', color: 'green', desc: '' });
    const superAktif = pst === 'aktif';
    const adminBanner = superAktif ? '' : `<div class="alert err mb-3" id="bannerPortalAdmin">${ui.icon('lock')}<div>
      <b>Halaman portal publik Anda sedang dinonaktifkan oleh Administrator Pusat.</b><br>
      Status dari pusat: ${ui.badge(pstInfo.label, pstInfo.color)}
      ${t.portal_note ? ` · Catatan: <i>${esc(t.portal_note)}</i>` : ''}
      ${t.portal_locked_by ? `<div class="small" style="margin-top:4px">Ditutup oleh ${esc(t.portal_locked_by)}${t.portal_locked_at ? ' · ' + esc(lib.stampShort(t.portal_locked_at)) : ''}</div>` : ''}
      <div class="small" style="margin-top:4px">Selama status ini berlaku, pengunjung tidak dapat membuka alamat portal publik. Hubungi Super Admin Pusat untuk mengaktifkan kembali.</div>
    </div></div>`;
    const pvLogo = s.sekolah_logo
      ? `<img src="${esc(s.sekolah_logo)}" alt="Logo sekolah" width="44" height="44" loading="lazy" decoding="async">`
      : `<div class="pv-ph">${esc(namaSekolah.charAt(0))}</div>`;
    const slugRow = (label, key, def, hint) => `<div class="field"><label>${esc(label)}</label>
      <input name="${key}" value="${esc(s[key] || def)}" ${ro ? 'readonly' : ''} placeholder="${esc(def)}" maxlength="40" pattern="[a-z0-9][a-z0-9\\-]{1,38}[a-z0-9]">
      <div class="hint">${hint}</div></div>`;
    const content = `${adminBanner}<div class="split">
      <div>
        <div class="card mb-3" id="publikasiPortal">
          <div class="card-head"><div><h3>Publikasi &amp; Teks Halaman Portal</h3>
            <div class="sub">Sakelar tayang, judul tab browser &amp; sub-judul banner portal</div></div>
            ${publishedOn ? ui.badge('Dipublikasikan', 'green') : ui.badge('Tidak Dipublikasikan', 'gray')}</div>
          <form method="post" action="${c.base}/sekolah/portal-publik/simpan">
            <input type="hidden" name="simpan_publikasi" value="1">
            <div class="publ-list">
              ${swRow('portal_aktif', publishedOn, 'Publikasikan Halaman Portal', 'Portal cek tagihan iuran siswa (orang tua/wali).', publicUrl('siswa', dbm.portalSlugs().siswa))}
              ${swRow('portal_pegawai_aktif', pegawaiOn, 'Portal Piutang Pegawai', 'Cek sisa piutang pegawai (verifikasi OTP WhatsApp).', publicUrl('pegawai', dbm.portalSlugs().pegawai))}
              ${swRow('portal_slip_aktif', slipOn, 'Portal Slip Gaji Pegawai', 'Unduh slip gaji pegawai (verifikasi OTP WhatsApp).', publicUrl('slip', dbm.portalSlugs().slip))}
            </div>
            <div class="hint" style="margin:10px 0 14px 0">Bila sakelar dimatikan, halaman tersebut otomatis tidak dapat dibuka.
              Seluruh pengaturan &amp; data tetap tersimpan dan langsung aktif lagi saat sakelar dinyalakan.</div>
            <div class="row2">
              <div class="field"><label>Judul Tab Browser (page_title)</label>
                <input type="text" name="portal_page_title" value="${esc(s.portal_page_title || '')}" maxlength="40"
                  placeholder="${esc(txt.defaultTitle)}" ${ro ? 'readonly' : ''} data-pv-title>
                <div class="hint">Tampil pada tab browser &amp; pratinjau WhatsApp:
                  <code data-pv-tabhint>${esc(txt.title)} · ${esc(namaSekolah)}</code>.
                  Kosongkan untuk memakai default <b>${esc(txt.defaultTitle)}</b>.</div></div>
              <div class="field"><label>Sub-Judul Banner Portal</label>
                <input type="text" name="portal_subtitle" value="${esc(s.portal_subtitle || '')}" maxlength="60"
                  placeholder="${esc(txt.defaultSubtitle)}" ${ro ? 'readonly' : ''} data-pv-sub>
                <div class="hint">Maksimal <b>60 karakter</b> agar tata letak portal di layar HP tetap rapi.
                  Kosongkan untuk memakai default <b>${esc(txt.defaultSubtitle)}</b>.</div></div>
            </div>
            <div class="field"><label>Judul Tab Saat Tautan Bertoken (opsional)</label>
              <input type="text" name="portal_token_title" value="${esc(s.portal_token_title || '')}" maxlength="60"
                placeholder="mis. Rincian {judul}" ${ro ? 'readonly' : ''} data-pv-token>
              <div class="hint">Dipakai ketika orang tua membuka tautan pribadi dari WhatsApp (<code>?token=…</code>).
                Gunakan <code>{judul}</code> untuk menyisipkan judul di atas — contoh <code>Rincian {judul}</code> menjadi
                <code data-pv-tokenhint>${esc(txt.tokenTitle)} · ${esc(namaSekolah)}</code>.
                Kosongkan agar judul tetap sama pada kedua kondisi (Opsi A — konsisten).</div></div>
            <div class="card-head" style="padding:0;margin:4px 0 8px"><div><h3 style="font-size:14px">Pratinjau Langsung</h3>
              <div class="sub">Tab browser &amp; banner portal — berubah saat Anda mengetik</div></div></div>
            <div class="portal-preview" data-portal-preview
              data-def-title="${esc(txt.defaultTitle)}" data-def-sub="${esc(txt.defaultSubtitle)}"
              data-school="${esc(namaSekolah)}">
              <div class="pv-tab"><span class="pv-dot"></span><span class="pv-title" data-pv-tab>${esc(txt.title)} · ${esc(namaSekolah)}</span></div>
              <div class="pv-token"><span class="badge blue plain">Tautan pribadi</span>
                <span class="pv-title" data-pv-tokentab>${esc(txt.tokenTitle)} · ${esc(namaSekolah)}</span></div>
              <div class="pv-banner">
                ${pvLogo}
                <div><div class="pv-name">${esc(namaSekolah)}</div><div class="pv-sub" data-pv-subtitle>${esc(txt.subtitle)}</div></div>
              </div>
              <div class="pv-body">Cuplikan isi halaman: formulir cek tagihan iuran siswa, rincian per bulan, dan kolom catatan orang tua.</div>
            </div>
            ${ro ? '' : `<div class="form-actions"><button class="btn btn-primary">${ui.icon('save')}Simpan Publikasi &amp; Teks</button></div>`}
          </form>
        </div>

        <div class="card mb-3">
          <div class="card-head"><div><h3>Alamat (URL) Portal Publik</h3>
            <div class="sub">Ujung alamat ketiga portal dapat diubah sendiri, mis. <code>portal-slip</code> → <code>portal-slip-pegawai</code></div></div>
            ${ro ? ui.badge('Hanya Lihat', 'gray') : ui.badge('Berlaku Langsung', 'green')}</div>
          <form method="post" action="${c.base}/sekolah/portal-slug">
            <div class="row3">
              ${slugRow('Portal Tagihan Siswa', 'portal_slug', 'portal', `Contoh: <code>${esc(localHost)}/${esc(s.portal_slug || 'portal')}</code>`)}
              ${slugRow('Portal Piutang Pegawai', 'portal_pegawai_slug', 'portal-pegawai', `Contoh: <code>${esc(localHost)}/${esc(s.portal_pegawai_slug || 'portal-pegawai')}</code>`)}
              ${slugRow('Portal Slip Gaji Pegawai', 'portal_slip_slug', 'portal-slip', `Contoh: <code>${esc(localHost)}/${esc(s.portal_slip_slug || 'portal-slip')}</code>`)}
            </div>
            <div class="field"><label>Alamat Bawaan <code>/portal</code></label>
              <select name="portal_default_alias" ${ro ? 'disabled' : ''}>
                <option value="auto" ${alias.mode === 'auto' ? 'selected' : ''}>Otomatis — aktif hanya bila slug masih &quot;portal&quot; (rekomendasi)</option>
                <option value="on" ${alias.mode === 'on' ? 'selected' : ''}>Selalu aktifkan (tautan lama tetap jalan)</option>
                <option value="off" ${alias.mode === 'off' ? 'selected' : ''}>Nonaktifkan (hanya alamat kustom)</option>
              </select>
              <div class="hint">Saat ini: ${alias.on
        ? `<b style="color:var(--green)">aktif</b> — <code>${esc(localHost)}/portal</code> masih dapat dibuka`
        : `<b style="color:var(--red)">nonaktif</b> — <code>${esc(localHost)}/portal</code> menampilkan halaman 404, portal hanya di <code>${esc(localHost)}/${esc(dbm.portalSlugs().siswa)}</code>`}.</div></div>
            <div class="alert info">${ui.icon('info')}<div>Gunakan huruf kecil, angka, dan tanda hubung (-), panjang 3–40 karakter.
              Bila slug diganti, alamat bawaan <code>/portal</code> otomatis tidak dipakai lagi agar tidak ada dua alamat dengan isi yang sama.
              Perubahan langsung berlaku tanpa restart server.</div></div>
            ${ro ? '' : `<div class="form-actions"><button class="btn btn-primary">${ui.icon('save')}Simpan Alamat Portal</button></div>`}
          </form>
        </div>

        <div class="card mb-3">
          <div class="card-head"><div><h3>Subdomain / URL Portal Sekolah</h3>
            <div class="sub">Slug unik antar sekolah untuk alamat portal sekolah ini</div></div></div>
          <form method="post" action="${c.base}/sekolah/portal">
            <input type="hidden" name="back" value="/portal-publik">
            <div class="field"><label>Custom URL Slug</label>
              <div class="flex" style="gap:6px;align-items:center">
                <span class="small muted nowrap">${esc(localHost)}/</span>
                <input name="portal_slug" value="${esc(tenantSlug)}" ${ro ? 'readonly' : ''} placeholder="sdn-1-jakarta" style="flex:1" pattern="[a-z0-9][a-z0-9\\-]{1,38}[a-z0-9]">
                <span class="small muted nowrap">/portal</span>
              </div>
              <div class="hint">Pratinjau: <code>${esc(localHost)}/${esc(tenantSlug || 'slug-sekolah')}/portal</code></div></div>
            <div class="alert info">${ui.icon('info')}<div>Slug wajib <b>unik antar sekolah</b>, hanya huruf kecil, angka, dan tanda hubung (-), tanpa spasi (3–40 karakter).</div></div>
            <div class="kv mb-2">
              <dt>Alamat bawaan platform</dt><dd><code>${esc(baseHost || localHost)}${esc(tenantSlug ? '/' + tenantSlug : '')}</code></dd>
              <dt>Kode sekolah</dt><dd><b>${esc(t.school_code || '-')}</b></dd>
            </div>
            ${ro ? '' : `<button class="btn btn-primary btn-block">${ui.icon('save')}Simpan URL Portal</button>`}
          </form>
        </div>

        <div class="card">
          <div class="card-head"><div><h3>Custom Domain (Domain / Subdomain Sendiri)</h3>
            <div class="sub">Akses portal lewat domain sekolah sendiri</div></div>${domBadge}</div>
          <form method="post" action="${c.base}/sekolah/domain">
            <input type="hidden" name="back" value="/portal-publik">
            <div class="field"><label>Domain / Subdomain Khusus</label>
              <input name="custom_domain" value="${esc(t.custom_domain || '')}" ${ro ? 'readonly' : ''}
                placeholder="keuangan.sman1jakarta.sch.id">
              <div class="hint">Tanpa <code>https://</code> dan tanpa garis miring di akhir.</div></div>
            <div class="card" style="padding:14px;background:var(--o-50);border:1px solid var(--line)">
              <div class="t-strong mb-1">Petunjuk Konfigurasi DNS (pilih salah satu)</div>
              <div class="small" style="line-height:1.7">
                <b>Opsi 1 — CNAME Record</b><br>
                Nama/Host: <code>subdomain</code> sekolah Anda → Target/Value: <code>${esc(cnameTarget)}</code><br>
                <span class="muted">Cocok bila penyedia DNS mendukung CNAME pada subdomain.</span>
                <hr class="sep" style="margin:10px 0">
                <b>Opsi 2 — A Record (Direkomendasikan)</b><br>
                Nama/Host: <code>subdomain</code> sekolah Anda → Target/Value: <code>${esc(serverIp)}</code><br>
                <span class="muted">Gunakan bila CNAME gagal/tidak cocok. Arahkan langsung ke IP dedicated server.</span>
              </div>
            </div>
            <div class="alert info mt-2">${ui.icon('shield')}<div>Verifikasi otomatis mengecek <b>pengarah IP (A Record)</b> dan <b>Host Domain (HTTP_HOST)</b> sekaligus,
              sehingga domain langsung aktif tanpa error bila salah satu pengarah sudah benar.
              Sertifikat SSL/HTTPS diterbitkan otomatis oleh proxy server setelah domain terverifikasi.</div></div>
            ${ro ? '' : `<div class="form-actions"><button class="btn btn-primary">${ui.icon('refresh')}Simpan &amp; Verifikasi DNS</button></div>`}
          </form>
          <p class="help mt-1">Bila status masih <b>Menunggu Verifikasi</b>, propagasi DNS umumnya memerlukan 5 menit–24 jam.
            Super Admin Pusat juga dapat memverifikasi manual dari panelnya.</p>
        </div>
      </div>
      <div>
        <div class="card mb-3">
          <div class="card-head"><div><h3>Status Portal</h3><div class="sub">Ringkasan publikasi portal sekolah</div></div></div>
          <div class="kv">
            <dt>Portal tagihan siswa</dt><dd>${publishedOn ? ui.badge('Dipublikasikan', 'green') : ui.badge('Tidak Dipublikasikan', 'gray')}</dd>
            <dt>Portal piutang pegawai</dt><dd>${pegawaiOn ? ui.badge('Dipublikasikan', 'green') : ui.badge('Tidak Dipublikasikan', 'gray')}</dd>
            <dt>Portal slip gaji</dt><dd>${slipOn ? ui.badge('Dipublikasikan', 'green') : ui.badge('Tidak Dipublikasikan', 'gray')}</dd>
            <dt>Status dari Super Admin</dt><dd>${ui.badge(pstInfo.label, pstInfo.color)}</dd>
            <dt>Alamat portal</dt><dd>${tenantSlug ? `<span class="mono">/${esc(tenantSlug)}/portal</span>` : '<span class="muted">(tidak ada)</span>'}</dd>
            <dt>Custom domain</dt><dd>${t.custom_domain ? `<span class="mono">${esc(t.custom_domain)}</span>` : '-'}</dd>
            <dt>Status domain</dt><dd>${domBadge}</dd>
          </div>
          <div class="alert ${superAktif ? 'info' : 'warn'} mt-2">${ui.icon(superAktif ? 'info' : 'alert')}<div>
            ${superAktif
        ? `Halaman publik hanya dapat dibuka pengunjung bila <b>sakelar sekolah ON</b> <u>dan</u> status dari Super Admin <b>Aktif</b>.`
        : `Halaman publik sedang <b>diblokir Administrator Pusat</b> (${esc(pstInfo.label)}), sehingga tidak dapat dibuka pengunjung.`}</div></div>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Identitas pada Portal</h3><div class="sub">Nama & kontak sekolah tampil di portal</div></div></div>
          <div class="kv">
            <dt>Nama sekolah</dt><dd>${esc(s.sekolah_nama || '-')}</dd>
            <dt>NPSN</dt><dd>${esc(s.sekolah_npsn || '-')}</dd>
            <dt>Telepon</dt><dd>${esc(s.sekolah_telp || '-')}</dd>
            <dt>Email</dt><dd>${esc(s.sekolah_email || '-')}</dd>
            <dt>Website</dt><dd>${esc(s.sekolah_website || '-')}</dd>
          </div>
          <a class="btn btn-sm btn-block mt-2" href="${c.base}/sekolah">${ui.icon('edit')}Ubah Identitas Sekolah</a>
        </div>
      </div>
    </div>`;
    page(req, res, { title: 'Portal Publik', sub: 'Alamat portal, subdomain & custom domain sekolah', active: 'portal_publik', content });
  });

  /* alamat (slug) ketiga portal — divalidasi semua sebelum disimpan */
  post('/sekolah/portal-slug', (req, res) => {
    if (!guard(req, res, 'sekolah', 'edit')) return;
    const baru = {};
    for (const [key, settingKey] of Object.entries(dbm.PORTAL_SLUG_KEYS)) {
      if (req.body[settingKey] === undefined) continue;
      const raw = String(req.body[settingKey] || '').trim().toLowerCase();
      const err = raw ? dbm.portalSlugError(raw, key) : null;
      if (err) return res.redirect(req.BASE + '/portal-publik?err=' + encodeURIComponent(err));
      baru[settingKey] = raw || dbm.PORTAL_SLUG_DEFAULT[key];
    }
    /* mode alamat bawaan /portal: auto | on | off */
    const aliasRaw = String(req.body.portal_default_alias || '').trim().toLowerCase();
    const aliasMode = ['auto', 'on', 'off'].includes(aliasRaw) ? aliasRaw : null;
    for (const [k, v] of Object.entries(baru)) dbm.setSetting(k, v);
    if (aliasMode) dbm.setSetting('portal_default_alias', aliasMode);
    const st = (() => { try { return dbm.portalDefaultAlias(); } catch (e) { return null; } })();
    dbm.logAudit(req.user, 'EDIT', 'sekolah',
      `Mengubah alamat portal publik (${Object.values(baru).join(', ') || 'tanpa perubahan slug'})`
      + (st ? `; alamat bawaan /portal ${st.on ? 'aktif' : 'NONAKTIF'} (mode ${st.mode})` : ''));
    const note = st && !st.on ? ` Alamat bawaan /portal tidak dipakai — portal hanya di /${st.slug}.` : '';
    res.redirect(req.BASE + '/portal-publik?ok=' + encodeURIComponent('Alamat portal publik disimpan.' + note));
  });

  /* ---------------- URL portal (slug unik antar sekolah) ---------------- */
  post('/sekolah/portal', (req, res) => {
    if (!guard(req, res, 'sekolah', 'edit')) return;
    const t = req.tenant;
    const back = backPath(req, '/portal-publik');
    try {
      const raw = String(req.body.portal_slug || '').trim().toLowerCase();
      const err = saas.portalSlugError(raw, t.id);
      if (err) throw new Error(err);
      saas.setPortalSlug(t.id, raw, req.user);
      dbm.setSetting('portal_slug', raw);
      dbm.logAudit(req.user, 'EDIT', 'sekolah', 'Mengubah URL portal publik menjadi /' + raw + '/portal');
      if (typeof refreshPortalMap === 'function') refreshPortalMap();
      res.redirect(req.BASE + flashUrl(back, 'ok', 'URL portal publik disimpan: /' + raw + '/portal'));
    } catch (e) {
      res.redirect(req.BASE + flashUrl(back, 'err', e.message));
    }
  });

  /* ---------------- publikasi & teks halaman portal (sakelar + judul tab + sub-judul) ---------------- */
  post('/sekolah/portal-publik/simpan', (req, res) => {
    if (!guard(req, res, 'sekolah', 'edit')) return;
    try {
      const title = String(req.body.portal_page_title || '').replace(/\s+/g, ' ').trim();
      const subtitle = String(req.body.portal_subtitle || '').replace(/\s+/g, ' ').trim();
      /* judul tab khusus tautan bertoken (opsional, boleh "Rincian {judul}") */
      const tokenTitle = String(req.body.portal_token_title || '').replace(/\s+/g, ' ').trim();
      const err = saas.portalTextError ? saas.portalTextError({ title, subtitle, tokenTitle }) : null;
      if (err) throw new Error(err);
      /* sakelar publikasi ketiga portal (nilai '1'/'0').
         Hanya diproses bila form publikasi yang dikirim (penanda simpan_publikasi) —
         checkbox yang tidak dicentang memang tidak ikut terkirim. */
      const withSwitches = String(req.body.simpan_publikasi || '') === '1';
      const SW = [
        ['portal_aktif', 'Portal tagihan siswa'],
        ['portal_pegawai_aktif', 'Portal piutang pegawai'],
        ['portal_slip_aktif', 'Portal slip gaji']
      ];
      const changed = [];
      if (withSwitches) {
        for (const [key, label] of SW) {
          const val = req.body[key] ? '1' : '0';
          const before = dbm.getSetting(key, '1') === '1';
          if (before !== (val === '1')) changed.push(`${label}: ${val === '1' ? 'ON' : 'OFF'}`);
          dbm.setSetting(key, val);
        }
      }
      dbm.setSetting('portal_page_title', title);
      dbm.setSetting('portal_subtitle', subtitle);
      dbm.setSetting('portal_token_title', tokenTitle);
      dbm.logAudit(req.user, 'EDIT PORTAL', 'sekolah',
        `Portal publik — ${withSwitches ? (changed.length ? changed.join(' · ') : 'sakelar tidak berubah') : 'teks saja'}; ` +
        `judul "${title || '(default)'}", judul bertoken "${tokenTitle || '(ikut judul)'}", sub-judul "${subtitle || '(default)'}"`);
      const anyOff = withSwitches && SW.some(([key]) => !req.body[key]);
      res.redirect(req.BASE + flashUrl('/portal-publik', 'ok',
        !withSwitches ? 'Teks portal publik disimpan.'
          : anyOff ? 'Pengaturan portal disimpan. Halaman yang sakelarnya OFF dinonaktifkan (data tetap tersimpan).'
            : 'Pengaturan portal publik disimpan — ketiga halaman aktif.'));
    } catch (e) {
      res.redirect(req.BASE + flashUrl('/portal-publik', 'err', e.message));
    }
  });

  /* ---------------- domain khusus + verifikasi DNS (CNAME atau A Record) ---------------- */
  post('/sekolah/domain', async (req, res) => {
    if (!guard(req, res, 'sekolah', 'edit')) return;
    const t = req.tenant;
    const back = backPath(req, '/portal-publik');
    try {
      const dom = String(req.body.custom_domain || '').trim();
      if (!dom) {
        saas.setCustomDomain(t.id, '', req.user);
        return res.redirect(req.BASE + flashUrl(back, 'ok', 'Domain khusus dilepas.'));
      }
      const err = saas.domainError(dom, t.id);
      if (err) throw new Error(err);
      saas.setCustomDomain(t.id, dom, req.user, 'pending');
      dbm.logAudit(req.user, 'AJUKAN DOMAIN', 'sekolah', 'Mengajukan domain khusus ' + dom);
      const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
      const chk = await saas.checkDns(dom, { host });
      if (chk.ok) {
        saas.setCustomDomain(t.id, dom, req.user, 'verified');
        const extra = chk.hostMatch ? ' Host domain cocok.' : ' Domain aktif setelah DNS mengarah ke server.';
        return res.redirect(req.BASE + flashUrl(back, 'ok', 'Domain ' + dom + ' terverifikasi (' + chk.note + ').' + extra));
      }
      saas.setCustomDomain(t.id, dom, req.user, 'pending');
      res.redirect(req.BASE + flashUrl(back, 'warn', 'Domain ' + dom + ' disimpan, menunggu verifikasi. Status DNS: ' + chk.note));
    } catch (e) {
      res.redirect(req.BASE + flashUrl(back, 'err', e.message));
    }
  });


  /* ================= TAHUN AJARAN ================= */
  get('/tahun-ajaran', (req, res) => {
    guard(req, res, 'tahun_ajaran', 'view');
    const c = ctx(req);
    const rows = dbm.allTahun();
    const editId = req.query.get('edit');
    const ed = editId ? db.prepare('SELECT * FROM tahun_ajaran WHERE id=?').get(editId) : null;
    const late = modalCollector();
    const content = `<div class="alert info mb-3">${ui.icon('info')}<div>
        Tahun Pelajaran yang sedang dipakai: <b>${esc(c.ta ? c.ta.nama : '-')}</b> — pilih pada dropdown di header atau tombol <b>Gunakan</b> di tabel.
        Seluruh tampilan (Dashboard, BKU, Transaksi, Aset, Piutang, Payroll, Laporan) otomatis hanya menampilkan data tahun pelajaran tersebut.</div></div>
      <div class="card">
      <div class="card-head"><div><h3>Master Tahun Ajaran</h3><div class="sub">Setiap BKU, anggaran, dan SPP terikat pada tahun ajaran</div></div>
        ${c.can('tahun_ajaran', 'create') ? ui.openModalBtn('mAdd', 'Tambah Tahun Ajaran') : ''}</div>
      ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Tahun Ajaran</th><th>Periode</th><th>Jumlah BKU</th><th>Status</th><th class="right">Aksi</th></tr></thead><tbody>
        ${rows.map(r => {
      const n = db.prepare('SELECT COUNT(*) c FROM bku WHERE tahun_ajaran_id=?').get(r.id).c;
      return `<tr><td class="t-strong">${esc(r.nama)}</td><td class="nowrap">${tglID(r.tanggal_mulai)} — ${tglID(r.tanggal_selesai)}</td>
          <td>${n} BKU</td><td>${r.aktif ? ui.badge('Aktif', 'green') : ui.badge('Arsip', 'gray')}</td>
          <td class="right nowrap">
            ${String(r.id) === String(c.taId) ? ui.badge('Sedang Dipakai', 'blue') : `<form method="post" action="${c.base}/ta/pilih" style="display:inline"><input type="hidden" name="ta" value="${r.id}"><input type="hidden" name="back" value="/tahun-ajaran"><button class="btn btn-sm" title="Tampilkan data tahun ajaran ini">${ui.icon('eye')}Gunakan</button></form>`}
            ${!r.aktif && c.can('tahun_ajaran', 'edit') ? `<form method="post" action="${c.base}/tahun-ajaran/aktifkan" style="display:inline"><input type="hidden" name="id" value="${r.id}"><button class="btn btn-sm" title="Jadikan tahun ajaran aktif (default login)">${ui.icon('check')}Aktifkan</button></form>` : ''}
            ${c.can('tahun_ajaran', 'edit') ? `<form method="post" action="${c.base}/tahun-ajaran/rollover" style="display:inline" data-confirm="Salin saldo akhir dari tahun ajaran sebelumnya ke ${esc(r.nama)}? Saldo awal BKU, kas, akun pinjaman, dan piutang belum lunas akan disesuaikan."><input type="hidden" name="id" value="${r.id}"><button class="btn btn-sm btn-soft" title="Rollover saldo awal">${ui.icon('refresh')}Rollover</button></form>` : ''}
            ${c.can('tahun_ajaran', 'edit') ? `<button class="btn btn-sm" data-open="mEdit${r.id}">${ui.icon('edit')}Edit</button>` : ''}
            ${c.can('tahun_ajaran', 'delete') ? `<form method="post" action="${c.base}/tahun-ajaran/delete" style="display:inline" data-confirm="Hapus tahun ajaran ${esc(r.nama)}? BKU terkait juga akan terhapus."><input type="hidden" name="id" value="${r.id}"><button class="btn btn-sm btn-danger">${ui.icon('trash')}</button></form>` : ''}
          </td></tr>
          ${late('mEdit' + r.id, {
        title: 'Edit Tahun Ajaran',
        body: `<form method="post" action="${c.base}/tahun-ajaran/save" id="f${r.id}">
              <input type="hidden" name="id" value="${r.id}">
              <div class="field"><label>Nama Tahun Ajaran</label><input name="nama" value="${esc(r.nama)}" required placeholder="2025/2026"></div>
              <div class="row2"><div class="field"><label>Tanggal Mulai</label><input type="date" name="tanggal_mulai" value="${esc(r.tanggal_mulai || '')}"></div>
              <div class="field"><label>Tanggal Selesai</label><input type="date" name="tanggal_selesai" value="${esc(r.tanggal_selesai || '')}"></div></div>
              <label class="check"><input type="checkbox" name="aktif" value="1" ${r.aktif ? 'checked' : ''}> Jadikan tahun ajaran aktif</label>
            </form>`,
        footer: `<button class="btn" data-close="mEdit${r.id}">Batal</button><button class="btn btn-primary" form="f${r.id}">Simpan</button>`
      })}`;
    }).join('')}
      </tbody></table></div>` : ui.emptyState('Belum ada tahun ajaran')}
      ${late.html()}
    </div>
    ${ui.modal('mAdd', {
      title: 'Tambah Tahun Ajaran',
      body: `<form method="post" action="${c.base}/tahun-ajaran/save" id="fAdd">
        <div class="field"><label>Nama Tahun Ajaran</label><input name="nama" required placeholder="2026/2027"></div>
        <div class="row2"><div class="field"><label>Tanggal Mulai</label><input type="date" name="tanggal_mulai" value="${todayISO()}"></div>
        <div class="field"><label>Tanggal Selesai</label><input type="date" name="tanggal_selesai"></div></div>
        <label class="check"><input type="checkbox" name="aktif" value="1" checked> Jadikan tahun ajaran aktif</label>
        <label class="check" style="margin-top:10px"><input type="checkbox" name="salin_bku" value="1" checked> <b>Salin daftar BKU dari tahun ajaran sebelumnya</b> — nama, jenis &amp; kode BKU diambil dari tahun ajaran sumber (tidak lagi membuat 17 BKU standar otomatis)</label>
        <label class="check" style="margin-top:10px"><input type="checkbox" name="salin_master" value="1" checked> <b>Ambil / Salin Data dari Tahun Sebelumnya</b> — struktur Grup Iuran (beserta nominal) &amp; Master Beasiswa</label>
        <label class="check" style="margin-top:10px"><input type="checkbox" name="salin_kelas" value="1" checked> <b>Salin Kelas &amp; Penempatan Siswa</b> (naik kelas otomatis X → XI, XI → XII) — agar Data Siswa &amp; Penetapan Grup Iuran di tahun ajaran baru langsung terisi</label>
        <label class="check" style="margin-top:10px"><input type="checkbox" name="rollover" value="1" checked> Rollover saldo awal dari tahun ajaran sebelumnya (BKU, kas, akun pinjaman, piutang belum lunas)</label>
        <div class="alert info" style="margin-top:10px">${ui.icon('info')}<div>Status kelulusan siswa kelas XII diatur manual di menu <a href="${c.base}/siswa"><b>Data Siswa</b></a> (ceklis siswa → Penetapan Status Kelulusan). Semua tagihan iuran tetap bisa dibayar &amp; dikoreksi di tahun pelajaran mana pun.</div></div>
        <div class="hint">Master pegawai, beasiswa, dan kode rekening tetap dipakai bersama di seluruh tahun ajaran.</div>
      </form>`,
      footer: `<button class="btn" data-close="mAdd">Batal</button><button class="btn btn-primary" form="fAdd">Simpan</button>`
    })}`;
    page(req, res, { title: 'Tahun Ajaran', sub: 'Master periode pembukuan', active: 'tahun_ajaran', content });
  });

  post('/tahun-ajaran/save', (req, res) => {
    if (!guard(req, res, 'tahun_ajaran', req.body.id ? 'edit' : 'create')) return;
    const { id, nama, tanggal_mulai, tanggal_selesai, aktif, buat_bku } = req.body;
    if (!nama) return res.redirect(req.BASE + '/tahun-ajaran?err=' + encodeURIComponent('Nama tahun ajaran wajib diisi.'));
    const isAktif = aktif ? 1 : 0;
    let rolloverInfo = null, cloneInfo = null, kelasInfo = null, prevTa = null, bkuInfo = null;
    db.transaction(() => {
      if (isAktif) db.prepare('UPDATE tahun_ajaran SET aktif=0').run();
      if (id) {
        db.prepare('UPDATE tahun_ajaran SET nama=?,tanggal_mulai=?,tanggal_selesai=?,aktif=? WHERE id=?')
          .run(nama, tanggal_mulai || null, tanggal_selesai || null, isAktif, id);
      } else {
        const info = db.prepare('INSERT INTO tahun_ajaran (nama,tanggal_mulai,tanggal_selesai,aktif) VALUES (?,?,?,?)')
          .run(nama, tanggal_mulai || null, tanggal_selesai || null, isAktif);
        const newId0 = Number(info.lastInsertRowid);
        prevTa = db.prepare('SELECT * FROM tahun_ajaran WHERE id<>? ORDER BY COALESCE(tanggal_selesai,tanggal_mulai) DESC, id DESC LIMIT 1').get(newId0);
        /* ---- BKU: salin dari tahun ajaran sebelumnya (bukan lagi 17 BKU standar) ---- */
        const mauSalin = req.body.salin_bku !== undefined && req.body.salin_bku !== '';
        if (prevTa && mauSalin) {
          bkuInfo = dbm.cloneBkuTa(prevTa.id, newId0);
        } else if (!prevTa && (mauSalin || buat_bku)) {
          // instalasi baru (belum ada tahun ajaran lain) → siapkan BKU standar agar bisa langsung dipakai
          const ins = db.prepare("INSERT INTO bku (nama,jenis,kode,tahun_ajaran_id,saldo_awal,status,urutan,created_at,auto_mode) VALUES (?,?,?,?,0,'aktif',?,?,?)");
          BKU_STD_UMUM.forEach((n, i) => ins.run(n, 'umum', 'U' + String(i + 1).padStart(2, '0'), newId0, i + 1, nowStamp(), dbm.isAutoBkuNama(n) ? 1 : 0));
          BKU_STD_KEGIATAN.forEach((n, i) => ins.run(n, 'kegiatan', 'K' + String(i + 1).padStart(2, '0'), newId0, i + 7, nowStamp(), 0));
          bkuInfo = { bku: BKU_STD_UMUM.length + BKU_STD_KEGIATAN.length, standar: true };
        } else if (buat_bku) {
          // kompatibilitas: pemanggil lama yang masih mengirim buat_bku tanpa salin_bku
          const ins = db.prepare("INSERT INTO bku (nama,jenis,kode,tahun_ajaran_id,saldo_awal,status,urutan,created_at,auto_mode) VALUES (?,?,?,?,0,'aktif',?,?,?)");
          BKU_STD_UMUM.forEach((n, i) => ins.run(n, 'umum', 'U' + String(i + 1).padStart(2, '0'), newId0, i + 1, nowStamp(), dbm.isAutoBkuNama(n) ? 1 : 0));
          BKU_STD_KEGIATAN.forEach((n, i) => ins.run(n, 'kegiatan', 'K' + String(i + 1).padStart(2, '0'), newId0, i + 7, nowStamp(), 0));
          bkuInfo = { bku: BKU_STD_UMUM.length + BKU_STD_KEGIATAN.length, standar: true };
        }
        if (prevTa) {
          // opsi "Ambil / Salin Data dari Tahun Sebelumnya" (grup iuran + nominal + beasiswa)
          if (req.body.salin_master !== undefined && req.body.salin_master !== '') {
            cloneInfo = dbm.cloneTaMaster(prevTa.id, newId0, { grup: true, beasiswa: true, user: req.user });
          }
          if (req.body.rollover !== undefined && req.body.rollover !== '') {
            rolloverInfo = dbm.rolloverTa(prevTa.id, newId0, req.user);
          }
          // salin kelas + naikkan siswa (hanya bila TA baru memang setelah TA sumber)
          const maju = String(tanggal_mulai || '').slice(0, 10) >= String(prevTa.tanggal_mulai || '').slice(0, 10);
          if (req.body.salin_kelas !== undefined && req.body.salin_kelas !== '' && maju) {
            kelasInfo = dbm.cloneKelasTa(prevTa.id, newId0, { user: req.user, promosi: true });
          }
          // kelulusan siswa tingkat akhir TIDAK lagi otomatis — dilakukan manual di Data Siswa
        }
      }
    })();
    dbm.logAudit(req.user, id ? 'EDIT' : 'TAMBAH', 'tahun_ajaran', `${id ? 'Edit' : 'Tambah'} tahun ajaran ${nama}`);
    const extra = (bkuInfo
      ? ` BKU: ${bkuInfo.bku} buku ${bkuInfo.standar ? '(standar awal)' : 'disalin dari tahun ajaran sebelumnya'}.`
      : '') + (rolloverInfo
      ? ` Rollover saldo awal: ${rolloverInfo.bku} BKU, ${rolloverInfo.aset} akun aset, ${rolloverInfo.piutang} piutang pegawai, ${rolloverInfo.piutangLain} piutang sertifikasi.`
      : '') + (cloneInfo
        ? ` Salin master: ${cloneInfo.grup} grup iuran (${cloneInfo.nominal} nominal), ${cloneInfo.beasiswa} beasiswa.`
        : '') + (kelasInfo
        ? ` Salin kelas: ${kelasInfo.kelas} kelas baru, ${kelasInfo.siswa} siswa ditempatkan (naik kelas).`
        : '');
    res.redirect(req.BASE + '/tahun-ajaran?ok=' + encodeURIComponent('Tahun ajaran disimpan.' + extra
      + ' Status kelulusan siswa diatur manual di menu Data Siswa.'));
  });

  post('/tahun-ajaran/aktifkan', (req, res) => {
    if (!guard(req, res, 'tahun_ajaran', 'edit')) return;
    const target = dbm.tahunById(req.body.id);
    if (!target) return res.redirect(req.BASE + '/tahun-ajaran?err=' + encodeURIComponent('Tahun ajaran tidak ditemukan.'));
    db.transaction(() => {
      db.prepare('UPDATE tahun_ajaran SET aktif=0').run();
      db.prepare('UPDATE tahun_ajaran SET aktif=1 WHERE id=?').run(req.body.id);
    })();
    dbm.logAudit(req.user, 'EDIT', 'tahun_ajaran', `Mengaktifkan tahun ajaran id ${req.body.id}`);
    res.redirect(req.BASE + '/tahun-ajaran?ok=' + encodeURIComponent('Tahun ajaran aktif diperbarui. Status kelulusan siswa diatur manual pada menu Data Siswa.'));
  });

  /* rollover saldo awal dari tahun ajaran sebelumnya */
  post('/tahun-ajaran/rollover', (req, res) => {
    if (!guard(req, res, 'tahun_ajaran', 'edit')) return;
    const next = dbm.tahunById(req.body.id);
    if (!next) return res.redirect(req.BASE + '/tahun-ajaran?err=' + encodeURIComponent('Tahun ajaran tidak ditemukan.'));
    const prev = db.prepare('SELECT * FROM tahun_ajaran WHERE id<>? ORDER BY COALESCE(tanggal_selesai,tanggal_mulai) DESC, id DESC LIMIT 1').get(next.id);
    if (!prev) return res.redirect(req.BASE + '/tahun-ajaran?err=' + encodeURIComponent('Belum ada tahun ajaran lain sebagai sumber saldo awal.'));
    let info;
    try { info = dbm.rolloverTa(prev.id, next.id, req.user); }
    catch (e) { return res.redirect(req.BASE + '/tahun-ajaran?err=' + encodeURIComponent('Rollover gagal: ' + e.message)); }
    res.redirect(req.BASE + '/tahun-ajaran?ok=' + encodeURIComponent(
      `Rollover ${prev.nama} → ${next.nama} selesai: ${info.bku} BKU, ${info.aset} akun aset, ${info.piutang} piutang pegawai, ${info.piutangLain} piutang sertifikasi.`));
  });

  post('/tahun-ajaran/delete', (req, res) => {
    if (!guard(req, res, 'tahun_ajaran', 'delete')) return;
    const id = req.body.id;
    db.transaction(() => {
      const ids = db.prepare('SELECT id FROM bku WHERE tahun_ajaran_id=?').all(id).map(r => r.id);
      for (const b of ids) db.prepare('DELETE FROM transaksi WHERE bku_id=?').run(b);
      db.prepare('DELETE FROM bku WHERE tahun_ajaran_id=?').run(id);
      db.prepare('DELETE FROM anggaran WHERE tahun_ajaran_id=?').run(id);
      db.prepare('DELETE FROM spp WHERE tahun_ajaran_id=?').run(id);
      db.prepare('DELETE FROM tahun_ajaran WHERE id=?').run(id);
    })();
    dbm.logAudit(req.user, 'HAPUS', 'tahun_ajaran', `Menghapus tahun ajaran id ${id} beserta BKU terkait`);
    res.redirect(req.BASE + '/tahun-ajaran?ok=' + encodeURIComponent('Tahun ajaran dihapus.'));
  });

  /* ================= MASTER BKU ================= */
  get('/bku', (req, res) => {
    guard(req, res, 'bku', 'view');
    const c = ctx(req);
    const taId = req.query.get('ta') || c.taId;
    const rows = dbm.allBku(taId);
    const taList = dbm.allTahun();
    const editId = req.query.get('edit');
    const ed = editId ? db.prepare('SELECT * FROM bku WHERE id=?').get(editId) : null;
    const late = modalCollector();

    const kodeUmum = dbm.nextBkuKode('umum');
    const kodeKegiatan = dbm.nextBkuKode('kegiatan');
    const bkuForm = (b, modalId) => `<form method="post" action="${c.base}/bku/save" id="f${modalId}">
      <input type="hidden" name="id" value="${b ? b.id : ''}">
      <div class="field"><label>Nama BKU</label><input name="nama" value="${esc(b ? b.nama : '')}" required placeholder="BKU Umum / BKU UKK"></div>
      <div class="row2">
        <div class="field"><label>Jenis</label><select name="jenis">
          <option value="umum" ${b && b.jenis === 'umum' ? 'selected' : ''}>BKU Umum / Buku Pembantu</option>
          <option value="kegiatan" ${b && b.jenis === 'kegiatan' ? 'selected' : ''}>BKU Kegiatan Khusus</option></select></div>
        <div class="field"><label>Kode <span class="t-sub">(otomatis)</span></label>
          <input name="kode" value="${esc(b ? b.kode : kodeUmum)}" data-kode-auto
            data-kode-umum="${esc(kodeUmum)}" data-kode-kegiatan="${esc(kodeKegiatan)}"
            ${b ? '' : 'readonly'} placeholder="U01">
          <div class="hint">Terisi otomatis mengikuti urutan kode terakhir (U01, U02, … / K01, K02, …).</div></div>
      </div>
      <div class="field"><label>Tahun Ajaran</label><select name="tahun_ajaran_id">${ui.selectOptions(taList, b ? b.tahun_ajaran_id : taId)}</select></div>
      <div class="field"><label>Saldo Awal</label>${ui.moneyInput('saldo_awal', b ? b.saldo_awal : 0)}</div>
    </form>`;

    const content = `<div class="card">
      <div class="card-head">
        <div><h3>Master Buku Kas (BKU)</h3><div class="sub">Umum, buku pembantu & kegiatan khusus per tahun ajaran</div></div>
        <div class="toolbar">
          <form method="get" action="${c.base}/bku" class="flex" style="gap:8px">
            <select name="ta" data-autosubmit>${taList.map(t => `<option value="${t.id}" ${String(t.id) === String(taId) ? 'selected' : ''}>TA ${esc(t.nama)}</option>`).join('')}</select>
          </form>
          ${c.can('bku', 'create') ? ui.openModalBtn('mAdd', 'Tambah BKU') : ''}
        </div>
      </div>
      ${rows.length ? `<div class="table-wrap sticky-head"><table><thead><tr><th>Kode</th><th>Nama BKU</th><th>Jenis</th><th class="num">Saldo Awal</th><th class="num">Saldo Akhir</th><th>Status</th><th class="right">Aksi</th></tr></thead><tbody>
        ${rows.map(b => {
      const saldo = dbm.bkuSaldo(b.id);
      return `<tr>
          <td class="t-sub mono">${esc(b.kode || '-')}</td>
          <td class="t-strong">${esc(b.nama)}</td>
          <td>${b.jenis === 'umum' ? ui.badge('Umum', 'blue') : ui.badge('Kegiatan', 'orange')}</td>
          <td class="num">${rupiah(b.saldo_awal)}</td>
          <td class="num t-strong" style="color:${saldo === 0 ? 'var(--muted)' : 'var(--ink)'}">${rupiah(saldo)}</td>
          <td>${ui.bkuStatusBadge(b.status)}${b.status !== 'aktif' ? `<div class="t-sub">${esc(b.ditutup_at || '')}</div>` : ''}</td>
          <td class="right nowrap">
            <a class="btn btn-sm btn-primary" href="${c.base}/bku/${b.id}" title="Rincian BKU">${ui.icon('eye')}Detail</a>
            ${b.status === 'aktif'
          ? (c.can('bku', 'edit') ? `<button class="btn btn-sm" data-open="mTutup${b.id}">${ui.icon('lock')}Tutup BKU</button>` : '')
          : `<a class="btn btn-sm" href="${c.base}/bku/${b.id}/berita-acara" target="_blank">${ui.icon('printer')}Berita Acara</a>
               ${c.can('bku', 'edit') ? `<form method="post" action="${c.base}/bku/buka" style="display:inline" data-confirm="Buka kembali BKU ${esc(b.nama)}? Transaksi dapat diinput kembali."><input type="hidden" name="id" value="${b.id}"><button class="btn btn-sm btn-soft">${ui.icon('unlock')}Buka</button></form>` : ''}`}
            ${c.can('bku', 'edit') ? `<button class="btn btn-sm btn-icon" data-open="mEdit${b.id}" title="Edit">${ui.icon('edit')}</button>` : ''}
            ${c.can('bku', 'delete') ? `<form method="post" action="${c.base}/bku/delete" style="display:inline" data-confirm="Hapus BKU ${esc(b.nama)} beserta transaksinya?"><input type="hidden" name="id" value="${b.id}"><button class="btn btn-sm btn-danger">${ui.icon('trash')}</button></form>` : ''}
          </td></tr>
          ${late('mEdit' + b.id, {
            title: 'Edit BKU', body: bkuForm(b, 'mEdit' + b.id),
            footer: `<button class="btn" data-close="mEdit${b.id}">Batal</button><button class="btn btn-primary" form="f${'mEdit' + b.id}">Simpan</button>`
          })}
          ${b.status === 'aktif' ? late('mTutup' + b.id, {
            title: 'Tutup BKU — ' + b.nama,
            body: `<div class="alert info">${ui.icon('info')}<div>Setelah ditutup, BKU <b>terkunci</b>: transaksi tidak dapat ditambah, diedit, atau dihapus. Super Admin/Bendahara masih dapat membuka kembali bila diperlukan.</div></div>
              <div class="kv">
                <dt>Saldo awal</dt><dd>${rupiah(b.saldo_awal)}</dd>
                <dt>Total pemasukan</dt><dd>${rupiah(dbm.bkuTotals(b.id).masuk)}</dd>
                <dt>Total pengeluaran</dt><dd>${rupiah(dbm.bkuTotals(b.id).keluar)}</dd>
                <dt>Saldo akhir</dt><dd style="color:var(--o-700);font-size:15px">${rupiah(saldo)}</dd>
              </div>
              ${saldo !== 0 ? `<div class="alert warn mt-2">${ui.icon('alert')}<div>Saldo akhir belum Rp 0. Idealnya BKU ditutup saat saldo sudah nol, namun Anda tetap boleh menutup sekarang.</div></div>`
                : `<div class="alert ok mt-2">${ui.icon('check')}<div>Saldo akhir sudah Rp 0 — BKU siap ditutup.</div></div>`}
              <form method="post" action="${c.base}/bku/tutup" id="fTutup${b.id}">
                <input type="hidden" name="id" value="${b.id}">
                <div class="field"><label>Nomor Berita Acara</label><input name="berita_acara_no" value="BA/${esc(b.kode || 'BKU')}/${new Date().getFullYear()}"></div>
                <div class="field"><label>Tanggal Tutup</label><input type="date" name="tanggal" value="${todayISO()}"></div>
              </form>`,
            footer: `<button class="btn" data-close="mTutup${b.id}">Batal</button><button class="btn btn-primary" form="fTutup${b.id}">${ui.icon('lock')}Tutup BKU Sekarang</button>`
          }) : ''}`;
    }).join('')}
      </tbody></table></div>` : ui.emptyState('Belum ada BKU', 'Tambahkan BKU atau pilih tahun ajaran lain.')}
      ${late.html()}
      <div class="alert info mt-2">${ui.icon('info')}<div><b>Buku Pembantu Bank, Buku Pembantu Pajak, Buku Pembantu Tunai, Rekap BHP, dan Rekap Barang Modal</b>
        tidak lagi diinput manual dan tidak memiliki saldo awal — isinya terbentuk otomatis dari transaksi.
        Lihat rekapitulasinya di <a href="${c.base}/laporan?r=pembantu"><b>Laporan → Buku Pembantu &amp; Rekap</b></a>.</div></div>
      <p class="help mt-2">BKU berstatus <b>ditutup</b> terkunci dari input, edit, dan hapus transaksi. Gunakan tombol Berita Acara untuk mencetak dokumen penutupan kas ber-kop sekolah.</p>
    </div>
    ${ui.modal('mAdd', {
      title: 'Tambah BKU', body: bkuForm(ed, 'mAdd'),
      footer: `<button class="btn" data-close="mAdd">Batal</button><button class="btn btn-primary" form="fmAdd">Simpan</button>`
    })}`;
    page(req, res, { title: 'Master BKU', sub: 'Buku kas umum & kegiatan khusus', active: 'bku', content });
  });

  post('/bku/save', (req, res) => {
    const isEdit = !!req.body.id;
    if (!guard(req, res, 'bku', isEdit ? 'edit' : 'create')) return;
    const { id, nama, jenis, kode, tahun_ajaran_id, saldo_awal } = req.body;
    if (!nama || !tahun_ajaran_id) return res.redirect(req.BASE + '/bku?err=' + encodeURIComponent('Nama dan tahun ajaran wajib diisi.'));
    // kode BKU otomatis bila kosong (U01, U02, … / K01, K02, …)
    const kodeFinal = String(kode || '').trim() || dbm.nextBkuKode(jenis);
    if (isEdit) {
      db.prepare('UPDATE bku SET nama=?,jenis=?,kode=?,tahun_ajaran_id=?,saldo_awal=? WHERE id=?')
        .run(nama, jenis, kodeFinal, tahun_ajaran_id, lib.parseMoney(saldo_awal), id);
    } else {
      const urut = db.prepare('SELECT COALESCE(MAX(urutan),0)+1 u FROM bku').get().u;
      db.prepare("INSERT INTO bku (nama,jenis,kode,tahun_ajaran_id,saldo_awal,status,urutan,created_at,auto_mode) VALUES (?,?,?,?,?,'aktif',?,?,?)")
        .run(nama, jenis, kodeFinal, tahun_ajaran_id, lib.parseMoney(saldo_awal), urut, nowStamp(), dbm.isAutoBkuNama(nama) ? 1 : 0);
    }
    dbm.logAudit(req.user, isEdit ? 'EDIT' : 'TAMBAH', 'bku', `${isEdit ? 'Edit' : 'Tambah'} BKU ${nama}`);
    res.redirect(req.BASE + '/bku?ta=' + tahun_ajaran_id + '&ok=' + encodeURIComponent('BKU disimpan.'));
  });

  post('/bku/delete', (req, res) => {
    if (!guard(req, res, 'bku', 'delete')) return;
    const id = req.body.id;
    const b = db.prepare('SELECT * FROM bku WHERE id=?').get(id);
    db.transaction(() => {
      db.prepare('DELETE FROM transaksi WHERE bku_id=?').run(id);
      db.prepare('DELETE FROM bku WHERE id=?').run(id);
    })();
    dbm.logAudit(req.user, 'HAPUS', 'bku', `Menghapus BKU ${b ? b.nama : id} beserta transaksinya`);
    res.redirect(req.BASE + '/bku?ok=' + encodeURIComponent('BKU dihapus.'));
  });

  post('/bku/tutup', (req, res) => {
    if (!guard(req, res, 'bku', 'edit')) return;
    const { id, berita_acara_no, tanggal } = req.body;
    const b = db.prepare('SELECT * FROM bku WHERE id=?').get(id);
    if (!b) return res.redirect(req.BASE + '/bku?err=' + encodeURIComponent('BKU tidak ditemukan.'));
    const saldo = dbm.bkuSaldo(id);
    db.prepare("UPDATE bku SET status='ditutup', ditutup_at=?, ditutup_oleh=?, saldo_akhir_tutup=?, berita_acara_no=? WHERE id=?")
      .run(tanggal || todayISO(), req.user.nama, saldo, berita_acara_no || '', id);
    dbm.logAudit(req.user, 'TUTUP BUKU', 'bku', `Menutup BKU ${b.nama} dengan saldo akhir ${rupiah(saldo)}`);
    res.redirect(req.BASE + '/bku/' + id + '/berita-acara?ok=' + encodeURIComponent('BKU berhasil ditutup. Berita acara siap dicetak.'));
  });

  post('/bku/buka', (req, res) => {
    if (!guard(req, res, 'bku', 'edit')) return;
    const b = db.prepare('SELECT * FROM bku WHERE id=?').get(req.body.id);
    db.prepare("UPDATE bku SET status='aktif', ditutup_at=NULL, ditutup_oleh=NULL WHERE id=?").run(req.body.id);
    dbm.logAudit(req.user, 'BUKA BUKU', 'bku', `Membuka kembali BKU ${b ? b.nama : req.body.id}`);
    res.redirect(req.BASE + '/bku?ok=' + encodeURIComponent('BKU dibuka kembali dan dapat diinput.'));
  });

  /* berita acara */
  get('/bku/:id/berita-acara', (req, res) => {
    guard(req, res, 'bku', 'view');
    const c = ctx(req);
    const b = db.prepare('SELECT * FROM bku WHERE id=?').get(req.params.id);
    if (!b) return res.notFound();
    const ta = db.prepare('SELECT * FROM tahun_ajaran WHERE id=?').get(b.tahun_ajaran_id) || {};
    const t = dbm.bkuTotals(b.id);
    const saldo = dbm.bkuSaldo(b.id);
    const body = `
      <p style="font-size:12.8px;text-align:justify;margin-top:14px">Pada hari ini, ${lib.tglID(b.ditutup_at || todayISO())}, telah dilakukan penutupan <b>${esc(b.nama)}</b>
      ${b.jenis === 'umum' ? '(Buku Kas Umum)' : '(Buku Kas Kegiatan Khusus)'} untuk Tahun Ajaran <b>${esc(ta.nama || '-')}</b> oleh Bendahara sekolah, dengan rincian sebagai berikut:</p>
      <table class="doc-tbl">
        <tbody>
          <tr><td style="width:46%">Saldo Awal</td><td class="num">${rupiah(b.saldo_awal)}</td></tr>
          <tr><td>Total Penerimaan / Pemasukan</td><td class="num">${rupiah(t.masuk)}</td></tr>
          <tr><td>Total Pengeluaran</td><td class="num">${rupiah(t.keluar)}</td></tr>
          <tr><td><b>Saldo Akhir Buku Kas</b></td><td class="num"><b>${rupiah(b.saldo_akhir_tutup ?? saldo)}</b></td></tr>
        </tbody>
      </table>
      <p style="font-size:12.8px;text-align:justify">Berdasarkan pemeriksaan fisik kas dan rekening bank, saldo akhir tersebut ${Number(b.saldo_akhir_tutup ?? saldo) === 0
        ? 'adalah <b>Rp 0 (nol rupiah)</b> sehingga seluruh dana telah dipertanggungjawabkan dan buku kas dinyatakan <b>ditutup</b>.'
        : 'sesuai dengan catatan pembukuan dan dinyatakan <b>ditutup</b>. Sisa saldo diteruskan menjadi saldo awal periode berikutnya.'}</p>
      <p style="font-size:12.8px">Buku kas yang telah ditutup tidak dapat diubah kembali kecuali dibuka oleh Super Admin/Bendahara Utama.</p>
      ${ui.signBlock(c.settings, { tempat: '', tanggal: lib.tglID(b.ditutup_at || todayISO()) }).replace('<div class="sig"><div>Mengetahui,</div>', '<div class="sig"><div>Mengetahui,</div>')}`;
    res.html(ui.docPage({
      settings: c.settings, base: c.base,
      title: 'Berita Acara Penutupan Kas / BKU',
      no: `Nomor: ${b.berita_acara_no || 'BA/' + (b.kode || 'BKU') + '/' + new Date().getFullYear()}`,
      body, backHref: '/bku', orient: 'portrait', selfPath: req.url
    }));
  });

  /* ================= KODE REKENING (CoA) ================= */
  get('/coa', (req, res) => {
    guard(req, res, 'coa', 'view');
    const c = ctx(req);
    const rows = db.prepare('SELECT * FROM coa ORDER BY kategori, kode').all();
    const late = modalCollector();
    const KAT = dbm.KATEGORI_LABEL;
    /* kode rekening otomatis: nomor berikutnya yang belum dipakai pada kategori terkait */
    const nextKode = (kat) => {
      const rowsK = db.prepare('SELECT kode FROM coa WHERE kategori=?').all(kat).map(r => String(r.kode));
      const base = kat === 'pendapatan' ? '4.1' : kat === 'pengeluaran' ? '5.2' : kat === 'pajak' ? '2.1' : '9.1';
      const list = rowsK.filter(k => k.startsWith(base + '.'));
      if (!list.length) return base + '.01';
      // utamakan pola xx.yy.zz → naikkan segmen terakhir
      const last = list.map(k => k.split('.')).sort((a, b) => {
        const na = Number(a[a.length - 1]) || 0, nb = Number(b[b.length - 1]) || 0;
        return na - nb;
      }).pop();
      const n = (Number(last[last.length - 1]) || 0) + 1;
      return `${base}.${String(n).padStart(2, '0')}`;
    };
    const kodeBaru = {}; Object.keys(KAT).forEach(k => { kodeBaru[k] = nextKode(k); });
    const form = (x, mid) => `<form method="post" action="${c.base}/coa/save" id="f${mid}">
      <input type="hidden" name="id" value="${x ? x.id : ''}">
      <div class="row2"><div class="field"><label>Kode Rekening</label><input name="kode" value="${esc(x ? x.kode : '')}" required placeholder="4.1.01"></div>
      <div class="field"><label>Kategori</label><select name="kategori">${Object.entries(KAT).map(([k, v]) => `<option value="${k}" ${x && x.kategori === k ? 'selected' : ''}>${esc(v[0])}</option>`).join('')}</select></div></div>
      <div class="field"><label>Nama Rekening</label><input name="nama" value="${esc(x ? x.nama : '')}" required placeholder="Penerimaan SPP"></div>
    </form>`;
    let body = '';
    for (const [k, [label, tone]] of Object.entries(KAT)) {
      const list = rows.filter(r => r.kategori === k);
      body += `<div class="card mb-3"><div class="card-head"><div><h3>${esc(label)}</h3><div class="sub">${list.length} kode rekening</div></div>
        ${c.can('coa', 'create') ? ui.openModalBtn('mAdd_' + k, 'Tambah Kode', 'btn btn-sm') : ''}</div>
        ${list.length ? `<div class="table-wrap sticky-head"><table><thead><tr><th style="width:120px">Kode</th><th>Nama Rekening</th><th class="num">Transaksi</th><th class="right">Aksi</th></tr></thead><tbody>
        ${list.map(r => {
        const n = db.prepare('SELECT COUNT(*) c FROM transaksi WHERE coa_id=?').get(r.id).c;
        return `<tr><td class="mono t-strong">${esc(r.kode)}</td><td>${esc(r.nama)}</td><td class="num">${n}</td>
          <td class="right nowrap">${c.can('coa', 'edit') ? `<button class="btn btn-sm btn-icon" data-open="mE${r.id}">${ui.icon('edit')}</button>` : ''}
          ${c.can('coa', 'delete') ? `<form method="post" action="${c.base}/coa/delete" style="display:inline" data-confirm="Hapus kode rekening ${esc(r.kode)}?"><input type="hidden" name="id" value="${r.id}"><button class="btn btn-sm btn-danger">${ui.icon('trash')}</button></form>` : ''}</td></tr>
          ${late('mE' + r.id, {
          title: 'Edit Kode Rekening', body: form(r, 'mE' + r.id),
          footer: `<button class="btn" data-close="mE${r.id}">Batal</button><button class="btn btn-primary" form="fmE${r.id}">Simpan</button>`
        })}`;
      }).join('')}</tbody></table></div>` : ui.emptyState('Belum ada kode rekening di kategori ini')}
      ${late.html()}
      </div>
      ${ui.modal('mAdd_' + k, {
        title: 'Tambah Kode Rekening',
        body: `<form method="post" action="${c.base}/coa/save" id="fadd_${k}">
          <div class="row2"><div class="field"><label>Kode Rekening (otomatis)</label><input name="kode" value="${esc(kodeBaru[k])}" required>
            <div class="hint">Nomor berikutnya yang belum dipakai — boleh diubah manual.</div></div>
          <div class="field"><label>Kategori</label><input value="${esc(label)}" readonly><input type="hidden" name="kategori" value="${k}"></div></div>
          <div class="field"><label>Nama Rekening</label><input name="nama" required></div></form>`,
        footer: `<button class="btn" data-close="mAdd_${k}">Batal</button><button class="btn btn-primary" form="fadd_${k}">Simpan</button>`
      })}`;
    }
    page(req, res, { title: 'Kode Rekening (CoA)', sub: 'Bagan akun pendapatan, belanja, pajak & mutasi kas', active: 'coa', content: body });
  });

  post('/coa/save', (req, res) => {
    if (!guard(req, res, 'coa', req.body.id ? 'edit' : 'create')) return;
    const { id, kode, nama, kategori } = req.body;
    if (!kode || !nama || !kategori) return res.redirect(req.BASE + '/coa?err=' + encodeURIComponent('Semua kolom wajib diisi.'));
    if (id) db.prepare('UPDATE coa SET kode=?,nama=?,kategori=? WHERE id=?').run(kode, nama, kategori, id);
    else db.prepare('INSERT INTO coa (kode,nama,kategori,aktif) VALUES (?,?,?,1)').run(kode, nama, kategori);
    dbm.logAudit(req.user, id ? 'EDIT' : 'TAMBAH', 'coa', `${id ? 'Edit' : 'Tambah'} kode rekening ${kode} ${nama}`);
    res.redirect(req.BASE + '/coa?ok=' + encodeURIComponent('Kode rekening disimpan.'));
  });

  post('/coa/delete', (req, res) => {
    if (!guard(req, res, 'coa', 'delete')) return;
    const used = db.prepare('SELECT COUNT(*) c FROM transaksi WHERE coa_id=?').get(req.body.id).c;
    if (used) return res.redirect(req.BASE + '/coa?err=' + encodeURIComponent('Kode rekening sudah dipakai transaksi, tidak bisa dihapus.'));
    const r = db.prepare('SELECT * FROM coa WHERE id=?').get(req.body.id);
    db.prepare('DELETE FROM coa WHERE id=?').run(req.body.id);
    dbm.logAudit(req.user, 'HAPUS', 'coa', `Menghapus kode rekening ${r ? r.kode + ' ' + r.nama : req.body.id}`);
    res.redirect(req.BASE + '/coa?ok=' + encodeURIComponent('Kode rekening dihapus.'));
  });

  /* ================= ANGGARAN (RAPBS/RKAS) ================= */
  get('/anggaran', (req, res) => {
    guard(req, res, 'anggaran', 'view');
    const c = ctx(req);
    const taId = req.query.get('ta') || c.taId;
    const taList = dbm.allTahun();
    const coaList = db.prepare(`SELECT * FROM coa WHERE kategori IN (${dbm.COA_EXPENSE_KATEGORI.map(() => '?').join(',')}) ORDER BY kode`).all(...dbm.COA_EXPENSE_KATEGORI);
    const rows = db.prepare(`SELECT a.*, c.kode, c.nama,
        COALESCE((SELECT SUM(t.nominal) FROM transaksi t JOIN bku b ON b.id=t.bku_id
          WHERE t.coa_id=a.coa_id AND t.status='posted' AND t.jenis='pengeluaran' AND b.tahun_ajaran_id=a.tahun_ajaran_id),0) realisasi
        FROM anggaran a JOIN coa c ON c.id=a.coa_id WHERE a.tahun_ajaran_id=? ORDER BY c.kode`).all(taId);
    const totalPagu = rows.reduce((s, r) => s + r.pagu, 0);
    const totalReal = rows.reduce((s, r) => s + r.realisasi, 0);
    const editRow = req.query.get('edit') ? rows.find(r => String(r.id) === String(req.query.get('edit'))) : null;
    const late = modalCollector();

    const content = `<div class="kpi-grid mb-3">
      <div class="kpi ic-orange"><div class="ico">${ui.icon('target')}</div><div class="lbl">Total Pagu</div><div class="val">${rupiah(totalPagu)}</div><div class="meta">${rows.length} kode rekening belanja</div></div>
      <div class="kpi ic-red"><div class="ico">${ui.icon('down')}</div><div class="lbl">Realisasi</div><div class="val">${rupiah(totalReal)}</div><div class="meta">Pengeluaran terposting</div></div>
      <div class="kpi ic-green"><div class="ico">${ui.icon('wallet')}</div><div class="lbl">Sisa Pagu</div><div class="val">${rupiah(totalPagu - totalReal)}</div><div class="meta">${totalPagu ? ((totalReal / totalPagu) * 100).toFixed(1) : 0}% terserap</div></div>
      <div class="kpi ic-amber"><div class="ico">${ui.icon('alert')}</div><div class="lbl">Rekening Over</div><div class="val">${rows.filter(r => r.realisasi > r.pagu).length}</div><div class="meta">Melebihi pagu anggaran</div></div>
    </div>
    <div class="card">
      <div class="card-head"><div><h3>Pagu Anggaran per Kode Rekening</h3><div class="sub">Tahun ajaran ${esc((taList.find(t => String(t.id) === String(taId)) || {}).nama || '-')}</div></div>
        <div class="toolbar">
          <form method="get" action="${c.base}/anggaran"><select name="ta" data-autosubmit>${taList.map(t => `<option value="${t.id}" ${String(t.id) === String(taId) ? 'selected' : ''}>TA ${esc(t.nama)}</option>`).join('')}</select></form>
          ${c.can('anggaran', 'create') ? ui.openModalBtn('mAdd', 'Tambah Pagu') : ''}
        </div></div>
      ${rows.length ? `<div class="table-wrap sticky-head"><table><thead><tr><th>Kode</th><th>Uraian Belanja</th><th class="num">Pagu</th><th class="num">Realisasi</th><th class="num">Sisa</th><th style="width:170px">Serapan</th><th class="right">Aksi</th></tr></thead>
        <tbody>${rows.map(r => {
      const pct = r.pagu > 0 ? (r.realisasi / r.pagu) * 100 : (r.realisasi > 0 ? 100 : 0);
      const over = r.realisasi > r.pagu;
      return `<tr><td class="mono">${esc(r.kode)}</td><td>${esc(r.nama)}${over ? ' ' + ui.badge('Over', 'red') : ''}</td>
        <td class="num">${rupiah(r.pagu)}</td><td class="num">${rupiah(r.realisasi)}</td>
        <td class="num" style="color:${over ? 'var(--red)' : 'var(--green)'}">${rupiah(r.pagu - r.realisasi)}</td>
        <td>${ui.prog(pct, over ? 'r' : pct > 85 ? '' : 'g')}<div class="t-sub">${pct.toFixed(0)}%</div></td>
        <td class="right nowrap">${c.can('anggaran', 'edit') ? `<button class="btn btn-sm btn-icon" data-open="mE${r.id}">${ui.icon('edit')}</button>` : ''}
          ${c.can('anggaran', 'delete') ? `<form method="post" action="${c.base}/anggaran/delete" style="display:inline" data-confirm="Hapus pagu ${esc(r.nama)}?"><input type="hidden" name="id" value="${r.id}"><button class="btn btn-sm btn-danger">${ui.icon('trash')}</button></form>` : ''}</td></tr>
        ${late('mE' + r.id, {
        title: 'Edit Pagu Anggaran',
        body: `<form method="post" action="${c.base}/anggaran/save" id="fa${r.id}"><input type="hidden" name="id" value="${r.id}"><input type="hidden" name="tahun_ajaran_id" value="${r.tahun_ajaran_id}">
          <div class="field"><label>Kode Rekening</label><input value="${esc(r.kode + ' — ' + r.nama)}" readonly></div>
          <div class="field"><label>Pagu Anggaran (Rp)</label>${ui.moneyInput('pagu', r.pagu, 'required')}</div>
          <div class="field"><label>Keterangan</label><input name="keterangan" value="${esc(r.keterangan || '')}"></div></form>`,
        footer: `<button class="btn" data-close="mE${r.id}">Batal</button><button class="btn btn-primary" form="fa${r.id}">Simpan</button>`
      })}`;
    }).join('')}</tbody>
        <tfoot><tr><td colspan="2">TOTAL</td><td class="num">${rupiah(totalPagu)}</td><td class="num">${rupiah(totalReal)}</td><td class="num">${rupiah(totalPagu - totalReal)}</td><td colspan="2"></td></tr></tfoot>
      </table></div>` : ui.emptyState('Belum ada pagu anggaran', 'Tambahkan pagu per kode rekening belanja untuk tahun ajaran ini.')}
      ${late.html()}
      <div class="alert warn mt-2">${ui.icon('alert')}<div><b>Sistem peringatan otomatis:</b> saat input transaksi pengeluaran, aplikasi menampilkan peringatan jika nominal melebihi sisa plafon anggaran kode rekening yang dipilih.</div></div>
    </div>
    ${ui.modal('mAdd', {
      title: 'Tambah / Perbarui Pagu Anggaran',
      body: `<form method="post" action="${c.base}/anggaran/save" id="fAdd">
        <div class="field"><label>Tahun Ajaran</label><select name="tahun_ajaran_id">${ui.selectOptions(taList, taId)}</select></div>
        <div class="field"><label>Kode Rekening Belanja</label><select name="coa_id" required><option value="">— Pilih —</option>${coaList.map(x => `<option value="${x.id}">${esc(x.kode + ' · ' + x.nama)}</option>`).join('')}</select></div>
        <div class="field"><label>Pagu Anggaran (Rp)</label>${ui.moneyInput('pagu', '', 'required placeholder="0"')}</div>
        <div class="field"><label>Keterangan</label><input name="keterangan" placeholder="Opsional"></div>
        <div class="hint">Jika kode rekening sudah punya pagu pada tahun ajaran ini, nilainya akan diperbarui.</div></form>`,
      footer: `<button class="btn" data-close="mAdd">Batal</button><button class="btn btn-primary" form="fAdd">Simpan</button>`
    })}`;
    page(req, res, { title: 'Anggaran RAPBS / RKAS', sub: 'Pagu & realisasi per kode rekening', active: 'anggaran', content });
  });

  post('/anggaran/save', (req, res) => {
    if (!guard(req, res, 'anggaran', req.body.id ? 'edit' : 'create')) return;
    const { id, tahun_ajaran_id, coa_id, pagu, keterangan } = req.body;
    if (!tahun_ajaran_id || !coa_id) return res.redirect(req.BASE + '/anggaran?err=' + encodeURIComponent('Tahun ajaran dan kode rekening wajib dipilih.'));
    if (id) {
      db.prepare('UPDATE anggaran SET pagu=?,keterangan=? WHERE id=?').run(lib.parseMoney(pagu), keterangan || '', id);
    } else {
      db.prepare('INSERT INTO anggaran (tahun_ajaran_id,coa_id,pagu,keterangan) VALUES (?,?,?,?) ON CONFLICT(tahun_ajaran_id,coa_id) DO UPDATE SET pagu=excluded.pagu, keterangan=excluded.keterangan')
        .run(tahun_ajaran_id, coa_id, lib.parseMoney(pagu), keterangan || '');
    }
    dbm.logAudit(req.user, 'EDIT', 'anggaran', `Menetapkan pagu anggaran Rp ${lib.num(lib.parseMoney(pagu))} (coa ${coa_id}, TA ${tahun_ajaran_id})`);
    res.redirect(req.BASE + '/anggaran?ta=' + tahun_ajaran_id + '&ok=' + encodeURIComponent('Pagu anggaran disimpan.'));
  });

  post('/anggaran/delete', (req, res) => {
    if (!guard(req, res, 'anggaran', 'delete')) return;
    db.prepare('DELETE FROM anggaran WHERE id=?').run(req.body.id);
    dbm.logAudit(req.user, 'HAPUS', 'anggaran', `Menghapus pagu anggaran id ${req.body.id}`);
    res.redirect(req.BASE + '/anggaran?ok=' + encodeURIComponent('Pagu anggaran dihapus.'));
  });

  /* ================= SALDO AWAL ================= */
  get('/saldo-awal', (req, res) => {
    guard(req, res, 'saldo_awal', 'view');
    const c = ctx(req);
    const taId = req.query.get('ta') || c.taId;
    const taList = dbm.allTahun();
    const rows = dbm.allBku(taId);
    const editable = c.can('saldo_awal', 'edit');
    const content = `<div class="card">
      <div class="card-head"><div><h3>Input Saldo Awal BKU</h3><div class="sub">Saldo awal setiap buku kas pada tahun ajaran berjalan</div></div>
        <form method="get" action="${c.base}/saldo-awal"><select name="ta" data-autosubmit>${taList.map(t => `<option value="${t.id}" ${String(t.id) === String(taId) ? 'selected' : ''}>TA ${esc(t.nama)}</option>`).join('')}</select></form>
      </div>
      ${rows.length ? `<form method="post" action="${c.base}/saldo-awal/save">
        <input type="hidden" name="ta" value="${taId}">
        <div class="table-wrap"><table><thead><tr><th>Kode</th><th>Nama BKU</th><th>Jenis</th><th class="num" style="width:200px">Saldo Awal (Rp)</th><th class="num">Saldo Saat Ini</th><th>Status</th></tr></thead><tbody>
        ${rows.map(b => {
      const saldo = dbm.bkuSaldo(b.id);
      const locked = b.status !== 'aktif';
      return `<tr><td class="mono">${esc(b.kode || '-')}</td><td class="t-strong">${esc(b.nama)}</td>
        <td>${b.jenis === 'umum' ? ui.badge('Umum', 'blue') : ui.badge('Kegiatan', 'orange')}</td>
        <td class="num">${editable && !locked ? ui.moneyInput('sa_' + b.id, b.saldo_awal) : rupiah(b.saldo_awal)}</td>
        <td class="num t-strong">${rupiah(saldo)}</td>
        <td>${ui.bkuStatusBadge(b.status)}</td></tr>`;
    }).join('')}</tbody></table></div>
        ${editable ? `<div class="form-actions"><button class="btn btn-primary">${ui.icon('save')}Simpan Saldo Awal</button></div>` : `<div class="alert info mt-2">${ui.icon('lock')}<div>Role Anda hanya dapat melihat saldo awal.</div></div>`}
      </form>` : ui.emptyState('Belum ada BKU pada tahun ajaran ini')}
      <div class="alert info mt-2">${ui.icon('info')}<div><b>Buku Pembantu Bank, Pajak, Tunai, Rekap BHP, dan Barang Modal tidak memiliki saldo awal.</b>
        Akun tersebut hanya menerima rekapitulasi otomatis dari transaksi dan dapat dilihat di menu <a href="${c.base}/laporan?r=pembantu"><b>Laporan → Buku Pembantu</b></a>.</div></div>
      <p class="help mt-2">Saldo awal BKU yang sudah ditutup terkunci. Buka kembali BKU di menu Master BKU bila perlu penyesuaian.</p>
    </div>`;
    page(req, res, { title: 'Saldo Awal', sub: 'Saldo pembuka tiap buku kas', active: 'saldo_awal', content });
  });

  post('/saldo-awal/save', (req, res) => {
    if (!guard(req, res, 'saldo_awal', 'edit')) return;
    const ta = req.body.ta;
    let n = 0;
    db.transaction(() => {
      for (const [k, v] of Object.entries(req.body)) {
        if (!k.startsWith('sa_')) continue;
        const id = k.slice(3);
        const b = db.prepare('SELECT * FROM bku WHERE id=?').get(id);
        if (!b || b.status !== 'aktif') continue;
        db.prepare('UPDATE bku SET saldo_awal=? WHERE id=?').run(lib.parseMoney(v), id);
        n++;
      }
    })();
    dbm.logAudit(req.user, 'EDIT', 'saldo_awal', `Memperbarui saldo awal ${n} BKU (TA ${ta})`);
    res.redirect(req.BASE + '/saldo-awal?ta=' + ta + '&ok=' + encodeURIComponent('Saldo awal diperbarui.'));
  });

  /* ================= ASET RIIL ================= */
  get('/aset', (req, res) => {
    guard(req, res, 'aset', 'view');
    const c = ctx(req);
    const taId = c.taId;
    const kas = dbm.asetKas(taId);
    const piutangPeg = dbm.piutangPegawaiTotal(taId);
    const sppTampil = dbm.sppTampil();
    const spp = sppTampil ? dbm.sppTunggakan(taId) : 0;
    const sertTampil = dbm.sertifikasiTampil();
    const sertTotal = dbm.piutangLainTotal('Sertifikasi', taId);
    const lainnyaTampil = dbm.piutangLainnyaTampil();
    const lainnyaKat = dbm.piutangLainnyaAsetRows(taId, { all: true });
    const lainnyaTotal = dbm.piutangLainnyaAset(taId);
    const pinjamList = dbm.pinjamanList(taId, { all: true });
    const pinjamTampil = pinjamList.filter(p => Number(p.akun.tampil === undefined ? 1 : p.akun.tampil) !== 0);
    const pinjTotal = pinjamTampil.reduce((s2, p) => s2 + p.saldo, 0);
    const lain = dbm.asetLain(taId, { all: true });
    const lainTampil = lain.filter(x => Number(x.tampil === undefined ? 1 : x.tampil) !== 0);
    const lainTotal = lainTampil.reduce((s2, x) => s2 + Number(x.saldo || 0), 0);
    const totalAset = kas.bank + kas.tunai + piutangPeg + spp + (sertTampil ? sertTotal : 0) + lainnyaTotal + pinjTotal + lainTotal;
    const ta = c.ta;
    const saldoDana = dbm.totalSaldoDana(ta ? ta.id : null);
    const editable = c.can('aset', 'edit');
    const late = modalCollector();

    const toggleAkun = (id, tampil) => editable
      ? `<form method="post" action="${c.base}/aset/akun/toggle" class="toggle-form" style="border:0;padding:0;gap:8px">
          <input type="hidden" name="id" value="${id}">
          <span class="t-sub">Aset Riil</span>
          <label class="toggle-switch"><input type="checkbox" name="tampil" value="1" ${tampil ? 'checked' : ''} onchange="this.form.submit()"><i></i></label>
        </form>` : (tampil ? ui.badge('Tampil', 'green') : ui.badge('Disembunyikan', 'gray'));
    const rowAset = (nama, sumber, auto, adj, saldo, aksi = '') => `<tr>
      <td class="t-strong">${nama}</td>
      <td class="t-sub">${sumber}</td>
      <td class="num t-sub">${auto === null ? '—' : rupiah(auto)}</td>
      <td class="num t-sub">${adj === null ? '—' : rupiah(adj)}</td>
      <td class="num t-strong">${rupiah(saldo)}</td>
      <td class="right nowrap">${aksi}</td></tr>`;

    const content = `<div class="kpi-grid mb-3">
      <div class="kpi ic-orange"><div class="ico">${ui.icon('bank')}</div><div class="lbl">Kas Bank</div><div class="val" style="font-size:19px">${rupiah(kas.bank)}</div><div class="meta">Otomatis ${rupiah(kas.bankAuto)} · penyesuaian ${rupiah(kas.bankAdj)}</div></div>
      <div class="kpi ic-blue"><div class="ico">${ui.icon('wallet')}</div><div class="lbl">Kas Tunai</div><div class="val" style="font-size:19px">${rupiah(kas.tunai)}</div><div class="meta">Otomatis ${rupiah(kas.tunaiAuto)} · penyesuaian ${rupiah(kas.tunaiAdj)}</div></div>
      <div class="kpi ic-green"><div class="ico">${ui.icon('card')}</div><div class="lbl">Piutang Pegawai</div><div class="val" style="font-size:19px">${rupiah(piutangPeg)}</div><div class="meta">Sisa pinjaman pegawai</div></div>
      <div class="kpi ic-amber"><div class="ico">${ui.icon('chart')}</div><div class="lbl">Total Aset Riil</div><div class="val" style="font-size:19px">${rupiah(totalAset)}</div><div class="meta">Seluruh komponen aset</div></div>
    </div>

    <div class="split">
      <div class="card">
        <div class="card-head"><div><h3>Aset Aktual Riil</h3><div class="sub">Kas bank &amp; tunai bisa disesuaikan manual bila ada selisih riil</div></div>${ui.badge('Live', 'green')}</div>
        <div class="table-wrap"><table><thead><tr><th>Jenis Aset</th><th>Sumber</th><th class="num">Otomatis (TA ini)</th><th class="num">Saldo Awal / Penyesuaian</th><th class="num">Saldo Aset</th><th class="right">Aksi</th></tr></thead><tbody>
          ${rowAset('Kas Bank', 'Transaksi transfer terposting', kas.bankAuto, kas.bankAdj, kas.bank)}
          ${rowAset('Kas Tunai', 'Transaksi tunai terposting', kas.tunaiAuto, kas.tunaiAdj, kas.tunai)}
          ${rowAset('Piutang Pegawai', 'Sisa pinjaman pegawai', null, null, piutangPeg)}
          ${sppTampil ? rowAset('Piutang SPP Siswa', 'Tunggakan SPP (ditagih − diterima)', null, null, spp) : `<tr><td class="t-strong">Piutang SPP Siswa</td><td class="t-sub" colspan="4"><span class="badge gray plain">disembunyikan</span> — matikan sakelar di panel kanan untuk menampilkan</td><td></td></tr>`}
          ${sertTampil ? rowAset('Piutang Sertifikasi', 'Sisa tagihan piutang lain-lain (sertifikasi)', null, null, sertTotal, `<a class="btn btn-sm" href="${c.base}/piutang-lain">${ui.icon('eye')}Kelola</a>`) : `<tr><td class="t-strong">Piutang Sertifikasi</td><td class="t-sub" colspan="4"><span class="badge gray plain">disembunyikan</span> — nyalakan sakelar di panel kanan untuk menampilkan di rekonsiliasi kas</td><td></td></tr>`}
          ${lainnyaKat.map(k => rowAset(
        'Piutang Lainnya — ' + esc(k.nama) + (k.tampil && lainnyaTampil ? '' : ' <span class="badge gray plain">disembunyikan</span>'),
        `Sisa piutang kategori ${esc(k.nama)}`, null, null, k.sisa,
        `<a class="btn btn-sm" href="${c.base}/piutang-lainnya?kategori=${k.id}">${ui.icon('eye')}Kelola</a>`
        + (editable ? `<form method="post" action="${c.base}/piutang-lainnya/kategori/toggle" style="display:inline" data-autoswitch>
            <input type="hidden" name="id" value="${k.id}">
            <label class="toggle-switch" title="Tampilkan di Akun Aset Riil"><input type="checkbox" name="tampil_aset" value="1" ${k.tampil ? 'checked' : ''} onchange="this.form.submit()"><i></i></label>
          </form>` : ''))).join('')}
          ${rowAset('Pinjaman Kegiatan', 'Saldo awal + mutasi pinjaman', null, null, pinjTotal,
      pinjamList.length ? `<span class="badge gray plain">${pinjamList.length} akun</span>` : '')}
          ${pinjamList.map(p => rowAset(esc(p.akun.nama) + (Number(p.akun.tampil) === 0 ? ' <span class="badge gray plain">disembunyikan</span>' : ''),
          `Buku bantu pinjaman · ${p.rows.length} transaksi`, null, null, p.saldo,
          `<a class="btn btn-sm" href="${c.base}/aset/akun/${p.akun.id}">${ui.icon('eye')}Rincian</a>`
          + (editable ? `<form method="post" action="${c.base}/aset/pinjaman/delete" style="display:inline" data-confirm="Hapus akun ${esc(p.akun.nama)} beserta transaksinya?"><input type="hidden" name="id" value="${p.akun.id}"><button class="btn btn-sm btn-danger">${ui.icon('trash')}</button></form>` : '')
          + `<div style="min-width:130px">${toggleAkun(p.akun.id, Number(p.akun.tampil) !== 0)}</div>`)).join('')}
          ${lain.map(x => rowAset(esc(x.nama) + (Number(x.tampil) === 0 ? ' <span class="badge gray plain">disembunyikan</span>' : ''),
          `Akun aset · ${x.jumlah_mutasi || 0} transaksi`, null, null, Number(x.saldo || 0),
          `<a class="btn btn-sm" href="${c.base}/aset/akun/${x.id}">${ui.icon('eye')}Rincian</a>` +
          (editable ? `<form method="post" action="${c.base}/aset/lain/delete" style="display:inline" data-confirm="Hapus akun aset ${esc(x.nama)} beserta transaksinya?"><input type="hidden" name="id" value="${x.id}"><button class="btn btn-sm btn-danger">${ui.icon('trash')}</button></form>` : '')
          + `<div style="min-width:130px">${toggleAkun(x.id, Number(x.tampil) !== 0)}</div>`)).join('')}
        </tbody><tfoot><tr><td colspan="4">TOTAL ASET RIIL</td><td class="num">${rupiah(totalAset)}</td><td></td></tr></tfoot></table></div>
        <p class="help mt-2">Kas Bank &amp; Kas Tunai dihitung otomatis dari transaksi terposting <b>tahun pelajaran yang dipilih</b>, ditambah saldo awal hasil rollover dari tahun pelajaran sebelumnya. Bila hasil opnam/rekening riil berbeda, isi angka riil pada panel <b>Penyesuaian Kas</b> — sistem menyimpan selisihnya sebagai penyesuaian sehingga transaksi baru tetap tersinkron.</p>
      </div>
      <div>
        <div class="card mb-3">
          <div class="card-head"><div><h3>Posisi Dana vs Aset</h3><div class="sub">Perbandingan posisi kas</div></div></div>
          <div class="kv">
            <dt>Saldo dana BKU (TA ${esc(ta ? ta.nama : '-')})</dt><dd>${rupiah(saldoDana)}</dd>
            <dt>Total aset riil</dt><dd>${rupiah(totalAset)}</dd>
            <dt>Selisih</dt><dd style="color:${Math.abs(saldoDana - totalAset) < 1 ? 'var(--green)' : 'var(--red)'}">${rupiah(saldoDana - totalAset)}</dd>
          </div>
          ${Math.abs(saldoDana - totalAset) > 1 ? `<div class="alert warn mt-2">${ui.icon('alert')}<div>Ada selisih antara saldo dana BKU dan aset riil. Periksa transaksi, saldo awal, atau nilai pinjaman kegiatan.</div></div>`
        : `<div class="alert ok mt-2">${ui.icon('check')}<div>Saldo dana BKU seimbang dengan total aset riil.</div></div>`}
          <a class="btn btn-block mt-2" href="${c.base}/laporan?r=neraca">Lihat Rekonsiliasi Kas</a>
          <a class="btn btn-block mt-1" href="${c.base}/portal" target="_blank">${ui.icon('link')}Portal Cek Tagihan Orang Tua</a>
          ${editable ? `<form method="post" action="${c.base}/aset/dedupe" class="mt-1" data-confirm="Bersihkan duplikasi akun pinjaman/aset yang nominalnya sama? Akun duplikat hanya disembunyikan (tidak dihapus).">
            <button class="btn btn-block">${ui.icon('refresh')}Bersihkan Duplikasi Akun</button></form>` : ''}
        </div>

        ${editable ? `<div class="card mb-3">
          <div class="card-head"><div><h3>Penyesuaian Kas</h3><div class="sub">Isi nilai riil kas bank &amp; kas tunai</div></div></div>
          <form method="post" action="${c.base}/aset/saldo">
            <div class="field"><label>Kas Bank Riil (Rp)</label>${ui.moneyInput('bank_riil', kas.bank)}
              <div class="hint">Otomatis dari transaksi: ${rupiah(kas.bankAuto)}</div></div>
            <div class="field"><label>Kas Tunai Riil (Rp)</label>${ui.moneyInput('tunai_riil', kas.tunai)}
              <div class="hint">Otomatis dari transaksi: ${rupiah(kas.tunaiAuto)}</div></div>
            <button class="btn btn-primary btn-block">${ui.icon('save')}Simpan Penyesuaian Kas</button>
          </form></div>` : ''}

        <div class="card mb-3">
          <div class="card-head"><div><h3>Piutang SPP Siswa</h3><div class="sub">Tampilkan / sembunyikan pada laporan &amp; dashboard</div></div></div>
          <form method="post" action="${c.base}/aset/toggle-spp" class="toggle-form" style="border:0;padding:0">
            <div>
              <div class="t-strong">Tampilkan Piutang SPP</div>
              <div class="t-sub">${sppTampil ? 'Saat ini tampil di dashboard & rekonsiliasi kas' : 'Saat ini disembunyikan dari dashboard & rekonsiliasi kas'}</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" name="tampil" value="1" ${sppTampil ? 'checked' : ''} ${editable ? '' : 'disabled'} onchange="this.form.submit()">
              <i></i>
            </label>
            <noscript><button class="btn btn-sm">Simpan</button></noscript>
          </form>
        </div>

        <div class="card mb-3">
          <div class="card-head"><div><h3>Piutang Sertifikasi</h3><div class="sub">Tampilkan / sembunyikan pada laporan Rekonsiliasi Kas</div></div></div>
          <form method="post" action="${c.base}/aset/toggle-sertifikasi" class="toggle-form" style="border:0;padding:0">
            <div>
              <div class="t-strong">Tampilkan Piutang Sertifikasi di Rekonsiliasi Kas</div>
              <div class="t-sub">${sertTampil ? 'Saat ini tampil pada rekonsiliasi kas & halaman aset' : 'Saat ini disembunyikan dari rekonsiliasi kas'} · sisa ${rupiah(sertTotal)}</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" name="tampil" value="1" ${sertTampil ? 'checked' : ''} ${editable ? '' : 'disabled'} onchange="this.form.submit()">
              <i></i>
            </label>
            <noscript><button class="btn btn-sm">Simpan</button></noscript>
          </form>
          <a class="btn btn-sm mt-2" href="${c.base}/piutang-lain">${ui.icon('card')}Kelola Piutang Sertifikasi</a>
        </div>

        <div class="card mb-3">
          <div class="card-head"><div><h3>Piutang Lainnya</h3><div class="sub">Kategori piutang fleksibel · tampilkan / sembunyikan pada Akun Aset Riil</div></div></div>
          <form method="post" action="${c.base}/piutang-lainnya/toggle-aset" class="toggle-form" style="border:0;padding:0">
            <div>
              <div class="t-strong">Tampilkan di Akun Aset Riil: ${lainnyaTampil ? 'Ya' : 'Tidak'}</div>
              <div class="t-sub">${lainnyaTampil ? 'Sisa piutang kategori aktif ikut dihitung sebagai aset riil' : 'Disembunyikan dari perhitungan aset riil (data tetap tersimpan)'} · dihitung ${rupiah(lainnyaTotal)}</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" name="tampil" value="1" ${lainnyaTampil ? 'checked' : ''} ${editable ? '' : 'disabled'} onchange="this.form.submit()">
              <i></i>
            </label>
            <noscript><button class="btn btn-sm">Simpan</button></noscript>
          </form>
          ${lainnyaKat.length ? `<div class="list mt-2">${lainnyaKat.map(k => `<div class="list-row">
            <div style="min-width:0"><div class="nm">${esc(k.nama)}</div><div class="mt">${rupiah(k.sisa)}</div></div>
            <div class="toolbar">${k.tampil ? ui.badge('Ya', 'green') : ui.badge('Tidak', 'gray')}</div></div>`).join('')}</div>` : ''}
          <a class="btn btn-sm mt-2" href="${c.base}/piutang-lainnya">${ui.icon('layers')}Kelola Piutang Lainnya</a>
        </div>

        <div class="card mb-3">
          <div class="card-head"><div><h3>Akun Aset Lainnya</h3><div class="sub">Akun aset dinamis dengan buku bantu transaksi sendiri</div></div>
            ${editable ? ui.openModalBtn('mAsetLain', 'Tambah Akun Aset', 'btn btn-sm btn-primary') : ''}</div>
          ${lain.length ? `<div class="list">${lain.map(x => `<div class="list-row">
            <div style="min-width:0"><div class="nm">${esc(x.nama)}</div>
              <div class="mt">${rupiah(x.saldo)} · ${x.jumlah_mutasi || 0} transaksi</div></div>
            <div class="toolbar">
              <a class="btn btn-sm" href="${c.base}/aset/akun/${x.id}">${ui.icon('book')}Ledger</a>
              ${editable ? `<button class="btn btn-sm" data-open="mAkun${x.id}">${ui.icon('edit')}Nama</button>` : ''}
            </div></div>`).join('')}</div>`
        : `<div class="help">Belum ada akun aset tambahan. Contoh: tanah, kendaraan, peralatan laboratorium.</div>`}
        </div>

        <div class="card">
          <div class="card-head"><div><h3>Pinjaman Kegiatan</h3><div class="sub">Setiap akun punya buku bantu transaksi &amp; saldo berjalan · TA ${esc(ta ? ta.nama : '-')}</div></div>
            ${editable ? ui.openModalBtn('mPinjamanBaru', 'Tambah Akun Pinjaman', 'btn btn-sm btn-primary') : ''}</div>
          ${pinjamList.length ? `<div class="list">${pinjamList.map(p => `<div class="list-row">
            <div style="min-width:0"><div class="nm">${esc(p.akun.nama)}</div>
              <div class="mt">Saldo awal ${rupiah(p.awal)} · masuk ${rupiah(p.masuk)} · keluar ${rupiah(p.keluar)}</div></div>
            <div class="right nowrap" style="text-align:right">
              <div style="font-weight:800">${rupiah(p.saldo)}</div>
              <div class="toolbar" style="margin-top:6px">
                <a class="btn btn-sm" href="${c.base}/aset/akun/${p.akun.id}">${ui.icon('book')}Ledger</a>
                ${editable ? `<button class="btn btn-sm" data-open="mAkun${p.akun.id}">${ui.icon('edit')}Nama</button>` : ''}
                ${editable ? `<form method="post" action="${c.base}/aset/pinjaman/delete" style="display:inline" data-confirm="Hapus akun pinjaman ${esc(p.akun.nama)}? Seluruh transaksi buku bantu akun ini (${p.rows.length} baris) juga akan dihapus permanen. Tindakan ini tidak dapat dibatalkan."><input type="hidden" name="id" value="${p.akun.id}"><button class="btn btn-sm btn-danger" title="Hapus akun pinjaman">${ui.icon('trash')}Hapus</button></form>` : ''}
              </div>
            </div></div>`).join('')}</div>`
        : `<div class="help">Belum ada akun pinjaman kegiatan. Tambahkan akun seperti "Pinjaman Kegiatan Renovasi Lab".</div>`}
          <div class="alert info mt-2">${ui.icon('info')}<div>Saldo akun pinjaman &amp; aset lain dihitung otomatis dari <b>saldo awal + transaksi masuk − transaksi keluar</b>, lalu langsung memperbarui Total Aset Riil pada dashboard &amp; laporan posisi keuangan.</div></div>
        </div>
      </div>
    </div>
    ${editable ? ui.modal('mAsetLain', {
      title: 'Tambah Akun Aset Riil',
      body: `<form method="post" action="${c.base}/aset/lain/save" id="fAsetLain">
        <div class="field"><label>Nama Akun Aset</label><input name="nama" required placeholder="Contoh: Tanah & Bangunan"></div>
        <div class="field"><label>Nilai / Saldo Awal (Rp)</label>${ui.moneyInput('saldo', '', 'placeholder="0"')}
          <div class="hint">Nilai awal akun. Transaksi masuk/keluar berikutnya dicatat di halaman Ledger akun ini.</div></div>
        <div class="field"><label>Keterangan</label><input name="keterangan" placeholder="Opsional"></div>
      </form>`,
      footer: `<button class="btn" data-close="mAsetLain">Batal</button><button class="btn btn-primary" form="fAsetLain">${ui.icon('save')}Simpan Akun</button>`
    }) + ui.modal('mPinjamanBaru', {
      title: 'Tambah Akun Pinjaman Kegiatan',
      body: `<form method="post" action="${c.base}/aset/pinjaman/tambah" id="fPinjamanBaru">
        <div class="field"><label>Nama Akun / Kegiatan Pinjaman</label>
          <input name="nama" required placeholder="Contoh: Pinjaman Kegiatan Renovasi Lab"></div>
        <div class="field"><label>Saldo Awal (Rp)</label>${ui.moneyInput('saldo', '', 'placeholder="0"')}
          <div class="hint">Boleh dikosongkan bila seluruh dana dicatat lewat transaksi masuk/keluar.</div></div>
        <div class="field"><label>Keterangan</label><input name="keterangan" placeholder="Tujuan / penanggung jawab kegiatan"></div>
      </form>`,
      footer: `<button class="btn" data-close="mPinjamanBaru">Batal</button><button class="btn btn-primary" form="fPinjamanBaru">${ui.icon('save')}Simpan Akun Pinjaman</button>`
    }) + [...pinjamList.map(p => ({ id: p.akun.id, nama: p.akun.nama, jenis: 'pinjaman', awal: p.awal, keterangan: p.akun.keterangan || '' })),
      ...lain.map(x => ({ id: x.id, nama: x.nama, jenis: 'lain', awal: x.saldo_awal, keterangan: x.keterangan || '' }))]
      .map(a => ui.modal('mAkun' + a.id, {
        title: 'Edit Nama Akun ' + (a.jenis === 'pinjaman' ? 'Pinjaman Kegiatan' : 'Aset'),
        body: `<form method="post" action="${c.base}/aset/akun/${a.id}/ubah" id="fAkun${a.id}">
          <div class="field"><label>Nama Akun</label><input name="nama" value="${esc(a.nama)}" required></div>
          <div class="field"><label>Saldo Awal (Rp)</label>${ui.moneyInput('saldo_awal', a.awal)}</div>
          <div class="field"><label>Keterangan</label><input name="keterangan" value="${esc(a.keterangan)}"></div>
          <div class="hint">Mengubah saldo awal akan menggeser saldo akhir akun ini. Riwayat transaksi tidak berubah.</div>
        </form>`,
        footer: `<button class="btn" data-close="mAkun${a.id}">Batal</button><button class="btn btn-primary" form="fAkun${a.id}">Simpan Perubahan</button>`
      })).join('') : ''}`;
    page(req, res, { title: 'Aset Riil', sub: 'Kas bank, tunai, piutang, pinjaman & aset lainnya', active: 'aset', content });
  });

  /* penyesuaian nilai riil kas bank & tunai */
  post('/aset/saldo', (req, res) => {
    if (!guard(req, res, 'aset', 'edit')) return;
    const taRow = dbm.taOf(req) || dbm.activeTahun();
    const taId = taRow ? taRow.id : null;
    const kas = dbm.asetKas(taId);
    const bank = lib.parseMoney(req.body.bank_riil);
    const tunai = lib.parseMoney(req.body.tunai_riil);
    if (bank < 0 || tunai < 0) return res.redirect(req.BASE + '/aset?err=' + encodeURIComponent('Nilai kas tidak boleh negatif.'));
    const delta = { bank: bank - kas.bankAuto, tunai: tunai - kas.tunaiAuto };
    db.transaction(() => {
      for (const jenis of ['bank', 'tunai']) {
        const row = db.prepare('SELECT * FROM aset WHERE jenis=? AND (tahun_ajaran_id=? OR tahun_ajaran_id IS NULL) ORDER BY id LIMIT 1').get(jenis, taId || 0);
        if (row) db.prepare('UPDATE aset SET saldo=?, tahun_ajaran_id=COALESCE(tahun_ajaran_id,?) WHERE id=?').run(delta[jenis], taId, row.id);
        else db.prepare('INSERT INTO aset (nama,jenis,saldo,keterangan,tahun_ajaran_id) VALUES (?,?,?,?,?)')
          .run(jenis === 'bank' ? 'Kas Bank' : 'Kas Tunai', jenis, delta[jenis], 'Penyesuaian manual', taId);
      }
    })();
    dbm.logAudit(req.user, 'EDIT', 'aset',
      `Penyesuaian kas: bank ${rupiah(bank)} (otomatis ${rupiah(kas.bankAuto)}, selisih ${rupiah(delta.bank)}), tunai ${rupiah(tunai)} (otomatis ${rupiah(kas.tunaiAuto)}, selisih ${rupiah(delta.tunai)})`);
    res.redirect(req.BASE + '/aset?ok=' + encodeURIComponent('Penyesuaian kas riil disimpan.'));
  });

  /* saldo awal pinjaman kegiatan (manual) */
  post('/aset/save', (req, res) => {
    if (!guard(req, res, 'aset', 'edit')) return;
    const val = lib.parseMoney(req.body.pinjaman);
    const ket = req.body.keterangan || '';
    const row = db.prepare("SELECT * FROM aset WHERE jenis='pinjaman' LIMIT 1").get();
    if (row) db.prepare('UPDATE aset SET saldo=?,keterangan=? WHERE id=?').run(val, ket, row.id);
    else db.prepare("INSERT INTO aset (nama,jenis,saldo,keterangan) VALUES ('Pinjaman Kegiatan','pinjaman',?,?)").run(val, ket);
    dbm.logAudit(req.user, 'EDIT', 'aset', `Menyesuaikan saldo awal pinjaman kegiatan menjadi Rp ${lib.num(val)}`);
    res.redirect(req.BASE + '/aset?ok=' + encodeURIComponent('Saldo awal pinjaman kegiatan diperbarui.'));
  });

  /* akun aset riil lainnya */
  post('/aset/lain/save', (req, res) => {
    if (!guard(req, res, 'aset', 'edit')) return;
    const nama = String(req.body.nama || '').trim();
    if (!nama) return res.redirect(req.BASE + '/aset?err=' + encodeURIComponent('Nama akun aset wajib diisi.'));
    const saldo = lib.parseMoney(req.body.saldo);
    const taRow = dbm.taOf(req) || dbm.activeTahun();
    db.prepare("INSERT INTO aset (nama,jenis,saldo,keterangan,tahun_ajaran_id) VALUES (?, 'lain', ?, ?, ?)")
      .run(nama, saldo, String(req.body.keterangan || '').trim(), taRow ? taRow.id : null);
    dbm.logAudit(req.user, 'TAMBAH', 'aset', `Menambah akun aset riil ${nama} senilai ${rupiah(saldo)}`);
    res.redirect(req.BASE + '/aset?ok=' + encodeURIComponent('Akun aset riil ditambahkan.'));
  });

  post('/aset/lain/delete', (req, res) => {
    if (!guard(req, res, 'aset', 'edit')) return;
    const row = db.prepare("SELECT * FROM aset WHERE id=? AND jenis='lain'").get(req.body.id);
    if (row) {
      const anak = db.prepare('SELECT * FROM pinjaman_mutasi WHERE aset_id=?').all(row.id);
      dbm.trashAdd('aset', row, { user: req.user, label: `Akun aset ${row.nama}`, extra: { children: [{ tabel: 'pinjaman_mutasi', rows: anak }] } });
      db.transaction(() => {
        db.prepare('DELETE FROM pinjaman_mutasi WHERE aset_id=?').run(row.id);
        db.prepare('DELETE FROM aset WHERE id=?').run(row.id);
      })();
    }
    dbm.logAudit(req.user, 'HAPUS', 'aset', `Menghapus akun aset riil ${row ? row.nama : req.body.id}`);
    res.redirect(req.BASE + '/aset?ok=' + encodeURIComponent('Akun aset dihapus.'));
  });

  post('/aset/akun/toggle', (req, res) => {
    if (!guard(req, res, 'aset', 'edit')) return;
    const a = db.prepare('SELECT * FROM aset WHERE id=?').get(req.body.id);
    if (!a) return res.redirect(req.BASE + '/aset?err=' + encodeURIComponent('Akun aset tidak ditemukan.'));
    const tampil = req.body.tampil ? 1 : 0;
    db.prepare('UPDATE aset SET tampil=? WHERE id=?').run(tampil, a.id);
    dbm.logAudit(req.user, 'EDIT', 'aset', `Akun aset ${a.nama} ${tampil ? 'ditampilkan pada' : 'disembunyikan dari'} Aset Riil`);
    res.redirect(req.BASE + '/aset?ok=' + encodeURIComponent(`Akun "${a.nama}" ${tampil ? 'ditampilkan pada' : 'disembunyikan dari'} laporan Aset Riil.`));
  });

  post('/aset/dedupe', (req, res) => {
    if (!guard(req, res, 'aset', 'edit')) return;
    const n = dbm.dedupeAset(dbm.taOf(req)?.id || null);
    dbm.logAudit(req.user, 'EDIT', 'aset', `Membersihkan ${n} duplikasi akun aset (disembunyikan)`);
    res.redirect(req.BASE + '/aset?ok=' + encodeURIComponent(n ? `${n} akun duplikat disembunyikan dari laporan aset.` : 'Tidak ada duplikasi akun yang perlu dibersihkan.'));
  });

  post('/aset/toggle-sertifikasi', (req, res) => {
    if (!guard(req, res, 'aset', 'edit')) return;
    const val = req.body.tampil ? '1' : '0';
    dbm.setSetting('tampil_piutang_sertifikasi', val);
    dbm.logAudit(req.user, 'EDIT', 'aset', `Piutang sertifikasi ${val === '1' ? 'ditampilkan' : 'disembunyikan'} pada laporan & dashboard`);
    res.redirect(req.BASE + '/aset?ok=' + encodeURIComponent(`Piutang sertifikasi ${val === '1' ? 'ditampilkan pada' : 'disembunyikan dari'} rekonsiliasi kas.`));
  });

  /* hapus akun pinjaman kegiatan beserta buku bantunya */
  post('/aset/pinjaman/delete', (req, res) => {
    if (!guard(req, res, 'aset', 'edit')) return;
    const row = db.prepare("SELECT * FROM aset WHERE id=? AND jenis='pinjaman'").get(req.body.id);
    if (!row) return res.redirect(req.BASE + '/aset?err=' + encodeURIComponent('Akun pinjaman tidak ditemukan.'));
    const n = db.prepare('SELECT COUNT(*) c FROM pinjaman_mutasi WHERE aset_id=?').get(row.id).c;
    const anak = db.prepare('SELECT * FROM pinjaman_mutasi WHERE aset_id=?').all(row.id);
    dbm.trashAdd('aset', row, { user: req.user, label: `Akun pinjaman ${row.nama}`, extra: { children: [{ tabel: 'pinjaman_mutasi', rows: anak }] } });
    db.transaction(() => {
      db.prepare('DELETE FROM pinjaman_mutasi WHERE aset_id=?').run(row.id);
      db.prepare('DELETE FROM aset WHERE id=?').run(row.id);
    })();
    dbm.logAudit(req.user, 'HAPUS', 'aset', `Menghapus akun pinjaman kegiatan ${row.nama} beserta ${n} transaksi buku bantu`);
    res.redirect(req.BASE + '/aset?ok=' + encodeURIComponent(`Akun pinjaman "${row.nama}" beserta ${n} transaksi buku bantu dihapus.`));
  });

  post('/aset/toggle-spp', (req, res) => {
    if (!guard(req, res, 'aset', 'edit')) return;
    const val = req.body.tampil ? '1' : '0';
    dbm.setSetting('tampil_piutang_spp', val);
    dbm.logAudit(req.user, 'EDIT', 'aset', `Piutang SPP siswa ${val === '1' ? 'ditampilkan' : 'disembunyikan'} pada laporan & dashboard`);
    res.redirect(req.BASE + '/aset?ok=' + encodeURIComponent(`Piutang SPP siswa ${val === '1' ? 'ditampilkan' : 'disembunyikan'}.`));
  });

  /* ================= DEMO SEED ================= */
  post('/demo/seed', (req, res) => {
    if (!guard(req, res, 'backup', 'create')) return;
    seedDemo(req.user);
    res.redirect(req.BASE + '/?ok=' + encodeURIComponent('Data contoh berhasil dimuat.'));
  });
};

function seedDemo(user) {
  const dbm2 = require('./../db');
  const db = dbm2.db;
  const { nowStamp } = require('./../lib');
  const ta = db.prepare('SELECT * FROM tahun_ajaran ORDER BY aktif DESC, id DESC LIMIT 1').get();
  if (!ta) return;
  const bk = n => db.prepare('SELECT * FROM bku WHERE nama=? AND tahun_ajaran_id=?').get(n, ta.id);
  const coa = k => db.prepare('SELECT * FROM coa WHERE kode=?').get(k);
  const bkuUmum = bk('BKU Umum'), bkuUkk = bk('BKU UKK'), bkuInfak = bk('Infak Jumat');

  /** tanggal pada bulan berjalan dikurangi `offset` bulan */
  const dIn = (offset, day) => {
    const now = new Date();
    const base = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    let dd = Math.min(day, lastDay);
    if (offset === 0) dd = Math.max(1, Math.min(dd, now.getDate()));
    return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  };

  const seed = db.transaction(() => {
    if (bkuUmum) db.prepare('UPDATE bku SET saldo_awal=25000000 WHERE id=?').run(bkuUmum.id);
    const pagu = [['5.1.01', 96000000], ['5.2.01', 42000000], ['5.2.02', 35000000], ['5.2.03', 18000000], ['5.2.04', 12000000], ['5.2.05', 25000000]];
    for (const [k, v] of pagu) {
      const c = coa(k);
      if (c) db.prepare('INSERT INTO anggaran (tahun_ajaran_id,coa_id,pagu,keterangan) VALUES (?,?,?,?) ON CONFLICT(tahun_ajaran_id,coa_id) DO UPDATE SET pagu=excluded.pagu').run(ta.id, c.id, v, 'Pagu demo');
    }
    // [bku, jenis, metode, kode, nominal, uraian, pihak, offsetBulan, hari]
    const rows = [
      [bkuUmum, 'pemasukan', 'transfer', '4.1.04', 45000000, 'Penerimaan Dana BOS Tahap I', 'Kemenag', 1, 5],
      [bkuUmum, 'pemasukan', 'tunai', '4.1.01', 18500000, 'Penerimaan SPP bulan lalu', 'Wali Murid', 1, 10],
      [bkuUmum, 'pengeluaran', 'transfer', '5.1.01', 22500000, 'Honorarium guru & tenaga kependidikan', 'Tim Sekolah', 1, 15],
      [bkuUmum, 'pengeluaran', 'tunai', '5.2.01', 4250000, 'Belanja ATK & bahan habis pakai', 'Toko Sinar Jaya', 1, 20],
      [bkuUmum, 'pengeluaran', 'transfer', '5.2.02', 12750000, 'Pembelian 2 unit komputer laboratorium', 'CV Digital Mandiri', 0, 3],
      [bkuUmum, 'pengeluaran', 'tunai', '5.2.04', 1850000, 'Transport pengawas ujian', 'Panitia Ujian', 0, 6],
      [bkuUkk, 'pemasukan', 'tunai', '4.1.03', 6000000, 'Setoran dana UKK dari siswa', 'Bendahara UKK', 1, 8],
      [bkuUkk, 'pengeluaran', 'tunai', '5.2.05', 2750000, 'Kegiatan studi wisata siswa', 'Panitia UKK', 1, 18],
      [bkuInfak, 'pemasukan', 'tunai', '4.1.02', 1250000, 'Infak Jumat pekan ke-1', 'Jamaah', 0, 4],
      [bkuInfak, 'pengeluaran', 'tunai', '5.2.05', 750000, 'Santunan siswa yatim', 'Koordinator Sosial', 0, 9]
    ];
    let i = 0;
    for (const [b, jenis, metode, kode, nominal, uraian, pihak, off, hari] of rows) {
      if (!b) continue;
      const c = coa(kode);
      i++;
      db.prepare(`INSERT INTO transaksi (bku_id,tanggal,jenis,metode,no_bukti,coa_id,nominal,uraian,nama_pihak,status,created_by,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,'posted',?,?)`).run(b.id, dIn(off, hari), jenis, metode,
        `${b.kode}/DEMO/${String(i).padStart(3, '0')}`, c ? c.id : null, nominal, uraian, pihak, user.id, nowStamp());
    }
    const p = db.prepare("INSERT INTO piutang (nama_pegawai,tanggal_utang,nominal,tanggal_bayar,status,bku_id,keterangan,created_at,tahun_ajaran_id) VALUES (?,?,?,?,?,?,?,?,?)");
    p.run('Budi Santoso, S.Pd.', dIn(1, 7), 2500000, null, 'belum', bkuUmum ? bkuUmum.id : null, 'Pinjaman darurat renovasi rumah', nowStamp(), ta.id);
    p.run('Rina Wulandari, M.Pd.', dIn(1, 12), 1500000, null, 'belum', bkuUmum ? bkuUmum.id : null, 'Biaya pengobatan keluarga', nowStamp(), ta.id);
    p.run('Ahmad Subekti', dIn(2, 9), 750000, dIn(1, 22), 'lunas', bkuUmum ? bkuUmum.id : null, 'Pinjaman konsumsi rapat', nowStamp(), ta.id);
    const m = new Date().getMonth() + 1;
    // penerimaan SPP dari transaksi demo sudah tercatat otomatis → sisanya saja yang jadi nilai historis (manual)
    const autoSpp = dbm2.sppTerimaMap(ta.id);
    for (let b = 1; b <= Math.min(12, m + 1); b++) {
      const ditagih = 32500000, target = b < m ? 31200000 : 28500000;
      const auto = Number(autoSpp[b] || 0);
      const manual = Math.max(0, target - auto);
      db.prepare('INSERT INTO spp (tahun_ajaran_id,bulan,total_ditagihkan,total_diterima,keterangan,diterima_manual) VALUES (?,?,?,?,?,?) ON CONFLICT(tahun_ajaran_id,bulan) DO UPDATE SET total_ditagihkan=excluded.total_ditagihkan, total_diterima=excluded.total_diterima, diterima_manual=excluded.diterima_manual')
        .run(ta.id, b, ditagih, manual + auto, '', manual);
    }
  });
  seed();

  // tutup otomatis bulan lalu (Opsi A) agar demo memperlihatkan riwayat tutup bulanan + berita acara
  const last = dbm2.prevPeriode(dbm2.currentPeriode());
  const bkuWithLast = db.prepare(`SELECT DISTINCT bku_id FROM transaksi WHERE substr(tanggal,1,7)=?`).all(last);
  for (const r of bkuWithLast) {
    try {
      db.transaction(() => dbm2.closePeriode(r.bku_id, last, { metode: 'rollover' }, user))();
    } catch (e) { /* lewati bila BKU sudah tutup total */ }
  }
  dbm2.logAudit(user, 'TAMBAH', 'backup', 'Memuat data contoh (demo) keuangan sekolah');
}