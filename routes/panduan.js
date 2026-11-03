'use strict';
/**
 * Petunjuk Pengguna — daftar panduan bergambar (thumbnail), video YouTube
 * tersemat (embed) dan/atau dokumen PDF.
 * Dapat dibaca semua role (Bendahara, Kepala Sekolah, Staff, Demo);
 * pembuatan & pengubahan panduan hanya untuk Super Admin / pemegang hak edit.
 */
module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can, uploadMedia, flashUrl }) => {
  const { esc } = lib;

  function safeBack(raw, def = '/petunjuk') {
    const s = String(raw || '');
    return /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/.test(s) && !s.startsWith('//') ? s : def;
  }
  /** ubah tautan YouTube apa pun menjadi URL embed */
  function youtubeEmbed(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    const m = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|v\/))([\w-]{6,})/i.exec(s);
    return m ? `https://www.youtube.com/embed/${m[1]}` : '';
  }
  function isPdfFile(url) { return /\.pdf(\?|#|$)/i.test(String(url || '')); }

  get('/petunjuk', (req, res) => {
    guard(req, res, 'panduan', 'view');
    const c = ctx(req);
    const editable = c.can('panduan', 'edit');
    const createable = c.can('panduan', 'create');
    const kategori = String(req.query.get('kategori') || '').trim();
    const editId = Number(req.query.get('edit') || 0);
    const ed = editId ? dbm.panduanById(editId) : null;
    const rows = dbm.panduanList({ kategori: kategori || undefined });
    const katList = Array.from(new Set(dbm.panduanList({}).map(r => String(r.kategori || '').trim()).filter(Boolean)));

    const form = (p) => `<form method="post" action="${c.base}/petunjuk/save" id="fPanduan" enctype="application/x-www-form-urlencoded">
      <input type="hidden" name="id" value="${p ? p.id : ''}">
      <input type="hidden" name="thumb_b64" id="thumb_b64" value="">
      <input type="hidden" name="pdf_b64" id="pdf_b64" value="">
      <div class="row2">
        <div class="field"><label>Judul Petunjuk <span style="color:var(--red)">*</span></label>
          <input name="judul" required maxlength="160" value="${esc(p ? p.judul : '')}" placeholder="Contoh: Cara mencatat pembayaran iuran siswa"></div>
        <div class="field"><label>Kategori / Kelompok</label>
          <input name="kategori" list="katPanduan" maxlength="60" value="${esc(p ? (p.kategori || '') : '')}" placeholder="Contoh: Iuran & SPP">
          <datalist id="katPanduan">${katList.map(k => `<option value="${esc(k)}"></option>`).join('')}</datalist></div>
      </div>
      <div class="field"><label>Ringkasan Langkah</label>
        <textarea name="ringkas" rows="3" maxlength="600" placeholder="Tuliskan ringkas isi panduan / langkah singkat">${esc(p ? (p.ringkas || '') : '')}</textarea></div>
      <div class="row2">
        <div class="field"><label>Link Video YouTube (opsional)</label>
          <input name="video_url" value="${esc(p ? (p.video_url || '') : '')}" placeholder="https://www.youtube.com/watch?v=…">
          <div class="hint">Tautan otomatis diubah menjadi pemutar YouTube tersemat (embed).</div></div>
        <div class="field"><label>Link Dokumen PDF (opsional)</label>
          <input name="pdf_url" value="${esc(p ? (p.pdf_url || '') : '')}" placeholder="https://…/petunjuk.pdf">
          <div class="hint">Boleh tautan Drive/website, atau unggah berkas PDF di bawah.</div></div>
      </div>
      <div class="row3">
        <div class="field"><label>Thumbnail Gambar (PNG/JPG)</label>
          <input type="file" accept="image/*" data-b64="thumb_b64" data-max="5">
          <div class="hint" id="thumb_b64-info">Rekomendasi <b>1280 × 720 px</b> (16:9) agar seragam. Maks 5 MB.</div></div>
        <div class="field"><label>Unggah Berkas PDF (opsional)</label>
          <input type="file" accept="application/pdf" data-b64="pdf_b64" data-max="20">
          <div class="hint" id="pdf_b64-info">Maks 20 MB. Bila diisi, mengalahkan link PDF di atas.</div></div>
        <div class="field"><label>Urutan &amp; Status</label>
          <input type="number" name="urutan" value="${p ? Number(p.urutan || 0) : rows.length + 1}" min="0" step="1">
          <label class="check mt-1"><input type="checkbox" name="aktif" value="1" ${!p || p.aktif ? 'checked' : ''}> Tampilkan pada daftar petunjuk</label></div>
      </div>
      ${p && p.thumbnail ? `<div class="flex" style="gap:10px;align-items:center"><img src="${esc(p.thumbnail)}" alt="thumb" style="width:160px;height:90px;object-fit:cover;border-radius:10px;border:1px solid var(--line)">
        <span class="small muted">Thumbnail saat ini. Unggah berkas baru untuk menggantinya.</span></div>` : ''}
    </form>`;

    const card = (p) => {
      const vid = youtubeEmbed(p.video_url);
      const pdf = p.pdf_url || '';
      const tools = [];
      if (vid) tools.push(`<button type="button" class="btn btn-sm" data-open="mVid${p.id}">${ui.icon('eye')}Tonton Video</button>`);
      if (pdf) tools.push(`<a class="btn btn-sm" href="${esc(pdf)}" target="_blank" rel="noopener">${ui.icon('file')}Buka PDF</a>`);
      const admin = editable ? `<a class="btn btn-sm btn-icon" href="${c.base}/petunjuk?edit=${p.id}" title="Edit">${ui.icon('edit')}</a>
        <form method="post" action="${c.base}/petunjuk/delete" style="display:inline" data-confirm="Hapus petunjuk ${esc(p.judul)}?">
          <input type="hidden" name="id" value="${p.id}"><button class="btn btn-sm btn-danger btn-icon">${ui.icon('trash')}</button></form>` : '';
      return `<div class="guide-card" data-panduan="${p.id}">
        <div class="guide-thumb">${p.thumbnail
          ? `<img src="${esc(p.thumbnail)}" alt="${esc(p.judul)}" loading="lazy">`
          : `<div class="guide-thumb-ph">${ui.icon('book')}</div>`}
          ${vid ? `<span class="guide-badge">${ui.icon('eye', 'i-sm')} Video</span>` : pdf ? `<span class="guide-badge">${ui.icon('file', 'i-sm')} PDF</span>` : ''}
        </div>
        <div class="guide-body">
          ${p.kategori ? `<div class="guide-cat">${esc(p.kategori)}</div>` : ''}
          <div class="guide-title">${esc(p.judul)}</div>
          ${p.ringkas ? `<div class="guide-desc">${esc(p.ringkas)}</div>` : '<div class="guide-desc muted">Tanpa ringkasan.</div>'}
          <div class="guide-actions">${tools.join('')}${admin}</div>
        </div>
      </div>`;
    };

    const content = `<div class="between mb-2">
      <div class="alert info" style="margin:0;flex:1">${ui.icon('info')}<div><b>Petunjuk Pengguna.</b>
        Kumpulan panduan pemakaian aplikasi: thumbnail gambar, judul, ringkasan langkah, serta video YouTube / dokumen PDF tersemat.</div></div>
    </div>
    ${katList.length ? `<form method="get" action="${c.base}/petunjuk" class="filterbar">
      <div class="field"><label>Kategori</label><select name="kategori" data-autosubmit>
        <option value="">Semua kategori</option>
        ${katList.map(k => `<option value="${esc(k)}" ${kategori === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}
      </select></div>
      <input placeholder="Cari judul petunjuk" data-table-search=".guide-grid" style="min-width:240px">
      <button class="btn">${ui.icon('search')}Terapkan</button>
      ${kategori ? `<a class="btn" href="${c.base}/petunjuk">Reset</a>` : ''}
    </form>` : ''}
    ${rows.length ? `<div class="guide-grid">${rows.map(card).join('')}</div>`
      : ui.emptyState('Belum ada petunjuk', createable ? 'Tambahkan panduan pertama pada formulir di bawah.' : 'Panduan akan tampil di sini setelah ditambahkan admin.')}

    ${rows.map(p => youtubeEmbed(p.video_url) ? ui.modal('mVid' + p.id, {
      title: 'Video Petunjuk — ' + p.judul, wide: true,
      body: `<div class="video-embed"><iframe src="${esc(youtubeEmbed(p.video_url))}" title="${esc(p.judul)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>
        ${p.ringkas ? `<div class="help mt-1">${esc(p.ringkas)}</div>` : ''}`,
      footer: `<button class="btn" data-close="mVid${p.id}">Tutup</button>`
    }) : '').join('')}

    ${createable ? `<div class="card mt-3">
      <div class="card-head"><div><h3>${ed ? 'Edit Petunjuk Pengguna' : 'Tambah Petunjuk Pengguna'}</h3>
        <div class="sub">Thumbnail gambar, judul, ringkasan, video YouTube &amp; dokumen PDF</div></div>
        ${ed ? `<div class="toolbar"><a class="btn btn-sm" href="${c.base}/petunjuk">${ui.icon('x')}Batal Edit</a></div>` : ''}</div>
      ${form(ed)}
      <div class="form-actions"><button class="btn btn-primary" form="fPanduan">${ui.icon('save')}${ed ? 'Simpan Perubahan' : 'Tambah Petunjuk'}</button></div>
    </div>` : ''}`;
    page(req, res, { title: 'Petunjuk Pengguna', sub: 'Panduan pemakaian aplikasi: gambar, video & dokumen', active: 'panduan', content });
  });

  post('/petunjuk/save', async (req, res) => {
    if (!guard(req, res, 'panduan', req.body.id ? 'edit' : 'create')) return;
    const back = req.BASE + safeBack(req.body.back);
    const nama = String(req.body.judul || '').trim();
    if (!nama) return res.redirect(back + '?err=' + encodeURIComponent('Judul petunjuk wajib diisi.'));
    let thumb = String(req.body.thumbnail_lama || '').trim();
    let pdf = String(req.body.pdf_url || '').trim();
    const lama = req.body.id ? dbm.panduanById(req.body.id) : null;
    if (lama && !req.body.thumbnail_lama) thumb = lama.thumbnail || '';
    try {
      if (req.body.thumb_b64) thumb = await uploadMedia(req.body.thumb_b64, `panduan-${Date.now()}.${(String(req.body.thumb_b64).match(/^data:image\/([a-z+]+);/i) || [, 'jpg'])[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg')}`);
      if (req.body.pdf_b64) pdf = await uploadMedia(req.body.pdf_b64, `panduan-${Date.now()}.pdf`);
    } catch (e) {
      return res.redirect(back + '?err=' + encodeURIComponent('Gagal mengunggah berkas: ' + e.message));
    }
    const row = dbm.panduanSave({
      id: req.body.id, judul: nama, kategori: req.body.kategori, ringkas: req.body.ringkas,
      thumbnail: thumb, video_url: req.body.video_url, pdf_url: pdf,
      urutan: req.body.urutan, aktif: req.body.aktif ? 1 : 0, oleh: req.user.nama
    });
    if (!row) return res.redirect(back + '?err=' + encodeURIComponent('Data petunjuk tidak valid.'));
    dbm.logAudit(req.user, req.body.id ? 'EDIT' : 'TAMBAH', 'panduan', `${req.body.id ? 'Edit' : 'Tambah'} petunjuk pengguna: ${nama}`);
    res.redirect(flashUrl ? req.BASE + flashUrl('/petunjuk', 'ok', 'Petunjuk pengguna disimpan.') : back);
  });

  post('/petunjuk/delete', (req, res) => {
    if (!guard(req, res, 'panduan', 'delete')) return;
    const row = dbm.panduanDelete(req.body.id);
    if (!row) return res.redirect(req.BASE + '/petunjuk?err=' + encodeURIComponent('Petunjuk tidak ditemukan.'));
    dbm.logAudit(req.user, 'HAPUS', 'panduan', `Menghapus petunjuk pengguna: ${row.judul}`);
    res.redirect(req.BASE + '/petunjuk?ok=' + encodeURIComponent('Petunjuk pengguna dihapus.'));
  });

  post('/petunjuk/urut', (req, res) => {
    if (!guard(req, res, 'panduan', 'edit')) return;
    const ids = [].concat(req.body.ids || []).flatMap(v => String(v).split(',')).map(Number).filter(Boolean);
    dbm.panduanUrutkan(ids);
    dbm.logAudit(req.user, 'EDIT', 'panduan', `Mengubah urutan ${ids.length} petunjuk pengguna`);
    res.redirect(req.BASE + '/petunjuk?ok=' + encodeURIComponent('Urutan petunjuk diperbarui.'));
  });
};
