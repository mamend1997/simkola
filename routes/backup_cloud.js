'use strict';
/**
 * Pengaturan Backup (level Administrator)
 * - Kredensial Service Account Google Drive (JSON) & Folder ID tujuan
 * - Auto-backup ZIP dua kali sehari (06:00 & 15:00) + tombol manual
 * - Kebijakan retensi: berkas backup > N hari (default 30) dihapus otomatis
 */
const gdrive = require('../gdrive');
const bd = require('../backupdata');

module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, flashUrl }) => {
  const { esc, fileSize } = lib;
  const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const fmtWhen = d => d
    ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} pukul ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    : '-';
  const go = (req, res, key, msg) => res.redirect(req.BASE + flashUrl('/pengaturan-backup', key, msg));
  const folderIdOf = raw => {
    const s = String(raw || '').trim();
    // terima URL folder Drive & ambil ID-nya otomatis
    const m = s.match(/\/folders\/([A-Za-z0-9_-]{10,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
    return m ? m[1] : s;
  };

  /* ================= HALAMAN PENGATURAN BACKUP ================= */
  get('/pengaturan-backup', (req, res) => {
    guard(req, res, 'backup', 'create');
    const c = ctx(req);
    const rawCred = String(dbm.getSetting('gdrive_credentials', '') || '');
    const sum = gdrive.credSummary(rawCred);
    const folderId = String(dbm.getSetting('gdrive_folder_id', '') || '');
    const auto = dbm.getSetting('gdrive_auto', '1') === '1';
    const times = gdrive.scheduleTimes(dbm);
    const retention = Number(dbm.getSetting('gdrive_retensi_hari', '30')) || 30;
    const configured = gdrive.isConfigured(dbm);
    const last = gdrive.lastRun(dbm);
    const next = gdrive.nextRun(dbm);
    const rows = gdrive.history(dbm, 12);
    const lastOk = last && last.status === 'sukses';

    const tone = configured ? (auto ? 'green' : 'amber') : 'red';
    const kpi = (cls, ico, lbl, val, note) => `<div class="kpi ${cls}"><div class="ico">${ui.icon(ico)}</div><div class="lbl">${lbl}</div>
      <div class="val" style="font-size:17px;line-height:1.35">${val}</div>${note ? `<div class="t-sub" style="font-size:11.5px;margin-top:2px">${note}</div>` : ''}</div>`;

    const content = `
    <div class="kpi-grid mb-3">
      ${kpi(configured ? 'ic-green' : 'ic-orange', 'cloud', 'Kredensial Service Account',
      configured ? ui.badge('Tersimpan', 'green') : ui.badge('Belum diisi', 'red'),
      configured && sum.ok ? esc(sum.email) : 'Tempel isi file JSON dari Google Cloud')}
      ${kpi(folderId ? 'ic-blue' : 'ic-orange', 'file', 'Folder Tujuan',
      folderId ? `<span class="mono" style="font-size:12px">${esc(folderId.slice(0, 18))}${folderId.length > 18 ? '…' : ''}</span>` : ui.badge('Belum diisi', 'red'),
      folderId ? 'Folder Google Drive penerima backup' : 'ID folder Drive tujuan unggahan')}
      ${kpi(auto ? 'ic-green' : 'ic-orange', 'clock', 'Jadwal Otomatis',
      auto ? `2× sehari · ${esc(times.join(' & '))}` : ui.badge('Nonaktif', 'amber'),
      next ? 'Berikutnya ' + esc(fmtWhen(next)) : 'Menunggu konfigurasi')}
      ${kpi(lastOk ? 'ic-green' : 'ic-orange', 'save', 'Backup Terakhir',
      last ? ui.badge(last.status === 'sukses' ? 'Sukses' : 'Gagal', last.status === 'sukses' ? 'green' : 'red') : '—',
      last ? esc(last.waktu) + ' · ' + esc(last.pemicu) : 'Belum pernah dijalankan')}
    </div>

    <div class="split">
      <div class="card">
        <div class="card-head"><div><h3>Integrasi Google Drive</h3><div class="sub">Kredensial Service Account &amp; folder tujuan auto-backup</div></div></div>
        <div class="alert info">${ui.icon('info')}<div>Nilai pada dua kolom di bawah dipakai langsung sebagai variabel autentikasi API dan penentuan folder tujuan setiap kali workflow backup berjalan.</div></div>
        <form method="post" action="${c.base}/pengaturan-backup/simpan">
          <div class="field"><label>1. Kredensial Service Account (JSON)</label>
            <textarea name="gdrive_credentials" rows="9" spellcheck="false" autocomplete="off"
              style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:1.45"
              placeholder='{&#10;  "type": "service_account",&#10;  "project_id": "simkeu-backup",&#10;  "private_key_id": "…",&#10;  "private_key": "…isi kunci privat…",&#10;  "client_email": "simkeu-backup@simkeu-backup.iam.gserviceaccount.com",&#10;  "token_uri": "https://oauth2.googleapis.com/token"&#10;}'></textarea>
            <div class="hint">Tempel <b>seluruh isi</b> file JSON kunci Service Account dari Google Cloud Console.
              ${rawCred
        ? (sum.ok
          ? `<br><b>Tersimpan:</b> <span class="mono">${esc(sum.email)}</span>${sum.project ? ` · project <span class="mono">${esc(sum.project)}</span>` : ''}. Kosongkan kolom ini bila tidak ingin mengubah kredensial.`
          : `<br><span class="badge red">Kredensial tersimpan tidak valid</span> ${esc(sum.error)}`)
        : '<br>Belum ada kredensial tersimpan.'}</div>
            ${rawCred ? `<label class="check mt-1"><input type="checkbox" name="hapus_kredensial" value="1"> Hapus kredensial yang tersimpan</label>` : ''}
          </div>
          <div class="field"><label>2. Folder ID Google Drive Tujuan</label>
            <input name="gdrive_folder_id" value="${esc(folderId)}" placeholder="1AbCdEfGhIjKlMnOpQrStUvWxYz012345">
            <div class="hint">Ambil dari URL folder Drive: <span class="mono">drive.google.com/drive/folders/<b>ID-FOLDER</b></span> (URL lengkap juga boleh, ID diambil otomatis).
              Pastikan folder tersebut sudah dibagikan sebagai <b>Editor</b> ke email Service Account di atas.</div></div>
          <hr class="sep">
          <div class="row3">
            <div class="field"><label>Jadwal Otomatis</label>
              <label class="check"><input type="checkbox" name="gdrive_auto" value="1" ${auto ? 'checked' : ''}> Jalankan backup terjadwal</label>
              <div class="hint">Tidak dipicu oleh simpan transaksi — hanya oleh timer server.</div></div>
            <div class="field"><label>Jam Eksekusi (24 jam)</label>
              <input name="gdrive_times" value="${esc(dbm.getSetting('gdrive_times', '06:00,15:00'))}" placeholder="06:00,15:00">
              <div class="hint">Beberapa jam dipisah koma. Default <b>06:00</b> &amp; <b>15:00</b>.</div></div>
            <div class="field"><label>Retensi Berkas (hari)</label>
              <input type="number" name="gdrive_retensi_hari" min="1" max="3650" value="${retention}">
              <div class="hint">Berkas backup lebih tua dari batas ini dihapus otomatis setiap unggahan sukses.</div></div>
          </div>
          <div class="form-actions" style="border:0"><button class="btn btn-primary">${ui.icon('save')}Simpan Pengaturan</button></div>
        </form>
      </div>

      <div>
        <div class="card mb-3">
          <div class="card-head"><div><h3>Backup &amp; Sinkronisasi Manual</h3><div class="sub">Jalankan workflow sekarang juga</div></div></div>
          <p class="small muted" style="margin-top:0">Sistem mengompres seluruh data aplikasi menjadi satu berkas <b>.zip</b>
            (database lengkap + rekap CSV), menamainya otomatis
            <span class="mono">${esc(bd.backupFileName())}</span>, lalu mengunggahnya ke folder Drive di samping.
            Setelah unggahan sukses, berkas backup yang lebih tua dari ${retention} hari dibersihkan.</p>
          ${configured
        ? `<form method="post" action="${c.base}/pengaturan-backup/jalan" data-confirm="Jalankan backup &amp; unggah ke Google Drive sekarang?">
                <button class="btn btn-primary btn-block">${ui.icon('cloud')}Backup &amp; Sinkronisasi Manual</button>
              </form>`
        : `<div class="alert warn">${ui.icon('alert')}<div>Lengkapi kredensial &amp; Folder ID lalu simpan terlebih dahulu.</div></div>
              <button class="btn btn-block" disabled>${ui.icon('cloud')}Backup &amp; Sinkronisasi Manual</button>`}
          <div class="row2 mt-2">
            <form method="post" action="${c.base}/pengaturan-backup/uji">
              <button class="btn btn-block" ${configured ? '' : 'disabled'}>${ui.icon('link')}Uji Koneksi</button>
            </form>
            <form method="post" action="${c.base}/pengaturan-backup/bersihkan" data-confirm="Hapus berkas backup di Drive yang lebih tua dari ${retention} hari?">
              <button class="btn btn-block" ${configured ? '' : 'disabled'}>${ui.icon('trash')}Bersihkan Berkas Lama</button>
            </form>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><div><h3>Riwayat Backup Cloud</h3><div class="sub">${rows.length} aktivitas terakhir</div></div></div>
          ${rows.length ? `<div class="table-wrap short"><table><thead><tr><th>Waktu</th><th>Berkas</th><th class="num">Ukuran</th><th>Pemicu</th><th>Status</th></tr></thead><tbody>
            ${rows.map(r => `<tr>
              <td class="t-sub nowrap">${esc(r.waktu)}</td>
              <td><div class="t-strong mono" style="font-size:11.5px">${esc(r.nama_berkas || '-')}</div>
                <div class="t-sub" style="font-size:11px">${esc(r.pesan || '')}${r.dihapus ? ` · ${r.dihapus} lama dihapus` : ''}${r.user_nama && r.pemicu === 'manual' ? ` · ${esc(r.user_nama)}` : ''}</div></td>
              <td class="num">${r.ukuran ? esc(fileSize(r.ukuran)) : '-'}</td>
              <td>${ui.badge(r.pemicu || '-', r.pemicu === 'otomatis' ? 'blue' : 'gray', 'plain')}</td>
              <td>${ui.badge(r.status === 'sukses' ? 'Sukses' : 'Gagal', r.status === 'sukses' ? 'green' : 'red')}</td>
            </tr>`).join('')}
          </tbody></table></div>` : '<div class="help">Belum ada riwayat backup cloud. Riwayat terisi otomatis setelah backup manual atau jadwal berjalan.</div>'}
        </div>
      </div>
    </div>

    <div class="card mt-3">
      <div class="card-head"><div><h3>Langkah Menyiapkan Google Drive</h3><div class="sub">Sekali saja — setelah itu backup berjalan otomatis</div></div></div>
      <div class="row2">
        <ol class="small" style="margin:0;padding-left:18px;line-height:1.75">
          <li>Buka <b>Google Cloud Console</b> → buat project → aktifkan <b>Google Drive API</b>.</li>
          <li>Buat <b>Service Account</b> → tab <b>Keys</b> → <b>Add key · Create new key · JSON</b> → file JSON terunduh.</li>
          <li>Buat folder di Google Drive, klik <b>Share</b>, tambahkan email Service Account
            (${sum.ok ? `<span class="mono">${esc(sum.email)}</span>` : '…@…iam.gserviceaccount.com'}) sebagai <b>Editor</b>.</li>          <li>Salin ID folder dari URL Drive, lalu tempel isi JSON &amp; ID folder pada form di samping → <b>Simpan</b>.</li>
          <li>Klik <b>Uji Koneksi</b>, lalu <b>Backup &amp; Sinkronisasi Manual</b> untuk percobaan pertama.</li>
        </ol>
        <div class="alert warn" style="margin:0">${ui.icon('alert')}<div><b>Catatan keamanan &amp; kapasitas:</b>
          kredensial disimpan di pengaturan aplikasi dan hanya dapat dibuka oleh Super Admin.
          Halaman ini sengaja tidak menampilkan ulang isi kunci privat.
          <br><br><b>Folder tujuan:</b> bila memakai akun Google Workspace, letakkan folder di dalam
          <b>Shared Drive</b> (drive bersama). Akun layanan Google tidak memiliki kuota My Drive pribadi,
          sehingga unggahan ke folder My Drive biasa dapat ditolak Google dengan pesan kuota.
          <br><br>Retensi ${retention} hari menjaga kapasitas Drive. Backup <b>tidak</b> dijalankan setiap ada simpan data/transaksi
          agar aplikasi tetap cepat — hanya 2× sehari dan saat tombol manual diklik.</div></div>
      </div>
    </div>`;

    page(req, res, {
      title: 'Pengaturan Backup', sub: 'Auto-backup Google Drive · kredensial, folder tujuan & kebijakan retensi',
      active: 'backup_cloud', content
    });
  });

  /* ================= SIMPAN PENGATURAN ================= */
  post('/pengaturan-backup/simpan', (req, res) => {
    guard(req, res, 'backup', 'create');
    const body = req.body || {};
    const rawCred = String(body.gdrive_credentials || '').trim();
    const folderId = folderIdOf(body.gdrive_folder_id);
    const timesRaw = String(body.gdrive_times || '').trim() || '06:00,15:00';
    const times = [];
    for (const part of timesRaw.split(/[,\s;]+/).filter(Boolean)) {
      const m = part.match(/^([01]?\d|2[0-3])[:.]([0-5]\d)$/);
      if (!m) return go(req, res, 'err', `Jam eksekusi "${part}" tidak valid. Gunakan format 24 jam, mis. 06:00,15:00.`);
      times.push(String(m[1]).padStart(2, '0') + ':' + m[2]);
    }
    if (!times.length) return go(req, res, 'err', 'Isi minimal satu jam eksekusi backup.');
    const retention = Math.min(3650, Math.max(1, Number(lib.parseMoney(body.gdrive_retensi_hari)) || 30));
    if (folderId && !/^[A-Za-z0-9_-]{10,200}$/.test(folderId)) {
      return go(req, res, 'err', 'Folder ID tidak valid. Salin ID dari URL folder Google Drive (huruf, angka, - dan _).');
    }
    // validasi kredensial SEBELUM menyimpan apa pun (tidak ada penyimpanan separuh)
    if (rawCred) {
      try { gdrive.parseCredentials(rawCred); } catch (e) {
        return go(req, res, 'err', 'Kredensial ditolak: ' + e.message);
      }
    }
    dbm.setSetting('gdrive_credentials', body.hapus_kredensial ? '' : (rawCred || dbm.getSetting('gdrive_credentials', '')));
    dbm.setSetting('gdrive_folder_id', folderId);
    dbm.setSetting('gdrive_auto', body.gdrive_auto ? '1' : '0');
    dbm.setSetting('gdrive_times', times.join(','));
    dbm.setSetting('gdrive_retensi_hari', String(retention));
    gdrive._resetTokenCache();
    dbm.logAudit(req.user, 'EDIT', 'backup',
      `Pengaturan auto-backup Google Drive: folder ${folderId || '(kosong)'}, jadwal ${times.join(' & ')}, retensi ${retention} hari`
      + (body.hapus_kredensial ? ', kredensial dihapus' : rawCred ? ', kredensial diperbarui' : ''));
    return go(req, res, 'ok', `Pengaturan backup disimpan. Jadwal otomatis ${times.join(' & ')} · retensi ${retention} hari.`);
  });

  /* ================= BACKUP MANUAL ================= */
  post('/pengaturan-backup/jalan', async (req, res) => {
    guard(req, res, 'backup', 'create');
    const r = await gdrive.runBackup(dbm, { trigger: 'manual', user: req.user });
    if (!r.ok) return go(req, res, 'err', 'Backup gagal: ' + r.error);
    const clean = r.cleanup
      ? ` ${r.cleanup.scanned} berkas dipindai; ${r.cleanup.deleted.length} berkas lebih dari ${r.cleanup.days} hari dihapus.`
      : '';
    const fail = r.cleanup && r.cleanup.failed && r.cleanup.failed.length
      ? ` (${r.cleanup.failed.length} gagal dihapus)` : '';
    return go(req, res, 'ok',
      `Backup berhasil diunggah ke Google Drive: ${r.name} (${fileSize(r.size)}, ${r.rows} baris dari ${r.tables} tabel).${clean}${fail}`);
  });

  /* ================= UJI KONEKSI ================= */
  post('/pengaturan-backup/uji', async (req, res) => {
    guard(req, res, 'backup', 'create');
    try {
      const cfg = gdrive.cfgFromDb(dbm);
      const t = await gdrive.testConnection(cfg);
      const old = t.files.filter(f => Date.parse(f.createdTime || '') < Date.now() - cfg.days * 86400000);
      return go(req, res, 'ok',
        `Koneksi berhasil. Folder "${t.folder.name || cfg.folderId}" berisi ${t.files.length} berkas backup milik aplikasi`
        + ` (${fileSize(t.bytes)}); ${old.length} berkas lebih tua dari ${cfg.days} hari akan dibersihkan pada unggahan berikutnya.`);
    } catch (e) {
      return go(req, res, 'err', 'Uji koneksi gagal: ' + e.message);
    }
  });

  /* ================= PEMBERSIHAN RETENSI MANUAL ================= */
  post('/pengaturan-backup/bersihkan', async (req, res) => {
    guard(req, res, 'backup', 'create');
    try {
      const cfg = gdrive.cfgFromDb(dbm);
      const r = await gdrive.cleanupOld(cfg, { days: cfg.days });
      dbm.logAudit(req.user, 'BERSIHKAN', 'backup',
        `Retensi backup cloud ${r.days} hari: ${r.deleted.length} dari ${r.scanned} berkas dihapus`);
      return go(req, res, 'ok',
        `Kebijakan retensi dijalankan: ${r.scanned} berkas backup dipindai, ${r.deleted.length} berkas lebih dari ${r.days} hari dihapus.`
        + (r.failed.length ? ` ${r.failed.length} berkas gagal dihapus.` : ''));
    } catch (e) {
      return go(req, res, 'err', 'Gagal menjalankan retensi: ' + e.message);
    }
  });
};
