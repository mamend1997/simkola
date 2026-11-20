'use strict';

module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl }) => {
  const { db } = dbm;
  const { esc, rupiah, tglID, todayISO, nowStamp, num } = lib;

  /* ---------- helper ---------- */
  function ledger(bkuId, from, to, q, jenis, sort) {
    const b = db.prepare('SELECT b.*, t.nama ta_nama FROM bku b LEFT JOIN tahun_ajaran t ON t.id=b.tahun_ajaran_id WHERE b.id=?').get(bkuId);
    if (!b) return null;
    let q2 = `SELECT t.*, co.kode coa_kode, co.nama coa_nama, u.nama pembuat, a.nama penyetuju
      FROM transaksi t LEFT JOIN coa co ON co.id=t.coa_id LEFT JOIN users u ON u.id=t.created_by
      LEFT JOIN users a ON a.id=t.approved_by WHERE t.bku_id=? AND t.status='posted'`;
    const args = [bkuId];
    if (from) { q2 += ' AND t.tanggal>=?'; args.push(from); }
    if (to) { q2 += ' AND t.tanggal<=?'; args.push(to); }
    if (jenis === 'pemasukan' || jenis === 'pengeluaran') { q2 += ' AND t.jenis=?'; args.push(jenis); }
    if (q) { q2 += ' AND (t.uraian LIKE ? OR t.nama_pihak LIKE ? OR t.no_bukti LIKE ?)'; args.push('%' + q + '%', '%' + q + '%', '%' + q + '%'); }
    q2 += ' ORDER BY t.tanggal, t.id';
    const rows = db.prepare(q2).all(...args);

    // saldo awal periode (filter) = saldo awal BKU + mutasi sebelum `from`
    let opening = Number(b.saldo_awal || 0);
    if (from) {
      const pre = db.prepare(`SELECT COALESCE(SUM(CASE WHEN jenis='pemasukan' THEN nominal ELSE -nominal END),0) d
        FROM transaksi WHERE bku_id=? AND status='posted' AND tanggal<?`).get(bkuId, from).d;
      opening += pre;
    }
    let run = opening;
    let list = rows.map((t, i) => {
      run += t.jenis === 'pemasukan' ? t.nominal : -t.nominal;
      return { ...t, no: i + 1, saldo: run };
    });
    // default: transaksi terbaru di paling atas (saldo berjalan tiap baris tetap benar)
    if (sort !== 'asc') list = list.slice().reverse().map((t, i) => ({ ...t, no: i + 1 }));
    return {
      b, opening, rows: list, closing: run,
      totalIn: rows.filter(r => r.jenis === 'pemasukan').reduce((s, r) => s + r.nominal, 0),
      totalOut: rows.filter(r => r.jenis === 'pengeluaran').reduce((s, r) => s + r.nominal, 0),
      saldoAkhirTotal: dbm.bkuSaldo(bkuId)
    };
  }

  function trxSnapshot(t) {
    return {
      tanggal: t.tanggal, jenis: t.jenis, metode: t.metode, nominal: t.nominal,
      uraian: t.uraian, nama_pihak: t.nama_pihak, coa_id: t.coa_id, no_bukti: t.no_bukti
    };
  }

  function logPerubahan(user, aksi, b, before, after, extra = '') {
    const fmt = o => o ? `${o.tanggal} · ${o.jenis} · ${rupiah(o.nominal)} · ${o.uraian}` : '-';
    dbm.logAudit(user, aksi, 'transaksi',
      `${aksi === 'EDIT' ? 'Koreksi' : 'Hapus'} transaksi BKU ${b.nama}` +
      (before ? ` — sebelum: [${fmt(before)}]` : '') +
      (after ? ` — sesudah: [${fmt(after)}]` : '') +
      (extra ? ` — ${extra}` : ''));
  }

  /* ---------- Detail BKU ---------- */
  get('/bku/:id', (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return res.notFound();
    guard(req, res, 'bku', 'view');
    const c = ctx(req);
    const b = db.prepare('SELECT * FROM bku WHERE id=?').get(req.params.id);
    if (!b) return res.notFound();
    const from = req.query.get('from') || '';
    const to = req.query.get('to') || '';
    const q = req.query.get('q') || '';
    const jenis = req.query.get('jenis') || '';
    const sort = req.query.get('sort') === 'asc' ? 'asc' : 'desc';
    const d = ledger(b.id, from, to, q, jenis, sort);
    const ta = db.prepare('SELECT * FROM tahun_ajaran WHERE id=?').get(b.tahun_ajaran_id) || {};
    const linkedIuran = dbm.bkuIuranGroups(b.id);
    const linkedIuranIds = linkedIuran.map(g => Number(g.id));
    const linkedIuranRows = linkedIuranIds.length ? dbm.iuranTagihanRows({ grupId: linkedIuranIds }) : [];
    const iuranExpected = linkedIuranRows.reduce((sum, r) => sum + Number(r.nominal || 0), 0);
    const iuranReceived = linkedIuranRows.reduce((sum, r) => sum + Number(r.kas_diterima || 0), 0);
    const iuranRemaining = linkedIuranRows.reduce((sum, r) => sum + Number(r.sisa || 0), 0);
    const bkuAllTotals = dbm.bkuTotals(b.id);
    const rabSummary = b.jenis === 'kegiatan' ? dbm.bkuRabSummary(b.id) : null;
    const rab = rabSummary ? rabSummary.totalPagu : 0;
    const rabSpent = Number(bkuAllTotals.keluar || 0);
    const rabExceeded = rabSummary ? rabSummary.overCount > 0 : false;
    const rabPercent = rab > 0 ? Math.min(100, Math.round(rabSpent / rab * 100)) : 0;
    const rabSpentByCoa = b.jenis === 'kegiatan' ? db.prepare(`SELECT t.coa_id, c.kode, c.nama,
        COALESCE(SUM(t.nominal),0) realisasi FROM transaksi t LEFT JOIN coa c ON c.id=t.coa_id
        WHERE t.bku_id=? AND t.status='posted' AND t.jenis='pengeluaran'
        GROUP BY t.coa_id, c.kode, c.nama ORDER BY c.kode, c.nama`).all(b.id) : [];
    const rabRowsByCoa = new Map((rabSummary ? rabSummary.rows : []).map(r => [Number(r.coa_id), r]));
    const rabRowsDisplay = rabSummary ? [
      ...rabSummary.rows.map(r => ({ ...r, budgeted: true })),
      ...rabSpentByCoa.filter(r => !rabRowsByCoa.has(Number(r.coa_id))).map(r => ({
        ...r, pagu: 0, realisasi: Number(r.realisasi || 0), budgeted: false
      }))
    ].sort((a, b) => String(a.kode || '').localeCompare(String(b.kode || ''), 'id')) : [];

    const terkunci = b.status !== 'aktif';
    // Edit/hapus langsung = Bendahara Utama/Admin (punya hak edit + hapus transaksi).
    // Staf & role lain hanya boleh mengajukan draf koreksi.
    const fullManage = c.can('transaksi', 'edit') && c.can('transaksi', 'delete');
    const bolehEdit = fullManage && !terkunci;
    const bolehHapus = fullManage && !terkunci;
    const bolehAjukan = !fullManage && c.can('transaksi', 'create') && !terkunci;

    /* SATU HALAMAN BERURUTAN DI DALAM SCROLLABLE BOX (tanpa pagination):
       seluruh transaksi BKU dirender berurutan dan digeser di dalam kotak tabel
       (vertikal & horizontal). Modal edit/hapus/koreksi tetap dirender hanya saat
       diminta (?edit=/?hapus=/?koreksi=) agar HTML tidak membengkak. */
    const perPage = 0;
    const totalHal = 1;
    const hal = 1;
    const pageRows = d.rows;
    const keepQs = new URLSearchParams();
    if (from) keepQs.set('from', from);
    if (to) keepQs.set('to', to);
    if (q) keepQs.set('q', q);
    if (jenis) keepQs.set('jenis', jenis);
    if (sort === 'asc') keepQs.set('sort', 'asc');
    const keepStr = keepQs.toString();
    const pageHref = extra => `${c.base}/bku/${b.id}` + (() => { const u = new URLSearchParams(keepQs); for (const [k, v] of extra) u.set(k, v); const t = u.toString(); return t ? '?' + t : ''; })();
    // modal hanya dirender saat diminta (edit/hapus/koreksi per baris)
    const rowOf = id => d.rows.find(x => String(x.id) === String(id)) || null;
    const askEdit = rowOf(req.query.get('edit'));
    const askHapus = rowOf(req.query.get('hapus'));
    const askKoreksi = rowOf(req.query.get('koreksi'));

    const coaList = db.prepare('SELECT * FROM coa ORDER BY kategori, kode').all();
    const koreksi = db.prepare(`SELECT k.*, t.no_bukti, t.tanggal, t.uraian FROM koreksi k
      LEFT JOIN transaksi t ON t.id=k.transaksi_id WHERE k.bku_id=? ORDER BY k.id DESC LIMIT 30`).all(b.id);
    const pendingKoreksi = koreksi.filter(k => k.status === 'pending');

    /* Form edit transaksi disamakan tampilannya dengan form Transaksi Masuk / Transaksi Keluar
       (urutan field, kartu radio metode, kode rekening + nominal sebaris, uraian + terbilang). */
    const editForm = (t, mid) => `<form method="post" action="${c.base}/bku/${b.id}/trx/simpan" id="f${mid}" data-trx-form>
      <input type="hidden" name="id" value="${t.id}">
      <input type="hidden" name="back" value="${esc(pageHref([]))}">
      <div class="alert ${t.jenis === 'pemasukan' ? 'ok' : 'warn'}" style="margin-bottom:16px">${ui.icon(t.jenis === 'pemasukan' ? 'up' : 'down')}
        <div><b>${t.jenis === 'pemasukan' ? 'Edit Pemasukan / Penerimaan Kas' : 'Edit Pengeluaran / Belanja'}</b><br>
        <span class="small">Nomor bukti tetap <b>${esc(t.no_bukti || '-')}</b> — setelah disimpan seluruh <b>saldo berjalan</b> baris berikutnya dihitung ulang.</span></div></div>
      <div class="row2">
        <div class="field"><label>Buku Kas (BKU)</label>
          <input value="${esc(b.nama)}" readonly></div>
        <div class="field"><label>Tanggal Transaksi</label><input type="date" name="tanggal" value="${esc(t.tanggal)}" required></div>
      </div>
      <div class="field"><label>Jenis Transaksi</label>
        <div class="radio-cards">
          <input type="radio" name="metode" id="${mid}_tunai" value="tunai" ${t.metode !== 'transfer' ? 'checked' : ''}>
          <label for="${mid}_tunai"><span class="dot"></span> Tunai (Kas)</label>
          <input type="radio" name="metode" id="${mid}_transfer" value="transfer" ${t.metode === 'transfer' ? 'checked' : ''}>
          <label for="${mid}_transfer"><span class="dot"></span> Transfer / Bank</label>
        </div>
      </div>
      <div class="row2">
        <div class="field"><label>Jenis</label><select name="jenis" class="js-jenis">
          <option value="pemasukan" ${t.jenis === 'pemasukan' ? 'selected' : ''}>Pemasukan (Debet)</option>
          <option value="pengeluaran" ${t.jenis === 'pengeluaran' ? 'selected' : ''}>Pengeluaran (Kredit)</option></select></div>
        <div class="field"><label>No. Bukti</label><input name="no_bukti" value="${esc(t.no_bukti || '')}"></div>
      </div>
      <div class="row2">
        <div class="field"><label>Kode Rekening</label>
          <select name="coa_id"><option value="">— Tanpa kode rekening —</option>
          ${coaList.map(x => `<option value="${x.id}" ${String(t.coa_id) === String(x.id) ? 'selected' : ''}>${esc(x.kode + ' · ' + x.nama)}</option>`).join('')}</select>
          <div class="hint">Rekening ditampilkan sesuai jenis transaksi.</div></div>
        <div class="field"><label>Nominal (Rp)</label>${ui.moneyInput('nominal', t.nominal, 'class="js-nominal" required placeholder="0"')}</div>
      </div>
      <div class="field"><label>Uraian / Keterangan</label><textarea name="uraian" required>${esc(t.uraian)}</textarea>
        <div class="hint">Terbilang: <b class="js-terbilang" style="color:var(--o-700)"></b></div></div>
      <div class="row2">
        <div class="field"><label>Nama Penerima / Penyetor</label>
          ${ui.pihakInput('nama_pihak', t.nama_pihak || '', 'placeholder="Pilih dari data pegawai atau ketik manual"')}
          <div class="hint">Klik kolom untuk memilih dari <b>master pegawai</b>, atau ketik nama bebas.</div></div>
        <div class="field"><label>Alasan Koreksi (wajib, dicatat di audit log)</label>
          <input name="alasan" required placeholder="Contoh: salah input nominal, koreksi tanggal"></div>
      </div>
    </form>`;

    const hapusForm = (t, mid) => `<form method="post" action="${c.base}/bku/${b.id}/trx/simpan" id="f${mid}">
      <input type="hidden" name="id" value="${t.id}"><input type="hidden" name="hapus" value="1">
      <input type="hidden" name="back" value="${esc(pageHref([]))}">
      <div class="alert err">${ui.icon('alert')}<div>Transaksi akan <b>dihapus permanen</b> dan saldo berjalan baris setelahnya dihitung ulang. Tindakan ini tercatat di audit log beserta nilai sebelum &amp; sesudah.</div></div>
      <div class="kv mb-2">
        <dt>No. Bukti</dt><dd class="mono">${esc(t.no_bukti || '-')}</dd>
        <dt>Tanggal</dt><dd>${tglID(t.tanggal)}</dd>
        <dt>Uraian</dt><dd>${esc(t.uraian)}</dd>
        <dt>Nominal</dt><dd>${rupiah(t.nominal)} (${t.jenis})</dd>
      </div>
      <div class="field"><label>Alasan Hapus (wajib)</label><input name="alasan" required placeholder="Contoh: duplikat input"></div>
    </form>`;

    const ajukanForm = (t, mid) => `<form method="post" action="${c.base}/bku/${b.id}/koreksi" id="f${mid}">
      <input type="hidden" name="transaksi_id" value="${t.id}">
      <input type="hidden" name="back" value="${esc(pageHref([]))}">
      <div class="alert info">${ui.icon('info')}<div>Role Anda tidak dapat mengubah transaksi langsung. Pengajuan akan dikirim ke <b>Bendahara Utama</b> untuk disetujui.</div></div>
      <div class="row2">
        <div class="field"><label>Jenis Pengajuan</label><select name="aksi" class="js-aksi">
          <option value="edit">Koreksi data</option><option value="hapus">Hapus transaksi</option></select></div>
        <div class="field"><label>Tanggal</label><input type="date" name="tanggal" value="${esc(t.tanggal)}"></div>
      </div>
      <div class="row2">
        <div class="field"><label>Jenis</label><select name="jenis">
          <option value="pemasukan" ${t.jenis === 'pemasukan' ? 'selected' : ''}>Pemasukan</option>
          <option value="pengeluaran" ${t.jenis === 'pengeluaran' ? 'selected' : ''}>Pengeluaran</option></select></div>
        <div class="field"><label>Nominal (Rp)</label>${ui.moneyInput('nominal', t.nominal)}</div>
      </div>
      <div class="field"><label>Keterangan / Uraian</label><textarea name="uraian">${esc(t.uraian)}</textarea></div>
      <div class="field"><label>Alasan Pengajuan</label><input name="alasan" required placeholder="Jelaskan alasan koreksi"></div>
    </form>`;

    // cache kunci periode per bulan (hindari query berulang untuk ratusan baris)
    const lockCache = new Map();
    const lockOf = (tanggal, mode) => {
      const per = String(tanggal || '').slice(0, 7);
      const key = per + '|' + (mode || '');
      if (!lockCache.has(key)) lockCache.set(key, dbm.periodeLockError(b.id, tanggal, mode));
      return lockCache.get(key);
    };
    const tableRows = pageRows.map(t => {
      const locked = lockOf(t.tanggal, 'edit');
      const lockedInfo = lockOf(t.tanggal);
      const canEditRow = bolehEdit && !locked;
      const canDelRow = bolehHapus && !locked;
      const canReqRow = bolehAjukan && !locked;
      return `<tr id="trx${t.id}">
        <td class="num t-sub">${t.no}</td>
        <td class="nowrap">${tglID(t.tanggal)}</td>
        <td><div class="mono t-sub">${esc(t.no_bukti || '-')}</div>${t.coa_nama ? `<div class="t-sub">${esc(t.coa_nama)}</div>` : ''}</td>
        <td><div class="t-strong">${esc(t.uraian)}</div>
          <div class="t-sub">${esc(t.nama_pihak || '')}${t.metode === 'transfer' ? ' · transfer' : ''}
          ${t.is_penyesuaian ? ' · <span class="badge orange plain">opnam</span>' : ''}${lockedInfo ? ' · <span class="badge amber plain">periode terkunci</span>' : ''}</div></td>
        <td class="num" style="color:var(--green)">${t.jenis === 'pemasukan' ? rupiah(t.nominal) : '—'}</td>
        <td class="num" style="color:var(--red)">${t.jenis === 'pengeluaran' ? rupiah(t.nominal) : '—'}</td>
        <td class="num t-strong">${rupiah(t.saldo)}</td>
        <td class="right nowrap">
          ${canEditRow ? `<a class="btn btn-sm btn-icon" href="${pageHref([['edit', t.id]])}#trx${t.id}" data-row-action="edit" title="Edit">${ui.icon('edit')}</a>` : ''}
          ${canDelRow ? `<a class="btn btn-sm btn-icon btn-danger" href="${pageHref([['hapus', t.id]])}#trx${t.id}" data-row-action="hapus" title="Hapus">${ui.icon('trash')}</a>` : ''}
          ${canReqRow ? `<a class="btn btn-sm" href="${pageHref([['koreksi', t.id]])}#trx${t.id}" data-row-action="koreksi" title="Ajukan koreksi">${ui.icon('upload')}</a>` : ''}
          ${!canEditRow && !canDelRow && !canReqRow ? `<span class="small muted">${terkunci ? 'BKU ditutup' : locked ? 'terkunci' : '—'}</span>` : ''}
          ${locked && !terkunci && c.can('tutup_bulanan', 'edit') ? `<form method="post" action="${c.base}/tutup-bulanan/buka" style="display:inline" data-confirm="Buka kunci periode ${esc(dbm.periodeLabel(String(t.tanggal).slice(0, 7)))} pada ${esc(b.nama)}?">
            <input type="hidden" name="bku_id" value="${b.id}"><input type="hidden" name="periode" value="${esc(String(t.tanggal).slice(0, 7))}">
            <input type="hidden" name="back" value="${esc('/bku/' + b.id)}">
            <button class="btn btn-sm btn-soft" title="Buka kunci periode">${ui.icon('unlock')}</button></form>` : ''}
          <a class="btn btn-sm btn-icon" href="${c.base}/transaksi/${t.id}/kwitansi" target="_blank" title="Kwitansi">${ui.icon('printer')}</a>
        </td></tr>`;
    }).join('');

    const koreksiRows = koreksi.map(k => {
      let baru = {}; try { baru = JSON.parse(k.data_baru || '{}'); } catch (e) { }
      let lama = {}; try { lama = JSON.parse(k.data_lama || '{}'); } catch (e) { }
      const st = k.status === 'pending' ? ui.badge('Menunggu', 'amber') : k.status === 'disetujui' ? ui.badge('Disetujui', 'green') : ui.badge('Ditolak', 'red');
      return `<tr>
        <td class="nowrap t-sub">${esc(k.requested_at || '')}</td>
        <td class="t-strong">${esc(k.requested_nama || '-')}</td>
        <td>${k.aksi === 'hapus' ? ui.badge('Hapus', 'red') : ui.badge('Koreksi', 'blue')}</td>
        <td><div class="mono t-sub">${esc(k.no_bukti || '-')}</div><div class="t-sub">${esc(k.uraian || '')}</div></td>
        <td class="small">${k.aksi === 'hapus' ? '—' : `${esc(baru.tanggal || '')} · ${esc(baru.jenis || '')} · ${rupiah(baru.nominal || 0)}<div class="t-sub">${esc(baru.uraian || '')}</div>`}</td>
        <td class="small">${esc(k.alasan || '')}</td>
        <td>${st}${k.catatan_review ? `<div class="t-sub">${esc(k.catatan_review)}</div>` : ''}</td>
        <td class="right nowrap">${k.status === 'pending' && c.can('transaksi', 'edit') ? `
          <form method="post" action="${c.base}/koreksi/${k.id}/putus" style="display:inline"><input type="hidden" name="aksi" value="setujui"><button class="btn btn-sm btn-green">${ui.icon('check')}Setujui</button></form>
          <form method="post" action="${c.base}/koreksi/${k.id}/putus" style="display:inline"><input type="hidden" name="aksi" value="tolak"><button class="btn btn-sm btn-danger">${ui.icon('x')}Tolak</button></form>` : ''}</td>
      </tr>`;
    }).join('');

    const content = `
    <div class="between mb-2">
      <a class="btn btn-sm" href="${c.base}/bku">${ui.icon('x')}Kembali ke Master BKU</a>
      <div class="toolbar">
        <a class="btn btn-sm" target="_blank" href="${c.base}/cetak/bku?bku=${b.id}&from=${esc(from)}&to=${esc(to)}">${ui.icon('printer')}Cetak BKU</a>
        <a class="btn btn-sm" href="${c.base}/export/bku?bku=${b.id}&from=${esc(from)}&to=${esc(to)}">${ui.icon('download')}Export Excel</a>
        ${c.can('import', 'create') ? `<a class="btn btn-sm btn-primary" href="${c.base}/import?bku=${b.id}">${ui.icon('upload')}Import Excel</a>` : ''}
      </div>
    </div>

    <div class="card mb-3">
      <div class="between">
        <div>
          <div class="flex" style="gap:10px">
            <h2 style="font-size:20px">${esc(b.nama)}</h2>
            ${ui.bkuStatusBadge(b.status)}
            ${b.jenis === 'umum' ? ui.badge('BKU Umum', 'blue') : ui.badge('Kegiatan Khusus', 'orange')}
          </div>
          <div class="small muted" style="margin-top:4px">Kode ${esc(b.kode || '-')} · Tahun Ajaran ${esc(ta.nama || '-')}
            ${b.ditutup_at ? ` · ditutup ${esc(b.ditutup_at)} oleh ${esc(b.ditutup_oleh || '-')}` : ''}</div>
        </div>
        <div class="toolbar">
          ${b.status === 'aktif' && c.can('bku', 'edit') ? `<button class="btn" data-open="mTutupBku">${ui.icon('lock')}Tutup BKU</button>` : ''}
          ${b.status !== 'aktif' ? `<a class="btn" target="_blank" href="${c.base}/bku/${b.id}/berita-acara">${ui.icon('printer')}Berita Acara</a>` : ''}
        </div>
      </div>
      <div class="kpi-grid mt-3" style="grid-template-columns:repeat(4,minmax(0,1fr))">
        <div class="kpi ic-orange"><div class="ico">${ui.icon('wallet')}</div><div class="lbl">Saldo Awal</div>
          <div class="val" style="font-size:18px">${rupiah(b.saldo_awal)}</div>
          ${from ? `<div class="meta">+ mutasi sebelum ${tglID(from)} = ${rupiah(d.opening)}</div>` : '<div class="meta">Saldo pembuka BKU</div>'}</div>
        <div class="kpi ic-green"><div class="ico">${ui.icon('up')}</div><div class="lbl">Total Masuk</div>
          <div class="val" style="font-size:18px">${rupiah(d.totalIn)}</div><div class="meta">${d.rows.filter(r => r.jenis === 'pemasukan').length} transaksi</div></div>
        <div class="kpi ic-red"><div class="ico">${ui.icon('down')}</div><div class="lbl">Total Keluar</div>
          <div class="val" style="font-size:18px">${rupiah(d.totalOut)}</div><div class="meta">${d.rows.filter(r => r.jenis === 'pengeluaran').length} transaksi</div></div>
        <div class="kpi ic-blue"><div class="ico">${ui.icon('bank')}</div><div class="lbl">Saldo Akhir</div>
          <div class="val" style="font-size:18px">${rupiah(d.closing)}</div><div class="meta">${from || to ? 's.d. ' + tglID(to || todayISO()) : 'Total seluruh periode'}</div></div>
      </div>
      ${linkedIuran.length ? `<div class="card mt-3">
        <div class="card-head"><div><h3>Ringkasan Grup Iuran Terhubung</h3>
          <div class="sub">${linkedIuran.length} grup · ${linkedIuranRows.length} tagihan · semua tahun ajaran pada grup terpilih</div></div>
          ${c.can('bku', 'edit') ? `<a class="btn btn-sm" href="${c.base}/bku?ta=${b.tahun_ajaran_id}">${ui.icon('link')}Atur Grup Iuran</a>` : ''}</div>
        <div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
          <div class="kpi ic-orange"><div class="lbl">Total Seharusnya Diterima (Tagihan)</div><div class="val" style="font-size:18px">${rupiah(iuranExpected)}</div></div>
          <div class="kpi ic-green"><div class="lbl">Sudah Diterima</div><div class="val" style="font-size:18px">${rupiah(iuranReceived)}</div></div>
          <div class="kpi ic-red"><div class="lbl">Sisa Tagihan</div><div class="val" style="font-size:18px">${rupiah(iuranRemaining)}</div></div>
        </div>
        <div class="toolbar mt-2">${linkedIuran.map(g => `<span class="badge blue">${esc(g.nama)} · TA ${esc(g.ta_nama || '-')}</span>`).join('')}</div>
      </div>` : `<div class="alert info mt-3">${ui.icon('info')}<div>Belum ada Grup Iuran terhubung. Hubungkan grup melalui tombol <b>Grup Iuran</b> di Master BKU agar total seharusnya diterima, penerimaan, dan sisa tagihan tampil di sini.
        ${c.can('bku', 'edit') ? `<a class="btn btn-sm" href="${c.base}/bku?ta=${b.tahun_ajaran_id}">${ui.icon('link')}Buka Master BKU</a>` : ''}</div></div>`}
      ${b.jenis === 'kegiatan' ? `<div class="card mt-3">
        <div class="card-head"><div><h3>Pemantauan RAB Pengeluaran</h3>
          <div class="sub">Pagu dan realisasi dicocokkan berdasarkan Kode Rekening Belanja</div></div>
          ${c.can('bku', 'edit') ? `<a class="btn btn-sm" href="${c.base}/bku/${b.id}/rab">${ui.icon('target')}Atur RAB</a>` : ''}
          <span class="badge ${rab === 0 ? 'gray' : rabExceeded ? 'red' : 'green'}">${rab === 0 ? 'RAB belum diatur' : rabExceeded ? 'Melebihi RAB' : 'Dalam RAB'}</span></div>
        ${rab > 0 ? `<div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
          <div class="kpi"><div class="lbl">Total Pagu</div><div class="val" style="font-size:18px">${rupiah(rab)}</div></div>
          <div class="kpi"><div class="lbl">Realisasi Pengeluaran</div><div class="val" style="font-size:18px">${rupiah(rabSpent)}</div></div>
          <div class="kpi"><div class="lbl">${rabExceeded ? 'Melebihi Pagu' : 'Sisa Pagu'}</div><div class="val" style="font-size:18px">${rupiah(Math.abs(rab - rabSpent))}</div></div>
        </div>
        <div style="height:10px;background:var(--line);border-radius:8px;overflow:hidden;margin-top:12px">
          <div style="height:100%;width:${rabPercent}%;background:${rabExceeded ? 'var(--red)' : 'var(--green)'}"></div></div>` : ''}
        ${rabSummary.legacy ? `<div class="alert warn mt-2">${ui.icon('alert')}<div>RAB lama belum dirinci per Kode Rekening. Tambahkan baris pertama di halaman RAB untuk beralih ke rincian.</div></div>` : ''}
        ${rabRowsDisplay.length ? `<div class="table-wrap sticky-head mt-2"><table><thead><tr><th>Kode</th><th>Uraian Belanja</th><th class="num">Pagu</th><th class="num">Realisasi</th><th class="num">Sisa</th></tr></thead>
          <tbody>${rabRowsDisplay.map(r => {
        const pagu = Number(r.pagu || 0), realisasi = Number(r.realisasi || 0), over = realisasi > pagu;
        return `<tr><td class="mono">${esc(r.kode || '—')}</td><td>${esc(r.nama || 'Tanpa Kode Rekening')}${over ? ' ' + ui.badge(pagu ? 'Over' : 'Belum Dianggarkan', 'red') : ''}</td>
          <td class="num">${pagu ? rupiah(pagu) : '—'}</td><td class="num">${rupiah(realisasi)}</td>
          <td class="num" style="color:${over ? 'var(--red)' : 'var(--green)'}">${rupiah(pagu - realisasi)}</td></tr>`;
      }).join('')}</tbody></table></div>` : `<div class="alert info mt-2">${ui.icon('info')}<div>Belum ada rincian RAB. Atur pagu per Kode Rekening melalui tombol <b>Atur RAB</b>.</div></div>`}
        ${rabExceeded ? `<div class="alert warn mt-2">${ui.icon('alert')}<div>Ada pengeluaran yang melebihi pagu RAB atau belum memiliki pagu. Transaksi tetap dapat dicatat, tetapi perlu ditinjau.</div></div>` : ''}
      </div>` : ''}
      ${terkunci ? `<div class="alert warn mt-2">${ui.icon('lock')}<div><b>BKU ditutup — terkunci.</b> Transaksi tidak dapat diedit/dihapus. Buka kembali BKU di Master BKU bila perlu koreksi.</div></div>` : ''}
    </div>

    ${pendingKoreksi.length ? `<div class="alert warn">${ui.icon('clock')}<div><b>${pendingKoreksi.length} pengajuan koreksi menunggu persetujuan</b> — lihat tabel di bagian bawah halaman.</div></div>` : ''}

    <div class="card mb-3" id="daftar">
      <div class="card-head"><div><h3>Rincian Transaksi BKU</h3>
        <div class="sub">Saldo berjalan dihitung ulang otomatis setiap ada edit/hapus — ${d.rows.length} baris ditampilkan</div></div>
        ${bolehEdit ? ui.badge('Bisa edit/hapus', 'green') : bolehAjukan ? ui.badge('Hanya ajukan koreksi', 'amber') : ui.badge('Hanya lihat', 'gray')}</div>
      <form method="get" action="${c.base}/bku/${b.id}" class="filterbar">
        <div class="field"><label>Dari Tanggal</label><input type="date" name="from" value="${esc(from)}"></div>
        <div class="field"><label>Sampai Tanggal</label><input type="date" name="to" value="${esc(to)}"></div>
        <div class="field"><label>Jenis</label><select name="jenis">
          <option value="">Semua</option>
          <option value="pemasukan" ${jenis === 'pemasukan' ? 'selected' : ''}>Pemasukan</option>
          <option value="pengeluaran" ${jenis === 'pengeluaran' ? 'selected' : ''}>Pengeluaran</option></select></div>
        <div class="field"><label>Urutan</label><select name="sort">
          <option value="desc" ${sort === 'desc' ? 'selected' : ''}>Terbaru ke Terlama</option>
          <option value="asc" ${sort === 'asc' ? 'selected' : ''}>Terlama ke Terbaru</option></select></div>
        <div class="field" style="flex:1;min-width:200px"><label>Cari Keterangan</label>
          <input name="q" value="${esc(q)}" placeholder="Cari uraian / penerima / no. bukti"></div>
        <button class="btn btn-primary">${ui.icon('search')}Terapkan</button>
        ${from || to || q || jenis ? `<a class="btn" href="${c.base}/bku/${b.id}">Reset</a>` : ''}
      </form>
      ${d.rows.length ? `<div class="table-scroll tall"><table><thead><tr>
        <th style="width:44px">No</th><th style="width:110px">Tanggal</th><th>No. Bukti / Kategori</th><th>Keterangan / Uraian</th>
        <th class="num">Pemasukan (D)</th><th class="num">Pengeluaran (K)</th><th class="num">Saldo Berjalan</th><th class="right">Aksi</th>
      </tr></thead><tbody>
        <tr style="background:#FFF8F2"><td></td><td colspan="4" class="t-strong">SALDO AWAL ${from ? 'per ' + tglID(from) : ''}</td>
          <td></td><td></td><td class="num t-strong">${rupiah(d.opening)}</td><td></td></tr>
        ${tableRows}
      </tbody><tfoot><tr>
        <td colspan="4">JUMLAH</td>
        <td class="num">${rupiah(d.totalIn)}</td><td class="num">${rupiah(d.totalOut)}</td>
        <td class="num">${rupiah(d.closing)}</td><td></td>
      </tr></tfoot></table></div>` : ui.emptyState('Belum ada transaksi pada filter ini', 'Ubah filter tanggal atau import data dari Excel.')}
      ${d.rows.length ? `<div class="small muted" style="margin-top:8px">${d.rows.length} baris ditampilkan berurutan dalam satu kotak — geser ke atas/bawah dan ke samping untuk melihat seluruh kolom.</div>` : ''}
      <p class="help mt-2">Kolom <b>Saldo Berjalan</b> dihitung dari Saldo Awal + akumulasi Pemasukan − Pengeluaran secara berurutan (tanggal, lalu urutan input). Setiap koreksi/hapus langsung menghitung ulang seluruh baris setelahnya.</p>
    </div>

    <div class="card">
      <div class="card-head"><div><h3>Pengajuan Koreksi &amp; Riwayat</h3>
        <div class="sub">Staff hanya dapat mengajukan; persetujuan oleh Bendahara Utama / Admin</div></div></div>
      ${koreksi.length ? `<div class="table-wrap"><table><thead><tr>
        <th>Waktu</th><th>Pengaju</th><th>Aksi</th><th>Transaksi</th><th>Data Diusulkan</th><th>Alasan</th><th>Status</th><th class="right">Putusan</th>
      </tr></thead><tbody>${koreksiRows}</tbody></table></div>`
        : ui.emptyState('Belum ada pengajuan koreksi', 'Pengajuan dari staf akan muncul di sini untuk disetujui.')}
    </div>

    ${b.status === 'aktif' && c.can('bku', 'edit') ? ui.modal('mTutupBku', {
      title: 'Tutup BKU — ' + b.nama,
      body: `<div class="alert info">${ui.icon('info')}<div>Setelah ditutup, BKU terkunci: transaksi tidak dapat ditambah, diedit, atau dihapus.</div></div>
        <div class="kv"><dt>Saldo awal</dt><dd>${rupiah(b.saldo_awal)}</dd><dt>Total masuk</dt><dd>${rupiah(dbm.bkuTotals(b.id).masuk)}</dd>
        <dt>Total keluar</dt><dd>${rupiah(dbm.bkuTotals(b.id).keluar)}</dd><dt>Saldo akhir</dt><dd style="color:var(--o-700);font-size:15px">${rupiah(d.saldoAkhirTotal)}</dd></div>
        <form method="post" action="${c.base}/bku/tutup" id="fTutupBku">
          <input type="hidden" name="id" value="${b.id}">
          <div class="field mt-2"><label>Nomor Berita Acara</label><input name="berita_acara_no" value="BA/${esc(b.kode || 'BKU')}/${new Date().getFullYear()}"></div>
          <div class="field"><label>Tanggal Tutup</label><input type="date" name="tanggal" value="${todayISO()}"></div>
        </form>`,
      footer: `<button class="btn" data-close="mTutupBku">Batal</button><button class="btn btn-primary" form="fTutupBku">${ui.icon('lock')}Tutup BKU</button>`
    }) : ''}
    ${askEdit && bolehEdit && !lockOf(askEdit.tanggal, 'edit') ? ui.modal('mRowEdit', {
      title: 'Edit Transaksi — ' + (askEdit.no_bukti || ''), wide: true, body: editForm(askEdit, 'RowEdit'),
      footer: `<a class="btn" href="${pageHref([])}#trx${askEdit.id}">Batal</a><button class="btn btn-primary" form="fRowEdit">${ui.icon('save')}Simpan &amp; Hitung Ulang</button>`
    }).replace('class="modal" id="mRowEdit"', 'class="modal show" id="mRowEdit"') : ''}
    ${askHapus && bolehHapus && !lockOf(askHapus.tanggal, 'edit') ? ui.modal('mRowHapus', {
      title: 'Hapus Transaksi', body: hapusForm(askHapus, 'RowHapus'),
      footer: `<a class="btn" href="${pageHref([])}#trx${askHapus.id}">Batal</a><button class="btn btn-danger" form="fRowHapus">${ui.icon('trash')}Hapus Transaksi</button>`
    }).replace('class="modal" id="mRowHapus"', 'class="modal show" id="mRowHapus"') : ''}
    ${askKoreksi && bolehAjukan && !lockOf(askKoreksi.tanggal, 'edit') ? ui.modal('mRowKoreksi', {
      title: 'Ajukan Koreksi', wide: true, body: ajukanForm(askKoreksi, 'RowKoreksi'),
      footer: `<a class="btn" href="${pageHref([])}#trx${askKoreksi.id}">Batal</a><button class="btn btn-primary" form="fRowKoreksi">${ui.icon('upload')}Kirim Pengajuan</button>`
    }).replace('class="modal" id="mRowKoreksi"', 'class="modal show" id="mRowKoreksi"') : ''}
    ${ui.pihakData(dbm.pegawaiList(true))}`;

    page(req, res, {
      title: 'Detail BKU', sub: `${b.nama} · ${ta.nama || '-'}`, active: 'bku', content
    });
  });

  /* ---------- simpan edit / hapus (admin) ---------- */
  post('/bku/:id/trx/simpan', (req, res) => {
    const b = db.prepare('SELECT * FROM bku WHERE id=?').get(req.params.id);
    if (!b) return res.notFound();
    const backRaw = String(req.body.back || '');
    const backPath = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/.test(backRaw) && !backRaw.startsWith('//') ? backRaw : `/bku/${b.id}`;
    const go = (msg, key) => res.redirect(req.BASE + flashUrl(backPath, key, msg));
    const isHapus = !!req.body.hapus;
    guard(req, res, 'transaksi', isHapus ? 'delete' : 'edit');
    const t = db.prepare('SELECT * FROM transaksi WHERE id=? AND bku_id=?').get(req.body.id, b.id);
    if (!t) return go('Transaksi tidak ditemukan pada BKU ini.', 'err');
    if (b.status !== 'aktif') return go('BKU sudah ditutup. Buka kembali BKU untuk melakukan koreksi.', 'err');
    const lockErr = dbm.periodeLockError(b.id, t.tanggal, 'edit');
    if (lockErr) return go(lockErr, 'err');
    const alasan = String(req.body.alasan || '').trim();
    if (!alasan) return go('Alasan koreksi wajib diisi.', 'err');

    const before = trxSnapshot(t);
    if (isHapus) {
      db.prepare('DELETE FROM transaksi WHERE id=?').run(t.id);
      db.prepare('UPDATE bku_periode SET transaksi_penyesuaian_id=NULL WHERE transaksi_penyesuaian_id=?').run(t.id);
      logPerubahan(req.user, 'HAPUS', b, before, null, `alasan: ${alasan}`);
      return go(`Transaksi ${t.no_bukti || ''} dihapus. Saldo berjalan & total BKU dihitung ulang.`, 'ok');
    }

    const { tanggal, jenis, metode, nominal, uraian, nama_pihak, coa_id, no_bukti } = req.body;
    const nom = lib.parseMoney(nominal);
    if (!(nom > 0)) return go('Nominal harus lebih dari 0.', 'err');
    if (!tanggal || !uraian) return go('Tanggal dan uraian wajib diisi.', 'err');
    const newLock = dbm.periodeLockError(b.id, tanggal);
    const samePeriode = String(tanggal).slice(0, 7) === String(t.tanggal).slice(0, 7);
    if (newLock && !samePeriode) return go(newLock, 'err');

    /* Tanggal hasil koreksi menentukan tahun pelajaran: bila tanggal baru berada
       pada tahun pelajaran lain, baris dipindahkan ke BKU ber-nama sama di tahun
       pelajaran tanggal tersebut (bukan tetap di BKU tahun pelajaran layar). */
    const taResolve = dbm.resolveBkuTanggal(b, tanggal, req.taId);
    if (taResolve.error) return go(taResolve.error, 'err');
    const bkuTujuan = taResolve.bku.id;
    const catatanTa = taResolve.dipindah
      ? ` Tanggal baru masuk tahun pelajaran ${taResolve.taTanggal.nama}, sehingga transaksi dipindahkan ke BKU "${taResolve.bku.nama}" tahun pelajaran tersebut.`
      : '';

    const threshold = Number(dbm.getSetting('approval_threshold', '5000000'));
    const perluApproval = jenis === 'pengeluaran' && nom > threshold && t.status !== 'posted';
    const status = perluApproval ? 'pending' : 'posted';

    const periodePenyesuaian = t.is_penyesuaian ? String(tanggal).slice(0, 7) : t.periode_penyesuaian;
    if (t.is_penyesuaian &&
        (Number(t.bku_id) !== Number(bkuTujuan) || String(t.periode_penyesuaian || t.tanggal).slice(0, 7) !== periodePenyesuaian)) {
      db.prepare('UPDATE bku_periode SET transaksi_penyesuaian_id=NULL WHERE transaksi_penyesuaian_id=?').run(t.id);
    }
    db.prepare(`UPDATE transaksi SET bku_id=?,tanggal=?,jenis=?,metode=?,coa_id=?,nominal=?,uraian=?,nama_pihak=?,no_bukti=?,status=?,
      periode_penyesuaian=? WHERE id=?`)
      .run(bkuTujuan, tanggal, jenis, metode || 'tunai', coa_id || null, nom, uraian, nama_pihak || '', no_bukti || t.no_bukti, status, periodePenyesuaian, t.id);

    const after = trxSnapshot({ ...t, bku_id: bkuTujuan, tanggal, jenis, metode, nominal: nom, uraian, nama_pihak, coa_id, no_bukti: no_bukti || t.no_bukti });
    logPerubahan(req.user, 'EDIT', b, before, after, `alasan: ${alasan}`);
    go('Transaksi dikoreksi. Saldo berjalan seluruh baris setelahnya sudah dihitung ulang otomatis.' + catatanTa, 'ok');
  });

  /* ---------- pengajuan koreksi (staff) ---------- */
  post('/bku/:id/koreksi', (req, res) => {
    const b = db.prepare('SELECT * FROM bku WHERE id=?').get(req.params.id);
    if (!b) return res.notFound();
    guard(req, res, 'transaksi', 'create');
    const backRaw = String(req.body.back || '');
    const backPath = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/.test(backRaw) && !backRaw.startsWith('//') ? backRaw : `/bku/${b.id}`;
    const go = (msg, key) => res.redirect(req.BASE + flashUrl(backPath, key, msg));
    if (b.status !== 'aktif') return go('BKU sudah ditutup, pengajuan koreksi tidak diperlukan.', 'err');
    const t = db.prepare('SELECT * FROM transaksi WHERE id=? AND bku_id=?').get(req.body.transaksi_id, b.id);
    if (!t) return go('Transaksi tidak ditemukan.', 'err');
    const alasan = String(req.body.alasan || '').trim();
    if (!alasan) return go('Alasan pengajuan wajib diisi.', 'err');
    const aksi = req.body.aksi === 'hapus' ? 'hapus' : 'edit';
    const baru = aksi === 'hapus' ? {} : {
      tanggal: req.body.tanggal, jenis: req.body.jenis, nominal: lib.parseMoney(req.body.nominal), uraian: req.body.uraian
    };
    db.prepare(`INSERT INTO koreksi (transaksi_id,bku_id,aksi,data_lama,data_baru,alasan,status,requested_by,requested_nama,requested_at)
      VALUES (?,?,?,?,?,?,'pending',?,?,?)`)
      .run(t.id, b.id, aksi, JSON.stringify(trxSnapshot(t)), JSON.stringify(baru), alasan, req.user.id, req.user.nama, nowStamp());
    dbm.logAudit(req.user, 'AJUKAN KOREKSI', 'transaksi',
      `Pengajuan ${aksi} transaksi ${t.no_bukti} pada BKU ${b.nama} — alasan: ${alasan}`);
    go('Pengajuan koreksi terkirim ke Bendahara Utama.', 'ok');
  });

  /* ---------- putusan koreksi ---------- */
  post('/koreksi/:id/putus', (req, res) => {
    guard(req, res, 'transaksi', 'edit');
    const k = db.prepare('SELECT * FROM koreksi WHERE id=?').get(req.params.id);
    if (!k) return res.notFound();
    if (k.status !== 'pending') return res.redirect(req.BASE + `/bku/${k.bku_id}?err=` + encodeURIComponent('Pengajuan ini sudah diputuskan.'));
    const b = db.prepare('SELECT * FROM bku WHERE id=?').get(k.bku_id);
    const setuju = req.body.aksi === 'setujui';
    const catatan = String(req.body.catatan || '').trim();

    if (!setuju) {
      db.prepare(`UPDATE koreksi SET status='ditolak', reviewed_by=?, reviewed_nama=?, reviewed_at=?, catatan_review=? WHERE id=?`)
        .run(req.user.id, req.user.nama, nowStamp(), catatan, k.id);
      dbm.logAudit(req.user, 'TOLAK KOREKSI', 'transaksi', `Pengajuan koreksi #${k.id} ditolak${catatan ? ' — ' + catatan : ''}`);
      return res.redirect(req.BASE + `/bku/${k.bku_id}?ok=` + encodeURIComponent('Pengajuan koreksi ditolak.'));
    }

    if (!b) return res.redirect(req.BASE + `/bku?err=` + encodeURIComponent('BKU tidak ditemukan.'));
    if (b.status !== 'aktif') return res.redirect(req.BASE + `/bku/${b.id}?err=` + encodeURIComponent('BKU sudah ditutup, pengajuan tidak dapat diterapkan.'));

    const t = db.prepare('SELECT * FROM transaksi WHERE id=?').get(k.transaksi_id);
    if (!t) return res.redirect(req.BASE + `/bku/${b.id}?err=` + encodeURIComponent('Transaksi sudah tidak ada.'));
    const lockErr = dbm.periodeLockError(b.id, t.tanggal, 'edit');
    if (lockErr) return res.redirect(req.BASE + `/bku/${b.id}?err=` + encodeURIComponent(lockErr));

    const before = trxSnapshot(t);
    let baru = {};
    try { baru = JSON.parse(k.data_baru || '{}'); } catch (e) { }
    if (k.aksi === 'hapus') {
      db.prepare('DELETE FROM transaksi WHERE id=?').run(t.id);
      logPerubahan(req.user, 'HAPUS', b, before, null, `dari pengajuan #${k.id} oleh ${k.requested_nama}`);
    } else {
      const tanggal = baru.tanggal || t.tanggal;
      const jenis = baru.jenis === 'pengeluaran' ? 'pengeluaran' : 'pemasukan';
      const nominal = Number(baru.nominal) || t.nominal;
      if (!(nominal > 0)) return res.redirect(req.BASE + `/bku/${b.id}?err=` + encodeURIComponent('Nominal pada pengajuan tidak valid.'));
      const newLock = dbm.periodeLockError(b.id, tanggal);
      const samePeriode = String(tanggal).slice(0, 7) === String(t.tanggal).slice(0, 7);
      if (newLock && !samePeriode) return res.redirect(req.BASE + `/bku/${b.id}?err=` + encodeURIComponent(newLock));
      db.prepare('UPDATE transaksi SET tanggal=?,jenis=?,nominal=?,uraian=? WHERE id=?')
        .run(tanggal, jenis, nominal, baru.uraian || t.uraian, t.id);
      logPerubahan(req.user, 'EDIT', b, before,
        { ...before, tanggal, jenis, nominal, uraian: baru.uraian || t.uraian },
        `dari pengajuan #${k.id} oleh ${k.requested_nama}`);
    }
    db.prepare(`UPDATE koreksi SET status='disetujui', reviewed_by=?, reviewed_nama=?, reviewed_at=?, catatan_review=? WHERE id=?`)
      .run(req.user.id, req.user.nama, nowStamp(), catatan, k.id);
    res.redirect(req.BASE + `/bku/${b.id}?ok=` + encodeURIComponent('Pengajuan disetujui & diterapkan. Saldo berjalan sudah dihitung ulang.'));
  });
};
