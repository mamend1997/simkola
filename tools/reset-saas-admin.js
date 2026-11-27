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
  console.log('[reset-admin] OK super@simkeu.id akun Super Admin dibuat ulang & MFA dinonaktifkan');
}finally{db.close()}
