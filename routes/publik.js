'use strict';
const QRCode = require('qrcode');
/* ==========================================================================
   DOMAIN PUBLIK (tanpa login) — tautan acak untuk transparansi:
     · /<nama-sekolah>/publik/bku/<token>    → rincian BKU, transaksi + penerimaan Grup Iuran terhubung
     · /<nama-sekolah>/publik/iuran/<token>  → rekap satu Grup Iuran + siswa
   Halaman hanya dilayani bila sakelar `is_public` = 1 DAN token persis sama
   dengan yang tersimpan (dbm.publicFind). Token tidak dapat ditebak
   (24 hex = 96 bit) sehingga tautan tidak bisa dipindai/ditebak.

   FILTER (semua server-side, parameter GET — halaman tetap bisa dibagikan):
     BKU   : ?bulan=YYYY-MM · ?from=YYYY-MM-DD&to=YYYY-MM-DD · ?ta=<id> (tahun pelajaran
             lain dengan BKU bernama SAMA yang juga dibagikan publik)
     Iuran : ?q=<nama/NISN> · ?kelas=<nama kelas>
   ========================================================================== */
module.exports = ({ get, dbm, lib, ui, ctx }) => {
  const { db } = dbm;
  const { esc, rupiah, tglID } = lib;
  const PER_HAL = 60;
  const NAMA_BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

  const settings = () => dbm.settingsAll();
  const isYm = v => /^\d{4}-\d{2}$/.test(String(v || ''));
  const isYmd = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  /** label "Agustus 2026" untuk periode YYYY-MM */
  const labelYm = ym => {
    const s = String(ym || '');
    if (!isYm(s)) return s || '-';
    return `${NAMA_BULAN[Number(s.slice(5, 7)) - 1] || '-'} ${s.slice(0, 4)}`;
  };
  const lastDayOfYm = ym => {
    const [y, m] = String(ym).split('-').map(Number);
    const d = new Date(y, m, 0);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const qstr = params => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) if (v !== '' && v !== undefined && v !== null) u.append(k, v);
    return u.toString();
  };

  /** kerangka halaman publik (gaya sama dengan portal orang tua) */
  function shell({ base, settings: st, judul, subtitle, content }) {
    const logo = st.sekolah_logo
      ? `<img src="${esc(st.sekolah_logo)}"${ui.logoSrcset ? ui.logoSrcset(st, '52px') : ''} alt="Logo" width="52" height="52" fetchpriority="high" decoding="async">`
      : `<div class="p-logo-ph">${esc((st.sekolah_nama || 'S').charAt(0))}</div>`;
    const footer = ui.identitasFooter ? ui.identitasFooter(st) : '';
    return `<!DOCTYPE html><html lang="id" data-mode="${ui.modeOf ? ui.modeOf(st) : 'light'}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(judul)} · ${esc(st.sekolah_nama || 'Sekolah')}</title>
<meta name="robots" content="noindex,nofollow">
<meta name="description" content="${esc(subtitle || '')}">
${ui.fontLinks ? ui.fontLinks() : ''}
${ui.logoPreconnect ? ui.logoPreconnect([st.sekolah_logo]) : ''}
<link rel="stylesheet" href="${base}/assets/app.css?v=${ui.ASSET_V}">
<link rel="icon" href="${base}/favicon.ico">
<meta name="theme-color" content="#F97316">
</head><body class="portal-body">
<div class="portal-wrap">
  <header class="portal-head">
    ${logo}
    <div class="banner-text">
      <h1 class="school-title">${esc(st.sekolah_nama || 'Sekolah')}</h1>
      <p class="portal-subtitle">${esc(subtitle || 'Halaman Publik Transparansi Keuangan')}</p>
    </div>
  </header>
  ${content}
  <footer class="portal-foot">© ${new Date().getFullYear()} ${esc(st.sekolah_nama || '')}${footer ? ' · ' + esc(footer) : ''}<br>
    Halaman ini dibagikan sekolah melalui tautan acak untuk transparansi dan tidak dapat diubah dari sini.</footer>
</div>
<script src="${base}/assets/app.js?v=${ui.ASSET_V}" defer></script>
</body></html>`;
  }

  /** halaman 404 ber-branding untuk token salah / tautan dimatikan */
  function tidakDitemukan(base, st, jenis) {
    const body = `<div class="portal-card" style="text-align:center">
      <div style="font-size:52px;font-weight:800;color:var(--o-500);line-height:1;letter-spacing:-.05em">404</div>
      <h2 style="margin:8px 0 6px">Tautan Publik Tidak Aktif</h2>
      <p class="muted" style="line-height:1.7;margin:0 auto 6px;max-width:460px">
        Tautan ${esc(jenis)} ini tidak ditemukan atau sudah <b>dinonaktifkan</b> oleh sekolah.
        Tautan lama otomatis berhenti berlaku setiap kali sekolah membuat tautan baru.</p>
      <p class="help" style="margin-top:14px">Hubungi bendahara sekolah untuk memperoleh tautan terbaru.</p>
    </div>`;
    return shell({
      base, settings: st, judul: 'Tautan Tidak Aktif',
      subtitle: 'Halaman Publik Transparansi Keuangan', content: body
    });
  }

  function badgeStatus(status) {
    const map = {
      lunas: ['Lunas', 'green'], sebagian: ['Sebagian', 'amber'], belum: ['Belum Bayar', 'red'],
      pemutihan: ['Pemutihan', 'blue'], tak_tertagih: ['Tak Tertagih', 'gray']
    };
    const [label, tone] = map[status] || [status || '-', 'gray'];
    return ui.badge(label, tone);
  }

  /* ======================= BKU: transaksi publik ======================= */
  get('/publik/bku/:token', (req, res) => {
    const st = settings();
    const base = req.BASE;
    const b = dbm.publicFind('bku', req.params.token);
    if (!b) return res.html(tidakDitemukan(base, st, 'BKU'), 404);
    const slugBase = dbm.portalSlugs().base;
    const qp = k => String(req.query.get(k) || '').trim();

    /* ---------- filter tahun pelajaran ----------
       BKU terikat pada satu tahun pelajaran. Agar tetap bisa menelusuri tahun
       lain, filter TA berpindah ke BKU dengan NAMA SAMA yang juga dibagikan
       publik — BKU non-publik tidak pernah ditampilkan. */
    const taList = (() => { try { return dbm.allTahun(); } catch (e) { return []; } })();
    const shared = taList.map(t => ({
      ta: t,
      row: db.prepare(`SELECT * FROM bku WHERE tahun_ajaran_id=? AND lower(trim(nama))=lower(trim(?))
        AND COALESCE(is_public,0)=1 AND COALESCE(public_token,'')<>'' ORDER BY id LIMIT 1`).get(t.id, b.nama)
    })).filter(x => x.row);
    const bkuHref = (row, params) => {
      const s = qstr(params);
      return `${base}/${slugBase}/publik/bku/${row.public_token}${s ? '?' + s : ''}`;
    };
    const taParam = Number(qp('ta') || 0) || 0;
    let taNotice = '';
    if (taParam && taParam !== Number(b.tahun_ajaran_id)) {
      const target = shared.find(x => Number(x.ta.id) === taParam);
      if (target) {
        return res.redirect(bkuHref(target.row, { bulan: qp('bulan'), from: qp('from'), to: qp('to') }), 302);
      }
      const tNama = (taList.find(t => Number(t.id) === taParam) || {}).nama || '';
      taNotice = `BKU <b>${esc(b.nama)}</b> belum dibagikan publik pada Tahun Pelajaran ${esc(tNama || '-')}.`;
    }
    const ta = db.prepare('SELECT * FROM tahun_ajaran WHERE id=?').get(b.tahun_ajaran_id) || {};
    const linkedIuran = dbm.bkuIuranGroups(b.id);
    const linkedIuranRows = linkedIuran.length
      ? dbm.iuranTagihanRows({ grupId: linkedIuran.map(g => Number(g.id)) }) : [];
    const linkedIuranTotals = new Map(linkedIuran.map(g => [Number(g.id), { tagihan: 0, diterima: 0, sisa: 0 }]));
    for (const row of linkedIuranRows) {
      const gid = Number(row.grup_id);
      const total = linkedIuranTotals.get(gid);
      if (!total) continue;
      total.tagihan += Number(row.nominal || 0);
      total.diterima += Number(row.kas_diterima || 0);
      total.sisa += Number(row.sisa || 0);
    }
    const linkedIuranSummary = [...linkedIuranTotals.values()].reduce((sum, group) => ({
      tagihan: sum.tagihan + group.tagihan,
      diterima: sum.diterima + group.diterima,
      sisa: sum.sisa + group.sisa
    }), { tagihan: 0, diterima: 0, sisa: 0 });
    const usesIuranSaldo = b.jenis === 'kegiatan';
    const includeActivityIncomes = usesIuranSaldo && dbm.bkuIncomeEnabled(b.id);
    const hideActivityIncomes = usesIuranSaldo && !includeActivityIncomes;

    /* ---------- filter periode (bulan / rentang tanggal) ---------- */
    const bulan = isYm(qp('bulan')) ? qp('bulan') : '';
    let from = isYmd(qp('from')) ? qp('from') : '';
    let to = isYmd(qp('to')) ? qp('to') : '';
    if (bulan) { from = bulan + '-01'; to = lastDayOfYm(bulan); }
    if (from && to && from > to) { const tmp = from; from = to; to = tmp; }
    const filterAktif = !!(bulan || from || to);

    const semua = db.prepare(`SELECT t.*,
        CASE WHEN EXISTS (SELECT 1 FROM iuran_bayar p WHERE p.transaksi_id=t.id) THEN 1 ELSE 0 END iuran_source
        FROM transaksi t
        WHERE t.bku_id=? AND t.status='posted' ORDER BY t.tanggal, t.id`).all(b.id);
    /* Hanya BKU Kegiatan memakai saldo grup iuran dan mengabaikan pemasukan biasa. */
    const saldoSumber = Number(b.saldo_awal || 0)
      + (usesIuranSaldo ? linkedIuranSummary.diterima : 0);
    let run = saldoSumber;
    const berjalan = semua.map(t => {
      if (t.jenis === 'pengeluaran') run -= Number(t.nominal || 0);
      else if (!usesIuranSaldo || Number(t.is_penyesuaian) === 1
        || (includeActivityIncomes && Number(t.iuran_source) !== 1)) run += Number(t.nominal || 0);
      return { ...t, saldo: run };
    });
    const signed = t => (t.jenis === 'pemasukan' ? 1 : -1) * Number(t.nominal || 0);
    const cocok = t => (!from || String(t.tanggal) >= from) && (!to || String(t.tanggal) <= to);
    const visible = hideActivityIncomes
      ? berjalan.filter(t => t.jenis !== 'pemasukan' || Number(t.is_penyesuaian) === 1)
      : usesIuranSaldo
        ? berjalan.filter(t => t.jenis !== 'pemasukan' || Number(t.is_penyesuaian) === 1 || Number(t.iuran_source) !== 1)
      : berjalan;
    const hasil = visible.filter(cocok);
    const masukPeriode = hasil.filter(t => t.jenis === 'pemasukan').reduce((s, t) => s + Number(t.nominal || 0), 0);
    const masukPenyesuaian = hasil.filter(t => t.jenis === 'pemasukan' && Number(t.is_penyesuaian) === 1)
      .reduce((s, t) => s + Number(t.nominal || 0), 0);
    const keluarPeriode = hasil.filter(t => t.jenis === 'pengeluaran').reduce((s, t) => s + Number(t.nominal || 0), 0);
    /* Saldo pembuka BKU Kegiatan menggabungkan saldo manual dan grup; pemasukan biasa diabaikan. */
    const saldoAwalPeriode = from
      ? saldoSumber + semua.filter(t => String(t.tanggal) < from)
        .reduce((s, t) => s + (usesIuranSaldo
          ? (t.jenis === 'pengeluaran' ? -Number(t.nominal || 0)
            : Number(t.is_penyesuaian) === 1 ? Number(t.nominal || 0) : 0)
          : signed(t)), 0)
        + (includeActivityIncomes ? dbm.bkuRegularIncome(b.id, { before: from }) : 0)
      : saldoSumber;
    const saldoAkhirPeriode = saldoAwalPeriode
      + masukPeriode - keluarPeriode;
    const masukInfoPeriode = usesIuranSaldo ? masukPeriode - masukPenyesuaian : masukPeriode;

    const totalHal = Math.max(1, Math.ceil(hasil.length / PER_HAL));
    const hal = Math.min(totalHal, Math.max(1, Number(qp('hal') || 1) || 1));
    const rows = hasil.slice((hal - 1) * PER_HAL, hal * PER_HAL);
    const showLedger = hasil.length > 0 || saldoAwalPeriode !== 0;
    const linkKe = (row, n) => bkuHref(row, { bulan, from, to, hal: n > 1 ? n : '' });

    /* pilihan bulan = bulan yang benar-benar punya transaksi (terbaru di atas) */
    const bulanOpsi = [...new Set(visible.map(t => String(t.tanggal || '').slice(0, 7)).filter(isYm))].sort().reverse();
    const ringkasFilter = [
      bulan ? `Bulan <b>${esc(labelYm(bulan))}</b>` : '',
      (!bulan && (from || to)) ? `Tanggal <b>${from ? esc(tglID(from)) : '…'} s.d. ${to ? esc(tglID(to)) : '…'}</b>` : ''
    ].filter(Boolean).join(' · ');

    const filterBar = `<form method="get" action="${base}/${slugBase}/publik/bku/${esc(b.public_token)}" class="portal-period" data-bku-filter>
      ${shared.length > 1 ? `<div class="field"><label>Tahun Pelajaran</label>
        <select name="ta" data-autosubmit>
          ${shared.map(x => `<option value="${x.ta.id}" ${Number(x.ta.id) === Number(b.tahun_ajaran_id) ? 'selected' : ''}>${esc(x.ta.nama)}</option>`).join('')}
        </select></div>` : ''}
      <div class="field"><label>Periode Bulan</label>
        <select name="bulan" data-autosubmit onchange="this.form.elements.from.value='';this.form.elements.to.value=''">
          <option value="">Semua bulan</option>
          ${bulanOpsi.map(ym => `<option value="${ym}" ${bulan === ym ? 'selected' : ''}>${esc(labelYm(ym))}</option>`).join('')}
        </select></div>
      <div class="field"><label>Dari Tanggal</label>
        <input type="date" name="from" value="${esc(from)}" min="${esc(ta.tanggal_mulai || '')}" max="${esc(ta.tanggal_selesai || '')}"
          onchange="this.form.elements.bulan.value=''"></div>
      <div class="field"><label>Sampai Tanggal</label>
        <input type="date" name="to" value="${esc(to)}" min="${esc(ta.tanggal_mulai || '')}" max="${esc(ta.tanggal_selesai || '')}"
          onchange="this.form.elements.bulan.value=''"></div>
      <div class="field" style="min-width:auto"><label>&nbsp;</label>
        <div class="toolbar">
          <button class="btn btn-primary btn-sm">${ui.icon('search')}Terapkan</button>
          ${filterAktif ? `<a class="btn btn-sm" href="${base}/${slugBase}/publik/bku/${esc(b.public_token)}">Reset</a>` : ''}
        </div></div>
    </form>`;

    const body = `<div class="portal-card">
      <div class="portal-student">
        <div>
          <div class="pnama pname">${esc(b.nama)}</div>
          <div class="t-sub" style="font-size:12.5px">${b.jenis === 'kegiatan' ? 'Buku Kas Kegiatan Khusus' : 'Buku Kas Umum'}
            · Tahun Pelajaran ${esc(ta.nama || '-')} · Kode ${esc(b.kode || '-')}</div>
        </div>
        <div>${b.status === 'aktif' ? ui.badge('Buku Terbuka', 'green') : ui.badge('Buku Ditutup', 'gray')}</div>
      </div>
      ${taNotice ? `<div class="alert warn">${ui.icon('alert')}<div>${taNotice}</div></div>` : ''}
      ${usesIuranSaldo ? `<div class="alert info">${ui.icon('info')}<div>Saldo Awal Keseluruhan adalah saldo awal manual ditambah total <b>Sudah Diterima</b> pada grup iuran terhubung, lalu dikurangi pengeluaran. ${hideActivityIncomes ? 'Pemasukan transaksi biasa disembunyikan dan tidak menambah saldo.' : 'Pemasukan transaksi non-iuran ditampilkan dan menambah saldo; transaksi hasil posting grup iuran tidak dihitung dua kali.'}${linkedIuran.length ? '' : ` Belum ada grup terhubung; saldo awal keseluruhan saat ini ${rupiah(Number(b.saldo_awal || 0))}.`}</div></div>` : ''}
      <div class="kpi-grid" style="gap:14px">
        <div class="kpi"><div class="lbl">${usesIuranSaldo ? (filterAktif ? 'Saldo Awal Periode' : 'Saldo Awal Keseluruhan') : (filterAktif ? 'Saldo Awal Periode' : 'Saldo Awal')}</div><div class="val">${rupiah(saldoAwalPeriode)}</div>
          ${filterAktif ? `<div class="meta">per ${esc(from ? tglID(from) : '…')}</div>` : ''}</div>
        ${hideActivityIncomes ? '' : `<div class="kpi"><div class="lbl">${usesIuranSaldo ? 'Pemasukan Transaksi BKU' : 'Penerimaan'}</div><div class="val" style="color:var(--green)">${rupiah(masukInfoPeriode)}</div>
          ${usesIuranSaldo ? '<div class="meta">posting grup iuran dihitung melalui penerimaan grup</div>' : ''}</div>
        `}
        <div class="kpi"><div class="lbl">Pengeluaran</div><div class="val" style="color:var(--red)">${rupiah(keluarPeriode)}</div></div>
        <div class="kpi"><div class="lbl">${filterAktif ? 'Saldo Akhir Periode' : 'Saldo Buku'}</div><div class="val">${rupiah(saldoAkhirPeriode)}</div></div>
      </div>
    </div>
    ${linkedIuran.length ? `<div class="portal-card">
      <h3>Ringkasan Grup Iuran Terhubung</h3>
      <p class="help">${linkedIuran.length} grup · semua tahun ajaran pada grup terpilih. Penerimaan menjumlahkan pembayaran non-void dan tidak mengikuti filter tanggal transaksi BKU.</p>
      <div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px">
        <div class="kpi"><div class="lbl">Total Seharusnya Diterima (Tagihan)</div><div class="val">${rupiah(linkedIuranSummary.tagihan)}</div></div>
        <div class="kpi"><div class="lbl">Sudah Diterima</div><div class="val" style="color:var(--green)">${rupiah(linkedIuranSummary.diterima)}</div></div>
        <div class="kpi"><div class="lbl">Sisa Tagihan</div><div class="val" style="color:var(--red)">${rupiah(linkedIuranSummary.sisa)}</div></div>
      </div>
      <div class="table-wrap sticky-head mt-2"><table>
        <thead><tr><th>Grup Iuran</th><th>Tahun Ajaran</th><th class="num">Total Seharusnya</th><th class="num">Sudah Diterima</th><th class="num">Sisa Tagihan</th><th>Aksi</th></tr></thead>
        <tbody>${linkedIuran.map(g => `<tr><td class="t-strong">${esc(g.nama)}</td><td>${esc(g.ta_nama || '-')}</td>
          <td class="num">${rupiah(linkedIuranTotals.get(Number(g.id)).tagihan)}</td>
          <td class="num">${rupiah(linkedIuranTotals.get(Number(g.id)).diterima)}</td>
          <td class="num">${rupiah(linkedIuranTotals.get(Number(g.id)).sisa)}</td>
          <td class="nowrap">${g.is_public && g.public_token
            ? `<a class="btn btn-sm" href="${base}/${slugBase}/publik/iuran/${encodeURIComponent(g.public_token)}">${ui.icon('eye')}Lihat Rincian</a>`
            : '<span class="badge gray">Belum dipublikasikan</span>'}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="2">GRAND TOTAL</td><td class="num"><b>${rupiah(linkedIuranSummary.tagihan)}</b></td>
          <td class="num"><b>${rupiah(linkedIuranSummary.diterima)}</b></td><td class="num"><b>${rupiah(linkedIuranSummary.sisa)}</b></td><td></td></tr></tfoot>
      </table></div>
    </div>` : ''}

    <div class="portal-card">
      ${filterBar}
      <h3 style="margin-top:16px">Rincian Transaksi
        <span class="t-sub" style="font-weight:600;font-size:12px">(${hasil.length}${filterAktif ? ` dari ${visible.length}` : ''} transaksi)</span></h3>
      ${ringkasFilter ? `<div class="alert info" style="margin-bottom:10px">${ui.icon('info')}<div>Filter aktif: ${ringkasFilter}.
        Menampilkan <b>${hasil.length}</b> transaksi ${hideActivityIncomes ? '' : `· Penerimaan <b>${rupiah(masukInfoPeriode)}</b> `}· Pengeluaran <b>${rupiah(keluarPeriode)}</b>.</div></div>` : ''}
      ${showLedger ? `<div class="table-wrap sticky-head"><table>
        <thead><tr>
          <th style="width:38px">No</th><th>Tanggal</th><th>No. Bukti</th><th>Uraian</th>
          <th class="num">Penerimaan</th><th class="num">Pengeluaran</th><th class="num">Saldo</th>
        </tr></thead><tbody>
        ${hal === 1 ? `<tr data-opening-row style="background:#FFF8F2">
          <td></td><td colspan="3" class="t-strong">${usesIuranSaldo ? 'SALDO AWAL KESELURUHAN' : 'SALDO AWAL'} ${from ? 'per ' + tglID(from) : ''}</td>
          <td class="num t-strong">${rupiah(saldoAwalPeriode)}</td><td></td><td class="num t-strong">${rupiah(saldoAwalPeriode)}</td>
        </tr>` : ''}
        ${rows.map((t, i) => `<tr>
          <td class="num">${(hal - 1) * PER_HAL + i + 1}</td>
          <td class="nowrap">${esc(tglID(t.tanggal))}</td>
          <td class="mono t-sub">${esc(t.no_bukti || '-')}</td>
          <td>${esc(t.uraian || '-')}${t.nama_pihak ? `<div class="t-sub">${esc(t.nama_pihak)}</div>` : ''}
            ${usesIuranSaldo && !includeActivityIncomes && t.jenis === 'pemasukan' && Number(t.is_penyesuaian) !== 1 ? '<div class="t-sub">Informasi · tidak menambah saldo</div>' : ''}</td>
          <td class="num">${t.jenis === 'pemasukan' ? rupiah(t.nominal) : '-'}</td>
          <td class="num">${t.jenis === 'pengeluaran' ? rupiah(t.nominal) : '-'}</td>
          <td class="num t-strong">${rupiah(t.saldo)}</td>
        </tr>`).join('')}
        </tbody>
        <tfoot><tr>
          <td colspan="4">TOTAL${filterAktif ? ' PERIODE FILTER' : ''}</td>
          <td class="num">${rupiah(saldoAwalPeriode + (usesIuranSaldo
            ? masukPenyesuaian + (includeActivityIncomes ? masukInfoPeriode : 0)
            : masukPeriode))}</td><td class="num">${rupiah(keluarPeriode)}</td>
          <td class="num">${rupiah(saldoAkhirPeriode)}</td>
        </tr></tfoot></table></div>
        ${totalHal > 1 ? `<div class="toolbar mt-2" style="justify-content:center;flex-wrap:wrap">
          ${hal > 1 ? `<a class="btn btn-sm" href="${linkKe(b, hal - 1)}">‹ Sebelumnya</a>` : ''}
          <span class="badge gray plain">Halaman ${hal} dari ${totalHal}</span>
          ${hal < totalHal ? `<a class="btn btn-sm" href="${linkKe(b, hal + 1)}">Berikutnya ›</a>` : ''}
        </div>` : ''}`
        : ui.emptyState(filterAktif ? 'Tidak ada transaksi pada periode ini' : 'Belum ada transaksi',
          filterAktif ? 'Coba ubah bulan atau rentang tanggal filter.' : 'BKU ini belum memiliki transaksi yang dibukukan.')}
      <p class="help mt-2">Transaksi yang masih menunggu persetujuan, void, atau penyesuaian internal tidak ditampilkan pada halaman publik ini.</p>
    </div>`;

    res.html(shell({ base, settings: st, judul: 'Rincian ' + b.nama, subtitle: 'Transparansi Buku Kas', content: body }));
  });

  /* =============== Portal Wali Kelas: seluruh riwayat satu kelas =============== */
  get('/publik/kelas/:token/qr', async (req, res) => {
    const kelas = dbm.publicFind('kelas', req.params.token);
    if (!kelas) return res.html(tidakDitemukan(req.BASE, settings(), 'Kelas'), 404);
    const c = ctx(req);
    const slugBase = dbm.portalSlugs().base;
    const path = `/${slugBase}/publik/kelas/${encodeURIComponent(kelas.public_token)}`;
    const target = c.publicAbsUrl(path);
    const svg = await QRCode.toString(target, { type: 'svg', width: 220, margin: 2, errorCorrectionLevel: 'Q' });
    res.raw.writeHead(200, {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.raw.end(svg);
  });

  get('/publik/kelas/:token', (req, res) => {
    const st = settings();
    const base = req.BASE;
    const k = dbm.publicFind('kelas', req.params.token);
    if (!k) return res.html(tidakDitemukan(base, st, 'Kelas'), 404);

    const slugBase = dbm.portalSlugs().base;
    const href = `${base}/${slugBase}/publik/kelas/${encodeURIComponent(k.public_token)}`;
    const kelasNama = String(k.nama_kelas || k.nama || 'Kelas');
    const taKelas = db.prepare('SELECT * FROM tahun_ajaran WHERE id=?').get(k.tahun_ajaran_id) || {};
    const roster = db.prepare(`SELECT s.id, s.nama, s.nisn, s.status
      FROM siswa_penempatan sp JOIN siswa s ON s.id=sp.siswa_id
      WHERE sp.kelas_id=? AND sp.tahun_ajaran_id=? ORDER BY s.nama COLLATE NOCASE, s.id`)
      .all(k.id, k.tahun_ajaran_id);
    const ids = roster.map(s => Number(s.id));
    const tagihan = [];
    for (let i = 0; i < ids.length; i += 250) {
      tagihan.push(...dbm.iuranTagihanRows({ siswaIds: ids.slice(i, i + 250) }));
    }
    const tagsBySiswa = new Map(ids.map(id => [id, []]));
    for (const t of tagihan) {
      if (tagsBySiswa.has(Number(t.siswa_id))) tagsBySiswa.get(Number(t.siswa_id)).push(t);
    }
    const tagIds = tagihan.map(t => Number(t.id));
    const paysByTag = new Map();
    for (let i = 0; i < tagIds.length; i += 250) {
      for (const [id, payments] of dbm.iuranPaysMap(tagIds.slice(i, i + 250))) paysByTag.set(Number(id), payments);
    }
    const taList = dbm.allTahun();
    const q = String(req.query.get('q') || '').trim();
    const qLower = q.toLocaleLowerCase('id');
    const rosterDetail = roster.map(s => {
      const tags = tagsBySiswa.get(Number(s.id)) || [];
      return {
        ...s,
        tags,
        nominal: tags.reduce((n, t) => n + Number(t.nominal || 0), 0),
        dibayar: tags.reduce((n, t) => n + Number(t.terbayar || 0), 0),
        potongan: tags.reduce((n, t) => n + Number(t.total_potongan || 0), 0),
        sisa: tags.reduce((n, t) => n + Number(t.sisa || 0), 0)
      };
    });
    const visible = rosterDetail.filter(s => !qLower
      || `${s.nama} ${s.nisn || ''}`.toLocaleLowerCase('id').includes(qLower));
    const grand = visible.reduce((a, s) => ({
      tagihan: a.tagihan + s.nominal,
      dibayar: a.dibayar + s.dibayar,
      potongan: a.potongan + s.potongan,
      belum: a.belum + Math.max(0, s.nominal - s.dibayar),
      sisa: a.sisa + s.sisa
    }), { tagihan: 0, dibayar: 0, potongan: 0, belum: 0, sisa: 0 });

    const selectedId = Number(req.query.get('siswa') || 0);
    const selected = visible.find(s => Number(s.id) === selectedId);
    const selectedHref = s => `${href}?${new URLSearchParams({ q, siswa: String(s.id) }).toString()}`;
    const detail = selected ? (() => {
      const byTa = new Map();
      for (const t of selected.tags) {
        const key = Number(t.tahun_ajaran_id || 0);
        if (!byTa.has(key)) byTa.set(key, []);
        byTa.get(key).push(t);
      }
      const entries = taList.map(ta => ({
        id: Number(ta.id), tags: byTa.get(Number(ta.id)) || [], ta
      }));
      if (byTa.has(0)) entries.push({ id: 0, tags: byTa.get(0), ta: null });
      entries.sort((a, b) => {
        const ka = dbm.taSortKey(a.ta), kb = dbm.taSortKey(b.ta);
        return ka === kb ? a.id - b.id : (!ka ? 1 : !kb ? -1 : ka.localeCompare(kb));
      });
      const panels = entries.map(({ ta, tags }) => {
        let totalTagihan = 0, totalDibayar = 0, totalPotongan = 0, totalSisa = 0;
        const rows = [];
        for (const t of tags) {
          const pays = paysByTag.get(Number(t.id)) || [];
          const monthly = t.grup_jenis === 'bulanan'
            ? dbm.iuranMonthDetail(t.grup_id, pays, t.tingkat || dbm.siswaTingkat(t.siswa_id, t.tahun_ajaran_id))
            : [];
          if (monthly.length) {
            for (let mi = 0; mi < monthly.length; mi++) {
              const m = monthly[mi];
              rows.push({ label: `${t.grup_nama} — ${NAMA_BULAN[m.bulan - 1] || '-'}`, nominal: m.tagihan,
                dibayar: m.dibayar, potongan: 0, sisa: m.sisa, status: m.status,
                pays: mi === 0 ? pays : [], paymentLabel: 'Riwayat pembayaran grup', tagihanId: t.id });
              totalTagihan += m.tagihan; totalDibayar += m.dibayar; totalSisa += m.sisa;
            }
          } else {
            rows.push({ label: t.grup_nama, nominal: t.nominal, dibayar: t.terbayar,
              potongan: t.total_potongan, sisa: t.sisa, status: t.status, pays,
              paymentLabel: 'Riwayat pembayaran', tagihanId: t.id });
            totalTagihan += Number(t.nominal || 0); totalDibayar += Number(t.terbayar || 0);
            totalPotongan += Number(t.total_potongan || 0); totalSisa += Number(t.sisa || 0);
          }
        }
        const inner = rows.map(r => `<tr>
          <td><b>${esc(r.label)}</b>${r.pays.length ? `<details class="mt-1"><summary class="small">${esc(r.paymentLabel)} (${r.pays.length})</summary>
            <div class="table-wrap mt-1"><table><thead><tr><th>Tanggal</th><th>Bulan</th><th>Metode</th><th class="num">Tagihan dibayar</th><th class="num">Potongan</th></tr></thead><tbody>
              ${r.pays.map(p => `<tr><td>${esc(tglID(p.tanggal))}</td><td>${esc(p.bulan ? NAMA_BULAN[Number(p.bulan) - 1] || '-' : 'Alokasi otomatis')}</td><td>${esc(p.metode || '-')}</td><td class="num">${rupiah(p.jumlah)}</td><td class="num">${rupiah(p.potongan)}</td></tr>`).join('')}
            </tbody></table></div></details>` : ''}</td>
          <td class="num">${rupiah(r.nominal)}</td><td class="num" style="color:var(--green)">${rupiah(r.dibayar)}</td>
          <td class="num">${rupiah(r.potongan)}</td><td class="num" style="color:${r.sisa > 0 ? 'var(--red)' : 'var(--green)'}">${rupiah(r.sisa)}</td>
          <td>${badgeStatus(r.status)}</td></tr>`).join('');
        return `<section class="portal-ta" style="max-height:430px;overflow:auto;overscroll-behavior:contain">
          <div class="ta-head"><b>Tahun Pelajaran ${esc(ta ? ta.nama : '-')}</b><span>${tags.length} grup iuran</span></div>
          <div class="table-wrap"><table class="tbl-modern"><thead><tr><th>Grup Iuran / Bulan</th><th class="num">Tagihan</th>
            <th class="num">Sudah Dibayar</th><th class="num">Potongan</th><th class="num">Belum Dibayar</th><th>Status</th></tr></thead>
            <tbody>${inner || '<tr><td colspan="6">Belum ada tagihan pada tahun pelajaran ini.</td></tr>'}</tbody>
            <tfoot><tr><td>Subtotal ${esc(ta ? ta.nama : '')}</td><td class="num">${rupiah(totalTagihan)}</td>
              <td class="num">${rupiah(totalDibayar)}</td><td class="num">${rupiah(totalPotongan)}</td><td class="num">${rupiah(totalSisa)}</td><td></td></tr></tfoot>
          </table></div></section>`;
      }).join('');
      return `<div class="portal-card" id="rincianSiswa">
        <div class="portal-student"><div><h2 class="pname">${esc(selected.nama)}</h2>
          <div class="muted small">NISN ${esc(selected.nisn || '-')} · Kelas saat tautan dibuat: ${esc(kelasNama)}</div></div>
          <a class="btn btn-sm" href="${esc(href + (q ? '?q=' + encodeURIComponent(q) : ''))}">Kembali ke rekap kelas</a></div>
        <div class="kpi-grid" style="gap:12px">
          <div class="kpi"><div class="lbl">Total Tagihan</div><div class="val">${rupiah(selected.nominal)}</div></div>
          <div class="kpi"><div class="lbl">Sudah Dibayar</div><div class="val" style="color:var(--green)">${rupiah(selected.dibayar)}</div></div>
          <div class="kpi"><div class="lbl">Potongan</div><div class="val">${rupiah(selected.potongan)}</div></div>
          <div class="kpi"><div class="lbl">Sisa Tagihan</div><div class="val" style="color:var(--red)">${rupiah(selected.sisa)}</div></div>
        </div>
        <h3 class="mt-2">Rincian Iuran Seluruh Tahun Pelajaran</h3>
        ${panels || ui.emptyState('Belum ada tagihan', 'Rincian tagihan siswa ini belum tersedia pada tahun pelajaran mana pun.')}
      </div>`;
    })() : '';

    const body = `<div class="portal-card">
      <div class="portal-student"><div><div class="pname">${esc(kelasNama)}</div>
        <div class="muted small">Rekap Wali Kelas · Tahun kelas ${esc(taKelas.nama || '-')} · ${roster.length} siswa</div></div>
        <span class="badge blue">Hanya lihat</span></div>
      <p class="muted small">Tautan ini menampilkan tagihan siswa yang terdaftar pada kelas tersebut, termasuk riwayat seluruh tahun pelajaran.
        Klik nama siswa untuk melihat rincian iuran, pembayaran, potongan, dan sisa per tahun.</p>
      <form method="get" action="${href}" class="portal-period">
        <div class="field" style="min-width:250px"><label>Filter Nama Siswa / NISN</label>
          <input name="q" value="${esc(q)}" placeholder="Cari nama atau NISN" autocomplete="off"></div>
        <div class="field" style="min-width:auto"><label>&nbsp;</label><button class="btn btn-primary btn-sm">${ui.icon('search')}Cari</button></div>
        ${q ? `<a class="btn btn-sm" href="${href}">Reset</a>` : ''}
      </form>
      <div class="kpi-grid" style="gap:12px">
        <div class="kpi"><div class="lbl">Grand Total Tagihan</div><div class="val">${rupiah(grand.tagihan)}</div><div class="meta">${visible.length} dari ${roster.length} siswa</div></div>
        <div class="kpi"><div class="lbl">Grand Total Sudah Dibayar</div><div class="val" style="color:var(--green)">${rupiah(grand.dibayar)}</div></div>
        <div class="kpi"><div class="lbl">Grand Total Belum Dibayar</div><div class="val" style="color:var(--red)">${rupiah(grand.belum)}</div></div>
        <div class="kpi"><div class="lbl">Total Tagihan Tersisa</div><div class="val" style="color:var(--red)">${rupiah(grand.sisa)}</div></div>
      </div>
    </div>
    ${detail}
    ${selected ? '' : `<div class="portal-card">
      <h3>Rekap Seluruh Siswa — ${esc(kelasNama)}</h3>
      ${visible.length ? `<div class="table-wrap sticky-head"><table id="tblKelasPublik"><thead><tr>
        <th style="width:42px">No</th><th>Nama Siswa</th><th>NISN</th><th class="num">Total Tagihan</th>
        <th class="num">Sudah Dibayar</th><th class="num">Potongan</th><th class="num">Sisa Tagihan</th></tr></thead><tbody>
        ${visible.map((s, i) => `<tr><td class="num">${i + 1}</td>
          <td><a class="t-strong" href="${esc(selectedHref(s))}">${esc(s.nama)}</a></td><td class="mono t-sub">${esc(s.nisn || '-')}</td>
          <td class="num">${rupiah(s.nominal)}</td><td class="num" style="color:var(--green)">${rupiah(s.dibayar)}</td>
          <td class="num">${rupiah(s.potongan)}</td><td class="num" style="color:${s.sisa > 0 ? 'var(--red)' : 'var(--green)'}">${rupiah(s.sisa)}</td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="3">GRAND TOTAL${q ? ' (HASIL FILTER)' : ''}</td><td class="num">${rupiah(grand.tagihan)}</td>
        <td class="num">${rupiah(grand.dibayar)}</td><td class="num">${rupiah(grand.potongan)}</td><td class="num">${rupiah(grand.sisa)}</td></tr></tfoot></table></div>`
        : ui.emptyState(q ? 'Siswa tidak ditemukan' : 'Belum ada siswa pada kelas ini', q ? 'Coba nama atau NISN lainnya.' : 'Belum ada penempatan siswa pada kelas dan tahun pelajaran ini.')}
    </div>`}`;
    res.html(shell({ base, settings: st, judul: 'Rekap ' + kelasNama, subtitle: 'Portal Informasi Iuran Wali Kelas', content: body }));
  });

  /* ==================== Grup Iuran: rekap siswa publik ==================== */
  get('/publik/iuran/:token', (req, res) => {
    const st = settings();
    const base = req.BASE;
    const g = dbm.publicFind('iuran', req.params.token);
    if (!g) return res.html(tidakDitemukan(base, st, 'Grup Iuran'), 404);
    const slugBase = dbm.portalSlugs().base;
    const qp = k => String(req.query.get(k) || '').trim();
    const ta = db.prepare('SELECT * FROM tahun_ajaran WHERE id=?').get(g.tahun_ajaran_id) || {};
    const linkedBku = dbm.bkuForIuranGrup(g.id);
    const linkedBkuUrl = linkedBku && linkedBku.is_public && linkedBku.public_token
      ? `${base}/${slugBase}/publik/bku/${encodeURIComponent(linkedBku.public_token)}` : '';

    /* ---------- filter pencarian: nama/NISN & kelas ---------- */
    const q = qp('q');
    const kelasFilter = qp('kelas');
    const semua = dbm.iuranTagihanRows({ grupId: g.id })
      .sort((a, b) => String(a.kelas_nama || '').localeCompare(String(b.kelas_nama || ''), 'id')
        || String(a.siswa_nama || '').localeCompare(String(b.siswa_nama || ''), 'id'));
    const siswaBertagihan = [...new Set(semua.map(r => r.siswa_id))].length;
    const kelasOpsi = [...new Set(semua.map(r => String(r.kelas_nama || '')).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'id'));
    const qLower = q.toLowerCase();
    const rows = semua.filter(r => {
      if (kelasFilter && String(r.kelas_nama || '') !== kelasFilter) return false;
      if (qLower) {
        const hay = [r.siswa_nama, r.nisn, r.kelas_nama].map(x => String(x || '').toLowerCase()).join(' ');
        if (!hay.includes(qLower)) return false;
      }
      return true;
    });
    const filterAktif = !!(q || kelasFilter);

    const totalTagihan = rows.reduce((s, r) => s + Number(r.nominal || 0), 0);
    const totalDibayar = rows.reduce((s, r) => s + Number(r.terbayar || 0), 0);
    const totalPenerimaan = rows.reduce((s, r) => s + Number(r.kas_diterima || 0), 0);
    const totalSisa = rows.reduce((s, r) => s + Number(r.sisa || 0), 0);
    const lunas = rows.filter(r => r.status === 'lunas' || r.status === 'pemutihan').length;
    const jenisLabel = g.jenis === 'bulanan' ? 'Iuran Bulanan' : 'Iuran Non-Bulanan';
    const periodeLabel = g.jenis === 'bulanan'
      ? `${NAMA_BULAN[6]} – ${NAMA_BULAN[5]} ${String(ta.tanggal_mulai || '').slice(0, 4) || new Date().getFullYear()}`
      : 'Satu periode';

    const filterBar = `<form method="get" action="${base}/${slugBase}/publik/iuran/${esc(g.public_token)}" class="portal-period" data-iuran-filter>
      <div class="field" style="min-width:230px"><label>Cari Nama / NISN</label>
        <input name="q" value="${esc(q)}" placeholder="Ketik nama atau NISN siswa" autocomplete="off"></div>
      <div class="field"><label>Kelas</label>
        <select name="kelas" data-autosubmit>
          <option value="">Semua kelas</option>
          ${kelasOpsi.map(k => `<option value="${esc(k)}" ${kelasFilter === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}
        </select></div>
      <div class="field" style="min-width:auto"><label>&nbsp;</label>
        <div class="toolbar">
          <button class="btn btn-primary btn-sm">${ui.icon('search')}Terapkan</button>
          ${filterAktif ? `<a class="btn btn-sm" href="${base}/${slugBase}/publik/iuran/${esc(g.public_token)}">Reset</a>` : ''}
        </div></div>
    </form>`;

    const body = `<div class="portal-card">
      <div class="portal-student">
        <div>
          <div class="pname">${esc(g.nama)}</div>
          <div class="t-sub" style="font-size:12.5px">${esc(jenisLabel)} · ${esc(periodeLabel)}
            · Tahun Pelajaran ${esc(ta.nama || '-')}</div>
        </div>
        <div class="toolbar">
          ${g.aktif ? ui.badge('Grup Aktif', 'green') : ui.badge('Non-Aktif', 'gray')}
          ${linkedBkuUrl ? `<a class="btn btn-sm" href="${esc(linkedBkuUrl)}">${ui.icon('eye')}Lihat BKU</a>`
          : linkedBku ? '<span class="badge gray">BKU belum dipublikasikan</span>' : ''}
        </div>
      </div>
      <div class="kpi-grid" style="gap:14px">
        <div class="kpi"><div class="lbl">Total Tagihan</div><div class="val">${rupiah(totalTagihan)}</div>
          <div class="meta">${rows.length}${filterAktif ? ` dari ${siswaBertagihan}` : ''} siswa</div></div>
        <div class="kpi"><div class="lbl">Tagihan Terpenuhi (termasuk potongan)</div><div class="val" style="color:var(--green)">${rupiah(totalDibayar)}</div></div>
        <div class="kpi"><div class="lbl">Total Dana Diterima</div><div class="val" style="color:var(--green)">${rupiah(totalPenerimaan)}</div></div>
        <div class="kpi"><div class="lbl">Sisa Tagihan</div><div class="val" style="color:var(--red)">${rupiah(totalSisa)}</div></div>
        <div class="kpi"><div class="lbl">Sudah Lunas</div><div class="val">${lunas}<span style="font-size:13px;color:var(--muted)"> / ${rows.length}</span></div></div>
      </div>
    </div>

    <div class="portal-card">
      ${filterBar}
      <h3 style="margin-top:16px">Rekap Pembayaran Siswa
        <span class="t-sub" style="font-weight:600;font-size:12px">(${rows.length}${filterAktif ? ` dari ${siswaBertagihan}` : ''} siswa)</span></h3>
      ${filterAktif ? `<div class="alert info" style="margin-bottom:10px">${ui.icon('info')}<div>Filter aktif:
        ${q ? `nama/NISN mengandung <b>${esc(q)}</b>` : ''}${q && kelasFilter ? ' · ' : ''}${kelasFilter ? `kelas <b>${esc(kelasFilter)}</b>` : ''}.
        Total di bawah hanya menghitung <b>${rows.length}</b> siswa yang cocok.</div></div>` : ''}
      ${rows.length ? `<div class="table-wrap sticky-head"><table>
        <thead><tr>
          <th style="width:38px">No</th><th>Nama</th><th>Kelas</th><th>NISN</th>
          <th class="num">Tagihan</th><th class="num">Dibayar</th><th class="num">Sisa</th><th>Status</th>
        </tr></thead><tbody>
        ${rows.map((r, i) => `<tr>
          <td class="num">${i + 1}</td>
          <td class="t-strong">${esc(r.siswa_nama || '-')}</td>
          <td>${esc(r.kelas_nama || '-')}</td>
          <td class="mono t-sub">${esc(r.nisn || '-')}</td>
          <td class="num">${rupiah(r.nominal)}</td>
          <td class="num">${rupiah(r.terbayar)}</td>
          <td class="num">${rupiah(r.sisa)}</td>
          <td>${badgeStatus(r.status)}</td>
        </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr><td colspan="4">TOTAL TAGIHAN${filterAktif ? ' (HASIL FILTER)' : ''}</td><td class="num">${rupiah(totalTagihan)}</td>
            <td class="num">${rupiah(totalDibayar)}</td><td class="num">${rupiah(totalSisa)}</td><td></td></tr>
          <tr><td colspan="4">GRAND TOTAL DANA DITERIMA</td><td colspan="4" class="num"><b>${rupiah(totalPenerimaan)}</b></td></tr>
        </tfoot></table></div>`
        : ui.emptyState(filterAktif ? 'Siswa tidak ditemukan' : 'Belum ada siswa',
          filterAktif ? 'Coba ubah kata kunci nama/NISN atau pilih kelas lain.' : 'Belum ada siswa yang ditetapkan pada grup iuran ini.')}
      <p class="help mt-2">Nominal menampilkan tagihan, pembayaran yang sudah dicatat, dan sisa tagihan siswa.
        Data diperbarui otomatis setiap kali bendahara mencatat pembayaran.</p>
    </div>`;

    res.html(shell({ base, settings: st, judul: 'Rekap ' + g.nama, subtitle: 'Transparansi Iuran Siswa', content: body }));
  });
};
