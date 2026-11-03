'use strict';
const printcfg = require('../printcfg');

module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can }) => {
  const { db } = dbm;
  const { esc, rupiah, tglID, todayISO, num, xlsxBuffer, BULAN } = lib;

  /* ---------- data builders ---------- */
  /**
   * Data BKU. `bkuIds` boleh satu id, array id, atau kosong/`'all'` = SEMUA BKU pada TA terpilih
   * (transaksi digabung & diurutkan per tanggal, saldo awal = jumlah saldo awal seluruh BKU).
   */
  function bkuData(bkuIds, from, to, taId) {
    const ids = (Array.isArray(bkuIds) ? bkuIds : [bkuIds])
      .map(v => Number(v)).filter(v => v > 0);
    const wh = ['COALESCE(b.auto_mode,0)=0'], args = [];
    if (ids.length) { wh.push(`b.id IN (${ids.map(() => '?').join(',')})`); args.push(...ids); }
    if (taId) { wh.push('b.tahun_ajaran_id=?'); args.push(Number(taId)); }
    const list = db.prepare(`SELECT b.*, t.nama ta_nama FROM bku b LEFT JOIN tahun_ajaran t ON t.id=b.tahun_ajaran_id
      WHERE ${wh.join(' AND ')} ORDER BY b.jenis DESC, b.urutan, b.id`).all(...args);
    if (!list.length) return null;
    const multi = list.length > 1;
    const b = multi
      ? { id: 0, nama: `Semua BKU (${list.length} buku)`, ta_nama: list[0].ta_nama, multi: true, list }
      : list[0];
    let opening = list.reduce((s, x) => s + Number(x.saldo_awal || 0), 0);
    const bIds = list.map(x => Number(x.id));
    const bq = `(${bIds.map(() => '?').join(',')})`;
    if (from) {
      const pre = db.prepare(`SELECT COALESCE(SUM(CASE WHEN jenis='pemasukan' THEN nominal ELSE -nominal END),0) d
        FROM transaksi WHERE bku_id IN ${bq} AND status='posted' AND tanggal<?`).get(...bIds, from).d;
      opening += pre;
    }
    let q = `SELECT t.*, co.kode coa_kode, co.nama coa_nama, b.nama bku_nama FROM transaksi t
      LEFT JOIN coa co ON co.id=t.coa_id LEFT JOIN bku b ON b.id=t.bku_id
      WHERE t.bku_id IN ${bq} AND t.status='posted'`;
    const qa = [...bIds];
    if (from) { q += ' AND t.tanggal>=?'; qa.push(from); }
    if (to) { q += ' AND t.tanggal<=?'; qa.push(to); }
    q += ' ORDER BY t.tanggal, t.id';
    const rows = db.prepare(q).all(...qa);
    let run = opening;
    const out = rows.map(t => {
      run += t.jenis === 'pemasukan' ? t.nominal : -t.nominal;
      return { ...t, saldo: run };
    });
    return {
      bku: b, opening, rows: out,
      totalIn: rows.filter(r => r.jenis === 'pemasukan').reduce((s, r) => s + r.nominal, 0),
      totalOut: rows.filter(r => r.jenis === 'pengeluaran').reduce((s, r) => s + r.nominal, 0),
      closing: run, from, to, multi, bkuList: list
    };
  }

  /* ---------- filter periode: 1 tahun penuh atau rincian per bulan ---------- */
  function taMonths(ta) {
    const startM = ta && ta.tanggal_mulai ? Number(String(ta.tanggal_mulai).slice(5, 7)) : 7;
    const startY = ta && ta.tanggal_mulai ? Number(String(ta.tanggal_mulai).slice(0, 4))
      : Number(String((ta && ta.nama) || '').slice(0, 4)) || new Date().getFullYear();
    return Array.from({ length: 12 }).map((_, i) => {
      const m = ((startM - 1 + i) % 12) + 1;
      const y = startY + (startM - 1 + i >= 12 ? 1 : 0);
      return { bulan: m, tahun: y, label: `${BULAN[m - 1]} ${y}`, value: `${y}-${String(m).padStart(2, '0')}` };
    });
  }
  function monthRange(ta, value) {
    if (!value || !/^\d{4}-\d{2}$/.test(value)) return null;
    const [y, m] = value.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { from: `${y}-${String(m).padStart(2, '0')}-01`, to: `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`, label: `${BULAN[m - 1]} ${y}` };
  }
  /** pilihan bulan (YTD) untuk filter laporan */
  function bulanSelect(ta, value, extra = '') {
    return `<div class="field"><label>Periode</label>
      <select name="bulan" ${extra}>
        <option value="">1 Tahun Pelajaran (Penuh)</option>
        ${taMonths(ta).map(m => `<option value="${m.value}" ${String(value) === m.value ? 'selected' : ''}>Rincian ${m.label}</option>`).join('')}
      </select></div>`;
  }
  /** pilihan target BKU: semua BKU atau satu BKU */
  function bkuSelect(bkuss, value) {
    return `<div class="field"><label>Target BKU</label><select name="bku">
      <option value="">Semua BKU</option>
      ${bkuss.map(b => `<option value="${b.id}" ${String(value) === String(b.id) ? 'selected' : ''}>${esc(b.nama)}</option>`).join('')}
    </select></div>`;
  }
  function qBulans(ta, bulan, from, to) {
    const mr = monthRange(ta, bulan);
    return { from: mr ? mr.from : (from || ''), to: mr ? mr.to : (to || ''), label: mr ? mr.label : '' };
  }

  function asetData(taId) {
    const kas = dbm.asetKas(taId);
    const sppTampil = dbm.sppTampil();
    const sertTampil = dbm.sertifikasiTampil();
    const lainnyaTampil = dbm.piutangLainnyaTampil();
    return {
      bank: kas.bank, tunai: kas.tunai,
      bankAuto: kas.bankAuto, tunaiAuto: kas.tunaiAuto,
      piutangPeg: dbm.piutangPegawaiTotal(taId),
      spp: sppTampil ? dbm.sppTunggakan(taId) : 0,
      sppTampil,
      sertifikasi: sertTampil ? dbm.piutangLainTotal('Sertifikasi', taId) : 0,
      sertTampil,
      lainnyaTampil,
      lainnya: lainnyaTampil ? dbm.piutangLainnyaAsetRows(taId) : [],
      lainnyaTotal: dbm.piutangLainnyaAset(taId),
      pinjam: dbm.pinjamanList(taId).map(p => ({ nama: p.akun.nama, saldo: p.saldo })),
      lain: dbm.asetLain(taId).map(x => ({ nama: x.nama, saldo: Number(x.saldo || 0) }))
    };
  }
  /** daftar aset riil (urut tampil) termasuk akun pinjaman & aset tambahan */
  function asetRows(a) {
    const rows = [
      ['Kas Bank', a.bank], ['Kas Tunai', a.tunai], ['Piutang Pegawai', a.piutangPeg]
    ];
    if (a.sppTampil) rows.push(['Piutang SPP Siswa', a.spp]);
    if (a.sertTampil) rows.push(['Piutang Sertifikasi', a.sertifikasi]);
    for (const k of (a.lainnya || [])) rows.push([`Piutang Lainnya — ${k.nama}`, k.sisa]);
    for (const p of a.pinjam) rows.push([p.nama, p.saldo]);
    for (const x of a.lain) rows.push([x.nama, x.saldo]);
    return rows;
  }

  function neracaData(taId) {
    // buku pembantu bank/pajak/tunai, rekap BHP & barang modal tidak masuk neraca (hanya rekapan otomatis)
    const bkuss = taId ? dbm.allBku(taId) : dbm.allBku(null);
    const dana = bkuss.map(b => ({ nama: b.nama, jenis: b.jenis, status: b.status, saldo: dbm.bkuSaldo(b.id) }));
    const totalDana = dana.reduce((s, d) => s + d.saldo, 0);
    const a = asetData(taId);
    const rows = asetRows(a);
    const totalAset = rows.reduce((s2, r) => s2 + r[1], 0);
    return { dana, totalDana, aset: a, asetRows: rows, totalAset, selisih: totalDana - totalAset };
  }

  function lraData(taId, from, to) {
    const per = [];
    let real = '';
    if (from) { real += ' AND t.tanggal>=?'; per.push(from); }
    if (to) { real += ' AND t.tanggal<=?'; per.push(to); }
    const rows = db.prepare(`SELECT c.kode, c.nama, c.id coa_id, COALESCE(a.pagu,0) pagu, a.keterangan,
      COALESCE((SELECT SUM(t.nominal) FROM transaksi t JOIN bku b ON b.id=t.bku_id
        WHERE t.coa_id=c.id AND t.status='posted' AND t.jenis='pengeluaran' AND b.tahun_ajaran_id=?${real}),0) realisasi
      FROM coa c LEFT JOIN anggaran a ON a.coa_id=c.id AND a.tahun_ajaran_id=?
      WHERE c.kategori='pengeluaran' ORDER BY c.kode`).all(...per, taId, taId);
    // rincian transaksi nyata pada periode terpilih (bukan rekapan) — dipakai filter "Rincian Per Bulan"
    const detailArgs = [taId];
    let dq = `SELECT t.id, t.tanggal, t.no_bukti, t.uraian, t.nominal, t.metode, b.nama bku_nama,
        co.kode coa_kode, co.nama coa_nama
      FROM transaksi t JOIN bku b ON b.id=t.bku_id LEFT JOIN coa co ON co.id=t.coa_id
      WHERE t.status='posted' AND t.jenis='pengeluaran' AND b.tahun_ajaran_id=?`;
    if (from) { dq += ' AND t.tanggal>=?'; detailArgs.push(from); }
    if (to) { dq += ' AND t.tanggal<=?'; detailArgs.push(to); }
    dq += ' ORDER BY t.tanggal, t.id';
    const detail = db.prepare(dq).all(...detailArgs);
    return {
      rows, detail,
      totalPagu: rows.reduce((s, r) => s + r.pagu, 0),
      totalReal: rows.reduce((s, r) => s + r.realisasi, 0),
      totalDetail: detail.reduce((s, r) => s + Number(r.nominal || 0), 0)
    };
  }

  /* ---------- helper rekap & buku pembantu ---------- */
  const MODE_LABEL = { detail: 'Daftar Transaksi (detail)', hari: 'Rekap Per Hari', bulan: 'Rekap Per Bulan', tahun: 'Rekap Per Tahun Ajaran' };
  function groupKey(tanggal, mode) {
    const d = String(tanggal || '').slice(0, 10);
    if (mode === 'hari') return d;
    if (mode === 'bulan') return d.slice(0, 7);
    return d.slice(0, 4);
  }
  function groupLabel(key, mode) {
    if (mode === 'hari') return tglID(key);
    if (mode === 'bulan') {
      const [y, m] = String(key).split('-');
      return `${BULAN[Number(m) - 1]} ${y}`;
    }
    return `Tahun ${key}`;
  }
  /** agregasi baris transaksi (yang sudah punya saldo berjalan) per hari/bulan/tahun */
  function rekapOf(rows, mode, opening) {
    const groups = [];
    const map = new Map();
    for (const t of rows) {
      const key = groupKey(t.tanggal, mode);
      let g = map.get(key);
      if (!g) {
        g = { key, label: groupLabel(key, mode), masuk: 0, keluar: 0, n: 0, saldo: opening };
        map.set(key, g);
        groups.push(g);
      }
      if (t.jenis === 'pemasukan') g.masuk += t.nominal; else g.keluar += t.nominal;
      g.n++;
      g.saldo = t.saldo;
    }
    return groups;
  }

  /** 5 buku pembantu/rekap: hanya menerima rekapan otomatis dari transaksi */
  const PEMBANTU = [
    { key: 'tunai', label: 'Buku Pembantu Tunai', desc: 'Seluruh transaksi kas tunai', where: "t.metode='tunai'" },
    { key: 'bank', label: 'Buku Pembantu Bank', desc: 'Seluruh transaksi transfer bank', where: "t.metode='transfer'" },
    { key: 'pajak', label: 'Buku Pembantu Pajak', desc: 'Transaksi dengan kode rekening kategori pajak', where: "co.kategori='pajak'" },
    { key: 'bhp', label: 'Rekap Barang Habis Pakai (BHP)', desc: 'Belanja kode rekening 5.2.01', where: "co.kode='5.2.01'" },
    { key: 'modal', label: 'Rekap Barang Modal', desc: 'Belanja kode rekening 5.2.02', where: "co.kode='5.2.02'" }
  ];
  /** mutasi Bank & Cash (modul mutasi_kas) yang memengaruhi saldo kas bank / tunai */
  function mutasiKasRows(arah, from, to, taId) {
    // arah: 'bank' | 'tunai'
    const args = [];
    let sql = `SELECT * FROM mutasi_kas WHERE (dari=? OR ke=?)`;
    args.push(arah, arah);
    if (taId) { sql += ' AND tahun_ajaran_id=?'; args.push(taId); }
    sql += ' ORDER BY tanggal, id';
    const JENIS = { bank: 'Kas Bank', tunai: 'Kas Tunai' };
    return db.prepare(sql).all(...args).map(m => {
      const masuk = m.ke === arah;
      return {
        id: 'mutasi-' + m.id, tanggal: m.tanggal, no_bukti: m.no_bukti || ('MUT/' + m.id),
        bku_nama: 'Mutasi Bank & Cash', coa_kode: '', coa_nama: 'Mutasi Kas',
        uraian: `Mutasi ${JENIS[m.dari] || m.dari} → ${JENIS[m.ke] || m.ke}${m.keterangan ? ' — ' + m.keterangan : ''}`,
        nama_pihak: '', jenis: masuk ? 'pemasukan' : 'pengeluaran', nominal: Number(m.nominal || 0),
        seq: 1e9 + Number(m.id || 0), fromMutasi: true
      };
    }).filter(m => (!from || String(m.tanggal) >= from) && (!to || String(m.tanggal) <= to));
  }
  function pembantuData(key, from, to, taId, bkuIds) {
    const cfg = PEMBANTU.find(p => p.key === key) || PEMBANTU[0];
    const bk = [].concat(bkuIds || []).map(Number).filter(Boolean);
    const args = [];
    let sql = `SELECT t.*, b.nama bku_nama, co.kode coa_kode, co.nama coa_nama
      FROM transaksi t JOIN bku b ON b.id=t.bku_id LEFT JOIN coa co ON co.id=t.coa_id
      WHERE t.status='posted' AND ${cfg.where}`;
    if (taId) { sql += ' AND b.tahun_ajaran_id=?'; args.push(taId); }
    if (bk.length) { sql += ` AND b.id IN (${bk.map(() => '?').join(',')})`; args.push(...bk); }
    if (from) { sql += ' AND t.tanggal>=?'; args.push(from); }
    if (to) { sql += ' AND t.tanggal<=?'; args.push(to); }
    sql += ' ORDER BY t.tanggal, t.id';
    let rows = db.prepare(sql).all(...args).map(t => ({ ...t, seq: Number(t.id) || 0 }));
    // rekapan otomatis Mutasi Bank & Cash pada Buku Pembantu Bank / Tunai
    if (cfg.key === 'bank' || cfg.key === 'tunai') {
      rows = rows.concat(mutasiKasRows(cfg.key, from, to, taId));
      rows.sort((a, b) => (String(a.tanggal) < String(b.tanggal) ? -1 : String(a.tanggal) > String(b.tanggal) ? 1 : (a.seq || 0) - (b.seq || 0)));
    }
    let opening = 0;
    if (from) {
      const pa = [];
      let pq = `SELECT COALESCE(SUM(CASE WHEN t.jenis='pemasukan' THEN t.nominal ELSE -t.nominal END),0) d
        FROM transaksi t JOIN bku b ON b.id=t.bku_id LEFT JOIN coa co ON co.id=t.coa_id
        WHERE t.status='posted' AND ${cfg.where}`;
      if (taId) { pq += ' AND b.tahun_ajaran_id=?'; pa.push(taId); }
      if (bk.length) { pq += ` AND b.id IN (${bk.map(() => '?').join(',')})`; pa.push(...bk); }
      pq += ' AND t.tanggal<?';
      pa.push(from);
      opening = Number(db.prepare(pq).get(...pa).d || 0);
      if (cfg.key === 'bank' || cfg.key === 'tunai') {
        const ma = [];
        let mq = 'SELECT COALESCE(SUM(CASE WHEN ke=? THEN nominal ELSE -nominal END),0) d FROM mutasi_kas WHERE (dari=? OR ke=?)';
        ma.push(cfg.key, cfg.key, cfg.key);
        if (taId) { mq += ' AND tahun_ajaran_id=?'; ma.push(taId); }
        mq += ' AND tanggal<?'; ma.push(from);
        opening += Number(db.prepare(mq).get(...ma).d || 0);
      }
    }
    let run = opening;
    const list = rows.map((t, i) => {
      run += t.jenis === 'pemasukan' ? t.nominal : -t.nominal;
      return { ...t, no: i + 1, saldo: run };
    });
    return {
      cfg, rows: list, opening, closing: run,
      totalIn: list.filter(r => r.jenis === 'pemasukan').reduce((a, r) => a + r.nominal, 0),
      totalOut: list.filter(r => r.jenis === 'pengeluaran').reduce((a, r) => a + r.nominal, 0)
    };
  }

  /** checkbox multi-pilih akun BKU untuk filter Buku Pembantu */
  function bkuPicker(bkuss, selected) {
    const sel = new Set((selected || []).map(String));
    return `<div class="field"><label>Akun BKU (multi-pilih)</label>
      <details class="multipick">
        <summary>${sel.size ? `${sel.size} BKU dipilih` : 'Semua BKU'}</summary>
        <div class="multipick-list">
          <label class="check"><input type="checkbox" data-check-all-box="bku"> <b>Pilih Semua</b></label>
          ${bkuss.map(b => `<label class="check"><input type="checkbox" name="bku" value="${b.id}" ${sel.has(String(b.id)) ? 'checked' : ''}> ${esc(b.nama)}</label>`).join('')}
        </div>
      </details></div>`;
  }

  /** piutang + total cicilan & sisa */
  function piutangList(taId) {
    const wh = taId ? ' WHERE (p.tahun_ajaran_id=? OR p.tahun_ajaran_id IS NULL)' : '';
    return db.prepare(`SELECT p.*,
        COALESCE((SELECT SUM(x.nominal) FROM piutang_bayar x WHERE x.piutang_id=p.id),0) dibayar
      FROM piutang p${wh} ORDER BY (p.status='lunas'), p.tanggal_utang DESC`).all(...(taId ? [taId] : []))
      .map(p => ({ ...p, dibayar: Number(p.dibayar || 0), sisa: Math.max(0, Number(p.nominal || 0) - Number(p.dibayar || 0)) }));
  }
  /* ---------- rekap piutang: per orang / per tanggal ---------- */
  const PIUTANG_MODES = { detail: 'Rincian per Transaksi', orang: 'Rekap per Orang (Pegawai)', tanggal: 'Rekap per Tanggal' };
  function piutangRekap(rows, mode) {
    if (mode !== 'orang' && mode !== 'tanggal') return null;
    const map = new Map();
    for (const p of rows) {
      const key = mode === 'orang'
        ? String(p.nama_pegawai || '-').trim().toLowerCase()
        : String(p.tanggal_utang || '').slice(0, 10) || '-';
      if (!map.has(key)) {
        map.set(key, {
          key, nama: mode === 'orang' ? String(p.nama_pegawai || '-').trim() : tglID(key),
          jumlah: 0, nominal: 0, dibayar: 0, sisa: 0, lunas: 0, belum: 0, items: []
        });
      }
      const g = map.get(key);
      g.jumlah++;
      g.nominal += Number(p.nominal || 0);
      g.dibayar += Number(p.dibayar || 0);
      g.sisa += Number(p.sisa || 0);
      if (p.sisa > 0) g.belum++; else g.lunas++;
      g.items.push(p);
    }
    return [...map.values()].sort((a, b) => mode === 'orang' ? (b.sisa - a.sisa) || a.nama.localeCompare(b.nama, 'id') : String(b.key).localeCompare(String(a.key)));
  }
  /** piutang lain-lain (sertifikasi) + akumulasi pembayaran */
  function sertifikasiList(taId) {
    const wh = taId ? ' WHERE (p.tahun_ajaran_id=? OR p.tahun_ajaran_id IS NULL)' : '';
    return db.prepare(`SELECT p.*,
        COALESCE((SELECT SUM(x.nominal) FROM piutang_lain_bayar x WHERE x.piutang_id=p.id),0) dibayar
      FROM piutang_lain p${wh} ORDER BY (p.status='lunas'), p.tanggal DESC, p.id DESC`).all(...(taId ? [taId] : []))
      .map(p => ({ ...p, dibayar: Number(p.dibayar || 0), sisa: Math.max(0, Number(p.nominal || 0) - Number(p.dibayar || 0)) }));
  }
  /** piutang lainnya (kategori fleksibel) + akumulasi pembayaran */
  function lainnyaList(taId) { return dbm.piutangLainnyaRows(taId); }

  /** 12 bulan SPP dengan total diterima otomatis dari transaksi 4.1.01 */
  function sppData(taId) {
    const stored = db.prepare('SELECT * FROM spp WHERE tahun_ajaran_id=? ORDER BY bulan').all(taId);
    const map = {}; stored.forEach(x => map[x.bulan] = x);
    const auto = dbm.sppTerimaMap(taId);
    return BULAN.map((nama, i) => {
      const b = i + 1;
      const x = map[b] || { total_ditagihkan: 0, diterima_manual: 0 };
      const manual = Number(x.diterima_manual || 0);
      const transaksi = Number(auto[b] || 0);
      return { bulan: b, nama, total_ditagihkan: Number(x.total_ditagihkan || 0), diterima_manual: manual, diterima_transaksi: transaksi, total_diterima: manual + transaksi };
    });
  }

  /** HTML laporan arus kas (dipakai preview laporan & cetak) */
  function arusKasHtml(ak, opts = {}) {
    const SEC = [
      ['operasional', 'A. Aktivitas Operasional', 'Penerimaan & pengeluaran rutin sekolah (SPP, BOS, belanja operasional, pajak)'],
      ['investasi', 'B. Aktivitas Investasi', 'Belanja barang modal / inventaris (kode rekening 5.2.02)'],
      ['pendanaan', 'C. Aktivitas Pendanaan / Mutasi', 'Mutasi kas antar BKU, tarik/setor tunai, administrasi bank, penyesuaian opnam']
    ];
    let body = '';
    for (const [key, label, desc] of SEC) {
      const list = (ak.groups[key] || []).filter(x => Number(x.masuk) || Number(x.keluar));
      const t = ak.totals[key];
      body += `<tr><td colspan="3" style="background:#FFF3E6;font-weight:800">${label}</td></tr>
        <tr><td colspan="3" class="small muted" style="font-size:11.5px">${desc}</td></tr>
        ${list.map(x => `<tr><td>${esc(x.kode || '-')} · ${esc(x.nama || 'Tanpa kode rekening')}</td>
          <td class="num" style="color:var(--green)">${Number(x.masuk) ? rupiah(x.masuk) : '—'}</td>
          <td class="num" style="color:var(--red)">${Number(x.keluar) ? rupiah(x.keluar) : '—'}</td></tr>`).join('')
        || '<tr><td colspan="3" class="muted small">Tidak ada transaksi.</td></tr>'}
        <tr style="background:#FFFAF5"><td class="t-strong">Jumlah ${label.replace(/^[A-C]\. /, '')} (neto)</td>
          <td class="num">${rupiah(t.masuk)}</td><td class="num">${rupiah(t.keluar)}</td></tr>
        <tr style="background:#FFF7F1"><td class="t-strong">Arus Kas Neto ${label.replace(/^[A-C]\. /, '')}</td><td colspan="2" class="num t-strong">${rupiah(t.net)}</td></tr>`;
    }
    const filter = opts.withFilter ? `<form method="get" action="${opts.formAction}" class="filterbar" style="margin-top:14px">
        <input type="hidden" name="r" value="${opts.r}">
        <div class="field"><label>Dari Tanggal</label><input type="date" name="from" value="${esc(opts.from || '')}"></div>
        <div class="field"><label>Sampai Tanggal</label><input type="date" name="to" value="${esc(opts.to || '')}"></div>
        <button class="btn">${ui.icon('filter')}Terapkan</button>
        ${opts.from || opts.to ? `<a class="btn" href="${opts.formAction}?r=${opts.r}">Reset</a>` : ''}
      </form>` : '';
    return `${filter}
      <div class="kpi-grid mb-3" style="grid-template-columns:repeat(4,minmax(0,1fr))">
        <div class="kpi ic-green"><div class="ico">${ui.icon('up')}</div><div class="lbl">Total Kas Masuk</div><div class="val" style="font-size:18px">${rupiah(ak.masuk)}</div></div>
        <div class="kpi ic-red"><div class="ico">${ui.icon('down')}</div><div class="lbl">Total Kas Keluar</div><div class="val" style="font-size:18px">${rupiah(ak.keluar)}</div></div>
        <div class="kpi ic-blue"><div class="ico">${ui.icon('refresh')}</div><div class="lbl">Kenaikan / Penurunan Kas</div><div class="val" style="font-size:18px">${rupiah(ak.kenaikan)}</div></div>
        <div class="kpi ic-orange"><div class="ico">${ui.icon('wallet')}</div><div class="lbl">Saldo Kas Akhir</div><div class="val" style="font-size:18px">${rupiah(ak.saldoAkhir)}</div></div>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Uraian Arus Kas</th><th class="num" style="width:160px">Kas Masuk</th><th class="num" style="width:160px">Kas Keluar</th></tr></thead>
      <tbody>${body}
        <tr style="background:#FFF8F2"><td class="t-strong">Saldo Kas Awal Periode</td><td colspan="2" class="num t-strong">${rupiah(ak.saldoAwal)}</td></tr>
        <tr style="background:#FFF8F2"><td class="t-strong">Kenaikan (Penurunan) Kas Bersih</td><td colspan="2" class="num t-strong">${rupiah(ak.kenaikan)}</td></tr>
        <tr style="background:#FFEADB"><td class="t-strong" style="font-size:14px">SALDO KAS AKHIR PERIODE</td><td colspan="2" class="num t-strong" style="font-size:14px">${rupiah(ak.saldoAkhir)}</td></tr>
      </tbody></table></div>`;
  }

  /* ---------- hub ---------- */
  /**
   * Rekapitulasi TUNGGAKAN iuran siswa dikelompokkan per TINGKAT lalu per KELAS.
   * Filter: tingkat (multi) dan kelas (multi). Dipakai halaman laporan, cetak, dan Excel.
   */
  function tunggakanData(taId, tingkatSel, kelasSel) {
    const tags = dbm.iuranTagihanRows({
      taId, aktifOnly: true,
      tingkat: (tingkatSel && tingkatSel.length) ? tingkatSel : undefined,
      kelasId: (kelasSel && kelasSel.length) ? kelasSel : undefined
    });
    const byTingkat = new Map();
    const byKelas = new Map();
    for (const t of tags) {
      const tk = String(t.tingkat || '') || '(tanpa tingkat)';
      const kl = String(t.kelas_nama || '') || '(tanpa kelas)';
      const sisa = Math.max(0, Number(t.sisa) || 0);
      if (!byTingkat.has(tk)) byTingkat.set(tk, { tingkat: tk, siswa: new Set(), tagihan: 0, dibayar: 0, sisa: 0, n: 0 });
      const a = byTingkat.get(tk);
      a.siswa.add(t.siswa_id); a.tagihan += Number(t.nominal) || 0; a.dibayar += Number(t.terbayar) || 0; a.sisa += sisa; a.n++;
      const key = tk + '||' + kl;
      if (!byKelas.has(key)) byKelas.set(key, { tingkat: tk, kelas: kl, siswa: new Set(), tagihan: 0, dibayar: 0, sisa: 0, n: 0 });
      const b = byKelas.get(key);
      b.siswa.add(t.siswa_id); b.tagihan += Number(t.nominal) || 0; b.dibayar += Number(t.terbayar) || 0; b.sisa += sisa; b.n++;
    }
    const urut = a => dbm.tingkatUrut(a.tingkat === '(tanpa tingkat)' ? '' : a.tingkat);
    const lv = [...byTingkat.values()].map(x => ({ ...x, siswa: x.siswa.size })).sort((a, b) => urut(a) - urut(b));
    const lk = [...byKelas.values()].map(x => ({ ...x, siswa: x.siswa.size }))
      .sort((a, b) => urut(a) - urut(b) || String(a.kelas).localeCompare(String(b.kelas)));
    const total = lv.reduce((acc, x) => ({
      tagihan: acc.tagihan + x.tagihan, dibayar: acc.dibayar + x.dibayar, sisa: acc.sisa + x.sisa
    }), { tagihan: 0, dibayar: 0, sisa: 0 });
    total.siswa = new Set(tags.map(t => t.siswa_id)).size;
    total.tagihanRows = tags.length;
    return { byTingkat: lv, byKelas: lk, total, tags };
  }
  function tingkatKelasFilter(req) {
    const tingkat = (req.query.getAll ? req.query.getAll('tingkat') : []).map(x => String(x || '').trim()).filter(Boolean);
    const kelas = (req.query.getAll ? req.query.getAll('kelas') : []).map(Number).filter(Boolean);
    return { tingkat, kelas };
  }

  get('/laporan', (req, res) => {
    guard(req, res, 'laporan', 'view');
    const c = ctx(req);
    const r = req.query.get('r') || 'bku';
    const taId = req.query.get('ta') || c.taId;
    const taList = dbm.allTahun();
    const bkuss = dbm.allBku(taId);
    const bkuId = req.query.get('bku') || (bkuss[0] || {}).id;
    const from0 = req.query.get('from') || '';
    const to0 = req.query.get('to') || '';
    const ta = taList.find(t => String(t.id) === String(taId));
    const bulanSel = monthRange(ta, req.query.get('bulan') || '') ? (req.query.get('bulan') || '') : '';
    const pr = qBulans(ta, bulanSel, from0, to0);
    const from = pr.from;
    const to = pr.to;
    const bkuArg = req.query.get('bku') || '';
    const d = bkuData(bkuArg === 'all' ? [] : bkuArg, from, to, taId);
    const canExport = c.can('laporan', 'export');
    // filter "Rincian Per Bulan" selalu menampilkan rincian transaksi aktual (bukan rekapan)
    const modeQ = ['hari', 'bulan', 'tahun'].includes(req.query.get('mode') || '') ? req.query.get('mode') : 'detail';
    const mode = bulanSel ? 'detail' : modeQ;
    const pKey = PEMBANTU.some(p => p.key === req.query.get('p')) ? req.query.get('p') : 'tunai';
    const pbku = (req.query.getAll ? req.query.getAll('bku') : []).map(Number).filter(Boolean);
    const pMode = ['detail', 'tanggal'].includes(req.query.get('pmode') || '') ? req.query.get('pmode') : 'orang';

    const tabs = [
      ['bku', 'Buku Kas Umum (BKU)'], ['neraca', 'Rekonsiliasi Kas'],
      ['lra', 'Realisasi Anggaran (LRA)'], ['piutang', 'Piutang & SPP'],
      ['tunggakan', 'Tunggakan per Tingkat'],
      ['sertifikasi', 'Piutang Sertifikasi'],
      ['lainnya', 'Piutang Lainnya'],
      ['aruskas', 'Laporan Arus Kas'], ['pembantu', 'Buku Pembantu & Rekap']
    ].map(([k, l]) => `<a href="${c.base}/laporan?r=${k}" class="${r === k ? 'on' : ''}">${l}</a>`).join('');

    const taSel = `<div class="field" style="min-width:180px"><label>Tahun Ajaran</label>
      <form method="get" action="${c.base}/laporan"><input type="hidden" name="r" value="${esc(r)}"><select name="ta" data-autosubmit>${taList.map(t => `<option value="${t.id}" ${String(t.id) === String(taId) ? 'selected' : ''}>${esc(t.nama)}</option>`).join('')}</select></form></div>`;

    let preview = '';
    let actions = '';
    if (r === 'bku') {
      const qs = `bku=${encodeURIComponent(bkuArg)}&bulan=${encodeURIComponent(bulanSel)}&from=${encodeURIComponent(bulanSel ? '' : from0)}&to=${encodeURIComponent(bulanSel ? '' : to0)}&mode=${mode}`;
      actions = `<a class="btn" target="_blank" href="${c.base}/cetak/bku?${qs}">${ui.icon('printer')}Cetak PDF</a>
        ${canExport ? `<a class="btn btn-primary" href="${c.base}/export/bku?${qs}">${ui.icon('download')}Export Excel</a>` : ''}`;
      preview = `<div class="filterbar">
        <form method="get" action="${c.base}/laporan" class="flex flex-wrap" style="gap:10px;align-items:flex-end">
          <input type="hidden" name="r" value="bku">
          ${bkuSelect(bkuss, bkuArg)}
          ${bulanSelect(ta, bulanSel, 'data-autosubmit')}
          <div class="field"><label>Tampilan Rekap</label><select name="mode">${Object.entries(MODE_LABEL).map(([k, v]) => `<option value="${k}" ${mode === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          <div class="field"><label>Dari Tanggal</label><input type="date" name="from" value="${esc(bulanSel ? '' : from0)}" ${bulanSel ? 'disabled' : ''}></div>
          <div class="field"><label>Sampai Tanggal</label><input type="date" name="to" value="${esc(bulanSel ? '' : to0)}" ${bulanSel ? 'disabled' : ''}></div>
          <button class="btn">${ui.icon('filter')}Terapkan</button>
          ${bulanSel || from0 || to0 || bkuArg ? `<a class="btn" href="${c.base}/laporan?r=bku&ta=${taId}">Reset</a>` : ''}
        </form></div>
      ${bulanSel ? `<div class="alert info">${ui.icon('info')}<div>Mode <b>Rincian Per Bulan — ${esc(pr.label)}</b>: menampilkan seluruh <b>rincian item transaksi aktual</b> pada bulan tersebut (bukan angka rekapitulasi). Pilih <b>1 Tahun Pelajaran (Penuh)</b> pada filter Periode untuk melihat satu tahun penuh.</div></div>` : ''}`;
      const rekap = d && mode !== 'detail' ? rekapOf(d.rows, mode, d.opening) : null;
      preview += d ? (rekap
        ? `<div class="table-wrap"><table><thead><tr><th>${mode === 'hari' ? 'Tanggal' : mode === 'bulan' ? 'Bulan' : 'Tahun Ajaran'}</th><th class="num">Jumlah Transaksi</th><th class="num">Penerimaan</th><th class="num">Pengeluaran</th><th class="num">Saldo Akhir</th></tr></thead>
          <tbody>
            <tr style="background:#FFF8F2"><td class="t-strong">Saldo Awal</td><td></td><td></td><td></td><td class="num t-strong">${rupiah(d.opening)}</td></tr>
            ${rekap.map(g => `<tr><td class="t-strong">${esc(g.label)}</td><td class="num">${g.n}</td>
              <td class="num" style="color:var(--green)">${g.masuk ? rupiah(g.masuk) : '—'}</td>
              <td class="num" style="color:var(--red)">${g.keluar ? rupiah(g.keluar) : '—'}</td>
              <td class="num t-strong">${rupiah(g.saldo)}</td></tr>`).join('')}
          </tbody><tfoot><tr><td>TOTAL</td><td class="num">${d.rows.length}</td><td class="num">${rupiah(d.totalIn)}</td><td class="num">${rupiah(d.totalOut)}</td><td class="num">${rupiah(d.closing)}</td></tr></tfoot></table></div>
          <p class="help mt-2">Mode: <b>${MODE_LABEL[mode]}</b> — ${rekap.length} kelompok data.</p>`
        : `<div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>No. Bukti</th><th>Uraian</th>${d.multi ? '<th>Buku Kas</th>' : ''}<th>Rekening</th><th class="num">Penerimaan</th><th class="num">Pengeluaran</th><th class="num">Saldo</th></tr></thead>
        <tbody>
          <tr style="background:#FFF8F2"><td colspan="${d.multi ? 7 : 6}" class="t-strong">Saldo awal ${from ? 'per ' + tglID(from) : 'BKU'} ${d.multi ? '· gabungan ' + d.bkuList.length + ' BKU' : ''}</td><td class="num t-strong">${rupiah(d.opening)}</td></tr>
          ${d.rows.map(t => `<tr><td class="nowrap">${tglID(t.tanggal)}</td><td class="mono t-sub nowrap">${esc(t.no_bukti || '')}</td>
            <td>${esc(t.uraian)}${t.nama_pihak ? `<div class="t-sub">${esc(t.nama_pihak)}</div>` : ''}</td>
            ${d.multi ? `<td class="t-sub">${esc(t.bku_nama || '-')}</td>` : ''}
            <td class="t-sub">${esc((t.coa_kode || '') + ' ' + (t.coa_nama || ''))}</td>
            <td class="num" style="color:var(--green)">${t.jenis === 'pemasukan' ? rupiah(t.nominal) : '—'}</td>
            <td class="num" style="color:var(--red)">${t.jenis === 'pengeluaran' ? rupiah(t.nominal) : '—'}</td>
            <td class="num t-strong">${rupiah(t.saldo)}</td></tr>`).join('')}
        </tbody><tfoot><tr><td colspan="${d.multi ? 5 : 4}">TOTAL</td><td class="num">${rupiah(d.totalIn)}</td><td class="num">${rupiah(d.totalOut)}</td><td class="num">${rupiah(d.closing)}</td></tr></tfoot></table></div>`)
        : ui.emptyState('Pilih BKU untuk melihat laporan');
    } else if (r === 'neraca') {
      const n = neracaData(taId);
      const rmode = req.query.get('rmode') === 'bku' ? 'bku' : 'gabung';
      actions = `<a class="btn" target="_blank" href="${c.base}/cetak/neraca?ta=${taId}&rmode=${rmode}">${ui.icon('printer')}Cetak PDF</a>
        ${canExport ? `<a class="btn btn-primary" href="${c.base}/export/neraca?ta=${taId}&rmode=${rmode}">${ui.icon('download')}Export Excel</a>` : ''}`;
      const modeSel = `<div class="toggle-form" style="border:0;padding:0;margin-bottom:12px">
        <div><div class="t-strong">Mode Tampilan Rekonsiliasi Kas</div>
          <div class="t-sub">Pilih bentuk rekapitulasi yang ingin ditampilkan &amp; dicetak</div></div>
        <div class="toolbar">
          <a class="btn btn-sm ${rmode === 'gabung' ? 'btn-primary' : ''}" href="${c.base}/laporan?r=neraca&rmode=gabung&ta=${taId}">Mode A · Gabungan Kas</a>
          <a class="btn btn-sm ${rmode === 'bku' ? 'btn-primary' : ''}" href="${c.base}/laporan?r=neraca&rmode=bku&ta=${taId}">Mode B · Rincian per BKU</a>
        </div></div>`;
      const rekapKas = rmode === 'gabung'
        ? `<div class="table-wrap"><table><thead><tr><th>Komponen Kas</th><th class="num">Jumlah</th><th>Sumber</th></tr></thead><tbody>
            <tr><td class="t-strong">Kas Tunai</td><td class="num t-strong">${rupiah(n.aset.tunai)}</td><td class="t-sub">Rekap gabungan seluruh BKU (transaksi tunai + mutasi + penyesuaian)</td></tr>
            <tr><td class="t-strong">Kas di Bank</td><td class="num t-strong">${rupiah(n.aset.bank)}</td><td class="t-sub">Rekap gabungan seluruh BKU (transaksi transfer + mutasi + penyesuaian)</td></tr>
            <tr style="background:#FFF8F2"><td class="t-strong">Total Kas (Tunai + Bank)</td><td class="num t-strong">${rupiah(n.aset.tunai + n.aset.bank)}</td><td class="t-sub">Rekapitulasi gabungan seluruh BKU</td></tr>
          </tbody></table></div>`
        : `<div class="table-wrap"><table><thead><tr><th>Akun BKU</th><th>Jenis</th><th>Status</th><th class="num">Saldo</th></tr></thead><tbody>
            ${n.dana.map(x => `<tr><td class="t-strong">${esc(x.nama)}</td><td>${x.jenis === 'umum' ? 'Umum' : 'Kegiatan'}</td>
              <td>${x.status === 'aktif' ? ui.badge('Aktif', 'green') : ui.badge('Ditutup', 'gray')}</td>
              <td class="num">${rupiah(x.saldo)}</td></tr>`).join('')}
          </tbody><tfoot><tr><td colspan="3">TOTAL SALDO SELURUH BKU</td><td class="num">${rupiah(n.totalDana)}</td></tr></tfoot></table></div>`;
      preview = `${modeSel}
      <div class="t-strong mb-1">Rekapitulasi ${rmode === 'gabung' ? 'Kas Gabungan' : 'Saldo per Akun BKU'}</div>
      ${rekapKas}
      <div class="split-2 mt-3">
        <div><div class="t-strong mb-1">Saldo Dana BKU</div><div class="table-wrap"><table><tbody>
          ${n.dana.map(x => `<tr><td>${esc(x.nama)}</td><td class="num">${rupiah(x.saldo)}</td></tr>`).join('')}
          <tr style="background:#FFF8F2"><td class="t-strong">Total Saldo Dana</td><td class="num t-strong">${rupiah(n.totalDana)}</td></tr>
        </tbody></table></div></div>
        <div><div class="t-strong mb-1">Aset Aktual Riil</div><div class="table-wrap"><table><tbody>
          ${n.asetRows.map(([nm, val]) => `<tr><td>${esc(nm)}</td><td class="num">${rupiah(val)}</td></tr>`).join('')}
          <tr style="background:#FFF8F2"><td class="t-strong">Total Aset Riil</td><td class="num t-strong">${rupiah(n.totalAset)}</td></tr>
        </tbody></table></div>
        ${n.aset.sppTampil ? '' : `<div class="help mt-1">Piutang SPP siswa sedang disembunyikan (atur sakelar di menu Aset Riil).</div>`}
        ${n.aset.sertTampil ? '' : `<div class="help mt-1">Piutang sertifikasi sedang disembunyikan (atur sakelar di menu Piutang Sertifikasi).</div>`}
        ${n.aset.lainnyaTampil ? '' : `<div class="help mt-1">Piutang lainnya sedang disembunyikan (atur sakelar di menu Piutang Lainnya).</div>`}
        </div>
      </div>
      <div class="alert ${Math.abs(n.selisih) < 1 ? 'ok' : 'warn'} mt-2">${ui.icon(Math.abs(n.selisih) < 1 ? 'check' : 'alert')}<div>
        <b>Selisih: ${rupiah(n.selisih)}</b> — ${Math.abs(n.selisih) < 1 ? 'saldo dana BKU seimbang dengan aset riil.' : 'periksa transaksi, saldo awal, atau nilai pinjaman kegiatan.'}</div></div>
      ${c.can('piutang_lain', 'edit') ? `<form method="post" action="${c.base}/piutang-lain/toggle-neraca" class="toggle-form mt-2" style="border:0;padding:0">
        <div>
          <div class="t-strong">Tampilkan Piutang Sertifikasi di Rekonsiliasi Kas</div>
          <div class="t-sub">${n.aset.sertTampil ? 'Saat ini ikut dihitung sebagai aset piutang' : 'Saat ini disembunyikan dari rekonsiliasi kas'} · sisa ${rupiah(n.aset.sertifikasi)}</div>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" name="tampil" value="1" ${n.aset.sertTampil ? 'checked' : ''} onchange="this.form.submit()">
          <i></i>
        </label>
        <noscript><button class="btn btn-sm">Simpan</button></noscript>
      </form>` : ''}`;
    } else if (r === 'lra') {
      const l = lraData(taId, bulanSel ? from : '', bulanSel ? to : '');
      const qs = `ta=${taId}&bulan=${encodeURIComponent(bulanSel)}`;
      actions = `<a class="btn" target="_blank" href="${c.base}/cetak/lra?${qs}">${ui.icon('printer')}Cetak PDF</a>
        ${canExport ? `<a class="btn btn-primary" href="${c.base}/export/lra?${qs}">${ui.icon('download')}Export Excel</a>` : ''}`;
      const detailHtml = bulanSel ? `<div class="t-strong mb-1 mt-3">Rincian Transaksi Belanja — ${esc(pr.label)} (${l.detail.length} transaksi)</div>
        <div class="table-scroll short"><table><thead><tr><th>Tanggal</th><th>No. Bukti</th><th>Uraian</th><th>Kode Rekening</th><th>Buku Kas</th><th>Metode</th><th class="num">Nominal</th></tr></thead><tbody>
        ${l.detail.map(t => `<tr><td class="nowrap">${tglID(t.tanggal)}</td><td class="mono t-sub">${esc(t.no_bukti || '-')}</td>
          <td>${esc(t.uraian)}</td><td class="t-sub">${esc((t.coa_kode || '') + ' ' + (t.coa_nama || ''))}</td>
          <td class="t-sub">${esc(t.bku_nama || '-')}</td><td>${t.metode === 'tunai' ? 'Tunai' : 'Transfer'}</td>
          <td class="num">${rupiah(t.nominal)}</td></tr>`).join('') || '<tr><td colspan="7" class="center muted">Tidak ada transaksi belanja pada periode ini.</td></tr>'}
        </tbody><tfoot><tr><td colspan="6">TOTAL</td><td class="num">${rupiah(l.totalDetail)}</td></tr></tfoot></table></div>` : '';
      preview = `<div class="filterbar">
          <form method="get" action="${c.base}/laporan" class="flex flex-wrap" style="gap:10px;align-items:flex-end">
            <input type="hidden" name="r" value="lra"><input type="hidden" name="ta" value="${taId}">
            ${bulanSelect(ta, bulanSel, 'data-autosubmit')}
            <button class="btn">${ui.icon('filter')}Terapkan</button>
            ${bulanSel ? `<a class="btn" href="${c.base}/laporan?r=lra&ta=${taId}">Tahun Penuh</a>` : ''}
          </form></div>
        ${bulanSel ? `<div class="alert info">${ui.icon('info')}<div>Filter <b>Rincian ${esc(pr.label)}</b>: angka realisasi hanya menghitung transaksi pada bulan tersebut, dan rincian transaksi nyata ditampilkan di bawah tabel.</div></div>` : ''}
        <div class="table-wrap"><table><thead><tr><th>Kode</th><th>Uraian Belanja</th><th class="num">Pagu</th><th class="num">Realisasi</th><th class="num">Sisa</th><th class="num">%</th></tr></thead>
        <tbody>${l.rows.map(x => `<tr><td class="mono">${esc(x.kode)}</td><td>${esc(x.nama)}</td><td class="num">${rupiah(x.pagu)}</td>
          <td class="num">${rupiah(x.realisasi)}</td><td class="num" style="color:${x.realisasi > x.pagu ? 'var(--red)' : 'var(--green)'}">${rupiah(x.pagu - x.realisasi)}</td>
          <td class="num">${x.pagu ? ((x.realisasi / x.pagu) * 100).toFixed(1) : 0}%</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="2">TOTAL</td><td class="num">${rupiah(l.totalPagu)}</td><td class="num">${rupiah(l.totalReal)}</td><td class="num">${rupiah(l.totalPagu - l.totalReal)}</td>
        <td class="num">${l.totalPagu ? ((l.totalReal / l.totalPagu) * 100).toFixed(1) : 0}%</td></tr></tfoot></table></div>${detailHtml}`;
    } else if (r === 'pembantu') {
      const pb = pembantuData(pKey, from, to, taId, pbku);
      const bkuQs = pbku.map(id => '&bku=' + id).join('');
      actions = `<a class="btn" target="_blank" href="${c.base}/cetak/pembantu?p=${pKey}&ta=${taId}&bulan=${encodeURIComponent(bulanSel)}&from=${esc(bulanSel ? '' : from0)}&to=${esc(bulanSel ? '' : to0)}${bkuQs}">${ui.icon('printer')}Cetak PDF</a>
        ${canExport ? `<a class="btn btn-primary" href="${c.base}/export/pembantu?p=${pKey}&ta=${taId}&bulan=${encodeURIComponent(bulanSel)}&from=${esc(bulanSel ? '' : from0)}&to=${esc(bulanSel ? '' : to0)}${bkuQs}">${ui.icon('download')}Export Excel</a>` : ''}`;
      preview = `<div class="pembantu-tabs">
          ${PEMBANTU.map(x => `<a href="${c.base}/laporan?r=pembantu&p=${x.key}&ta=${taId}&bulan=${encodeURIComponent(bulanSel)}&from=${esc(bulanSel ? '' : from0)}&to=${esc(bulanSel ? '' : to0)}${bkuQs}" class="${pKey === x.key ? 'on' : ''}">${esc(x.label)}</a>`).join('')}
        </div>
        <div class="alert info">${ui.icon('info')}<div><b>${esc(pb.cfg.label)}</b> — ${esc(pb.cfg.desc)}.
          Buku pembantu ini <b>tidak diinput manual</b>: seluruh isinya terbentuk otomatis dari transaksi yang Anda catat${(pKey === 'bank' || pKey === 'tunai') ? ' <b>dan dari mutasi Bank &amp; Cash</b>' : ''}.</div></div>
        <form method="get" action="${c.base}/laporan" class="filterbar" style="margin-top:14px">
          <input type="hidden" name="r" value="pembantu"><input type="hidden" name="p" value="${pKey}">
          ${bulanSelect(ta, bulanSel, 'data-autosubmit')}
          <div class="field"><label>Dari Tanggal</label><input type="date" name="from" value="${esc(bulanSel ? '' : from0)}" ${bulanSel ? 'disabled' : ''}></div>
          <div class="field"><label>Sampai Tanggal</label><input type="date" name="to" value="${esc(bulanSel ? '' : to0)}" ${bulanSel ? 'disabled' : ''}></div>
          ${bkuPicker(bkuss, pbku)}
          <button class="btn">${ui.icon('filter')}Terapkan</button>
          ${from || to || pbku.length || bulanSel ? `<a class="btn" href="${c.base}/laporan?r=pembantu&p=${pKey}">Reset</a>` : ''}
        </form>
        ${bulanSel ? `<div class="alert info mb-2">${ui.icon('info')}<div>Menampilkan buku pembantu <b>Rincian ${esc(pr.label)}</b> (transaksi aktual bulan tersebut), bukan rekapan tahunan.</div></div>` : ''}
        ${pb.rows.length ? `<div class="table-wrap sticky-head"><table><thead><tr><th style="width:44px">No</th><th style="width:110px">Tanggal</th><th>No. Bukti</th><th>Buku Kas</th><th>Uraian</th><th class="num">Masuk</th><th class="num">Keluar</th><th class="num">Saldo</th></tr></thead><tbody>
          <tr style="background:#FFF8F2"><td></td><td colspan="6" class="t-strong">SALDO AWAL ${from ? 'per ' + tglID(from) : ''}</td><td class="num t-strong">${rupiah(pb.opening)}</td></tr>
          ${pb.rows.map(t => `<tr><td class="num t-sub">${t.no}</td><td class="nowrap">${tglID(t.tanggal)}</td>
            <td class="mono t-sub nowrap">${esc(t.no_bukti || '-')}</td>
            <td class="small">${esc(t.bku_nama)}</td>
            <td><div class="t-strong">${esc(t.uraian)}</div><div class="t-sub">${esc((t.coa_kode || '') + ' ' + (t.coa_nama || ''))}${t.nama_pihak ? ' · ' + esc(t.nama_pihak) : ''}</div></td>
            <td class="num" style="color:var(--green)">${t.jenis === 'pemasukan' ? rupiah(t.nominal) : '—'}</td>
            <td class="num" style="color:var(--red)">${t.jenis === 'pengeluaran' ? rupiah(t.nominal) : '—'}</td>
            <td class="num t-strong">${rupiah(t.saldo)}</td></tr>`).join('')}
        </tbody><tfoot><tr><td colspan="5">JUMLAH</td><td class="num">${rupiah(pb.totalIn)}</td><td class="num">${rupiah(pb.totalOut)}</td><td class="num">${rupiah(pb.closing)}</td></tr></tfoot></table></div>`
        : ui.emptyState('Belum ada transaksi pada buku pembantu ini', 'Catat transaksi terkait (tunai, transfer, pajak, BHP, atau barang modal) agar rekapan ini terisi otomatis.')}
        <p class="help mt-2">Auto-posting: transaksi tunai → Buku Pembantu Tunai · transfer → Buku Pembantu Bank · mutasi Bank &amp; Cash (tunai ⇄ bank) → Buku Pembantu Tunai &amp; Bank · kode rekening pajak → Buku Pembantu Pajak · 5.2.01 → Rekap BHP · 5.2.02 → Rekap Barang Modal.</p>`;
    } else if (r === 'aruskas') {
      const bkuList = bkuArg && bkuArg !== 'all' ? [bkuArg] : [];
      const ak = dbm.arusKasData(taId, from, to, bkuList);
      const qs = `ta=${taId}&bulan=${encodeURIComponent(bulanSel)}&from=${encodeURIComponent(bulanSel ? '' : from0)}&to=${encodeURIComponent(bulanSel ? '' : to0)}&bku=${encodeURIComponent(bkuArg)}`;
      actions = `<a class="btn" target="_blank" href="${c.base}/cetak/aruskas?${qs}">${ui.icon('printer')}Cetak PDF</a>
        ${canExport ? `<a class="btn btn-primary" href="${c.base}/export/aruskas?${qs}">${ui.icon('download')}Export Excel</a>` : ''}`;
      preview = `<div class="filterbar">
          <form method="get" action="${c.base}/laporan" class="flex flex-wrap" style="gap:10px;align-items:flex-end">
            <input type="hidden" name="r" value="aruskas"><input type="hidden" name="ta" value="${taId}">
            ${bulanSelect(ta, bulanSel, 'data-autosubmit')}
            ${bkuSelect(bkuss, bkuArg)}
            <div class="field"><label>Dari Tanggal</label><input type="date" name="from" value="${esc(bulanSel ? '' : from0)}" ${bulanSel ? 'disabled' : ''}></div>
            <div class="field"><label>Sampai Tanggal</label><input type="date" name="to" value="${esc(bulanSel ? '' : to0)}" ${bulanSel ? 'disabled' : ''}></div>
            <button class="btn">${ui.icon('filter')}Terapkan</button>
            ${bulanSel || from0 || to0 || bkuArg ? `<a class="btn" href="${c.base}/laporan?r=aruskas&ta=${taId}">Reset</a>` : ''}
          </form></div>
        ${bulanSel ? `<div class="alert info">${ui.icon('info')}<div>Menampilkan arus kas <b>Rincian ${esc(pr.label)}</b>${bkuArg ? ` · BKU: <b>${esc((bkuss.find(b => String(b.id) === String(bkuArg)) || {}).nama || '-')}</b>` : ' · <b>Semua BKU</b>'}.</div></div>` : ''}
        ${arusKasHtml(ak, {})}`;
    } else if (r === 'sertifikasi') {
      const list = sertifikasiList(taId);
      const totalNominal = list.reduce((a, x) => a + Number(x.nominal || 0), 0);
      const totalDibayar = list.reduce((a, x) => a + Number(x.dibayar || 0), 0);
      const totalSisa = list.reduce((a, x) => a + Number(x.sisa || 0), 0);
      actions = `<a class="btn" target="_blank" href="${c.base}/cetak/sertifikasi?ta=${taId}">${ui.icon('printer')}Cetak PDF</a>
        ${canExport ? `<a class="btn btn-primary" href="${c.base}/export/sertifikasi?ta=${taId}">${ui.icon('download')}Export Excel</a>` : ''}`;
      const rekapOrang = dbm.sertifikasiRekap(taId);
      preview = `<div class="t-strong mb-1">Rekapitulasi Piutang Sertifikasi per Pegawai</div>
        <div class="table-wrap mb-3"><table><thead><tr><th>Nama Pegawai</th><th class="num">Jumlah Tagihan</th><th class="num">Total Piutang</th><th class="num">Sudah Dibayar</th><th class="num">Sisa Piutang</th><th class="num">Belum Lunas</th></tr></thead><tbody>
        ${rekapOrang.map(g2 => `<tr><td class="t-strong">${esc(g2.nama)}</td><td class="num">${g2.jumlah}</td>
          <td class="num">${rupiah(g2.nominal)}</td><td class="num" style="color:var(--green)">${rupiah(g2.dibayar)}</td>
          <td class="num t-strong" style="color:${g2.sisa > 0 ? 'var(--red)' : 'var(--green)'}">${rupiah(g2.sisa)}</td>
          <td class="num">${g2.aktif}</td></tr>`).join('') || '<tr><td colspan="6" class="center muted">Belum ada data piutang sertifikasi</td></tr>'}
        </tbody><tfoot><tr><td>TOTAL</td><td class="num">${rekapOrang.reduce((a, x) => a + x.jumlah, 0)}</td>
          <td class="num">${rupiah(totalNominal)}</td><td class="num">${rupiah(totalDibayar)}</td><td class="num">${rupiah(totalSisa)}</td><td></td></tr></tfoot></table></div>
        <div class="t-strong mb-1">Rincian Piutang Lain-lain (Sertifikasi)</div>
        <div class="table-wrap mb-3"><table><thead><tr><th>Nama Pegawai</th><th>Tgl Tagihan</th><th class="num">Nominal</th><th class="num">Sudah Dibayar</th><th class="num">Sisa</th><th>Status</th><th>Keterangan</th></tr></thead><tbody>
        ${list.map(x => `<tr><td>${esc(x.nama)}</td><td class="nowrap">${tglID(x.tanggal)}</td><td class="num">${rupiah(x.nominal)}</td>
          <td class="num" style="color:var(--green)">${x.dibayar ? rupiah(x.dibayar) : '—'}</td>
          <td class="num t-strong" style="color:${x.sisa > 0 ? 'var(--red)' : 'var(--green)'}">${rupiah(x.sisa)}</td>
          <td>${x.sisa > 0 ? ui.badge('Belum Lunas', 'red') : ui.badge('Lunas', 'green')}</td>
          <td class="t-sub">${esc(x.keterangan || '-')}</td></tr>`).join('') || '<tr><td colspan="7" class="center muted">Belum ada data piutang sertifikasi</td></tr>'}
        </tbody><tfoot><tr><td colspan="2">TOTAL</td><td class="num">${rupiah(totalNominal)}</td><td class="num">${rupiah(totalDibayar)}</td><td class="num">${rupiah(totalSisa)}</td><td colspan="2"></td></tr></tfoot></table></div>
        <div class="alert info">${ui.icon('info')}<div>Piutang sertifikasi <b>${dbm.sertifikasiTampil() ? 'ditampilkan' : 'disembunyikan'}</b> pada Rekonsiliasi Kas — ubah melalui sakelar di menu <a href="${c.base}/piutang-lain"><b>Piutang Sertifikasi</b></a>.</div></div>`;
    } else if (r === 'lainnya') {
      const list = lainnyaList(taId);
      const totalNominal = list.reduce((a, x) => a + Number(x.nominal || 0), 0);
      const totalDibayar = list.reduce((a, x) => a + Number(x.dibayar || 0), 0);
      const totalSisa = list.reduce((a, x) => a + Number(x.sisa || 0), 0);
      actions = `<a class="btn" target="_blank" href="${c.base}/cetak/lainnya?ta=${taId}">${ui.icon('printer')}Cetak PDF</a>
        ${canExport ? `<a class="btn btn-primary" href="${c.base}/export/lainnya?ta=${taId}">${ui.icon('download')}Export Excel</a>` : ''}`;
      const rekapOrang = dbm.piutangLainnyaRekap(taId);
      const katList = dbm.piutangKategoriList();
      preview = `<div class="t-strong mb-1">Rekapitulasi Piutang Lainnya per Kategori</div>
        <div class="table-wrap mb-3"><table><thead><tr><th>Kategori</th><th class="num">Tagihan</th><th class="num">Sisa Piutang</th><th>Tampil di Aset Riil</th></tr></thead><tbody>
        ${katList.map(k => `<tr><td class="t-strong">${esc(k.nama)}</td><td class="num">${k.jumlah}</td>
          <td class="num t-strong">${rupiah(k.sisa)}</td><td>${Number(k.tampil_aset) !== 0 ? ui.badge('Ya', 'green') : ui.badge('Tidak', 'gray')}</td></tr>`).join('') || '<tr><td colspan="4" class="center muted">Belum ada kategori piutang lainnya</td></tr>'}
        </tbody></table></div>
        <div class="t-strong mb-1">Rekapitulasi per Nama</div>
        <div class="table-wrap mb-3"><table><thead><tr><th>Nama</th><th class="num">Jumlah Tagihan</th><th class="num">Total Piutang</th><th class="num">Sudah Dibayar</th><th class="num">Sisa Piutang</th><th class="num">Belum Lunas</th></tr></thead><tbody>
        ${rekapOrang.map(g2 => `<tr><td class="t-strong">${esc(g2.nama)}</td><td class="num">${g2.jumlah}</td>
          <td class="num">${rupiah(g2.nominal)}</td><td class="num" style="color:var(--green)">${rupiah(g2.dibayar)}</td>
          <td class="num t-strong" style="color:${g2.sisa > 0 ? 'var(--red)' : 'var(--green)'}">${rupiah(g2.sisa)}</td>
          <td class="num">${g2.aktif}</td></tr>`).join('') || '<tr><td colspan="6" class="center muted">Belum ada data piutang lainnya</td></tr>'}
        </tbody><tfoot><tr><td>TOTAL</td><td class="num">${rekapOrang.reduce((a, x) => a + x.jumlah, 0)}</td>
          <td class="num">${rupiah(totalNominal)}</td><td class="num">${rupiah(totalDibayar)}</td><td class="num">${rupiah(totalSisa)}</td><td></td></tr></tfoot></table></div>
        <div class="t-strong mb-1">Rincian Piutang Lainnya</div>
        <div class="table-wrap mb-3"><table><thead><tr><th>Kategori</th><th>Nama</th><th>Tgl Tagihan</th><th class="num">Nominal</th><th class="num">Sudah Dibayar</th><th class="num">Sisa</th><th>Status</th><th>Keterangan</th></tr></thead><tbody>
        ${list.map(x => `<tr><td>${esc(x.kategori_nama || '-')}</td><td>${esc(x.nama)}</td><td class="nowrap">${tglID(x.tanggal)}</td><td class="num">${rupiah(x.nominal)}</td>
          <td class="num" style="color:var(--green)">${x.dibayar ? rupiah(x.dibayar) : '—'}</td>
          <td class="num t-strong" style="color:${x.sisa > 0 ? 'var(--red)' : 'var(--green)'}">${rupiah(x.sisa)}</td>
          <td>${x.sisa > 0 ? ui.badge('Belum Lunas', 'red') : ui.badge('Lunas', 'green')}</td>
          <td class="t-sub">${esc(x.keterangan || '-')}</td></tr>`).join('') || '<tr><td colspan="8" class="center muted">Belum ada data piutang lainnya</td></tr>'}
        </tbody><tfoot><tr><td colspan="3">TOTAL</td><td class="num">${rupiah(totalNominal)}</td><td class="num">${rupiah(totalDibayar)}</td><td class="num">${rupiah(totalSisa)}</td><td colspan="2"></td></tr></tfoot></table></div>
        <div class="alert info">${ui.icon('info')}<div>Piutang lainnya <b>${dbm.piutangLainnyaTampil() ? 'ditampilkan' : 'disembunyikan'}</b> pada Akun Aset Riil — ubah melalui sakelar di menu <a href="${c.base}/piutang-lainnya"><b>Piutang Lainnya</b></a>.</div></div>`;
    } else if (r === 'tunggakan') {
      const tf = tingkatKelasFilter(req);
      const tg = tunggakanData(taId, tf.tingkat, tf.kelas);
      const kelasAll = dbm.kelasList(taId, {});
      const qsT = new URLSearchParams();
      tf.tingkat.forEach(x => qsT.append('tingkat', x));
      tf.kelas.forEach(x => qsT.append('kelas', x));
      qsT.set('ta', taId);
      actions = `<a class="btn" target="_blank" href="${c.base}/cetak/tunggakan?${qsT}">${ui.icon('printer')}Cetak PDF</a>
        ${canExport ? `<a class="btn btn-primary" href="${c.base}/export/tunggakan?${qsT}">${ui.icon('download')}Export Excel</a>` : ''}`;
      const tgl = (val, nm) => `<label class="check"><input type="checkbox" name="${nm}" value="${esc(val)}" ${(nm === 'tingkat' ? tf.tingkat : tf.kelas.map(String)).includes(String(val)) ? 'checked' : ''}> ${esc(dbm.tingkatLabel(val) + ' (' + val + ')')}</label>`;
      preview = `<form method="get" action="${c.base}/laporan" class="filterbar">
          <input type="hidden" name="r" value="tunggakan">
          <div class="field"><label>Tahun Pelajaran</label><select name="ta">${taList.map(t => `<option value="${t.id}" ${String(t.id) === String(taId) ? 'selected' : ''}>${esc(t.nama)}</option>`).join('')}</select></div>
          <div class="field"><label>Tingkat Kelas</label>
            <details class="multipick"><summary>${tf.tingkat.length ? tf.tingkat.length + ' dipilih' : 'Semua tingkat'}</summary>
              <div class="multipick-list">${dbm.tingkatAktif().map(t => tgl(t, 'tingkat')).join('')}</div></details></div>
          <div class="field"><label>Kelas Spesifik</label>
            <details class="multipick"><summary>${tf.kelas.length ? tf.kelas.length + ' dipilih' : 'Semua kelas'}</summary>
              <div class="multipick-list">${kelasAll.map(k => `<label class="check"><input type="checkbox" name="kelas" value="${k.id}" ${tf.kelas.includes(Number(k.id)) ? 'checked' : ''}> ${esc(k.nama_kelas || k.nama)}</label>`).join('')}</div></details></div>
          <button class="btn">${ui.icon('filter')}Terapkan</button>
          ${tf.tingkat.length || tf.kelas.length ? `<a class="btn" href="${c.base}/laporan?r=tunggakan&ta=${taId}">Reset</a>` : ''}
        </form>
        <div class="kpi-grid mb-2" style="grid-template-columns:repeat(4,minmax(0,1fr))">
          <div class="kpi ic-blue"><div class="lbl">Siswa</div><div class="val" style="font-size:18px">${tg.total.siswa}</div></div>
          <div class="kpi ic-orange"><div class="lbl">Total Tagihan</div><div class="val" style="font-size:18px">${rupiah(tg.total.tagihan)}</div></div>
          <div class="kpi ic-green"><div class="lbl">Sudah Dibayar</div><div class="val" style="font-size:18px">${rupiah(tg.total.dibayar)}</div></div>
          <div class="kpi ic-red"><div class="lbl">Tunggakan</div><div class="val" style="font-size:18px">${rupiah(tg.total.sisa)}</div></div>
        </div>
        <div class="t-strong mb-1">A. Rekap per Tingkat Kelas</div>
        <div class="table-wrap mb-3 sticky-head"><table><thead><tr>
          <th>Tingkat</th><th class="num">Siswa</th><th class="num">Tagihan</th><th class="num">Dibayar</th><th class="num">Tunggakan</th><th class="num">% Tertagih</th></tr></thead><tbody>
          ${tg.byTingkat.map(x => `<tr><td class="t-strong">${esc(dbm.tingkatLabel(x.tingkat === '(tanpa tingkat)' ? '' : x.tingkat))}</td>
            <td class="num">${x.siswa}</td><td class="num">${rupiah(x.tagihan)}</td><td class="num">${rupiah(x.dibayar)}</td>
            <td class="num" style="color:${x.sisa > 0 ? 'var(--red)' : 'var(--green)'}">${rupiah(x.sisa)}</td>
            <td class="num">${x.tagihan ? Math.round((x.dibayar / x.tagihan) * 100) : 0}%</td></tr>`).join('') || '<tr><td colspan="6" class="center muted">Belum ada data</td></tr>'}
        </tbody><tfoot><tr><td>TOTAL</td><td class="num">${tg.total.siswa}</td><td class="num">${rupiah(tg.total.tagihan)}</td>
          <td class="num">${rupiah(tg.total.dibayar)}</td><td class="num">${rupiah(tg.total.sisa)}</td>
          <td class="num">${tg.total.tagihan ? Math.round((tg.total.dibayar / tg.total.tagihan) * 100) : 0}%</td></tr></tfoot></table></div>
        <div class="t-strong mb-1">B. Rekap per Kelas Spesifik</div>
        <div class="table-wrap sticky-head"><table><thead><tr>
          <th>Tingkat</th><th>Kelas</th><th class="num">Siswa</th><th class="num">Tagihan</th><th class="num">Dibayar</th><th class="num">Tunggakan</th></tr></thead><tbody>
          ${tg.byKelas.map(x => `<tr><td>${esc(dbm.tingkatLabel(x.tingkat === '(tanpa tingkat)' ? '' : x.tingkat))}</td>
            <td class="t-strong">${esc(x.kelas)}</td><td class="num">${x.siswa}</td><td class="num">${rupiah(x.tagihan)}</td>
            <td class="num">${rupiah(x.dibayar)}</td><td class="num" style="color:${x.sisa > 0 ? 'var(--red)' : 'var(--green)'}">${rupiah(x.sisa)}</td></tr>`).join('') || '<tr><td colspan="6" class="center muted">Belum ada data</td></tr>'}
        </tbody></table></div>
        <p class="help mt-2">Angka mengikuti tagihan iuran siswa yang masih aktif. Beasiswa yang sudah dipotong otomatis mengurangi tunggakan.</p>`;
    } else {
      const p = piutangList(taId);
      const rekap = piutangRekap(p, pMode);
      const sppList = sppData(taId);
      const totalTagih = sppList.reduce((a, x) => a + x.total_ditagihkan, 0);
      const totalTerima = sppList.reduce((a, x) => a + x.total_diterima, 0);
      const beasiswaTa = dbm.beasiswaTotal(taId);
      const tunggakanSpp = Math.max(0, totalTagih - totalTerima - beasiswaTa);
      const qs = `ta=${taId}&pmode=${pMode}`;
      actions = `<a class="btn" target="_blank" href="${c.base}/cetak/piutang?${qs}">${ui.icon('printer')}Cetak PDF</a>
        ${canExport ? `<a class="btn btn-primary" href="${c.base}/export/piutang?${qs}">${ui.icon('download')}Export Excel</a>` : ''}`;
      const modeBar = `<div class="pembantu-tabs" style="margin-bottom:12px">
        ${Object.entries(PIUTANG_MODES).map(([k, l]) => `<a href="${c.base}/laporan?r=piutang&ta=${taId}&pmode=${k}" class="${pMode === k ? 'on' : ''}">${l}</a>`).join('')}
      </div>`;
      const totalNom = p.reduce((a, x) => a + Number(x.nominal || 0), 0);
      const totalBayar = p.reduce((a, x) => a + Number(x.dibayar || 0), 0);
      const totalSisa = p.filter(x => x.sisa > 0).reduce((a, x) => a + x.sisa, 0);
      preview = `${modeBar}
        <div class="t-strong mb-1">${PIUTANG_MODES[pMode]}${pMode === 'detail' ? ' (dengan cicilan)' : ''}</div>
        ${rekap ? `<div class="table-wrap mb-3"><table><thead><tr>
            <th>${pMode === 'orang' ? 'Nama Pegawai' : 'Tanggal Tagihan'}</th><th class="num">Jumlah Piutang</th>
            <th class="num">Total Nominal</th><th class="num">Sudah Dicicil</th><th class="num">Sisa</th><th>Status</th></tr></thead><tbody>
          ${rekap.map(g2 => `<tr><td class="t-strong">${esc(g2.nama)}</td><td class="num">${g2.jumlah}</td>
            <td class="num">${rupiah(g2.nominal)}</td><td class="num" style="color:var(--green)">${rupiah(g2.dibayar)}</td>
            <td class="num t-strong" style="color:${g2.sisa > 0 ? 'var(--red)' : 'var(--green)'}">${rupiah(g2.sisa)}</td>
            <td>${g2.sisa > 0 ? ui.badge(g2.belum + ' belum lunas', 'red') : ui.badge('Lunas', 'green')}</td></tr>`).join('') || '<tr><td colspan="6" class="center muted">Belum ada data</td></tr>'}
          </tbody><tfoot><tr><td>JUMLAH (${rekap.length} ${pMode === 'orang' ? 'pegawai' : 'tanggal'})</td><td class="num">${p.length}</td>
            <td class="num">${rupiah(totalNom)}</td><td class="num">${rupiah(totalBayar)}</td><td class="num">${rupiah(totalSisa)}</td><td></td></tr></tfoot></table></div>`
          : `<div class="table-wrap mb-3"><table><thead><tr><th>Nama Pegawai</th><th>Tgl Utang</th><th class="num">Nominal Utang</th><th class="num">Sudah Dicicil</th><th class="num">Sisa</th><th>Status</th></tr></thead><tbody>
        ${p.map(x => `<tr><td>${esc(x.nama_pegawai)}</td><td>${tglID(x.tanggal_utang)}</td><td class="num">${rupiah(x.nominal)}</td>
          <td class="num">${rupiah(x.dibayar)}</td><td class="num t-strong">${rupiah(x.sisa)}</td>
          <td>${x.status === 'lunas' ? ui.badge('Lunas', 'green') : ui.badge('Belum Lunas', 'red')}</td></tr>`).join('') || '<tr><td colspan="6" class="center muted">Belum ada data</td></tr>'}
        </tbody><tfoot><tr><td colspan="2">TOTAL SISA PIUTANG</td><td class="num">${rupiah(totalNom)}</td><td class="num">${rupiah(totalBayar)}</td><td class="num">${rupiah(totalSisa)}</td><td></td></tr></tfoot></table></div>`}
        <div class="t-strong mb-1">Rekap SPP Bulanan</div>
        <div class="table-wrap"><table><thead><tr><th>Bulan</th><th class="num">Ditagihkan</th><th class="num">Diterima</th><th class="num">Tunggakan</th></tr></thead><tbody>
        ${sppList.map(x => `<tr><td>${x.nama}</td><td class="num">${rupiah(x.total_ditagihkan)}</td>
            <td class="num">${rupiah(x.total_diterima)}${x.diterima_transaksi ? `<div class="t-sub">${rupiah(x.diterima_transaksi)} dari transaksi</div>` : ''}</td>
            <td class="num" style="color:${x.total_ditagihkan - x.total_diterima > 0 ? 'var(--red)' : 'var(--green)'}">${rupiah(x.total_ditagihkan - x.total_diterima)}</td></tr>`).join('')}
        </tbody><tfoot><tr><td>JUMLAH</td><td class="num">${rupiah(totalTagih)}</td><td class="num">${rupiah(totalTerima)}</td><td class="num">${rupiah(tunggakanSpp)}</td></tr></tfoot></table>
        <p class="help mt-2">Beasiswa SPP aktif ${rupiah(beasiswaTa)} otomatis mengurangi tunggakan (bruto ${rupiah(Math.max(0, totalTagih - totalTerima))}).</p></div>`;
    }

    const content = `<div class="tabs">${tabs}</div>
      <div class="between mb-2"><div class="flex">${taSel}</div><div class="toolbar">${actions}</div></div>
      <div class="card">${preview}</div>
      <p class="help mt-2">Semua dokumen cetak otomatis memakai kop sekolah dan lembar pengesahan tanda tangan Bendahara &amp; Kepala Sekolah. Pilih "Save as PDF" pada dialog cetak untuk menyimpan berkas PDF.</p>`;
    page(req, res, { title: 'Laporan & Export', sub: 'BKU, rekonsiliasi kas, LRA, piutang & SPP — PDF dan Excel', active: 'laporan', content });
  });

  /* ---------- cetak (print view) ---------- */
  get('/cetak/bku', (req, res) => {
    guard(req, res, 'laporan', 'view');
    const c = ctx(req);
    const taId = req.query.get('ta') || c.taId || (dbm.activeTahun() || {}).id;
    const ta = dbm.tahunById(taId);
    const bulanSel = monthRange(ta, req.query.get('bulan') || '') ? req.query.get('bulan') : '';
    const pr = qBulans(ta, bulanSel, req.query.get('from'), req.query.get('to'));
    const bkuArg = req.query.get('bku') || '';
    const d = bkuData(bkuArg === 'all' ? [] : bkuArg, pr.from, pr.to, taId);
    if (!d) return res.notFound();
    const b = d.bku;
    const mode = bulanSel ? 'detail' : (['hari', 'bulan', 'tahun'].includes(req.query.get('mode') || '') ? req.query.get('mode') : 'detail');
    const orient = printcfg.orient(req, dbm, 'laporan_bku');
    const rekap = mode === 'detail' ? null : rekapOf(d.rows, mode, d.opening);
    const body = `
      <div class="between" style="font-size:12px;margin-bottom:8px">
        <div><b>Buku Kas:</b> ${esc(b.nama)}</div>
        ${bulanSel ? `<div><b>Rincian Bulan:</b> ${esc(pr.label)}</div>` : ''}
        <div><b>Tahun Ajaran:</b> ${esc(b.ta_nama || '-')}</div>
        <div><b>Periode:</b> ${d.from ? tglID(d.from) : 'Awal'} s.d. ${d.to ? tglID(d.to) : 'Akhir'}</div>
        <div><b>Rekap:</b> ${MODE_LABEL[mode]}</div>
      </div>
      ${rekap ? `<table class="doc-tbl">
        <thead><tr><th>${mode === 'hari' ? 'Tanggal' : mode === 'bulan' ? 'Bulan' : 'Tahun'}</th><th style="width:70px">Jml Trx</th><th style="width:100px">Penerimaan</th><th style="width:100px">Pengeluaran</th><th style="width:100px">Saldo Akhir</th></tr></thead>
        <tbody>
          <tr><td colspan="4"><b>Saldo Awal</b></td><td class="num"><b>${rupiah(d.opening)}</b></td></tr>
          ${rekap.map(g => `<tr><td>${esc(g.label)}</td><td class="center">${g.n}</td><td class="num">${g.masuk ? num(g.masuk) : ''}</td><td class="num">${g.keluar ? num(g.keluar) : ''}</td><td class="num">${num(g.saldo)}</td></tr>`).join('')}
        </tbody>
        <tfoot><tr><td class="center">JUMLAH</td><td class="center">${d.rows.length}</td><td class="num">${num(d.totalIn)}</td><td class="num">${num(d.totalOut)}</td><td class="num">${num(d.closing)}</td></tr></tfoot>
      </table>` : `<table class="doc-tbl">
        <thead><tr><th style="width:34px">No</th><th style="width:74px">Tanggal</th><th>Uraian</th><th style="width:90px">Rekening</th><th style="width:92px">Penerimaan</th><th style="width:92px">Pengeluaran</th><th style="width:96px">Saldo</th></tr></thead>
        <tbody>
          <tr><td></td><td></td><td colspan="3"><b>Saldo Awal</b></td><td></td><td class="num"><b>${rupiah(d.opening)}</b></td></tr>
          ${d.rows.map((t, i) => `<tr><td class="center">${i + 1}</td><td class="center" style="white-space:nowrap">${tglID(t.tanggal)}</td>
            <td>${esc(t.uraian)}${t.nama_pihak ? `<div style="font-size:10.5px;color:#4A3A30">${esc(t.nama_pihak)}</div>` : ''}<div style="font-size:10px;color:#6B5B51">${esc(t.no_bukti || '')}${d.multi ? ' · ' + esc(t.bku_nama || '') : ''}</div></td>
            <td style="font-size:10.5px">${esc(t.coa_kode || '')}</td>
            <td class="num">${t.jenis === 'pemasukan' ? num(t.nominal) : ''}</td>
            <td class="num">${t.jenis === 'pengeluaran' ? num(t.nominal) : ''}</td>
            <td class="num">${num(t.saldo)}</td></tr>`).join('')}
        </tbody>
        <tfoot><tr><td colspan="4" class="center">JUMLAH</td><td class="num">${num(d.totalIn)}</td><td class="num">${num(d.totalOut)}</td><td class="num">${num(d.closing)}</td></tr></tfoot>
      </table>`}
      <p style="font-size:11.5px">Saldo akhir buku kas: <b>${rupiah(d.closing)}</b> (${lib.terbilangRupiah(d.closing)})</p>
      ${ui.signBlock(c.settings, { tempat: '', tanggal: lib.tglID(d.to || todayISO()) })}`;
    res.html(ui.docPage({
      settings: c.settings, base: c.base, title: printcfg.labels(dbm, 'laporan_bku').judul || 'Laporan Buku Kas Umum',
      no: `Buku: ${b.nama}`, body, backHref: '/laporan?r=bku', orient, selfPath: req.url
    }));
  });

  get('/cetak/neraca', (req, res) => {
    guard(req, res, 'laporan', 'view');
    const c = ctx(req);
    const taId = req.query.get('ta') || (c.taId || (dbm.activeTahun() || {}).id);
    const ta = db.prepare('SELECT * FROM tahun_ajaran WHERE id=?').get(taId) || {};
    const n = neracaData(taId);
    const rmode = req.query.get('rmode') === 'bku' ? 'bku' : 'gabung';
    const rekap = rmode === 'gabung'
      ? `<table class="doc-tbl"><thead><tr><th>KOMPONEN KAS</th><th style="width:150px">JUMLAH (Rp)</th></tr></thead><tbody>
          <tr><td>Kas Tunai (gabungan seluruh BKU)</td><td class="num">${num(n.aset.tunai)}</td></tr>
          <tr><td>Kas di Bank (gabungan seluruh BKU)</td><td class="num">${num(n.aset.bank)}</td></tr>
          <tr><td><b>Total Kas</b></td><td class="num"><b>${num(n.aset.tunai + n.aset.bank)}</b></td></tr>
        </tbody></table>`
      : `<table class="doc-tbl"><thead><tr><th>AKUN BKU</th><th>JENIS</th><th style="width:150px">SALDO (Rp)</th></tr></thead><tbody>
          ${n.dana.map(x => `<tr><td>${esc(x.nama)}</td><td>${x.jenis === 'umum' ? 'Umum' : 'Kegiatan'}</td><td class="num">${num(x.saldo)}</td></tr>`).join('')}
        </tbody><tfoot><tr><td colspan="2" class="center">TOTAL SALDO BKU</td><td class="num">${num(n.totalDana)}</td></tr></tfoot></table>`;
    const body = `
      <p style="font-size:12.5px;text-align:center">Laporan Rekonsiliasi Kas — ${rmode === 'gabung' ? 'Rekap Gabungan Kas Tunai &amp; Kas di Bank' : 'Rincian Saldo per Akun BKU'}<br><b>Tahun Ajaran ${esc(ta.nama || '-')}</b></p>
      ${rekap}
      <p style="font-size:12px;margin-top:10px"><b>Perbandingan Saldo Dana BKU dengan Aset Aktual Riil</b></p>
      <table class="doc-tbl">
        <thead><tr><th>SALDO DANA BKU</th><th style="width:120px">JUMLAH (Rp)</th><th>ASET AKTUAL RIIL</th><th style="width:120px">JUMLAH (Rp)</th></tr></thead>
        <tbody>
          ${Array.from({ length: Math.max(n.dana.length, 5) }).map((_, i) => {
      const d = n.dana[i];
      const asetList = n.asetRows[i];
      return `<tr><td>${d ? esc(d.nama) : ''}</td><td class="num">${d ? num(d.saldo) : ''}</td>
            <td>${asetList ? esc(asetList[0]) : ''}</td><td class="num">${asetList ? num(asetList[1]) : ''}</td></tr>`;
    }).join('')}
        </tbody>
        <tfoot><tr><td class="center">TOTAL SALDO DANA</td><td class="num">${num(n.totalDana)}</td><td class="center">TOTAL ASET RIIL</td><td class="num">${num(n.totalAset)}</td></tr>
        <tr><td colspan="2" class="center">SELISIH</td><td colspan="2" class="num">${num(n.selisih)}</td></tr></tfoot>
      </table>
      <p style="font-size:11.5px">${Math.abs(n.selisih) < 1 ? 'Saldo dana BKU seimbang dengan total aset riil sekolah.' : 'Terdapat selisih antara saldo dana BKU dan aset riil; mohon ditelusuri pada buku kas terkait.'}</p>
      ${ui.signBlock(c.settings, { tempat: '', tanggal: lib.tglID(todayISO()) })}`;
    res.html(ui.docPage({
      settings: c.settings, base: c.base, title: printcfg.labels(dbm, 'laporan_rekon').judul || 'Rekonsiliasi Kas',
      no: `Per ${lib.tglID(todayISO())}`, body, backHref: '/laporan?r=neraca',
      orient: printcfg.orient(req, dbm, 'laporan_rekon'), selfPath: req.url
    }));
  });

  get('/cetak/lra', (req, res) => {
    guard(req, res, 'laporan', 'view');
    const c = ctx(req);
    const taId = req.query.get('ta') || (c.taId || (dbm.activeTahun() || {}).id);
    const ta = db.prepare('SELECT * FROM tahun_ajaran WHERE id=?').get(taId) || {};
    const bulanSel = monthRange(ta, req.query.get('bulan') || '') ? req.query.get('bulan') : '';
    const pr = qBulans(ta, bulanSel, req.query.get('from'), req.query.get('to'));
    const l = lraData(taId, bulanSel ? pr.from : '', bulanSel ? pr.to : '');
    const orient = printcfg.orient(req, dbm, 'laporan_lra');
    const body = `<p style="font-size:12.5px;text-align:center">${esc(printcfg.labels(dbm, 'laporan_lra').judul || 'Laporan Realisasi Anggaran')} (RAPBS/RKAS)<br><b>Tahun Ajaran ${esc(ta.nama || '-')}</b>${bulanSel ? `<br>Rincian Periode <b>${esc(pr.label)}</b>` : ''}</p>
      <table class="doc-tbl"><thead><tr><th style="width:34px">No</th><th style="width:80px">Kode</th><th>Uraian Belanja</th><th style="width:100px">Pagu</th><th style="width:100px">Realisasi</th><th style="width:100px">Sisa</th><th style="width:52px">%</th></tr></thead>
      <tbody>${l.rows.map((x, i) => `<tr><td class="center">${i + 1}</td><td class="center">${esc(x.kode)}</td><td>${esc(x.nama)}</td>
        <td class="num">${num(x.pagu)}</td><td class="num">${num(x.realisasi)}</td><td class="num">${num(x.pagu - x.realisasi)}</td>
        <td class="num">${x.pagu ? ((x.realisasi / x.pagu) * 100).toFixed(1) : '0'}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="3" class="center">JUMLAH</td><td class="num">${num(l.totalPagu)}</td><td class="num">${num(l.totalReal)}</td>
        <td class="num">${num(l.totalPagu - l.totalReal)}</td><td class="num">${l.totalPagu ? ((l.totalReal / l.totalPagu) * 100).toFixed(1) : 0}</td></tr></tfoot></table>
      ${bulanSel ? `<p style="font-size:12px;margin-top:10px"><b>RINCIAN TRANSAKSI BELANJA — ${esc(pr.label).toUpperCase()}</b> (${l.detail.length} transaksi)</p>
        <table class="doc-tbl"><thead><tr><th style="width:34px">No</th><th style="width:74px">Tanggal</th><th>Uraian</th><th style="width:80px">Rekening</th><th style="width:90px">Buku Kas</th><th style="width:92px">Nominal</th></tr></thead>
        <tbody>${l.detail.map((t, i) => `<tr><td class="center">${i + 1}</td><td class="center" style="white-space:nowrap">${tglID(t.tanggal)}</td>
          <td>${esc(t.uraian)}<div style="font-size:10px;color:#6B5B51">${esc(t.no_bukti || '')}</div></td>
          <td style="font-size:10.5px">${esc(t.coa_kode || '')}</td><td style="font-size:10.5px">${esc(t.bku_nama || '')}</td>
          <td class="num">${num(t.nominal)}</td></tr>`).join('') || '<tr><td colspan="6" class="center">Tidak ada transaksi belanja pada periode ini.</td></tr>'}</tbody>
        <tfoot><tr><td colspan="5" class="center">JUMLAH</td><td class="num">${num(l.totalDetail)}</td></tr></tfoot></table>` : ''}
      ${ui.signBlock(c.settings, { tempat: '', tanggal: lib.tglID(todayISO()) })}`;
    res.html(ui.docPage({
      settings: c.settings, base: c.base, title: printcfg.labels(dbm, 'laporan_lra').judul || 'Laporan Realisasi Anggaran',
      no: `Tahun Ajaran ${ta.nama || '-'}`, body, backHref: '/laporan?r=lra', orient, selfPath: req.url
    }));
  });

  get('/cetak/pembantu', (req, res) => {
    guard(req, res, 'laporan', 'view');
    const c = ctx(req);
    const key = PEMBANTU.some(p => p.key === req.query.get('p')) ? req.query.get('p') : 'tunai';
    const taId = req.query.get('ta') || c.taId || (dbm.activeTahun() || {}).id;
    const ta = dbm.tahunById(taId) || {};
    const bulanSel = monthRange(ta, req.query.get('bulan') || '') ? req.query.get('bulan') : '';
    const pr = qBulans(ta, bulanSel, req.query.get('from'), req.query.get('to'));
    const from = pr.from, to = pr.to;
    const pbku = (req.query.getAll ? req.query.getAll('bku') : []).map(Number).filter(Boolean);
    const pb = pembantuData(key, from, to, taId, pbku);
    const orient = printcfg.orient(req, dbm, 'laporan_pembantu');
    const body = `
      <div class="between" style="font-size:12px;margin-bottom:8px">
        <div><b>Buku:</b> ${esc(pb.cfg.label)}</div>
        <div><b>Periode:</b> ${from ? tglID(from) : 'Awal'} s.d. ${to ? tglID(to) : 'Akhir'}${bulanSel ? ` (Rincian ${esc(pr.label)})` : ''}</div>
        <div><b>Target BKU:</b> ${pbku.length ? esc(pbku.map(id => (dbm.allBku(taId).find(x => Number(x.id) === Number(id)) || {}).nama || '-').join(', ')) : 'Semua BKU'}</div>
      </div>
      <p style="font-size:11.5px">Rekapan otomatis dari transaksi — ${esc(pb.cfg.desc)}.</p>
      <table class="doc-tbl">
        <thead><tr><th style="width:34px">No</th><th style="width:74px">Tanggal</th><th>No. Bukti</th><th>Buku Kas</th><th>Uraian</th><th style="width:86px">Masuk</th><th style="width:86px">Keluar</th><th style="width:90px">Saldo</th></tr></thead>
        <tbody>
          <tr><td></td><td></td><td colspan="4"><b>Saldo Awal</b></td><td></td><td class="num"><b>${rupiah(pb.opening)}</b></td></tr>
          ${pb.rows.map(t => `<tr><td class="center">${t.no}</td><td class="center" style="white-space:nowrap">${tglID(t.tanggal)}</td>
            <td style="font-size:10.5px">${esc(t.no_bukti || '-')}</td><td style="font-size:10.5px">${esc(t.bku_nama)}</td>
            <td>${esc(t.uraian)}<div style="font-size:10px;color:#6B5B51">${esc((t.coa_kode || '') + ' ' + (t.coa_nama || ''))}</div></td>
            <td class="num">${t.jenis === 'pemasukan' ? num(t.nominal) : ''}</td>
            <td class="num">${t.jenis === 'pengeluaran' ? num(t.nominal) : ''}</td>
            <td class="num">${num(t.saldo)}</td></tr>`).join('')}
        </tbody>
        <tfoot><tr><td colspan="5" class="center">JUMLAH</td><td class="num">${num(pb.totalIn)}</td><td class="num">${num(pb.totalOut)}</td><td class="num">${num(pb.closing)}</td></tr></tfoot>
      </table>
      <p style="font-size:11.5px">Saldo akhir: <b>${rupiah(pb.closing)}</b> (${lib.terbilangRupiah(pb.closing)})</p>
      ${ui.signBlock(c.settings, { tempat: '', tanggal: lib.tglID(to || todayISO()) })}`;
    res.html(ui.docPage({
      settings: c.settings, base: c.base, title: pb.cfg.label, no: 'Rekapan Otomatis Transaksi',
      body, backHref: '/laporan?r=pembantu&p=' + key, orient, selfPath: req.url
    }));
  });

  get('/cetak/piutang', (req, res) => {
    guard(req, res, 'laporan', 'view');
    const c = ctx(req);
    const taId = req.query.get('ta') || (c.taId || (dbm.activeTahun() || {}).id);
    const ta = db.prepare('SELECT * FROM tahun_ajaran WHERE id=?').get(taId) || {};
    const p = piutangList(taId);
    const pm = ['detail', 'tanggal'].includes(req.query.get('pmode') || '') ? req.query.get('pmode') : 'orang';
    const rekapP = piutangRekap(p, pm);
    const sppList = sppData(taId);
    const totalTagih = sppList.reduce((a, x) => a + x.total_ditagihkan, 0);
    const totalTerima = sppList.reduce((a, x) => a + x.total_diterima, 0);
    const beasiswaTa = dbm.beasiswaTotal(taId);
    const tunggakanSpp = Math.max(0, totalTagih - totalTerima - beasiswaTa);
    const body = `<p style="font-size:12.5px;text-align:center">Rekapitulasi Piutang Pegawai &amp; Tunggakan SPP<br><b>Tahun Ajaran ${esc(ta.nama || '-')}</b></p>
      <div style="font-weight:700;font-size:12.5px;margin-top:10px">A. ${PIUTANG_MODES[pm]}</div>
      ${rekapP ? `<table class="doc-tbl"><thead><tr><th style="width:34px">No</th><th>${pm === 'orang' ? 'Nama Pegawai' : 'Tanggal Tagihan'}</th><th style="width:56px">Jml</th><th style="width:92px">Total Nominal</th><th style="width:92px">Sudah Dicicil</th><th style="width:92px">Sisa</th></tr></thead>
      <tbody>${rekapP.map((g2, i) => `<tr><td class="center">${i + 1}</td><td>${esc(g2.nama)}</td><td class="center">${g2.jumlah}</td>
        <td class="num">${num(g2.nominal)}</td><td class="num">${num(g2.dibayar)}</td><td class="num">${num(g2.sisa)}</td></tr>`).join('') || '<tr><td colspan="6" class="center">Tidak ada data</td></tr>'}</tbody>
      <tfoot><tr><td colspan="2" class="center">TOTAL</td><td class="center">${p.length}</td><td class="num">${num(p.reduce((a, x) => a + Number(x.nominal || 0), 0))}</td>
        <td class="num">${num(p.reduce((a, x) => a + Number(x.dibayar || 0), 0))}</td><td class="num">${num(p.filter(x => x.sisa > 0).reduce((a, x) => a + x.sisa, 0))}</td></tr></tfoot></table>`
        : `<table class="doc-tbl"><thead><tr><th style="width:34px">No</th><th>Nama Pegawai</th><th style="width:78px">Tgl Utang</th><th style="width:96px">Nominal</th><th style="width:96px">Sudah Dicicil</th><th style="width:96px">Sisa</th><th style="width:70px">Status</th></tr></thead>
      <tbody>${p.map((x, i) => `<tr><td class="center">${i + 1}</td><td>${esc(x.nama_pegawai)}</td><td class="center">${tglID(x.tanggal_utang)}</td>
        <td class="num">${num(x.nominal)}</td><td class="num">${num(x.dibayar)}</td><td class="num">${num(x.sisa)}</td>
        <td class="center">${x.status === 'lunas' ? 'Lunas' : 'Belum'}</td></tr>`).join('') || '<tr><td colspan="7" class="center">Tidak ada data</td></tr>'}</tbody>
      <tfoot><tr><td colspan="3" class="center">TOTAL</td><td class="num">${num(p.reduce((a, x) => a + x.nominal, 0))}</td><td class="num">${num(p.reduce((a, x) => a + x.dibayar, 0))}</td><td class="num">${num(p.filter(x => x.status === 'belum').reduce((a, x) => a + x.sisa, 0))}</td><td></td></tr></tfoot></table>`}
      <div style="font-weight:700;font-size:12.5px;margin-top:14px">B. Rekap SPP Bulanan</div>
      <table class="doc-tbl"><thead><tr><th style="width:34px">No</th><th>Bulan</th><th style="width:120px">Ditagihkan</th><th style="width:120px">Diterima</th><th style="width:120px">Tunggakan</th></tr></thead>
      <tbody>${sppList.map((x, i) => `<tr><td class="center">${i + 1}</td><td>${x.nama}</td><td class="num">${num(x.total_ditagihkan)}</td><td class="num">${num(x.total_diterima)}</td><td class="num">${num(x.total_ditagihkan - x.total_diterima)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="2" class="center">JUMLAH</td><td class="num">${num(totalTagih)}</td><td class="num">${num(totalTerima)}</td><td class="num">${num(tunggakanSpp)}</td></tr>
      <tr><td colspan="4">Beasiswa SPP aktif (mengurangi tunggakan)</td><td class="num">${num(beasiswaTa)}</td></tr></tfoot></table>
      ${ui.signBlock(c.settings, { tempat: '', tanggal: lib.tglID(todayISO()) })}`;
    res.html(ui.docPage({
      settings: c.settings, base: c.base, title: printcfg.labels(dbm, 'laporan_piutang').judul || 'Laporan Piutang & Tagihan SPP',
      no: `Tahun Ajaran ${ta.nama || '-'} · ${PIUTANG_MODES[pm]}`, body, backHref: '/laporan?r=piutang&pmode=' + pm,
      orient: printcfg.orient(req, dbm, 'laporan_piutang'), selfPath: req.url
    }));
  });

  get('/cetak/sertifikasi', (req, res) => {
    guard(req, res, 'laporan', 'view');
    const c = ctx(req);
    const taId = req.query.get('ta') || (c.taId || (dbm.activeTahun() || {}).id);
    const ta = db.prepare('SELECT * FROM tahun_ajaran WHERE id=?').get(taId) || {};
    const list = sertifikasiList(taId);
    const totalNom = list.reduce((a, x) => a + Number(x.nominal || 0), 0);
    const totalBayar = list.reduce((a, x) => a + Number(x.dibayar || 0), 0);
    const totalSisa = list.reduce((a, x) => a + Number(x.sisa || 0), 0);
    const rekapOrang = dbm.sertifikasiRekap(taId);
    const body = `<p style="font-size:12.5px;text-align:center">Rekapitulasi Piutang Lain-lain (Sertifikasi)<br><b>Tahun Ajaran ${esc(ta.nama || '-')}</b></p>
      <div style="font-weight:800;font-size:12px;margin:6px 0 3px">A. REKAP PER PEGAWAI</div>
      <table class="doc-tbl"><thead><tr><th style="width:34px">No</th><th>Nama Pegawai</th><th style="width:80px">Jumlah Tagihan</th>
        <th style="width:92px">Total Piutang</th><th style="width:92px">Sudah Dibayar</th><th style="width:92px">Sisa</th><th style="width:60px">Belum</th></tr></thead>
      <tbody>${rekapOrang.map((x, i) => `<tr><td class="center">${i + 1}</td><td>${esc(x.nama)}</td><td class="num">${x.jumlah}</td>
        <td class="num">${num(x.nominal)}</td><td class="num">${num(x.dibayar)}</td><td class="num">${num(x.sisa)}</td><td class="center">${x.aktif}</td></tr>`).join('') || '<tr><td colspan="7" class="center">Tidak ada data</td></tr>'}</tbody>
      <tfoot><tr><td colspan="2" class="center">TOTAL</td><td class="num">${rekapOrang.reduce((a, x) => a + x.jumlah, 0)}</td>
        <td class="num">${num(totalNom)}</td><td class="num">${num(totalBayar)}</td><td class="num">${num(totalSisa)}</td><td></td></tr></tfoot></table>
      <div style="font-weight:800;font-size:12px;margin:10px 0 3px">B. RINCIAN TAGIHAN</div>
      <table class="doc-tbl"><thead><tr><th style="width:34px">No</th><th>Nama Pegawai</th><th style="width:82px">Tgl Tagihan</th>
        <th style="width:92px">Nominal</th><th style="width:92px">Sudah Dibayar</th><th style="width:92px">Sisa</th><th style="width:64px">Status</th><th>Keterangan</th></tr></thead>
      <tbody>${list.map((x, i) => `<tr><td class="center">${i + 1}</td><td>${esc(x.nama)}</td><td class="center">${tglID(x.tanggal)}</td>
        <td class="num">${num(x.nominal)}</td><td class="num">${num(x.dibayar)}</td><td class="num">${num(x.sisa)}</td>
        <td class="center">${x.sisa > 0 ? 'Belum' : 'Lunas'}</td><td style="font-size:10.5px">${esc(x.keterangan || '-')}</td></tr>`).join('') || '<tr><td colspan="8" class="center">Tidak ada data</td></tr>'}</tbody>
      <tfoot><tr><td colspan="3" class="center">TOTAL</td><td class="num">${num(totalNom)}</td><td class="num">${num(totalBayar)}</td><td class="num">${num(totalSisa)}</td><td colspan="2"></td></tr></tfoot></table>
      <p style="font-size:11.5px">Sisa piutang sertifikasi: <b>${rupiah(totalSisa)}</b> (${lib.terbilangRupiah(totalSisa)})</p>
      ${ui.signBlock(c.settings, { tempat: '', tanggal: lib.tglID(todayISO()) })}`;
    res.html(ui.docPage({ settings: c.settings, base: c.base, title: 'Laporan Piutang Sertifikasi', no: `Tahun Ajaran ${ta.nama || '-'}`, body, backHref: '/laporan?r=sertifikasi', orient: printcfg.orient(req, dbm, 'laporan_piutang'), selfPath: req.url }));
  });

  get('/cetak/lainnya', (req, res) => {
    guard(req, res, 'laporan', 'view');
    const c = ctx(req);
    const taId = req.query.get('ta') || (c.taId || (dbm.activeTahun() || {}).id);
    const ta = db.prepare('SELECT * FROM tahun_ajaran WHERE id=?').get(taId) || {};
    const list = lainnyaList(taId);
    const totalNom = list.reduce((a, x) => a + Number(x.nominal || 0), 0);
    const totalBayar = list.reduce((a, x) => a + Number(x.dibayar || 0), 0);
    const totalSisa = list.reduce((a, x) => a + Number(x.sisa || 0), 0);
    const rekapOrang = dbm.piutangLainnyaRekap(taId);
    const katList = dbm.piutangKategoriList();
    const body = `<p style="font-size:12.5px;text-align:center">Rekapitulasi Piutang Lainnya<br><b>Tahun Ajaran ${esc(ta.nama || '-')}</b></p>
      <div style="font-weight:800;font-size:12px;margin:6px 0 3px">A. REKAP PER KATEGORI</div>
      <table class="doc-tbl"><thead><tr><th style="width:34px">No</th><th>Kategori</th><th style="width:80px">Jumlah Tagihan</th>
        <th style="width:100px">Sisa Piutang</th><th style="width:80px">Tampil Aset</th></tr></thead>
      <tbody>${katList.map((k, i) => `<tr><td class="center">${i + 1}</td><td>${esc(k.nama)}</td><td class="num">${k.jumlah}</td>
        <td class="num">${num(k.sisa)}</td><td class="center">${Number(k.tampil_aset) !== 0 ? 'Ya' : 'Tidak'}</td></tr>`).join('') || '<tr><td colspan="5" class="center">Tidak ada data</td></tr>'}</tbody></table>
      <div style="font-weight:800;font-size:12px;margin:10px 0 3px">B. REKAP PER NAMA</div>
      <table class="doc-tbl"><thead><tr><th style="width:34px">No</th><th>Nama</th><th style="width:80px">Jumlah Tagihan</th>
        <th style="width:92px">Total Piutang</th><th style="width:92px">Sudah Dibayar</th><th style="width:92px">Sisa</th><th style="width:60px">Belum</th></tr></thead>
      <tbody>${rekapOrang.map((x, i) => `<tr><td class="center">${i + 1}</td><td>${esc(x.nama)}</td><td class="num">${x.jumlah}</td>
        <td class="num">${num(x.nominal)}</td><td class="num">${num(x.dibayar)}</td><td class="num">${num(x.sisa)}</td><td class="center">${x.aktif}</td></tr>`).join('') || '<tr><td colspan="7" class="center">Tidak ada data</td></tr>'}</tbody>
      <tfoot><tr><td colspan="2" class="center">TOTAL</td><td class="num">${rekapOrang.reduce((a, x) => a + x.jumlah, 0)}</td>
        <td class="num">${num(totalNom)}</td><td class="num">${num(totalBayar)}</td><td class="num">${num(totalSisa)}</td><td></td></tr></tfoot></table>
      <div style="font-weight:800;font-size:12px;margin:10px 0 3px">C. RINCIAN TAGIHAN</div>
      <table class="doc-tbl"><thead><tr><th style="width:34px">No</th><th>Kategori</th><th>Nama</th><th style="width:82px">Tgl Tagihan</th>
        <th style="width:92px">Nominal</th><th style="width:92px">Sudah Dibayar</th><th style="width:92px">Sisa</th><th style="width:64px">Status</th></tr></thead>
      <tbody>${list.map((x, i) => `<tr><td class="center">${i + 1}</td><td>${esc(x.kategori_nama || '-')}</td><td>${esc(x.nama)}</td><td class="center">${tglID(x.tanggal)}</td>
        <td class="num">${num(x.nominal)}</td><td class="num">${num(x.dibayar)}</td><td class="num">${num(x.sisa)}</td>
        <td class="center">${x.sisa > 0 ? 'Belum' : 'Lunas'}</td></tr>`).join('') || '<tr><td colspan="8" class="center">Tidak ada data</td></tr>'}</tbody>
      <tfoot><tr><td colspan="4" class="center">TOTAL</td><td class="num">${num(totalNom)}</td><td class="num">${num(totalBayar)}</td><td class="num">${num(totalSisa)}</td><td></td></tr></tfoot></table>
      <p style="font-size:11.5px">Sisa piutang lainnya: <b>${rupiah(totalSisa)}</b> (${lib.terbilangRupiah(totalSisa)})</p>
      ${ui.signBlock(c.settings, { tempat: '', tanggal: lib.tglID(todayISO()) })}`;
    res.html(ui.docPage({ settings: c.settings, base: c.base, title: 'Laporan Piutang Lainnya', no: `Tahun Ajaran ${ta.nama || '-'}`, body, backHref: '/laporan?r=lainnya', orient: printcfg.orient(req, dbm, 'laporan_piutang'), selfPath: req.url }));
  });

  get('/cetak/aruskas', (req, res) => {
    guard(req, res, 'laporan', 'view');
    const c = ctx(req);
    const taId = req.query.get('ta') || (c.taId || (dbm.activeTahun() || {}).id);
    const ta = db.prepare('SELECT * FROM tahun_ajaran WHERE id=?').get(taId) || {};
    const bulanSel = monthRange(ta, req.query.get('bulan') || '') ? req.query.get('bulan') : '';
    const pr = qBulans(ta, bulanSel, req.query.get('from'), req.query.get('to'));
    const from = pr.from, to = pr.to;
    const bkuArg = req.query.get('bku') || '';
    const ak = dbm.arusKasData(taId, from, to, bkuArg && bkuArg !== 'all' ? [bkuArg] : []);
    const bkuNama = bkuArg && bkuArg !== 'all' ? ((dbm.allBku(taId).find(x => String(x.id) === String(bkuArg)) || {}).nama || '-') : 'Semua BKU';
    const SEC = [
      ['operasional', 'A. AKTIVITAS OPERASIONAL', 'Penerimaan & pengeluaran rutin sekolah (SPP, BOS, belanja operasional, pajak)'],
      ['investasi', 'B. AKTIVITAS INVESTASI', 'Belanja barang modal / inventaris (kode rekening 5.2.02)'],
      ['pendanaan', 'C. AKTIVITAS PENDANAAN / MUTASI', 'Mutasi kas antar BKU, tarik/setor tunai, administrasi bank, penyesuaian opnam']
    ];
    const orient = printcfg.orient(req, dbm, 'laporan_aruskas');
    let body = `<p style="font-size:11.5px;text-align:center;margin-bottom:8px">Untuk periode ${from ? tglID(from) : 'awal'} s.d. ${to ? tglID(to) : 'akhir'}${bulanSel ? ` (Rincian ${esc(pr.label)})` : ''} · Tahun Ajaran ${esc(ta.nama || '-')} · Target: <b>${esc(bkuNama)}</b></p>
      <table class="doc-tbl"><thead><tr><th>URAIAN</th><th style="width:100px">KAS MASUK</th><th style="width:100px">KAS KELUAR</th></tr></thead><tbody>`;
    for (const [key, label, desc] of SEC) {
      const list = (ak.groups[key] || []).filter(x => Number(x.masuk) || Number(x.keluar));
      const t = ak.totals[key];
      body += `<tr><td colspan="3" style="background:#F1E3D8;font-weight:800">${label}</td></tr>
        <tr><td colspan="3" style="font-size:9.5px;color:#555">${desc}</td></tr>
        ${list.map(x => `<tr><td>${esc(x.kode || '-')} · ${esc(x.nama || '-')}</td>
          <td class="num">${Number(x.masuk) ? num(x.masuk) : ''}</td><td class="num">${Number(x.keluar) ? num(x.keluar) : ''}</td></tr>`).join('')
        || '<tr><td colspan="3" style="text-align:center;color:#777">Tidak ada transaksi</td></tr>'}
        <tr><td><b>Jumlah ${label.replace(/^[A-C]\. /, '')} (neto)</b></td><td class="num">${num(t.masuk)}</td><td class="num">${num(t.keluar)}</td></tr>
        <tr><td><b>Arus Kas Neto</b></td><td colspan="2" class="num"><b>${num(t.net)}</b></td></tr>`;
    }
    body += `<tr><td><b>Saldo Kas Awal Periode</b></td><td colspan="2" class="num"><b>${num(ak.saldoAwal)}</b></td></tr>
      <tr><td><b>Kenaikan (Penurunan) Kas Bersih</b></td><td colspan="2" class="num"><b>${num(ak.kenaikan)}</b></td></tr>
      </tbody><tfoot><tr><td class="center">SALDO KAS AKHIR PERIODE</td><td colspan="2" class="num">${num(ak.saldoAkhir)}</td></tr></tfoot></table>
      <p style="font-size:10.5px">Saldo kas akhir: <b>${rupiah(ak.saldoAkhir)}</b> (${lib.terbilangRupiah(ak.saldoAkhir)})</p>
      ${ui.signBlock(c.settings, { tempat: '', tanggal: lib.tglID(to || todayISO()) })}`;
    res.html(ui.docPage({
      settings: c.settings, base: c.base, title: printcfg.labels(dbm, 'laporan_aruskas').judul || 'Laporan Arus Kas',
      no: `Tahun Ajaran ${ta.nama || '-'}`, body, backHref: '/laporan?r=aruskas',
      orient, selfPath: req.url
    }));
  });

  /* ---------- export excel ---------- */
  function xlsxSend(res, name, sheet, rows, widths) {
    const buf = xlsxBuffer(sheet, rows, widths);
    res.file(buf, name, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }
  const head = settings => [
    [settings.sekolah_nama || 'SEKOLAH'],
    [String(settings.sekolah_alamat || '').replace(/\n/g, ' ')],
    []
  ];

  get('/export/bku', (req, res) => {
    if (!guard(req, res, 'laporan', 'export')) return;
    const c = ctx(req);
    const taId = req.query.get('ta') || c.taId || (dbm.activeTahun() || {}).id;
    const ta = dbm.tahunById(taId);
    const bulanSel = monthRange(ta, req.query.get('bulan') || '') ? req.query.get('bulan') : '';
    const pr = qBulans(ta, bulanSel, req.query.get('from'), req.query.get('to'));
    const bkuArg = req.query.get('bku') || '';
    const d = bkuData(bkuArg === 'all' ? [] : bkuArg, pr.from, pr.to, taId);
    if (!d) return res.notFound();
    const mode = bulanSel ? 'detail' : (['hari', 'bulan', 'tahun'].includes(req.query.get('mode') || '') ? req.query.get('mode') : 'detail');
    const rekap = mode === 'detail' ? null : rekapOf(d.rows, mode, d.opening);
    const bodyRows = rekap
      ? [
        [{ v: mode === 'hari' ? 'Tanggal' : mode === 'bulan' ? 'Bulan' : 'Tahun', bold: true }, { v: 'Jml Trx', bold: true }, { v: 'Penerimaan', bold: true }, { v: 'Pengeluaran', bold: true }, { v: 'Saldo Akhir', bold: true }],
        ['', '', '', 'Saldo Awal', d.opening],
        ...rekap.map(g => [g.label, g.n, g.masuk, g.keluar, g.saldo]),
        [{ v: 'JUMLAH', bold: true }, { v: d.rows.length, bold: true }, { v: d.totalIn, bold: true }, { v: d.totalOut, bold: true }, { v: d.closing, bold: true }]
      ]
      : [
        [{ v: 'No', bold: true }, { v: 'Tanggal', bold: true }, { v: 'No. Bukti', bold: true }, { v: 'Uraian', bold: true }, { v: 'Rekening', bold: true }, { v: 'Penerimaan', bold: true }, { v: 'Pengeluaran', bold: true }, { v: 'Saldo', bold: true }],
        ['', '', '', 'Saldo Awal', '', '', '', d.opening],
        ...d.rows.map((t, i) => [i + 1, tglID(t.tanggal), t.no_bukti || '', t.uraian + (t.nama_pihak ? ' — ' + t.nama_pihak : ''), t.coa_kode || '', t.jenis === 'pemasukan' ? t.nominal : '', t.jenis === 'pengeluaran' ? t.nominal : '', t.saldo]),
        [{ v: 'JUMLAH', bold: true }, '', '', '', '', { v: d.totalIn, bold: true }, { v: d.totalOut, bold: true }, { v: d.closing, bold: true }]
      ];
    const rows = [
      ...head(c.settings),
      [{ v: 'LAPORAN BUKU KAS', bold: true }],
      [`Buku Kas: ${d.bku.nama}`, '', '', `Tahun Ajaran: ${d.bku.ta_nama || '-'}`],
      [`Periode: ${d.from ? tglID(d.from) : 'Awal'} s.d. ${d.to ? tglID(d.to) : 'Akhir'}${bulanSel ? ' (Rincian ' + pr.label + ')' : ''}`, '', '', `Rekap: ${MODE_LABEL[mode]}`],
      [],
      ...bodyRows,
      [],
      [`Saldo akhir: ${rupiah(d.closing)} (${lib.terbilangRupiah(d.closing)})`],
      [],
      ['Mengetahui, Kepala Sekolah', '', '', 'Bendahara'],
      [c.settings.sekolah_kepala || '', '', '', c.settings.sekolah_bendahara || ''],
      [`NIP. ${c.settings.sekolah_nip_kepala || ''}`, '', '', `NIP. ${c.settings.sekolah_nip_bendahara || ''}`]
    ];
    xlsxSend(res, `Laporan-BKU-${(d.bku.nama || 'bku').replace(/[^\w]+/g, '-')}.xlsx`, 'BKU', rows, [6, 14, 18, 46, 12, 16, 16, 16]);
  });

  get('/export/neraca', (req, res) => {
    if (!guard(req, res, 'laporan', 'export')) return;
    const c = ctx(req);
    const taId = req.query.get('ta') || (c.taId || (dbm.activeTahun() || {}).id);
    const ta = db.prepare('SELECT * FROM tahun_ajaran WHERE id=?').get(taId) || {};
    const n = neracaData(taId);
    const aset = n.asetRows;
    const rmode = req.query.get('rmode') === 'bku' ? 'bku' : 'gabung';
    const rows = [...head(c.settings),
    [{ v: 'REKONSILIASI KAS', bold: true }],
    [rmode === 'gabung' ? 'Mode A: Rekap gabungan Kas Tunai & Kas di Bank' : 'Mode B: Rincian saldo per akun BKU'],
    [`Tahun Ajaran: ${ta.nama || '-'}`, '', '', `Per ${tglID(todayISO())}`], [],
    [{ v: 'SALDO DANA BKU', bold: true }, { v: 'JUMLAH', bold: true }, '', { v: 'ASET AKTUAL RIIL', bold: true }, { v: 'JUMLAH', bold: true }]];
    const max = Math.max(n.dana.length, aset.length);
    for (let i = 0; i < max; i++) {
      rows.push([n.dana[i] ? n.dana[i].nama : '', n.dana[i] ? n.dana[i].saldo : '', '', aset[i] ? aset[i][0] : '', aset[i] ? aset[i][1] : '']);
    }
    if (rmode === 'gabung') {
      rows.push([], ['Kas Tunai (gabungan BKU)', n.aset.tunai], ['Kas di Bank (gabungan BKU)', n.aset.bank],
        [{ v: 'Total Kas', bold: true }, { v: n.aset.tunai + n.aset.bank, bold: true }]);
    }
    rows.push([{ v: 'TOTAL SALDO DANA', bold: true }, { v: n.totalDana, bold: true }, '', { v: 'TOTAL ASET RIIL', bold: true }, { v: n.totalAset, bold: true }]);
    rows.push([{ v: 'SELISIH', bold: true }, { v: n.selisih, bold: true }]);
    rows.push([], ['Mengetahui, Kepala Sekolah', '', '', 'Bendahara'], [c.settings.sekolah_kepala || '', '', '', c.settings.sekolah_bendahara || '']);
    xlsxSend(res, `Rekonsiliasi-Kas-TA-${(ta.nama || '').replace('/', '-')}.xlsx`, 'Rekonsiliasi Kas', rows, [40, 18, 3, 34, 18]);
  });

  get('/export/lra', (req, res) => {
    if (!guard(req, res, 'laporan', 'export')) return;
    const c = ctx(req);
    const taId = req.query.get('ta') || (c.taId || (dbm.activeTahun() || {}).id);
    const ta = db.prepare('SELECT * FROM tahun_ajaran WHERE id=?').get(taId) || {};
    const bulanSel = monthRange(ta, req.query.get('bulan') || '') ? req.query.get('bulan') : '';
    const pr = qBulans(ta, bulanSel, req.query.get('from'), req.query.get('to'));
    const l = lraData(taId, bulanSel ? pr.from : '', bulanSel ? pr.to : '');
    const rows = [...head(c.settings),
    [{ v: 'LAPORAN REALISASI ANGGARAN (RAPBS/RKAS)', bold: true }],
    [`Tahun Ajaran: ${ta.nama || '-'}`, '', '', bulanSel ? `Rincian Periode: ${pr.label}` : 'Satu Tahun Penuh'], [],
    [{ v: 'No', bold: true }, { v: 'Kode', bold: true }, { v: 'Uraian Belanja', bold: true }, { v: 'Pagu', bold: true }, { v: 'Realisasi', bold: true }, { v: 'Sisa', bold: true }, { v: '%', bold: true }],
    ...l.rows.map((x, i) => [i + 1, x.kode, x.nama, x.pagu, x.realisasi, x.pagu - x.realisasi, x.pagu ? Number(((x.realisasi / x.pagu) * 100).toFixed(1)) : 0]),
    [{ v: 'JUMLAH', bold: true }, '', '', { v: l.totalPagu, bold: true }, { v: l.totalReal, bold: true }, { v: l.totalPagu - l.totalReal, bold: true }, ''],
    ...(bulanSel ? [[], [{ v: `RINCIAN TRANSAKSI BELANJA — ${pr.label.toUpperCase()}`, bold: true }],
      [{ v: 'No', bold: true }, { v: 'Tanggal', bold: true }, { v: 'No. Bukti', bold: true }, { v: 'Uraian', bold: true }, { v: 'Rekening', bold: true }, { v: 'Buku Kas', bold: true }, { v: 'Nominal', bold: true }],
      ...l.detail.map((t, i) => [i + 1, tglID(t.tanggal), t.no_bukti || '', t.uraian, t.coa_kode || '', t.bku_nama || '', Number(t.nominal || 0)]),
      [{ v: 'JUMLAH', bold: true }, '', '', '', '', '', { v: l.totalDetail, bold: true }]] : []),
    [], ['Mengetahui, Kepala Sekolah', '', '', 'Bendahara'], [c.settings.sekolah_kepala || '', '', '', c.settings.sekolah_bendahara || '']
    ];
    xlsxSend(res, `LRA-TA-${(ta.nama || '').replace('/', '-')}${bulanSel ? '-Rincian-' + bulanSel : ''}.xlsx`, 'LRA', rows, [6, 12, 46, 16, 16, 16, 8]);
  });

  /* ================= TUNGGAKAN PER TINGKAT: cetak & Excel ================= */
  get('/cetak/tunggakan', (req, res) => {
    guard(req, res, 'laporan', 'view');
    const c = ctx(req);
    const taId = Number(req.query.get('ta') || c.taId || (dbm.activeTahun() || {}).id) || null;
    const ta = taId ? dbm.tahunById(taId) : null;
    const tf = tingkatKelasFilter(req);
    const tg = tunggakanData(taId, tf.tingkat, tf.kelas);
    const filterTxt = [
      tf.tingkat.length ? 'Tingkat: ' + tf.tingkat.map(x => dbm.tingkatLabel(x)).join(', ') : 'Semua tingkat',
      tf.kelas.length ? tf.kelas.length + ' kelas dipilih' : 'Semua kelas'
    ].join(' · ');
    const body = `${ui.kop(c.settings)}
      <div class="doc-title"><h3>REKAPITULASI TUNGGAKAN IURAN SISWA</h3>
        <div class="no">Tahun Pelajaran ${esc(ta ? ta.nama : '-')} · ${esc(filterTxt)}</div></div>
      <table class="tbl"><thead><tr><th>Tingkat</th><th class="num">Siswa</th><th class="num">Tagihan</th><th class="num">Dibayar</th><th class="num">Tunggakan</th></tr></thead><tbody>
        ${tg.byTingkat.map(x => `<tr><td>${esc(dbm.tingkatLabel(x.tingkat === '(tanpa tingkat)' ? '' : x.tingkat))}</td>
          <td class="num">${x.siswa}</td><td class="num">${num(x.tagihan)}</td><td class="num">${num(x.dibayar)}</td><td class="num">${num(x.sisa)}</td></tr>`).join('')}
      </tbody><tfoot><tr><td>TOTAL</td><td class="num">${tg.total.siswa}</td><td class="num">${num(tg.total.tagihan)}</td>
        <td class="num">${num(tg.total.dibayar)}</td><td class="num">${num(tg.total.sisa)}</td></tr></tfoot></table>
      <div class="t-strong" style="margin:4mm 0 1.5mm">RINCIAN PER KELAS</div>
      <table class="tbl"><thead><tr><th>Tingkat</th><th>Kelas</th><th class="num">Siswa</th><th class="num">Tagihan</th><th class="num">Dibayar</th><th class="num">Tunggakan</th></tr></thead><tbody>
        ${tg.byKelas.map(x => `<tr><td>${esc(dbm.tingkatLabel(x.tingkat === '(tanpa tingkat)' ? '' : x.tingkat))}</td>
          <td>${esc(x.kelas)}</td><td class="num">${x.siswa}</td><td class="num">${num(x.tagihan)}</td>
          <td class="num">${num(x.dibayar)}</td><td class="num">${num(x.sisa)}</td></tr>`).join('')}
      </tbody></table>
      ${ui.signBlock(c.settings, { tanggal: tglID(new Date().toISOString().slice(0, 10)) })}`;
    res.html(ui.printPage({
      settings: c.settings, base: c.base, title: 'Rekapitulasi Tunggakan per Tingkat',
      body, backHref: '/laporan?r=tunggakan&ta=' + (taId || ''), backLabel: 'Kembali ke Laporan',
      orient: printcfg.orient(req, dbm, 'laporan'), selfPath: req.url
    }));
  });

  get('/export/tunggakan', (req, res) => {
    if (!guard(req, res, 'laporan', 'export')) return;
    const c = ctx(req);
    const taId = Number(req.query.get('ta') || c.taId || (dbm.activeTahun() || {}).id) || null;
    const ta = taId ? dbm.tahunById(taId) : null;
    const tf = tingkatKelasFilter(req);
    const tg = tunggakanData(taId, tf.tingkat, tf.kelas);
    const rows = [...head(c.settings),
      [{ v: 'REKAPITULASI TUNGGAKAN IURAN SISWA', bold: true }],
      [`Tahun Pelajaran: ${ta ? ta.nama : '-'}`, '', tf.tingkat.length ? 'Tingkat: ' + tf.tingkat.map(x => dbm.tingkatLabel(x)).join(', ') : 'Semua tingkat'], [],
      [{ v: 'A. REKAP PER TINGKAT', bold: true }],
      [{ v: 'Tingkat', bold: true }, { v: 'Siswa', bold: true }, { v: 'Tagihan', bold: true }, { v: 'Dibayar', bold: true }, { v: 'Tunggakan', bold: true }],
      ...tg.byTingkat.map(x => [dbm.tingkatLabel(x.tingkat === '(tanpa tingkat)' ? '' : x.tingkat), x.siswa, x.tagihan, x.dibayar, x.sisa]),
      [{ v: 'TOTAL', bold: true }, { v: tg.total.siswa, bold: true }, { v: tg.total.tagihan, bold: true }, { v: tg.total.dibayar, bold: true }, { v: tg.total.sisa, bold: true }],
      [],
      [{ v: 'B. REKAP PER KELAS', bold: true }],
      [{ v: 'Tingkat', bold: true }, { v: 'Kelas', bold: true }, { v: 'Siswa', bold: true }, { v: 'Tagihan', bold: true }, { v: 'Dibayar', bold: true }, { v: 'Tunggakan', bold: true }],
      ...tg.byKelas.map(x => [dbm.tingkatLabel(x.tingkat === '(tanpa tingkat)' ? '' : x.tingkat), x.kelas, x.siswa, x.tagihan, x.dibayar, x.sisa]),
      [], ['Mengetahui, Kepala Sekolah', '', '', 'Bendahara'], [c.settings.sekolah_kepala || '', '', '', c.settings.sekolah_bendahara || '']
    ];
    xlsxSend(res, `Tunggakan-Tingkat-TA-${String(ta ? ta.nama : '').replace('/', '-')}.xlsx`, 'Tunggakan per Tingkat', rows, [16, 22, 10, 16, 16, 16]);
  });

  get('/export/piutang', (req, res) => {
    if (!guard(req, res, 'laporan', 'export')) return;
    const c = ctx(req);
    const taId = req.query.get('ta') || (c.taId || (dbm.activeTahun() || {}).id);
    const ta = db.prepare('SELECT * FROM tahun_ajaran WHERE id=?').get(taId) || {};
    const p = piutangList(taId);
    const pm = ['detail', 'tanggal'].includes(req.query.get('pmode') || '') ? req.query.get('pmode') : 'orang';
    const rekapP = piutangRekap(p, pm);
    const sppList = sppData(taId);
    const beasiswaTa = dbm.beasiswaTotal(taId);
    const tunggakanSpp = Math.max(0, sppList.reduce((a, x) => a + x.total_ditagihkan, 0) - sppList.reduce((a, x) => a + x.total_diterima, 0) - beasiswaTa);
    const rekapRows = rekapP
      ? [
        [{ v: `A. ${PIUTANG_MODES[pm].toUpperCase()}`, bold: true }],
        [{ v: 'No', bold: true }, { v: pm === 'orang' ? 'Nama Pegawai' : 'Tanggal Tagihan', bold: true }, { v: 'Jml Piutang', bold: true }, { v: 'Total Nominal', bold: true }, { v: 'Sudah Dicicil', bold: true }, { v: 'Sisa', bold: true }],
        ...rekapP.map((g2, i) => [i + 1, g2.nama, g2.jumlah, g2.nominal, g2.dibayar, g2.sisa]),
        [{ v: 'TOTAL', bold: true }, { v: p.length, bold: true }, '', { v: p.reduce((a, x) => a + Number(x.nominal || 0), 0), bold: true }, { v: p.reduce((a, x) => a + Number(x.dibayar || 0), 0), bold: true }, { v: p.filter(x => x.sisa > 0).reduce((a, x) => a + x.sisa, 0), bold: true }]
      ]
      : [
        [{ v: 'A. REKAP PIUTANG PEGAWAI', bold: true }],
        [{ v: 'No', bold: true }, { v: 'Nama Pegawai', bold: true }, { v: 'Tgl Utang', bold: true }, { v: 'Nominal', bold: true }, { v: 'Sudah Dicicil', bold: true }, { v: 'Sisa', bold: true }, { v: 'Status', bold: true }],
        ...p.map((x, i) => [i + 1, x.nama_pegawai, tglID(x.tanggal_utang), x.nominal, x.dibayar, x.sisa, x.status === 'lunas' ? 'Lunas' : 'Belum Lunas']),
        [{ v: 'TOTAL', bold: true }, '', '', { v: p.reduce((a, x) => a + x.nominal, 0), bold: true }, { v: p.reduce((a, x) => a + x.dibayar, 0), bold: true }, { v: p.filter(x => x.status === 'belum').reduce((a, x) => a + x.sisa, 0), bold: true }]
      ];
    const rows = [...head(c.settings),
    [{ v: 'LAPORAN PIUTANG & TAGIHAN SPP', bold: true }],
    [`Tahun Ajaran: ${ta.nama || '-'}`, '', '', `Mode: ${PIUTANG_MODES[pm]}`], [],
    ...rekapRows,
    [],
    [{ v: 'B. REKAP SPP BULANAN', bold: true }],
    [{ v: 'Bulan', bold: true }, { v: 'Ditagihkan', bold: true }, { v: 'Diterima', bold: true }, { v: 'Tunggakan', bold: true }],
    ...sppList.map(x => [x.nama, x.total_ditagihkan, x.total_diterima, x.total_ditagihkan - x.total_diterima]),
    [{ v: 'Beasiswa SPP aktif', bold: true }, { v: beasiswaTa, bold: true }],
    [{ v: 'TOTAL TUNGGAKAN SETELAH BEASISWA', bold: true }, '', '', { v: tunggakanSpp, bold: true }],
    ...[[], ['Mengetahui, Kepala Sekolah', '', '', 'Bendahara'], [c.settings.sekolah_kepala || '', '', '', c.settings.sekolah_bendahara || '']]
    ];
    xlsxSend(res, `Piutang-SPP-TA-${(ta.nama || '').replace('/', '-')}${pm !== 'detail' ? '-' + pm : ''}.xlsx`, 'Piutang', rows, [34, 32, 16, 16, 16, 16]);
  });

  get('/export/sertifikasi', (req, res) => {
    if (!guard(req, res, 'laporan', 'export')) return;
    const c = ctx(req);
    const taId = req.query.get('ta') || (c.taId || (dbm.activeTahun() || {}).id);
    const ta = db.prepare('SELECT * FROM tahun_ajaran WHERE id=?').get(taId) || {};
    const list = sertifikasiList(taId);
    const totalNom = list.reduce((a, x) => a + Number(x.nominal || 0), 0);
    const totalBayar = list.reduce((a, x) => a + Number(x.dibayar || 0), 0);
    const totalSisa = list.reduce((a, x) => a + Number(x.sisa || 0), 0);
    const rekapOrang = dbm.sertifikasiRekap(taId);
    const rows = [...head(c.settings),
    [{ v: 'LAPORAN PIUTANG LAIN-LAIN (SERTIFIKASI)', bold: true }],
    [`Tahun Ajaran: ${ta.nama || '-'}`], [],
    [{ v: 'A. REKAP PER PEGAWAI', bold: true }],
    [{ v: 'No', bold: true }, { v: 'Nama Pegawai', bold: true }, { v: 'Jumlah Tagihan', bold: true }, { v: 'Total Piutang', bold: true },
      { v: 'Sudah Dibayar', bold: true }, { v: 'Sisa Piutang', bold: true }, { v: 'Belum Lunas', bold: true }],
    ...rekapOrang.map((x, i) => [i + 1, x.nama, x.jumlah, Number(x.nominal || 0), Number(x.dibayar || 0), Number(x.sisa || 0), x.aktif]),
    [{ v: 'TOTAL', bold: true }, '', rekapOrang.reduce((a, x) => a + x.jumlah, 0), { v: totalNom, bold: true }, { v: totalBayar, bold: true }, { v: totalSisa, bold: true }, ''],
    [],
    [{ v: 'B. RINCIAN TAGIHAN', bold: true }],
    [{ v: 'No', bold: true }, { v: 'Nama Pegawai', bold: true }, { v: 'Tgl Tagihan', bold: true }, { v: 'Nominal', bold: true },
      { v: 'Sudah Dibayar', bold: true }, { v: 'Sisa', bold: true }, { v: 'Status', bold: true }, { v: 'Keterangan', bold: true }],
    ...list.map((x, i) => [i + 1, x.nama, tglID(x.tanggal), Number(x.nominal || 0), Number(x.dibayar || 0), Number(x.sisa || 0), x.sisa > 0 ? 'Belum Lunas' : 'Lunas', x.keterangan || '']),
    [{ v: 'TOTAL', bold: true }, '', '', { v: totalNom, bold: true }, { v: totalBayar, bold: true }, { v: totalSisa, bold: true }],
    [], [`Sisa piutang sertifikasi: ${rupiah(totalSisa)} (${lib.terbilangRupiah(totalSisa)})`],
    [], ['Mengetahui, Kepala Sekolah', '', '', 'Bendahara'], [c.settings.sekolah_kepala || '', '', '', c.settings.sekolah_bendahara || ''],
    [`NIP. ${c.settings.sekolah_nip_kepala || ''}`, '', '', `NIP. ${c.settings.sekolah_nip_bendahara || ''}`]
    ];
    xlsxSend(res, `Piutang-Sertifikasi-TA-${(ta.nama || '').replace('/', '-')}.xlsx`, 'Sertifikasi', rows, [6, 30, 16, 16, 16, 16, 14, 36]);
  });

  get('/export/lainnya', (req, res) => {
    if (!guard(req, res, 'laporan', 'export')) return;
    const c = ctx(req);
    const taId = req.query.get('ta') || (c.taId || (dbm.activeTahun() || {}).id);
    const ta = db.prepare('SELECT * FROM tahun_ajaran WHERE id=?').get(taId) || {};
    const list = lainnyaList(taId);
    const totalNom = list.reduce((a, x) => a + Number(x.nominal || 0), 0);
    const totalBayar = list.reduce((a, x) => a + Number(x.dibayar || 0), 0);
    const totalSisa = list.reduce((a, x) => a + Number(x.sisa || 0), 0);
    const rekapOrang = dbm.piutangLainnyaRekap(taId);
    const katList = dbm.piutangKategoriList();
    const rows = [...head(c.settings),
    [{ v: 'LAPORAN PIUTANG LAINNYA', bold: true }],
    [`Tahun Ajaran: ${ta.nama || '-'}`], [],
    [{ v: 'A. REKAP PER KATEGORI', bold: true }],
    [{ v: 'Kategori', bold: true }, { v: 'Jumlah Tagihan', bold: true }, { v: 'Sisa Piutang', bold: true }, { v: 'Tampil di Aset Riil', bold: true }],
    ...katList.map(k => [k.nama, k.jumlah, Number(k.sisa || 0), Number(k.tampil_aset) !== 0 ? 'Ya' : 'Tidak']),
    [],
    [{ v: 'B. REKAP PER NAMA', bold: true }],
    [{ v: 'No', bold: true }, { v: 'Nama', bold: true }, { v: 'Jumlah Tagihan', bold: true }, { v: 'Total Piutang', bold: true },
      { v: 'Sudah Dibayar', bold: true }, { v: 'Sisa Piutang', bold: true }, { v: 'Belum Lunas', bold: true }],
    ...rekapOrang.map((x, i) => [i + 1, x.nama, x.jumlah, Number(x.nominal || 0), Number(x.dibayar || 0), Number(x.sisa || 0), x.aktif]),
    [{ v: 'TOTAL', bold: true }, '', rekapOrang.reduce((a, x) => a + x.jumlah, 0), { v: totalNom, bold: true }, { v: totalBayar, bold: true }, { v: totalSisa, bold: true }, ''],
    [],
    [{ v: 'C. RINCIAN TAGIHAN', bold: true }],
    [{ v: 'No', bold: true }, { v: 'Kategori', bold: true }, { v: 'Nama', bold: true }, { v: 'Tgl Tagihan', bold: true }, { v: 'Nominal', bold: true },
      { v: 'Sudah Dibayar', bold: true }, { v: 'Sisa', bold: true }, { v: 'Status', bold: true }, { v: 'Keterangan', bold: true }],
    ...list.map((x, i) => [i + 1, x.kategori_nama || '', x.nama, tglID(x.tanggal), Number(x.nominal || 0), Number(x.dibayar || 0), Number(x.sisa || 0), x.sisa > 0 ? 'Belum Lunas' : 'Lunas', x.keterangan || '']),
    [{ v: 'TOTAL', bold: true }, '', '', '', { v: totalNom, bold: true }, { v: totalBayar, bold: true }, { v: totalSisa, bold: true }],
    [], [`Sisa piutang lainnya: ${rupiah(totalSisa)} (${lib.terbilangRupiah(totalSisa)})`],
    [], ['Mengetahui, Kepala Sekolah', '', '', 'Bendahara'], [c.settings.sekolah_kepala || '', '', '', c.settings.sekolah_bendahara || ''],
    [`NIP. ${c.settings.sekolah_nip_kepala || ''}`, '', '', `NIP. ${c.settings.sekolah_nip_bendahara || ''}`]
    ];
    xlsxSend(res, `Piutang-Lainnya-TA-${(ta.nama || '').replace('/', '-')}.xlsx`, 'Piutang Lainnya', rows, [24, 6, 30, 14, 16, 16, 16, 14, 36]);
  });

  get('/export/pembantu', (req, res) => {
    if (!guard(req, res, 'laporan', 'export')) return;
    const c = ctx(req);
    const key = PEMBANTU.some(p => p.key === req.query.get('p')) ? req.query.get('p') : 'tunai';
    const taId = req.query.get('ta') || c.taId || (dbm.activeTahun() || {}).id;
    const ta = dbm.tahunById(taId) || {};
    const bulanSel = monthRange(ta, req.query.get('bulan') || '') ? req.query.get('bulan') : '';
    const pr = qBulans(ta, bulanSel, req.query.get('from'), req.query.get('to'));
    const pbku = (req.query.getAll ? req.query.getAll('bku') : []).map(Number).filter(Boolean);
    const pb = pembantuData(key, pr.from, pr.to, taId, pbku);
    const rows = [
      ...head(c.settings),
      [{ v: (pb.cfg.label || '').toUpperCase(), bold: true }],
      [`Tahun Ajaran: ${ta.nama || '-'}`, '', '', `Periode: ${pr.from ? tglID(pr.from) : 'Awal'} s.d. ${pr.to ? tglID(pr.to) : 'Akhir'}${bulanSel ? ' (Rincian ' + pr.label + ')' : ''}`],
      [`Target BKU: ${pbku.length ? pbku.map(id => (dbm.allBku(taId).find(x => Number(x.id) === Number(id)) || {}).nama || '-').join(', ') : 'Semua BKU'}`],
      [],
      [{ v: 'No', bold: true }, { v: 'Tanggal', bold: true }, { v: 'No. Bukti', bold: true }, { v: 'Buku Kas', bold: true },
        { v: 'Uraian', bold: true }, { v: 'Rekening', bold: true }, { v: 'Masuk', bold: true }, { v: 'Keluar', bold: true }, { v: 'Saldo', bold: true }],
      ['', '', '', '', 'Saldo Awal', '', '', '', pb.opening],
      ...pb.rows.map(t => [t.no, tglID(t.tanggal), t.no_bukti || '', t.bku_nama || '', t.uraian || '',
        (t.coa_kode || '') + ' ' + (t.coa_nama || ''), t.jenis === 'pemasukan' ? Number(t.nominal || 0) : '',
        t.jenis === 'pengeluaran' ? Number(t.nominal || 0) : '', Number(t.saldo || 0)]),
      [{ v: 'JUMLAH', bold: true }, '', '', '', '', '', { v: pb.totalIn, bold: true }, { v: pb.totalOut, bold: true }, { v: pb.closing, bold: true }],
      [], ['Mengetahui, Kepala Sekolah', '', '', 'Bendahara'], [c.settings.sekolah_kepala || '', '', '', c.settings.sekolah_bendahara || '']
    ];
    xlsxSend(res, `${(pb.cfg.label || 'Buku-Pembantu').replace(/[^\w]+/g, '-')}${bulanSel ? '-' + bulanSel : ''}.xlsx`,
      'Buku Pembantu', rows, [5, 14, 18, 24, 46, 26, 16, 16, 16]);
  });

  get('/export/aruskas', (req, res) => {
    if (!guard(req, res, 'laporan', 'export')) return;
    const c = ctx(req);
    const taId = req.query.get('ta') || (c.taId || (dbm.activeTahun() || {}).id);
    const ta = db.prepare('SELECT * FROM tahun_ajaran WHERE id=?').get(taId) || {};
    const bulanSel = monthRange(ta, req.query.get('bulan') || '') ? req.query.get('bulan') : '';
    const pr = qBulans(ta, bulanSel, req.query.get('from'), req.query.get('to'));
    const from = pr.from, to = pr.to;
    const bkuArg = req.query.get('bku') || '';
    const ak = dbm.arusKasData(taId, from, to, bkuArg && bkuArg !== 'all' ? [bkuArg] : []);
    const bkuNama = bkuArg && bkuArg !== 'all' ? ((dbm.allBku(taId).find(x => String(x.id) === String(bkuArg)) || {}).nama || '-') : 'Semua BKU';
    const SEC = [['operasional', 'A. AKTIVITAS OPERASIONAL'], ['investasi', 'B. AKTIVITAS INVESTASI'], ['pendanaan', 'C. AKTIVITAS PENDANAAN / MUTASI']];
    const rows = [...head(c.settings),
    [{ v: 'LAPORAN ARUS KAS (CASH FLOW)', bold: true }],
    [`Tahun Ajaran: ${ta.nama || '-'}`, '', '', `Periode: ${from ? tglID(from) : 'Awal'} s.d. ${to ? tglID(to) : 'Akhir'}${bulanSel ? ' (Rincian ' + pr.label + ')' : ''}`],
    [`Target BKU: ${bkuNama}`], [],
    [{ v: 'Uraian', bold: true }, { v: 'Kas Masuk', bold: true }, { v: 'Kas Keluar', bold: true }]];
    for (const [key, label] of SEC) {
      const list = (ak.groups[key] || []).filter(x => Number(x.masuk) || Number(x.keluar));
      rows.push([{ v: label, bold: true }]);
      for (const x of list) rows.push([`${x.kode || '-'} · ${x.nama || '-'}`, x.masuk || '', x.keluar || '']);
      rows.push([{ v: 'Jumlah (neto)', bold: true }, { v: ak.totals[key].masuk, bold: true }, { v: ak.totals[key].keluar, bold: true }]);
      rows.push([{ v: 'Arus Kas Neto', bold: true }, { v: ak.totals[key].net, bold: true }]);
    }
    rows.push([], [{ v: 'Saldo Kas Awal Periode', bold: true }, { v: ak.saldoAwal, bold: true }],
      [{ v: 'Kenaikan (Penurunan) Kas Bersih', bold: true }, { v: ak.kenaikan, bold: true }],
      [{ v: 'SALDO KAS AKHIR PERIODE', bold: true }, { v: ak.saldoAkhir, bold: true }],
      [], ['Mengetahui, Kepala Sekolah', '', '', 'Bendahara'], [c.settings.sekolah_kepala || '', '', '', c.settings.sekolah_bendahara || '']);
    xlsxSend(res, `Arus-Kas-TA-${(ta.nama || '').replace('/', '-')}.xlsx`, 'Arus Kas', rows, [52, 18, 18]);
  });
};
