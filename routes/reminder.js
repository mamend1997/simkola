'use strict';
/**
 * ==================================================================
 * JADWAL PENGINGAT TAGIHAN (Broadcast Scheduler) + KIRIM WA
 * ------------------------------------------------------------------
 *   GET  /iuran/pengingat                 halaman pengaturan & riwayat
 *   POST /iuran/pengingat/simpan          simpan jadwal + template
 *   POST /iuran/pengingat/jalan           jalankan sekarang (masuk antrean)
 *   POST /iuran/pengingat/template        tambah/ubah template pesan
 *   POST /iuran/pengingat/template/hapus  hapus template
 *   POST /iuran/pengingat/riwayat         kirim ulang gagal / hapus riwayat
 *   POST /iuran/wa/satu                   kirim WA satu siswa (modal per baris)
 *   POST /iuran/wa/massal                 kirim WA massal (ceklis / filter / template)
 *
 * Semua pengiriman hanya MENYUSUN pesan lalu memasukkannya ke antrean
 * (`wa_reminder_log`), worker latar (reminder.js) yang mengirim dengan jeda
 * acak 2–5 detik sehingga request tidak menggantung.
 * ==================================================================
 */
const reminder = require('../reminder');
const wa = require('../wa');

module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl }) => {
  const { db } = dbm;
  const { esc, rupiah, tglID, nowStamp } = lib;

  const BACK = '/iuran/pengingat';
  const safeBack = (raw, def) => {
    const s = String(raw || '').trim();
    return /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/.test(s) && !s.startsWith('//') ? s : def;
  };

  /** siswa + kelas efektif untuk tahun pelajaran aktif */
  function siswaRow(id) {
    const s = db.prepare(`SELECT s.*, k.nama kelas_nama, k.tingkat FROM siswa s
      LEFT JOIN kelas k ON k.id=s.kelas_id WHERE s.id=?`).get(Number(id) || 0);
    return s || null;
  }

  /* ================= HALAMAN JADWAL ================= */
  get(BACK, (req, res) => {
    guard(req, res, 'iuran', 'view');
    const c = ctx(req);
    const canEdit = c.can('iuran', 'edit');
    const cfg = reminder.config(dbm);
    const stats = reminder.logStats(dbm);
    const gateway = wa.waConfig();
    const tplRows = reminder.templateRows(dbm);
    const stFilter = String(req.query.get('status') || '');
    const qLog = String(req.query.get('q') || '');
    const logs = reminder.logRows(dbm, { status: stFilter, q: qLog, limit: 120 });

    // contoh data untuk pratinjau variabel
    const sample = dbm.iuranTagihanRows({ aktifOnly: true }).find(r => Number(r.sisa || 0) > 0);
    const sampleSiswa = sample ? siswaRow(sample.siswa_id) : null;
    const preview = sampleSiswa
      ? reminder.buildMessage(dbm, sampleSiswa, { template: cfg.template, baseUrl: reminder.absBase(dbm, req) })
      : null;
    // variabel contoh untuk tombol pratinjau di sisi klien
    const sampleVars = {
      nama_siswa: sampleSiswa ? sampleSiswa.nama : 'Ahmad Fauzi',
      kelas: sampleSiswa ? (sampleSiswa.kelas_nama || '-') : 'X TKJ 1',
      nisn: sampleSiswa ? (sampleSiswa.nisn || '-') : '0012345678',
      nominal_tunggakan: preview ? rupiah(preview.nominal) : rupiah(450000),
      rincian_tagihan: preview ? reminder.rincianText(preview.items) : '- SPP November 2026: Rp 150.000',
      link_portal: reminder.portalLink(dbm, sampleSiswa ? sampleSiswa.id : 1, { baseUrl: reminder.absBase(dbm, req) }),
      nama_sekolah: c.settings.sekolah_nama || 'Sekolah',
      tanggal: tglID(lib.todayISO())
    };

    const statCard = (label, val, ico, tone) => `<div class="kpi ic-${tone}"><div class="ico">${ui.icon(ico)}</div>
      <div class="lbl">${esc(label)}</div><div class="val" style="font-size:21px">${val}</div></div>`;

    const modeRow = (val, label, hint) => `<div class="radio-cards" style="grid-template-columns:1fr">
      <input type="radio" id="mode_${val}" name="reminder_mode" value="${val}" ${cfg.mode === val ? 'checked' : ''} ${canEdit ? '' : 'disabled'}>
      <label for="mode_${val}"><span class="dot"></span><span><b>${esc(label)}</b><br><span class="small muted">${esc(hint)}</span></span></label>
    </div>`;

    const content = `<div data-wa-tpl-vars="${esc(JSON.stringify(sampleVars))}" style="display:none"></div>
    <div class="kpi-grid mb-3" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
      ${statCard('Total Pesan', stats.total, 'send', 'orange')}
      ${statCard('Menunggu / Antrean', stats.pending + (stats.sending || 0), 'clock', 'amber')}
      ${statCard('Terkirim', stats.sent, 'check', 'green')}
      ${statCard('Gagal', stats.failed, 'alert', 'red')}
    </div>

    ${gateway.url ? `<div class="alert info">${ui.icon('send')}<div><b>Gateway WhatsApp aktif</b> (${gateway.source === 'pusat' ? 'gateway pusat Super Admin' : gateway.source === 'env' ? 'variabel lingkungan .env' : 'pengaturan sekolah ini'}):
      <code>${esc(String(gateway.url).replace(/token=[^&]+/i, 'token=***'))}</code> · format <code>${esc(gateway.payload)}</code>.</div></div>` : ''}
    ${!gateway.url ? `<div class="alert warn">${ui.icon('alert')}<div><b>Gateway WhatsApp belum diatur.</b>
      Pesan tetap masuk antrean, tetapi akan berstatus <b>Gagal</b> sampai URL gateway &amp; token diisi pada
      <a href="${c.base}/pengguna">Pengaturan Sistem</a> (atau variabel <code>WA_API_URL</code>/<code>WA_API_TOKEN</code> di <code>.env</code>,
      atau gateway pusat oleh Super Admin).</div></div>` : ''}

    <div class="split">
      <div class="card mb-3">
        <div class="card-head"><div><h3>Jadwal Pengingat Tagihan</h3>
          <div class="sub">Pengiriman otomatis pesan WhatsApp kepada orang tua/wali siswa</div></div>
          ${cfg.aktif ? ui.badge('Aktif', 'green') : ui.badge('Nonaktif', 'gray')}</div>
        <form method="post" action="${c.base}${BACK}/simpan" id="fReminder">
          <div class="toggle-form mb-2">
            <div><div class="t-strong">Status Pengingat Otomatis</div>
              <div class="small muted">Bila aktif, sistem mengirim pesan otomatis sesuai jadwal di bawah.</div></div>
            <label class="toggle-switch"><input type="checkbox" name="reminder_aktif" value="1" ${cfg.aktif ? 'checked' : ''} ${canEdit ? '' : 'disabled'}><i></i></label>
          </div>
          <div class="field"><label>Waktu Eksekusi</label>
            ${modeRow('tanggal', 'Rutin Bulanan', 'Kirim pada tanggal tertentu setiap bulan')}
            <div class="row2 mt-1">
              <div class="field"><label>Tanggal Kirim (1–28)</label>
                <input type="number" name="reminder_tanggal" min="1" max="28" value="${cfg.tanggal}" ${canEdit ? '' : 'readonly'}>
                <div class="hint">Contoh: <b>5</b> → pesan dikirim setiap tanggal 5.</div></div>
              <div class="field"><label>Jam Pengiriman</label>
                <input type="time" name="reminder_jam" value="${esc(cfg.jam)}" ${canEdit ? '' : 'readonly'}>
                <div class="hint">Waktu server (WIB bila server diset Asia/Jakarta).</div></div>
            </div>
            ${modeRow('tempo', 'Relatif Jatuh Tempo (H-X)', 'Kirim H-X sebelum tanggal jatuh tempo tagihan')}
            <div class="row2 mt-1">
              <div class="field"><label>Kirim H-X Hari Sebelum Jatuh Tempo</label>
                <input type="number" name="reminder_tempo_hari" min="0" max="30" value="${cfg.tempoHari}" ${canEdit ? '' : 'readonly'}>
                <div class="hint">Contoh: <b>3</b> → jatuh tempo tanggal 10, pesan dikirim tanggal 7.</div></div>
              <div class="field"><label>Jatuh Tempo Bawaan (tanggal)</label>
                <input type="number" name="iuran_jatuh_tempo" min="1" max="28" value="${cfg.jatuhTempo}" ${canEdit ? '' : 'readonly'}>
                <div class="hint">Dipakai bila grup iuran belum punya tanggal jatuh tempo sendiri.</div></div>
            </div>
            ${modeRow('keduanya', 'Keduanya', 'Jalankan rutin bulanan DAN pengingat H-X')}
          </div>
          <hr class="sep">
          <div class="row2">
            <div class="field"><label>Alamat Dasar Tautan Portal (untuk {link_portal})</label>
              <input name="reminder_base_url" value="${esc(cfg.baseUrl)}" placeholder="https://sekolah.simkeu.com" ${canEdit ? '' : 'readonly'}>
              <div class="hint">Kosongkan untuk memakai <code>APP_BASE_URL</code> dari <code>.env</code>.</div></div>
            <div class="field"><label>Retensi Riwayat Pengiriman (hari)</label>
              <input type="number" name="wa_log_retensi" min="7" max="3650" value="${cfg.retensi}" ${canEdit ? '' : 'readonly'}>
              <div class="hint">Riwayat lebih tua dari ini otomatis dibersihkan.</div></div>
          </div>
          <div class="form-actions">${canEdit ? `<button class="btn btn-primary">${ui.icon('save')}Simpan Pengaturan &amp; Template</button>` : ''}</div>
        </form>
        <hr class="sep">
        <form method="post" action="${c.base}${BACK}/jalan" data-confirm="Kirim pengingat sekarang ke SEMUA siswa yang masih punya tunggakan? Pesan akan masuk antrean pengiriman.">
          <div class="between">
            <div><div class="t-strong">Jalankan Sekarang</div>
              <div class="small muted">Menyusun pesan untuk semua siswa bertunggakan lalu memasukkannya ke antrean (tidak menunggu jadwal).</div></div>
            <div class="toolbar">
              ${canEdit ? `<button class="btn btn-sm" form="fCekJadwal">${ui.icon('calendar_clock')}Cek Jadwal Hari Ini</button>` : ''}
              ${canEdit ? `<button class="btn">${ui.icon('play')}Kirim Sekarang</button>` : ''}
            </div>
          </div>
        </form>
        <form method="post" action="${c.base}${BACK}/jadwal" id="fCekJadwal" class="mt-1"
          data-confirm="Jalankan pengecekan jadwal untuk hari ini? Pesan hanya dibuat bila jadwal jatuh tempo.">
          <div class="small muted">Tombol <b>Cek Jadwal Hari Ini</b> menjalankan logika penjadwalan secara manual (tanpa menunggu cron),
            berguna untuk memastikan konfigurasi tanggal/jam sudah benar.</div>
        </form>
      </div>

      <div class="card mb-3">
        <div class="card-head"><div><h3>Template Pesan</h3>
          <div class="sub">Klik tombol variabel untuk menyisipkan tag otomatis ke dalam pesan</div></div>
          ${ui.badge('Dinamis', 'orange', 'plain')}</div>
        <form method="post" action="${c.base}${BACK}/template-utama" id="fReminderTpl">
          <div class="field"><label>Draf Pesan WhatsApp</label>
            <textarea name="reminder_template" id="tplIsi" rows="12" ${canEdit ? '' : 'readonly'}
              style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;line-height:1.55">${esc(cfg.template)}</textarea>
            <div class="hint">Gunakan <code>*teks*</code> untuk tebal dan <code>_teks_</code> untuk miring (format WhatsApp).</div></div>
          <div class="tag-bank">
            ${reminder.VARS.map(v => `<button type="button" class="tag-chip" data-tpl-tag="${esc(v.tag)}" title="${esc(v.note)}">${esc(v.tag)}</button>`).join('')}
          </div>
          <div class="card" style="box-shadow:none;background:var(--o-50);margin-top:10px">
            <div class="t-sub mb-1">PRATINJAU PESAN</div>
            <div class="wa-bubble" data-tpl-preview>${esc(reminder.fillTemplate(cfg.template, sampleVars))}</div>
          </div>
          <div class="form-actions">${canEdit ? `<button class="btn btn-primary">${ui.icon('save')}Simpan Template</button>` : ''}</div>
        </form>
        <hr class="sep">
        <div class="card-head" style="padding:0 0 8px"><div><h3>Template Tersimpan</h3>
          <div class="sub">Pilih template siap pakai saat mengirim WA massal</div></div></div>
        ${tplRows.length ? `<div class="table-wrap short"><table><thead><tr><th>Nama</th><th>Ringkasan Isi</th><th class="right">Aksi</th></tr></thead><tbody>
          ${tplRows.map(t => `<tr>
            <td class="t-strong">${esc(t.nama)}</td>
            <td class="small">${esc(String(t.isi || '').replace(/\s+/g, ' ').slice(0, 90))}…</td>
            <td class="right nowrap">
              ${canEdit ? `<button type="button" class="btn btn-sm" data-tpl-load="${esc(t.isi)}" data-tpl-name="${esc(t.nama)}">${ui.icon('edit')}Muat</button>` : ''}
              ${canEdit ? `<form method="post" action="${c.base}${BACK}/template/hapus" style="display:inline" data-confirm="Hapus template ${esc(t.nama)}?">
                <input type="hidden" name="id" value="${t.id}"><button class="btn btn-sm btn-danger">${ui.icon('trash')}</button></form>` : ''}
            </td></tr>`).join('')}
        </tbody></table></div>` : '<div class="help">Belum ada template tersimpan.</div>'}
        ${canEdit ? `<details class="mt-2"><summary class="small" style="cursor:pointer">Tambah template baru</summary>
          <form method="post" action="${c.base}${BACK}/template" class="mt-1">
            <div class="field"><label>Nama Template</label><input name="nama" required maxlength="80" placeholder="Template SPP Bulanan"></div>
            <div class="field"><label>Isi Pesan</label><textarea name="isi" rows="5" required placeholder="Gunakan {nama_siswa}, {kelas}, {nominal_tunggakan}, {rincian_tagihan}, {link_portal}, {nama_sekolah}"></textarea></div>
            <button class="btn btn-primary">${ui.icon('plus')}Simpan Template Baru</button>
          </form>
        </details>` : ''}
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div><h3>Riwayat Pengiriman (Broadcast History)</h3>
        <div class="sub">${logs.length} baris terakhir · status antrean diproses worker latar dengan jeda acak 2–5 detik</div></div>
        <div class="toolbar">
          ${canEdit && stats.failed ? `<form method="post" action="${c.base}${BACK}/riwayat" style="display:inline">
            <input type="hidden" name="aksi" value="retry"><button class="btn btn-sm">${ui.icon('refresh')}Kirim Ulang Gagal (${stats.failed})</button></form>` : ''}
          ${canEdit ? `<form method="post" action="${c.base}${BACK}/riwayat" style="display:inline" data-confirm="Hapus riwayat pengiriman yang sudah terkirim/gagal?">
            <input type="hidden" name="aksi" value="bersih"><button class="btn btn-sm btn-danger">${ui.icon('trash')}Hapus Riwayat</button></form>` : ''}
        </div></div>
      <form method="get" action="${c.base}${BACK}" class="filterbar">
        <div class="field"><label>Status</label><select name="status" data-autosubmit>
          <option value="">Semua status</option>
          ${Object.entries(reminder.STATUS).map(([k, v]) => `<option value="${k}" ${stFilter === k ? 'selected' : ''}>${esc(v[0])}</option>`).join('')}
        </select></div>
        <div class="field"><label>Cari Nama / Nomor</label><input name="q" value="${esc(qLog)}" placeholder="Nama siswa atau 628…"></div>
        <button class="btn">${ui.icon('search')}Filter</button>
        ${stFilter || qLog ? `<a class="btn" href="${c.base}${BACK}">Reset</a>` : ''}
      </form>
      ${logs.length ? `<div class="table-scroll tall"><table id="tblWALog"><thead><tr>
        <th class="nowrap">Tanggal Kirim</th><th>Nama Siswa</th><th>No. HP Orang Tua</th><th>Kelas</th>
        <th class="num">Nominal</th><th>Status</th><th>Pesan Error</th><th class="right">Aksi</th>
      </tr></thead><tbody>
        ${logs.map(r => {
      const st = reminder.STATUS[r.status] || [r.status, 'gray'];
      return `<tr>
        <td class="nowrap small">${esc(lib.stampShort(r.sent_at || r.created_at))}</td>
        <td class="t-strong">${esc(r.nama || '-')}</td>
        <td class="mono small">${esc(lib.phoneDisplay(r.phone) || '-')}</td>
        <td class="small">${esc(r.kelas || '-')}</td>
        <td class="num">${rupiah(r.nominal)}</td>
        <td>${ui.badge(st[0], st[1])}<div class="t-sub">${esc(r.mode === 'jadwal' ? 'Jadwal otomatis' : 'Manual')}</div></td>
        <td class="small" style="max-width:240px">${esc(r.error || '-')}</td>
        <td class="right nowrap"><button type="button" class="btn btn-sm" data-wa-view="${esc(String(r.pesan || '').replace(/"/g, '&quot;'))}" title="Lihat pesan">${ui.icon('eye')}</button></td>
      </tr>`;
    }).join('')}
      </tbody></table></div>` : ui.emptyState('Belum ada riwayat pengiriman', 'Riwayat akan muncul setelah pesan pengingat masuk antrean.')}
      <p class="help mt-2">Status <b>Menunggu</b> berarti pesan sudah masuk antrean dan akan dikirim oleh worker latar.
        Pesan <b>Gagal</b> menyimpan alasan dari gateway (mis. nomor tidak valid / gateway belum diatur).</p>
    </div>
    ${ui.modal('mWaViewTx', {
      title: 'Isi Pesan Terkirim',
      body: `<div class="wa-bubble" data-wa-view-body style="max-width:100%">—</div>`,
      footer: `<button class="btn btn-primary" data-close="mWaViewTx">Tutup</button>`
    })}`;
    page(req, res, {
      title: 'Jadwal Pengingat Tagihan', sub: 'Broadcast WhatsApp otomatis & riwayat pengiriman',
      active: 'iuran_pengingat', content
    });
  });

  /* ================= SIMPAN PENGATURAN ================= */
  post(BACK + '/simpan', (req, res) => {
    if (!guard(req, res, 'iuran', 'edit')) return;
    const errMsg = reminder.saveConfig(dbm, req.body);
    if (errMsg) return res.redirect(req.BASE + flashUrl(BACK, 'err', errMsg));
    const cfg = reminder.config(dbm);
    dbm.logAudit(req.user, 'EDIT', 'iuran',
      `Jadwal pengingat WA: ${cfg.aktif ? 'AKTIF' : 'nonaktif'} · mode ${cfg.mode} · jam ${cfg.jam}` +
      (cfg.mode !== 'tempo' ? ` · tanggal ${cfg.tanggal}` : '') + (cfg.mode !== 'tanggal' ? ` · H-${cfg.tempoHari}` : ''));
    res.redirect(req.BASE + flashUrl(BACK, 'ok', 'Jadwal & template pengingat disimpan.'));
  });

  /* simpan hanya template utama (form editor template) */
  post(BACK + '/template-utama', (req, res) => {
    if (!guard(req, res, 'iuran', 'edit')) return;
    const errMsg = reminder.saveTemplate(dbm, req.body.reminder_template);
    if (errMsg) return res.redirect(req.BASE + flashUrl(BACK, 'err', errMsg));
    dbm.logAudit(req.user, 'EDIT', 'iuran', 'Memperbarui template pesan pengingat WhatsApp');
    res.redirect(req.BASE + flashUrl(BACK, 'ok', 'Template pesan pengingat disimpan.'));
  });

  /* ================= JALANKAN SEKARANG ================= */
  post(BACK + '/jalan', (req, res) => {
    if (!guard(req, res, 'iuran', 'edit')) return;
    const list = reminder.recipients(dbm, {});
    if (!list.length) return res.redirect(req.BASE + flashUrl(BACK, 'warn', 'Tidak ada siswa dengan tunggakan aktif.'));
    const r = reminder.enqueueForSiswa(dbm, list, { mode: 'manual', pemicu: 'Kirim sekarang (tombol jadwal)' });
    dbm.setSetting('reminder_last', nowStamp());
    dbm.logAudit(req.user, 'PENGINGAT WA', 'iuran', `Kirim pengingat sekarang: ${r.queued} pesan masuk antrean, ${r.tanpaNomor} tanpa nomor orang tua`);
    res.redirect(req.BASE + flashUrl(BACK, 'ok',
      `${r.queued} pesan masuk antrean pengiriman` + (r.tanpaNomor ? `, ${r.tanpaNomor} siswa dilewati karena nomor HP orang tua kosong/tidak valid` : '') + '.'));
  });

  /* ================= CEK & JALANKAN JADWAL HARI INI ================= */
  post(BACK + '/jadwal', (req, res) => {
    if (!guard(req, res, 'iuran', 'edit')) return;
    if (!reminder.config(dbm).aktif) {
      return res.redirect(req.BASE + flashUrl(BACK, 'warn', 'Pengingat otomatis masih nonaktif — aktifkan sakelar terlebih dahulu.'));
    }
    const hasil = reminder.runSchedule(dbm, new Date());
    if (!hasil.length) {
      const cfg = reminder.config(dbm);
      return res.redirect(req.BASE + flashUrl(BACK, 'warn',
        `Tidak ada jadwal yang jatuh tempo sekarang (jam pengiriman ${cfg.jam}, toleransi 15 menit; mode ${cfg.mode}).`));
    }
    const total = hasil.reduce((a, x) => a + x.queued, 0);
    dbm.logAudit(req.user, 'PENGINGAT WA', 'iuran', `Cek jadwal manual: ${hasil.map(x => x.pemicu).join('; ')} → ${total} pesan`);
    res.redirect(req.BASE + flashUrl(BACK, 'ok', `Jadwal dijalankan: ${total} pesan masuk antrean (${hasil.map(x => x.pemicu).join('; ')}).`));
  });

  /* ================= TEMPLATE ================= */
  post(BACK + '/template', (req, res) => {
    if (!guard(req, res, 'iuran', 'edit')) return;
    const r = reminder.templateSave(dbm, req.body);
    if (r.err) return res.redirect(req.BASE + flashUrl(BACK, 'err', r.err));
    dbm.logAudit(req.user, 'TAMBAH', 'iuran', `Template WA "${String(req.body.nama || '').slice(0, 60)}" disimpan`);
    res.redirect(req.BASE + flashUrl(BACK, 'ok', 'Template pesan disimpan.'));
  });

  post(BACK + '/template/hapus', (req, res) => {
    if (!guard(req, res, 'iuran', 'edit')) return;
    const row = reminder.templateDelete(dbm, req.body.id);
    if (!row) return res.redirect(req.BASE + flashUrl(BACK, 'err', 'Template tidak ditemukan.'));
    dbm.logAudit(req.user, 'HAPUS', 'iuran', `Template WA "${row.nama}" dihapus`);
    res.redirect(req.BASE + flashUrl(BACK, 'ok', 'Template dihapus.'));
  });

  /* ================= RIWAYAT ================= */
  post(BACK + '/riwayat', (req, res) => {
    if (!guard(req, res, 'iuran', 'edit')) return;
    const aksi = String(req.body.aksi || '');
    if (aksi === 'retry') {
      const n = reminder.retryFailed(dbm);
      dbm.logAudit(req.user, 'PENGINGAT WA', 'iuran', `Kirim ulang ${n} pesan pengingat yang gagal`);
      return res.redirect(req.BASE + flashUrl(BACK, 'ok', `${n} pesan gagal dikembalikan ke antrean pengiriman.`));
    }
    if (aksi === 'bersih') {
      const n = reminder.clearLogs(dbm, true);
      dbm.logAudit(req.user, 'HAPUS', 'iuran', `Hapus ${n} riwayat pengiriman pengingat`);
      return res.redirect(req.BASE + flashUrl(BACK, 'ok', `${n} riwayat pengiriman dihapus.`));
    }
    res.redirect(req.BASE + flashUrl(BACK, 'err', 'Aksi tidak dikenal.'));
  });

  /* ================= PRATINJAU PESAN (JSON, untuk modal konfirmasi) ================= */
  get('/iuran/wa/preview', (req, res) => {
    if (!req.user || !can(req.user, 'iuran', 'view')) return res.json({ ok: false, error: 'Akses ditolak.' }, 403);
    const s = siswaRow(req.query.get('siswa_id'));
    if (!s) return res.json({ ok: false, error: 'Siswa tidak ditemukan.' }, 404);
    const tplRow = reminder.templateById(dbm, req.query.get('template_id'));
    const m = reminder.buildMessage(dbm, s, {
      template: tplRow ? tplRow.isi : (String(req.query.get('pesan') || '') || undefined),
      baseUrl: reminder.absBase(dbm, req)
    });
    res.json({
      ok: true, siswa_id: s.id, nama: s.nama, kelas: m.kelas,
      phone: m.phone, phone_display: lib.phoneDisplay(m.phone),
      nominal: m.nominal, nominal_text: rupiah(m.nominal),
      items: m.items.length, pesan: m.pesan, vars: m.vars
    });
  });

  /* ================= KIRIM WA: SATU SISWA ================= */
  post('/iuran/wa/satu', (req, res) => {
    if (!guard(req, res, 'iuran', 'edit')) return;
    const back = safeBack(req.body.back, '/iuran/data');
    const s = siswaRow(req.body.siswa_id);
    if (!s) return res.redirect(req.BASE + flashUrl(back, 'err', 'Siswa tidak ditemukan.'));
    if (!lib.normPhone(s.parent_phone)) {
      return res.redirect(req.BASE + flashUrl(back, 'err', `Nomor HP/WA orang tua ${s.nama} belum diisi — lengkapi dulu di menu Data Siswa.`));
    }
    const tplRow = reminder.templateById(dbm, req.body.template_id);
    const tpl = String(req.body.pesan || '').trim() || (tplRow ? tplRow.isi : '') || reminder.config(dbm).template;
    const msg = reminder.buildMessage(dbm, s, { template: tpl, baseUrl: reminder.absBase(dbm, req) });
    const r = reminder.enqueue(dbm, [{
      siswa_id: s.id, nama: msg.nama, phone: msg.phone, kelas: msg.kelas, pesan: msg.pesan, nominal: msg.nominal
    }], { mode: 'manual', pemicu: `Kirim manual per siswa${tplRow ? ' · ' + tplRow.nama : ''}` });
    if (!r.queued) return res.redirect(req.BASE + flashUrl(back, 'err', 'Pesan gagal masuk antrean (nomor tidak valid / pesan kosong).'));
    dbm.logAudit(req.user, 'PENGINGAT WA', 'iuran', `Kirim WA manual ke orang tua ${s.nama} (${lib.phoneDisplay(msg.phone)})`);
    res.redirect(req.BASE + flashUrl(back, 'ok', `Pesan untuk orang tua ${s.nama} masuk antrean pengiriman WhatsApp.`));
  });

  /* ================= KIRIM WA MASSAL ================= */
  post('/iuran/wa/massal', (req, res) => {
    if (!guard(req, res, 'iuran', 'edit')) return;
    const back = safeBack(req.body.back, '/iuran/data');
    const ids = [].concat(req.body.siswa || []).map(Number).filter(Boolean);
    const kelas = [].concat(req.body.kelas || []).map(Number).filter(Boolean);
    const tingkat = [].concat(req.body.tingkat || []).map(String).filter(Boolean);
    const tplRow = reminder.templateById(dbm, req.body.template_id);
    const tpl = String(req.body.pesan || '').trim() || (tplRow ? tplRow.isi : '') || reminder.config(dbm).template;
    if (!tpl) return res.redirect(req.BASE + flashUrl(back, 'err', 'Template pesan kosong — pilih template atau tulis pesan terlebih dahulu.'));
    // prioritas: ceklis manual → bila kosong pakai filter kelas/tingkat
    const opts = ids.length ? { siswaIds: ids } : { kelasId: kelas, tingkat };
    const list = reminder.recipients(dbm, opts);
    if (!list.length) {
      return res.redirect(req.BASE + flashUrl(back, 'err', ids.length
        ? 'Siswa yang dipilih tidak memiliki tunggakan aktif.'
        : 'Tidak ada siswa bertunggakan pada filter yang dipilih.'));
    }
    const r = reminder.enqueueForSiswa(dbm, list, {
      mode: 'manual', template: tpl,
      pemicu: `Kirim massal${tplRow ? ' · ' + tplRow.nama : ''}${ids.length ? ' · ' + ids.length + ' siswa terpilih' : ' · filter'}`,
      baseUrl: reminder.absBase(dbm, req)
    });
    dbm.logAudit(req.user, 'PENGINGAT WA', 'iuran',
      `Kirim WA massal: ${r.queued} pesan masuk antrean, ${r.tanpaNomor} tanpa nomor${tplRow ? ' (template ' + tplRow.nama + ')' : ''}`);
    res.redirect(req.BASE + flashUrl(back, 'ok',
      `${r.queued} pesan masuk antrean pengiriman WhatsApp` +
      (r.tanpaNomor ? ` · ${r.tanpaNomor} siswa dilewati karena nomor orang tua kosong/tidak valid` : '') + '.'));
  });
};
