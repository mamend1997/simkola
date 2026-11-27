'strict mode';
const path=require('path');
const {DatabaseSync}=require('node:sqlite');
const lib=require('../lib');
const fp=process.env.SAAS_DB_PATH||'/home/manbi/simkola3/data/saas.db';
const pass=process.env.SAAS_ADMIN_PASSWORD||'Spcbisa123@';
const db=new DatabaseSync(fp);
try{
  const row=db.prepare("SELECT id,email FROM saas_users WHERE role='super_admin' ORDER BY id LIMIT 1").get();
  if(!row) throw new Error('akun super_admin tidak ditemukan');
  db.prepare('UPDATE saas_users SET password=?,mfa_secret=NULL,mfa_pending_secret=NULL,mfa_recovery=?,mfa_enabled=0 WHERE id=?')
    .run(lib.hashPassword(pass),'[]',row.id);
  console.log('[reset-admin] OK',row.email,'password direset & MFA dinonaktifkan');
}finally{db.close()}
