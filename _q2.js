const B=process.argv[2]||'http://127.0.0.1:8787';
(async()=>{
  const r=await fetch(B+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@xiaoman.ai',password:'xiaoman123'})});
  const j=await r.json();
  const ck=(r.headers.getSetCookie?r.headers.getSetCookie():[r.headers.get('set-cookie')]).filter(Boolean).map(s=>s.split(';')[0]).join('; ');
  const tok = j.token || j.access_token || '';
  const H={'cookie':ck, ...(tok?{authorization:'Bearer '+tok}:{})};
  const conv=await (await fetch(B+'/api/conversations',{headers:H})).json();
  const list = conv.conversations||conv.rows||conv.items||[];
  console.log(B,'conv count',Array.isArray(list)?list.length:JSON.stringify(conv).slice(0,200));
  console.log(' sample', JSON.stringify(list.slice(0,3)));
  const st=await (await fetch(B+'/api/stores',{headers:H})).json();
  const sl=st.stores||st.rows||[];
  console.log(' stores', sl.map(x=>x.id+':'+x.name+':'+x.platform).join(' | '));
})().catch(e=>console.log(B,'ERR',e.message));
