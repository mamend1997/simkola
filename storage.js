'use strict';
/**
 * ==================================================================
 * STORAGE TERISOLASI PER SEKOLAH (tenant)
 * ------------------------------------------------------------------
 * Setiap berkas unggahan diberi nama:
 *     t<tenant_id>-<jenis>-<timestamp>-<random>-<nama-asli>
 * sehingga dua sekolah tidak akan pernah saling menimpa walaupun
 * nama berkas aslinya sama persis.
 *
 * Bila media proxy platform aktif (APP_MEDIA_TOKEN tersedia) berkas
 * diteruskan ke sana (penyimpanan durable). Bila tidak (mode lokal /
 * pengembangan), berkas disimpan di:
 *     storage/tenants/<tenant_id>/<jenis>/<nama-berkas>
 * dan disajikan lewat route /files/<tenant>/<jenis>/<nama>.
 * ==================================================================
 */
const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const ROOT = path.join(__dirname, 'storage');
const MEDIA_BASE = String(process.env.APP_MEDIA_URL || 'http://127.0.0.1:4310').replace(/\/+$/, '');
const JENIS = new Set(['nota', 'bukti', 'foto', 'panduan', 'tiket', 'logo', 'lain']);

function safeName(raw) {
  return String(raw || 'berkas')
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\s+/g, '-')
    .slice(-110) || 'berkas';
}

/** nama berkas terisolasi tenant + stempel waktu + acak (anti tabrakan) */
function buildName(tenantId, jenis, original) {
  const j = JENIS.has(String(jenis)) ? String(jenis) : 'lain';
  const d = new Date();
  const p2 = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 8);
  return `t${Number(tenantId) || 1}-${j}-${stamp}-${rand}-${safeName(original)}`;
}

function dirOf(tenantId, jenis) {
  const j = JENIS.has(String(jenis)) ? String(jenis) : 'lain';
  return path.join(ROOT, 'tenants', String(Number(tenantId) || 1), j);
}

function dataUrlToBuffer(base64) {
  const raw = String(base64 || '');
  const b64 = raw.includes(',') ? raw.split(',').pop() : raw;
  return Buffer.from(b64, 'base64');
}

/**
 * Simpan unggahan. Mengembalikan { url, name, local }.
 * Melempar Error dengan pesan ramah bila gagal.
 */
async function saveUpload({ base64, filename, jenis = 'lain', tenantId = 1, token = '' }) {
  const buf = dataUrlToBuffer(base64);
  if (!buf.length) throw new Error('Berkas kosong / gagal dibaca.');
  const name = buildName(tenantId, jenis, filename);
  const mediaToken = token || process.env.APP_MEDIA_TOKEN || '';
  if (mediaToken) {
    const r = await fetch(`${MEDIA_BASE}/api/app-media/upload?filename=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: {
        'X-App-Media-Token': mediaToken,
        'Content-Type': 'application/octet-stream',
        'Content-Length': buf.length
      },
      body: buf
    });
    let j = {};
    try { j = await r.json(); } catch (e) { }
    if (!r.ok || !j.ok) throw new Error(j.error || j.message || 'Berkas ditolak oleh server media (periksa tipe/ukuran berkas).');
    return { url: j.url, name, local: false };
  }
  const dir = dirOf(tenantId, jenis);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), buf);
  return { url: `/files/${Number(tenantId) || 1}/${JENIS.has(String(jenis)) ? jenis : 'lain'}/${name}`, name, local: true };
}

/** cari berkas lokal (dipakai route /files) — menolak path traversal */
function localFile(tenantId, jenis, name) {
  const j = JENIS.has(String(jenis)) ? String(jenis) : 'lain';
  const clean = String(name || '').replace(/[^\w.\- ]+/g, '');
  if (!clean) return null;
  const fp = path.join(dirOf(tenantId, j), clean);
  if (!fp.startsWith(path.join(ROOT, 'tenants'))) return null;
  if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) return null;
  return fp;
}

function listTenantFiles(tenantId) {
  const base = path.join(ROOT, 'tenants', String(Number(tenantId) || 1));
  const out = [];
  if (!fs.existsSync(base)) return out;
  for (const jenis of fs.readdirSync(base)) {
    const d = path.join(base, jenis);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d)) {
      try { out.push({ jenis, name: f, size: fs.statSync(path.join(d, f)).size }); } catch (e) { }
    }
  }
  return out;
}

module.exports = { ROOT, JENIS, buildName, dirOf, saveUpload, localFile, listTenantFiles, safeName, dataUrlToBuffer };
