'use strict';
/* Kotak Sampah (Trash Bin) — data terhapus disimpan 30 hari, bisa direstore */
module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl }) => {
  const { db } = dbm;
  const { esc, tglID, nowStamp } = lib;

  function daysLeft(exp) {
    const d = new Date(String(exp || '').replace(' ', 'T'));
    return Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86400000));
  }

  get('/trash', (req, res) => {
    guard(req, res, 'trash', 'view');
    const c = ctx(req);
    const f = req.query.get('tabel') || '';
    const rows = dbm.trashList(f || null);
    const types = db.prepare('SELECT tabel, COUNT(*) c FROM trash GROUP BY tabel ORDER BY c DESC').all();
    const editable = c.can('trash', 'edit');

    const content = `<div class="between mb-2">
      <form method="get" action="${c.base}/trash" class="flex" style="gap:8px">
        <select name="tabel" data-autosubmit>
          <option value="">Semua jenis data (${db.prepare('SELECT COUNT(*) c FROM trash').get().c})</option>
          ${types.map(t => `<option value="${esc(t.tabel)}" ${f === t.tabel ? 'selected' : ''}>${esc(dbm.TRASH_LABEL[t.tabel] || t.tabel)} (${t.c})</option>`).join('')}
        </select>
      </form>
      <div class="toolbar">
        ${editable && rows.length ? `<form method="post" action="${c.base}/trash/empty" data-confirm="Kosongkan kotak sampah? Semua data di dalamnya akan dihapus PERMANEN dan tidak bisa dikembalikan."><input type="hidden" name="tabel" value="${esc(f)}"><button class="btn btn-sm btn-danger">${ui.icon('trash')}Kosongkan Kotak Sampah</button></form>` : ''}
        <a class="btn btn-sm" href="${c.base}/trash">${ui.icon('refresh')}Muat Ulang</a>
      </div>
    </div>

    <div class="alert info mb-3">${ui.icon('inbox')}<div>
      Data yang Anda hapus <b>tidak langsung hilang</b> — disimpan di sini selama <b>${dbm.TRASH_DAYS} hari kalender</b> dan dapat dikembalikan kapan saja.
      Setelah ${dbm.TRASH_DAYS} hari, sistem menghapusnya secara <b>permanen</b> otomatis.</div></div>

    <div class="card">
      <div class="card-head"><div><h3>Kotak Sampah</h3><div class="sub">${rows.length} data tersimpan · ${f ? 'filter: ' + esc(dbm.TRASH_LABEL[f] || f) : 'semua jenis'}</div></div></div>
      ${rows.length ? `<div class="table-wrap sticky-head"><table><thead><tr>
        <th>Jenis</th><th>Ringkasan</th><th>Dihapus</th><th>Oleh</th><th>Alasan</th><th class="num">Sisa Hari</th><th class="right">Aksi</th>
      </tr></thead><tbody>
      ${rows.map(r => {
      let row = {};
      try { row = JSON.parse(r.data); } catch (e) { }
      let jumlah = '';
      if (row.nominal) jumlah = lib.rupiah(row.nominal);
      else if (row.jumlah) jumlah = lib.rupiah(row.jumlah);
      else if (row.total) jumlah = lib.rupiah(row.total);
      return `<tr>
        <td>${ui.badge(dbm.TRASH_LABEL[r.tabel] || r.tabel, 'gray', 'plain')}<div class="t-sub mono">#${r.row_id}</div></td>
        <td><div class="t-strong">${esc(r.label || '-')}</div>
          <div class="t-sub">${esc(row.uraian || row.nama || row.nama_pegawai || row.nama_pembina || row.keterangan || '')} ${jumlah ? '· ' + jumlah : ''}</div></td>
        <td class="nowrap">${esc(String(r.deleted_at || '').slice(0, 16))}</td>
        <td>${esc(r.user_nama || '-')}</td>
        <td class="t-sub">${esc(r.alasan || '-')}</td>
        <td class="num">${daysLeft(r.expired_at)} hari</td>
        <td class="right nowrap">
          ${editable ? `<form method="post" action="${c.base}/trash/restore" style="display:inline" data-confirm="Kembalikan data ini ke tabel asal?">
            <input type="hidden" name="id" value="${r.id}"><button class="btn btn-sm btn-green" title="Pulihkan">${ui.icon('refresh')}Restore</button></form>` : ''}
          ${editable ? `<form method="post" action="${c.base}/trash/purge" style="display:inline" data-confirm="Hapus permanen data ini? Tidak dapat dikembalikan.">
            <input type="hidden" name="id" value="${r.id}"><button class="btn btn-sm btn-danger" title="Hapus permanen">${ui.icon('trash')}</button></form>` : ''}
        </td></tr>`;
    }).join('')}
      </tbody></table></div>` : ui.emptyState('Kotak sampah kosong', 'Data yang Anda hapus akan muncul di sini dan dapat dikembalikan dalam 30 hari.')}
      <p class="help mt-2">Pemulihan menulis kembali baris data persis seperti saat dihapus. Untuk transaksi BKU, pastikan BKU &amp; periode masih terbuka — sistem akan menolak bila BKU sudah ditutup.</p>
    </div>`;
    page(req, res, { title: 'Kotak Sampah', sub: 'Penyimpanan sementara 30 hari sebelum dihapus permanen', active: 'trash', content });
  });

  post('/trash/restore', (req, res) => {
    guard(req, res, 'trash', 'edit');
    const back = req.BASE + '/trash';
    const t = db.prepare('SELECT * FROM trash WHERE id=?').get(req.body.id);
    if (!t) return res.redirect(back + '?err=' + encodeURIComponent('Data kotak sampah tidak ditemukan.'));
    // transaksi pada BKU/periode yang sudah ditutup tidak boleh dipulihkan
    if (t.tabel === 'transaksi') {
      let row = {};
      try { row = JSON.parse(t.data); } catch (e) { }
      const b = row.bku_id ? db.prepare('SELECT * FROM bku WHERE id=?').get(row.bku_id) : null;
      if (b && b.status !== 'aktif') return res.redirect(back + '?err=' + encodeURIComponent('BKU "' + b.nama + '" sudah ditutup — transaksi tidak dapat dipulihkan.'));
      const lock = b ? dbm.periodeLockError(b.id, row.tanggal) : null;
      if (lock) return res.redirect(back + '?err=' + encodeURIComponent(lock));
    }
    try {
      dbm.trashRestore(Number(req.body.id), req.user);
      res.redirect(back + '?ok=' + encodeURIComponent('Data berhasil dikembalikan.'));
    } catch (e) {
      res.redirect(back + '?err=' + encodeURIComponent('Gagal memulihkan: ' + e.message));
    }
  });

  post('/trash/purge', (req, res) => {
    guard(req, res, 'trash', 'delete');
    const t = db.prepare('SELECT * FROM trash WHERE id=?').get(req.body.id);
    if (t) {
      db.prepare('DELETE FROM trash WHERE id=?').run(t.id);
      dbm.logAudit(req.user, 'HAPUS PERMANEN', 'trash', `Hapus permanen ${dbm.TRASH_LABEL[t.tabel] || t.tabel} #${t.row_id} (${t.label})`);
    }
    res.redirect(req.BASE + '/trash?ok=' + encodeURIComponent('Data dihapus permanen.'));
  });

  post('/trash/empty', (req, res) => {
    guard(req, res, 'trash', 'delete');
    const tabel = String(req.body.tabel || '');
    const n = tabel
      ? db.prepare('DELETE FROM trash WHERE tabel=?').run(tabel).changes
      : db.prepare('DELETE FROM trash').run().changes;
    dbm.logAudit(req.user, 'HAPUS PERMANEN', 'trash', `Mengosongkan kotak sampah${tabel ? ' (' + tabel + ')' : ''}: ${n} data`);
    res.redirect(req.BASE + '/trash?ok=' + encodeURIComponent(`Kotak sampah dikosongkan (${n} data dihapus permanen).`));
  });
};
