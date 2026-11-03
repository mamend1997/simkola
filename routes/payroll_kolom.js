'use strict';
/**
 * ==================================================================
 * PENGATURAN KOLOM LEGER HONOR (dinamis, per sekolah)
 * ------------------------------------------------------------------
 * /payroll/kolom → tambah, ubah nama, ubah tipe/satuan, beri rumus,
 * hapus, nonaktifkan, dan geser urutan kolom (atas/bawah).
 * Rumus dievaluasi aman di server (payrollEval) — tanpa eval().
 * ==================================================================
 */
module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl }) => {
  const { esc } = lib;
  const go = (req, res, key, msg) => res.redirect(req.BASE + flashUrl('/payroll/kolom', key, msg));

  const TIPE_LABEL = { penerimaan: 'Penerimaan', potongan: 'Potongan', info: 'Info (bukan total)' };

  get('/payroll/kolom', (req, res) => {
    guard(req, res, 'payroll', 'view');
    const c = ctx(req);
    const cols = dbm.payrollKolomList({ all: true });
    const editable = c.can('payroll', 'edit');
    const edId = Number(req.query.get('edit') || 0);
    const ed = edId ? dbm.payrollKolomById(edId) : null;

    const rows = cols.map((k, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td><b>${esc(k.label)}</b><div class="t-sub mono">${esc(k.kode)}</div></td>
      <td>${ui.badge(TIPE_LABEL[k.tipe] || k.tipe, k.tipe === 'penerimaan' ? 'green' : k.tipe === 'potongan' ? 'red' : 'gray')}</td>
      <td class="small">${k.nilai === 'jam' ? 'Jam' : 'Rupiah'}</td>
      <td class="mono small">${k.rumus ? esc(k.rumus) : '<span class="muted">isian manual</span>'}</td>
      <td>${k.sistem ? ui.badge('Bawaan', 'blue') : ui.badge('Kustom', 'violet')}</td>
      <td>${k.aktif ? ui.badge('Aktif', 'green') : ui.badge('Nonaktif', 'gray')}</td>
      <td class="nowrap">${editable ? `
        <form method="post" action="${c.base}/payroll/kolom/${k.id}/naik" style="display:inline"><button class="btn btn-sm btn-icon" title="Naik">${ui.icon('up')}</button></form>
        <form method="post" action="${c.base}/payroll/kolom/${k.id}/turun" style="display:inline"><button class="btn btn-sm btn-icon" title="Turun">${ui.icon('down')}</button></form>
        <a class="btn btn-sm btn-icon" href="${c.base}/payroll/kolom?edit=${k.id}" title="Ubah">${ui.icon('edit')}</a>
        ${k.sistem ? '' : `<form method="post" action="${c.base}/payroll/kolom/${k.id}/hapus" style="display:inline"
          data-confirm="Hapus kolom ${esc(k.label)}? Nilai lama tetap tersimpan tetapi tidak tampil lagi.">
          <button class="btn btn-sm btn-danger btn-icon" title="Hapus">${ui.icon('trash')}</button></form>`}` : ''}</td>
    </tr>`).join('');

    const content = `<div class="split">
      <div class="card">
        <div class="card-head"><div><h3>${ed ? 'Ubah Kolom' : 'Tambah Kolom Baru'}</h3>
          <div class="sub">Nama, tipe, satuan, dan rumus kalkulasi otomatis</div></div>
          ${ed ? `<a class="btn btn-sm" href="${c.base}/payroll/kolom">${ui.icon('x')}Batal</a>` : ''}</div>
        <form method="post" action="${c.base}/payroll/kolom/simpan">
          <input type="hidden" name="id" value="${ed ? ed.id : ''}">
          <div class="row2">
            <div class="field"><label>Nama Kolom *</label>
              <input type="text" name="label" required maxlength="60" value="${esc(ed ? ed.label : '')}" placeholder="mis. Tunjangan Wali Kelas"></div>
            <div class="field"><label>Tipe</label>
              <select name="tipe" ${ed && ed.sistem ? 'disabled' : ''}>
                <option value="penerimaan" ${ed && ed.tipe === 'penerimaan' ? 'selected' : ''}>Penerimaan</option>
                <option value="potongan" ${ed && ed.tipe === 'potongan' ? 'selected' : ''}>Potongan</option>
                <option value="info" ${ed && ed.tipe === 'info' ? 'selected' : ''}>Info (tidak masuk total)</option>
              </select></div>
          </div>
          <div class="row2">
            <div class="field"><label>Satuan</label>
              <select name="nilai" ${ed && ed.sistem ? 'disabled' : ''}>
                <option value="uang" ${!ed || ed.nilai === 'uang' ? 'selected' : ''}>Rupiah</option>
                <option value="jam" ${ed && ed.nilai === 'jam' ? 'selected' : ''}>Jam / angka</option>
              </select></div>
            <div class="field"><label>Urutan Tampil</label>
              <input type="number" name="urutan" value="${ed ? ed.urutan : (cols.length + 1) * 10}" step="10"></div>
          </div>
          <div class="field"><label>Rumus Otomatis (opsional)</label>
            <input type="text" name="rumus" value="${esc(ed ? (ed.rumus || '') : '')}" placeholder="mis. jam_efektif * honor_jam">
            <div class="hint">Kosongkan bila kolom diisi manual. Variabel: <b>kode kolom</b> lain (lihat tabel),
              <code>honor_pembantu</code>, <code>honor_wali</code>, <code>sertifikasi_rate</code>.
              Operator: <code>+ - * / ( )</code>, fungsi <code>round() min() max() abs()</code>.</div></div>
          <label class="check mb-2"><input type="checkbox" name="aktif" value="1" ${!ed || ed.aktif ? 'checked' : ''}> Tampilkan kolom ini pada leger</label>
          <div class="form-actions"><button class="btn btn-primary">${ui.icon('save')}${ed ? 'Simpan Perubahan' : 'Tambah Kolom'}</button></div>
        </form>
        <div class="alert info mt-2">${ui.icon('info')}<div>Perubahan struktur kolom <b>langsung</b> berlaku pada leger,
          cetakan PDF, dan export Excel. Histori nilai kolom yang dihapus tetap tersimpan di database.</div></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Struktur Kolom Leger (${cols.length})</h3>
          <div class="sub">Urutan di sini menentukan urutan pada tabel, cetakan &amp; Excel</div></div>
          <a class="btn btn-sm" href="${c.base}/payroll">${ui.icon('back')}Ke Leger</a></div>
        <div class="table-wrap" style="max-height:64vh;overflow:auto"><table><thead><tr>
          <th class="num">#</th><th>Kolom</th><th>Tipe</th><th>Satuan</th><th>Rumus</th><th>Jenis</th><th>Status</th><th></th>
        </tr></thead><tbody>${rows || `<tr><td colspan="8" class="muted" style="text-align:center;padding:16px">Belum ada kolom.</td></tr>`}</tbody></table></div>
      </div>
    </div>`;
    page(req, res, { title: 'Pengaturan Kolom Leger', sub: 'Susun kolom penerimaan & potongan sesuai kebijakan sekolah', active: 'payroll_kolom', content });
  });

  post('/payroll/kolom/simpan', (req, res) => {
    guard(req, res, 'payroll', 'edit');
    try {
      const row = dbm.payrollKolomSave({
        id: req.body.id, label: req.body.label, tipe: req.body.tipe, nilai: req.body.nilai,
        rumus: req.body.rumus, urutan: req.body.urutan, aktif: req.body.aktif ? 1 : 0
      });
      dbm.logAudit(req.user, req.body.id ? 'EDIT' : 'TAMBAH', 'payroll', `${req.body.id ? 'Ubah' : 'Tambah'} kolom leger: ${row.label}`);
      go(req, res, 'ok', 'Kolom leger disimpan.');
    } catch (e) {
      go(req, res, 'err', e.message);
    }
  });

  post('/payroll/kolom/:id/hapus', (req, res) => {
    guard(req, res, 'payroll', 'delete');
    try {
      const row = dbm.payrollKolomDelete(req.params.id);
      if (row) dbm.logAudit(req.user, 'HAPUS', 'payroll', `Hapus kolom leger: ${row.label}`);
      go(req, res, 'ok', 'Kolom dihapus dari leger.');
    } catch (e) {
      go(req, res, 'err', e.message);
    }
  });

  function move(req, res, arah) {
    guard(req, res, 'payroll', 'edit');
    try {
      const cols = dbm.payrollKolomList({ all: true });
      const i = cols.findIndex(k => Number(k.id) === Number(req.params.id));
      if (i < 0) throw new Error('Kolom tidak ditemukan.');
      const j = arah === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= cols.length) throw new Error('Kolom sudah di posisi paling ' + (arah === 'up' ? 'atas' : 'bawah') + '.');
      const ids = cols.map(k => k.id);
      [ids[i], ids[j]] = [ids[j], ids[i]];
      dbm.payrollKolomReorder(ids);
      go(req, res, 'ok', 'Urutan kolom diperbarui.');
    } catch (e) {
      go(req, res, 'err', e.message);
    }
  }
  post('/payroll/kolom/:id/naik', (req, res) => move(req, res, 'up'));
  post('/payroll/kolom/:id/turun', (req, res) => move(req, res, 'down'));
};
