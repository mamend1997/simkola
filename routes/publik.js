'use strict';
/* ==========================================================================
   DOMAIN PUBLIK (tanpa login) — tautan acak untuk transparansi:
     · /<nama-sekolah>/publik/bku/<token>    → rincian satu BKU + transaksi
     · /<nama-sekolah>/publik/iuran/<token>  → rekap satu Grup Iuran + siswa
   Halaman hanya dilayani bila sakelar `is_public` = 1 DAN token persis sama
   dengan yang tersimpan (dbm.publicFind). Token tidak dapat ditebak
   (24 hex = 96 bit) sehingga tautan tidak bisa dipindai/ditebak.

   FILTER (semua server-side, parameter GET — halaman tetap bisa dibagikan):
     BKU   : ?bulan=YYYY-MM · ?from=YYYY-MM-DD&to=YYYY-MM-DD · ?ta=<id> (tahun pelajaran
             lain dengan BKU bernama SAMA yang juga dibagikan publik)
     Iuran : ?q=<nama/NISN> · ?kelas=<nama kelas>
   ========================================================================== */
module.exports = ({ get, dbm, lib, ui }) => {
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
    Halaman ini dibagikan sekolah melalui tautan acak. Hanya menampilkan data yang sudah dibukukan (tidak dapat diubah dari sini).</footer>
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

    /* ---------- filter periode (bulan / rentang tanggal) ---------- */
    const bulan = isYm(qp('bulan')) ? qp('bulan') : '';
    let from = isYmd(qp('from')) ? qp('from') : '';
    let to = isYmd(qp('to')) ? qp('to') : '';
    if (bulan) { from = bulan + '-01'; to = lastDayOfYm(bulan); }
    if (from && to && from > to) { const tmp = from; from = to; to = tmp; }
    const filterAktif = !!(bulan || from || to);

    const semua = db.prepare(`SELECT t.* FROM transaksi t
        WHERE t.bku_id=? AND t.status='posted' ORDER BY t.tanggal, t.id`).all(b.id);
    /* saldo berjalan dihitung dari saldo awal BKU untuk SELURUH transaksi,
       lalu disaring — sehingga saldo pada hasil filter tetap benar. */
    let run = Number(b.saldo_awal || 0);
    const berjalan = semua.map(t => {
      run += (t.jenis === 'pemasukan' ? 1 : -1) * Number(t.nominal || 0);
      return { ...t, saldo: run };
    });
    const signed = t => (t.jenis === 'pemasukan' ? 1 : -1) * Number(t.nominal || 0);
    const cocok = t => (!from || String(t.tanggal) >= from) && (!to || String(t.tanggal) <= to);
    const hasil = berjalan.filter(cocok);
    const masukPeriode = hasil.filter(t => t.jenis === 'pemasukan').reduce((s, t) => s + Number(t.nominal || 0), 0);
    const keluarPeriode = hasil.filter(t => t.jenis === 'pengeluaran').reduce((s, t) => s + Number(t.nominal || 0), 0);
    /* saldo awal periode = saldo berjalan tepat sebelum transaksi pertama hasil filter */
    const saldoAwalPeriode = hasil.length ? hasil[0].saldo - signed(hasil[0]) : (berjalan.length ? berjalan[berjalan.length - 1].saldo : Number(b.saldo_awal || 0));
    const saldoAkhirPeriode = saldoAwalPeriode + masukPeriode - keluarPeriode;

    const totalHal = Math.max(1, Math.ceil(hasil.length / PER_HAL));
    const hal = Math.min(totalHal, Math.max(1, Number(qp('hal') || 1) || 1));
    const rows = hasil.slice((hal - 1) * PER_HAL, hal * PER_HAL);
    const linkKe = (row, n) => bkuHref(row, { bulan, from, to, hal: n > 1 ? n : '' });

    /* pilihan bulan = bulan yang benar-benar punya transaksi (terbaru di atas) */
    const bulanOpsi = [...new Set(semua.map(t => String(t.tanggal || '').slice(0, 7)).filter(isYm))].sort().reverse();
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
      <div class="kpi-grid" style="gap:14px">
        <div class="kpi"><div class="lbl">${filterAktif ? 'Saldo Awal Periode' : 'Saldo Awal'}</div><div class="val">${rupiah(saldoAwalPeriode)}</div>
          ${filterAktif ? `<div class="meta">per ${esc(from ? tglID(from) : '…')}</div>` : ''}</div>
        <div class="kpi"><div class="lbl">Penerimaan</div><div class="val" style="color:var(--green)">${rupiah(masukPeriode)}</div></div>
        <div class="kpi"><div class="lbl">Pengeluaran</div><div class="val" style="color:var(--red)">${rupiah(keluarPeriode)}</div></div>
        <div class="kpi"><div class="lbl">${filterAktif ? 'Saldo Akhir Periode' : 'Saldo Buku'}</div><div class="val">${rupiah(saldoAkhirPeriode)}</div></div>
      </div>
    </div>

    <div class="portal-card">
      ${filterBar}
      <h3 style="margin-top:16px">Rincian Transaksi
        <span class="t-sub" style="font-weight:600;font-size:12px">(${hasil.length}${filterAktif ? ` dari ${berjalan.length}` : ''} transaksi)</span></h3>
      ${ringkasFilter ? `<div class="alert info" style="margin-bottom:10px">${ui.icon('info')}<div>Filter aktif: ${ringkasFilter}.
        Menampilkan <b>${hasil.length}</b> transaksi · Penerimaan <b>${rupiah(masukPeriode)}</b> · Pengeluaran <b>${rupiah(keluarPeriode)}</b>.</div></div>` : ''}
      ${rows.length ? `<div class="table-wrap sticky-head"><table>
        <thead><tr>
          <th style="width:38px">No</th><th>Tanggal</th><th>No. Bukti</th><th>Uraian</th>
          <th class="num">Penerimaan</th><th class="num">Pengeluaran</th><th class="num">Saldo</th>
        </tr></thead><tbody>
        ${rows.map((t, i) => `<tr>
          <td class="num">${(hal - 1) * PER_HAL + i + 1}</td>
          <td class="nowrap">${esc(tglID(t.tanggal))}</td>
          <td class="mono t-sub">${esc(t.no_bukti || '-')}</td>
          <td>${esc(t.uraian || '-')}${t.nama_pihak ? `<div class="t-sub">${esc(t.nama_pihak)}</div>` : ''}</td>
          <td class="num">${t.jenis === 'pemasukan' ? rupiah(t.nominal) : '-'}</td>
          <td class="num">${t.jenis === 'pengeluaran' ? rupiah(t.nominal) : '-'}</td>
          <td class="num t-strong">${rupiah(t.saldo)}</td>
        </tr>`).join('')}
        </tbody>
        <tfoot><tr>
          <td colspan="4">TOTAL${filterAktif ? ' PERIODE FILTER' : ''}</td>
          <td class="num">${rupiah(masukPeriode)}</td><td class="num">${rupiah(keluarPeriode)}</td>
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

  /* ==================== Grup Iuran: rekap siswa publik ==================== */
  get('/publik/iuran/:token', (req, res) => {
    const st = settings();
    const base = req.BASE;
    const g = dbm.publicFind('iuran', req.params.token);
    if (!g) return res.html(tidakDitemukan(base, st, 'Grup Iuran'), 404);
    const slugBase = dbm.portalSlugs().base;
    const qp = k => String(req.query.get(k) || '').trim();
    const ta = db.prepare('SELECT * FROM tahun_ajaran WHERE id=?').get(g.tahun_ajaran_id) || {};

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
        <div>${g.aktif ? ui.badge('Grup Aktif', 'green') : ui.badge('Non-Aktif', 'gray')}</div>
      </div>
      <div class="kpi-grid" style="gap:14px">
        <div class="kpi"><div class="lbl">Total Tagihan</div><div class="val">${rupiah(totalTagihan)}</div>
          <div class="meta">${rows.length}${filterAktif ? ` dari ${siswaBertagihan}` : ''} siswa</div></div>
        <div class="kpi"><div class="lbl">Grand Total Dibayar</div><div class="val" style="color:var(--green)">${rupiah(totalDibayar)}</div></div>
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
          <tr><td colspan="4">GRAND TOTAL DANA DITERIMA</td><td colspan="4" class="num"><b>${rupiah(totalDibayar)}</b></td></tr>
        </tfoot></table></div>`
        : ui.emptyState(filterAktif ? 'Siswa tidak ditemukan' : 'Belum ada siswa',
          filterAktif ? 'Coba ubah kata kunci nama/NISN atau pilih kelas lain.' : 'Belum ada siswa yang ditetapkan pada grup iuran ini.')}
      <p class="help mt-2">Nominal menampilkan tagihan, pembayaran yang sudah dicatat, dan sisa tagihan siswa.
        Data diperbarui otomatis setiap kali bendahara mencatat pembayaran.</p>
    </div>`;

    res.html(shell({ base, settings: st, judul: 'Rekap ' + g.nama, subtitle: 'Transparansi Iuran Siswa', content: body }));
  });
};
