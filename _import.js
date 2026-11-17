const TOKEN='ik_24fbd34f003454b62cdb10a15b6593fc';
const BASE=process.argv[2]||'https://kefu.zhimengxuan.com';
const GOODS='https://mobile.yangkeduo.com/goods.html?goods_id=963609656019';
const threads=[
 { buyer:'福***哥',
   messages:[
     {role:'agent',kind:'text',text:'亲，很高兴为您服务，请问您要咨询什么问题呢？',time:'2026年10月28日 20:22:42'},
     {role:'system',kind:'text',text:'[快捷问题] 有货吗？/ 什么时候发货？/ 什么快递',time:'2026年10月28日 20:22:43'},
     {role:'customer',kind:'link',url:GOODS,title:'整箱批发45%戊唑咪鲜胺小麦赤霉病稻瘟病叶斑病炭疽病农药杀菌剂 ￥371/2人团',time:'2026年10月28日 20:22:50'},
     {role:'agent',kind:'text',text:'在的呢',time:'2026年10月28日 20:23:10'},
     {role:'customer',kind:'text',text:'1千克可兑爹少斤水',time:'2026年10月28日 20:26:30'},
     {role:'system',kind:'text',text:'[客户来自] 商品详情页 ￥371.00',time:'2026年10月28日 20:26:40'},
     {role:'agent',kind:'text',text:'1千克兑水2000斤哦',time:'2026年10月28日 20:26:49'},
     {role:'agent',kind:'text',text:'亲，1千克兑水2000斤左右，按说明书的用量来用效果更好哦～',time:'2026年10月31日 14:39:06'},
   ]},
 { buyer:'신***',
   messages:[
     {role:'agent',kind:'text',text:'亲，很高兴为您服务，请问您要咨询什么问题呢？',time:'2026年10月31日 14:37:24'},
     {role:'agent',kind:'text',text:'在的呢亲',time:'2026年10月31日 14:37:40'},
   ]},
];
(async()=>{
  for(const t of threads){
    const r=await fetch(BASE+'/api/hooks/inbox/'+TOKEN+'/thread',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({buyer:t.buyer,channel:'web_拼多多',messages:t.messages})});
    const j=await r.json().catch(()=>({}));
    console.log(BASE,t.buyer,'->',JSON.stringify(j));
  }
})();
