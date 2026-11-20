'use strict';
const env = require('./env');

function isRailwayHost(value) {
  try {
    const raw = String(value || '').trim();
    const parsed = new URL(raw.includes('://') ? raw : 'https://' + raw);
    return parsed.hostname === 'railway.app' || parsed.hostname.endsWith('.railway.app');
  } catch (e) {
    return false;
  }
}

function baseUrl(dbm, req, useFallback = true) {
  const tenant = req && req.tenant || {};
  const getSetting = (key) => {
    if (tenant[key]) return tenant[key];
    return dbm && dbm.getSetting ? dbm.getSetting(key, '') : '';
  };
  const domain = String(getSetting('custom_domain') || '').trim().toLowerCase()
    .replace(/^https?:\/\//i, '').split('/')[0];
  const domainStatus = String(getSetting('custom_domain_status') || '').trim().toUpperCase();
  const basePath = String(req && req.BASE || '').replace(/\/+$/, '');
  if (domain && /^[a-z0-9.-]+$/.test(domain) && !isRailwayHost(domain) && domainStatus === 'VERIFIED') {
    return `https://${domain}${basePath}`;
  }

  const headers = req && req.headers || {};
  const host = String(headers['x-forwarded-host'] || headers.host || '').split(',')[0].trim();
  if (host && !isRailwayHost(host)) {
    const proto = String(headers['x-forwarded-proto'] || '').split(',')[0].trim()
      || (/^(localhost|127\.|0\.0\.0\.0)/.test(host) ? 'http' : 'https');
    return `${proto}://${host}${basePath}`;
  }
  const fallback = useFallback ? String(env.baseUrl() || '').replace(/\/+$/, '') : '';
  return fallback && !isRailwayHost(fallback) ? fallback : '';
}

function absolute(dbm, req, pathname = '') {
  const base = baseUrl(dbm, req);
  const path = String(pathname || '');
  const tail = path && !path.startsWith('/') ? '/' + path : path;
  return base ? base + tail : tail;
}

module.exports = { baseUrl, absolute };
