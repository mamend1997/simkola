'use strict';

module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can }) => {
  const { db } = dbm;
  const { esc, rupiah, tglID, todayISO, nowStamp, num } = lib;

  get('/rekon', (req, res) => {
    guard(req, res, 'rekon', 'view');
    const c = ctx(req);
    const ta = c.ta;
    const bkuss = ta ? dbm.allBku(ta.id) : dbm.allBku(null);
    // SEMUA BKU ditampilkan sekaligus (tidak perlu memfilter satu per satu)
    const bkuId = req.query.get('bku') || '';
    const b = bkuId ? db.prepare('SELECT * FROM bku WHERE id=?').get(bkuId) : null;
    const taArg = ta ? ta.id : null;
    const args = [];
    let sql = `SELECT t.*, co.kode coa_kode, co.nama coa_nama, bk.nama bku_nama, bk.status bku_status
      FROM transaksi t LEFT JOIN coa co ON co.id=t.coa_id JOIN bku bk ON bk.id=t.bku_id
      WHERE t.status='posted' AND t.metode='transfer'`;
    if (taArg) { sql += ' AND bk.tahun_ajaran_id=?'; args.push(taArg); }
    sql += ' ORDER BY t.tanggal DESC, t.id DESC';
    const list = db.prepare(sql).all(...args);
    const saldoBuku = list.reduce((s, t) => s + (t.jenis === 'pemasukan' ? t.nominal : -t.nominal), 0);
    // saldo rekening koran terakhir pada setiap BKU
    const koranPer = bkuss.map(x => ({
      bku: x,
      row: db.prepare('SELECT * FROM rekon_saldo WHERE bku_id=? ORDER BY tanggal DESC, id DESC LIMIT 1').get(x.id)
    }));
    // saldo buku (mutasi transfer) per BKU — dipakai tabel input saldo koran semua BKU
    const bukuPerBku = new Map();
    for (const t of list) bukuPerBku.set(t.bku_id, (bukuPerBku.get(t.bku_id) || 0) + (t.jenis === 'pemasukan' ? t.nominal : -t.nominal));
    const saldoKoran = koranPer.reduce((s, x) => s + (x.row ? Number(x.row.saldo_koran || 0) : 0), 0);
    const koran = b ? db.prepare('SELECT * FROM rekon_saldo WHERE bku_id=? ORDER BY tanggal DESC, id DESC LIMIT 1').get(b.id) : (koranPer.find(x => x.row) || {}).row || null;
    const selisih = saldoKoran - saldoBuku;
    const riwayat = taArg
      ? db.prepare(`SELECT r.*, bk.nama bku_nama FROM rekon_saldo r JOIN bku bk ON bk.id=r.bku_id
          WHERE bk.tahun_ajaran_id=? ORDER BY r.tanggal DESC, r.id DESC LIMIT 10`).all(taArg)
      : db.prepare(`SELECT r.*, bk.nama bku_nama FROM rekon_saldo r LEFT JOIN bku bk ON bk.id=r.bku_id ORDER BY r.tanggal DESC, r.id DESC LIMIT 10`).all();
    const matchedCount = list.filter(t => t.rekon_matched).length;
    const coaAdm = db.prepare("SELECT * FROM coa WHERE kode='9.1.03'").get();
    const editableBku = bkuss.filter(x => x.status === 'aktif');

    const content = `<div class="between mb-3">
      <form method="get" action="${c.base}/rekon" class="flex" style="gap:8px">
        <div class="field" style="margin:0"><label>BKU untuk Catat Biaya Adm / Bunga &amp; Cetak</label>
          <select name="bku" data-autosubmit>
            <option value="">Semua BKU (gabungan)</option>
            ${bkuss.map(x => `<option value="${x.id}" ${String(x.id) === String(bkuId) ? 'selected' : ''}>${esc(x.nama)} — ${x.status === 'aktif' ? 'Aktif' : 'Ditutup'}</option>`).join('')}
          </select></div>
      </form>
      <div class="toolbar">
        <a class="btn btn-sm" target="_blank" href="${c.base}/laporan?r=bku&bku=${bkuId || (bkuss[0] || {}).id}">${ui.icon('printer')}Cetak BKU</a>
      </div>
    </div>

    <div class="kpi-grid mb-3">
      <div class="kpi ic-orange"><div class="ico">${ui.icon('bank')}</div><div class="lbl">Saldo Buku (Bank)</div><div class="val" style="font-size:19px">${rupiah(saldoBuku)}</div><div class="meta">Seluruh transaksi transfer terposting · ${bkuss.length} BKU</div></div>
      <div class="kpi ic-blue"><div class="ico">${ui.icon('file')}</div><div class="lbl">Saldo Rekening Koran</div><div class="val" style="font-size:19px">${rupiah(saldoKoran)}</div><div class="meta">${koran ? 'Input terakhir ' + tglID(koran.tanggal) : 'Belum diinput'}</div></div>
      <div class="kpi ${Math.abs(selisih) < 1 ? 'ic-green' : 'ic-red'}"><div class="ico">${ui.icon(Math.abs(selisih) < 1 ? 'check' : 'alert')}</div>
        <div class="lbl">Selisih</div><div class="val" style="font-size:19px">${rupiah(selisih)}</div>
        <div class="meta">${Math.abs(selisih) < 1 ? 'Rekonsiliasi cocok' : 'Perlu penyesuaian'}</div></div>
      <div class="kpi ic-amber"><div class="ico">${ui.icon('check')}</div><div class="lbl">Sudah Dicocokkan</div><div class="val" style="font-size:19px">${matchedCount}/${list.length}</div><div class="meta">Transaksi transfer semua BKU</div></div>
    </div>

    ${Math.abs(selisih) >= 1 ? `<div class="alert warn">${ui.icon('alert')}<div><b>Ada selisih ${rupiah(selisih)}.</b> Periksa transaksi yang belum dicocokkan, lalu catat biaya administrasi bank / pendapatan bunga di bawah agar saldo buku sesuai rekening koran.</div></div>` : ''}

    <div class="split">
      <div class="card">
        <div class="card-head"><div><h3>Pencocokan Mutasi Bank — Semua BKU</h3><div class="sub">Centang transaksi yang sudah sesuai dengan rekening koran (tanpa memfilter BKU satu per satu)</div></div>
          <div class="toolbar">
            <button type="button" class="btn btn-sm" data-check-group-all="rekon">${ui.icon('check')}Ceklis Semua</button>
            <button type="button" class="btn btn-sm" data-check-group-none="rekon">${ui.icon('x')}Hapus Ceklis</button>
            ${ui.badge(matchedCount + ' cocok', 'green')}
          </div></div>
        ${list.length ? `<form method="post" action="${c.base}/rekon/match">
          <input type="hidden" name="bku_id" value="${esc(bkuId)}">
          <div class="table-wrap"><table><thead><tr>
            <th style="width:44px"><input type="checkbox" data-check-group-box="rekon" title="Ceklis semua"></th>
            <th>Tanggal</th><th>BKU</th><th>Uraian</th><th class="num">Nominal</th><th>Rekening</th></tr></thead><tbody>
          ${list.map(t => `<tr style="${t.rekon_matched ? 'background:#F7FDFA' : ''}">
            <td><input type="checkbox" data-check-group="rekon" name="match_${t.id}" value="1" ${t.rekon_matched ? 'checked' : ''} ${t.bku_status === 'aktif' ? '' : 'disabled'}></td>
            <td class="nowrap">${tglID(t.tanggal)}</td>
            <td class="small">${esc(t.bku_nama)}</td>
            <td><div class="t-strong">${esc(t.uraian)}</div><div class="t-sub mono">${esc(t.no_bukti || '')}</div></td>
            <td class="num" style="color:${t.jenis === 'pemasukan' ? 'var(--green)' : 'var(--red)'}">${t.jenis === 'pemasukan' ? '+' : '−'} ${rupiah(t.nominal)}</td>
            <td class="t-sub">${esc((t.coa_kode || '') + ' ' + (t.coa_nama || ''))}</td></tr>`).join('')}
          </tbody></table></div>
          ${editableBku.length ? `<div class="form-actions"><button class="btn btn-primary">${ui.icon('save')}Simpan Pencocokan</button></div>` : `<div class="alert info mt-2">${ui.icon('lock')}<div>Semua BKU ditutup — pencocokan hanya dapat dilihat.</div></div>`}
        </form>` : ui.emptyState('Tidak ada transaksi transfer', 'Transaksi dengan metode transfer akan muncul di sini untuk dicocokkan.')}
      </div>

      <div>
        <div class="card mb-3">
          <div class="card-head"><div><h3>Input Saldo Rekening Koran — Semua BKU</h3>
            <div class="sub">Satu tabel untuk seluruh buku kas; isi saldo riil bank per BKU sekaligus</div></div></div>
          <form method="post" action="${c.base}/rekon/saldo-masal">
            <div class="row2">
              <div class="field"><label>Tanggal Rekening Koran</label><input type="date" name="tanggal" value="${todayISO()}" required></div>
              <div class="field"><label>Catatan</label><input name="catatan" placeholder="Contoh: Rekening BRI cabang utama"></div>
            </div>
            <div class="table-wrap table-scroll short"><table id="tblSaldoKoran"><thead><tr>
              <th>Buku Kas</th><th>Status</th><th class="num">Saldo Buku (Bank)</th><th class="num">Koran Terakhir</th><th>Saldo Rekening Koran (Rp)</th>
            </tr></thead><tbody>
            ${bkuss.map(x => {
      const last = (koranPer.find(k => k.bku.id === x.id) || {}).row || null;
      const buku = bukuPerBku.get(x.id) || 0;
      return `<tr>
                <td class="t-strong">${esc(x.nama)}<div class="t-sub mono">${esc(x.kode || '')}</div></td>
                <td>${ui.bkuStatusBadge(x.status)}</td>
                <td class="num">${rupiah(buku)}</td>
                <td class="num t-sub">${last ? rupiah(last.saldo_koran) + '<div class="t-sub">' + tglID(last.tanggal) + '</div>' : '—'}</td>
                <td style="min-width:190px">${ui.moneyInput('saldo_' + x.id, last ? last.saldo_koran : '', 'placeholder="' + (last ? '' : 'kosongkan bila belum ada koran') + '"')}</td>
              </tr>`;
    }).join('')}
            </tbody>
            <tfoot><tr><td colspan="2">TOTAL (${bkuss.length} BKU)</td><td class="num">${rupiah(Array.from(bukuPerBku.values()).reduce((a, b) => a + b, 0))}</td>
              <td class="num">${rupiah(saldoKoran)}</td><td></td></tr></tfoot></table></div>
            <div class="hint">Baris yang dikosongkan tidak disimpan. Nilai terakhir tiap BKU otomatis terisi sebagai titik awal.</div>
            <button class="btn btn-primary btn-block mt-2" ${c.can('rekon', 'create') || req.user.role === 'super_admin' ? '' : 'disabled'}>${ui.icon('save')}Simpan Semua Saldo Koran</button>
          </form>
        </div>

        <div class="card mb-3">
          <div class="card-head"><div><h3>Catat Langsung</h3><div class="sub">Biaya administrasi bank / pendapatan bunga</div></div></div>
          <form method="post" action="${c.base}/rekon/adjust" class="mb-3">
            <input type="hidden" name="bku_id" value="${esc(bkuId || (editableBku[0] || {}).id || '')}">
            <input type="hidden" name="jenis" value="pengeluaran">
            ${bkuId ? '' : `<div class="hint mb-1">Pilih BKU pada dropdown di atas untuk mencatat biaya administrasi.</div>`}
            <div class="field"><label>Biaya Administrasi Bank (Rp)</label>${ui.moneyInput('nominal', '', 'placeholder="0"')}</div>
            <button class="btn btn-block" ${editableBku.length ? '' : 'disabled'}>${ui.icon('down')}Catat Biaya Adm</button>
          </form>
          <form method="post" action="${c.base}/rekon/adjust">
            <input type="hidden" name="bku_id" value="${esc(bkuId || (editableBku[0] || {}).id || '')}">
            <input type="hidden" name="jenis" value="pemasukan">
            <div class="field"><label>Pendapatan Bunga Bank (Rp)</label>${ui.moneyInput('nominal', '', 'placeholder="0"')}</div>
            <button class="btn btn-block" ${editableBku.length ? '' : 'disabled'}>${ui.icon('plus')}Catat Bunga Bank</button>
          </form>
          <p class="help mt-2">Transaksi penyesuaian otomatis memakai kode rekening <b>${esc(coaAdm ? coaAdm.kode + ' · ' + coaAdm.nama : '9.1.03')}</b>.</p>
        </div>

        <div class="card">
          <div class="card-head"><div><h3>Riwayat Rekonsiliasi</h3><div class="sub">10 catatan terakhir</div></div></div>
          ${riwayat.length ? `<div class="list">${riwayat.map(r => `<div class="list-row"><div class="dot-s" style="background:var(--o-500)"></div>
            <div><div class="nm">${rupiah(r.saldo_koran)}</div><div class="mt">${tglID(r.tanggal)} · ${esc(r.bku_nama || '-')} ${esc(r.catatan || '')}</div></div></div>`).join('')}</div>`
        : '<div class="help">Belum ada riwayat rekonsiliasi.</div>'}
        </div>
      </div>
    </div>`;
    page(req, res, { title: 'Rekonsiliasi Bank', sub: 'Pencocokan mutasi kas bank dengan rekening koran — seluruh BKU sekaligus', active: 'rekon', content });
  });

  post('/rekon/match', (req, res) => {
    if (!guard(req, res, 'rekon', 'edit')) return;
    const back = req.BASE + '/rekon' + (req.body.bku_id ? '?bku=' + encodeURIComponent(req.body.bku_id) : '');
    // pencocokan berlaku untuk SEMUA BKU; transaksi pada BKU yang ditutup dilewati
    const rows = db.prepare(`SELECT t.id, t.bku_id, b.status bku_status FROM transaksi t JOIN bku b ON b.id=t.bku_id
      WHERE t.metode='transfer' AND t.status='posted'`).all();
    let n = 0, skip = 0;
    db.transaction(() => {
      const upd = db.prepare('UPDATE transaksi SET rekon_matched=? WHERE id=?');
      for (const r of rows) {
        if (r.bku_status !== 'aktif') { skip++; continue; }
        upd.run(req.body['match_' + r.id] ? 1 : 0, r.id);
        n++;
      }
    })();
    dbm.logAudit(req.user, 'EDIT', 'rekon', `Menyimpan pencocokan mutasi bank (${n} transaksi, ${skip} dilewati karena BKU ditutup)`);
    res.redirect(back + (back.includes('?') ? '&' : '?') + 'ok=' + encodeURIComponent(`Pencocokan ${n} transaksi disimpan${skip ? ` (${skip} transaksi pada BKU ditutup dilewati)` : ''}.`));
  });

  /* simpan saldo rekening koran untuk BANYAK BKU sekaligus (tabel semua BKU) */
  post('/rekon/saldo-masal', (req, res) => {
    if (!guard(req, res, 'rekon', 'create')) return;
    const tanggal = req.body.tanggal || todayISO();
    const catatan = String(req.body.catatan || '');
    const masuk = Object.keys(req.body)
      .filter(k => /^saldo_\d+$/.test(k) && String(req.body[k]).trim() !== '')
      .map(k => ({ id: Number(k.slice(6)), nominal: lib.parseMoney(req.body[k]) }));
    if (!masuk.length) return res.redirect(req.BASE + '/rekon?err=' + encodeURIComponent('Isi minimal satu saldo rekening koran.'));
    const ins = db.prepare('INSERT INTO rekon_saldo (bku_id,tanggal,saldo_koran,catatan,created_at) VALUES (?,?,?,?,?)');
    db.transaction(() => {
      for (const r of masuk) ins.run(r.id, tanggal, r.nominal, catatan, nowStamp());
    })();
    dbm.logAudit(req.user, 'TAMBAH', 'rekon',
      `Input saldo rekening koran ${masuk.length} BKU (total ${rupiah(masuk.reduce((a, b) => a + b.nominal, 0))}) tanggal ${tanggal}`);
    res.redirect(req.BASE + '/rekon?ok=' + encodeURIComponent(`Saldo rekening koran ${masuk.length} BKU disimpan.`));
  });

  post('/rekon/saldo', (req, res) => {
    if (!guard(req, res, 'rekon', 'create')) return;
    const { bku_id, tanggal, saldo_koran, catatan } = req.body;
    db.prepare('INSERT INTO rekon_saldo (bku_id,tanggal,saldo_koran,catatan,created_at) VALUES (?,?,?,?,?)')
      .run(bku_id, tanggal || todayISO(), lib.parseMoney(saldo_koran), catatan || '', nowStamp());
    dbm.logAudit(req.user, 'TAMBAH', 'rekon', `Input saldo rekening koran ${rupiah(saldo_koran)} (BKU ${bku_id})`);
    res.redirect(req.BASE + '/rekon?bku=' + bku_id + '&ok=' + encodeURIComponent('Saldo rekening koran disimpan.'));
  });

  post('/rekon/adjust', (req, res) => {
    if (!guard(req, res, 'rekon', 'create')) return;
    const { bku_id, jenis, nominal } = req.body;
    const b = db.prepare('SELECT * FROM bku WHERE id=?').get(bku_id);
    if (!b) return res.redirect(req.BASE + '/rekon?err=' + encodeURIComponent('BKU tidak ditemukan.'));
    if (b.status !== 'aktif') return res.redirect(req.BASE + '/rekon?bku=' + bku_id + '&err=' + encodeURIComponent('BKU sudah ditutup.'));
    const lockErr = dbm.periodeLockError(b.id, todayISO());
    if (lockErr) return res.redirect(req.BASE + '/rekon?bku=' + bku_id + '&err=' + encodeURIComponent(lockErr));
    const nom = lib.parseMoney(nominal);
    if (!(nom > 0)) return res.redirect(req.BASE + '/rekon?bku=' + bku_id + '&err=' + encodeURIComponent('Nominal harus lebih dari 0.'));
    const coa = db.prepare("SELECT * FROM coa WHERE kode='9.1.03'").get();
    const ym = todayISO().slice(0, 7).replace('-', '');
    const seq = db.prepare('SELECT COUNT(*) c FROM transaksi WHERE bku_id=?').get(b.id).c + 1;
    const noBukti = `${b.kode || 'BKU'}/${jenis === 'pemasukan' ? 'M' : 'K'}/${ym}/${String(seq).padStart(3, '0')}`;
    const uraian = jenis === 'pemasukan' ? 'Pendapatan bunga bank' : 'Biaya administrasi bank';
    db.prepare(`INSERT INTO transaksi (bku_id,tanggal,jenis,metode,no_bukti,coa_id,nominal,uraian,nama_pihak,status,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,'posted',?,?)`)
      .run(b.id, todayISO(), jenis, 'transfer', noBukti, coa ? coa.id : null, nom, uraian, 'Bank', req.user.id, nowStamp());
    dbm.logAudit(req.user, 'TAMBAH', 'rekon', `Catat ${uraian} ${rupiah(nom)} pada ${b.nama}`);
    res.redirect(req.BASE + '/rekon?bku=' + bku_id + '&ok=' + encodeURIComponent(uraian + ' berhasil dicatat.'));
  });
};
