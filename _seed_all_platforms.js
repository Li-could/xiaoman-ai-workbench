/* 全平台虚拟数据注入（仅用于本地验证数据管道，不接任何真实账号）
 * 覆盖图1列出的全部 10 个平台：抖音飞鸽/拼多多/快手/京东/视频号/小红书/小时达/淘宝/淘工厂/天猫
 * 目标租户：tn_f012019cb6da04f960
 * 与服务器无关，只写本地 MySQL(xiaoman)。可重复运行：先清 cv_all_%/cv_demo_% 再重建。 */
'use strict';
const mysql = require('mysql2/promise');
const crypto = require('crypto');

const TENANT = 'tn_f012019cb6da04f960';
const IMG = (s) => `https://picsum.photos/seed/${s}/300/300`;
const GOODS = 'https://mobile.yangkeduo.com/goods.html?goods_id=963609656019';

// 10 个平台；platform 字段与 lib/platforms.js 的中文名对齐
// existing=该租户已存在的店铺ID（复用，不重复建）；无则新建
const PLATFORMS = [
  {
    key: 'douyin', platform: '抖音', name: '小满好物', short: '抖', color: '#161823',
    existing: 'st_04f960_dy',
    convs: [
      { id: 'cv_all_dy1', customer: 'momo', unread: 0, sentiment: 'positive',
        tags: ['AI接待', '老客'], order: null, last: '豆沙色最显白，链接里第3个就是～', lastMin: 55,
        msgs: [
          ['customer', '[图片]', 'image', { url: IMG('dy1') }, 70],
          ['customer', '这个口红什么色号显白', 'text', null, 68],
          ['agent', '豆沙色最显白，链接里第3个就是～', 'text', null, 55],
        ] },
      { id: 'cv_all_dy2', customer: '阿白', unread: 1, sentiment: 'neutral',
        tags: ['新客'], order: { no: 'DY20261103001', product: '气垫BB霜', amount: '￥129', status: '待发货' }, last: '好的我拍下啦', lastMin: 8,
        msgs: [
          ['customer', '气垫BB霜有替换装吗', 'text', null, 20],
          ['agent', '有的亲，详情页下面有“加购替换芯”选项～', 'text', null, 12],
          ['customer', '好的我拍下啦', 'text', null, 8],
        ] },
    ],
  },
  {
    key: 'pdd', platform: '拼多多', name: '小满优选', short: '拼', color: '#E02E24',
    existing: 'st_04f960_pdd',
    convs: [
      { id: 'cv_all_pdd1', customer: '福***哥', unread: 1, sentiment: 'neutral',
        tags: ['农资', '老客'], order: null, last: '1千克兑水2000斤左右～', lastMin: 12,
        msgs: [
          ['customer', '[商品链接]', 'link', { url: GOODS, title: '整箱批发45%戊唑咪鲜胺小麦赤霉病农药杀菌剂', price: '￥371' }, 40],
          ['customer', '这个1千克兑多少水', 'text', null, 38],
          ['system', '来自商品详情页 ￥371.00', 'text', null, 37],
          ['agent', '1千克兑水2000斤左右～', 'text', null, 12],
        ] },
      { id: 'cv_all_pdd2', customer: '王大姐', unread: 2, sentiment: 'negative',
        tags: ['售后', '新客'], order: { no: 'PDD2311xxxx8821', product: '收纳箱', amount: '￥39.9', status: '已收货' }, last: '收到箱子有点压痕能补吗', lastMin: 30,
        msgs: [
          ['customer', '收到箱子有点压痕能补吗', 'text', null, 35],
          ['customer', '[图片]', 'image', { url: IMG('pdd2') }, 33],
          ['agent', '亲抱歉，已为您申请补偿券5元，稍后到账～', 'text', null, 30],
        ] },
    ],
  },
  {
    key: 'kuaishou', platform: '快手', name: '小满快手店', short: '快', color: '#FF6600',
    existing: null,
    convs: [
      { id: 'cv_all_ks1', customer: '老铁9527', unread: 1, sentiment: 'positive',
        tags: ['直播下单', '老客'], order: { no: 'KS20261103xx17', product: '手撕牛肉干', amount: '￥49', status: '待发货' }, last: '主播说拍两袋发三袋真的吗', lastMin: 18,
        msgs: [
          ['customer', '主播说拍两袋发三袋真的吗', 'text', null, 25],
          ['agent', '真的老铁！下单备注“三袋”就给您发三袋～', 'text', null, 18],
        ] },
      { id: 'cv_all_ks2', customer: '辣妈小茹', unread: 0, sentiment: 'neutral',
        tags: ['新客'], order: null, last: '儿童零食有家长优惠吗', lastMin: 90,
        msgs: [
          ['customer', '儿童零食有家长优惠吗', 'text', null, 95],
          ['agent', '满99减15，第二件半价哦～', 'text', null, 90],
        ] },
    ],
  },
  {
    key: 'jd', platform: '京东', name: '小满自营店', short: '京', color: '#E1251B',
    existing: 'st_04f960_jd',
    convs: [
      { id: 'cv_all_jd1', customer: '李先生', unread: 1, sentiment: 'negative',
        tags: ['物流', '老客'], order: { no: 'JD2309xxxx8821', product: '扫地机器人', amount: '￥1299', status: '运输中' }, last: '已为您加急，预计明天送达', lastMin: 120,
        msgs: [
          ['customer', '我的订单什么时候发货', 'text', null, 130],
          ['customer', '订单号 JD2309xxxx8821', 'text', null, 129],
          ['agent', '已为您加急，预计明天送达', 'text', null, 120],
        ] },
      { id: 'cv_all_jd2', customer: 'Zoe', unread: 0, sentiment: 'positive',
        tags: ['新客'], order: { no: 'JD2310xxxx7765', product: '机械键盘', amount: '￥459', status: '已签收' }, last: '键盘手感很好，五星', lastMin: 200,
        msgs: [
          ['customer', '键盘手感很好，五星', 'text', null, 205],
          ['agent', '感谢支持，下次复购送键帽～', 'text', null, 200],
        ] },
    ],
  },
  {
    key: 'channels', platform: '视频号', name: '小满视频号店', short: '视', color: '#07C160',
    existing: null,
    convs: [
      { id: 'cv_all_ch1', customer: '小鹿', unread: 1, sentiment: 'neutral',
        tags: ['新客'], order: null, last: '这件卫衣主播身上同款有货吗', lastMin: 22,
        msgs: [
          ['customer', '这件卫衣主播身上同款有货吗', 'text', null, 28],
          ['agent', '有的呀，首页第2个链接就是同款～', 'text', null, 22],
        ] },
      { id: 'cv_all_ch2', customer: '大壮', unread: 0, sentiment: 'positive',
        tags: ['老客'], order: { no: 'CH20261103xx09', product: '运动裤', amount: '￥89', status: '待发货' }, last: '拍了麻烦早点发', lastMin: 60,
        msgs: [
          ['customer', '拍了麻烦早点发', 'text', null, 65],
          ['agent', '已加急，今天下午发出～', 'text', null, 60],
        ] },
    ],
  },
  {
    key: 'xhs', platform: '小红书', name: '小满小红书店', short: '红', color: '#FF2442',
    existing: null,
    convs: [
      { id: 'cv_all_xhs1', customer: '甜筒', unread: 1, sentiment: 'neutral',
        tags: ['种草', '新客'], order: null, last: '笔记里那款精华适合敏感肌吗', lastMin: 15,
        msgs: [
          ['customer', '[图片]', 'image', { url: IMG('xhs1') }, 20],
          ['customer', '笔记里那款精华适合敏感肌吗', 'text', null, 18],
          ['agent', '敏感肌可用的，无酒精配方～', 'text', null, 15],
        ] },
      { id: 'cv_all_xhs2', customer: '布丁', unread: 0, sentiment: 'positive',
        tags: ['老客'], order: { no: 'XHS20261103xx33', product: '面膜', amount: '￥99', status: '已发货' }, last: '上次买的用完再来', lastMin: 140,
        msgs: [
          ['customer', '上次买的用完再来', 'text', null, 145],
          ['agent', '欢迎回购，会员价已生效～', 'text', null, 140],
        ] },
    ],
  },
  {
    key: 'hours', platform: '小时达', name: '小满小时达店', short: '时', color: '#1D2129',
    existing: null,
    convs: [
      { id: 'cv_all_hours1', customer: '加班狗', unread: 2, sentiment: 'neutral',
        tags: ['即时达', '新客'], order: { no: 'HR20261103xx51', product: '矿泉水+泡面', amount: '￥28', status: '配送中' }, last: '大概多久能到', lastMin: 6,
        msgs: [
          ['customer', '大概多久能到', 'text', null, 10],
          ['agent', '骑手已接单，预计30分钟内送达～', 'text', null, 6],
        ] },
      { id: 'cv_all_hours2', customer: '豆豆妈', unread: 0, sentiment: 'positive',
        tags: ['老客'], order: { no: 'HR20261103xx52', product: '婴儿湿巾', amount: '￥19.9', status: '已送达' }, last: '到了谢谢', lastMin: 75,
        msgs: [
          ['customer', '到了谢谢', 'text', null, 80],
          ['agent', '满意请给个好评哦～', 'text', null, 75],
        ] },
    ],
  },
  {
    key: 'taobao', platform: '淘宝', name: '小满旗舰店', short: '淘', color: '#FF5000',
    existing: 'st_04f960_tb',
    convs: [
      { id: 'cv_all_tb1', customer: '薇***', unread: 2, sentiment: 'neutral',
        tags: ['AI接待', '老客'], order: null, last: '好的那我拍下啦', lastMin: 3,
        msgs: [
          ['customer', '在吗？这件风衣有现货吗', 'text', null, 30],
          ['customer', '[图片]', 'image', { url: IMG('tb1') }, 29],
          ['agent', '亲，有现货的哦，现在下单今天发～', 'text', null, 25],
          ['customer', '好的那我拍下啦', 'text', null, 3],
        ] },
      { id: 'cv_all_tb2', customer: 'Anny', unread: 0, sentiment: 'positive',
        tags: ['新客'], order: { no: 'TB20261103xx88', product: '针织衫', amount: '￥199', status: '已发货' }, last: '收到很满意', lastMin: 160,
        msgs: [
          ['customer', '收到很满意', 'text', null, 165],
          ['agent', '感谢，欢迎收藏店铺～', 'text', null, 160],
        ] },
    ],
  },
  {
    key: 'taofactory', platform: '淘工厂', name: '小满淘工厂店', short: '厂', color: '#FF6A00',
    existing: null,
    convs: [
      { id: 'cv_all_tf1', customer: '批发老张', unread: 1, sentiment: 'neutral',
        tags: ['B端', '老客'], order: { no: 'TF20261103xx12', product: '打底衫（整箱）', amount: '￥899', status: '待付款' }, last: '整箱起批多少件', lastMin: 25,
        msgs: [
          ['customer', '整箱起批多少件', 'text', null, 30],
          ['agent', '整箱50件起，工厂直供价更优～', 'text', null, 25],
        ] },
      { id: 'cv_all_tf2', customer: '丽丽', unread: 0, sentiment: 'positive',
        tags: ['新客'], order: null, last: '样品什么时候发', lastMin: 110,
        msgs: [
          ['customer', '样品什么时候发', 'text', null, 115],
          ['agent', '今天寄出，明天到～', 'text', null, 110],
        ] },
    ],
  },
  {
    key: 'tmall', platform: '天猫', name: '小满天猫旗舰店', short: '猫', color: '#FF0036',
    existing: null,
    convs: [
      { id: 'cv_all_tm1', customer: 'Coco', unread: 1, sentiment: 'neutral',
        tags: ['品牌', '老客'], order: { no: 'TM20261103xx45', product: '破壁机', amount: '￥399', status: '待发货' }, last: '天猫积分能抵现吗', lastMin: 14,
        msgs: [
          ['customer', '天猫积分能抵现吗', 'text', null, 19],
          ['agent', '可以的，下单页勾选“积分抵现”即可～', 'text', null, 14],
        ] },
      { id: 'cv_all_tm2', customer: '王先生', unread: 0, sentiment: 'positive',
        tags: ['新客'], order: { no: 'TM20261103xx46', product: '电动牙刷', amount: '￥259', status: '已签收' }, last: '正品，很好用', lastMin: 180,
        msgs: [
          ['customer', '正品，很好用', 'text', null, 185],
          ['agent', '感谢认可，享两年质保～', 'text', null, 180],
        ] },
    ],
  },
];

(async () => {
  const con = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: 'lizhanyu18', database: 'xiaoman' });

  // 清掉该租户全部会话（纯净虚拟测试集：只保留本脚本写入的 10 平台数据），可重复跑
  const [old] = await con.query('SELECT id FROM conversations WHERE tenant_id=?', [TENANT]);
  if (old.length) {
    await con.query('DELETE FROM messages WHERE tenant_id=?', [TENANT]);
    await con.query('DELETE FROM conversations WHERE tenant_id=?', [TENANT]);
    console.log('已清理旧会话', old.length, '条');
  }

  const now = new Date();
  const t = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
  const asMsg = (conv, role, text, kind, payload, minutesAgo) => [TENANT, conv, role, text, t(new Date(now.getTime() - minutesAgo * 60000)), t(now), kind || 'text', payload ? JSON.stringify(payload) : null];

  let storesCreated = 0, convs = 0;
  for (const p of PLATFORMS) {
    let storeId = p.existing;
    if (!storeId) {
      // 新建店铺（inbox_code / inbox_token 由 ensureInbox 首次访问自动生成，这里先置空）
      storeId = 'st_04f960_' + p.key;
      const [exist] = await con.query('SELECT id FROM stores WHERE id=?', [storeId]);
      if (!exist.length) {
        const maxSort = (await con.query('SELECT COALESCE(MAX(sort),0) AS m FROM stores WHERE tenant_id=?', [TENANT]))[0][0].m;
        await con.query(
          'INSERT INTO stores (id,tenant_id,name,platform,short,color,account,status,sort,created_at,inbox_code,inbox_token) VALUES (?,?,?,?,?,?,?,\'active\',?,?,?,?)',
          [storeId, TENANT, p.name, p.platform, p.short, p.color, '网页登录', (maxSort || 0) + 1, t(now), '', '']
        );
        storesCreated++;
        console.log(`  新建店铺: ${p.platform} / ${p.name} (${storeId})`);
      }
    }
    for (const c of p.convs) {
      const order = c.order || {};
      await con.query(
        `INSERT INTO conversations
          (id,tenant_id,store_id,customer,tags,order_no,order_product,order_amount,order_status,unread,status,sentiment,last_msg,last_time,updated_at,created_at,transferred_at,channel,visitor_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [c.id, TENANT, storeId, c.customer, JSON.stringify(c.tags || []), order.no || '', order.product || '', order.amount || '', order.status || '',
         c.unread || 0, 'waiting', c.sentiment || 'neutral', c.last, t(new Date(now.getTime() - c.lastMin * 60000)), t(now), t(now), '', 'web_' + p.platform, 'v_' + c.id]
      );
      for (const m of c.msgs) {
        await con.query('INSERT INTO messages (tenant_id,conv_id,role,text,time,created_at,kind,payload) VALUES (?,?,?,?,?,?,?,?)', asMsg(c.id, m[0], m[1], m[2], m[3], m[4]));
      }
      convs++;
    }
  }
  console.log(`完成：新建店铺 ${storesCreated} 个，写入虚拟会话 ${convs} 条（覆盖 ${PLATFORMS.length} 个平台）。`);
  await con.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
