'use strict';
const fs=require('fs'),path=require('path'),os=require('node:os');
const {DatabaseSync}=require('node:sqlite');
const repo=path.join(__dirname,'..'),data=path.join(repo,'data');
const dbTenant=path.resolve(process.env.DB_PATH||path.join(data,'keuangan.sqlite'));
const dbControl=path.resolve(process.env.SAAS_DB_PATH||path.join(path.dirname(dbTenant),'saas.db'));
const sqlFile=path.resolve(process.argv[2]||path.join(data,'import.sql'));
const doneMark=path.join(data,'.restore-done');
const log=(...a)=>console.log('[restore-node]',...a);
if(!fs.existsSync(sqlFile)){console.error('[restore-node] GAGAL: SQL tidak ditemukan:',sqlFile);process.exit(1)}
if(fs.existsSync(doneMark)&&!process.argv.includes('--force')){log('sudah dipulihkan');process.exit(0)}
function clear(p){for(const s of ['', '-wal','-shm','-journal']){const f=p+s;if(fs.existsSync(f)){try{fs.unlinkSync(f)}catch(e){}}}}
function split(raw){const re=/^-- ={10,}\r?\n-- (.+?)\r?\n-- (.+?)\r?\n-- ={10,}[ \t]*\r?\n/gm;const m=[];let x;while((x=re.exec(raw)))m.push({h:x.index,b:re.lastIndex,t:x[1].trim()});return m.map((a,i)=>({title:a.t,sql:raw.slice(a.b,i+1<m.length?m[i+1].h:raw.length).trim()}))}
const sections=split(fs.readFileSync(sqlFile,'utf8'));
const cp=sections.find(s=>/CONTROL PLANE/i.test(s.title));
const tenants=sections.filter(s=>/tenant_id\s+(\d+)/i.test(s.title));
if(!cp||!tenants.length){console.error('[restore-node] GAGAL: bagian control plane / tenant tidak ditemukan');process.exit(1)}
log('bagian: control-plane,',tenants.map(s=>s.title.match(/tenant_id\s+(\d+)/i)[1]).join(','));
function importDb(fp,sql,required){fs.mkdirSync(path.dirname(fp),{recursive:true});clear(fp);const db=new DatabaseSync(fp);try{db.exec('PRAGMA foreign_keys=OFF');db.exec('PRAGMA journal_mode=DELETE');db.exec('PRAGMA synchronous=FULL');db.exec(sql);const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));for(const r of required)if(!tables.has(r))throw new Error('tabel wajib hilang: '+r);const ic=db.prepare('PRAGMA integrity_check').all();if(ic.length!==1||ic[0].integrity_check!== 'ok')throw new Error('integrity_check gagal');log('OK:',fp,'tabel=',tables.size)}finally{db.close()}}
importDb(dbControl,cp.sql,['tenants','saas_users','saas_settings']);
const cpdb=new DatabaseSync(dbControl,{readOnly:true});
try{for(const s of tenants){const mt=s.title.match(/tenant_id\s+(\d+)/i);const tid=Number(mt[1]);let target=tid===1?dbTenant:path.join(path.dirname(dbTenant),'tenants','tenant-'+tid+'.db');if(tid!==1){try{const r=cpdb.prepare('SELECT db_file FROM tenants WHERE id=?').get(tid);if(r&&r.db_file)target=path.resolve(r.db_file)}catch(e){}}importDb(target,s.sql,['settings','users','tahun_ajaran']);if(tid===1){const w=new DatabaseSync(dbControl);try{w.prepare('UPDATE tenants SET db_file=? WHERE id=?').run(target,tid)}finally{w.close()}}}}finally{cpdb.close()}
fs.writeFileSync(doneMark,new Date().toISOString()+'\n'+path.basename(sqlFile)+'\n');try{fs.unlinkSync(sqlFile);log('SQL dihapus')}catch(e){log('SQL tetap tersimpan')};log('SELESAI');
