'strict mode';
const path=require('path');
const {DatabaseSync}=require('node:sqlite');
const lib=require('../lib');
const fp=process.env.SAAS_DB_PATH||'/home/manbi/simkola3/data/saas.db';
const pass=process.env.SAAS_ADMIN_PASSWORD||'Spcbisa123@';
const db=new DatabaseSync(fp);
try{
  db.prepare("DELETE FROM saas_users WHERE role='super_admin'").run();
  db.prepare("INSERT INTO saas_users (nama,email,password,role,aktif,mfa_secret,mfa_pending_secret,mfa_recovery,mfa_enabled,created_at) VALUES (?,?,?,?,1,NULL,NULL,'[]',0,datetime('now'))")
    .run('Super Admin Pusat','super@simkeu.id',lib.hashPassword(pass),'super_admin');
  db.exec("DELETE FROM auth_attempts");
  db.exec("UPDATE saas_users SET aktif=1,mfa_secret=NULL,mfa_pending_secret=NULL,mfa_recovery='[]',mfa_enabled=0 WHERE role='super_admin'");
  const row=db.prepare("SELECT id,email,password,aktif,mfa_enabled FROM saas_users WHERE role='super_admin' LIMIT 1").get();
  console.log('[reset-admin] OK super@simkeu.id akun Super Admin dibuat ulang & MFA dinonaktifkan');
  console.log('[reset-admin] verify=', !!(row && lib.verifyPassword(pass,row.password)), 'aktif=', row ? row.aktif : null, 'mfa_enabled=', row ? row.mfa_enabled : null);
}finally{db.close()}
