#!/usr/bin/env python3
import os, sys, re, shutil, sqlite3, time

repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
data = os.path.join(repo, 'data')
db_tenant = os.path.abspath(os.environ.get('DB_PATH', os.path.join(data, 'keuangan.sqlite')))
db_control = os.path.abspath(os.environ.get('SAAS_DB_PATH', os.path.join(os.path.dirname(db_tenant), 'saas.db')))
sqlfile = os.path.abspath(sys.argv[1] if len(sys.argv)>1 else os.path.join(data, 'import.sql'))
done = os.path.join(data, '.restore-done')

def log(*a): print('[restore-py]', *a, flush=True)

if not os.path.isfile(sqlfile):
    log('GAGAL: berkas tidak ditemukan:', sqlfile); sys.exit(1)
if os.path.exists(done) and '--force' not in sys.argv:
    log('sudah dipulihkan:', done); sys.exit(0)

raw = open(sqlfile, 'r', encoding='utf-8', errors='replace').read()
pat = re.compile(r'^-- ={10,}\s*$\n^-- (.+?)\s*$\n^-- (.+?)\s*$\n^-- ={10,}\s*$\n', re.M)
marks=[]
for m in pat.finditer(raw): marks.append((m.start(), m.end(), m.group(1).strip()))
sections=[]
for i,(start,end,title) in enumerate(marks):
    finish=marks[i+1][0] if i+1<len(marks) else len(raw)
    sections.append((title, raw[end:finish].strip()))

cp=[(t,s) for t,s in sections if 'CONTROL PLANE' in t]
tenants=[(t,s) for t,s in sections if re.search(r'tenant_id\s+(\d+)',t,re.I)]
log('bagian:', 'control-plane' if cp else '-', ', '.join(re.search(r'tenant_id\s+(\d+)',t,re.I).group(1) for t,s in tenants))
if not cp or not tenants:
    log('GAGAL: bagian control plane / tenant tidak ditemukan'); sys.exit(1)

def clear_sidecars(fp):
    for suf in ('','-wal','-shm','-journal'):
        p=fp+suf
        if os.path.exists(p): os.unlink(p)

def backup(fp):
    stamp=time.strftime('%Y%m%d%H%M%S')
    for suf in ('','-wal','-shm','-journal'):
        p=fp+suf
        if os.path.isfile(p):
            d=fp+'.before-restore-'+stamp+suf.replace('-wal','.wal').replace('-shm','.shm').replace('-journal','.journal')
            os.rename(p,d)
            log('cadangan:', d)

def import_db(fp, sql, required):
    os.makedirs(os.path.dirname(fp), exist_ok=True)
    clear_sidecars(fp)
    c=sqlite3.connect(fp)
    try:
        c.execute('PRAGMA foreign_keys=OFF')
        c.execute('PRAGMA journal_mode=DELETE')
        c.execute('PRAGMA synchronous=FULL')
        c.executescript(sql)
        c.commit()
        ic=c.execute('PRAGMA integrity_check').fetchall()
        if ic != [('ok',)]: raise RuntimeError('integrity_check gagal: '+repr(ic))
        tables={r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        miss=[x for x in required if x not in tables]
        if miss: raise RuntimeError('tabel wajib hilang: '+','.join(miss))
        log('OK:', fp, 'tabel=',len(tables))
    finally:
        c.close()

import_db(db_control, cp[0][1], ['tenants','saas_users','saas_settings'])

control=sqlite3.connect(db_control)
try:
    for title,sql in tenants:
        mt=re.search(r'tenant_id\s+(\d+)',title,re.I)
        tid=int(mt.group(1))
        target=db_tenant if tid==1 else os.path.join(os.path.dirname(db_tenant),'tenants',f'tenant-{tid}.db')
        # Baca db_file yang disimpan dump; tenant 1 selalu pakai DB_PATH.
        if tid!=1:
            try:
                row=control.execute('SELECT db_file FROM tenants WHERE id=?',(tid,)).fetchone()
                if row and row[0]: target=os.path.abspath(row[0])
            except Exception: pass
        import_db(target, sql, ['settings','users','tahun_ajaran'])
        if tid==1:
            control.execute('UPDATE tenants SET db_file=? WHERE id=?',(target,tid)); control.commit()
finally:
    control.close()

open(done,'w',encoding='utf-8').write(time.strftime('%Y-%m-%d %H:%M:%S')+'\n'+sqlfile+'\n')
try:
    os.unlink(sqlfile); log('berkas SQL dihapus')
except Exception as e:
    log('SQL tetap tersimpan:',e)
log('SELESAI')
