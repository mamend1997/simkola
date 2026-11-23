'use strict';
/* Panel persetujuan (approval) draf pengeluaran — Kepala Sekolah */
module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can }) => {
  const { db } = dbm;
  const { esc, rupiah, tglID, nowStamp } = lib;

  function drafts(taId) {
    return db.prepare(`SELECT t.*, b.nama bku_nama, c.kode coa_kode, c.nama coa_nama,
        u.nama pembuat, u.jabatan pembuat_jabatan
      FROM transaksi t JOIN bku b ON b.id=t.bku_id LEFT JOIN coa c ON c.id=t.coa_id
      LEFT JOIN users u ON u.id=t.created_by
      WHERE t.status='pending' AND b.tahun_ajaran_id=? AND ${dbm.bkuTransactionVisibleSql('t', 'b')}
      ORDER BY t.created_at ASC, t.id ASC`).all(taId || 0);
  }

  get('/approval', (req, res) => {
    guard(req, res, 'transaksi', 'approve');
    const c = ctx(req);
    const list = drafts(c.taId);
    const riwayat = db.prepare(`SELECT t.*, b.nama bku_nama, u.nama pembuat, a.nama penyetuju
      FROM transaksi t JOIN bku b ON b.id=t.bku_id LEFT JOIN users u ON u.id=t.created_by LEFT JOIN users a ON a.id=t.approved_by
      WHERE t.status IN ('posted','rejected') AND t.approved_by IS NOT NULL AND t.approved_at IS NOT NULL
        AND b.tahun_ajaran_id=? AND ${dbm.bkuTransactionVisibleSql('t', 'b')}
      ORDER BY t.approved_at DESC LIMIT 40`).all(c.taId || 0);
    const threshold = Number(dbm.getSetting('approval_threshold', '5000000'));
    const total = list.reduce((s, t) => s + Number(t.nominal || 0), 0);

    const card = t => `<div class="card mb-3" style="border-color:#F7DFB5;background:#FFFDF7">
      <div class="between" style="align-items:flex-start">
        <div style="min-width:0">
          <div class="flex" style="gap:8px;flex-wrap:wrap">
            ${ui.badge('DRAF / PENDING APPROVAL', 'amber')}
            <span class="mono small muted">${esc(t.no_bukti || '-')}</span>
            <span class="small muted">${tglID(t.tanggal)}</span>
          </div>
          <div style="font-weight:800;font-size:15px;margin-top:6px">${esc(t.uraian)}</div>
          <div class="small muted">${esc(t.bku_nama)} · ${esc(t.coa_kode || '')} ${esc(t.coa_nama || '')}</div>
          <div class="kv mt-2" style="max-width:520px">
            <dt>Nominal</dt><dd style="font-weight:800;font-size:16px;color:var(--o-700)">${rupiah(t.nominal)}</dd>
            <dt>Penerima</dt><dd>${esc(t.nama_pihak || '-')}</dd>
            <dt>Metode</dt><dd>${t.metode === 'transfer' ? 'Transfer / Bank' : 'Tunai'}</dd>
            <dt>Diajukan oleh</dt><dd>${esc(t.pembuat || '-')}${t.pembuat_jabatan ? ` · ${esc(t.pembuat_jabatan)}` : ''}</dd>
            <dt>Waktu pengajuan</dt><dd>${esc(lib.stampID(t.created_at))}</dd>
          </div>
        </div>
        <div style="flex:0 0 210px;width:210px">
          <div class="small muted mb-1">Bukti / Nota</div>
          ${t.nota_url
        ? (/\.pdf($|\?)/i.test(t.nota_url)
          ? `<a class="btn btn-sm btn-block" href="${esc(t.nota_url)}" target="_blank">${ui.icon('file')}Buka Nota PDF</a>`
          : `<a href="${esc(t.nota_url)}" target="_blank"><img src="${esc(t.nota_url)}" alt="Nota" loading="lazy" decoding="async" style="width:100%;max-height:150px;object-fit:cover;border-radius:10px;border:1px solid var(--line)"></a>`)
        : `<div class="help" style="border:1px dashed var(--line-2);border-radius:10px;padding:18px;text-align:center">Tidak ada lampiran nota</div>`}
          <form method="post" action="${c.base}/approval/aksi" class="mt-2">
            <input type="hidden" name="id" value="${t.id}">
            <div class="field" style="margin-bottom:8px"><label>Catatan (opsional)</label>
              <input name="catatan" placeholder="Disetujui sesuai RAPBS"></div>
            <div class="flex" style="gap:8px">
              <button class="btn btn-green" style="flex:1" name="aksi" value="approve">${ui.icon('check')}Setujui</button>
              <button class="btn btn-danger" style="flex:1" name="aksi" value="reject">${ui.icon('x')}Tolak</button>
            </div>
          </form>
        </div>
      </div>
    </div>`;

    const content = `<div class="kpi-grid mb-3" style="grid-template-columns:repeat(3,minmax(0,1fr))">
        <div class="kpi ic-amber"><div class="ico">${ui.icon('clock')}</div><div class="lbl">Draf Menunggu</div><div class="val" style="font-size:20px">${list.length}</div><div class="meta">Belum memotong saldo BKU</div></div>
        <div class="kpi ic-orange"><div class="ico">${ui.icon('wallet')}</div><div class="lbl">Total Nilai Draf</div><div class="val" style="font-size:19px">${rupiah(total)}</div><div class="meta">Akumulasi seluruh draf</div></div>
        <div class="kpi ic-blue"><div class="ico">${ui.icon('shield')}</div><div class="lbl">Ambang Approval</div><div class="val" style="font-size:19px">${rupiah(threshold)}</div><div class="meta">Pengeluaran di atas nilai ini butuh persetujuan</div></div>
      </div>
      <div class="alert info mb-3">${ui.icon('info')}<div><b>System Approval:</b> transaksi pengeluaran berstatus <b>DRAF / PENDING APPROVAL</b> dan
        <b>tidak memotong saldo BKU</b> sampai disetujui. Setelah disetujui, transaksi langsung terposting dan memengaruhi saldo BKU.</div></div>
      ${list.length ? list.map(card).join('') : `<div class="card">${ui.emptyState('Tidak ada draf menunggu persetujuan', 'Semua pengeluaran sudah diproses. Draf baru akan muncul di sini beserta notifikasi saat Anda login.')}</div>`}
      <div class="card">
        <div class="card-head"><div><h3>Riwayat Persetujuan</h3><div class="sub">40 keputusan terakhir</div></div></div>
        ${riwayat.length ? `<div class="table-wrap sticky-head"><table><thead><tr><th>Tanggal</th><th>No. Bukti</th><th>BKU</th><th>Uraian</th><th class="num">Nominal</th><th>Keputusan</th><th>Oleh</th><th>Catatan</th></tr></thead><tbody>
          ${riwayat.map(t => `<tr><td class="nowrap">${tglID(t.tanggal)}</td><td class="mono t-sub">${esc(t.no_bukti || '-')}</td>
            <td>${esc(t.bku_nama)}</td><td>${esc(t.uraian)}</td><td class="num t-strong">${rupiah(t.nominal)}</td>
            <td>${t.status === 'rejected' ? ui.badge('Ditolak', 'red') : ui.badge('Disetujui', 'green')}</td>
            <td class="small">${esc(t.penyetuju || '-')}<div class="t-sub">${esc(t.approved_at || '')}</div></td>
            <td class="small muted">${esc(t.catatan_approval || '-')}</td></tr>`).join('')}
        </tbody></table></div>` : `<div class="help">Belum ada riwayat persetujuan.</div>`}
      </div>`;
    page(req, res, { title: 'Persetujuan Pengeluaran', sub: 'Draf pengeluaran yang membutuhkan persetujuan Kepala Sekolah', active: 'approval', content });
  });

  post('/approval/aksi', (req, res) => {
    if (!guard(req, res, 'transaksi', 'approve')) return;
    const { id, aksi, catatan } = req.body;
    const t = db.prepare(`SELECT t.* FROM transaksi t JOIN bku b ON b.id=t.bku_id
      WHERE t.id=? AND ${dbm.bkuTransactionVisibleSql('t', 'b')}`).get(id);
    if (!t) return res.redirect(req.BASE + '/approval?err=' + encodeURIComponent('Transaksi tidak ditemukan.'));
    if (t.status !== 'pending') return res.redirect(req.BASE + '/approval?err=' + encodeURIComponent('Transaksi ini sudah diproses sebelumnya.'));
    const b = db.prepare('SELECT * FROM bku WHERE id=?').get(t.bku_id);
    if (b && b.status !== 'aktif') return res.redirect(req.BASE + '/approval?err=' + encodeURIComponent('BKU sudah ditutup, transaksi tidak dapat diproses.'));
    const lock = dbm.periodeLockError(t.bku_id, t.tanggal);
    if (lock) return res.redirect(req.BASE + '/approval?err=' + encodeURIComponent(lock));
    if (aksi === 'reject') {
      db.prepare("UPDATE transaksi SET status='rejected', approved_by=?, approved_at=?, catatan_approval=? WHERE id=?")
        .run(req.user.id, nowStamp(), catatan || '', id);
      dbm.logAudit(req.user, 'TOLAK', 'transaksi', `Menolak draf ${t.no_bukti} (${rupiah(t.nominal)})${catatan ? ' — ' + catatan : ''}`);
      return res.redirect(req.BASE + '/approval?ok=' + encodeURIComponent('Draf pengeluaran ditolak.'));
    }
    db.prepare("UPDATE transaksi SET status='posted', approved_by=?, approved_at=?, catatan_approval=? WHERE id=?")
      .run(req.user.id, nowStamp(), catatan || '', id);
    dbm.logAudit(req.user, 'SETUJUI', 'transaksi', `Menyetujui draf ${t.no_bukti} (${rupiah(t.nominal)}) — masuk saldo BKU`);
    res.redirect(req.BASE + '/approval?ok=' + encodeURIComponent('Draf disetujui dan kini memengaruhi saldo BKU.'));
  });
};
