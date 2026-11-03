'use strict';
/**
 * ==================================================================
 * PETUNJUK PENGGUNA (sisi SEKOLAH) — READ ONLY
 * ------------------------------------------------------------------
 * Materi panduan SEPENUHNYA dikelola Super Admin Pusat
 * (control plane `master_guides`, menu "Master Petunjuk Pengguna").
 * Halaman sekolah hanya menampilkan hasil terbit + pencarian judul.
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

  /** ubah tautan YouTube apa pun menjadi URL embed */
  function youtubeEmbed(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    const m = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|v\/))([\w-]{6,})/i.exec(s);
    return m ? `https://www.youtube.com/embed/${m[1]}` : '';
  }
  function isPdf(url) { return /\.pdf(\?|#|$)/i.test(String(url || '')); }

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
    const detail = openId ? rows.find(r => Number(r.id) === openId) || null : null;

    const card = g => {
      const vid = youtubeEmbed(g.video_url);
      const pdf = g.lampiran_url || '';
      return `<a class="guide-card" href="${c.base}/petunjuk?id=${g.id}${kategori ? '&kategori=' + encodeURIComponent(kategori) : ''}">
        <div class="guide-thumb"><div class="guide-thumb-ph">${ui.icon('book')}</div>
          ${vid ? `<span class="guide-badge">${ui.icon('eye', 'i-sm')} Video</span>` : pdf ? `<span class="guide-badge">${ui.icon('file', 'i-sm')} PDF</span>` : ''}</div>
        <div class="guide-body">
          ${g.kategori ? `<div class="guide-cat">${esc(g.kategori)}</div>` : ''}
          <div class="guide-title">${esc(g.judul)}</div>
          <div class="guide-desc">${esc(g.ringkas || 'Buka untuk membaca panduan lengkap.')}</div>
          <div class="guide-actions"><span class="btn btn-sm">${ui.icon('file')}Baca panduan</span></div>
        </div>
      </a>`;
    };

    let body;
    if (detail) {
      const vid = youtubeEmbed(detail.video_url);
      body = `<p class="small"><a href="${c.base}/petunjuk">← Semua petunjuk</a></p>
        <div class="card">
          <div class="card-head"><div><h3>${esc(detail.judul)}</h3>
            <div class="sub">${esc(detail.kategori || 'Umum')} · diperbarui ${esc(lib.tglID(detail.updated_at || detail.created_at))}</div></div>
            ${ui.badge('Baca saja', 'gray', 'plain')}</div>
          ${detail.ringkas ? `<div class="alert info">${ui.icon('info')}<div>${esc(detail.ringkas)}</div></div>` : ''}
          ${vid ? `<div class="video-embed mb-2"><iframe src="${esc(vid)}" title="${esc(detail.judul)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>` : ''}
          <div class="guide-content">${renderBody(detail.konten || detail.ringkas || '')}</div>
          ${detail.lampiran_url ? `<a class="btn mt-2" href="${esc(detail.lampiran_url)}" target="_blank" rel="noopener">${ui.icon('download')}${isPdf(detail.lampiran_url) ? 'Buka dokumen PDF' : 'Buka lampiran'}</a>` : ''}
        </div>`;
    } else {
      body = `<div class="alert info">${ui.icon('info')}<div><b>Petunjuk Pengguna.</b>
        Kumpulan panduan resmi yang diterbitkan Super Admin Pusat — tampil untuk seluruh sekolah dan tidak dapat diubah dari akun sekolah.</div></div>
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
          q || kategori ? 'Coba kata kunci lain atau pilih kategori berbeda.' : 'Super Admin Pusat belum menerbitkan materi panduan.')}`;
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
