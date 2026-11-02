'use strict';
/**
 * Catatan Pegawai → Bendahara
 * ------------------------------------------------------------------
 * Pegawai (pengguna yang login) melaporkan kekeliruan data — mis. nominal
 * leger honor, potongan, atau data siswa — langsung kepada bendahara.
 * Nama & jabatan pengirim diambil OTOMATIS dari sesi login di server
 * (field nama tidak bisa diubah dari form), sehingga pegawai hanya
 * menulis isi pesan.
 */
module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl }) => {
  const { db } = dbm;
  const { esc, tglID } = lib;

  const STATUS_BADGE = { baru: ['Baru', 'amber'], diproses: ['Diproses', 'blue'], selesai: ['Selesai', 'green'] };
  const TERKAIT = [
    ['umum', 'Umum / lain-lain'],
    ['payroll', 'Leger Honor / Slip Gaji'],
    ['iuran', 'Iuran & Tagihan Siswa'],
    ['piutang', 'Piutang / Kasbon'],
    ['bku', 'Transaksi & BKU'],
    ['aset', 'Aset & Kas']
  ];
  const terkaitLabel = k => (TERKAIT.find(x => x[0] === k) || [k, k || 'Umum'])[1];
  const statusBadge = st => { const b = STATUS_BADGE[st] || [st || '-', 'gray']; return ui.badge(b[0], b[1]); };

  function safeBack(raw, def = '/catatan-pegawai') {
    const s = String(raw || '');
    return /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/.test(s) && !s.startsWith('//') ? s : def;
  }

  get('/catatan-pegawai', (req, res) => {
    guard(req, res, 'catatan', 'view');
    const c = ctx(req);
    const pengelola = c.can('catatan', 'edit');      // bendahara / super admin / kepala sekolah
    const status = String(req.query.get('status') || '').trim();
    const q = String(req.query.get('q') || '').trim();
    const list = dbm.catatanList({ userId: pengelola ? null : req.user.id, status, q, limit: 200 });
    const belum = pengelola ? dbm.catatanCount() : 0;
    const periodeDefault = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    })();
    const periodeOpts = (() => {
      const set = new Set();
      for (const r of db.prepare("SELECT DISTINCT periode FROM payroll WHERE COALESCE(periode,'')<>'' ORDER BY periode DESC LIMIT 24").all()) set.add(r.periode);
      set.add(periodeDefault);
      return Array.from(set).sort().reverse();
    })();

    const form = `<div class="card mb-3">
      <div class="card-head"><div><h3>Kirim Catatan ke Bendahara</h3>
        <div class="sub">Identitas pengirim terisi otomatis dari sesi login Anda</div></div></div>
      <div class="alert info">${ui.icon('info')}<div>Gunakan kolom ini untuk melaporkan <b>kekeliruan data</b> (mis. nominal honor, potongan, atau tagihan).
        Catatan langsung masuk ke daftar bendahara. Anda tidak perlu mengetik nama — sistem mencatatnya otomatis.</div></div>
      <form method="post" action="${c.base}/catatan-pegawai/kirim" id="fCatatan">
        <div class="row2">
          <div class="field"><label>Nama Pegawai (otomatis)</label>
            <div class="catatan-locked-nama">${ui.avatar(req.user)}<div><b>${esc(req.user.nama)}</b><div class="t-sub">${esc(req.user.jabatan || c.roleLabel || '-')} · akun ${esc(req.user.email || '')}</div></div></div>
            <div class="hint">Diambil dari sesi login saat ini — tidak dapat diubah.</div></div>
          <div class="field"><label>Terkait</label>
            <select name="terkait">${TERKAIT.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select>
            <div class="field" style="margin-top:10px"><label>Periode (opsional)</label>
              <select name="periode"><option value="">— Tidak spesifik —</option>
                ${periodeOpts.map(p => `<option value="${esc(p)}" ${p === periodeDefault ? 'selected' : ''}>${esc(dbm.periodeLabel(p))}</option>`).join('')}
              </select></div></div>
        </div>
        <div class="field"><label>Isi Catatan / Detail Perbaikan</label>
          <textarea name="pesan" rows="5" required minlength="5" maxlength="2000"
            placeholder="Contoh: Nominal honor saya pada leger November tertulis Rp 450.000, seharusnya Rp 540.000 (jam efektif 24 × Rp 22.500). Mohon diperiksa."></textarea>
          <div class="hint">Tuliskan data yang keliru dan nilai yang seharusnya agar bendahara lebih cepat memeriksa.</div></div>
        <div class="form-actions"><button class="btn btn-primary">${ui.icon('inbox')}Kirim Catatan ke Bendahara</button></div>
      </form>
    </div>`;

    const filterBar = `<form method="get" action="${c.base}/catatan-pegawai" class="filterbar">
      ${pengelola ? `<div class="field"><label>Status</label><select name="status" data-autosubmit>
        <option value="">Semua status</option>
        ${Object.keys(STATUS_BADGE).map(k => `<option value="${k}" ${status === k ? 'selected' : ''}>${STATUS_BADGE[k][0]}</option>`).join('')}
      </select></div>` : ''}
      <div class="field"><label>Pencarian</label><input name="q" value="${esc(q)}" placeholder="Nama / isi catatan" data-table-search="#tblCatatan" autocomplete="off"></div>
      <button class="btn">${ui.icon('search')}Terapkan</button>
      ${status || q ? `<a class="btn" href="${c.base}/catatan-pegawai">Reset</a>` : ''}
    </form>`;

    const item = (x) => {
      const balas = x.balasan ? `<div class="ci-balas"><div class="lbl">Balasan Bendahara · ${esc(x.balas_oleh || '-')} · ${esc(tglID(String(x.balas_at || '').slice(0, 10)))}</div>
        <div style="white-space:pre-wrap;margin-top:4px">${esc(x.balasan)}</div></div>` : '';
      const aksi = pengelola ? `<div class="toolbar" style="gap:6px;flex-wrap:wrap">
          <details class="catatan-reply"><summary class="btn btn-sm">${ui.icon('edit')}Balas / Tindak Lanjut</summary>
            <form method="post" action="${c.base}/catatan-pegawai/balas" class="mt-2" style="min-width:280px">
              <input type="hidden" name="id" value="${x.id}">
              <div class="field"><label>Balasan / catatan tindak lanjut</label>
                <textarea name="balasan" rows="3" required placeholder="Contoh: Sudah diperbaiki pada leger November, honor menjadi Rp 540.000.">${esc(x.balasan || '')}</textarea></div>
              <div class="field"><label>Status setelah dibalas</label>
                <select name="status_after"><option value="diproses" ${x.status === 'diproses' ? 'selected' : ''}>Diproses</option>
                  <option value="selesai">Selesai</option></select></div>
              <button class="btn btn-primary btn-sm">${ui.icon('save')}Simpan Balasan</button>
            </form>
          </details>
          ${x.status !== 'selesai' ? `<form method="post" action="${c.base}/catatan-pegawai/status" style="display:inline">
            <input type="hidden" name="id" value="${x.id}"><input type="hidden" name="status" value="selesai">
            <button class="btn btn-sm btn-green">${ui.icon('check')}Tandai Selesai</button></form>` : `<form method="post" action="${c.base}/catatan-pegawai/status" style="display:inline">
            <input type="hidden" name="id" value="${x.id}"><input type="hidden" name="status" value="baru">
            <button class="btn btn-sm">${ui.icon('refresh')}Buka Kembali</button></form>`}
          <form method="post" action="${c.base}/catatan-pegawai/delete" style="display:inline" data-confirm="Hapus catatan ini secara permanen?">
            <input type="hidden" name="id" value="${x.id}"><button class="btn btn-sm btn-danger btn-icon">${ui.icon('trash')}</button></form>
        </div>` : '';
      return `<div class="catatan-item">
        <div class="ci-head">
          <div><div class="ci-nama">${esc(x.nama)}${pengelola && x.jabatan ? ` <span class="t-sub">· ${esc(x.jabatan)}</span>` : ''}</div>
            <div class="ci-meta">${esc(terkaitLabel(x.terkait))}${x.periode ? ` · ${esc(dbm.periodeLabel(x.periode))}` : ''} · ${esc(x.created_at || '')}</div></div>
          <div class="toolbar" style="gap:8px">${statusBadge(x.status)}</div>
        </div>
        <div class="ci-pesan">${esc(x.pesan)}</div>
        ${balas}${aksi}
      </div>`;
    };

    const content = `${form}
      <div class="card">
        <div class="card-head"><div><h3>${pengelola ? 'Catatan Masuk dari Pegawai' : 'Catatan Saya'}</h3>
          <div class="sub">${list.length} catatan${pengelola && belum ? ` · ${belum} belum selesai` : ''}</div></div>
          ${pengelola && belum ? `<div class="toolbar"><span class="badge amber">${belum} perlu ditindaklanjuti</span></div>` : ''}</div>
        ${filterBar}
        <div id="tblCatatan">${list.length ? list.map(item).join('') : ui.emptyState('Belum ada catatan', pengelola ? 'Catatan dari pegawai akan muncul di sini.' : 'Kirim catatan pertama Anda melalui formulir di atas.')}</div>
      </div>`;
    page(req, res, { title: 'Catatan Pegawai', sub: 'Pelaporan kekeliruan data pegawai kepada bendahara', active: 'catatan', content });
  });

  post('/catatan-pegawai/kirim', (req, res) => {
    guard(req, res, 'catatan', 'create');
    const back = req.BASE + safeBack(req.body.back);
    const pesan = String(req.body.pesan || '').trim();
    if (pesan.length < 5) return res.redirect(back + '?err=' + encodeURIComponent('Isi catatan minimal 5 karakter.'));
    const terkait = TERKAIT.some(x => x[0] === req.body.terkait) ? req.body.terkait : 'umum';
    const periode = /^\d{4}-\d{2}$/.test(String(req.body.periode || '')) ? String(req.body.periode) : '';
    // nama & jabatan SELALU dari sesi login — field dari klien diabaikan
    const id = dbm.catatanAdd({
      userId: req.user.id, nama: req.user.nama, jabatan: req.user.jabatan || '',
      pesan: pesan.slice(0, 2000), terkait, periode, taId: req.taId || null
    });
    dbm.logAudit(req.user, 'CATATAN PEGAWAI', 'catatan', `Catatan #${id} (${terkaitLabel(terkait)}${periode ? ' ' + periode : ''}): ${pesan.slice(0, 160)}`);
    res.redirect(back + '?ok=' + encodeURIComponent('Catatan terkirim ke bendahara. Anda dapat memantau balasannya di halaman ini.'));
  });

  post('/catatan-pegawai/balas', (req, res) => {
    guard(req, res, 'catatan', 'edit');
    const back = req.BASE + safeBack(req.body.back);
    const id = Number(req.body.id || 0);
    const balasan = String(req.body.balasan || '').trim();
    if (!id) return res.redirect(back + '?err=' + encodeURIComponent('Catatan tidak ditemukan.'));
    if (!balasan) return res.redirect(back + '?err=' + encodeURIComponent('Balasan tidak boleh kosong.'));
    const row = dbm.catatanReply(id, { balasan: balasan.slice(0, 2000), oleh: req.user.nama, status: req.body.status_after });
    if (!row) return res.redirect(back + '?err=' + encodeURIComponent('Catatan tidak ditemukan.'));
    dbm.logAudit(req.user, 'BALAS CATATAN', 'catatan', `Membalas catatan #${id} dari ${row.nama} (status ${row.status})`);
    res.redirect(back + '?ok=' + encodeURIComponent(`Balasan terkirim ke ${row.nama}.`));
  });

  post('/catatan-pegawai/status', (req, res) => {
    guard(req, res, 'catatan', 'edit');
    const back = req.BASE + safeBack(req.body.back);
    const id = Number(req.body.id || 0);
    const row = dbm.catatanStatus(id, req.body.status);
    if (!row) return res.redirect(back + '?err=' + encodeURIComponent('Catatan tidak ditemukan.'));
    dbm.logAudit(req.user, 'STATUS CATATAN', 'catatan', `Catatan #${id} (${row.nama}) → ${row.status}`);
    res.redirect(back + '?ok=' + encodeURIComponent(`Status catatan diperbarui menjadi ${row.status}.`));
  });

  post('/catatan-pegawai/delete', (req, res) => {
    guard(req, res, 'catatan', 'delete');
    const back = req.BASE + safeBack(req.body.back);
    const row = dbm.catatanDelete(Number(req.body.id || 0));
    if (!row) return res.redirect(back + '?err=' + encodeURIComponent('Catatan tidak ditemukan.'));
    dbm.logAudit(req.user, 'HAPUS', 'catatan', `Menghapus catatan #${row.id} dari ${row.nama}`);
    res.redirect(back + '?ok=' + encodeURIComponent('Catatan dihapus.'));
  });
};
