const mysql = require('mysql2/promise');
(async () => {
  const con = await mysql.createConnection({ host:'127.0.0.1',port:3306,user:'root',password:'lizhanyu18',database:'xiaoman' });
  const show = async (t) => { const [r] = await con.query(`SHOW COLUMNS FROM ${t}`); return r.map(c=>c.Field).join(', '); };
  console.log('stores cols   :', await show('stores'));
  console.log('conversations :', await show('conversations'));
  console.log('messages cols :', await show('messages'));
  const [st] = await con.query('SELECT id,name,platform,tenant_id FROM stores ORDER BY platform');
  console.log('\n=== STORES ('+st.length+') ===');
  st.forEach(s=>console.log(`  ${s.platform.padEnd(12)} | ${s.name} | ${s.id} | ${s.tenant_id}`));
  const [c] = await con.query('SELECT COUNT(*) n FROM conversations');
  console.log('\nconversations count:', c[0].n);
  await con.end();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
