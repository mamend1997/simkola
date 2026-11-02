'use strict';
/* Penyimpanan sementara hasil parsing import (pratinjau / laporan validasi).
   Disimpan di memori proses — hilang saat server restart (normal & disengaja). */
const { token } = require('./lib');
const store = new Map();
const TTL = 60 * 60 * 1000; // 1 jam

function purge() {
  const now = Date.now();
  for (const [k, v] of store) if (now - v.at > TTL) store.delete(k);
}
function put(data) {
  purge();
  const t = token(9);
  store.set(t, { data, at: Date.now() });
  return t;
}
function get(t) {
  const r = store.get(String(t || ''));
  if (!r) return null;
  if (Date.now() - r.at > TTL) { store.delete(String(t)); return null; }
  return r.data;
}
function drop(t) { store.delete(String(t || '')); }

module.exports = { put, get, drop };
