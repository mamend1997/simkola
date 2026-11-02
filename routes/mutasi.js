'use strict';
/* Mutasi Bank & Cash — memindahkan dana antar rekening/kas TANPA lewat BKU Umum */
module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl }) => {
  const { db } = dbm;
  const { esc, rupiah, tglID, todayISO, nowStamp } = lib;
  const JENIS = { bank: 'Kas Bank', tunai: 'Kas Tunai' };

  get('/mutasi-kas', (req, res) => {
    guard(req, res, 'mutasi_kas', 'view');
    const c = ctx(req);
    const taId = c.taId;
    const dari = req.query.get('dari') || '';
    const sampai = req.query.get('sampai') || '';
    let sql = 'SELECT m.*, u.nama pencatat FROM mutasi_kas m LEFT JOIN users u ON u.id=m.created_by WHERE 1=1';
    const args = [];
    if (taId) { sql += ' AND m.tahun_ajaran_id=?'; args.push(taId); }
    if (dari) { sql += ' AND m.tanggal>=?'; args.push(dari); }
    if (sampai) { sql += ' AND m.tanggal<=?'; args.push(sampai); }
    sql += ' ORDER BY m.tanggal DESC, m.id DESC';
    const rows = db.prepare(sql).all(...args);
    const kas = dbm.asetKas(taId);
    const editable = c.can('mutasi_kas', 'edit');
    const late = (() => { const l = []; const p = (id, o) => { l.push(ui.modal(id, o)); return ''; }; p.html = () => l.join(''); return p; })();

    const content = `<div class="kpi-grid mb-3" style="grid-template-columns:repeat(4,minmax(0,1fr))">
      <div class="kpi ic-orange"><div class="ico">${ui.icon('bank')}</div><div class="lbl">Kas Bank</div><div class="val" style="font-size:19px">${rupiah(kas.bank)}</div><div class="meta">Transaksi ${rupiah(kas.bankAuto)} · mutasi ${rupiah(kas.bankMutasi || 0)}</div></div>
      <div class="kpi ic-blue"><div class="ico">${ui.icon('wallet')}</div><div class="lbl">Kas Tunai</div><div class="val" style="font-size:19px">${rupiah(kas.tunai)}</div><div class="meta">Transaksi ${rupiah(kas.tunaiAuto)} · mutasi ${rupiah(kas.tunaiMutasi || 0)}</div></div>
      <div class="kpi ic-green"><div class="ico">${ui.icon('swap')}</div><div class="lbl">Mutasi Pada Filter</div><div class="val" style="font-size:19px">${rupiah(rows.reduce((s, r) => s + Number(r.nominal || 0), 0))}</div><div class="meta">${rows.length} transaksi</div></div>
      <div class="kpi ic-amber"><div class="ico">${ui.icon('info')}</div><div class="lbl">Tidak Masuk BKU</div><div class="val" style="font-size:16px">Non-Operasional</div><div class="meta">Hanya menggeser saldo kas</div></div>
    </div>
    <div class="card">
      <div class="card-head"><div><h3>Mutasi Bank &amp; Cash</h3><div class="sub">Oper dana antar rekening/kas — tidak menambah/mengurangi pemasukan &amp; pengeluaran BKU</div></div>
        <div class="toolbar">
          <form method="get" action="${c.base}/mutasi-kas" class="flex" style="gap:6px">
            <input type="date" name="dari" value="${esc(dari)}" title="Dari tanggal">
            <input type="date" name="sampai" value="${esc(sampai)}" title="Sampai tanggal">
            <button class="btn btn-sm">${ui.icon('filter')}Filter</button>
          </form>
          ${editable ? ui.openModalBtn('mAddMutasi', 'Tambah Mutasi') : ''}
        </div></div>
      ${rows.length ? `<div class="table-wrap sticky-head"><table><thead><tr>
        <th>Tanggal</th><th>No. Bukti</th><th>Dari</th><th>Ke</th><th class="num">Nominal</th><th>Keterangan</th><th>Pencatat</th><th class="right">Aksi</th>
      </tr></thead><tbody>
      ${rows.map(m => `<tr>
        <td class="nowrap">${tglID(m.tanggal)}</td><td class="mono t-sub">${esc(m.no_bukti || '-')}</td>
        <td>${ui.badge(JENIS[m.dari] || m.dari, 'orange', 'plain')}</td>
        <td>${ui.badge(JENIS[m.ke] || m.ke, 'blue', 'plain')}</td>
        <td class="num t-strong">${rupiah(m.nominal)}</td>
        <td>${esc(m.keterangan || '-')}</td><td>${esc(m.pencatat || '-')}</td>
        <td class="right">${editable ? `<form method="post" action="${c.base}/mutasi-kas/delete" style="display:inline" data-confirm="Hapus mutasi ini? Saldo kas akan kembali seperti sebelumnya."><input type="hidden" name="id" value="${m.id}"><button class="btn btn-sm btn-danger">${ui.icon('trash')}</button></form>` : ''}</td>
      </tr>`).join('')}
      </tbody></table></div>` : ui.emptyState('Belum ada mutasi kas', 'Gunakan tombol Tambah Mutasi untuk memindahkan dana antar kas/bank.')}
      ${late.html()}
    </div>
    <p class="help mt-2">Mutasi ini <b>tidak dicatat pada BKU Umum</b> sehingga tidak memengaruhi laporan realisasi anggaran. Nilainya hanya menambah/mengurangi <b>saldo akhir Kas Bank</b> dan <b>Kas Tunai</b> pada Aset Riil &amp; Rekonsiliasi Kas.</p>
    ${editable ? ui.modal('mAddMutasi', {
      title: 'Tambah Mutasi Bank & Cash',
      body: `<form method="post" action="${c.base}/mutasi-kas/save" id="fAddMutasi">
        <div class="row2">
          <div class="field"><label>Tanggal</label><input type="date" name="tanggal" value="${todayISO()}" required></div>
          <div class="field"><label>Nominal (Rp)</label>${ui.moneyInput('nominal', '', 'required placeholder="0"')}</div>
        </div>
        <div class="row2">
          <div class="field"><label>Dari</label><select name="dari"><option value="bank">Kas Bank</option><option value="tunai">Kas Tunai</option></select></div>
          <div class="field"><label>Ke</label><select name="ke"><option value="tunai">Kas Tunai</option><option value="bank">Kas Bank</option></select></div>
        </div>
        <div class="field"><label>Keterangan</label><input name="keterangan" placeholder="Contoh: setor tunai ke bank"></div>
        <div class="alert info">${ui.icon('info')}<div>Transaksi ini hanya menggeser saldo antar kas — kas sekolah secara total tetap sama.</div></div>
      </form>`,
      footer: `<button class="btn" data-close="mAddMutasi">Batal</button><button class="btn btn-primary" form="fAddMutasi">${ui.icon('save')}Simpan Mutasi</button>`
    }) : ''}`;
    page(req, res, { title: 'Mutasi Bank & Cash', sub: 'Oper dana antar kas/bank tanpa memengaruhi BKU', active: 'mutasi_kas', content });
  });

  post('/mutasi-kas/save', (req, res) => {
    guard(req, res, 'mutasi_kas', 'edit');
    const back = req.BASE + '/mutasi-kas';
    const dari = req.body.dari === 'tunai' ? 'tunai' : 'bank';
    const ke = req.body.ke === 'tunai' ? 'tunai' : 'bank';
    const nominal = lib.parseMoney(req.body.nominal);
    const tanggal = req.body.tanggal || todayISO();
    if (dari === ke) return res.redirect(back + '?err=' + encodeURIComponent('Kas asal dan tujuan tidak boleh sama.'));
    if (!(nominal > 0)) return res.redirect(back + '?err=' + encodeURIComponent('Nominal mutasi harus lebih dari 0.'));
    const taId = dbm.taIdOfDate(tanggal);
    const seq = db.prepare('SELECT COUNT(*) c FROM mutasi_kas WHERE COALESCE(tahun_ajaran_id,0)=?').get(taId || 0).c + 1;
    const noBukti = `MUT/${String(tanggal).slice(0, 7).replace('-', '')}/${String(seq).padStart(3, '0')}`;
    db.prepare(`INSERT INTO mutasi_kas (tanggal,dari,ke,nominal,keterangan,no_bukti,tahun_ajaran_id,created_at,created_by)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(tanggal, dari, ke, nominal, req.body.keterangan || '', noBukti, taId, nowStamp(), req.user.id);
    dbm.logAudit(req.user, 'MUTASI KAS', 'mutasi_kas', `${rupiah(nominal)} dari ${JENIS[dari]} ke ${JENIS[ke]} (${noBukti})`);
    res.redirect(back + '?ok=' + encodeURIComponent(`Mutasi ${rupiah(nominal)} dari ${JENIS[dari]} ke ${JENIS[ke]} dicatat (${noBukti}).`));
  });

  post('/mutasi-kas/delete', (req, res) => {
    guard(req, res, 'mutasi_kas', 'edit');
    const m = db.prepare('SELECT * FROM mutasi_kas WHERE id=?').get(req.body.id);
    if (!m) return res.redirect(req.BASE + '/mutasi-kas?err=' + encodeURIComponent('Mutasi tidak ditemukan.'));
    dbm.trashAdd('mutasi_kas', m, { user: req.user, label: `Mutasi ${JENIS[m.dari]} → ${JENIS[m.ke]} ${rupiah(m.nominal)}` });
    db.prepare('DELETE FROM mutasi_kas WHERE id=?').run(m.id);
    dbm.logAudit(req.user, 'HAPUS', 'mutasi_kas', `Hapus mutasi ${m.no_bukti} (${rupiah(m.nominal)})`);
    res.redirect(req.BASE + '/mutasi-kas?ok=' + encodeURIComponent('Mutasi kas dihapus (dapat dipulihkan dari Kotak Sampah).'));
  });
};
