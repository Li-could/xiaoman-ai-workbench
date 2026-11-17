const D=require('./lib/db');
(async()=>{
  for (const t of ['bridge_outbox','bridge_snapshots','stores']) {
    try { console.log(t, JSON.stringify(await D.all('SELECT * FROM '+t+' ORDER BY rowid DESC LIMIT 3')).slice(0,700)); }
    catch(e){ console.log(t,'ERR',e.message); }
  }
  try{ console.log('settings', JSON.stringify(await D.all("SELECT k,v FROM settings WHERE k LIKE '%bridge%' OR k LIKE '%inbox%'"))); }catch(e){console.log('set err',e.message)}
  process.exit(0);
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
