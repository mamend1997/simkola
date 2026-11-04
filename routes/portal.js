'use strict';
/* Portal publik cek tagihan orang tua — tanpa login, verifikasi Nama + Tanggal Lahir */
const reminder = require('../reminder');

module.exports = ({ get, post, dbm, lib, ui, guard, flashUrl, saas }) => {
  const { db } = dbm;
  const { esc, rupiah, tglID } = lib;
  /** alamat portal dapat diubah di menu Portal Publik (default: portal) */
  const slug = () => dbm.portalSlugs().siswa;
  const url = (base, sub = '') => `${base}/${slug()}${sub}`;
  /** teks portal (judul tab + sub-judul banner) — default dari Super Admin Pusat */
  const textOf = settings => (saas && saas.portalText ? saas.portalText(settings) : {
    title: 'Cek Tagihan', subtitle: 'PORTAL CEK TAGIHAN IURAN SISWA', tokenTitle: 'Cek Tagihan'
  });
  /**
   * Judul tab terpusat: `{{ prefix }} · {{ nama sekolah }}`.
   * Prefix = `portal_page_title`, atau `portal_token_title` bila URL membawa token terverifikasi.
   * Tidak ada judul yang di-hardcode di komponen halaman (dulu sempat "Tagihan Siswa").
   */
  const titleOf = (settings, token) => (saas && saas.portalTitleFull
    ? saas.portalTitleFull(settings, { token: !!token })
    : { prefix: 'Cek Tagihan', school: String((settings || {}).sekolah_nama || 'Sekolah'), full: 'Cek Tagihan · Sekolah' });

  const NAMA_BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const bulanNama = m => NAMA_BULAN[(Number(m) - 1 + 12) % 12] || '-';
  /** label bulan mengikuti tahun ajaran grup ("Juli 2025") */
  function bulanTahun(bulan, ta) {
    const b = Number(bulan) || 0;
    const start = String((ta && ta.tanggal_mulai) || '').slice(0, 10);
    const sy = start ? Number(start.slice(0, 4)) : new Date().getFullYear();
    const sm = start ? Number(start.slice(5, 7)) : 7;
    return `${bulanNama(b)} ${b >= sm ? sy : sy + 1}`;
  }

  function normalizeDate(s) {
    const v = String(s || '').trim();
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(v);
    if (!m) return null;
    const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  /**
   * Kerangka halaman portal publik.
   * `token` = true bila tautan pribadi (?token=…) sudah TERVERIFIKASI → memakai
   * `portal_token_title` (bila diisi sekolah) sebagai prefix judul tab.
   * `canonical` = alamat publik tanpa query (dipakai og:url agar token tidak tersebar).
   */
  function shell({ base, settings, content, token = false, canonical = '' }) {
    const logo = settings.sekolah_logo
      ? `<img src="${esc(settings.sekolah_logo)}"${ui.logoSrcset(settings, "52px")} alt="Logo" width="52" height="52" fetchpriority="high" decoding="async">`
      : `<div class="p-logo-ph">${esc((settings.sekolah_nama || 'S').charAt(0))}</div>`;
    const footerId = ui.identitasFooter(settings);
    const txt = textOf(settings);
    const judul = titleOf(settings, token);
    /* ---- Open Graph / Twitter: pratinjau WhatsApp & media sosial ---- */
    const ogImage = (() => {
      const raw = String(settings.sekolah_logo || '').trim();
      if (!raw) return '';
      return /^https?:\/\//i.test(raw) ? raw : (/^https?:\/\//i.test(canonical) ? canonical.replace(/^(https?:\/\/[^/]+).*$/, '$1') + raw : '');
    })();
    const ogDesc = [txt.subtitle, settings.sekolah_nama].filter(Boolean).join(' — ').slice(0, 200);
    const metaOg = `
<meta name="description" content="${esc(ogDesc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(settings.sekolah_nama || 'Sekolah')}">
<meta property="og:title" content="${esc(judul.full)}">
<meta property="og:description" content="${esc(ogDesc)}">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ''}
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ''}
<meta property="og:locale" content="id_ID">
<meta name="twitter:card" content="${ogImage ? 'summary' : 'summary'}">
<meta name="twitter:title" content="${esc(judul.full)}">
<meta name="twitter:description" content="${esc(ogDesc)}">
${ogImage ? `<meta name="twitter:image" content="${esc(ogImage)}">` : ''}
${token ? '<meta name="robots" content="noindex,nofollow">' : ''}`;
    return `<!DOCTYPE html><html lang="id" data-mode="${ui.modeOf(settings)}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(judul.full)}</title>${metaOg}
${ui.fontLinks()}
${ui.logoPreconnect([settings.sekolah_logo])}
${settings.sekolah_logo ? `<link rel="preload" as="image" href="${esc(settings.sekolah_logo)}" fetchpriority="high">` : ''}
<link rel="stylesheet" href="${base}/assets/app.css?v=${ui.ASSET_V}">
<link rel="icon" href="${base}/favicon.ico">
<meta name="theme-color" content="#F97316">
</head><body class="portal-body"${token ? ' data-portal-token="1"' : ''}>
<div class="portal-wrap">
  <header class="portal-head">
    ${logo}
    <div class="banner-text">
      <h1 class="school-title">${esc(settings.sekolah_nama || 'Sekolah')}</h1>
      <p class="portal-subtitle">${esc(txt.subtitle)}</p>
    </div>
  </header>
  ${content}
  <footer class="portal-foot">© ${new Date().getFullYear()} ${esc(settings.sekolah_nama || '')}${footerId ? ' · ' + esc(footerId) : ''}<br>Portal ini hanya menampilkan ringkasan tagihan sesuai data yang cocok.</footer>
</div>
<script src="${base}/assets/app.js?v=${ui.ASSET_V}" defer></script>
</body></html>`;
  }

  function searchForm({ settings, base, nama = '', lahir = '', err = '', ok = '' }) {
    /* judul kartu mengikuti judul portal yang diatur sekolah (bukan teks hardcode) */
    return `<div class="portal-card">
      <h2>${esc(textOf(settings).title)}</h2>
      <p class="muted small">Masukkan <b>nama siswa</b> dan <b>tanggal lahir</b> sesuai data sekolah untuk melihat tagihan. Kedua data harus cocok (verifikasi 2 faktor sederhana).</p>
      ${err ? `<div class="alert err">${ui.icon('alert')}<div>${esc(err)}</div></div>` : ''}
      ${ok ? `<div class="alert ok">${ui.icon('check')}<div>${esc(ok)}</div></div>` : ''}
      <form method="get" action="${url(base)}">
        <div class="field"><label>Nama Siswa</label>
          <input name="nama" value="${esc(nama)}" required placeholder="Ketik minimal 3 huruf nama siswa" autocomplete="off"
            data-autocomplete="${url(base, '/siswa')}" data-autocomplete-min="3">
          <div class="ac-list" data-ac-list></div>
          <div class="hint">Pilihan nama muncul otomatis setelah Anda mengetik 3 huruf.</div></div>
        <div class="field"><label>Tanggal Lahir Siswa</label>
          <input type="date" name="lahir" value="${esc(lahir)}" required>
          <div class="hint">Klik kolom ini untuk memilih tanggal dari kalender.</div></div>
        <button class="btn btn-primary btn-block">${ui.icon('search')}Cari Tagihan</button>
      </form>
      <p class="help mt-2">Data tagihan bersifat pribadi. Bila tanggal lahir tidak cocok, data tidak akan ditampilkan. Hubungi bendahara sekolah bila ada perbedaan data.</p>
    </div>`;
  }

  function renderResults({ settings, base, students, pesanOk = '', pesanErr = '' }) {
    let grandTagihan = 0, grandBayar = 0, grandSisa = 0, sections = '';
    for (const s of students) {
      const taList = dbm.allTahun();
      const byTa = new Map();
      for (const t of s.tags) {
        const key = t.tahun_ajaran_id || 0;
        if (!byTa.has(key)) byTa.set(key, []);
        byTa.get(key).push(t);
      }
      let body = '';
      /* urutan tahun pelajaran: TERLAMA di paling atas (2024/2025, 2025/2026, …) */
      const entries = [...byTa.entries()]
        .map(([tid, tags]) => ({ taId: tid, tags, ta: taList.find(t => Number(t.id) === Number(tid)) }))
        .sort((a, b) => {
          const ka = dbm.taSortKey(a.ta), kb = dbm.taSortKey(b.ta);
          if (ka === kb) return Number(a.taId) - Number(b.taId);
          if (!ka) return 1;         // tagihan tanpa tahun pelajaran diletakkan paling bawah
          if (!kb) return -1;
          return ka.localeCompare(kb);
        });
      for (const { tags, ta } of entries) {
        const payMap = dbm.iuranPaysMap(tags.map(t => t.id));
        /* ---- baris tampilan: grup bulanan dijabarkan per bulan (SPP - Juli 2025, …) ---- */
        const rows = [];
        for (const t of tags) {
          const pays = payMap.get(t.id) || [];
          const isMonthly = t.grup_jenis === 'bulanan';
          const months = isMonthly ? dbm.iuranMonthDetail(t.grup_id, pays) : [];
          if (months.length) {
            for (const m of months) {
              rows.push({
                label: `${t.grup_nama} - ${bulanTahun(m.bulan, ta)}`, jenis: 'Bulanan', isMonth: true,
                grup: t.grup_nama, tagihan: m.tagihan, dibayar: m.dibayar, potongan: 0, sisa: m.sisa,
                status: m.status, writeoff: t.writeoff || ''
              });
            }
            continue;
          }
          rows.push({
            label: t.grup_nama, jenis: isMonthly ? 'Bulanan' : 'Non-Bulanan', isMonth: false,
            grup: t.grup_nama, tagihan: Number(t.nominal || 0), dibayar: Number(t.terbayar || 0),
            potongan: Number(t.total_potongan || 0), sisa: Number(t.sisa || 0), status: '', writeoff: t.writeoff || ''
          });
        }
        // subtotal per grup (baris ringkas sebelum rincian bulanan agar total 1 tahun tetap terlihat)
        const tag = rows.reduce((a, r) => a + Number(r.tagihan || 0), 0);
        const bay = rows.reduce((a, r) => a + Number(r.dibayar || 0), 0);
        const pot = rows.reduce((a, r) => a + Number(r.potongan || 0), 0);
        const sisa = rows.reduce((a, r) => a + Number(r.sisa || 0), 0);
        grandTagihan += tag; grandBayar += bay; grandSisa += sisa;
        body += `<div class="portal-ta">
          <div class="ta-head"><b>Tahun Pelajaran ${esc(ta ? ta.nama : '-')}</b>
            <span class="badge ${sisa > 0 ? 'amber' : 'green'}">${sisa > 0 ? 'Ada tunggakan' : 'Lunas'}</span></div>
          <div class="table-wrap"><table class="tbl-modern portal-bill"><thead><tr><th>Jenis Grup Iuran</th><th>Jenis</th><th class="num">Total Tagihan</th><th class="num">Sudah Dibayar</th><th class="num">Potongan</th><th class="num">Sisa Terhutang</th></tr></thead><tbody>
          ${rows.map(r => `<tr class="${r.isMonth ? 'month-line' : ''}">
            <td class="${r.isMonth ? 'ml-label' : 't-strong'}">${r.isMonth ? `<span class="ml-arrow">↳</span> ${esc(r.label)}` : esc(r.label)}</td>
            <td>${esc(r.jenis)}${r.status === 'lunas' ? ' <span class="badge green plain">Lunas</span>' : r.status === 'sebagian' ? ' <span class="badge amber plain">Sebagian</span>' : ''}</td>
            <td class="num">${rupiah(r.tagihan)}</td><td class="num">${rupiah(r.dibayar)}</td><td class="num">${rupiah(r.potongan)}</td>
            <td class="num" style="color:${r.sisa > 0 ? 'var(--red)' : 'var(--green)'}">${rupiah(r.sisa)}${r.writeoff === 'pemutihan' ? ' <span class="badge blue plain">Di-pemutihan</span>' : ''}</td></tr>`).join('')}
          </tbody><tfoot><tr><td colspan="2">Subtotal ${esc(ta ? ta.nama : '')}</td><td class="num">${rupiah(tag)}</td><td class="num">${rupiah(bay)}</td><td class="num">${rupiah(pot)}</td><td class="num">${rupiah(sisa)}</td></tr></tfoot></table></div>
        </div>`;
      }
      const sisaSiswa = s.tags.reduce((a, t) => a + Number(t.sisa || 0), 0);
      const tagSiswa = s.tags.reduce((a, t) => a + Number(t.nominal || 0), 0);
      sections += `<div class="portal-card">
        <div class="portal-student">
          <div>
            <div class="pname">${esc(s.nama)}</div>
            <div class="muted small">NISN ${esc(s.nisn || '-')} · Kelas ${esc(s.kelas_nama || '-')}</div>
          </div>
          <div style="text-align:right">
            <div class="badge ${sisaSiswa > 0 ? 'amber' : 'green'}">${sisaSiswa > 0 ? 'Sisa ' + rupiah(sisaSiswa) : 'Lunas'}</div>
            <div class="muted small" style="margin-top:4px">${s.tags.length} grup · total ${rupiah(tagSiswa)}</div>
          </div>
        </div>
        ${body || '<div class="empty"><p>Belum ada tagihan iuran tercatat.</p></div>'}
      </div>`;
    }
    return `${sections}
      <div class="portal-card recap">
        <h3>Rekapitulasi Keseluruhan</h3>
        <div class="recap-grid">
          <div class="rc"><div class="lbl">Total Semua Tagihan</div><div class="val">${rupiah(grandTagihan)}</div><div class="sm">seluruh tahun pelajaran</div></div>
          <div class="rc"><div class="lbl">Total Sudah Dibayar</div><div class="val" style="color:var(--green)">${rupiah(grandBayar)}</div><div class="sm">termasuk potongan</div></div>
          <div class="rc"><div class="lbl">Total Sisa Terhutang</div><div class="val" style="color:${grandSisa > 0 ? 'var(--red)' : 'var(--green)'}">${rupiah(grandSisa)}</div><div class="sm">tunggakan seluruh tahun</div></div>
        </div>
        <div class="center mt-2"><a class="btn" href="${url(base)}">${ui.icon('search')}Kembali ke Halaman Pencarian</a></div>
      </div>
      ${feedbackForm({ base, students, pesanOk, pesanErr })}`;
  }

  /** form catatan / umpan balik orang tua (masuk ke Dashboard admin) */
  function feedbackForm({ base, students, pesanOk = '', pesanErr = '' }) {
    const s = students[0] || {};
    const others = s.id
      ? db.prepare(`SELECT * FROM portal_pesan WHERE siswa_id=? AND COALESCE(sumber,'siswa')='siswa' ORDER BY id DESC LIMIT 3`).all(s.id)
      : [];
    return `<div class="portal-card">
      <h3>Kolom Catatan Orang Tua / Wali</h3>
      <p class="muted small">Bila terdapat kekeliruan data tagihan atau pembayaran, tuliskan catatan Anda di bawah ini.
        Catatan akan masuk ke <b>Dashboard Bendahara</b> untuk ditindaklanjuti petugas.</p>
      ${pesanOk ? `<div class="alert ok">${ui.icon('check')}<div>${esc(pesanOk)}</div></div>` : ''}
      ${pesanErr ? `<div class="alert err">${ui.icon('alert')}<div>${esc(pesanErr)}</div></div>` : ''}
      ${others.length ? `<div class="portal-note-list">${others.map(x => `<div class="pn-item"><div class="pn-meta">${esc(lib.stampShort(x.created_at))} · ${x.status === 'selesai' ? 'Sudah ditindaklanjuti' : 'Menunggu tindak lanjut'}</div><div class="pn-body">${esc(x.pesan)}</div></div>`).join('')}</div>` : ''}
      <form method="post" action="${url(base, '/pesan')}">
        <input type="hidden" name="siswa_id" value="${esc(s.id || '')}">
        <div class="field"><label>Nama Siswa</label><input value="${esc(s.nama || '')}" readonly></div>
        <div class="field"><label>Nomor WhatsApp / Telepon (opsional)</label>
          <input name="kontak" inputmode="tel" placeholder="08xxxxxxxxxx — agar petugas dapat menghubungi Anda" autocomplete="off"></div>
        <div class="field"><label>Catatan / Pesan untuk Bendahara <span style="color:var(--red)">*</span></label>
          <textarea name="pesan" rows="5" required maxlength="2000" placeholder="Contoh: Pembayaran SPP bulan Agustus sudah saya bayar pada 12/08, tetapi masih tercatat belum dibayar."></textarea></div>
        <button class="btn btn-primary btn-block">${ui.icon('upload')}Kirim Catatan</button>
      </form>
    </div>`;
  }

  function handle(req, res) {
    const base = req.BASE;
    const settings = dbm.settingsAll();
    /* alamat publik tanpa query — dipakai og:url agar token pribadi tidak ikut tersebar */
    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim() || 'https';
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const canonical = host ? `${proto}://${host}${base}/${slug()}` : '';
    if (dbm.getSetting('portal_aktif', '1') !== '1') {
      return res.html(shell({
        base, settings, canonical, content: `<div class="portal-card"><h2>Portal sementara ditutup</h2><p class="muted">Pengelola sekolah menonaktifkan portal cek tagihan. Silakan hubungi bendahara sekolah.</p></div>`
      }), 503);
    }
    const nama = String(req.query.get('nama') || '').trim();
    const lahirRaw = String(req.query.get('lahir') || '').trim();
    const pesanOk = String(req.query.get('ok') || '').trim();
    const pesanErr = String(req.query.get('err') || '').trim();
    /* ---- tautan langsung dari pesan pengingat WhatsApp: /portal?token=<tanda tangan> ---- */
    const tokenRaw = String(req.query.get('token') || '').trim();
    if (tokenRaw) {
      const siswaId = reminder.verifyPortalToken(dbm, tokenRaw);
      const s = siswaId ? db.prepare(`SELECT s.*, k.nama kelas_nama FROM siswa s LEFT JOIN kelas k ON k.id=s.kelas_id WHERE s.id=?`).get(siswaId) : null;
      if (!s) {
        /* token tidak sah → judul kembali ke judul publik biasa (bukan "Rincian …") */
        return res.html(shell({
          base, settings, canonical,
          content: searchForm({ settings, base, err: 'Tautan tagihan tidak valid atau sudah tidak berlaku. Silakan cari data dengan nama dan tanggal lahir siswa.' })
        }));
      }
      const students = [{ ...s, tags: dbm.iuranTagihanRows({ siswaId: s.id }) }];
      return res.html(shell({
        base, settings, canonical, token: true,
        content: `<div class="alert ok">${ui.icon('check')}<div>Tautan pribadi terverifikasi — menampilkan tagihan <b>${esc(s.nama)}</b> (${esc(s.kelas_nama || '-')}).</div></div>`
          + renderResults({ settings, base, students, pesanOk, pesanErr })
      }));
    }
    if (!nama && !lahirRaw) return res.html(shell({ base, settings, canonical, content: searchForm({ settings, base, err: pesanErr, ok: pesanOk }) }));
    const lahir = normalizeDate(lahirRaw) || (/^\d{4}-\d{2}-\d{2}$/.test(lahirRaw) ? lahirRaw : null);
    if (!nama || !lahir) {
      return res.html(shell({ base, settings, canonical, content: searchForm({ settings, base, nama, lahir: lahirRaw, err: 'Nama dan tanggal lahir wajib diisi dengan benar.' }) }));
    }
    const cands = db.prepare(`SELECT s.*, k.nama kelas_nama FROM siswa s LEFT JOIN kelas k ON k.id=s.kelas_id
      WHERE lower(trim(s.nama))=lower(?) AND s.tanggal_lahir=?`).all(nama, lahir);
    if (!cands.length) {
      return res.html(shell({
        base, settings, canonical,
        content: searchForm({ settings, base, nama, lahir: lahirRaw, err: 'Data tidak ditemukan. Pastikan nama dan tanggal lahir sama persis dengan data sekolah (tanggal lahir wajib diisi petugas).' })
      }));
    }
    const students = cands.map(s => ({ ...s, tags: dbm.iuranTagihanRows({ siswaId: s.id }) }));
    res.html(shell({ base, settings, canonical, content: renderResults({ settings, base, students, pesanOk, pesanErr }) }));
  }

  get('/portal', handle);

  /* autocomplete nama siswa (muncul setelah minimal 3 huruf) */
  get('/portal/siswa', (req, res) => {
    const q = String(req.query.get('q') || '').trim();
    if (q.length < 3) return res.json({ ok: true, items: [] });
    const rows = db.prepare(`SELECT s.nama, s.nisn, k.nama kelas_nama FROM siswa s LEFT JOIN kelas k ON k.id=s.kelas_id
      WHERE lower(s.nama) LIKE ? AND s.status='aktif' ORDER BY s.nama LIMIT 10`).all('%' + q.toLowerCase() + '%');
    res.json({ ok: true, items: rows.map(r => ({ nama: r.nama, label: `${r.nama}${r.kelas_nama ? ' — ' + r.kelas_nama : ''}` })) });
  });

  /* catatan / umpan balik orang tua → menu dashboard admin */
  post('/portal/pesan', (req, res) => {
    const base = req.BASE;
    const sid = Number(req.body.siswa_id || 0) || 0;
    const pesan = String(req.body.pesan || '').trim();
    const kontak = String(req.body.kontak || '').trim();
    const siswaRow = sid ? db.prepare('SELECT * FROM siswa WHERE id=?').get(sid) : null;
    const backTo = nm => url(base) + '?nama=' + encodeURIComponent(nm || '') + '&lahir=' + encodeURIComponent(String((siswaRow || {}).tanggal_lahir || ''));
    if (!siswaRow) return res.redirect(url(base) + '?err=' + encodeURIComponent('Sesi pencarian berakhir. Silakan cari data tagihan kembali, lalu kirim catatan.'));
    if (pesan.length < 5) return res.redirect(backTo(siswaRow.nama) + '&err=' + encodeURIComponent('Catatan terlalu pendek — tuliskan minimal 5 karakter.'));
    dbm.portalPesanAdd({
      siswa_id: siswaRow.id, nama: siswaRow.nama, kontak, pesan, sumber: 'siswa', ref: String(siswaRow.id),
      taId: (dbm.activeTahun() || {}).id
    });
    dbm.logAudit(null, 'PESAN ORANG TUA', 'portal', `Catatan orang tua/wali ${siswaRow.nama}: ${pesan.slice(0, 140)}`);
    res.redirect(backTo(siswaRow.nama) + '&ok=' + encodeURIComponent('Terima kasih, catatan Anda sudah dikirim ke bendahara sekolah.'));
  });

  post('/portal/cari', (req, res) => {
    const qs = new URLSearchParams({ nama: String(req.body.nama || ''), lahir: String(req.body.lahir || '') });
    res.redirect(url(req.BASE) + '?' + qs.toString().replace(/\+/g, '%20'));
  });
};
