/* 本地演示数据注入（仅用于登录后查看工作台功能，可重复运行）
 * 目标租户：admin 的 tn_f012019cb6da04f960，挂在它已有的 5 个店铺下。
 * 与服务器无关，只写本地 MySQL。 */
const mysql = require('mysql2/promise');

const TENANT = 'tn_f012019cb6da04f960';
const GOODS = 'https://mobile.yangkeduo.com/goods.html?goods_id=963609656019';
const IMG = (s) => `https://picsum.photos/seed/${s}/300/300`;

(async () => {
  const con = await mysql.createConnection({
    host: '127.0.0.1', port: 3306, user: 'root', password: 'lizhanyu18', database: 'xiaoman',
  });

  // 先清掉旧的演示数据（可重复跑）
  const [old] = await con.query("SELECT id FROM conversations WHERE id LIKE 'cv_demo_%'");
  if (old.length) {
    await con.query('DELETE FROM messages WHERE conv_id LIKE ?', ['cv_demo_%']);
    await con.query("DELETE FROM conversations WHERE id LIKE 'cv_demo_%'");
    console.log('已清理旧演示会话', old.length, '条');
  }

  const [stores] = await con.query(
    'SELECT id,name,platform FROM stores WHERE tenant_id=?', [TENANT]
  );
  const byName = {};
  stores.forEach((s) => (byName[s.name] = s));
  console.log('该租户店铺:', stores.map((s) => s.platform + '=' + s.name).join(', '));
  const S = {
    tb: byName['小满旗舰店'],
    pdd: byName['小满优选'],
    dy: byName['小满好物'],
    jd: byName['小满自营店'],
    ndl: byName['农得利植保店'],
  };

  const now = new Date();
  const t = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  const asMsg = (conv, role, text, kind, payload, minutesAgo) => {
    const d = new Date(now.getTime() - minutesAgo * 60000);
    return [TENANT, conv, role, text, t(d), t(d), kind || 'text', payload ? JSON.stringify(payload) : null];
  };

  let n = 0;
  const insertConv = async (conv, store, customer, channel, unread, sentiment, last, lastMin, msgs) => {
    await con.query(
      `INSERT INTO conversations
        (id,tenant_id,store_id,customer,tags,order_no,order_product,order_amount,order_status,unread,status,sentiment,last_msg,last_time,updated_at,created_at,transferred_at,channel,visitor_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [conv, TENANT, store, customer, '[]', '', '', '', '', unread, 'waiting', sentiment, last, t(new Date(now.getTime() - lastMin * 60000)), t(now), t(now), '', channel, 'v_' + conv]
    );
    for (const m of msgs) {
      await con.query(
        'INSERT INTO messages (tenant_id,conv_id,role,text,time,created_at,kind,payload) VALUES (?,?,?,?,?,?,?,?)',
        m
      );
    }
    n++;
  };

  // 1) 淘宝 · 小满旗舰店：文字 + 图片 + 客服回复（未读，制造角标）
  if (S.tb) {
    await insertConv('cv_demo_tb1', S.tb.id, '薇***', 'web_淘宝', 2, 'neutral',
      '好的那我拍下啦', 3, [
        asMsg('cv_demo_tb1', 'customer', '在吗？这件风衣有现货吗', 'text', null, 30),
        asMsg('cv_demo_tb1', 'customer', '[图片]', 'image', { url: IMG('tb1') }, 29),
        asMsg('cv_demo_tb1', 'agent', '亲，有现货的哦，现在下单今天发～', 'text', null, 25),
        asMsg('cv_demo_tb1', 'customer', '好的那我拍下啦', 'text', null, 3),
      ]);
  }

  // 2) 拼多多 · 小满优选：商品链接 + 客户问 + 系统消息 + 客服回复
  if (S.pdd) {
    await insertConv('cv_demo_pdd1', S.pdd.id, '福***哥', 'web_拼多多', 1, 'neutral',
      '1千克兑水2000斤左右～', 12, [
        asMsg('cv_demo_pdd1', 'customer', '[商品链接]', 'link', { url: GOODS, title: '整箱批发45%戊唑咪鲜胺小麦赤霉病稻瘟病农药杀菌剂', price: '￥371' }, 40),
        asMsg('cv_demo_pdd1', 'customer', '这个1千克兑多少水', 'text', null, 38),
        asMsg('cv_demo_pdd1', 'system', '来自商品详情页 ￥371.00', 'text', null, 37),
        asMsg('cv_demo_pdd1', 'agent', '1千克兑水2000斤左右～', 'text', null, 12),
      ]);
  }

  // 3) 抖音 · 小满好物：图片 + 客户问色号
  if (S.dy) {
    await insertConv('cv_demo_dy1', S.dy.id, 'momo', 'web_抖音', 0, 'positive',
      '豆沙色最显白，链接里第3个就是～', 55, [
        asMsg('cv_demo_dy1', 'customer', '[图片]', 'image', { url: IMG('dy1') }, 70),
        asMsg('cv_demo_dy1', 'customer', '这个口红什么色号显白', 'text', null, 68),
        asMsg('cv_demo_dy1', 'agent', '豆沙色最显白，链接里第3个就是～', 'text', null, 55),
      ]);
  }

  // 4) 京东 · 小满自营店：订单咨询（带订单号）
  if (S.jd) {
    await insertConv('cv_demo_jd1', S.jd.id, '李先生', 'web_京东', 1, 'negative',
      '已为您加急，预计明天送达', 120, [
        asMsg('cv_demo_jd1', 'customer', '我的订单什么时候发货', 'text', null, 130),
        asMsg('cv_demo_jd1', 'customer', '订单号 JD2309xxxx8821', 'text', null, 129),
        asMsg('cv_demo_jd1', 'agent', '已为您加急，预计明天送达', 'text', null, 120),
      ]);
  }

  // 5) 农得利植保店（拼多多）：贴合真实场景的咨询
  await insertConv('cv_demo_ndl1', 'st_325a039f6ff612805c', '远***', 'web_拼多多', 1, 'neutral',
    '好的谢谢', 200, [
      asMsg('cv_demo_ndl1', 'customer', '[商品链接]', 'link', { url: GOODS, title: '戊唑咪鲜胺防治小麦赤霉病农药', price: '￥371' }, 240),
      asMsg('cv_demo_ndl1', 'customer', '1千克可兑多少斤水', 'text', null, 220),
      asMsg('cv_demo_ndl1', 'agent', '1千克兑水2000斤哦', 'text', null, 210),
      asMsg('cv_demo_ndl1', 'customer', '好的谢谢', 'text', null, 200),
    ]);

  console.log('已插入演示会话', n, '条，消息已写入');
  await con.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
