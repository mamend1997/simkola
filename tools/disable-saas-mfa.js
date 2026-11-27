'use strict';
const { DatabaseSync } = require('node:sqlite');

const fp = process.env.SAAS_DB_PATH || '/home/manbi/simkola3/data/saas.db';
const db = new DatabaseSync(fp);
try {
  db.prepare("UPDATE saas_users SET mfa_secret=NULL, mfa_pending_secret=NULL, mfa_recovery='[]', mfa_enabled=0 WHERE role='super_admin'").run();
  try { db.exec('DELETE FROM auth_attempts'); } catch (e) {}
  const row = db.prepare("SELECT email,mfa_enabled FROM saas_users WHERE role='super_admin' LIMIT 1").get();
  console.log(JSON.stringify(row));
} finally {
  db.close();
}
