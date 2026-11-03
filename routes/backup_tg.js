'use strict';
/**
 * ==================================================================
 * PENGATURAN AUTO-BACKUP (sisi sekolah, Telegram)
 * ------------------------------------------------------------------
 * /pengaturan-backup → bot token + chat ID sekolah, jadwal 06:00 & 15:00,
 * tombol Uji Koneksi / Backup & Kirim Sekarang, dan riwayat pengiriman.
 *
 * Super Admin punya halaman serupa untuk SELURUH database SaaS
 * (lihat routes/superadmin.js → /super-admin/backup).
 * ==================================================================
 */
const tg = require('../telegram');
const bt = require('../backup_tg');

module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl, saas }) => {
  const { esc, rupiah, tglID } = lib;
  const go = (req, res, key, msg) => res.redirect(req.BASE + flashUrl('/pengaturan-backup', key, msg));

  get('/pengaturan-backup', (req, res) => {
    guard(req, res, 'backup', 'view');
    const c = ctx(req);
    const cfg = bt.tenantConfig(dbm);
    const configured = !!(cfg.token && cfg.chat);
    const rows = bt.tenantHistory(dbm, 30);
    const owner = c.can('backup', 'create');

    const content = `<div class="split">
      <div class="card">
        <div class="card-head">
          <div><h3>${ui.icon('cloud', 'i-sm')} Auto-Backup Telegram</h3>
            <div class="sub">Berkas .zip dikirim otomatis 2× sehari (06:00 &amp; 15:00) ke chat Telegram sekolah ini</div></div>
          ${configured ? ui.badge('Terhubung', 'green') : ui.badge('Belum diatur', 'gray')}
        </div>
        <div class="alert info">${ui.icon('info')}<div>
          <b>Cara membuat bot &amp; chat ID:</b>
          <ol style="margin:6px 0 0 18px;padding:0">
            <li>Buka Telegram → cari <b>@BotFather</b> → <code>/newbot</code> → salin <b>Bot Token</b>.</li>
            <li>Kirim pesan apa pun ke bot Anda, lalu buka <code>api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code> untuk melihat <b>Chat ID</b>.</li>
            <li>Untuk grup: tambahkan bot ke grup, jadikan admin, lalu pakai Chat ID grup (diawali tanda minus).</li>
          </ol>
          Nama berkas: <code>Backup_SIMKEU_${esc(req.tenant ? req.tenant.school_code : 'SK01')}_DDMMYYYY_HHMM.zip</code>.
          Berkas sementara di server <b>langsung dihapus</b> setelah terkirim.</div></div>
        <form method="post" action="${c.base}/pengaturan-backup/simpan">
          <div class="field"><label>Telegram Bot Token ${cfg.token ? `<span class="t-sub">(tersimpan: ${esc(tg.mask(cfg.token))})</span>` : ''}</label>
            <input type="text" name="tg_token" value="" placeholder="${cfg.token ? 'kosongkan bila tidak diubah' : '123456789:AAH…'}" autocomplete="off">
            <div class="hint">Token tidak pernah ditampilkan utuh di halaman ini.</div></div>
          <div class="row2">
            <div class="field"><label>Telegram Chat ID</label>
              <input type="text" name="tg_chat" value="${esc(cfg.chat)}" placeholder="-1001234567890 atau 987654321"></div>
            <div class="field"><label>Jadwal otomatis</label>
              <input type="text" name="tg_slots" value="${esc(cfg.slots)}" placeholder="06:00,15:00">
              <div class="hint">Pisahkan dengan koma bila ingin menambah jam lain.</div></div>
          </div>
          <label class="check mb-2"><input type="checkbox" name="tg_aktif" value="1" ${cfg.aktif ? 'checked' : ''}> Aktifkan pengiriman otomatis</label>
          <div class="form-actions"><button class="btn btn-primary">${ui.icon('save')}Simpan Pengaturan</button></div>
        </form>
        ${owner ? `<div class="flex mt-2" style="gap:10px;flex-wrap:wrap">
          <form method="post" action="${c.base}/pengaturan-backup/uji"><button class="btn">${ui.icon('check')}Uji Koneksi Bot</button></form>
          <form method="post" action="${c.base}/pengaturan-backup/kirim"><button class="btn btn-primary">${ui.icon('upload')}Backup &amp; Kirim Sekarang</button></form>
        </div>` : `<div class="alert warn mt-2">${ui.icon('lock')}<div>Hanya admin sekolah yang dapat mengubah pengaturan backup.</div></div>`}
      </div>

      <div class="card">
        <div class="card-head"><div><h3>Riwayat Pengiriman</h3><div class="sub">${rows.length} pengiriman terakhir</div></div>
          ${rows.length && owner ? `<form method="post" action="${c.base}/pengaturan-backup/riwayat/hapus"
            data-confirm="Hapus SELURUH riwayat pengiriman? Berkas backup di Telegram tidak terpengaruh.">
            <button class="btn btn-sm btn-danger">${ui.icon('trash')}Hapus Semua Riwayat</button></form>` : ''}</div>
        <div class="table-wrap short"><table><thead><tr><th>Waktu</th><th>Berkas</th><th class="num">Ukuran</th><th>Status</th><th>Pesan</th><th></th></tr></thead><tbody>
          ${rows.length ? rows.map(r => `<tr>
            <td class="nowrap small">${esc(r.waktu || '')}</td>
            <td class="mono small">${esc(r.nama_berkas || '-')}</td>
            <td class="num">${r.ukuran ? Math.round(r.ukuran / 1024) + ' KB' : '-'}</td>
            <td>${r.status === 'sukses' ? ui.badge('Sukses', 'green') : ui.badge('Gagal', 'red')}</td>
            <td class="small">${esc((r.pesan || '').slice(0, 80))}</td>
            <td class="right">${owner ? `<form method="post" action="${c.base}/pengaturan-backup/riwayat/hapus" style="display:inline"
              data-confirm="Hapus riwayat ${esc(r.nama_berkas || 'ini')}?">
              <input type="hidden" name="id" value="${r.id}">
              <button class="btn btn-sm btn-danger btn-icon" title="Hapus riwayat">${ui.icon('trash')}</button></form>` : ''}</td></tr>`).join('')
        : `<tr><td colspan="6" class="muted" style="text-align:center;padding:16px">Belum ada pengiriman.</td></tr>`}
        </tbody></table></div>
        <div class="alert info mt-2">${ui.icon('info')}<div>Backup manual tanpa Telegram tersedia di menu
          <a href="${c.base}/backup">Backup &amp; Restore</a> (unduh .zip / .sql langsung).</div></div>
      </div>
    </div>`;
    page(req, res, { title: 'Pengaturan Auto-Backup', sub: 'Kirim backup database otomatis ke Telegram', active: 'backup_cloud', content });
  });

  post('/pengaturan-backup/simpan', (req, res) => {
    guard(req, res, 'backup', 'create');
    try {
      const b = req.body || {};
      const cur = bt.tenantConfig(dbm);
      const token = String(b.tg_token || '').trim() || cur.token;
      const chat = String(b.tg_chat || '').trim();
      const slots = String(b.tg_slots || '06:00,15:00').trim();
      const aktif = b.tg_aktif ? '1' : '0';
      if (aktif === '1') {
        if (!token) throw new Error('Telegram Bot Token wajib diisi bila auto-backup diaktifkan.');
        if (!chat) throw new Error('Telegram Chat ID wajib diisi bila auto-backup diaktifkan.');
        if (token && !tg.looksValidToken(token)) throw new Error('Format Bot Token tidak valid (contoh: 123456789:AAH…).');
        for (const s of slots.split(',')) {
          if (!/^\d{1,2}:\d{2}$/.test(s.trim())) throw new Error('Format jadwal harus HH:MM, mis. 06:00,15:00.');
        }
        if (!bt.dueSlot(slots, '') && tg.slotNow(slots, new Date('2000-01-01T06:01:00')) === null) {
          // validasi bentuk saja; jam yang lewat tetap wajar (tidak semua jam aktif sekarang)
        }
      }
      bt.saveTenantConfig(dbm, { tg_token: token, tg_chat: chat, tg_slots: slots, tg_aktif: aktif });
      dbm.logAudit(req.user, 'EDIT', 'backup', 'Memperbarui pengaturan auto-backup Telegram');
      go(req, res, 'ok', 'Pengaturan auto-backup Telegram disimpan.');
    } catch (e) {
      go(req, res, 'err', e.message);
    }
  });

  /* hapus riwayat pengiriman (satu baris atau seluruhnya) */
  post('/pengaturan-backup/riwayat/hapus', (req, res) => {
    guard(req, res, 'backup', 'create');
    try {
      const id = Number(req.body.id || 0);
      if (id) {
        const r = dbm.db.prepare('SELECT * FROM cloud_backup WHERE id=?').get(id);
        if (!r) throw new Error('Riwayat tidak ditemukan.');
        dbm.db.prepare('DELETE FROM cloud_backup WHERE id=?').run(id);
        dbm.logAudit(req.user, 'HAPUS', 'backup', `Hapus riwayat auto-backup ${r.nama_berkas || '#' + id}`);
        go(req, res, 'ok', 'Riwayat pengiriman dihapus.');
      } else {
        const n = dbm.db.prepare('DELETE FROM cloud_backup').run().changes;
        dbm.logAudit(req.user, 'HAPUS', 'backup', `Hapus SELURUH riwayat auto-backup (${n} baris)`);
        go(req, res, 'ok', `${n} riwayat pengiriman dihapus.`);
      }
    } catch (e) { go(req, res, 'err', e.message); }
  });

  post('/pengaturan-backup/uji', async (req, res) => {
    guard(req, res, 'backup', 'create');
    const cfg = bt.tenantConfig(dbm);
    try {
      if (!cfg.token) throw new Error('Bot Token belum diisi.');
      const me = await tg.getMe(cfg.token);
      if (!cfg.chat) throw new Error('Chat ID belum diisi. Bot @' + me.username + ' terdeteksi, isi Chat ID lalu simpan.');
      await tg.sendMessage({
        token: cfg.token, chatId: cfg.chat,
        text: `✅ Uji koneksi berhasil.\n${dbm.getSetting('sekolah_nama', 'Sekolah')}\nAuto-backup akan dikirim ke chat ini pukul ${cfg.slots}.`
      });
      go(req, res, 'ok', `Bot @${me.username} terhubung dan pesan uji terkirim ke chat ${cfg.chat}.`);
    } catch (e) {
      go(req, res, 'err', 'Uji gagal: ' + e.message);
    }
  });

  post('/pengaturan-backup/kirim', async (req, res) => {
    guard(req, res, 'backup', 'create');
    try {
      const r = await bt.runTenantBackup(dbm, saas, req.tenant, { trigger: 'manual', user: req.user.nama });
      go(req, res, 'ok', `Backup ${r.nama} (${Math.round(r.ukuran / 1024)} KB) terkirim ke Telegram chat ${r.chat}.`);
    } catch (e) {
      go(req, res, 'err', 'Backup gagal: ' + e.message);
    }
  });
};
