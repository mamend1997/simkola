'use strict';
const fs=require('fs'),os=require('os'),path=require('path');
const {DatabaseSync}=require('node:sqlite');
const lib=require('../lib');
const bd=require('../backupdata');

const sqlFile=process.argv[2];
const outFile=process.argv[3]||'Backup_FULL_SIMKEU_RESTORE.zip';
if(!sqlFile||!fs.existsSync(sqlFile)){console.error('Gunakan: node tools/make-restore-zip.js <dump.sql> [keluaran.zip]');process.exit(1)}

const raw=fs.readFileSync(sqlFile,'utf8');
const re=/^-- ={10,}\r?\n-- (.+?)\r?\n-- (.+?)\r?\n-- ={10,}[ \t]*\r?\n/gm;
const marks=[];let m;
while((m=re.exec(raw)))marks.push({h:m.index,b:re.lastIndex,t:m[1].trim()});
const sections=marks.map((a,i)=>({title:a.t,sql:raw.slice(a.b,i+1<marks.length?marks[i+1].h:raw.length).trim()}));
const cp=sections.find(s=>/CONTROL PLANE/i.test(s.title));
const tenant=sections.find(s=>/tenant_id\s+1/i.test(s.title));
if(!cp||!tenant)throw new Error('Bagian control plane / tenant 1 tidak ditemukan');

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'simkeu-restore-'));
function openDb(file,sql){const d=new DatabaseSync(file);d.exec(sql);return d}
const cpdb=openDb(path.join(tmp,'control.db'),cp.sql);
const tdb=openDb(path.join(tmp,'tenant.db'),tenant.sql);

function tableNames(db){return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r=>r.name))}
const cpTables=tableNames(cpdb);
const cpSkip=new Set(['sessions','saas_jobs','tenants','saas_audit','saas_backup_log']);
const cpData={app:'simkeu-saas',version:2,created_at:lib.nowStamp(),tables:{}};
for(const name of cpTables){if(cpSkip.has(name))continue;try{cpData.tables[name]=cpdb.prepare('SELECT * FROM "'+name+'"').all()}catch(e){}}

const tenantDump={app:'simkeu-sekolah',version:2,created_at:lib.nowStamp(),tables:{}};
for(const name of bd.TABLES){try{tenantDump.tables[name]=tdb.prepare('SELECT * FROM "'+name+'"').all()}catch(e){continue}}

function normalizeUniq(table,column){
  const rows=tenantDump.tables[table];
  if(!Array.isArray(rows)||!rows.length)return;
  const seen=new Map();
  let fixed=0;
  for(const row of rows){
    let key=row[column];
    if(key===null||key===undefined||String(key).trim()==='')continue;
    key=String(key).trim();
    const tenant=String(row.tenant_id||1);
    const id=tenant+'\u001f'+key;
    if(seen.has(id)){
      const suffix='-'+String(row.id||seen.get(id).n).padStart(6,'0')+'-RESTORE';
      row[column]=key+suffix;
      fixed++;
    }else{
      seen.set(id,{n:seen.size+1});
    }
  }
  if(fixed)console.log('[restore zip] '+fixed+' duplikat '+table+'.'+column+' dinormalkan');
}
normalizeUniq('transaksi','no_bukti');
normalizeUniq('iuran_bayar','no_kwitansi');

const zip=lib.zip([
 {name:'control-plane.json',data:JSON.stringify(cpData,null,1)},
 {name:'sekolah/HM2H-database/database.json',data:JSON.stringify(tenantDump,null,1)},
 {name:'README.txt',data:'Backup restore SIMKEU\nNomor bukti/kuitansi duplikat dinormalkan otomatis.\n'}
]);
fs.writeFileSync(outFile,zip);
console.log('[restore zip] '+outFile+' ('+zip.length+' byte)');
cpdb.close();tdb.close();
