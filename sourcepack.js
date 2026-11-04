'use strict';
/**
 * Pengemasan SOURCE CODE aplikasi menjadi daftar berkas untuk ZIP.
 * Dipakai oleh panel sekolah (dihapus di ronde 26) dan panel Super Admin
 * ("Backup & Restore Database System"). Berkas rahasia (.env), database,
 * node_modules, dan .git TIDAK pernah disertakan.
 */
const fs = require('fs');
const path = require('path');

const SRC_INCLUDE_FILES = [
  'server.js', 'env.js', 'db.js', 'lib.js', 'ui.js', 'wa.js', 'xlsx-read.js',
  'importer.js', 'impcache.js', 'printcfg.js', 'backupdata.js', 'sourcepack.js',
  'package.json', 'package-lock.json', '.env.example', '.gitignore', 'AGENTS.md', 'README.md'
];
const SRC_INCLUDE_DIRS = ['routes', 'public', 'dev-tests'];
const SRC_EXCLUDE_FILES = new Set(['.env', '.env.local', '.vibecoder-media-token']);
const SRC_EXCLUDE_DIRS = new Set(['node_modules', '.git', 'data', '.cache', '.vscode']);
const MAX_SRC_BYTES = 3 * 1024 * 1024;

function collectSource() {
  const files = [];
  const root = path.join(__dirname);
  const put = (abs, rel) => {
    try {
      const st = fs.statSync(abs);
      if (!st.isFile() || st.size > MAX_SRC_BYTES) return;
      files.push({ name: rel.replace(/\\/g, '/'), data: fs.readFileSync(abs) });
    } catch (e) { }
  };
  const walk = (dirAbs, dirRel) => {
    let entries = [];
    try { entries = fs.readdirSync(dirAbs, { withFileTypes: true }); } catch (e) { return; }
    for (const en of entries) {
      const abs = path.join(dirAbs, en.name);
      const rel = dirRel ? dirRel + '/' + en.name : en.name;
      if (en.isDirectory()) {
        if (SRC_EXCLUDE_DIRS.has(en.name)) continue;
        walk(abs, rel);
      } else if (en.isFile()) {
        if (SRC_EXCLUDE_FILES.has(en.name)) continue;
        if (/\.(sqlite|sqlite3|db)(-wal|-shm)?$/i.test(en.name)) continue;
        if (/^\.tmp-/.test(en.name)) continue;
        put(abs, rel);
      }
    }
  };
  for (const f of SRC_INCLUDE_FILES) {
    const abs = path.join(root, f);
    if (fs.existsSync(abs)) put(abs, f);
  }
  for (const d of SRC_INCLUDE_DIRS) {
    const abs = path.join(root, d);
    if (fs.existsSync(abs)) walk(abs, d);
  }
  return files;
}

module.exports = { collectSource, SRC_INCLUDE_FILES, SRC_INCLUDE_DIRS, SRC_EXCLUDE_FILES, SRC_EXCLUDE_DIRS };
