'use strict';
/**
 * ==================================================================
 * PETUNJUK PENGGUNA (sisi SEKOLAH) — READ ONLY
 * ------------------------------------------------------------------
 * Materi panduan SEPENUHNYA dikelola Super Admin Pusat
 * (control plane `master_guides`, menu "Master Petunjuk Pengguna").
 * Halaman sekolah hanya menampilkan hasil terbit + pencarian judul.
 *
 * Setiap kartu panduan memiliki GAMBAR PRATAYANG (thumbnail) dan
 * lampiran (video YouTube / PDF) dibuka LANGSUNG di dalam aplikasi
 * lewat modal viewer — pengguna tidak perlu membuka tab baru.
 *
 * Seluruh endpoint tulis (tambah/edit/hapus/urut) DIBLOKIR 403 untuk
 * semua akun sekolah — termasuk admin sekolah — agar materi tidak dapat
 * diubah dari sisi tenant.
 * ==================================================================
 */
module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, saas, uploadMedia }) => {
  const { esc } = lib;

  function forbidden(res, base) {
    return res.html(`<!DOCTYPE html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>403 · Akses ditolak</title>
<link rel="stylesheet" href="${base}/assets/app.css?v=${ui.ASSET_V}"></head>
<body style="display:grid;place-items:center;min-height:100vh;margin:0;padding:24px">
<div class="card" style="max-width:520px;width:100%;padding:34px;text-align:center">
  <div style="font-size:52px;font-weight:800;color:var(--red,#DC2626);line-height:1">403</div>
  <h2 style="margin:10px 0 8px;font-size:21px">Akses ditolak</h2>
  <p class="muted" style="line-height:1.7;margin:0 auto 18px;max-width:400px">
    Petunjuk Pengguna bersifat <b>baca saja</b>. Materi panduan hanya dapat diubah oleh
    Super Admin Pusat pada menu <b>Master Petunjuk Pengguna</b>.</p>
  <a class="btn btn-primary" href="${base}/petunjuk">Kembali ke Petunjuk Pengguna</a>
</div></body></html>`, 403);
  }

  /* ---------- media panduan: YouTube & PDF ---------- */
  function youtubeId(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    const m = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|v\/|live\/))([\w-]{6,})/i.exec(s);
    return m ? m[1] : '';
  }
  /** ubah tautan YouTube apa pun menjadi URL embed */
  function youtubeEmbed(raw) {
    const id = youtubeId(raw);
    return id ? `https://www.youtube.com/embed/${id}` : '';
  }
  /** gambar pratayang otomatis dari video (dipakai bila Super Admin tidak mengunggah thumbnail) */
  function youtubeThumb(raw) {
    const id = youtubeId(raw);
    return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '';
  }
  function isPdf(url) { return /\.pdf(\?|#|$)/i.test(String(url || '')); }
  function thumbOf(g) {
    const t = String(g.thumbnail_url || '').trim();
    if (t) return t;
    return youtubeThumb(g.video_url);
  }
  function embedUrl(url) {
    const s = String(url || '').trim();
    if (!s) return '';
    // dokumen Google Docs/Drive dapat dipratayang lewat /preview
    const drv = /drive\.google\.com\/file\/d\/([\w-]+)/i.exec(s);
    if (drv) return `https://drive.google.com/file/d/${drv[1]}/preview`;
    const docs = /docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([\w-]+)/i.exec(s);
    if (docs) return `https://docs.google.com/${docs[1]}/d/${docs[2]}/preview`;
    return s + (s.indexOf('#') < 0 ? '#view=FitH' : '');
  }

  /** teks markdown ringan → HTML (aman: escape lebih dulu) */
  function renderBody(md) {
    let t = esc(String(md || ''));
    t = t.replace(/^###\s+(.+)$/gm, '<h4>$1</h4>')
      .replace(/^##\s+(.+)$/gm, '<h3>$1</h3>')
      .replace(/^#\s+(.+)$/gm, '<h3>$1</h3>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>')
      .replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, '<ul>$1</ul>')
      .replace(/\n{2,}/g, '</p><p>')
      .replace(/\n/g, '<br>');
    return '<p>' + t + '</p>';
  }

  /* ---------- modal viewer (video & dokumen) ---------- */
  function videoViewer(g) {
    const src = youtubeEmbed(g.video_url);
    return `<div class="video-embed"><iframe data-src="${esc(src)}" title="${esc(g.judul)}"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>
      <p class="help mt-1">Video diputar langsung di halaman ini. Bila pemutar tidak muncul,
        <a href="${esc(g.video_url)}" target="_blank" rel="noopener">buka di YouTube</a>.</p>`;
  }
  function pdfViewer(g) {
    const url = String(g.lampiran_url || '').trim();
    return `<div class="pdf-embed"><iframe data-src="${esc(embedUrl(url))}" title="${esc(g.judul)}" loading="lazy"></iframe></div>
      <p class="help mt-1">Dokumen ditampilkan langsung di aplikasi. Bila dokumen tidak tampil
        (mis. dibatasi pemilik berkas), gunakan tombol <b>Buka di tab baru</b> di bawah.</p>`;
  }
  function viewerFooter(label, url) {
    return `<a class="btn btn-sm" href="${esc(url)}" target="_blank" rel="noopener">${ui.icon('link')}Buka di tab baru</a>
      <button class="btn btn-sm" type="button" data-close="${label}">Tutup</button>`;
  }

  get('/petunjuk', (req, res) => {
    guard(req, res, 'panduan', 'view');
    const c = ctx(req);
    const q = String(req.query.get('q') || '').trim();
    const kategori = String(req.query.get('kategori') || '').trim();
    const openId = Number(req.query.get('id') || 0);

    let rows = [];
    try { rows = saas.guideRows({ publishedOnly: true, kategori: kategori || undefined, q: q || undefined }); } catch (e) { rows = []; }
    let semua = [];
    try { semua = saas.guideRows({ publishedOnly: true }); } catch (e) { semua = []; }
    const katList = Array.from(new Set(semua.map(r => String(r.kategori || '').trim()).filter(Boolean)));
    const detail = openId ? semua.find(r => Number(r.id) === openId) || null : null;
    const backSuffix = (kategori ? '&kategori=' + encodeURIComponent(kategori) : '') + (q ? '&q=' + encodeURIComponent(q) : '');

    /* modal viewer dikumpulkan dulu, dirender SETELAH grid kartu (pola aman) */
    const viewers = [];
    const card = g => {
      const vid = youtubeEmbed(g.video_url);
      const pdf = String(g.lampiran_url || '').trim();
      const thumb = thumbOf(g);
      const mVideo = 'mGv' + g.id, mPdf = 'mGd' + g.id;
      if (vid && !viewers.some(v => v.id === mVideo)) {
        viewers.push({
          id: mVideo, title: 'Video Panduan — ' + g.judul,
          body: videoViewer(g), footer: viewerFooter(mVideo, g.video_url)
        });
      }
      if (pdf && !viewers.some(v => v.id === mPdf)) {
        viewers.push({
          id: mPdf, title: (isPdf(pdf) ? 'Dokumen PDF — ' : 'Lampiran — ') + g.judul,
          body: pdfViewer(g), footer: viewerFooter(mPdf, pdf)
        });
      }
      return `<div class="guide-card" data-guide="${g.id}">
        <a class="guide-thumb" href="${c.base}/petunjuk?id=${g.id}${backSuffix}" aria-label="Buka panduan ${esc(g.judul)}">
          ${thumb ? `<img src="${esc(thumb)}" alt="Pratayang ${esc(g.judul)}" width="480" height="270" loading="lazy" decoding="async">`
        : `<div class="guide-thumb-ph">${ui.icon('book')}</div>`}
          ${vid ? `<span class="guide-play">${ui.icon('play')}</span>` : ''}
          ${vid ? `<span class="guide-badge">${ui.icon('eye', 'i-sm')} Video</span>`
        : pdf ? `<span class="guide-badge">${ui.icon('file', 'i-sm')} ${isPdf(pdf) ? 'PDF' : 'Dokumen'}</span>` : ''}
        </a>
        <div class="guide-body">
          ${g.kategori ? `<div class="guide-cat">${esc(g.kategori)}</div>` : ''}
          <div class="guide-title">${esc(g.judul)}</div>
          <div class="guide-desc">${esc(g.ringkas || 'Buka untuk membaca panduan lengkap.')}</div>
          <div class="guide-actions">
            <a class="btn btn-sm btn-primary" href="${c.base}/petunjuk?id=${g.id}${backSuffix}">${ui.icon('book')}Baca panduan</a>
            ${vid ? `<button type="button" class="btn btn-sm" data-open="${mVideo}">${ui.icon('play')}Putar Video</button>` : ''}
            ${pdf ? `<button type="button" class="btn btn-sm" data-open="${mPdf}">${ui.icon('file')}${isPdf(pdf) ? 'Lihat PDF' : 'Lihat Lampiran'}</button>` : ''}
          </div>
        </div>
      </div>`;
    };

    let body;
    if (detail) {
      const vid = youtubeEmbed(detail.video_url);
      const pdf = String(detail.lampiran_url || '').trim();
      const thumb = thumbOf(detail);
      body = `<p class="small"><a href="${c.base}/petunjuk">← Semua petunjuk</a></p>
        <div class="card">
          <div class="card-head"><div><h3>${esc(detail.judul)}</h3>
            <div class="sub">${esc(detail.kategori || 'Umum')} · diperbarui ${esc(lib.tglID(detail.updated_at || detail.created_at))}</div></div>
            ${ui.badge('Baca saja', 'gray', 'plain')}</div>
          ${thumb ? `<div class="guide-hero"><img src="${esc(thumb)}" alt="Pratayang ${esc(detail.judul)}" width="960" height="540" loading="lazy" decoding="async"></div>` : ''}
          ${detail.ringkas ? `<div class="alert info">${ui.icon('info')}<div>${esc(detail.ringkas)}</div></div>` : ''}
          ${vid ? `<div class="video-embed mb-2"><iframe src="${esc(vid)}" title="${esc(detail.judul)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>` : ''}
          <div class="guide-content">${renderBody(detail.konten || detail.ringkas || '')}</div>
          ${pdf ? `<div class="guide-doc mt-2">
            <div class="between mb-1"><div class="t-strong">${isPdf(pdf) ? 'Dokumen PDF Panduan' : 'Lampiran Panduan'}</div>
              <a class="btn btn-sm" href="${esc(pdf)}" target="_blank" rel="noopener">${ui.icon('link')}Buka di tab baru</a></div>
            <div class="pdf-embed"><iframe src="${esc(embedUrl(pdf))}" title="${esc(detail.judul)}" loading="lazy"></iframe></div>
            <div class="help">Dokumen ditampilkan langsung di halaman ini — tidak perlu mengunduh.</div>
          </div>` : ''}
        </div>`;
    } else {
      body = `<div class="alert info">${ui.icon('info')}<div><b>Petunjuk Pengguna.</b>
        Kumpulan panduan resmi yang diterbitkan Super Admin Pusat — tampil untuk seluruh sekolah dan tidak dapat diubah dari akun sekolah.
        Video &amp; dokumen dibuka <b>langsung di halaman ini</b>.</div></div>
      <form method="get" action="${c.base}/petunjuk" class="filterbar">
        <div class="field"><label>Kategori</label><select name="kategori" data-autosubmit>
          <option value="">Semua kategori</option>
          ${katList.map(k => `<option value="${esc(k)}" ${kategori === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}
        </select></div>
        <div class="field"><label>Cari judul panduan</label>
          <input type="text" name="q" value="${esc(q)}" placeholder="mis. cara bayar iuran" data-table-search=".guide-grid"></div>
        <button class="btn">${ui.icon('search')}Cari</button>
        ${q || kategori ? `<a class="btn" href="${c.base}/petunjuk">Reset</a>` : ''}
      </form>
      ${rows.length ? `<div class="guide-grid">${rows.map(card).join('')}</div>`
        : ui.emptyState(q || kategori ? 'Tidak ada panduan yang cocok' : 'Belum ada petunjuk pengguna',
          q || kategori ? 'Coba kata kunci lain atau pilih kategori berbeda.' : 'Super Admin Pusat belum menerbitkan materi panduan.')}
      ${viewers.map(v => ui.modal(v.id, { title: v.title, body: v.body, footer: v.footer, wide: true })).join('')}`;
    }

    page(req, res, {
      title: 'Petunjuk Pengguna',
      sub: 'Dokumentasi resmi aplikasi — hanya baca',
      active: 'panduan',
      content: body
    });
  });

  /* ---- semua endpoint tulis diblokir untuk akun sekolah (403) ---- */
  const blocked = (req, res) => {
    try { dbm.logAudit(req.user, 'DITOLAK', 'panduan', 'Mencoba mengubah petunjuk pengguna dari akun sekolah (read-only)'); } catch (e) { }
    return forbidden(res, req.BASE);
  };
  post('/petunjuk/save', (req, res) => blocked(req, res));
  post('/petunjuk/delete', (req, res) => blocked(req, res));
  post('/petunjuk/urut', (req, res) => blocked(req, res));
};
