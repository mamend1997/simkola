'use strict';
/**
 * ==================================================================
 * OPTIMASI ASET STATIS (CSS/JS/SVG)
 * ------------------------------------------------------------------
 *  · minifikasi aman (komentar & indentasi) — hasil JS divalidasi
 *    dengan vm.Script, bila gagal otomatis memakai berkas asli
 *  · kompresi gzip / brotli sesuai Accept-Encoding
 *  · header Cache-Control immutable bila URL membawa ?v=<versi>
 *
 * Cache disimpan di memori dan dihitung ulang hanya bila mtime berubah,
 * jadi tidak ada biaya tambahan pada setiap request.
 * ==================================================================
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const vm = require('vm');

const cache = new Map();   // key -> { mtime, buf, gzip, br }

/** hapus komentar & rapikan indentasi JS tanpa mengubah semantik */
function minifyJs(src) {
  const s = String(src || '');
  let out = '';
  let i = 0;
  let prevSig = '';          // karakter signifikan terakhir
  let prevWord = '';         // kata terakhir (untuk deteksi regex setelah return/typeof)
  const n = s.length;
  const isIdChar = c => /[A-Za-z0-9_$]/.test(c || '');
  while (i < n) {
    const c = s[i];
    // ---- komentar ----
    if (c === '/' && s[i + 1] === '/') {
      while (i < n && s[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && s[i + 1] === '*') {
      i += 2;
      while (i < n && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i += 2;
      out += ' ';
      continue;
    }
    // ---- string / template / regex ----
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c; i++;
      while (i < n) {
        const d = s[i];
        out += d;
        if (d === '\\') { i++; if (i < n) { out += s[i]; i++; } continue; }
        i++;
        if (d === quote) break;
      }
      prevSig = quote;
      prevWord = '';
      continue;
    }
    if (c === '/' && (i === 0 || /[(,=:[!&|?{};+\-*%~^<>]/.test(prevSig) ||
      /^(return|typeof|case|in|of|delete|void|instanceof|new|do|else|yield|await)$/.test(prevWord))) {
      // regex literal
      out += c; i++;
      let inClass = false;
      while (i < n) {
        const d = s[i];
        out += d; i++;
        if (d === '\\') { if (i < n) { out += s[i]; i++; } continue; }
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) break;
        else if (d === '\n') break;
      }
      while (i < n && /[a-z]/i.test(s[i])) { out += s[i]; i++; }
      prevSig = '/'; prevWord = '';
      continue;
    }
    // ---- whitespace ----
    if (/\s/.test(c)) {
      let hasNl = false;
      while (i < n && /\s/.test(s[i])) { if (s[i] === '\n') hasNl = true; i++; }
      // pertahankan satu spasi antar token, newline dipertahankan (keamanan ASI)
      if (out && !/[\s({[,;:+*/%<>=&|?!{]$/.test(out.slice(-1))) out += ' ';
      if (hasNl) out += '\n';
      continue;
    }
    out += c;
    if (isIdChar(c)) {
      let w = '';
      let j = out.length - 1;
      while (j >= 0 && /[A-Za-z0-9_$]/.test(out[j])) { w = out[j] + w; j--; }
      prevWord = w;
    } else prevWord = '';
    if (!/\s/.test(c)) prevSig = c;
    i++;
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
}

/** CSS: buang komentar & indentasi (aman, tanpa menyentuh isi string) */
function minifyCss(src) {
  const s = String(src || '');
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === '/' && s[i + 1] === '*') {
      i += 2;
      while (i < n && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c; out += c; i++;
      while (i < n) { const d = s[i]; out += d; if (d === '\\') { i++; if (i < n) { out += s[i]; i++; } continue; } i++; if (d === q) break; }
      continue;
    }
    if (/\s/.test(c)) {
      while (i < n && /\s/.test(s[i])) i++;
      if (out && !/[{;:,]$/.test(out.slice(-1))) out += ' ';
      continue;
    }
    out += c;
    if (c === '{' || c === ';' || c === '}' || c === ',') out = out.replace(/ +$/, '');
    i++;
  }
  return out.trim();
}

function compile(src, filename) {
  try { new vm.Script(src, { filename }); return src; } catch (e) {
    console.error('[perf] minify js gagal, memakai berkas asli:', filename, e.message.slice(0, 80));
    return null;
  }
}

function asset(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!['.css', '.js', '.svg', '.json', '.txt'].includes(ext)) return null;
  let st;
  try { st = fs.statSync(filePath); } catch (e) { return null; }
  const key = filePath;
  const hit = cache.get(key);
  if (hit && hit.mtime === st.mtimeMs) return hit;
  let raw = fs.readFileSync(filePath);
  let buf = raw;
  if (ext === '.css' || ext === '.js') {
    const src = raw.toString('utf8');
    const mini = ext === '.css' ? minifyCss(src) : (compile(minifyJs(src), filePath) || src);
    buf = Buffer.from(mini, 'utf8');
  }
  const rec = { mtime: st.mtimeMs, buf, gzip: null, br: null };
  try { rec.gzip = zlib.gzipSync(buf, { level: 9 }); } catch (e) { rec.gzip = null; }
  try { rec.br = zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 10 } }); } catch (e) { rec.br = null; }
  cache.set(key, rec);
  return rec;
}

/** cache-control: immutable untuk URL ber-versi, singkat untuk URL tanpa versi */
function cacheControl(versioned) {
  return versioned
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=3600, must-revalidate';
}

/** kirim aset teroptimasi (minify + gzip/br + cache immutable) */
function sendAsset(req, res, filePath, mime, versioned) {
  const rec = asset(filePath);
  if (!rec) return false;
  const accept = String(req.headers['accept-encoding'] || '');
  const headers = {
    'Content-Type': mime,
    'Cache-Control': cacheControl(versioned),
    'Vary': 'Accept-Encoding'
  };
  let body = rec.buf;
  if (/br/.test(accept) && rec.br) { body = rec.br; headers['Content-Encoding'] = 'br'; }
  else if (/gzip/.test(accept) && rec.gzip) { body = rec.gzip; headers['Content-Encoding'] = 'gzip'; }
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(body);
  return true;
}

module.exports = { minifyJs, minifyCss, asset, sendAsset, cacheControl };
