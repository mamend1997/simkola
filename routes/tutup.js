'use strict';

module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl }) => {
  const { db } = dbm;
  const { esc, rupiah, tglID, todayISO, terbilangRupiah } = lib;

  const ACTION_LABEL = { belum: 'Belum Ditutup', ditutup: 'Ditutup', dibuka: 'Dibuka Kembali', terbuka: 'Berjalan', terlewat: 'Terlewat' };
  function statusBadge(st) {
    if (st === 'ditutup') return ui.badge('Ditutup', 'green');
    if (st === 'dibuka') return ui.badge('Dibuka Kembali', 'amber');
    if (st === 'terlewat') return ui.badge('Belum Ditutup', 'red');
    return ui.badge('Bulan Berjalan', 'blue');
  }

  function selisihBadge(n) {
    if (Math.abs(n) < 1) return ui.badge('Nihil', 'green');
    return n > 0 ? ui.badge('Kas Lebih ' + rupiah(n), 'blue') : ui.badge('Kas Kurang ' + rupiah(Math.abs(n)), 'red');
  }

  /* ================= halaman utama ================= */
  get('/tutup-bulanan', (req, res) => {
    guard(req, res, 'tutup_bulanan', 'view');
    const c = ctx(req);
    const cur = dbm.currentPeriode();
    const periode = /^\d{4}-\d{2}$/.test(req.query.get('periode') || '') ? req.query.get('periode') : dbm.prevPeriode(cur);
    const ta = c.ta;
    const semua = req.query.get('semua') === '1';
    const bkuss = dbm.allBku(ta ? ta.id : null);

    const rows = bkuss.map(b => {
      const pos = dbm.periodePosisi(b.id, periode);
      const row = dbm.periodeRow(b.id, periode);
      const st = dbm.periodeStatus(b.id, periode);
      return { b, pos, row, status: st, adaAktivitas: pos.masuk > 0 || pos.keluar > 0 };
    });
    const tampil = rows.filter(r => semua || r.adaAktivitas || r.row || r.status === 'terlewat');
    const belum = rows.filter(r => r.status === 'terlewat' || r.status === 'dibuka');
    const sudah = rows.filter(r => r.status === 'ditutup');
    const totalBukuBelum = belum.reduce((s, r) => s + r.pos.saldoBuku, 0);

    const riwayat = db.prepare(`SELECT p.*, b.nama bku_nama, b.kode bku_kode, t.nama ta_nama
      FROM bku_periode p JOIN bku b ON b.id=p.bku_id LEFT JOIN tahun_ajaran t ON t.id=b.tahun_ajaran_id
      ORDER BY p.periode DESC, b.urutan ASC LIMIT 40`).all();

    const unclosedAll = dbm.unclosedPeriods(ta ? ta.id : null);

    const opnamForm = r => `<form method="post" action="${c.base}/tutup-bulanan/tutup" id="fTutup${r.b.id}" data-opnam-form data-saldo-buku="${r.pos.saldoBuku}">
      <input type="hidden" name="bku_id" value="${r.b.id}">
      <input type="hidden" name="periode" value="${periode}">
      <div class="alert info">${ui.icon('info')}<div>Menutup <b>${esc(r.b.nama)}</b> periode <b>${esc(dbm.periodeLabel(periode))}</b>.
        Setelah ditutup, transaksi periode ini terkunci dan saldo akhirnya menjadi <b>saldo awal ${esc(dbm.periodeLabel(nextPeriodeLabel(periode)))}</b>.</div></div>
      <div class="table-wrap mb-2"><table><tbody>
        <tr><td>Saldo Awal ${esc(dbm.periodeLabel(periode))}</td><td class="num t-strong">${rupiah(r.pos.saldoAwal)}</td></tr>
        <tr><td>Total Penerimaan</td><td class="num" style="color:var(--green)">+ ${rupiah(r.pos.masuk)}</td></tr>
        <tr><td>Total Pengeluaran</td><td class="num" style="color:var(--red)">− ${rupiah(r.pos.keluar)}</td></tr>
        <tr style="background:#FFF8F2"><td class="t-strong">Saldo Menurut Buku</td><td class="num t-strong">${rupiah(r.pos.saldoBuku)}</td></tr>
      </tbody></table></div>

      <div class="field"><label>Metode Penentuan Saldo Awal Bulan Berikutnya</label>
        <div class="radio-cards" style="grid-template-columns:1fr">
          <input type="radio" name="metode" id="mtA_${r.b.id}" value="rollover" checked>
          <label for="mtA_${r.b.id}"><span class="dot"></span>
            <span>Opsi A — Lanjutkan Sisa Saldo Buku (Otomatis)<br>
            <span class="small muted" style="font-weight:500">Saldo akhir ${rupiah(r.pos.saldoBuku)} dipindah 100% menjadi saldo awal bulan baru.</span></span></label>
          <input type="radio" name="metode" id="mtB_${r.b.id}" value="opnam">
          <label for="mtB_${r.b.id}"><span class="dot"></span>
            <span>Opsi B — Penyesuaian Kas Riil (Opnam Kas)<br>
            <span class="small muted" style="font-weight:500">Input uang fisik &amp; saldo bank; selisih dicatat otomatis sebagai transaksi penyesuaian.</span></span></label>
        </div>
      </div>

      <div data-opnam-panel style="display:none">
        <div class="row2">
          <div class="field"><label>Uang Tunai Riil di Brankas (Rp)</label>
            ${ui.moneyInput('opnam_tunai', r.pos.saldoBuku, 'class="js-opnam-tunai" placeholder="0"')}</div>
          <div class="field"><label>Saldo Riil Rekening Bank (Rp)</label>
            ${ui.moneyInput('opnam_bank', 0, 'class="js-opnam-bank" placeholder="0"')}</div>
        </div>
        <div class="js-opnam-selisih alert" style="display:none"></div>
        <div class="row2">
          <div class="field"><label>Alasan / Keterangan Selisih</label>
            <input name="alasan" class="js-alasan" placeholder="Contoh: selisih pembulatan admin / belum terbayar / koreksi pencatatan"></div>
          <div class="field"><label>Selisih Dibukukan Pada</label>
            <select name="metode_penyesuaian"><option value="tunai">Kas Tunai</option><option value="transfer">Rekening Bank</option></select></div>
        </div>
        <div class="alert warn">${ui.icon('alert')}<div>Sistem akan otomatis membuat transaksi <b>Selisih Kas Lebih (9.2.01)</b> atau <b>Selisih Kas Kurang (9.2.02)</b> pada tanggal akhir bulan, sehingga saldo awal bulan baru = nominal kas riil hasil opnam.</div></div>
      </div>

      <div class="field"><label>Nomor Berita Acara</label>
        <input name="berita_acara_no" value="BA-OPNAM/${esc(r.b.kode || 'BKU')}/${esc(periode.replace('-', ''))}"></div>
    </form>`;

    const laterModals = [];
    const modalLater = (id, opts) => { laterModals.push(ui.modal(id, opts)); return ''; };

    const tableRows = tampil.map(r => {
      const st = r.status;
      const bisaTutup = st !== 'ditutup' && r.b.status === 'aktif' && can(req.user, 'tutup_bulanan', 'create');
      return `<tr>
        <td class="center">${bisaTutup ? `<input type="checkbox" name="pilih_${r.b.id}" value="1" form="fMassal" title="Pilih ${esc(r.b.nama)}">` : ''}</td>
        <td><div class="t-strong">${esc(r.b.nama)}</div><div class="t-sub mono">${esc(r.b.kode || '')} · ${r.b.jenis === 'umum' ? 'Umum' : 'Kegiatan'}</div></td>
        <td class="num">${rupiah(r.pos.saldoAwal)}</td>
        <td class="num" style="color:var(--green)">${r.pos.masuk ? rupiah(r.pos.masuk) : '—'}</td>
        <td class="num" style="color:var(--red)">${r.pos.keluar ? rupiah(r.pos.keluar) : '—'}</td>
        <td class="num t-strong">${rupiah(r.pos.saldoBuku)}</td>
        <td>${statusBadge(st)}${r.row && Math.abs(r.row.selisih) >= 1 ? `<div class="t-sub">${selisihBadge(r.row.selisih)}</div>` : ''}</td>
        <td class="right nowrap">
          ${bisaTutup ? `<button class="btn btn-sm btn-primary" data-open="mTutup${r.b.id}">${ui.icon('lock')}Tutup Bulanan</button>` : ''}
          ${r.row ? `<a class="btn btn-sm" target="_blank" href="${c.base}/bku/${r.b.id}/berita-acara-bulanan?periode=${periode}">${ui.icon('printer')}Berita Acara</a>` : ''}
          ${r.row && st === 'ditutup' && can(req.user, 'tutup_bulanan', 'edit') ? `<form method="post" action="${c.base}/tutup-bulanan/buka" style="display:inline" data-confirm="Buka kembali periode ${esc(dbm.periodeLabel(periode))} untuk ${esc(r.b.nama)}? Transaksi periode ini akan dapat diedit kembali."><input type="hidden" name="bku_id" value="${r.b.id}"><input type="hidden" name="periode" value="${periode}"><button class="btn btn-sm btn-soft">${ui.icon('unlock')}Buka</button></form>` : ''}
          ${!r.row && r.b.status !== 'aktif' ? '<span class="small muted">BKU ditutup</span>' : ''}
        </td></tr>
      ${bisaTutup ? modalLater('mTutup' + r.b.id, {
        title: 'Tutup BKU Bulanan',
        wide: true,
        body: opnamForm(r),
        footer: `<button class="btn" type="button" data-close="mTutup${r.b.id}">Batal</button>
          <button class="btn btn-primary" type="submit" form="fTutup${r.b.id}">${ui.icon('lock')}Tutup BKU &amp; Rollover Saldo</button>`
      }) : ''}`;
    }).join('');

    const content = `
    ${belum.length ? `<div class="card mb-3" style="border-color:#F6CFD0;background:#FFF9F9">
      <div class="between"><div>
        <div style="font-weight:800;font-size:15px">${ui.icon('lock', 'i-sm')} ${belum.length} BKU pada periode ${esc(dbm.periodeLabel(periode))} belum ditutup</div>
        <div class="small muted">Input transaksi pada bulan yang sudah berganti diblokir sampai proses Tutup BKU Bulanan diselesaikan.</div>
      </div>
      <a class="btn btn-primary" href="#daftar">Tutup Sekarang</a></div></div>` : ''}

    <div class="kpi-grid mb-3">
      <div class="kpi ic-orange"><div class="ico">${ui.icon('calendar')}</div><div class="lbl">Periode Ditinjau</div>
        <div class="val" style="font-size:19px">${esc(dbm.periodeLabel(periode))}</div><div class="meta">Bulan berjalan: ${esc(dbm.periodeLabel(cur))}</div></div>
      <div class="kpi ic-red"><div class="ico">${ui.icon('lock')}</div><div class="lbl">BKU Belum Ditutup</div>
        <div class="val" style="font-size:19px">${belum.length}</div><div class="meta">periode ${esc(dbm.periodeLabel(periode))}</div></div>
      <div class="kpi ic-green"><div class="ico">${ui.icon('check')}</div><div class="lbl">Sudah Ditutup</div>
        <div class="val" style="font-size:19px">${sudah.length}</div><div class="meta">${riwayat.length} riwayat tutup bulanan</div></div>
      <div class="kpi ic-blue"><div class="ico">${ui.icon('wallet')}</div><div class="lbl">Saldo Buku Belum Ditutup</div>
        <div class="val" style="font-size:19px">${rupiah(totalBukuBelum)}</div><div class="meta">Akan jadi saldo awal bulan baru</div></div>
    </div>

    ${unclosedAll.length > 1 ? `<div class="alert warn">${ui.icon('alert')}<div><b>Periode lain yang masih terbuka:</b>
      ${unclosedAll.filter(x => x.periode !== periode).slice(0, 8).map(x => `<a href="${c.base}/tutup-bulanan?periode=${x.periode}&semua=1">${esc(dbm.periodeLabel(x.periode))}</a> (${esc(x.bku_nama)})`).join(' · ') || '—'}</div></div>` : ''}

    <div class="card mb-3" id="daftar">
      <div class="card-head">
        <div><h3>Penutupan BKU Bulanan</h3><div class="sub">Pilih periode, lalu tutup setiap buku kas dengan Opsi A (rollover) atau Opsi B (opnam kas riil)</div></div>
        <form method="get" action="${c.base}/tutup-bulanan" class="toolbar">
          <input type="month" name="periode" value="${esc(periode)}" max="${esc(cur)}">
          <label class="check small" style="white-space:nowrap"><input type="checkbox" name="semua" value="1" ${semua ? 'checked' : ''}> semua BKU</label>
          <button class="btn">${ui.icon('filter')}Tampilkan</button>
        </form>
      </div>
      ${tampil.length ? `<div class="table-wrap"><table><thead><tr>
        <th class="center" style="width:42px"><input type="checkbox" data-check-all title="Centang / lepas semua"></th>
        <th>Buku Kas</th><th class="num">Saldo Awal</th><th class="num">Penerimaan</th><th class="num">Pengeluaran</th><th class="num">Saldo Buku</th><th>Status</th><th class="right">Aksi</th>
      </tr></thead><tbody>${tableRows}</tbody>
      <tfoot><tr><td>TOTAL (${tampil.length} BKU)</td><td class="num">${rupiah(tampil.reduce((s, r) => s + r.pos.saldoAwal, 0))}</td>
        <td class="num">${rupiah(tampil.reduce((s, r) => s + r.pos.masuk, 0))}</td>
        <td class="num">${rupiah(tampil.reduce((s, r) => s + r.pos.keluar, 0))}</td>
        <td class="num">${rupiah(tampil.reduce((s, r) => s + r.pos.saldoBuku, 0))}</td><td colspan="3"></td></tr></tfoot></table></div>`
        : ui.emptyState('Tidak ada BKU pada periode ini', 'Pilih periode lain atau centang "semua BKU" untuk menampilkan seluruh buku kas.')}
      ${laterModals.join('')}
      ${tampil.some(r => r.status !== 'ditutup' && r.b.status === 'aktif') ? `
      <form method="post" action="${c.base}/tutup-bulanan/tutup-massal" id="fMassal">
        <input type="hidden" name="periode" value="${esc(periode)}">
      </form>
      <div class="bulk-bar">
        <div class="small muted">Centang beberapa BKU pada kolom paling kiri, lalu tutup sekaligus — tersedia <b>Opsi A (rollover saldo buku)</b> maupun <b>Opsi B (opnam kas riil + berita acara)</b> seperti penutupan satu per satu.</div>
        <button type="button" class="btn btn-primary" data-open="mMassalTutup">${ui.icon('lock')}Tutup BKU Terpilih</button>
      </div>` : ''}
      ${tampil.some(r => r.status !== 'ditutup' && r.b.status === 'aktif') ? ui.modal('mMassalTutup', {
        title: 'Tutup BKU Terpilih — Pilih Mekanisme',
        wide: true,
        body: `<div class="alert info">${ui.icon('info')}<div>BKU yang diproses adalah yang <b>dicentang</b> pada tabel (kolom paling kiri).
          Mekanisme di bawah berlaku untuk semua BKU terpilih — sama seperti penutupan satu per satu.</div></div>
        <div class="field"><label>Mekanisme Penutupan</label>
          <div class="radio-cards" style="grid-template-columns:1fr">
            <input type="radio" name="metode_massal" id="mtMassA" value="rollover" form="fMassal" checked>
            <label for="mtMassA"><span class="dot"></span><span>Opsi A — Lanjutkan Sisa Saldo Buku (Otomatis)<br>
              <span class="small muted" style="font-weight:500">Saldo buku tiap BKU 100% menjadi saldo awal bulan berikutnya.</span></span></label>
            <input type="radio" name="metode_massal" id="mtMassB" value="opnam" form="fMassal">
            <label for="mtMassB"><span class="dot"></span><span>Opsi B — Penyesuaian Kas Riil (Opnam Kas)<br>
              <span class="small muted" style="font-weight:500">Isi uang tunai &amp; saldo bank riil tiap BKU; selisih dibukukan otomatis.</span></span></label>
          </div>
        </div>
        <div class="field"><label>Format Nomor Berita Acara</label>
          <input name="ba_pattern" form="fMassal" value="BA-{jenis}/{kode}/{periode}" class="mb-0">
          <div class="hint">Placeholder: <b>{kode}</b> kode BKU · <b>{periode}</b> periode (mis. 202611) · <b>{jenis}</b> ROLL/OPNAM · <b>{nama}</b> nama BKU.</div></div>
        <div data-massal-opnam style="display:none">
          <div class="alert warn">${ui.icon('alert')}<div>Isi kas riil untuk setiap BKU yang dicentang. Selisih terhadap saldo buku akan dibukukan sebagai
            <b>Selisih Kas Lebih (9.2.01)</b> / <b>Kurang (9.2.02)</b> pada akhir periode.</div></div>
          <div class="table-wrap table-scroll short"><table><thead><tr><th>Buku Kas</th><th class="num">Saldo Buku</th>
            <th>Uang Tunai Riil</th><th>Saldo Bank Riil</th><th>Alasan Selisih</th></tr></thead><tbody>
            ${tampil.filter(r => r.status !== 'ditutup' && r.b.status === 'aktif').map(r => {
          const isBank = /bank/i.test(r.b.nama);
          return `<tr>
              <td class="t-strong">${esc(r.b.nama)}<div class="t-sub mono">${esc(r.b.kode || '')}</div></td>
              <td class="num">${rupiah(r.pos.saldoBuku)}</td>
              <td>${ui.moneyInput('opnam_tunai_' + r.b.id, isBank ? 0 : r.pos.saldoBuku, 'form="fMassal" placeholder="0"')}</td>
              <td>${ui.moneyInput('opnam_bank_' + r.b.id, isBank ? r.pos.saldoBuku : 0, 'form="fMassal" placeholder="0"')}</td>
              <td><input name="alasan_${r.b.id}" form="fMassal" placeholder="opsional bila selisih 0" style="min-width:150px"></td>
            </tr>`;
        }).join('')}
          </tbody></table></div>
          <div class="field"><label>Selisih Dibukukan Pada</label>
            <select name="metode_penyesuaian" form="fMassal"><option value="tunai">Kas Tunai</option><option value="transfer">Rekening Bank</option></select></div>
        </div>`,
        footer: `<button class="btn" type="button" data-close="mMassalTutup">Batal</button>
          <button class="btn btn-primary" type="submit" form="fMassal">${ui.icon('lock')}Tutup BKU Terpilih</button>`
      }) : ''}
      <p class="help mt-2">Aturan: transaksi pada bulan yang sudah berganti otomatis <b>diblokir</b> sampai BKU bulan tersebut ditutup. Setelah ditutup, transaksi periode itu terkunci dan hanya bisa dibuka kembali oleh Super Admin/Bendahara Utama.</p>
    </div>

    <div class="card">
      <div class="card-head"><div><h3>Riwayat Tutup BKU Bulanan</h3><div class="sub">Saldo awal hasil rollover &amp; penyesuaian opnam kas</div></div></div>
      ${riwayat.length ? `<div class="table-wrap"><table><thead><tr>
        <th>Periode</th><th>BKU</th><th class="num">Saldo Buku</th><th>Metode</th><th class="num">Kas Riil</th><th>Selisih</th><th class="num">Saldo Awal Berikutnya</th><th class="right">Aksi</th>
      </tr></thead><tbody>
      ${riwayat.map(p => `<tr>
        <td class="t-strong nowrap">${esc(dbm.periodeLabel(p.periode))}</td>
        <td>${esc(p.bku_nama)}</td>
        <td class="num">${rupiah(p.saldo_buku)}</td>
        <td>${p.metode === 'opnam' ? ui.badge('Opnam Kas', 'orange') : ui.badge('Rollover', 'blue')}</td>
        <td class="num">${p.metode === 'opnam' ? rupiah((p.opnam_bank || 0) + (p.opnam_tunai || 0)) : '—'}</td>
        <td>${selisihBadge(p.selisih)}${p.alasan ? `<div class="t-sub">${esc(p.alasan)}</div>` : ''}</td>
        <td class="num t-strong">${rupiah(p.saldo_akhir)}</td>
        <td class="right nowrap">
          <a class="btn btn-sm" target="_blank" href="${c.base}/bku/${p.bku_id}/berita-acara-bulanan?periode=${esc(p.periode)}">${ui.icon('printer')}</a>
          ${p.status === 'ditutup' && can(req.user, 'tutup_bulanan', 'edit') ? `<form method="post" action="${c.base}/tutup-bulanan/buka" style="display:inline" data-confirm="Buka kembali ${esc(dbm.periodeLabel(p.periode))} — ${esc(p.bku_nama)}?"><input type="hidden" name="bku_id" value="${p.bku_id}"><input type="hidden" name="periode" value="${p.periode}"><button class="btn btn-sm btn-soft">${ui.icon('unlock')}</button></form>` : ''}
        </td></tr>`).join('')}
      </tbody></table></div>` : ui.emptyState('Belum ada riwayat tutup bulanan', 'Tutup BKU bulanan pertama Anda untuk melihat riwayat di sini.')}
    </div>`;

    page(req, res, {
      title: 'Tutup BKU Bulanan', sub: 'Monthly closing, rollover saldo awal & penyesuaian selisih kas',
      active: 'tutup_bulanan', content
    });
  });

  function nextPeriodeLabel(p) {
    const [y, m] = p.split('-').map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  }

  /* ================= aksi tutup ================= */
  post('/tutup-bulanan/tutup', (req, res) => {
    if (!guard(req, res, 'tutup_bulanan', 'create')) return;
    const { bku_id, periode, metode, opnam_tunai, opnam_bank, alasan, metode_penyesuaian, berita_acara_no } = req.body;
    if (!/^\d{4}-\d{2}$/.test(periode || '')) return res.redirect(req.BASE + '/tutup-bulanan?err=' + encodeURIComponent('Periode tidak valid.'));
    let hasil;
    try {
      hasil = db.transaction(() => dbm.closePeriode(Number(bku_id), periode, {
        metode, opnam_tunai, opnam_bank, alasan, metode_penyesuaian, berita_acara_no
      }, req.user))();
    } catch (e) {
      return res.redirect(req.BASE + '/tutup-bulanan?periode=' + periode + '&err=' + encodeURIComponent(e.message));
    }
    const msg = Math.abs(hasil.selisih) >= 1
      ? `BKU ditutup. Selisih kas ${hasil.selisih > 0 ? 'lebih' : 'kurang'} ${rupiah(Math.abs(hasil.selisih))} telah dibukukan, saldo awal bulan berikutnya ${rupiah(hasil.saldoAkhir)}.`
      : `BKU ditutup. Saldo ${rupiah(hasil.saldoAkhir)} menjadi saldo awal bulan berikutnya.`;
    res.redirect(req.BASE + `/bku/${bku_id}/berita-acara-bulanan?periode=${periode}&ok=` + encodeURIComponent(msg));
  });

  /* ================= aksi tutup massal ================= */
  post('/tutup-bulanan/tutup-massal', (req, res) => {
    if (!guard(req, res, 'tutup_bulanan', 'create')) return;
    const periode = req.body.periode;
    if (!/^\d{4}-\d{2}$/.test(periode || '')) return res.redirect(req.BASE + '/tutup-bulanan?err=' + encodeURIComponent('Periode tidak valid.'));
    const ids = Object.keys(req.body).filter(k => /^pilih_\d+$/.test(k) && req.body[k]).map(k => Number(k.slice(6)));
    if (!ids.length) return res.redirect(req.BASE + `/tutup-bulanan?periode=${periode}&err=` + encodeURIComponent('Pilih minimal satu BKU yang akan ditutup.'));
    /* mekanisme penutupan: Opsi A (rollover) atau Opsi B (opnam kas riil) — sama seperti per BKU */
    const metode = String(req.body.metode_massal || req.body.metode || 'rollover') === 'opnam' ? 'opnam' : 'rollover';
    const pola = String(req.body.ba_pattern || '').trim() || (metode === 'opnam' ? 'BA-OPNAM/{kode}/{periode}' : 'BA-ROLL/{kode}/{periode}');
    const baOf = (b, jenis) => pola
      .replace(/\{kode\}/gi, b.kode || 'BKU')
      .replace(/\{periode\}/gi, periode.replace('-', ''))
      .replace(/\{jenis\}/gi, jenis)
      .replace(/\{nama\}/gi, b.nama || '')
      .slice(0, 80);
    let ok = 0, total = 0, totalSelisih = 0;
    const gagal = [];
    for (const id of ids) {
      const b = db.prepare('SELECT * FROM bku WHERE id=?').get(id);
      if (!b) continue;
      if (dbm.periodeStatus(id, periode) === 'ditutup') { gagal.push(`${b.nama} (sudah ditutup)`); continue; }
      try {
        const pos = dbm.periodePosisi(id, periode);
        const opt = { metode, berita_acara_no: baOf(b, metode === 'opnam' ? 'OPNAM' : 'ROLL') };
        if (metode === 'opnam') {
          opt.opnam_tunai = lib.parseMoney(req.body['opnam_tunai_' + id]);
          opt.opnam_bank = lib.parseMoney(req.body['opnam_bank_' + id]);
          opt.alasan = String(req.body['alasan_' + id] || req.body.alasan || '').trim();
          opt.metode_penyesuaian = String(req.body.metode_penyesuaian || 'tunai') === 'transfer' ? 'transfer' : 'tunai';
        }
        const hasil = db.transaction(() => dbm.closePeriode(id, periode, opt, req.user))();
        ok++;
        total += pos.saldoBuku;
        totalSelisih += Number(hasil && hasil.selisih) || 0;
      } catch (e) {
        gagal.push(`${b.nama} (${e.message})`);
      }
    }
    dbm.logAudit(req.user, 'TUTUP BULAN', 'tutup_bulanan',
      `Tutup massal periode ${dbm.periodeLabel(periode)} (${metode === 'opnam' ? 'Opsi B — opnam' : 'Opsi A — rollover'}): ${ok} dari ${ids.length} BKU berhasil`);
    const q = [];
    if (ok) q.push('ok=' + encodeURIComponent(
      `${ok} BKU periode ${dbm.periodeLabel(periode)} ditutup dengan ${metode === 'opnam' ? 'Opsi B (opnam kas riil)' : 'Opsi A (rollover saldo buku)'}`
      + `${metode === 'opnam' && Math.abs(totalSelisih) >= 1 ? ` — total selisih ${rupiah(totalSelisih)} telah dibukukan` : ''}.`));
    if (gagal.length) q.push('err=' + encodeURIComponent(`${gagal.length} BKU gagal ditutup: ${gagal.slice(0, 4).join('; ')}${gagal.length > 4 ? '…' : ''}`));
    res.redirect(req.BASE + `/tutup-bulanan?periode=${periode}&semua=1&` + (q.join('&') || 'ok=' + encodeURIComponent('Tidak ada BKU yang ditutup.')));
  });

  post('/tutup-bulanan/buka', (req, res) => {
    if (!guard(req, res, 'tutup_bulanan', 'edit')) return;
    const { bku_id, periode } = req.body;
    // kembali ke halaman asal bila unlock dilakukan dari daftar transaksi
    const backRaw = String(req.body.back || '');
    const backPath = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/.test(backRaw) && !backRaw.startsWith('//') ? backRaw : null;
    const go = (msg, key) => {
      if (backPath) return res.redirect(req.BASE + flashUrl(backPath, key, msg));
      return res.redirect(req.BASE + flashUrl('/tutup-bulanan?periode=' + periode, key, msg));
    };
    const b = db.prepare('SELECT * FROM bku WHERE id=?').get(bku_id);
    if (!b) return go('BKU tidak ditemukan.', 'err');
    if (!/^\d{4}-\d{2}$/.test(String(periode || ''))) return go('Periode tidak valid.', 'err');
    const row = dbm.periodeRow(Number(bku_id), periode);
    if (!row) return go('Periode belum pernah ditutup — transaksi bulan tersebut tidak terkunci.', 'err');
    db.prepare("UPDATE bku_periode SET status='dibuka' WHERE id=?").run(row.id);
    dbm.logAudit(req.user, 'BUKA BULAN', 'tutup_bulanan',
      `Membuka kunci (unlock) periode ${dbm.periodeLabel(periode)} pada BKU ${b.nama} untuk koreksi`);
    go(`Kunci periode ${dbm.periodeLabel(periode)} dibuka. Transaksi bulan tersebut kini dapat diedit — jangan lupa tutup kembali bila koreksi selesai.`, 'ok');
  });

  /* ================= berita acara ================= */
  get('/bku/:id/berita-acara-bulanan', (req, res) => {
    guard(req, res, 'tutup_bulanan', 'view');
    const c = ctx(req);
    const b = db.prepare('SELECT * FROM bku WHERE id=?').get(req.params.id);
    if (!b) return res.notFound();
    const periode = /^\d{4}-\d{2}$/.test(req.query.get('periode') || '') ? req.query.get('periode') : null;
    if (!periode) return res.redirect(req.BASE + '/tutup-bulanan?err=' + encodeURIComponent('Periode berita acara tidak valid.'));
    const row = dbm.periodeRow(b.id, periode);
    const ta = db.prepare('SELECT * FROM tahun_ajaran WHERE id=?').get(b.tahun_ajaran_id) || {};
    const pos = row
      ? { saldoAwal: row.saldo_awal, masuk: row.total_masuk, keluar: row.total_keluar, saldoBuku: row.saldo_buku }
      : dbm.periodePosisi(b.id, periode);
    const hasilRow = row || { metode: 'rollover', selisih: 0, opnam_tunai: null, opnam_bank: null, alasan: '', saldo_akhir: pos.saldoBuku, berita_acara_no: '', ditutup_at: todayISO(), ditutup_oleh: c.settings.sekolah_bendahara };
    const tunai = hasilRow.opnam_tunai || 0;
    const bank = hasilRow.opnam_bank || 0;
    const riil = tunai + bank;
    const selisih = Number(hasilRow.selisih) || 0;
    const adaOpnam = hasilRow.metode === 'opnam';
    const periodeNext = nextPeriodeLabel(periode);

    const body = `
      <p style="font-size:12.8px;text-align:justify;margin-top:12px">Pada hari ini, ${lib.tglID(hasilRow.ditutup_at || todayISO())}, telah dilakukan
      <b>penutupan kas sekaligus stock opname (opnam kas)</b> atas <b>${esc(b.nama)}</b>
      ${b.jenis === 'umum' ? '(Buku Kas Umum)' : '(Buku Kas Kegiatan Khusus)'} untuk periode
      <b>${esc(dbm.periodeLabel(periode))}</b> Tahun Ajaran <b>${esc(ta.nama || '-')}</b>, dengan hasil sebagai berikut:</p>

      <table class="doc-tbl">
        <thead><tr><th colspan="2">A. SALDO MENURUT BUKU</th></tr></thead>
        <tbody>
          <tr><td>Saldo Awal ${esc(dbm.periodeLabel(periode))}</td><td class="num" style="width:38%">${rupiah(pos.saldoAwal)}</td></tr>
          <tr><td>Total Penerimaan</td><td class="num">${rupiah(pos.masuk)}</td></tr>
          <tr><td>Total Pengeluaran</td><td class="num">(${rupiah(pos.keluar)})</td></tr>
          <tr><td><b>Saldo Menurut Buku</b></td><td class="num"><b>${rupiah(pos.saldoBuku)}</b></td></tr>
        </tbody>
      </table>

      <table class="doc-tbl">
        <thead><tr><th colspan="2">B. SALDO UANG RIIL (HASIL OPNAM KAS)</th></tr></thead>
        <tbody>
          <tr><td>Uang Tunai di Brankas</td><td class="num" style="width:38%">${adaOpnam ? rupiah(tunai) : '— (tidak dilakukan opnam)'}</td></tr>
          <tr><td>Saldo Rekening Bank</td><td class="num">${adaOpnam ? rupiah(bank) : '—'}</td></tr>
          <tr><td><b>Total Kas Riil (Bank + Tunai)</b></td><td class="num"><b>${adaOpnam ? rupiah(riil) : rupiah(pos.saldoBuku)}</b></td></tr>
        </tbody>
      </table>

      <table class="doc-tbl">
        <thead><tr><th colspan="2">C. SELISIH KAS</th></tr></thead>
        <tbody>
          <tr><td>Selisih (Kas Riil − Saldo Buku)</td>
            <td class="num" style="width:38%"><b>${Math.abs(selisih) < 1 ? 'Rp 0 (Nihil)' : (selisih > 0 ? 'Kas Lebih ' : 'Kas Kurang ') + rupiah(Math.abs(selisih))}</b></td></tr>
          <tr><td>Alasan / Keterangan Penyesuaian</td><td class="num" style="text-align:left">${esc(hasilRow.alasan || 'Tidak ada selisih — saldo buku sesuai kas riil')}</td></tr>
          <tr><td>Metode Penentuan Saldo Awal ${esc(dbm.periodeLabel(periodeNext))}</td>
            <td style="text-align:left">${adaOpnam ? 'Opsi B — Penyesuaian Kas Riil (opnam kas)' : 'Opsi A — Melanjutkan Sisa Saldo Buku'}</td></tr>
          <tr><td><b>Saldo Awal ${esc(dbm.periodeLabel(periodeNext))}</b></td><td class="num"><b>${rupiah(hasilRow.saldo_akhir)}</b></td></tr>
        </tbody>
      </table>

      <p style="font-size:12.8px;text-align:justify">${Math.abs(selisih) < 1
        ? `Berdasarkan hasil perhitungan fisik, saldo kas riil <b>sama dengan</b> saldo menurut buku sebesar <b>${rupiah(pos.saldoBuku)}</b> (${esc(terbilangRupiah(pos.saldoBuku))}). Buku kas periode ${esc(dbm.periodeLabel(periode))} dinyatakan <b>ditutup</b> dan saldo tersebut menjadi saldo awal periode berikutnya.`
        : `Terdapat selisih kas ${selisih > 0 ? '<b>lebih</b>' : '<b>kurang</b>'} sebesar <b>${rupiah(Math.abs(selisih))}</b> (${esc(terbilangRupiah(Math.abs(selisih)))}). Selisih tersebut telah dibukukan sebagai transaksi penyesuaian ${selisih > 0 ? 'Selisih Kas Lebih' : 'Selisih Kas Kurang'} dengan alasan: <i>${esc(hasilRow.alasan || '-')}</i>. Dengan demikian saldo awal periode ${esc(dbm.periodeLabel(periodeNext))} ditetapkan sebesar <b>${rupiah(hasilRow.saldo_akhir)}</b> (${esc(terbilangRupiah(hasilRow.saldo_akhir))}).`}</p>

      <p style="font-size:12.8px">Demikian berita acara ini dibuat dengan sebenarnya untuk dipergunakan sebagaimana mestinya.</p>

      ${ui.signBlock(c.settings, { tempat: '', tanggal: lib.tglID(hasilRow.ditutup_at || todayISO()) })}
      <div style="margin-top:26px;font-size:11.5px;color:#4A3A30;border-top:1px solid #D8C6B8;padding-top:8px">
        Dicatat oleh: <b>${esc(hasilRow.ditutup_oleh || '-')}</b> · Dokumen ini dihasilkan otomatis oleh SIMKEU Sekolah.
      </div>`;

    res.html(ui.docPage({
      settings: c.settings, base: c.base,
      title: 'Berita Acara Penutupan Kas & Selisih Opnam Kas',
      no: `Nomor: ${hasilRow.berita_acara_no || '-'} · Periode ${dbm.periodeLabel(periode)}`,
      body, backHref: '/tutup-bulanan?periode=' + periode, orient: 'portrait', selfPath: req.url
    }));
  });
};
