'use strict';
const fs = require('fs');
const path = require('path');
const { esc, moneyInput: fmtMoney, rupiah, rpShort } = require('./lib');

/** versi berkas aset (mtime) — dipakai sebagai query string agar browser tidak memakai CSS/JS lama */
const ASSET_V = (() => {
  try {
    const t = ['app.css', 'app.js'].map(f => {
      try { return fs.statSync(path.join(__dirname, 'public', f)).mtimeMs; } catch (e) { return 0; }
    });
    return String(Math.max(...t)).replace(/\D/g, '').slice(-9) || '1';
  } catch (e) { return '1'; }
})();

const ICONS = {
  dashboard: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
  users: '<path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 20v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13A4 4 0 0 1 16 11"/>',
  school: '<path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-5h6v5"/><path d="M9 10h.01M15 10h.01"/>',
  calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15Z"/><path d="M8 7h8M8 11h8"/>',
  tag: '<path d="M20.6 13.4 12 22 2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8Z"/><circle cx="7" cy="7" r="1.5"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  wallet: '<path d="M20 12V8a2 2 0 0 0-2-2H5a2 2 0 0 1 0-4h13v4"/><path d="M3 6v12a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2Z"/><circle cx="17" cy="14.5" r="1.2"/>',
  receipt: '<path d="M5 3h14v18l-3.5-2-3.5 2-3.5-2L5 21Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 15H6L5 6"/><path d="M10 11v6M14 11v6"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 8 5-5 5 5"/><path d="M12 3v12"/>',
  printer: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2"/>',
  up: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
  down: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 8.9 19a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 5 8.9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  chart: '<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6"/><rect x="12" y="8" width="3" height="10"/><rect x="17" y="5" width="3" height="13"/>',
  bank: '<path d="M3 21h18"/><path d="M4 21V10h16v11"/><path d="M12 3 3 8h18Z"/><path d="M8 14v3M12 14v3M16 14v3"/>',
  bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  filter: '<path d="M22 3H2l8 9.5V19l4 2v-8.5Z"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  layers: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  graduation: '<path d="m22 9-10-5L2 9l10 5 10-5Z"/><path d="M6 11.5V17c0 1.5 2.7 3 6 3s6-1.5 6-3v-5.5"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6Z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
  coins: '<ellipse cx="9" cy="6" rx="6" ry="3"/><path d="M3 6v5c0 1.7 2.7 3 6 3s6-1.3 6-3V6"/><path d="M3 11v5c0 1.7 2.7 3 6 3"/><ellipse cx="16" cy="15" rx="5" ry="2.5"/><path d="M11 15v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4"/>',
  swap: '<path d="M7 4 3 8l4 4"/><path d="M3 8h13a4 4 0 0 1 0 8h-1"/><path d="m17 20 4-4-4-4"/>'
};
function icon(name, cls = '') {
  const p = ICONS[name] || ICONS.info;
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

function flashBlock(query) {
  const ok = query.get('ok'), err = query.get('err'), warn = query.get('warn');
  if (!ok && !err && !warn) return '';
  if (err) return `<div class="alert err">${icon('alert')}<div><strong>Gagal.</strong> ${esc(err)}</div></div>`;
  if (warn) return `<div class="alert warn">${icon('alert')}<div>${esc(warn)}</div></div>`;
  return `<div class="alert ok">${icon('check')}<div>${esc(ok)}</div></div>`;
}

const NAV = [
  { id: 'ringkasan', group: 'Ringkasan', icon: 'dashboard', items: [{ href: '/', key: 'dashboard', label: 'Dashboard', icon: 'dashboard' }] },
  {
    id: 'transaksi', group: 'Transaksi', icon: 'receipt', items: [
      { href: '/transaksi', key: 'transaksi', label: 'Transaksi Keuangan', icon: 'receipt' },
      { href: '/approval', key: 'transaksi', action: 'approve', activeKey: 'approval', label: 'Persetujuan Pengeluaran', icon: 'check' },
      { href: '/mutasi-kas', key: 'mutasi_kas', label: 'Mutasi Bank & Cash', icon: 'swap', activeKey: 'mutasi_kas' },
      { href: '/tutup-bulanan', key: 'tutup_bulanan', label: 'Tutup BKU Bulanan', icon: 'lock' },
      { href: '/piutang', key: 'piutang', label: 'Piutang & SPP', icon: 'card' },
      { href: '/piutang-lain', key: 'piutang_lain', label: 'Piutang Sertifikasi', icon: 'shield' },
      { href: '/piutang-lainnya', key: 'piutang_lainnya', label: 'Piutang Lainnya', icon: 'layers' },
      { href: '/rekon', key: 'rekon', label: 'Rekonsiliasi Bank', icon: 'refresh' }
    ]
  },
  {
    id: 'akademik', group: 'Akademik & Siswa', icon: 'graduation', items: [
      { href: '/siswa', key: 'siswa', label: 'Data Siswa', icon: 'graduation' },
      { href: '/kelas', key: 'kelas', label: 'Data Kelas', icon: 'book' },
      { href: '/program-keahlian', key: 'program', label: 'Program Keahlian', icon: 'layers' },
      { href: '/mutasi-kelas', key: 'mutasi_kelas', label: 'Mutasi Kelas', icon: 'swap' },
      { href: '/siswa-nonaktif', key: 'siswa', activeKey: 'siswa_nonaktif', label: 'Siswa Non-Aktif', icon: 'users' }
    ]
  },
  {
    id: 'iuran', group: 'Iuran Siswa', icon: 'coins', items: [
      { href: '/iuran', key: 'iuran', label: 'Grup Iuran', icon: 'coins' },
      { href: '/iuran/data', key: 'iuran', activeKey: 'iuran_data', label: 'Data Iuran', icon: 'card' },
      { href: '/iuran/bulanan', key: 'iuran', activeKey: 'iuran_bulanan', label: 'Rincian Iuran Bulanan', icon: 'calendar' },
      { href: '/iuran/transaksi', key: 'iuran', activeKey: 'iuran_trx', label: 'Transaksi Iuran', icon: 'receipt' },
      { href: '/iuran/antrean', key: 'iuran', activeKey: 'iuran_queue', label: 'Antrean Posting Iuran', icon: 'clock' }
    ]
  },
  {
    id: 'komunikasi', group: 'Komunikasi Internal', icon: 'inbox', items: [
      { href: '/catatan-pegawai', key: 'catatan', activeKey: 'catatan', label: 'Catatan Pegawai', icon: 'inbox' },
      { href: '/pesan-orangtua', key: 'dashboard', activeKey: 'pesan_orangtua', label: 'Pesan Orang Tua', icon: 'inbox' }
    ]
  },
  {
    id: 'kepegawaian', group: 'Kepegawaian & Payroll', icon: 'users', items: [
      { href: '/pegawai', key: 'pegawai', label: 'Data Pegawai', icon: 'users' },
      { href: '/payroll', key: 'payroll', label: 'Payroll & Leger Honor', icon: 'wallet' },
      { href: '/payroll/slip', key: 'payroll', activeKey: 'payroll_slip', label: 'Slip Gaji Pegawai', icon: 'printer' },
      { href: '/ekskul', key: 'ekskul', label: 'Honor Pembina Ekskul', icon: 'target' },
      { href: '/ekskul/antrean', key: 'ekskul', activeKey: 'ekskul_queue', label: 'Antrean Posting Ekskul', icon: 'clock' },
      { href: '/beasiswa', key: 'beasiswa', label: 'Beasiswa SPP', icon: 'target' }
    ]
  },
  {
    id: 'master', group: 'Perencanaan & Master', icon: 'layers', items: [
      { href: '/anggaran', key: 'anggaran', label: 'Anggaran RAPBS', icon: 'target' },
      { href: '/bku', key: 'bku', label: 'Master BKU', icon: 'book' },
      { href: '/import', key: 'import', label: 'Import Excel BKU', icon: 'upload' },
      { href: '/coa', key: 'coa', label: 'Kode Rekening', icon: 'tag' },
      { href: '/saldo-awal', key: 'saldo_awal', label: 'Saldo Awal', icon: 'wallet' },
      { href: '/aset', key: 'aset', label: 'Aset Riil', icon: 'bank' },
      { href: '/tahun-ajaran', key: 'tahun_ajaran', label: 'Tahun Ajaran', icon: 'calendar' }
    ]
  },
  {
    id: 'sistem', group: 'Laporan & Sistem', icon: 'settings', items: [
      { href: '/laporan', key: 'laporan', label: 'Laporan & Export', icon: 'file' },
      { href: '/sekolah', key: 'sekolah', label: 'Identitas Sekolah', icon: 'school' },
      { href: '/tarif-honor', key: 'tarif_honor', label: 'Nominal Tunjangan & Honor', icon: 'wallet' },
      { href: '/pengguna', key: 'pengguna', label: 'Pengguna & Hak Akses', icon: 'users' },
      { href: '/tampilan-menu', key: 'pengguna', activeKey: 'tampilan_menu', label: 'Pengaturan Tampilan Menu', icon: 'menu' },
      { href: '/desain-cetak', key: 'sekolah', activeKey: 'desain_cetak', label: 'Desain Templat Cetak', icon: 'printer' },
      { href: '/trash', key: 'trash', label: 'Kotak Sampah', icon: 'inbox' },
      { href: '/audit', key: 'audit', label: 'Audit Log', icon: 'shield' },
      { href: '/audit-orphan', key: 'sekolah', activeKey: 'audit_orphan', label: 'Audit Data Tersembunyi', icon: 'search' },
      { href: '/reset-tahun', key: 'sekolah', activeKey: 'reset_tahun', label: 'Reset Data Tahun Ajaran', icon: 'refresh' },
      { href: '/backup', key: 'backup', label: 'Backup & Restore', icon: 'database' }
    ]
  }
];

function avatar(user, cls = 'avatar', style = '') {
  const initials = String((user && user.nama) || '?').split(' ').filter(Boolean).map(s => s[0]).slice(0, 2).join('').toUpperCase();
  const extra = style ? ` style="${style}"` : '';
  if (user && user.foto) {
    // inisial tetap dirender di belakang; jika gambar gagal dimuat, img menghapus dirinya sendiri
    return `<div class="${cls} avatar-img"${extra} title="${esc(user.nama || '')}">` +
      `<span class="avatar-ini">${esc(initials)}</span>` +
      `<img src="${esc(user.foto)}" alt="${esc(user.nama || 'Foto profil')}" loading="lazy" decoding="async" onerror="this.remove()">` +
      `</div>`;
  }
  return `<div class="${cls}"${extra}><span class="avatar-ini">${esc(initials)}</span></div>`;
}

function navVisibility(str) {
  const set = new Set(String(str || '').split(',').map(s => s.trim()).filter(Boolean));
  return set;
}
/** daftar seluruh menu (untuk halaman Pengaturan Tampilan Menu) */
function navCatalog() {
  return NAV.map(g => ({ ...g, items: g.items.slice() }));
}

function layout({ title, sub = '', user, active, base = '', content, query, roleLabel, pendingCount = 0, can, logoStamp = '', taList = [], taId = null, path = '', navHidden = '' }) {
  const initials = (user?.nama || '?').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();
  const hidden = navVisibility(navHidden);
  const linkOf = (i) => {
    const showPill = (i.key === 'transaksi' || i.activeKey === 'approval') && pendingCount;
    const pill = showPill ? `<span class="pill">${pendingCount}</span>` : '';
    return `<a href="${base}${i.href}" class="${active === (i.activeKey || i.key) ? 'active' : ''}">${icon(i.icon)}<span>${esc(i.label)}</span>${pill}</a>`;
  };
  let nav = '';
  for (const g of NAV) {
    const items = g.items.filter(i => !hidden.has(i.href) && (!can || (i.action ? can(i.key, i.action) : can(i.key))));
    if (!items.length) continue;
    const isOpen = items.some(i => active === (i.activeKey || i.key));
    if (items.length === 1) {
      nav += `<div class="nav-single">${linkOf(items[0])}</div>`;
      continue;
    }
    nav += `<div class="nav-group${isOpen ? ' open' : ''}" data-navgroup="${esc(g.id || '')}">
      <button type="button" class="nav-toggle" data-navtoggle="${esc(g.id || '')}" aria-expanded="${isOpen ? 'true' : 'false'}" aria-controls="navs-${esc(g.id || '')}">
        ${icon(g.icon || 'layers', 'nav-tg-ico')}<span class="nav-tg-txt">${esc(g.group)}</span>
        <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      <div class="nav-sec" id="navs-${esc(g.id || '')}">${items.map(linkOf).join('')}</div>
    </div>`;
  }
  if (!nav) nav = '<div class="nav-empty">Semua menu sedang disembunyikan. Buka <b>Pengaturan Tampilan Menu</b> untuk menampilkannya kembali.</div>';
  return `<!DOCTYPE html>
<html lang="id"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · SIMKEU Sekolah</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${base}/assets/app.css?v=${ASSET_V}">
<link rel="icon" type="image/png" href="${base}/favicon.ico?v=${encodeURIComponent((logoStamp||'').slice(-24))}">
<link rel="apple-touch-icon" href="${base}/favicon.ico">
<meta name="theme-color" content="#F97316">
</head><body>
<div class="shell">
  <aside class="sidebar" id="sidebar">
    <div class="brand">
      <div class="brand-mark">${icon('wallet')}</div>
      <div><div class="brand-name">SIMKEU Sekolah</div><div class="brand-sub">Sistem Keuangan</div></div>
    </div>
    <nav class="nav">${nav}</nav>
    <div class="side-foot">v1.0 · ${new Date().getFullYear()} © SIMKEU</div>
  </aside>
  <div class="scrim" id="scrim"></div>
  <div class="main">
    <header class="topbar">
      <button class="hamburger" id="burger" aria-label="Menu">${icon('menu')}</button>
      <button class="collapse-btn" id="navCollapse" type="button" aria-label="Lipat / tampilkan menu samping" title="Lipat / tampilkan menu samping">${icon('menu')}</button>
      <div><h1>${esc(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
      <div class="topbar-right">
        ${(taList && taList.length) ? `<form method="post" action="${base}/ta/pilih" class="ta-switch" title="Tahun Pelajaran — semua data mengikuti pilihan ini">
          <input type="hidden" name="back" value="${esc(path || '/')}">
          <label class="ta-lbl">Tahun Pelajaran</label>
          <select name="ta" data-autosubmit aria-label="Pilih Tahun Pelajaran">
            ${taList.map(t => `<option value="${t.id}" ${String(t.id) === String(taId) ? 'selected' : ''}>${esc(t.nama)}${t.aktif ? ' •' : ''}</option>`).join('')}
          </select>
        </form>` : ''}
        ${pendingCount && can && can('transaksi', 'approve') ? `<a class="btn btn-sm btn-ghost" href="${base}/approval" title="${pendingCount} draf pengeluaran menunggu persetujuan" style="position:relative">${icon('bell')}<span class="nbell">${pendingCount}</span></a>` : ''}
        <a class="btn btn-sm btn-ghost" href="${base}/sekolah" title="Identitas sekolah">${icon('settings')}</a>
        <a class="userchip" href="${base}/akun" title="Akun saya">
          ${avatar(user)}
          <div class="txt"><div class="nm">${esc(user?.nama || '')}</div><div class="rl">${esc(roleLabel || '')}</div></div>
        </a>
        <form method="post" action="${base}/logout" style="margin:0"><button class="btn btn-sm btn-icon" title="Keluar">${icon('logout')}</button></form>
      </div>
    </header>
    <main class="content">
      ${flashBlock(query || new URLSearchParams())}
      ${content}
    </main>
  </div>
</div>
<script src="${base}/assets/app.js?v=${ASSET_V}"></script>
</body></html>`;
}

/* ---------- small components ---------- */
function badge(text, tone = 'gray', extra = '') {
  return `<span class="badge ${tone} ${extra}">${esc(text)}</span>`;
}
const bkuStatusBadge = st => st === 'aktif' ? badge('Aktif', 'green') : badge('Ditutup', 'gray');
const trxStatusBadge = st => st === 'pending' ? badge('Menunggu Approval', 'amber')
  : st === 'rejected' ? badge('Ditolak', 'red')
    : st === 'void' ? badge('Void / Dibatalkan', 'red')
      : badge('Terposting', 'green');

function modal(id, { title, body, footer = '', wide = false, autoShow = false, autoKey = '' }) {
  const autoAttr = autoShow ? ` data-autoshow="1" data-autokey="${esc(autoKey)}"` : '';
  return `<div class="modal" id="${id}"${autoAttr}>
    <div class="modal-box ${wide ? 'wide' : ''}">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="xbtn" type="button" data-close="${id}">&times;</button></div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>
  </div>`;
}
function openModalBtn(id, label, cls = 'btn-primary', ico = 'plus') {
  return `<button type="button" class="${cls}" data-open="${id}">${ico ? icon(ico) : ''}${esc(label)}</button>`;
}
function emptyState(title, desc = '') {
  return `<div class="empty"><div class="eico">${icon('file')}</div><h4>${esc(title)}</h4><p>${esc(desc)}</p></div>`;
}
function prog(pct, tone = '') {
  const p = Math.max(0, Math.min(100, Math.round(pct || 0)));
  return `<div class="prog ${tone}"><i style="width:${p}%"></i></div>`;
}
function selectOptions(list, selected, valueKey = 'id', labelKey = 'nama') {
  return list.map(o => `<option value="${esc(o[valueKey])}" ${String(o[valueKey]) === String(selected) ? 'selected' : ''}>${esc(o[labelKey])}</option>`).join('');
}

/* ---------- grafik batang SPP per bulan (SVG, tanpa library) ---------- */
const BULAN_SINGKAT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
function niceMax(v) {
  if (!(v > 0)) return 1000;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const step = [1, 2, 2.5, 5, 10].find(s => v <= s * exp) || 10;
  return step * exp;
}
/**
 * rows: [{ nama, total_ditagihkan, total_diterima }] (12 bulan)
 * opts: { height, id }
 */
function chartSPP(rows, opts = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return '';
  const W = 920, H = opts.height || 300;
  const padL = 72, padR = 16, padT = 22, padB = 52;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const gid = 'sppg-' + String(opts.id || 'x').replace(/[^\w-]/g, '');
  const max = niceMax(Math.max(1, ...list.map(r => Math.max(Number(r.total_ditagihkan) || 0, Number(r.total_diterima) || 0))));
  const y = v => padT + plotH * (1 - (Number(v) || 0) / max);
  const groupW = plotW / list.length;
  const barW = Math.min(26, groupW * 0.3);
  const gap = Math.max(2, groupW * 0.05);
  const ticks = 4;

  let grid = '';
  for (let i = 0; i <= ticks; i++) {
    const val = (max / ticks) * i;
    const yy = y(val);
    grid += `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}" stroke="#F1E3D8" stroke-width="1"${i === 0 ? ' stroke-opacity="1"' : ''}/>`
      + `<text x="${padL - 10}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="10.5" fill="#8A7A70">${rpShort(val).replace('Rp ', '')}</text>`;
  }

  let bars = '';
  list.forEach((r, i) => {
    const cx = padL + groupW * i + groupW / 2;
    const tagih = Number(r.total_ditagihkan) || 0;
    const terima = Number(r.total_diterima) || 0;
    const pct = tagih > 0 ? Math.round((terima / tagih) * 100) : 0;
    const xTagih = cx - gap / 2 - barW;
    const xTerima = cx + gap / 2;
    const hTagih = Math.max(0, (padT + plotH) - y(tagih));
    const hTerima = Math.max(0, (padT + plotH) - y(terima));
    if (tagih > 0) {
      bars += `<rect x="${xTagih.toFixed(1)}" y="${y(tagih).toFixed(1)}" width="${barW.toFixed(1)}" height="${hTagih.toFixed(1)}" rx="3" fill="#FFD5B8" stroke="#FDBA74" stroke-width=".8">`
        + `<title>${esc(r.nama)} — Ditagihkan ${rupiah(tagih)}</title></rect>`;
    }
    if (terima > 0) {
      bars += `<rect x="${xTerima.toFixed(1)}" y="${y(terima).toFixed(1)}" width="${barW.toFixed(1)}" height="${hTerima.toFixed(1)}" rx="3" fill="url(#${gid})">`
        + `<title>${esc(r.nama)} — Diterima ${rupiah(terima)} (${pct}% dari tagihan)</title></rect>`;
    }
    if (tagih > 0) {
      bars += `<text x="${cx.toFixed(1)}" y="${Math.max(padT - 6, y(Math.max(tagih, terima)) - 6).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${pct >= 95 ? '#12805C' : pct >= 70 ? '#B45309' : '#C0272D'}">${pct}%</text>`;
    }
    bars += `<text x="${cx.toFixed(1)}" y="${(padT + plotH + 18).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="600" fill="#5B4A40">${esc(String(r.label || r.nama || BULAN_SINGKAT[i] || '').slice(0, 3))}</text>`;
  });

  const legend = `<div class="chart-legend">
      <span><i style="background:#FFD5B8;border:1px solid #FDBA74"></i>Total Ditagihkan</span>
      <span><i style="background:linear-gradient(135deg,#F97316,#EA580C)"></i>Total Diterima</span>
      <span class="muted">Angka % = capaian penerimaan bulan tersebut</span>
    </div>`;

  return `<div class="chart-wrap">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafik SPP per bulan" preserveAspectRatio="xMidYMid meet">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#FB923C"/><stop offset="1" stop-color="#EA580C"/>
      </linearGradient></defs>
      ${grid}
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="#EAD9CC" stroke-width="1"/>
      ${bars}
    </svg>
    ${legend}
  </div>`;
}

/** Line chart tren penerimaan SPP per bulan (SVG, tanpa library) */
function chartLineSPP(rows, opts = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return '';
  const W = 920, H = 280;
  const padL = 74, padR = 18, padT = 20, padB = 46;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const gid = 'sppl-' + String(opts.id || 'x').replace(/[^\w-]/g, '');
  const max = niceMax(Math.max(1, ...list.map(r => Math.max(Number(r.diterima) || 0, Number(r.ditagihkan) || 0))));
  const x = i => padL + (list.length === 1 ? plotW / 2 : (plotW / (list.length - 1)) * i);
  const y = v => padT + plotH * (1 - (Number(v) || 0) / max);
  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const val = (max / 4) * i, yy = y(val);
    grid += `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}" stroke="#F1E3D8"/>`
      + `<text x="${padL - 10}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="10.5" fill="#8A7A70">${rpShort(val).replace('Rp ', '')}</text>`;
  }
  const line = (key, color, dash) => {
    const pts = list.map((r, i) => `${x(i).toFixed(1)},${y(r[key]).toFixed(1)}`).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.6" stroke-linejoin="round"${dash ? ' stroke-dasharray="6 5"' : ''}/>`
      + list.map((r, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(r[key]).toFixed(1)}" r="4" fill="#fff" stroke="${color}" stroke-width="2.2">`
        + `<title>${esc(r.label)} — ${key === 'diterima' ? 'Diterima' : 'Ditagihkan'} ${rupiah(r[key])}</title></circle>`).join('');
  };
  const areaPts = list.map((r, i) => `${x(i).toFixed(1)},${y(r.diterima).toFixed(1)}`).join(' L ');
  const labels = list.map((r, i) => `<text x="${x(i).toFixed(1)}" y="${(padT + plotH + 18).toFixed(1)}" text-anchor="middle" font-size="10.5" fill="#5B4A40">${esc(r.label)}</text>`).join('');
  const total = list.reduce((a, r) => a + Number(r.diterima || 0), 0);
  return `<div class="chart-wrap">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tren penerimaan SPP per bulan" preserveAspectRatio="xMidYMid meet">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#FB923C" stop-opacity=".32"/><stop offset="1" stop-color="#FB923C" stop-opacity=".02"/>
      </linearGradient></defs>
      ${grid}
      <path d="M ${x(0).toFixed(1)},${(padT + plotH).toFixed(1)} L ${areaPts} L ${x(list.length - 1).toFixed(1)},${(padT + plotH).toFixed(1)} Z" fill="url(#${gid})"/>
      ${line('ditagihkan', '#FDBA74', true)}
      ${line('diterima', '#EA580C', false)}
      ${labels}
    </svg>
    <div class="chart-legend">
      <span><i style="background:#EA580C"></i>Tren Penerimaan SPP per bulan</span>
      <span><i style="background:#FDBA74"></i>Target / Ditagihkan</span>
      <span class="muted">Total diterima ${rupiah(total)}</span>
    </div>
  </div>`;
}

function kop(settings) {
  const logo = settings.sekolah_logo
    ? `<img src="${esc(settings.sekolah_logo)}" alt="Logo">`
    : `<div class="kop-logo-ph">${esc((settings.sekolah_nama || 'S').trim().charAt(0))}</div>`;
  const lines = String(settings.kop_baris || '').split('\n').map(s => s.trim()).filter(Boolean);
  const f = Number(settings.kop_font || 10) || 10;
  const fb = Number(settings.kop_font_besar || 15) || 15;
  if (lines.length) {
    // baris ke-4 = nama sekolah (paling besar & tebal); sisanya mengikuti font size kecil
    const txt = lines.map((l, i) => i === 3
      ? `<div class="l2" style="font-size:${fb}pt">${esc(l)}</div>`
      : `<div class="l1" style="font-size:${f}pt">${esc(l)}</div>`).join('');
    return `<div class="kop">${logo}<div class="kop-txt">${txt}</div></div>`;
  }
  const alamat = esc(settings.sekolah_alamat || '').replace(/\n/g, '<br>');
  return `<div class="kop">${logo}<div class="kop-txt">
    <div class="l2">${esc(settings.sekolah_nama || 'NAMA SEKOLAH')}</div>
    <div class="l3">${alamat}</div>
  </div></div>`;
}
/**
 * Kop sekolah RINGKAS untuk kwitansi (1/3 F4 · 210 × 99 mm).
 * Urutan baris kop_baris: 1 yayasan … 4 nama sekolah … terakhir alamat/kontak.
 * Hanya 3 baris yang dipakai agar tinggi kop ±10 mm dan isi kwitansi tetap muat 1 halaman.
 */
function kwitansiKop(settings) {
  const s = settings || {};
  const nama = String(s.sekolah_nama || 'NAMA SEKOLAH').trim();
  const inisial = (nama.replace(/^(SMA|SMK|SMP|SD|MA|MTs|S)\s+/i, '').charAt(0) || nama.charAt(0) || 'S').toUpperCase();
  const logo = s.sekolah_logo
    ? `<img src="${esc(s.sekolah_logo)}" alt="Logo">`
    : `<div class="kwit-kop-ph">${esc(inisial)}</div>`;
  const lines = String(s.kop_baris || '').split('\n').map(x => x.trim()).filter(Boolean);
  const alamatSetting = String(s.sekolah_alamat || '').replace(/[\r\n]+/g, ' ').trim();
  let yayasan = '', namaBaris = '', alamat = '';
  if (lines.length >= 4) {
    yayasan = lines[0];
    namaBaris = lines[3];
    alamat = lines[lines.length - 1] !== namaBaris ? lines[lines.length - 1] : alamatSetting;
  } else if (lines.length) {
    namaBaris = lines[0];
    alamat = lines.slice(1).join(' · ') || alamatSetting;
  } else {
    namaBaris = nama;
    alamat = alamatSetting;
  }
  return `<div class="kwit-kop">${logo}<div class="kwit-kop-txt">
    ${yayasan ? `<div class="kwit-kop-y">${esc(yayasan)}</div>` : ''}
    <div class="kwit-kop-nama">${esc(namaBaris || nama)}</div>
    ${alamat ? `<div class="kwit-kop-l">${esc(alamat)}</div>` : ''}
  </div></div>`;
}

/** input nominal dengan pemisah ribuan otomatis (data-money → diformat di app.js) */
function moneyInput(name, value, extra = '') {
  return `<input type="text" inputmode="numeric" autocomplete="off" name="${name}" value="${esc(fmtMoney(value))}" data-money ${extra}>`;
}
function signBlock(settings, opts = {}) {
  const tgl = opts.tanggal || '';
  // tempat default mengikuti setting print_tempat ("Cikoneng") — dapat diubah di Desain Templat Cetak
  const place = String(opts.tempat || (settings && settings.print_tempat) || 'Cikoneng').trim();
  const tanggalBaris = [place, tgl].filter(Boolean).join(', ');
  return `<div class="sign-grid" style="grid-template-columns:1fr 1fr">
    <div class="sig"><div>Mengetahui,</div><div style="font-weight:600">Kepala ${esc(settings.sekolah_nama || 'Sekolah')}</div><div class="space"></div>
      <div class="nm">${esc(settings.sekolah_kepala || '...............................')}</div>
      <div>NIP. ${esc(settings.sekolah_nip_kepala || '.......................')}</div></div>
    <div class="sig"><div>${esc(tanggalBaris)}</div><div style="font-weight:600">Bendahara</div><div class="space"></div>
      <div class="nm">${esc(settings.sekolah_bendahara || '...............................')}</div>
      <div>NIP. ${esc(settings.sekolah_nip_bendahara || '.......................')}</div></div>
  </div>`;
}
/** toggle orientasi cetak (Portrait / Landscape) — halaman cetak dirender ulang sesuai pilihan */
function orientToggle(base, selfPath, current) {
  const raw = String(selfPath || '/');
  const strip = raw.replace(/([?&])orient=[^&]*/g, (m, sep) => '').replace(/[?&]$/, '');
  const link = v => `${base || ''}${strip}${strip.includes('?') ? '&' : '?'}orient=${v}`;
  const cur = current === 'landscape' ? 'landscape' : current === 'small' ? 'small' : 'portrait';
  const b = (v, label) => `<a class="btn btn-sm ${cur === v ? 'btn-primary' : ''}" href="${esc(link(v))}" title="Cetak ${label}">${label}</a>`;
  return `<span class="orient-switch" title="Orientasi kertas cetak">${b('portrait', 'Portrait')}${b('landscape', 'Landscape')}${cur === 'small' || String(strip).includes('kertas=kecil') ? b('small', '1/3 F4') : ''}</span>`;
}

function docPage({ settings, base, title, no = '', body, backHref = '/laporan', css = '', orient = 'portrait', selfPath = '' }) {
  const o = orient === 'landscape' ? 'landscape' : 'portrait';
  return `<!DOCTYPE html><html lang="id"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${base}/assets/app.css?v=${ASSET_V}">
<style>@page{size:A4 ${o};margin:12mm 12mm}</style>
${css ? `<style>${css}</style>` : ''}
</head><body style="background:#FAF4EE" data-orient="${o}">
<div class="content" style="padding:24px 18px 60px">
  <div class="doc-actions no-print">
    <a class="btn" href="${base}${backHref}">${icon('x')}Kembali</a>
    ${selfPath ? orientToggle(base, selfPath, orient) : ''}
    <button class="btn btn-primary" onclick="window.print()">${icon('printer')}Cetak / Simpan PDF</button>
  </div>
  <div class="doc">
    ${kop(settings)}
    <div class="doc-title"><h3>${esc(title)}</h3>${no ? `<div class="no">${esc(no)}</div>` : ''}</div>
    ${body}
  </div>
  <div class="doc-actions no-print"><span class="help">Gunakan tombol Cetak / Simpan PDF lalu pilih "Save as PDF" untuk menyimpan berkas.</span></div>
</div>
<script src="${base}/assets/app.js?v=${ASSET_V}"></script>
</body></html>`;
}

/** lembar cetak bebas (leger honor, slip gaji) dengan ukuran kertas khusus */
function printPage({ settings, base, title, body, backHref = '/', pageCss = '', backLabel = 'Kembali', extraActions = '', bodyClass = 'print-page', orient = 'portrait', selfPath = '' }) {
  return `<!DOCTYPE html><html lang="id"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${base}/assets/app.css?v=${ASSET_V}">
<style>${pageCss}</style>
</head><body class="${bodyClass}" data-orient="${esc(orient)}">
<div class="doc-actions no-print">
  <a class="btn" href="${base}${backHref}">${icon('x')}${esc(backLabel)}</a>
  ${selfPath ? orientToggle(base, selfPath, orient) : ''}
  ${extraActions}
  <button class="btn btn-primary" onclick="window.print()">${icon('printer')}Cetak / Simpan PDF</button>
</div>
<div class="print-area">${body}</div>
</body></html>`;
}

/* ---------- ukuran kertas kwitansi transaksi (default 21 cm × 9,9 cm) ---------- */
function kwitansiSize(settings) {
  const n = (v, d) => { const x = Number(String(v === undefined || v === null ? '' : v).replace(',', '.')); return Number.isFinite(x) && x > 0 ? x : d; };
  const s = settings || {};
  return {
    w: n(s.kw_trx_w_mm, 210),
    h: n(s.kw_trx_h_mm, 99),
    mt: n(s.kw_trx_mt_mm, 4), mb: n(s.kw_trx_mb_mm, 4),
    ml: n(s.kw_trx_ml_mm, 6), mr: n(s.kw_trx_mr_mm, 6)
  };
}
/**
 * Halaman cetak kwitansi transaksi / bukti piutang.
 * Orientasi diambil dari pilihan pengguna (default PORTRAIT, A4 penuh).
 * Opsi "small" mempertahankan format 1/3 F4 (210 × 99 mm) dari Pengaturan Ukuran Kertas.
 */
function kwitansiPage({ settings, base, title, body, backHref = '/transaksi', backLabel = 'Kembali', extraActions = '', orient = 'portrait', selfPath = '' }) {
  const k = kwitansiSize(settings);
  const innerW = Math.max(60, k.w - k.ml - k.mr);
  const innerH = Math.max(30, k.h - k.mt - k.mb);
  const fs = Math.max(7.4, Math.min(9.4, innerW / 23));
  const o = orient === 'landscape' ? 'landscape' : orient === 'small' ? 'small' : 'portrait';
  const small = o === 'small';
  const pageCss = small
    ? `@page{size:${k.w}mm ${k.h}mm; margin:${k.mt}mm ${k.mr}mm ${k.mb}mm ${k.ml}mm}
    html,body{margin:0;padding:0}
    .print-area{padding:0;background:#fff}
    .kwit-wrap{width:${innerW}mm; max-width:100%; box-sizing:border-box}
    .kwit-box{margin:0}
    .kwit-body{grid-template-columns:${Math.max(26, Math.round(innerW * 0.29))}mm 1fr; font-size:${fs}pt; line-height:1.15}
    .kwit-box .head{font-size:${Math.max(8.4, Math.min(10.6, innerW / 21))}pt; padding:2.4px 6px}
    .kwit-body .k,.kwit-body .v{padding:2px 6px; line-height:1.15}
    .kwit-amt{font-size:${Math.max(9, Math.min(11, innerW / 20))}pt}
    .kwit-foot{font-size:7.4pt; margin:2mm 0 0; text-align:center; color:#6B5B51; line-height:1.15}
    .sign-grid.sign-3{margin-top:2.4mm; gap:2mm; font-size:${Math.max(6.8, Math.min(8.6, innerW / 27))}pt; line-height:1.15}
    .sign-grid .sig{padding-top:0}
    .sign-grid .space{height:32px}
    @media print{
      html{height:100% !important; max-height:100% !important; overflow:hidden !important; margin:0 !important; padding:0 !important}
      .doc-actions{display:none !important}
      body.kw-page{height:${innerH}mm !important; max-height:${innerH}mm !important; overflow:hidden !important; margin:0 !important; padding:0 !important}
      body.kw-page .print-area{padding:0 !important; margin:0 !important; max-height:${innerH}mm; overflow:hidden}
      .kwit-wrap{max-height:${Math.max(20, innerH - 0.6)}mm; page-break-inside:avoid !important; page-break-after:avoid !important; break-after:avoid !important}
    }`
    : `@page{size:A4 ${o}; margin:10mm}
    html,body{margin:0;padding:0;background:#fff}
    .print-area{padding:0; background:#fff}
    .kwit-wrap{width:100%; max-width:100%; box-sizing:border-box}
    .kwit-box{margin:0}
    .kwit-body{grid-template-columns:54mm 1fr; font-size:11pt; line-height:1.4}
    .kwit-box .head{font-size:12.5pt; padding:6px 10px}
    .kwit-body .k,.kwit-body .v{padding:5px 10px; line-height:1.35}
    .kwit-amt{font-size:13.5pt}
    .kwit-foot{font-size:9pt; margin:3mm 0 0; text-align:center; color:#4A3A30; line-height:1.3}
    .kwit-kop img{width:52px; height:52px; flex:0 0 52px}
    .kwit-kop .kwit-kop-nama{font-size:14pt}
    .kwit-kop .kwit-kop-y,.kwit-kop .kwit-kop-l{font-size:9.5pt}
    .sign-grid.sign-3{margin-top:9mm; gap:8mm; font-size:10.5pt; line-height:1.35; align-items:start}
    .sign-grid .sig{padding-top:0}
    .sign-grid .space{height:62px}
    @media print{ .doc-actions{display:none !important} .kwit-wrap{page-break-inside:avoid !important; break-inside:avoid !important} }`;
  return printPage({
    settings, base, title, body: `<div class="kwit-wrap">${body}</div>`, backHref, backLabel, pageCss,
    bodyClass: small ? 'print-page kw-page' : 'print-page kw-a4',
    orient: o, selfPath,
    extraActions: `${extraActions}<a class="btn" href="${base}/transaksi/kertas" title="Pengaturan ukuran kertas & margin">${icon('settings')}Ukuran Kertas</a>`
  });
}

/** modal "Laporan Validasi Error Import" (baris-per-baris) */
function importErrorModal(errors, opts = {}) {
  const list = Array.isArray(errors) ? errors : [];
  const rows = list.map((e, i) => `<tr>
    <td class="num" style="width:44px">${i + 1}</td>
    <td class="nowrap" style="width:90px">${esc(e.row ? 'Baris ' + e.row : '-')}</td>
    <td>${esc(e.msg || e)}</td>
    <td class="t-sub">${esc(e.raw || '')}</td></tr>`).join('');
  const id = 'mImportErr';
  return modal(id, {
    title: opts.title || 'Laporan Validasi Error Import',
    wide: true,
    body: `<div class="alert err">${icon('alert')}<div><b>${list.length} kesalahan ditemukan.</b>
        Data <b>tidak dimasukkan</b> ke database. Perbaiki baris yang bermasalah pada berkas Excel lalu unggah ulang.</div></div>
      <div class="table-scroll short"><table><thead><tr><th>No</th><th>Lokasi</th><th>Pesan Kesalahan</th><th>Isi Baris</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4">Tidak ada rincian.</td></tr>'}</tbody></table></div>`,
    footer: `<button class="btn btn-primary" data-close="${id}">${icon('x')}Tutup &amp; Perbaiki Berkas</button>`
  }).replace(`class="modal" id="${id}"`, `class="modal show" id="${id}"`);
}

module.exports = { ASSET_V, icon, layout, avatar, badge, bkuStatusBadge, trxStatusBadge, modal, openModalBtn, emptyState, prog, selectOptions, kop, kwitansiKop, signBlock, docPage, printPage, orientToggle, moneyInput, chartSPP, chartLineSPP, importErrorModal, NAV, navCatalog, navVisibility, flashBlock, kwitansiSize, kwitansiPage };
