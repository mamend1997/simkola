const { spawn } = require('child_process');
const path = require('path'), os = require('os');
const Database = require('better-sqlite3');
const { chromium } = require('playwright');
const PORT = 3636, DB = path.join(os.tmpdir(), 'peek2-' + Date.now() + '.sqlite');
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, DB_PATH: DB }, stdio: 'ignore' });
const base = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) {} await sleep(150); }
  const db = new Database(DB);
  db.prepare("INSERT INTO pegawai (nama,jabatan,tipe,aktif,whatsapp,tanggal_lahir) VALUES (?,?,?,1,?,?)")
    .run('Rina Wulandari', 'Guru', 'guru', '081234567890', '1990-05-05');
  // payroll only in an OLD month so the current month has none
  const old = new Date(); old.setMonth(old.getMonth() - 3);
  const periodeOld = `${old.getFullYear()}-${String(old.getMonth() + 1).padStart(2, '0')}`;
  db.prepare("INSERT INTO payroll (periode,nama,jabatan,tipe,jam_efektif,jam_telat,honor_jam,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(periodeOld, 'Rina Wulandari', 'Guru', 'guru', 20, 0, 50000, '2026-01-01');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 900, height: 1200 } });
  await p.goto(base + '/portal-slip');
  await p.fill('input[name=nama]', 'Rina Wulandari');
  await p.fill('input[name=lahir]', '1990-05-05');
  await Promise.all([p.waitForNavigation(), p.click('button.btn-primary')]);
  const txt = await p.locator('.portal-wrap').innerText();
  const kode = (/kode OTP Anda: (\d{4})/.exec(txt) || [])[1];
  await p.fill('input[name=kode]', kode);
  await Promise.all([p.waitForNavigation(), p.click('button.btn-primary')]);
  // force a period with no data
  await p.goto(base + '/portal-slip/hasil?token=' + encodeURIComponent(await p.evaluate(() => (document.querySelector('input[name=token]') || {}).value || '')) + '&periode=2030-03');
  const svgs = await p.evaluate(() => [...document.querySelectorAll('svg')].map(s => {
    const r = s.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), cls: s.getAttribute('class'), parent: s.parentElement && s.parentElement.className, inAlert: !!s.closest('.alert') };
  }));
  console.log(JSON.stringify(svgs, null, 1));
  console.log('---TEXT---');
  console.log((await p.locator('.portal-wrap').innerText()).slice(0, 900));
  await b.close(); srv.kill(); db.close();
})().catch(e => { console.error(e); try { srv.kill(); } catch (_) {} process.exit(1); });
