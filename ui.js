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

/* ---------- identitas resmi sekolah: variabel dinamis untuk kop/kwitansi/portal ---------- */
const BENTUK_LABEL = {
  SMK: 'Sekolah Menengah Kejuruan (SMK)', SMA: 'Sekolah Menengah Atas (SMA)',
  MA: 'Madrasah Aliyah (MA)', SMP: 'Sekolah Menengah Pertama (SMP)',
  MTS: 'Madrasah Tsanawiyah (MTs)', SD: 'Sekolah Dasar (SD)',
  MI: 'Madrasah Ibtidaiyah (MI)', PAUD: 'PAUD / TK / RA', LAIN: 'Lainnya'
};
/** ganti {nama} {npsn} {telp} {email} {website} {bentuk} {status} {kepemilikan} … pada teks bebas */
function fillIdentitas(text, settings) {
  const s = settings || {};
  const nama = String(s.sekolah_nama || '').trim();
  const map = {
    sekolah: nama, nama, sekolah_nama: nama,
    npsn: String(s.sekolah_npsn || '').trim(),
    bentuk: BENTUK_LABEL[String(s.sekolah_bentuk || '').trim()] || String(s.sekolah_bentuk || '').trim(),
    bentuk_kode: String(s.sekolah_bentuk || '').trim(),
    status: String(s.sekolah_status || '').trim(),
    kepemilikan: String(s.sekolah_kepemilikan || '').trim(),
    alamat: String(s.sekolah_alamat || '').replace(/[\r\n]+/g, ' ').trim(),
    telp: String(s.sekolah_telp || '').trim(),
    email: String(s.sekolah_email || '').trim(),
    website: String(s.sekolah_website || '').trim(),
    kepala: String(s.sekolah_kepala || '').trim(),
    bendahara: String(s.sekolah_bendahara || '').trim(),
    nip_kepala: String(s.sekolah_nip_kepala || '').trim(),
    nip_bendahara: String(s.sekolah_nip_bendahara || '').trim()
  };
  return String(text == null ? '' : text).replace(/\{([a-z_]+)\}/gi, (m, key) => {
    const v = map[String(key).toLowerCase()];
    return v === undefined ? m : v;
  });
}
/** baris kontak ringkas: "NPSN 20211525 • Telp. (0265) … • Email: … • https://…" */
function identitasKontak(settings, sep = ' • ') {
  const s = settings || {};
  const parts = [];
  if (String(s.sekolah_npsn || '').trim()) parts.push('NPSN ' + String(s.sekolah_npsn).trim());
  if (String(s.sekolah_telp || '').trim()) parts.push('Telp. ' + String(s.sekolah_telp).trim());
  if (String(s.sekolah_email || '').trim()) parts.push('Email: ' + String(s.sekolah_email).trim());
  if (String(s.sekolah_website || '').trim()) parts.push(String(s.sekolah_website).trim());
  return parts.join(sep);
}
/** daftar baris identitas untuk footer portal publik */
function identitasFooter(settings) {
  const s = settings || {};
  const parts = [];
  const bentuk = BENTUK_LABEL[String(s.sekolah_bentuk || '').trim()] || '';
  if (bentuk) parts.push(bentuk);
  if (String(s.sekolah_status || '').trim()) parts.push('Status ' + String(s.sekolah_status).trim());
  if (String(s.sekolah_npsn || '').trim()) parts.push('NPSN ' + String(s.sekolah_npsn).trim());
  if (String(s.sekolah_telp || '').trim()) parts.push('Telp. ' + String(s.sekolah_telp).trim());
  if (String(s.sekolah_email || '').trim()) parts.push(String(s.sekolah_email).trim());
  if (String(s.sekolah_website || '').trim()) parts.push(String(s.sekolah_website).trim());
  return parts.join(' • ');
}
/** URL Google Fonts (Inter) dimuat non-blocking: preload → stylesheet saat selesai */
const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap';
function fontLinks() {
  return `<link rel="preconnect" href="https://fonts.googleapis.com">`
    + `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`
    + `<link rel="dns-prefetch" href="https://fonts.googleapis.com"><link rel="dns-prefetch" href="https://fonts.gstatic.com">`
    + `<link rel="preload" as="style" href="${FONT_HREF}" onload="this.onload=null;this.rel='stylesheet'">`
    + `<noscript><link rel="stylesheet" href="${FONT_HREF}"></noscript>`;
}
/** preconnect ke host CDN logo/gambar (mempercepat LCP) */
function originOf(url) {
  const m = /^(https?:)\/\/([^/]+)/i.exec(String(url || ''));
  return m ? m[1] + '//' + m[2] : '';
}
function logoPreconnect(urls) {
  const seen = new Set();
  return [].concat(urls || []).map(originOf).filter(o => o && !seen.has(o) && (seen.add(o) || true))
    .map(o => `<link rel="preconnect" href="${esc(o)}" crossorigin><link rel="dns-prefetch" href="${esc(o)}">`).join('');
}
/** atribut srcset/sizes untuk logo (bila varian kecil 96 px tersedia) */
function logoSrcset(settings, sizes) {
  const s = settings || {};
  const full = String(s.sekolah_logo || '').trim();
  const small = String(s.sekolah_logo_small || '').trim();
  if (!full || !small) return '';
  return ` srcset="${esc(small)} 96w, ${esc(full)} 512w" sizes="${esc(sizes || '(max-width:600px) 64px, 96px')}"`;
}
/** mode tampilan (terang/gelap) — dibaca dari setting mode_tema */
function modeOf(settings) {
  return String((settings && settings.mode_tema) || 'light').toLowerCase() === 'dark' ? 'dark' : 'light';
}

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
  login: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17-5-5 5-5"/><path d="M3 12h12"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 15H6L5 6"/><path d="M10 11v6M14 11v6"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 8 5-5 5 5"/><path d="M12 3v12"/>',
  cloud: '<path d="M17.5 19H7a4 4 0 0 1-.7-7.94A6 6 0 0 1 17.9 9.4 4.8 4.8 0 0 1 17.5 19Z"/><path d="m12 12 0 6"/><path d="m9.5 14.5 2.5-2.5 2.5 2.5"/>',
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
  qris: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14h1M14 20h1M18 18h3v3h-3z"/>',
  swap: '<path d="M7 4 3 8l4 4"/><path d="M3 8h13a4 4 0 0 1 0 8h-1"/><path d="m17 20 4-4-4-4"/>',
  whatsapp: '<path d="M12 21a9 9 0 1 0-7.8-4.5L3 21l4.6-1.2A9 9 0 0 0 12 21Z"/><path d="M8.8 8.4c.3-.7.6-.7.9-.7h.6c.2 0 .5 0 .7.5l.7 1.6c.1.2.1.4 0 .6l-.5.6c-.1.2-.2.3 0 .6.5.9 1.3 1.7 2.2 2.2.3.2.4.1.6 0l.6-.6c.2-.2.4-.1.6 0l1.6.8c.4.2.4.4.4.6v.5c0 .4-.3 1-.8 1.3-.5.4-1.2.6-2 .4-1.3-.3-2.6-1-3.7-2.1-1.1-1.1-1.8-2.4-2.1-3.7-.2-.8 0-1.5.4-2Z"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4Z"/>',
  play: '<path d="m6 3 14 9-14 9Z"/>',
  calendar_clock: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><circle cx="15" cy="15" r="1.2"/><path d="M15 12.5V15l1.8 1"/>'
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
      { href: '/rekon', key: 'rekon', label: 'Rekonsiliasi Bank', icon: 'refresh' }
    ]
  },
  {
    id: 'piutang', group: 'Piutang', icon: 'card', items: [
      { href: '/piutang', key: 'piutang', label: 'Piutang Pegawai', icon: 'card' },
      { href: '/piutang-lain', key: 'piutang_lain', label: 'Piutang Sertifikasi', icon: 'shield' },
      { href: '/piutang-lainnya', key: 'piutang_lainnya', label: 'Piutang Lainnya', icon: 'layers' }
    ]
  },
  {
    id: 'akademik', group: 'Akademik & Siswa', icon: 'graduation', items: [
      { href: '/siswa', key: 'siswa', label: 'Data Siswa', icon: 'graduation' },
      { href: '/kelas', key: 'kelas', label: 'Data Kelas', icon: 'book' },
      { href: '/kelas/tingkat', key: 'kelas', activeKey: 'kelas_tingkat', label: 'Pengaturan Kelas & Tingkat', icon: 'settings' },
      { href: '/program-keahlian', key: 'program', label: 'Program Keahlian', icon: 'layers' },
      { href: '/mutasi-kelas', key: 'mutasi_kelas', label: 'Mutasi Kelas', icon: 'swap' },
      { href: '/siswa-nonaktif', key: 'siswa', activeKey: 'siswa_nonaktif', label: 'Siswa Non-Aktif', icon: 'users' }
    ]
  },
  {
    id: 'iuran', group: 'Grup Iuran', icon: 'coins', items: [
      { href: '/iuran', key: 'iuran', label: 'Grup Iuran', icon: 'coins' },
      { href: '/iuran/data', key: 'iuran', activeKey: 'iuran_data', label: 'Data Iuran', icon: 'card' },
      { href: '/iuran/bulanan', key: 'iuran', activeKey: 'iuran_bulanan', label: 'Rincian Iuran Bulanan', icon: 'calendar' },
      { href: '/iuran/transaksi', key: 'iuran', activeKey: 'iuran_trx', label: 'Transaksi Iuran', icon: 'receipt' },
      { href: '/iuran/antrean', key: 'iuran', activeKey: 'iuran_queue', label: 'Antrean Posting Iuran', icon: 'clock' },
      { href: '/iuran/pengingat', key: 'iuran', activeKey: 'iuran_pengingat', label: 'Jadwal Pengingat Tagihan', icon: 'whatsapp' },
      // Beasiswa SPP dipindahkan dari menu Kepegawaian ke kelompok Grup Iuran
      { href: '/beasiswa', key: 'beasiswa', label: 'Beasiswa SPP', icon: 'target' },
      // SPP dipisahkan dari menu Piutang dan diletakkan paling bawah pada kelompok Grup Iuran
      { href: '/spp', key: 'piutang', activeKey: 'spp', label: 'SPP', icon: 'target' }
    ]
  },
  {
    id: 'komunikasi', group: 'Komunikasi Internal', icon: 'inbox', items: [
      { href: '/catatan-pegawai', key: 'catatan', activeKey: 'catatan', label: 'Catatan Pegawai', icon: 'inbox' },
      { href: '/catatan-orangtua', key: 'dashboard', activeKey: 'pesan_orangtua', label: 'Catatan Orang Tua', icon: 'users' }
    ]
  },
  {
    id: 'kepegawaian', group: 'Kepegawaian & Payroll', icon: 'users', items: [
      { href: '/pegawai', key: 'pegawai', label: 'Data Pegawai', icon: 'users' },
      { href: '/payroll', key: 'payroll', label: 'Payroll & Leger Honor', icon: 'wallet' },
      { href: '/payroll/slip', key: 'payroll', activeKey: 'payroll_slip', label: 'Slip Gaji Pegawai', icon: 'printer' },
      { href: '/payroll/kolom', key: 'payroll', activeKey: 'payroll_kolom', label: 'Pengaturan Kolom Leger', icon: 'settings' },
      { href: '/ekskul', key: 'ekskul', label: 'Honor Pembina Ekskul', icon: 'target' },
      { href: '/ekskul/antrean', key: 'ekskul', activeKey: 'ekskul_queue', label: 'Antrean Posting Ekskul', icon: 'clock' }
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
      { href: '/sekolah', key: 'identitas', label: 'Identitas Sekolah', icon: 'school' },
      { href: '/portal-publik', key: 'portal_publik', label: 'Portal Publik', icon: 'link' },
      { href: '/tema', key: 'tema', label: 'Tema & Branding Aplikasi', icon: 'chart' },
      { href: '/tarif-honor', key: 'tarif_honor', label: 'Nominal Tunjangan & Honor', icon: 'wallet' },
      { href: '/pengguna', key: 'pengguna', label: 'Pengguna & Hak Akses', icon: 'users' },
      { href: '/tampilan-menu', key: 'pengguna', activeKey: 'tampilan_menu', label: 'Pengaturan Tampilan Menu', icon: 'menu' },
      { href: '/desain-cetak', key: 'desain_cetak', label: 'Desain Templat Cetak', icon: 'printer' },
      { href: '/trash', key: 'trash', label: 'Kotak Sampah', icon: 'inbox' },
      { href: '/audit', key: 'audit', label: 'Audit Log', icon: 'shield' },
      { href: '/audit-orphan', key: 'identitas', activeKey: 'audit_orphan', label: 'Audit Data Tersembunyi', icon: 'search' },
      { href: '/reset-tahun', key: 'identitas', activeKey: 'reset_tahun', label: 'Reset Data Tahun Ajaran', icon: 'refresh' },
      { href: '/backup', key: 'backup', label: 'Backup & Restore', icon: 'database' },
      { href: '/pengaturan-backup', key: 'backup', action: 'create', activeKey: 'backup_cloud', label: 'Pengaturan Auto-Backup', icon: 'cloud' },
      { href: '/info-layanan', key: 'layanan', label: 'Info Layanan & Perpanjangan', icon: 'shield' }
    ]
  },
  {
    id: 'bantuan', group: 'Bantuan', icon: 'info', items: [
      { href: '/petunjuk', key: 'panduan', label: 'Petunjuk Pengguna', icon: 'book' },
      { href: '/bantuan', key: 'catatan', activeKey: 'bantuan', label: 'Bantuan & Tiket Kendala', icon: 'inbox' }
    ]
  },
  {
    // dokumen resmi layanan — teksnya diatur terpusat oleh Super Admin Pusat
    id: 'legal', group: 'Legalitas Layanan', icon: 'shield', defaultOpen: true, items: [
      { href: '/legal/tos', key: 'legal', activeKey: 'legal_tos', label: 'Syarat & Ketentuan Layanan', icon: 'file' },
      { href: '/legal/sla', key: 'legal', activeKey: 'legal_sla', label: 'Service Level Agreement (SLA)', icon: 'shield' }
    ]
  }
];

/* ---------- tema warna: turunkan palet dari satu warna dasar ---------- */
function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return { h: 25, s: 90, l: 52 };
  const n = parseInt(m[1], 16);
  const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const d = max - min;
  const l = (max + min) / 2;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}
function themeCss(hex) {
  const { h, s, l } = hexToHsl(hex || '#F97316');
  const sat = Math.max(35, Math.min(100, s));
  const cl = v => Math.max(4, Math.min(98, v));
  const hsl = (ll, ss = sat) => `hsl(${h} ${ss}% ${cl(ll)}%)`;
  const base = hsl(l);
  return `<style data-theme>
:root{
  --o-50:${hsl(97, Math.max(50, sat - 20))}; --o-100:${hsl(94, Math.max(50, sat - 15))};
  --o-200:${hsl(87)}; --o-300:${hsl(Math.min(88, l + 22))}; --o-400:${hsl(Math.min(78, l + 10))};
  --o-500:${base}; --o-600:${hsl(l - 6)}; --o-700:${hsl(Math.max(20, l - 13))};
  --bg:${hsl(98.5, 55)};
  --sh-1:0 1px 2px rgba(42,26,18,.05), 0 8px 24px -12px ${hsl(l, Math.min(90, sat))}33;
}
body::before{
  background:
    radial-gradient(760px 480px at 8% -8%, ${hsl(94, 80)} 0%, rgba(255,255,255,0) 62%),
    radial-gradient(680px 420px at 96% 4%, ${hsl(95, 85)} 0%, rgba(255,255,255,0) 60%),
    radial-gradient(700px 500px at 60% 105%, ${hsl(97, 75)} 0%, rgba(255,255,255,0) 65%),
    var(--bg);
}
.ann-bar{margin-bottom:14px;border-width:1.5px}
.nav a img.nav-ico-img{width:17px;height:17px;flex:0 0 17px;object-fit:contain;border-radius:3px}
</style>`;
}

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
/** terapkan penataan menu kustom (urutan, judul, ikon PNG) pada salinan NAV */
function navOrdered(cfg) {
  const uiCfg = cfg || { groups: {}, order: {}, labels: {}, icons: {} };
  const groups = NAV.map((g, i) => ({ ...g, _i: i, items: g.items.slice() }))
    .sort((a, b) => {
      const oa = uiCfg.groups && uiCfg.groups[a.id] !== undefined ? Number(uiCfg.groups[a.id]) : a._i;
      const ob = uiCfg.groups && uiCfg.groups[b.id] !== undefined ? Number(uiCfg.groups[b.id]) : b._i;
      return oa - ob || a._i - b._i;
    });
  for (const g of groups) {
    g.items = g.items.map((it, i) => ({ ...it, _i: i }))
      .sort((a, b) => {
        const oa = uiCfg.order && uiCfg.order[a.href] !== undefined ? Number(uiCfg.order[a.href]) : 1000 + a._i;
        const ob = uiCfg.order && uiCfg.order[b.href] !== undefined ? Number(uiCfg.order[b.href]) : 1000 + b._i;
        return oa - ob || a._i - b._i;
      })
      .map(it => ({
        ...it,
        label: (uiCfg.labels && uiCfg.labels[it.href]) || it.label,
        iconUrl: (uiCfg.icons && uiCfg.icons[it.href]) || ''
      }));
  }
  return groups;
}

function layout({ title, sub = '', user, active, base = '', content, query, roleLabel, pendingCount = 0, can, logoStamp = '', taList = [], taId = null, path = '', navHidden = '', navCfg = null, tema = '', appName = 'SIMKEU Sekolah', appSub = '', appLogo = '', appLogoSmall = '', features = null, tenantInfo = null, impersonate = null, announcements = null, mode = 'light' }) {
  // sub-judul di bawah nama aplikasi ("Sistem Keuangan") — dapat diubah sekolah & Super Admin
  const brandSub = String(appSub || '').trim() || 'Sistem Keuangan';
  const initials = (user?.nama || '?').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();
  const hidden = navVisibility(navHidden);
  const linkOf = (i) => {
    const showPill = (i.key === 'transaksi' || i.activeKey === 'approval') && pendingCount;
    const pill = showPill ? `<span class="pill">${pendingCount}</span>` : '';
    const ico = i.iconUrl
      ? `<img src="${esc(i.iconUrl)}" alt="" class="nav-ico-img" width="17" height="17" loading="lazy" decoding="async" onerror="this.remove()">`
      : icon(i.icon);
    return `<a href="${base}${i.href}" class="${active === (i.activeKey || i.key) ? 'active' : ''}" data-nav-href="${esc(i.href)}">${ico}<span>${esc(i.label)}</span>${pill}</a>`;
  };
  const groups = navOrdered(navCfg);
  let nav = '';
  for (const g of groups) {
    // menu layanan & legalitas selalu tampil untuk semua paket (dokumen resmi + status langganan)
    const featureOn = (i) => !features || i.key === 'layanan' || i.key === 'legal' || features.includes(i.key);
    const items = g.items.filter(i => featureOn(i) && !hidden.has(i.href) && (!can || (i.action ? can(i.key, i.action) : can(i.key))));
    if (!items.length) continue;
    const isOpen = !!g.defaultOpen || items.some(i => active === (i.activeKey || i.key));
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
  const brandMark = appLogo
    ? `<img src="${esc(appLogo)}"${appLogoSmall ? ` srcset="${esc(appLogoSmall)} 96w, ${esc(appLogo)} 512w" sizes="40px"` : ''} alt="Logo" width="40" height="40" fetchpriority="high" decoding="async" style="width:40px;height:40px;border-radius:12px;object-fit:contain;background:#fff;padding:3px;flex:0 0 40px" onerror="this.remove()">`
    : `<div class="brand-mark">${icon('wallet')}</div>`;
  return `<!DOCTYPE html>
<html lang="id" data-mode="${mode === 'dark' ? 'dark' : 'light'}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${esc(appName)}</title>
${fontLinks()}
${logoPreconnect([appLogo])}
${appLogo ? `<link rel="preload" as="image" href="${esc(appLogo)}" fetchpriority="high">` : ''}
<link rel="stylesheet" href="${base}/assets/app.css?v=${ASSET_V}">
${themeCss(tema)}
<link rel="icon" type="image/png" href="${base}/favicon.ico?v=${encodeURIComponent((logoStamp||'').slice(-24))}">
<link rel="apple-touch-icon" href="${base}/favicon.ico">
<meta name="theme-color" content="${esc(/^#[0-9a-fA-F]{6}$/.test(tema) ? tema : '#F97316')}">
</head><body>
<div class="shell">
  <aside class="sidebar" id="sidebar">
    <div class="brand">
      ${brandMark}
      <div style="min-width:0"><div class="brand-name">${esc(appName)}</div><div class="brand-sub">${esc(brandSub)}</div></div>
    </div>
    ${impersonate ? `<div class="demo-chip" style="background:#EEF2FF;color:#4338CA;border-color:#C7D2FE">${icon('shield', 'i-sm')} Mode bantuan Super Admin</div>` : ''}
    <nav class="nav">${nav}</nav>
    <div class="side-foot">v1.0 · ${new Date().getFullYear()} © ${esc(appName.slice(0, 18))}
      <div class="t-sub" style="margin-top:2px">${esc(require('./tz').label())} · GMT${esc(require('./tz').offsetLabel())}</div></div>
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
      ${impersonate ? `<div class="alert info" style="display:flex;align-items:center;gap:12px">
        ${icon('shield')}
        <div style="flex:1"><b>Mode bantuan teknis.</b> Anda masuk sebagai ${esc((tenantInfo && tenantInfo.nama) || 'sekolah ini')}
          atas nama ${esc(impersonate.nama)} (Super Admin Pusat). Tindakan tercatat pada audit log sekolah.</div>
        <a class="btn btn-sm" href="${base}/super-admin/kembali">Kembali ke Super Admin</a>
      </div>` : ''}
      ${Array.isArray(announcements) ? announcements.filter(a => a.tipe === 'banner').map(a => `<div class="alert ${['ok', 'warn', 'err', 'info'].includes(a.warna) ? a.warna : 'info'} ann-bar" data-ann="${a.id}">
        ${icon('bell')}<div><b>${esc(a.judul)}</b>${a.isi ? '<br>' + esc(a.isi) : ''}</div></div>`).join('') : ''}
      ${flashBlock(query || new URLSearchParams())}
      ${content}
    </main>
  </div>
</div>
${Array.isArray(announcements) ? announcements.filter(a => a.tipe === 'popup').map(a => modal('mAnn' + a.id, {
  title: a.judul,
  autoShow: true, autoKey: 'ann' + a.id,
  body: `<div class="alert ${['ok', 'warn', 'err', 'info'].includes(a.warna) ? a.warna : 'info'}" style="margin-top:0">${icon('bell')}<div>${esc(a.isi || '')}</div></div>
    <p class="help">Pengumuman resmi dari Super Admin Pusat.</p>`,
  footer: `<button class="btn" data-close="mAnn${a.id}" data-dismiss-auto>Mengerti</button>`
})).join('') : ''}
<script src="${base}/assets/app.js?v=${ASSET_V}" defer></script>
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

/* ==================================================================
   KOP SURAT DINAMIS
   ------------------------------------------------------------------
   Sumber data kop dapat dipilih di menu Desain Templat Cetak:
     · 'manual' → teks baris ditulis sendiri (settings `kop_baris`)
     · 'auto'   → otomatis dari Identitas Sekolah (nama, NPSN, bentuk,
                  status, kepemilikan, alamat & kontak)
   Ukuran font (pt) dan tebal tiap baris dapat diatur per baris
   (`kop_format` = [{"size":12,"bold":1}, …]).
   Logo kop dapat diunggah terpisah (`kop_logo`) tanpa mengubah logo
   utama sekolah (`sekolah_logo`).
   ================================================================== */
function kopFormatOf(s) {
  let raw = s && s.kop_format;
  if (typeof raw === 'string' && raw.trim()) {
    try { raw = JSON.parse(raw); } catch (e) { raw = []; }
  }
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(x => (x && typeof x === 'object') ? x : {});
  if (typeof raw === 'object') {
    // dukung format objek {"1":{size,bold}, "2":{...}} (indeks mulai 1)
    const out = [];
    for (const k of Object.keys(raw)) {
      const i = Number(k) - 1;
      if (i >= 0) out[i] = (raw[k] && typeof raw[k] === 'object') ? raw[k] : {};
    }
    return out;
  }
  return [];
}
/** susun baris kop otomatis dari Identitas Sekolah */
function autoKopLines(s) {
  const g = k => String((s && s[k]) || '').trim();
  const baris = [];
  const kep = g('sekolah_kepemilikan');
  const bentuk = g('sekolah_bentuk');
  const status = g('sekolah_status');
  const bentukLabel = BENTUK_LABEL && BENTUK_LABEL[bentuk] ? BENTUK_LABEL[bentuk] : bentuk;
  if (kep) baris.push({ teks: kep, size: null, bold: false });
  const l2 = [bentukLabel, status].filter(Boolean).join(' — ');
  if (l2) baris.push({ teks: l2, size: null, bold: false });
  const kop = baris.length ? baris : [];
  const nama = g('sekolah_nama') || 'NAMA SEKOLAH';
  const kontak = [];
  const telp = g('sekolah_telp');
  const email = g('sekolah_email');
  const website = g('sekolah_website').replace(/^https?:\/\//i, '');
  const npsn = g('sekolah_npsn');
  if (telp) kontak.push('Telp. ' + telp);
  if (email) kontak.push('Email: ' + email);
  if (website) kontak.push(website);
  if (npsn) kontak.push('NPSN: ' + npsn);
  const alamat = g('sekolah_alamat').split('\n').map(x => x.trim()).filter(Boolean).join(' · ');
  const alamatBaris = [alamat, kontak.join(' · ')].filter(Boolean).join(' · ');
  return kop.concat([
    { teks: nama, size: null, bold: true, nama: true },
    { teks: alamatBaris, size: null, bold: false }
  ]).filter(l => String(l.teks || '').trim());
}
/* ---------- dua template kop terpisah ----------
   `kop_kwitansi` = kop untuk SEMUA kwitansi (BKU, iuran, pinjaman kegiatan)
   `kop_laporan`  = kop untuk laporan/cetakan (BKU, rekap transaksi, ledger, laporan iuran, leger, ekskul)
   Bila salah satu belum diatur, dipakai pengaturan kop GLOBAL lama (kop_sumber/kop_baris/
   kop_format/kop_logo/kop_font) sehingga instalasi lama tidak berubah. */
const KOP_DEFAULT = {
  // ukuran font kop kwitansi dalam PIXEL (kertas kecil 210×99 mm), laporan dalam POINT
  kwitansi: { sumber: 'auto', baris: [], format: [], logo: '', logo_w: 34, logo_h: 34, garis: 'single', font: 9, font_besar: 11.5 },
  laporan: { sumber: 'auto', baris: [], format: [], logo: '', logo_w: 76, logo_h: 76, garis: 'double', font: 10, font_besar: 15 }
};
const KOP_GARIS = ['single', 'double', 'none'];
const KOP_GARIS_LABEL = { single: 'Garis Tunggal', double: 'Garis Ganda', none: 'Tanpa Garis' };
function kopKeyOf(jenis) { return jenis === 'kwitansi' ? 'kop_kwitansi' : 'kop_laporan'; }
/** true bila sekolah sudah menyimpan template kop khusus jenis ini (bukan warisan global) */
function hasKopCfg(settings, jenis = 'laporan') {
  const raw = (settings || {})[kopKeyOf(jenis)];
  if (raw === undefined || raw === null || raw === '') return false;
  if (typeof raw === 'string') { try { const o = JSON.parse(raw); return !!o && typeof o === 'object'; } catch (e) { return false; } }
  return typeof raw === 'object';
}
/** konfigurasi kop efektif untuk satu jenis dokumen (per-jenis → fallback global lama) */
function kopCfg(settings, jenis = 'laporan') {
  const s = settings || {};
  const j = jenis === 'kwitansi' ? 'kwitansi' : 'laporan';
  let raw = s[kopKeyOf(j)];
  if (typeof raw === 'string' && raw.trim()) {
    try { raw = JSON.parse(raw); } catch (e) { raw = null; }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = null;
  const legacy = {
    sumber: String(s.kop_sumber || 'manual') === 'auto' ? 'auto' : 'manual',
    baris: String(s.kop_baris || '').replace(/\r/g, '').split('\n').map(x => x).filter(x => String(x).trim()),
    format: kopFormatOf(s),
    logo: String(s.kop_logo || ''),
    font: Number(s.kop_font || KOP_DEFAULT[j].font) || KOP_DEFAULT[j].font,
    font_besar: Number(s.kop_font_besar || KOP_DEFAULT[j].font_besar) || KOP_DEFAULT[j].font_besar
  };
  const cfg = Object.assign({}, KOP_DEFAULT[j], legacy, raw || {});
  cfg.sumber = String(cfg.sumber) === 'auto' ? 'auto' : 'manual';
  cfg.baris = Array.isArray(cfg.baris) ? cfg.baris.map(x => String(x == null ? '' : x)) : String(cfg.baris || '').split('\n');
  cfg.format = Array.isArray(cfg.format) ? cfg.format : [];
  cfg.logo = String(cfg.logo || '') || (raw ? '' : legacy.logo);
  const num = (v, d) => { const n = Number(String(v == null ? '' : v).replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : d; };
  cfg.logo_w = num(cfg.logo_w, KOP_DEFAULT[j].logo_w);
  cfg.logo_h = num(cfg.logo_h, KOP_DEFAULT[j].logo_h);
  cfg.font = num(cfg.font, KOP_DEFAULT[j].font);
  cfg.font_besar = num(cfg.font_besar, KOP_DEFAULT[j].font_besar);
  cfg.garis = KOP_GARIS.includes(String(cfg.garis)) ? String(cfg.garis) : KOP_DEFAULT[j].garis;
  return cfg;
}
/** daftar baris kop final (sudah memakai ukuran/tebal/miring per baris) */
function kopLines(settings, jenis = 'laporan') {
  const s = settings || {};
  const cfg = kopCfg(s, jenis);
  let list;
  if (cfg.sumber === 'auto') {
    list = autoKopLines(s).map(l => ({ teks: l.teks, size: l.size || (l.nama ? cfg.font_besar : cfg.font), bold: !!l.bold }));
  } else {
    const arr = cfg.baris.map(x => fillIdentitas(String(x || ''), s).trim()).filter(Boolean);
    // baris ke-4 = nama sekolah (paling besar & tebal) seperti perilaku lama
    list = arr.map((t, i) => ({ teks: t, size: i === 3 ? cfg.font_besar : cfg.font, bold: i === 3 }));
  }
  const fmt = cfg.format;
  return list.map((it, i) => {
    const o = fmt[i] && typeof fmt[i] === 'object' ? fmt[i] : {};
    const size = Number(o.size) > 0 ? Number(o.size) : it.size;
    const bold = (o.bold === undefined || o.bold === null || o.bold === '')
      ? it.bold
      : (o.bold === true || Number(o.bold) === 1);
    const italic = (o.italic === true || Number(o.italic) === 1);
    return { teks: it.teks, size, bold, italic };
  });
}
/** logo kop: memakai logo kop khusus (per jenis) bila diunggah, selain itu logo sekolah */
function kopLogo(settings, jenis = 'laporan') {
  const s = settings || {};
  const cfg = kopCfg(s, jenis);
  return String(cfg.logo || s.sekolah_logo || '').trim();
}
/** CSS garis bawah kop sesuai pilihan (tunggal / ganda / tanpa garis) */
function kopBorder(kind, color = '#2A1A12', weight = 3) {
  if (kind === 'none') return 'none';
  if (kind === 'single') return `${Math.max(1, weight - 1.5)}px solid ${color}`;
  return `${weight}px double ${color}`;
}
/** kop LAPORAN (default) atau kop KWITANSI dalam tata letak penuh */
function kop(settings, jenis = 'laporan') {
  const s = settings || {};
  const cfg = kopCfg(s, jenis);
  const logoUrl = kopLogo(s, jenis);
  const w = cfg.logo_w, h = cfg.logo_h;
  const logo = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="Logo" width="${w}" height="${h}" style="width:${w}px;height:${h}px;flex:0 0 ${w}px" decoding="async"${logoSrcset(s, w + 'px')}>`
    : `<div class="kop-logo-ph" style="width:${h}px;height:${h}px;flex:0 0 ${h}px">${esc((s.sekolah_nama || 'S').trim().charAt(0))}</div>`;
  const lines = kopLines(s, jenis);
  if (lines.length) {
    const txt = lines.map(l => `<div class="${l.bold ? 'l2' : 'l1'}" style="font-size:${l.size}pt${l.bold ? ';font-weight:800' : ''}${l.italic ? ';font-style:italic' : ''}">${esc(l.teks)}</div>`).join('');
    return `<div class="kop" style="border-bottom:${kopBorder(cfg.garis, '#2A1A12', 3)}">${logo}<div class="kop-txt">${txt}</div></div>`;
  }
  const alamat = esc(s.sekolah_alamat || '').replace(/\n/g, '<br>');
  const kontak = identitasKontak(s);
  return `<div class="kop" style="border-bottom:${kopBorder(cfg.garis, '#2A1A12', 3)}">${logo}<div class="kop-txt">
    <div class="l2">${esc(s.sekolah_nama || 'NAMA SEKOLAH')}</div>
    <div class="l3">${alamat}</div>
    ${kontak ? `<div class="l3">${esc(kontak)}</div>` : ''}
  </div></div>`;
}
/**
 * Kop sekolah RINGKAS untuk kwitansi (1/3 F4 · 210 × 99 mm).
 * Memakai template `kop_kwitansi` (sumber manual/otomatis, ukuran & tebal per baris,
 * logo + ukuran logo, garis pemisah).
 * Hanya 3 baris yang dipakai agar tinggi kop ±10 mm dan isi kwitansi tetap muat 1 halaman.
 */
function kwitansiKop(settings) {
  const s = settings || {};
  const cfg = kopCfg(s, 'kwitansi');
  // template khusus tersimpan → ukuran font/logo mengikuti pengaturan; warisan global → pakai CSS kompak lama
  const explicit = hasKopCfg(s, 'kwitansi');
  const px = v => explicit ? ` style="font-size:${v}px"` : '';
  const nama = String(s.sekolah_nama || 'NAMA SEKOLAH').trim();
  const inisial = (nama.replace(/^(SMA|SMK|SMP|SD|MA|MTs|S)\s+/i, '').charAt(0) || nama.charAt(0) || 'S').toUpperCase();
  const logoUrl = kopLogo(s, 'kwitansi');
  const w = cfg.logo_w, h = cfg.logo_h;
  const logo = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="Logo" width="${w}" height="${h}" style="width:${w}px;height:${h}px;flex:0 0 ${w}px" decoding="async"${logoSrcset(s, w + 'px')}>`
    : `<div class="kwit-kop-ph" style="width:${Math.max(w, h)}px;height:${Math.max(w, h)}px">${esc(inisial)}</div>`;
  const lines = kopLines(s, 'kwitansi');
  if (explicit && lines.length) {
    const txt = lines.map(l => `<div style="font-size:${l.size}px;line-height:1.22${l.bold ? ';font-weight:800' : ''}${l.italic ? ';font-style:italic' : ''}">${esc(l.teks)}</div>`).join('');
    return `<div class="kwit-kop" style="border-bottom:${kopBorder(cfg.garis, '#1F1B3A', 2.4)}">${logo}<div class="kwit-kop-txt">${txt}</div></div>`;
  }
  const alamatSetting = String(fillIdentitas(s.sekolah_alamat || '', s)).replace(/[\r\n]+/g, ' ').trim();
  let yayasan = '', namaBaris = '', alamat = '', namaSize = cfg.font_besar, yayasanSize = cfg.font, alamatSize = cfg.font;
  if (lines.length >= 2) {
    const namaIdx = lines.findIndex(l => l.bold) >= 0 ? lines.findIndex(l => l.bold) : lines.length - 1;
    namaBaris = lines[namaIdx].teks;
    namaSize = lines[namaIdx].size || cfg.font_besar;
    yayasan = namaIdx > 0 ? lines[0].teks : '';
    yayasanSize = namaIdx > 0 ? (lines[0].size || cfg.font) : cfg.font;
    const last = lines[lines.length - 1];
    alamat = last && last.teks !== namaBaris ? last.teks : alamatSetting;
    alamatSize = last && last.teks !== namaBaris ? (last.size || cfg.font) : cfg.font;
  } else if (lines.length) {
    namaBaris = lines[0].teks;
    namaSize = lines[0].size || cfg.font_besar;
    alamat = alamatSetting;
  } else {
    namaBaris = nama;
    alamat = alamatSetting;
  }
  const kontak = identitasKontak(s, ' · ');
  const alamatBaris = [alamat, kontak].filter(Boolean).join(' · ');
  return `<div class="kwit-kop" style="border-bottom:${kopBorder(cfg.garis, '#1F1B3A', 2.4)}">${logo}<div class="kwit-kop-txt">
    ${yayasan ? `<div class="kwit-kop-y"${px(yayasanSize)}>${esc(yayasan)}</div>` : ''}
    <div class="kwit-kop-nama"${px(namaSize)}>${esc(namaBaris || nama)}</div>
    ${alamatBaris ? `<div class="kwit-kop-l"${px(alamatSize)}>${esc(alamatBaris)}</div>` : ''}
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
${fontLinks()}
<link rel="stylesheet" href="${base}/assets/app.css?v=${ASSET_V}">
${themeCss(settings && settings.tema_warna)}
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
<script src="${base}/assets/app.js?v=${ASSET_V}" defer></script>
</body></html>`;
}

/** lembar cetak bebas (leger honor, slip gaji) dengan ukuran kertas khusus */
function printPage({ settings, base, title, body, backHref = '/', pageCss = '', backLabel = 'Kembali', extraActions = '', bodyClass = 'print-page', orient = 'portrait', selfPath = '' }) {
  return `<!DOCTYPE html><html lang="id"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${fontLinks()}
<link rel="stylesheet" href="${base}/assets/app.css?v=${ASSET_V}">
${themeCss(settings && settings.tema_warna)}
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

module.exports = { ASSET_V, icon, layout, avatar, badge, bkuStatusBadge, trxStatusBadge, modal, openModalBtn, emptyState, prog, selectOptions, kop, kwitansiKop, kopLines, kopCfg, kopFormatOf, kopKeyOf, hasKopCfg, KOP_DEFAULT, KOP_GARIS, KOP_GARIS_LABEL, kopBorder, autoKopLines, kopLogo, signBlock, docPage, printPage, orientToggle, moneyInput, chartSPP, chartLineSPP, importErrorModal, NAV, navCatalog, navVisibility, navOrdered, themeCss, hexToHsl, flashBlock, kwitansiSize, kwitansiPage, fillIdentitas, identitasKontak, identitasFooter, modeOf, BENTUK_LABEL, logoSrcset, fontLinks, logoPreconnect, originOf };
