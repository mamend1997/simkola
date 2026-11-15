'use strict';
/* Portal publik cek tagihan orang tua — tanpa login, verifikasi Nama + Tanggal Lahir */
const reminder = require('../reminder');
const bayar = require('../bayariuran');

module.exports = ({ get, post, dbm, lib, ui, guard, flashUrl, saas, uploadMedia }) => {
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

  function renderResults({ settings, base, students, pesanOk = '', pesanErr = '', ident = null }) {
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
          const tingkat = t.tingkat || dbm.siswaTingkat(t.siswa_id, t.tahun_ajaran_id);
          const months = isMonthly ? dbm.iuranMonthDetail(t.grup_id, pays, tingkat) : [];
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
            ${(ident && ident.siswa && String(ident.siswa.id) === String(s.id) && sisaSiswa > 0) ? `<div style="margin-top:8px">
              <a class="btn btn-primary btn-sm" href="${bayarUrl(base, ident)}">${ui.icon('card')}Bayar Iuran</a></div>` : ''}
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
      ${others.length ? `<div class="portal-note-list">${others.map(x => `<div class="pn-item"><div class="pn-meta">${esc(lib.stampShort(x.created_at))} · ${x.status === 'selesai' ? 'Sudah ditindaklanjuti' : 'Menunggu tindak lanjut'}</div><div class="pn-body">${esc(x.pesan)}</div>
        ${x.balasan ? `<div class="pn-reply"><div class="pn-reply-lbl">Balasan sekolah${x.balas_oleh ? ' · ' + esc(x.balas_oleh) : ''}</div><div>${esc(x.balasan)}</div></div>` : ''}</div>`).join('')}</div>` : ''}
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

  /* ==================================================================
     BAYAR IURAN MANDIRI (portal orang tua)
     ================================================================== */
  /** identitas dari query/body: token pribadi atau pasangan nama + tanggal lahir */
  function identOf(src) {
    const getv = k => String((src.get ? src.get(k) : src[k]) || '').trim();
    const token = getv('token');
    if (token) {
      const id = reminder.verifyPortalToken(dbm, token);
      const s = id ? db.prepare(`SELECT s.*, k.nama kelas_nama FROM siswa s LEFT JOIN kelas k ON k.id=s.kelas_id WHERE s.id=?`).get(id) : null;
      if (s) return { siswa: s, token, nama: s.nama, lahir: s.tanggal_lahir || '' };
      return { siswa: null, token, nama: '', lahir: '' };
    }
    const nama = getv('nama');
    const lahir = normalizeDate(getv('lahir')) || (/^\d{4}-\d{2}-\d{2}$/.test(getv('lahir')) ? getv('lahir') : null);
    if (!nama || !lahir) return { siswa: null, token: '', nama, lahir: lahir || '' };
    const s = db.prepare(`SELECT s.*, k.nama kelas_nama FROM siswa s LEFT JOIN kelas k ON k.id=s.kelas_id
      WHERE lower(trim(s.nama))=lower(?) AND s.tanggal_lahir=?`).get(nama, lahir);
    return { siswa: s || null, token: '', nama, lahir };
  }
  function bayarUrl(base, ident, sub = '') {
    const q = new URLSearchParams();
    if (ident.token) q.set('token', ident.token);
    else { q.set('nama', ident.nama || ''); q.set('lahir', ident.lahir || ''); }
    return url(base, '/bayar' + sub) + '?' + q.toString().replace(/\+/g, '%20');
  }
  const statusBadge = st => {
    const map = { menunggu: ['Menunggu Pembayaran / Verifikasi', 'amber'], lunas: ['Lunas', 'green'], ditolak: ['Ditolak', 'red'], batal: ['Batal', 'gray'] };
    const b = map[st] || [st || '-', 'gray'];
    return `<span class="badge ${b[1]}">${esc(b[0])}</span>`;
  };

  /** halaman pemilihan tagihan + metode pembayaran */
  function bayarPage({ base, settings, ident, ok = '', err = '' }) {
    const pub = bayar.publicCfg(dbm, saas);
    const s = ident.siswa;
    const items = bayar.itemsOf(dbm, s.id);
    const riwayat = bayar.listBySiswa(dbm, s.id, 6);
    const identFields = ident.token
      ? `<input type="hidden" name="token" value="${esc(ident.token)}">`
      : `<input type="hidden" name="nama" value="${esc(ident.nama)}"><input type="hidden" name="lahir" value="${esc(ident.lahir)}">`;
    const groups = [];
    const byGrup = new Map();
    for (const it of items) {
      if (!byGrup.has(it.grup_nama)) byGrup.set(it.grup_nama, { jenis: it.grup_jenis, items: [] });
      byGrup.get(it.grup_nama).items.push(it);
    }
    for (const [nama, g] of byGrup) groups.push({ nama, ...g });
    const totalSisa = items.reduce((a, b) => a + Number(b.nominal || 0), 0);

    const pilihMetode = pub.online && pub.manual
      ? `<div class="bayar-method">
          <button type="button" class="${!pub.manual ? '' : 'on'}" data-bayar-method="manual"><b>Transfer Manual / QRIS Sekolah</b>Transfer ke rekening sekolah lalu unggah bukti pembayaran.</button>
          <button type="button" class="${!pub.manual ? 'on' : ''}" data-bayar-method="gateway"><b>QRIS Otomatis (${esc(pub.provider_label)})</b>Bayar langsung, status lunas otomatis setelah terkonfirmasi.</button>
        </div>`
      : '';

    const paneManual = `<div class="bayar-pane ${pub.manual ? 'on' : ''}" data-bayar-pane="manual">
      ${pub.qris_image ? `<div class="qris-box"><img src="${esc(pub.qris_image)}" alt="QRIS sekolah" loading="lazy" decoding="async" width="220" height="220">
        <div style="flex:1;min-width:200px"><b>Pindai QRIS sekolah</b>
          <p class="muted small" style="margin:6px 0">${esc(pub.instruksi || '')}</p>
          <div class="help">Setelah membayar, unggah bukti transfer pada formulir di bawah.</div></div></div>`
        : pub.instruksi ? `<div class="portal-card" style="margin:0 0 12px;padding:14px"><b>Instruksi Transfer</b><p class="muted small" style="margin:6px 0 0;white-space:pre-wrap">${esc(pub.instruksi)}</p></div>` : ''}
      <div class="field"><label>Unggah Bukti Pembayaran <span style="color:var(--red)">*</span></label>
        <input type="file" accept="image/*,application/pdf" data-bayar-bukti data-b64="bukti_b64" data-filename="bukti_nama" data-max="10">
        <input type="hidden" name="bukti_b64" id="bukti_b64"><input type="hidden" name="bukti_nama" id="bukti_nama">
        <div id="bukti_b64-info" data-bayar-bukti-info class="hint">Format gambar (JPG/PNG/WebP) atau PDF, maksimal 10 MB.</div></div>
      <div class="field"><label>Catatan untuk Bendahara (opsional)</label>
        <input name="catatan" maxlength="200" placeholder="Contoh: transfer dari rekening a.n. Bapak …"></div>
    </div>`;

    const paneGateway = `<div class="bayar-pane ${!pub.manual ? 'on' : ''}" data-bayar-pane="gateway">
      <div class="portal-card" style="margin:0;padding:14px">
        <b>Pembayaran QRIS otomatis</b>
        <p class="muted small" style="margin:6px 0 0">Tekan <b>Bayar Sekarang</b> — sistem membuat QRIS dinamis sesuai total pilihan Anda.
          Status tagihan otomatis menjadi <b>Lunas</b> setelah gateway mengonfirmasi pembayaran.</p>
      </div>
    </div>`;

    return `<div class="portal-card">
      <div class="portal-student" style="margin-bottom:12px">
        <div><div class="pname">${esc(s.nama)}</div>
          <div class="muted small">NISN ${esc(s.nisn || '-')} · Kelas ${esc(s.kelas_nama || '-')}</div></div>
        <div style="text-align:right"><div class="badge ${totalSisa > 0 ? 'amber' : 'green'}">${totalSisa > 0 ? 'Sisa ' + esc(rupiah(totalSisa)) : 'Lunas'}</div></div>
      </div>
      ${ok ? `<div class="alert ok">${ui.icon('check')}<div>${esc(ok)}</div></div>` : ''}
      ${err ? `<div class="alert err">${ui.icon('alert')}<div>${esc(err)}</div></div>` : ''}
      ${(!pub.online && !pub.manual) ? `<div class="alert warn">${ui.icon('alert')}<div>Pembayaran daring belum diaktifkan sekolah. Silakan hubungi bendahara untuk melakukan pembayaran.</div></div>` : ''}
      ${!items.length ? `<div class="alert ok">${ui.icon('check')}<div>Tidak ada tagihan yang perlu dibayar. Terima kasih.</div></div>` : `
      <form method="post" action="${url(base, '/bayar')}" data-bayar-form>
        ${identFields}
        <input type="hidden" name="metode" value="${pub.manual ? 'manual' : 'gateway'}">
        <div class="bayar-wrap">
          ${groups.map(g => `<div class="bayar-group">
            <h4>${esc(g.nama)} <span class="t-sub" style="text-transform:none;letter-spacing:0">(${esc(g.jenis === 'bulanan' ? 'bulanan' : 'non-bulanan')})</span></h4>
            ${g.items.map(it => `<label class="bayar-item">
              <input type="checkbox" name="item" value="${it.tagihan_id}:${it.bulan || 0}" data-bayar-item data-amount="${Number(it.nominal) || 0}">
              <span class="bi-main"><span class="bi-lbl">${esc(it.label)}</span>
                <span class="bi-sub">Sisa tagihan item ini</span></span>
              <span class="bi-num">${esc(rupiah(it.nominal))}</span></label>`).join('')}
          </div>`).join('')}
          <div class="bayar-total">
            <div>Total Pembayaran<div class="t-sub" style="font-weight:500"><span data-bayar-count>0 item dipilih</span></div></div>
            <div class="val" data-bayar-total>Rp 0</div>
          </div>
          ${pilihMetode}
          ${pub.manual ? paneManual : ''}
          ${pub.online ? paneGateway : ''}
          <div><button class="btn btn-primary btn-block" type="submit" data-bayar-submit disabled>${ui.icon('card')}Bayar Sekarang</button>
            <p class="help center" style="margin-top:8px">Pembayaran diverifikasi bendahara dan otomatis masuk antrean pembukuan sekolah.</p></div>
        </div>
      </form>`}
    </div>
    ${riwayat.length ? `<div class="portal-card">
      <h3>Riwayat Pembayaran Portal</h3>
      <div class="table-wrap"><table class="tbl-modern"><thead><tr><th>Waktu</th><th class="num">Total</th><th>Metode</th><th>Status</th></tr></thead><tbody>
        ${riwayat.map(x => `<tr><td class="t-sub">${esc(lib.stampShort(x.created_at))}</td><td class="num">${esc(rupiah(x.total))}</td>
          <td>${x.metode === 'gateway' ? 'QRIS ' + esc(x.provider || '') : 'Transfer manual'}</td>
          <td>${statusBadge(x.status)}${x.alasan ? `<div class="t-sub">${esc(x.alasan)}</div>` : ''}</td></tr>`).join('')}
      </tbody></table></div>
    </div>` : ''}
    <div class="center mt-2"><a class="btn" href="${url(base)}?${ident.token ? 'token=' + encodeURIComponent(ident.token) : 'nama=' + encodeURIComponent(ident.nama) + '&lahir=' + encodeURIComponent(ident.lahir)}">${ui.icon('file')}Kembali ke Rincian Tagihan</a></div>`;
  }

  /** halaman status pembayaran gateway (QRIS dinamis) */
  function statusPage({ base, settings, ident, row, ok = '', err = '' }) {
    const pub = bayar.publicCfg(dbm, saas);
    let items = [];
    try { items = JSON.parse(row.items || '[]'); } catch (e) { }
    const qr = row.qr_string || '';
    const qrImg = qr ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(qr)}` : '';
    return `<div class="portal-card">
      <h3>Status Pembayaran</h3>
      <div class="alert ${row.status === 'lunas' ? 'ok' : row.status === 'ditolak' || row.status === 'batal' ? 'err' : 'warn'}">
        ${ui.icon(row.status === 'lunas' ? 'check' : 'info')}
        <div><b>${esc(row.nama || '')}</b> · ${statusBadge(row.status)}
          <div class="small" style="margin-top:4px">Total ${esc(rupiah(row.total))} · ${row.metode === 'gateway' ? 'QRIS ' + esc(row.provider || '') : 'Transfer manual'} · ${esc(lib.stampShort(row.created_at))}</div>
          ${row.alasan ? `<div class="small" style="margin-top:4px">Alasan: ${esc(row.alasan)}</div>` : ''}</div>
      </div>
      ${ok ? `<div class="alert ok">${ui.icon('check')}<div>${esc(ok)}</div></div>` : ''}
      ${err ? `<div class="alert err">${ui.icon('alert')}<div>${esc(err)}</div></div>` : ''}
      <div class="table-wrap"><table class="tbl-modern"><thead><tr><th>Item Tagihan</th><th class="num">Nominal</th></tr></thead><tbody>
        ${items.map(i => `<tr><td>${esc(i.label || '')}</td><td class="num">${esc(rupiah(i.nominal))}</td></tr>`).join('')}
        <tfoot><tr><td>Total</td><td class="num">${esc(rupiah(row.total))}</td></tr></tfoot>
      </tbody></table></div>
      ${row.status === 'menunggu' && row.metode === 'gateway' ? `
        <div class="qris-box mt-2">
          ${qrImg ? `<img src="${esc(qrImg)}" alt="QRIS pembayaran" width="240" height="240" loading="lazy"
            onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'qris-code',textContent:${JSON.stringify(qr)}}))">`
        : '<div class="help">QRIS tidak tersedia — buka tautan pembayaran dari gateway.</div>'}
          <div style="flex:1;min-width:200px">
            <b>Pindai QRIS untuk membayar</b>
            <p class="muted small" style="margin:6px 0">Nominal sudah termasuk seluruh item yang Anda pilih. Setelah membayar, tekan <b>Cek Status Pembayaran</b>.</p>
            ${qr ? `<div class="qris-code">${esc(qr)}</div>` : ''}
            ${row.checkout_url ? `<p style="margin-top:10px"><a class="btn btn-sm" href="${esc(row.checkout_url)}" target="_blank" rel="noopener">${ui.icon('link')}Buka Halaman Pembayaran</a></p>` : ''}
            <form method="post" action="${url(base, '/bayar/cek')}" class="portal-pay-row mt-2">
              <input type="hidden" name="order" value="${esc(row.order_id || '')}">
              <input type="hidden" name="token" value="${esc(ident.token || '')}">
              <input type="hidden" name="nama" value="${esc(ident.nama || '')}">
              <input type="hidden" name="lahir" value="${esc(ident.lahir || '')}">
              <button class="btn btn-primary btn-sm">${ui.icon('refresh')}Cek Status Pembayaran</button>
            </form>
            ${(row.provider === 'sandbox' || String(pub.provider) === 'sandbox') ? `<form method="post" action="${url(base, '/bayar/simulasi')}" class="mt-1">
              <input type="hidden" name="order" value="${esc(row.order_id || '')}">
              <input type="hidden" name="token" value="${esc(ident.token || '')}">
              <input type="hidden" name="nama" value="${esc(ident.nama || '')}">
              <input type="hidden" name="lahir" value="${esc(ident.lahir || '')}">
              <button class="btn btn-sm">${ui.icon('check')}Simulasi Lunas (mode uji coba)</button>
            </form>` : ''}
          </div>
        </div>` : ''}
      <div class="center mt-2"><a class="btn" href="${bayarUrl(base, ident)}">${ui.icon('card')}Kembali ke Halaman Bayar</a></div>
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
      const ident = { siswa: s, token: tokenRaw, nama: s.nama, lahir: s.tanggal_lahir || '' };
      return res.html(shell({
        base, settings, canonical, token: true,
        content: `<div class="alert ok">${ui.icon('check')}<div>Tautan pribadi terverifikasi — menampilkan tagihan <b>${esc(s.nama)}</b> (${esc(s.kelas_nama || '-')}).</div></div>`
          + renderResults({ settings, base, students, pesanOk, pesanErr, ident })
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
    const ident = { siswa: students[0], token: '', nama, lahir };
    res.html(shell({ base, settings, canonical, content: renderResults({ settings, base, students, pesanOk, pesanErr, ident }) }));
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
  /* ==================================================================
     BAYAR IURAN — halaman & aksi (tanpa login, verifikasi identitas)
     ================================================================== */
  function appBase(req) {
    const env = String(process.env.APP_BASE_URL || '').replace(/\/+$/, '');
    if (env) return env + req.BASE;
    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim() || 'https';
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    return host ? `${proto}://${host}${req.BASE}` : req.BASE;
  }

  get('/portal/bayar', (req, res) => {
    const base = req.BASE;
    const settings = dbm.settingsAll();
    const ident = identOf(req.query);
    if (!ident.siswa) {
      return res.html(shell({
        base, settings,
        content: searchForm({
          settings, base, nama: ident.nama, lahir: ident.lahir,
          err: 'Sesi pencarian berakhir. Silakan cari data tagihan kembali dengan nama dan tanggal lahir siswa.'
        })
      }));
    }
    res.html(shell({
      base, settings, token: !!ident.token, canonical: appBase(req) + '/' + slug() + '/bayar',
      content: bayarPage({ base, settings, ident })
    }));
  });

  post('/portal/bayar', async (req, res) => {
    const base = req.BASE;
    const settings = dbm.settingsAll();
    const ident = identOf(req.body);
    if (!ident.siswa) {
      return res.html(shell({
        base, settings,
        content: searchForm({ settings, base, err: 'Sesi pencarian berakhir. Silakan cari data tagihan kembali lalu ulangi pembayaran.' })
      }));
    }
    const s = ident.siswa;
    const back = bayarUrl(base, ident);
    try {
      const pub = bayar.publicCfg(dbm, saas);
      const picked = bayar.pickItems(dbm, s.id, req.body.item);
      const items = picked.items, total = picked.total;
      if (!items.length || !(total > 0)) throw new Error('Pilih minimal satu tagihan yang akan dibayar.');
      const metode = String(req.body.metode || 'manual') === 'gateway' ? 'gateway' : 'manual';
      if (metode === 'gateway' && !pub.online) throw new Error('Pembayaran QRIS otomatis belum diaktifkan sekolah.');
      if (metode === 'manual' && !pub.manual) throw new Error('Pembayaran transfer manual belum diaktifkan sekolah.');
      const taId = (dbm.activeTahun() || {}).id;
      let id, row;
      if (metode === 'gateway') {
        id = await bayar.createGateway({
          dbm, saas, tenant: req.tenant, siswa: s, items, total, taId, baseUrl: appBase(req)
        });
        row = bayar.byId(dbm, id);
      } else {
        const b64 = String(req.body.bukti_b64 || '');
        if (b64.length < 40) throw new Error('Bukti pembayaran wajib diunggah sebelum mengirim.');
        const nm = String(req.body.bukti_nama || 'bukti-pembayaran');
        const ext = (nm.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        const buktiUrl = await uploadMedia(b64, `bukti-iuran-${s.id}-${Date.now()}.${ext}`, { jenis: 'bukti' });
        id = bayar.createManual({
          dbm, siswa: s, items, total, buktiUrl, buktiNama: nm,
          catatan: String(req.body.catatan || '').slice(0, 200), taId
        });
        row = bayar.byId(dbm, id);
      }
      dbm.logAudit(null, metode === 'gateway' ? 'BAYAR IURAN ONLINE' : 'BAYAR IURAN MANUAL', 'iuran',
        `Portal orang tua: ${s.nama} · ${lib.rupiah(total)} · ${items.length} item · ${metode}`);
      if (metode === 'gateway') {
        return res.redirect(req.BASE + bayarUrl(base, ident, '/status') + '&order=' + encodeURIComponent(row.order_id || ''));
      }
      return res.redirect(req.BASE + back + '&ok=' + encodeURIComponent(
        `Terima kasih! Pembayaran ${lib.rupiah(total)} sudah dikirim dan menunggu verifikasi bendahara sekolah.`));
    } catch (e) {
      return res.redirect(req.BASE + back + '&err=' + encodeURIComponent(e.message));
    }
  });

  get('/portal/bayar/status', (req, res) => {
    const base = req.BASE;
    const settings = dbm.settingsAll();
    const ident = identOf(req.query);
    const order = String(req.query.get('order') || '');
    const row = ident.siswa ? bayar.byOrder(dbm, order) : null;
    if (!row || Number(row.siswa_id) !== Number(ident.siswa.id)) {
      return res.html(shell({
        base, settings, token: !!ident.token,
        content: searchForm({ settings, base, err: 'Transaksi pembayaran tidak ditemukan. Silakan cari data tagihan kembali.' })
      }));
    }
    res.html(shell({
      base, settings, token: !!ident.token, canonical: appBase(req) + '/' + slug() + '/bayar',
      content: statusPage({ base, settings, ident, row, ok: String(req.query.get('ok') || ''), err: String(req.query.get('err') || '') })
    }));
  });

  post('/portal/bayar/cek', async (req, res) => {
    const base = req.BASE;
    const ident = identOf(req.body);
    const back = bayarUrl(base, ident, '/status') + '&order=' + encodeURIComponent(String(req.body.order || ''));
    const row = ident.siswa ? bayar.byOrder(dbm, String(req.body.order || '')) : null;
    if (!row || Number(row.siswa_id) !== Number(ident.siswa.id)) {
      return res.redirect(req.BASE + bayarUrl(base, ident) + '&err=' + encodeURIComponent('Transaksi pembayaran tidak ditemukan.'));
    }
    try {
      const r = await bayar.syncGateway(dbm, saas, row);
      if (r.paid) {
        dbm.logAudit(null, 'BAYAR IURAN ONLINE', 'iuran', `Gateway mengonfirmasi lunas: ${row.nama} ${lib.rupiah(row.total)}`);
        return res.redirect(req.BASE + back + '&ok=' + encodeURIComponent('Pembayaran terkonfirmasi LUNAS. Tagihan Anda sudah diperbarui.'));
      }
      return res.redirect(req.BASE + back + '&err=' + encodeURIComponent(
        'Pembayaran belum terkonfirmasi' + (r.gateway_status ? ` (status: ${r.gateway_status})` : '') + '. Selesaikan pembayaran lalu cek kembali.'));
    } catch (e) {
      return res.redirect(req.BASE + back + '&err=' + encodeURIComponent(e.message));
    }
  });

  post('/portal/bayar/simulasi', (req, res) => {
    const base = req.BASE;
    const ident = identOf(req.body);
    const back = bayarUrl(base, ident, '/status') + '&order=' + encodeURIComponent(String(req.body.order || ''));
    const row = ident.siswa ? bayar.byOrder(dbm, String(req.body.order || '')) : null;
    if (!row || Number(row.siswa_id) !== Number(ident.siswa.id)) {
      return res.redirect(req.BASE + bayarUrl(base, ident) + '&err=' + encodeURIComponent('Transaksi pembayaran tidak ditemukan.'));
    }
    try {
      const conf = bayar.cfg(dbm, saas);
      if (String(conf.provider) !== 'sandbox') throw new Error('Simulasi hanya tersedia pada provider "Simulasi".');
      bayar.applyPaid(dbm, row, { oleh: 'Simulasi Pembayaran', gatewayStatus: 'PAID' });
      dbm.logAudit(null, 'BAYAR IURAN ONLINE', 'iuran', `Simulasi lunas: ${row.nama} ${lib.rupiah(row.total)}`);
      res.redirect(req.BASE + back + '&ok=' + encodeURIComponent('Simulasi berhasil — pembayaran ditandai LUNAS.'));
    } catch (e) {
      res.redirect(req.BASE + back + '&err=' + encodeURIComponent(e.message));
    }
  });
};
