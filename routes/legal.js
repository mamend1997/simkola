'use strict';
/**
 * ==================================================================
 * DOKUMEN LEGALITAS LAYANAN
 * ------------------------------------------------------------------
 * 1. Halaman PUBLIK (tanpa login):
 *      GET /syarat-ketentuan   → Syarat & Ketentuan (ToS)
 *      GET /sla                → Service Level Agreement (SLA)
 * 2. Halaman di dalam panel sekolah (sidebar tenant, paling bawah):
 *      GET /legal/tos          → Syarat & Ketentuan
 *      GET /legal/sla          → Service Level Agreement
 *
 * Isi teks diatur Super Admin Pusat di menu "Legalitas & SLA"
 * (/super-admin/legal) dan disimpan pada control plane (saas_settings):
 *   legal_tos, legal_sla, legal_tos_judul, legal_sla_judul,
 *   legal_tos_updated, legal_sla_updated, legal_kontak
 * ================================================================== */
const DEFAULT_TOS = `1. Layanan
Aplikasi ini disediakan sebagai layanan berlangganan (SaaS) administrasi keuangan sekolah.

2. Akun & Keamanan
Sekolah bertanggung jawab atas kerahasiaan kredensial akun penggunanya.

3. Data
Seluruh data keuangan sekolah merupakan milik sekolah. Penyedia layanan hanya memproses data untuk keperluan operasional aplikasi.

4. Pembayaran
Masa aktif layanan mengikuti paket langganan yang dipilih dan diperpanjang sebelum tanggal berakhir.

5. Penghentian
Penyedia layanan dapat menangguhkan akun yang melanggar ketentuan atau tidak memperpanjang langganan.`;

const DEFAULT_SLA = `1. Ketersediaan Layanan
Target ketersediaan layanan 99% per bulan, di luar pemeliharaan terjadwal.

2. Pemeliharaan
Pemeliharaan terjadwal diinformasikan melalui pengumuman pada aplikasi.

3. Dukungan
Permintaan bantuan dilayani melalui menu Pusat Tiket pada jam kerja (Senin–Jumat, 08.00–16.00 WIB).

4. Pencadangan Data
Data dicadangkan secara otomatis (auto-backup) dan dapat dipulihkan atas permintaan sekolah.

5. Pelaporan Gangguan
Gangguan dapat dilaporkan melalui menu Bantuan & Tiket Kendala pada aplikasi.`;

module.exports = ({ get, dbm, lib, ui, saas, page, ctx, guard }) => {
  const DOCS = {
    tos: { path: '/syarat-ketentuan', kunci: 'tos', judulKey: 'legal_tos_judul', defaultJudul: 'Syarat & Ketentuan Layanan', active: 'legal_tos' },
    sla: { path: '/sla', kunci: 'sla', judulKey: 'legal_sla_judul', defaultJudul: 'Service Level Agreement (SLA)', active: 'legal_sla' }
  };

  /** isi dokumen: judul, paragraf, tanggal pembaruan & kontak (sumber tunggal) */
  function docOf(jenis) {
    const d = DOCS[jenis];
    const judul = String((saas && saas.get(d.judulKey, '')) || '').trim() || d.defaultJudul;
    const teks = String((saas && saas.get('legal_' + d.kunci, '')) || '').trim()
      || (jenis === 'tos' ? DEFAULT_TOS : DEFAULT_SLA);
    const updated = String((saas && saas.get('legal_' + d.kunci + '_updated', '')) || '').trim();
    const kontak = String((saas && saas.get('legal_kontak', '')) || '').trim();
    const esc = lib.esc;
    const paragraf = teks.split('\n').map(line => {
      const t = line.trim();
      if (!t) return '<div style="height:8px"></div>';
      if (/^\d+\.\s/.test(t)) return `<h3 class="legal-h">${esc(t)}</h3>`;
      return `<p class="legal-p">${esc(t)}</p>`;
    }).join('');
    return { judul, teks, updated, kontak, paragraf };
  }

  function render(req, res, jenis) {
    const d = DOCS[jenis];
    const appName = saas ? saas.appName() : 'SIMKEU';
    const appLogo = saas ? saas.appLogo() : '';
    const tema = saas ? saas.tema() : '#F97316';
    const base = req.BASE;
    const doc = docOf(jenis);
    const esc = lib.esc;
    res.html(`<!DOCTYPE html><html lang="id"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(doc.judul)} · ${esc(appName)}</title>
${ui.fontLinks()}
<link rel="stylesheet" href="${base}/assets/app.css?v=${ui.ASSET_V}">
${ui.themeCss(tema)}
<link rel="icon" href="${base}/favicon.ico">
<style>
.legal-wrap{max-width:820px;margin:0 auto;padding:26px 18px 56px}
.legal-top{display:flex;align-items:center;gap:12px;margin-bottom:18px}
.legal-top .lg{width:44px;height:44px;border-radius:14px;overflow:hidden;display:grid;place-items:center;background:#FFF1E6}
.legal-top .lg img{width:100%;height:100%;object-fit:contain}
.legal-card{padding:26px 24px}
.legal-h{margin:18px 0 6px;font-size:15.5px;letter-spacing:-.01em}
.legal-p{margin:0 0 6px;line-height:1.75;color:#4B4460;font-size:14px;white-space:pre-wrap}
.legal-meta{font-size:12px;color:#8A8598;margin-bottom:14px}
.legal-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}
</style>
</head><body>
<div class="legal-wrap">
  <div class="legal-top">
    <div class="lg">${appLogo ? `<img src="${esc(appLogo)}" alt="Logo">` : ui.icon('wallet')}</div>
    <div><div style="font-weight:800;letter-spacing:-.02em">${esc(appName)}</div>
      <div class="small muted">Dokumen layanan resmi</div></div>
    <a class="btn btn-sm ml-auto" href="${base}/login">Halaman Masuk</a>
  </div>
  <div class="card legal-card">
    <h1 style="font-size:23px;margin:0 0 6px;letter-spacing:-.02em">${esc(doc.judul)}</h1>
    <div class="legal-meta">${doc.updated ? 'Diperbarui: ' + esc(doc.updated) : 'Dokumen resmi layanan'}${doc.kontak ? ' · Kontak: ' + esc(doc.kontak) : ''}</div>
    ${doc.paragraf}
    <div class="legal-actions">
      <a class="btn" href="${base}/${jenis === 'tos' ? 'sla' : 'syarat-ketentuan'}">${jenis === 'tos' ? 'Lihat SLA' : 'Lihat Syarat & Ketentuan'}</a>
      <a class="btn btn-primary" href="${base}/login">Masuk ke Aplikasi</a>
    </div>
  </div>
</div>
</body></html>`);
  }

  /** halaman di dalam panel sekolah (sidebar tetap tampil) */
  function renderApp(req, res, jenis) {
    const d = DOCS[jenis];
    const c = ctx(req);
    const doc = docOf(jenis);
    const esc = lib.esc;
    const content = `<div class="card mb-3">
      <div class="card-head">
        <div><h3>${esc(doc.judul)}</h3>
          <div class="sub">${doc.updated ? 'Diperbarui: ' + esc(doc.updated) : 'Dokumen resmi layanan'}${doc.kontak ? ' · Kontak: ' + esc(doc.kontak) : ''}</div></div>
        ${ui.badge(jenis === 'tos' ? 'Terms of Service' : 'Service Level Agreement', 'orange', 'plain')}
      </div>
      <div class="alert info">${ui.icon('info')}<div>Dokumen ini dikelola terpusat oleh <b>Super Admin Pusat</b>.
        Perubahan yang dilakukan administrator pusat langsung berlaku pada semua sekolah.</div></div>
      <div class="legal-doc">${doc.paragraf}</div>
      <p class="help">Dokumen juga dapat dibuka tanpa login pada alamat
        <code>${esc(c.base + d.path)}</code>.</p>
    </div>
    <div class="toolbar">
      <a class="btn" href="${c.base}/legal/${jenis === 'tos' ? 'sla' : 'tos'}">${ui.icon(jenis === 'tos' ? 'shield' : 'file')}${jenis === 'tos' ? 'Service Level Agreement (SLA)' : 'Syarat & Ketentuan Layanan'}</a>
      ${doc.kontak ? `<span class="small muted">Kontak layanan: <b>${esc(doc.kontak)}</b></span>` : ''}
    </div>`;
    page(req, res, {
      title: doc.judul,
      sub: 'Dokumen resmi layanan yang berlaku untuk sekolah ini',
      active: d.active,
      content
    });
  }

  get('/syarat-ketentuan', (req, res) => render(req, res, 'tos'));
  get('/sla', (req, res) => render(req, res, 'sla'));

  /* ---- versi panel sekolah (menu sidebar paling bawah) ---- */
  if (get && page && ctx) {
    get('/legal/tos', (req, res) => {
      if (guard) guard(req, res, 'legal', 'view');
      renderApp(req, res, 'tos');
    });
    get('/legal/sla', (req, res) => {
      if (guard) guard(req, res, 'legal', 'view');
      renderApp(req, res, 'sla');
    });
  }

  module.exports.DEFAULTS = { tos: DEFAULT_TOS, sla: DEFAULT_SLA };
};
