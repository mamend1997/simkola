'use strict';
/* Portal publik cek tagihan orang tua — tanpa login, verifikasi Nama + Tanggal Lahir */
module.exports = ({ get, post, dbm, lib, ui, guard, flashUrl }) => {
  const { db } = dbm;
  const { esc, rupiah, tglID } = lib;

  function normalizeDate(s) {
    const v = String(s || '').trim();
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(v);
    if (!m) return null;
    const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  function shell({ base, settings, content, title }) {
    const logo = settings.sekolah_logo
      ? `<img src="${esc(settings.sekolah_logo)}" alt="Logo">`
      : `<div class="p-logo-ph">${esc((settings.sekolah_nama || 'S').charAt(0))}</div>`;
    return `<!DOCTYPE html><html lang="id"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${esc(settings.sekolah_nama || 'Sekolah')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${base}/assets/app.css?v=${ui.ASSET_V}">
<link rel="icon" href="${base}/favicon.ico">
<meta name="theme-color" content="#F97316">
</head><body class="portal-body">
<div class="portal-wrap">
  <header class="portal-head">
    ${logo}
    <div>
      <div class="pn">${esc(settings.sekolah_nama || 'Sekolah')}</div>
      <div class="ps">Portal Cek Tagihan Iuran Siswa</div>
    </div>

  </header>
  ${content}
  <footer class="portal-foot">© ${new Date().getFullYear()} ${esc(settings.sekolah_nama || '')} · Portal ini hanya menampilkan ringkasan tagihan sesuai data yang cocok.</footer>
</div>
<script src="${base}/assets/app.js?v=${ui.ASSET_V}"></script>
</body></html>`;
  }

  function searchForm({ settings, base, nama = '', lahir = '', err = '' }) {
    return `<div class="portal-card">
      <h2>Cek Tagihan Iuran</h2>
      <p class="muted small">Masukkan <b>nama siswa</b> dan <b>tanggal lahir</b> sesuai data sekolah untuk melihat tagihan. Kedua data harus cocok (verifikasi 2 faktor sederhana).</p>
      ${err ? `<div class="alert err">${ui.icon('alert')}<div>${esc(err)}</div></div>` : ''}
      <form method="get" action="${base}/portal">
        <div class="field"><label>Nama Siswa</label>
          <input name="nama" value="${esc(nama)}" required placeholder="Ketik minimal 3 huruf nama siswa" autocomplete="off"
            data-autocomplete="${base}/portal/siswa" data-autocomplete-min="3">
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
      for (const [taId, tags] of byTa) {
        const ta = taList.find(t => Number(t.id) === Number(taId));
        const tag = tags.reduce((a, t) => a + Number(t.nominal || 0), 0);
        const bay = tags.reduce((a, t) => a + Number(t.terbayar || 0), 0);
        const sisa = tags.reduce((a, t) => a + Number(t.sisa || 0), 0);
        const pot = tags.reduce((a, t) => a + Number(t.total_potongan || 0), 0);
        grandTagihan += tag; grandBayar += bay; grandSisa += sisa;
        body += `<div class="portal-ta">
          <div class="ta-head"><b>Tahun Pelajaran ${esc(ta ? ta.nama : '-')}</b>
            <span class="badge ${sisa > 0 ? 'amber' : 'green'}">${sisa > 0 ? 'Ada tunggakan' : 'Lunas'}</span></div>
          <div class="table-wrap"><table><thead><tr><th>Jenis Grup Iuran</th><th>Jenis</th><th class="num">Total Tagihan</th><th class="num">Sudah Dibayar</th><th class="num">Potongan</th><th class="num">Sisa Terhutang</th></tr></thead><tbody>
          ${tags.map(t => `<tr><td class="t-strong">${esc(t.grup_nama)}</td><td>${t.grup_jenis === 'bulanan' ? 'Bulanan' : 'Non-Bulanan'}</td>
            <td class="num">${rupiah(t.nominal)}</td><td class="num">${rupiah(t.terbayar)}</td><td class="num">${rupiah(t.total_potongan)}</td>
            <td class="num" style="color:${t.sisa > 0 ? 'var(--red)' : 'var(--green)'}">${rupiah(t.sisa)}${t.writeoff === 'pemutihan' ? ' <span class="badge blue plain">Di-pemutihan</span>' : ''}</td></tr>`).join('')}
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
        <div class="center mt-2"><a class="btn" href="${base}/portal">${ui.icon('search')}Kembali ke Halaman Pencarian</a></div>
      </div>
      ${feedbackForm({ base, students, pesanOk, pesanErr })}`;
  }

  /** form catatan / umpan balik orang tua (masuk ke Dashboard admin) */
  function feedbackForm({ base, students, pesanOk = '', pesanErr = '' }) {
    const s = students[0] || {};
    return `<div class="portal-card">
      <h3>Kolom Catatan Orang Tua / Wali</h3>
      <p class="muted small">Bila terdapat kekeliruan data tagihan atau pembayaran, tuliskan catatan Anda di bawah ini.
        Catatan akan masuk ke <b>Dashboard Bendahara</b> untuk ditindaklanjuti petugas.</p>
      ${pesanOk ? `<div class="alert ok">${ui.icon('check')}<div>${esc(pesanOk)}</div></div>` : ''}
      ${pesanErr ? `<div class="alert err">${ui.icon('alert')}<div>${esc(pesanErr)}</div></div>` : ''}
      <form method="post" action="${base}/portal/pesan">
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
    if (dbm.getSetting('portal_aktif', '1') !== '1') {
      return res.html(shell({ base, settings, title: 'Portal Ditutup', content: `<div class="portal-card"><h2>Portal sementara ditutup</h2><p class="muted">Pengelola sekolah menonaktifkan portal cek tagihan. Silakan hubungi bendahara sekolah.</p></div>` }));
    }
    const nama = String(req.query.get('nama') || '').trim();
    const lahirRaw = String(req.query.get('lahir') || '').trim();
    const pesanOk = String(req.query.get('ok') || '').trim();
    const pesanErr = String(req.query.get('err') || '').trim();
    if (!nama && !lahirRaw) return res.html(shell({ base, settings, title: 'Cek Tagihan', content: searchForm({ settings, base }) }));
    const lahir = normalizeDate(lahirRaw) || (/^\d{4}-\d{2}-\d{2}$/.test(lahirRaw) ? lahirRaw : null);
    if (!nama || !lahir) {
      return res.html(shell({ base, settings, title: 'Cek Tagihan', content: searchForm({ settings, base, nama, lahir: lahirRaw, err: 'Nama dan tanggal lahir wajib diisi dengan benar.' }) }));
    }
    const cands = db.prepare(`SELECT s.*, k.nama kelas_nama FROM siswa s LEFT JOIN kelas k ON k.id=s.kelas_id
      WHERE lower(trim(s.nama))=lower(?) AND s.tanggal_lahir=?`).all(nama, lahir);
    if (!cands.length) {
      return res.html(shell({
        base, settings, title: 'Data Tidak Ditemukan',
        content: searchForm({ settings, base, nama, lahir: lahirRaw, err: 'Data tidak ditemukan. Pastikan nama dan tanggal lahir sama persis dengan data sekolah (tanggal lahir wajib diisi petugas).' })
      }));
    }
    const students = cands.map(s => ({ ...s, tags: dbm.iuranTagihanRows({ siswaId: s.id }) }));
    res.html(shell({ base, settings, title: 'Tagihan Siswa', content: renderResults({ settings, base, students, pesanOk, pesanErr }) }));
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
    const backTo = nm => base + '/portal?nama=' + encodeURIComponent(nm || '') + '&lahir=' + encodeURIComponent(String((siswaRow || {}).tanggal_lahir || ''));
    if (!siswaRow) return res.redirect(base + '/portal?err=' + encodeURIComponent('Sesi pencarian berakhir. Silakan cari data tagihan kembali, lalu kirim catatan.'));
    if (pesan.length < 5) return res.redirect(backTo(siswaRow.nama) + '&err=' + encodeURIComponent('Catatan terlalu pendek — tuliskan minimal 5 karakter.'));
    dbm.portalPesanAdd({ siswa_id: siswaRow.id, nama: siswaRow.nama, kontak, pesan, taId: (dbm.activeTahun() || {}).id });
    dbm.logAudit(null, 'PESAN ORANG TUA', 'portal', `Catatan orang tua/wali ${siswaRow.nama}: ${pesan.slice(0, 140)}`);
    res.redirect(backTo(siswaRow.nama) + '&ok=' + encodeURIComponent('Terima kasih, catatan Anda sudah dikirim ke bendahara sekolah.'));
  });

  post('/portal/cari', (req, res) => {
    const qs = new URLSearchParams({ nama: String(req.body.nama || ''), lahir: String(req.body.lahir || '') });
    res.redirect(req.BASE + '/portal?' + qs.toString().replace(/\+/g, '%20'));
  });
};
