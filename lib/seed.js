'use strict';
/**
 * 种子数据：新租户（注册即得）自动获得一套完整可演示的运营数据，
 * 另有平台内置演示账号（admin / agent）方便直接体验。
 */
const { all, get, run, uid, nowISO, setSetting, getSetting } = require('./db');
const { hashPassword } = require('./auth');
const { seedModules } = require('./seed-modules');
const { learnItemKnowledge } = require('./item-knowledge');

const STORE_DEFS = [
  { key: 'tb', name: '小满旗舰店', platform: '淘宝', short: '淘', color: '#FF5000', account: 'xiaoman_tb' },
  { key: 'jd', name: '小满自营店', platform: '京东', short: '京', color: '#E1251B', account: 'xiaoman_jd' },
  { key: 'pdd', name: '小满优选', platform: '拼多多', short: '拼', color: '#E02E24', account: 'xiaoman_pdd' },
  { key: 'dy', name: '小满好物', platform: '抖音', short: '抖', color: '#161823', account: 'xiaoman_dy' },
];

const KNOWLEDGE = [
  { q: '发货时效', a: '付款后 48 小时内发货，默认中通/圆通，偏远地区 5-7 天。' },
  { q: '退换政策', a: '支持 7 天无理由退换，商品完好不影响二次销售；质量问题商家承担运费。' },
  { q: '尺码建议', a: '按平时尺码选择；偏瘦选小一码，偏壮正常码；支持 7 天无理由换码。' },
  { q: '优惠活动', a: '店铺满 99 减 15，可叠加平台跨店满减；会员额外 95 折。' },
  { q: '发票', a: '支持电子普票与专票，订单内填写抬头税号，开好后发预留邮箱。' },
  { q: '材质说明', a: '主体面料为精梳棉，克重 220g，亲肤透气，色牢度 4 级以上。' },
];

/* 商品目录：每个商品都带产品介绍 / 规格 / 属性，AI 可以直接「学」进商品知识库 */
const PRODUCTS = [
  {
    k: 'tb', num: '6996181801', title: '正宗大凉山苹果心丑当季新鲜水果孕妇整箱红富士包邮批发应季冰糖', price: '69', stock: 320,
    pic: '/uploads/products/apple.png',
    description: '这是一款昭通丑苹果的详情页，关键信息如下：\n\n### 苹果特点\n- **外观**：表皮红黄色相间，带有自然的斑点纹理，“其貌不扬”但果肉香甜。\n- **甜度与口感**：有冰糖心，果肉黄嫩清甜多汁，散发淡淡清香，回味悠长。\n- **产地与生长环境**：产自云南昭通，低纬度高原地区，日夜温差大（平均温度约 19±2℃），光照充足。',
    specs: '5斤 90mm（含）-95mm（不含）:69元\n5斤 95mm及以上:69元\n10斤 90mm（含）-95mm（不含）:119元',
    attrs: '产地:中国大陆\n省份:云南省\n城市:昭通市\n水果品种:丑苹果\n包装方式:礼盒装\n特产品类:昭通丑苹果',
  },
  {
    k: 'tb', num: '6996181802', title: '小满纯棉圆领T恤 男款 220g 精梳棉 夏季宽松休闲短袖', price: '89', stock: 1200,
    pic: '/uploads/products/tshirt-main.png',
    description: '220g 精梳棉圆领短袖，亲肤透气不闷汗；肩线加宽、下摆微收，日常通勤与运动都能穿。\n- 面料：100% 精梳棉，克重 220g，色牢度 4 级以上\n- 版型：宽松直筒，不挑身材\n- 洗护：机洗即可，首次洗涤建议冷水单独洗',
    specs: '白色 M:89元\n白色 L:89元\n黑色 L:89元\n黑色 XL:89元\n藏青 2XL:99元',
    attrs: '材质:精梳棉\n克重:220g\n领型:圆领\n产地:广东省\n洗涤方式:机洗',
  },
  {
    k: 'tb', num: '6996181803', title: '小满保温杯 500ml 316 不锈钢双层真空 通勤办公水杯', price: '129', stock: 460,
    pic: '/uploads/products/thermos-scene.png',
    description: '316 不锈钢内胆 + 双层真空结构，95℃ 热水 6 小时后仍有 68℃ 以上；一体成型杯口好清洗，杯盖硅胶圈可拆洗。\n- 容量 500ml，重量 268g\n- 杯身喷塑工艺，防滑不留指纹\n- 支持刻字定制，下单备注内容',
    specs: '月光白 500ml:129元\n雾霾蓝 500ml:129元\n套装（杯+杯刷）:149元',
    attrs: '材质:316不锈钢\n容量:500ml\n保温时长:6小时\n产地:浙江省\n是否可刻字:支持',
  },
  {
    k: 'jd', num: '6996181806', title: '小满保温杯 316不锈钢 500ml 京东自营次日达', price: '119', stock: 150,
    pic: '/uploads/products/thermos-scene.png',
    description: '京东仓发货，当日 23 点前下单次日达。316 不锈钢内胆，双层真空，保温 6 小时以上；杯盖硅胶圈可拆洗。',
    specs: '月光白 500ml:119元\n雾霾蓝 500ml:119元',
    attrs: '材质:316不锈钢\n容量:500ml\n发货仓:京东仓\n产地:浙江省',
  },
  {
    k: 'pdd', num: '6996181804', title: '小满轻量运动鞋 男款 透气网面 缓震跑步鞋', price: '199', stock: 260,
    pic: '/uploads/products/sneakers.png',
    description: '单只约 245g 的轻量跑鞋，飞织网面透气，中底 EVA 缓震，日常通勤与 5 公里慢跑都合适。\n- 鞋面：飞织网布，透气不闷脚\n- 中底：EVA 缓震，回弹好\n- 鞋楦：标准楦，脚宽建议大半码',
    specs: '黑色 40:199元\n黑色 42:199元\n灰色 42:199元\n灰色 44:209元',
    attrs: '鞋面材质:飞织网布\n中底材质:EVA\n适用场景:通勤/慢跑\n产地:福建省\n鞋楦:标准楦',
  },
  {
    k: 'dy', num: '6996181805', title: '直播专享 小满羊毛混纺开衫 女款 秋冬加厚', price: '259', stock: 90,
    pic: '/uploads/products/cardigan.png',
    description: '羊毛混纺（30% 羊毛）加厚开衫，垂感好不易起球；落肩设计显瘦，秋冬内搭外穿都合适。\n- 面料：30% 羊毛 + 70% 抗起球腈纶\n- 版型：落肩宽松，长度过臀\n- 洗护：建议手洗或干洗，平铺阴干',
    specs: '燕麦色 均码:259元\n雾灰色 均码:259元\n藏青色 均码:269元',
    attrs: '面料成分:羊毛30%/腈纶70%\n版型:落肩宽松\n厚度:加厚\n产地:江苏省\n洗涤方式:手洗',
  },
];

const QUICK_REPLIES = [  { text: '亲，您好～ 很高兴为您服务，请问有什么可以帮您？', category: '欢迎语', scope: 'team' },
  { text: '亲，在的呢～ 您说的这款目前有现货，拍下即可安排～', category: '欢迎语', scope: 'personal' },
  { text: '亲，付款后 48 小时内为您安排发出，发出后会有物流单号短信通知哦～', category: '发货物流', scope: 'team' },
  { text: '亲，已为您加急备注优先发货，请您留意物流信息～', category: '发货物流', scope: 'personal' },
  { text: '亲，快递默认发中通/圆通，如需指定快递请在下单时备注～', category: '发货物流', scope: 'team' },
  { text: '亲，支持 7 天无理由退换，运费险可抵扣退回运费，放心选购～', category: '售后政策', scope: 'team' },
  { text: '亲，退款申请提交后 1-3 个工作日原路退回，请您耐心等待～', category: '售后政策', scope: 'team' },
  { text: '亲，质量问题我们承担来回运费，麻烦拍一下实物图给我哦～', category: '售后政策', scope: 'personal' },
  { text: '亲，现在下单可领店铺满 99 减 15 优惠券，叠加平台满减更划算～', category: '优惠活动', scope: 'team' },
  { text: '亲，本店支持花呗分期，3 期免息哦～', category: '优惠活动', scope: 'team' },
  { text: '亲，尺码建议按平时穿的码数选择，偏瘦可小一码，介意可看详情页尺码表～', category: '尺码咨询', scope: 'personal' },
  { text: '亲，这款面料是纯棉，透气不闷汗，机洗即可不用担心～', category: '尺码咨询', scope: 'personal' },
];

const CONVERSATIONS = [
  {
    k: 'tb', name: '张女士', tags: ['老客', 'VIP'], unread: 2, status: 'waiting', sentiment: 'neutral',
    lastTime: '09:52', order: { no: 'TB2026102809312', product: '小满纯棉圆领T恤 男款', amount: '89.00', status: '已发货' },
    messages: [
      ['customer', '在吗？我想问下这个T恤尺码怎么选', '09:48'],
      ['ai', '亲，您好～ 我是小满AI客服，很高兴为您服务～ 请问您平时穿什么码呢？', '09:48'],
      ['customer', '我178，140斤，平时穿L', '09:50'],
      ['customer', '怕买小了或者大了', '09:52'],
    ],
  },
  {
    k: 'tb', name: '李先生', tags: ['新客'], unread: 1, status: 'ai', sentiment: 'negative',
    lastTime: '09:41', order: { no: 'TB2026102711456', product: '小满轻量运动鞋', amount: '239.00', status: '待发货' },
    messages: [
      ['customer', '昨天下的单什么时候发货啊，等好久了', '09:39'],
      ['ai', '亲，非常抱歉让您久等了～ 我帮您查一下订单进度。', '09:40'],
      ['customer', '着急穿，催一下谢谢', '09:41'],
    ],
  },
  {
    k: 'jd', name: '王同学', tags: ['新客'], unread: 0, status: 'ai', sentiment: 'positive',
    lastTime: '09:33', order: { no: 'JD98261027001', product: '小满保温杯 500ml', amount: '69.00', status: '已完成' },
    messages: [
      ['customer', '杯子保温效果怎么样', '09:31'],
      ['ai', '亲，这款采用 316 不锈钢双层真空结构，实测 95℃ 热水 6 小时后仍有 68℃ 以上，日常通勤完全够用哦～', '09:32'],
      ['customer', '好的，谢谢', '09:33'],
    ],
  },
  {
    k: 'pdd', name: '刘阿姨', tags: ['老客'], unread: 3, status: 'waiting', sentiment: 'negative',
    lastTime: '09:28', order: { no: 'PDD202610265378', product: '小满加厚收纳箱 3件套', amount: '45.90', status: '已签收' },
    messages: [
      ['customer', '收到的收纳箱角上磕坏了', '09:24'],
      ['customer', '[图片]', '09:25'],
      ['ai', '亲，非常抱歉给您带来不好的体验～ 方便的话麻烦您保留包装，我这边马上为您申请售后处理。', '09:26'],
      ['customer', '那我这个能退吗', '09:28'],
    ],
  },
  {
    k: 'dy', name: '陈女士', tags: ['新客'], unread: 1, status: 'waiting', sentiment: 'neutral',
    lastTime: '09:20', order: { no: 'DY202610284412', product: '小满羊毛混纺开衫', amount: '299.00', status: '已发货' },
    messages: [
      ['customer', '这个开衫有没有别的颜色', '09:18'],
      ['ai', '亲，这款目前有燕麦色、雾霾蓝、深棕三个颜色，详情页都有实拍图，您偏好哪种风格我帮您推荐～', '09:19'],
      ['customer', '想要浅一点的', '09:20'],
    ],
  },
  {
    k: 'tb', name: '赵先生', tags: ['老客', 'VIP'], unread: 0, status: 'ai', sentiment: 'neutral',
    lastTime: '09:12', order: { no: 'TB2026102899001', product: '小满真丝眼罩', amount: '129.00', status: '已签收' },
    messages: [
      ['customer', '眼罩能水洗吗', '09:10'],
      ['ai', '亲，建议手洗哦～ 30℃ 以下温水加中性洗涤剂轻揉，不要机洗和拧干，平铺阴干即可，这样能更好保护真丝纤维～', '09:11'],
      ['customer', '好的我看看', '09:12'],
    ],
  },
  {
    k: 'jd', name: '孙女士', tags: ['老客'], unread: 2, status: 'waiting', sentiment: 'negative',
    lastTime: '09:05', order: { no: 'JD98261026337', product: '小满护颈记忆枕', amount: '159.00', status: '已签收' },
    messages: [
      ['customer', '睡了两天脖子疼，是不是发错货了', '09:02'],
      ['ai', '亲，非常抱歉让您不舒服了～ 这款是慢回弹护颈款，初期使用 2-3 天可能有适应期。我先帮您核对一下发货型号。', '09:04'],
      ['customer', '我要退货', '09:05'],
    ],
  },
  {
    k: 'pdd', name: '周先生', tags: ['新客'], unread: 0, status: 'ai', sentiment: 'neutral',
    lastTime: '08:58', order: { no: 'PDD202610251102', product: '小满便携折叠凳', amount: '86.50', status: '待发货' },
    messages: [
      ['customer', '下单了什么时候能到', '08:57'],
      ['ai', '亲，付款后 48 小时内安排发出，正常 3-4 天送达，您可在订单里实时查看物流哦～', '08:58'],
    ],
  },
  {
    k: 'dy', name: '吴先生', tags: ['新客'], unread: 0, status: 'ai', sentiment: 'neutral',
    lastTime: '08:50', order: null,
    messages: [
      ['customer', '你们家有没有大码的', '08:49'],
      ['ai', '亲，我们在售的款式最大到 4XL，您方便说下身高体重吗？我帮您看看哪款更合适～', '08:50'],
    ],
  },
  {
    k: 'tb', name: '郑女士', tags: ['老客'], unread: 1, status: 'waiting', sentiment: 'positive',
    lastTime: '08:40', order: { no: 'TB2026102690012', product: '小满厨房收纳架', amount: '119.00', status: '已完成' },
    messages: [
      ['customer', '上次买的收纳架很好用，还想再买一个', '08:37'],
      ['ai', '亲，谢谢您的认可～ 这款现在下单可以领满 99 减 15 的券，叠加会员 95 折更划算哦～', '08:38'],
      ['customer', '好，那我再拍一个', '08:40'],
    ],
  },
];

const TICKETS = [
  {
    k: 'pdd', orderNo: 'PDD202610265378', customer: '刘阿姨', type: 'only_refund', typeLabel: '仅退款',
    amount: '45.90', status: 'pending', priority: 'high', product: '小满加厚收纳箱 3件套',
    reason: '收到商品边角破损，要求仅退款', createdAt: '09:28',
    events: [
      ['09:24', '客户反馈收纳箱边角破损', '客户'],
      ['09:26', '客户上传破损照片，申请仅退款', '客户'],
      ['09:28', '工单自动生成，待客服处理', '系统'],
    ],
  },
  {
    k: 'jd', orderNo: 'JD98261026337', customer: '孙女士', type: 'return', typeLabel: '退货退款',
    amount: '159.00', status: 'processing', priority: 'high', product: '小满护颈记忆枕',
    reason: '使用后颈部不适，怀疑发错货，要求退货退款', createdAt: '09:05',
    events: [
      ['09:02', '客户反馈枕头使用后颈部疼痛', '客户'],
      ['09:05', '客户申请退货退款', '客户'],
      ['09:10', '客服已受理，核对发货型号', '客服'],
    ],
  },
  {
    k: 'tb', orderNo: 'TB2026102711456', customer: '李先生', type: 'logistics', typeLabel: '物流异常',
    amount: '239.00', status: 'pending', priority: 'normal', product: '小满轻量运动鞋',
    reason: '下单超 48 小时未发货，客户催单', createdAt: '09:41',
    events: [
      ['09:39', '客户催发货', '客户'],
      ['09:41', '系统检测到超时未发货，生成工单', '系统'],
    ],
  },
  {
    k: 'dy', orderNo: 'DY202610284412', customer: '陈女士', type: 'return', typeLabel: '退货退款',
    amount: '299.00', status: 'done', priority: 'normal', product: '小满羊毛混纺开衫',
    reason: '颜色与图片不符，申请退货退款', createdAt: '昨日 16:20',
    events: [
      ['昨日 16:20', '客户申请退货退款', '客户'],
      ['昨日 16:45', '客服同意退货，提供退货地址', '客服'],
      ['昨日 18:02', '客户已寄回，等待签收', '客户'],
      ['今日 09:00', '仓库签收，退款完成', '系统'],
    ],
  },
  {
    k: 'tb', orderNo: 'TB2026102899001', customer: '赵先生', type: 'only_refund', typeLabel: '仅退款',
    amount: '129.00', status: 'processing', priority: 'low', product: '小满真丝眼罩',
    reason: '未收到货但显示已签收，申请仅退款', createdAt: '昨日 20:10',
    events: [
      ['昨日 20:10', '客户申请仅退款，称未收到货', '客户'],
      ['昨日 20:30', '客服核查物流签收记录', '客服'],
    ],
  },
  {
    k: 'pdd', orderNo: 'PDD202610251102', customer: '吴先生', type: 'dispute', typeLabel: '交易纠纷',
    amount: '86.50', status: 'pending', priority: 'high', product: '小满便携折叠凳',
    reason: '客户投诉描述不符并申请平台介入', createdAt: '08:40',
    events: [
      ['08:40', '客户发起平台介入，投诉描述不符', '客户'],
      ['08:42', '工单升级为高优先级，待处理', '系统'],
    ],
  },
];

const DASHBOARD = {
  kpis: [
    { key: 'sessions', label: '今日会话量', value: 1286, unit: '', delta: 12.4, color: '#165DFF', spark: [820, 932, 901, 1010, 1120, 1180, 1286] },
    { key: 'firstResp', label: '平均首响', value: 6.2, unit: 's', delta: -18.5, color: '#00B42A', spark: [12, 11, 9.5, 8.2, 7.4, 6.8, 6.2], invert: true },
    { key: 'aiRate', label: 'AI 接待占比', value: 78.6, unit: '%', delta: 6.1, color: '#722ED1', spark: [58, 62, 66, 69, 72, 75, 78.6] },
    { key: 'satisfaction', label: '客户满意度', value: 96.3, unit: '%', delta: 1.8, color: '#FF7D00', spark: [93, 94, 94.5, 95, 95.6, 96, 96.3] },
    { key: 'conversion', label: '询单转化率', value: 34.7, unit: '%', delta: 3.2, color: '#0EA5B7', spark: [28, 29.5, 31, 32, 33, 34, 34.7] },
  ],
  trend7d: {
    labels: ['10-23', '10-24', '10-25', '10-26', '10-27', '10-28', '10-29'],
    ai: [612, 680, 655, 742, 810, 902, 1010],
    human: [268, 240, 255, 232, 248, 260, 276],
  },
  platformDist: [
    { name: '淘宝', value: 428, color: '#FF5000' },
    { name: '京东', value: 302, color: '#E1251B' },
    { name: '拼多多', value: 356, color: '#E02E24' },
    { name: '抖音', value: 200, color: '#161823' },
  ],
  satisfactionTrend: {
    labels: ['10-23', '10-24', '10-25', '10-26', '10-27', '10-28', '10-29'],
    values: [93.0, 94.0, 94.5, 95.0, 95.6, 96.0, 96.3],
  },
  storeRanking: [
    { storeId: 'tb', sessions: 428, aiRate: 81, satisfaction: 96.8, firstResp: 5.6 },
    { storeId: 'pdd', sessions: 356, aiRate: 74, satisfaction: 95.1, firstResp: 7.2 },
    { storeId: 'jd', sessions: 302, aiRate: 79, satisfaction: 97.2, firstResp: 5.9 },
    { storeId: 'dy', sessions: 200, aiRate: 77, satisfaction: 95.7, firstResp: 6.8 },
  ],
  afterSales: { total: 46, pending: 12, processing: 9, done: 25, avgHours: 3.4, refundRate: 2.8 },
};

/* ---------------- 建租户 + 播种 ---------------- */
function createTenant(tenantName) {
  const tenantId = uid('tn');
  const ts = nowISO();
  run('INSERT INTO tenants (id,name,created_at) VALUES (?,?,?)', tenantId, tenantName, ts);
  return tenantId;
}

function seedTenant(tenantId) {
  const ts = nowISO();
  const storeMap = {};

  STORE_DEFS.forEach((s, i) => {
    const id = `st_${tenantId.slice(-6)}_${s.key}`;
    storeMap[s.key] = id;
    run(
      `INSERT OR IGNORE INTO stores (id,tenant_id,name,platform,short,color,account,status,sort,created_at)
       VALUES (?,?,?,?,?,?,?,'active',?,?)`,
      id, tenantId, s.name, s.platform, s.short, s.color, s.account, i, ts
    );
  });

  /* 商品目录：先落库，再让 AI 学一遍（拆成商品知识供回复引用） */
  PRODUCTS.forEach((p) => {
    const storeId = storeMap[p.k];
    if (!storeId) return;
    const numIid = p.num + tenantId.slice(-3);
    run(
      `INSERT OR IGNORE INTO shop_items
       (num_iid,tenant_id,store_id,title,price,num,outer_id,pic_url,status,modified,description,specs,attrs,synced_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      numIid, tenantId, storeId, p.title, p.price, p.stock || 0, '', p.pic || '', 'onsale', '',
      p.description || '', p.specs || '', p.attrs || '', ts
    );
    learnItemKnowledge(tenantId, storeId, {
      num_iid: numIid, title: p.title, price: p.price,
      description: p.description, specs: p.specs, attrs: p.attrs,
    });
  });

  KNOWLEDGE.forEach((k) => {
    run('INSERT INTO knowledge (id,tenant_id,q,a,created_at) VALUES (?,?,?,?,?)',
      uid('kb'), tenantId, k.q, k.a, ts);
  });

  QUICK_REPLIES.forEach((q, i) => {
    const text = typeof q === 'string' ? q : q.text;
    const category = typeof q === 'string' ? '通用' : q.category;
    const scope = typeof q === 'string' ? 'personal' : q.scope;
    run('INSERT INTO quick_replies (id,tenant_id,text,category,scope,use_count,used_at,sort) VALUES (?,?,?,?,?,0,\'\',?)',
      uid('qr'), tenantId, text, category, scope, i);
  });

  CONVERSATIONS.forEach((c, idx) => {
    const convId = uid('cv');
    const last = c.messages[c.messages.length - 1];
    run(
      `INSERT INTO conversations
       (id,tenant_id,store_id,customer,tags,order_no,order_product,order_amount,order_status,unread,status,sentiment,last_msg,last_time,created_at,transferred_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      convId, tenantId, storeMap[c.k], c.name, JSON.stringify(c.tags || []),
      c.order ? c.order.no : '', c.order ? c.order.product : '',
      c.order ? c.order.amount : '', c.order ? c.order.status : '',
      c.unread || 0, c.status, c.sentiment, last[1], c.lastTime, ts,
      c.status === 'human' ? ts : '', ts
    );
    c.messages.forEach(([role, text, time]) => {
      run('INSERT INTO messages (tenant_id,conv_id,role,text,time,created_at) VALUES (?,?,?,?,?,?)',
        tenantId, convId, role, text, time, ts);
    });
  });

  TICKETS.forEach((t) => {
    const tid = uid('tk');
    run(
      `INSERT INTO tickets
       (id,tenant_id,store_id,type,type_label,status,priority,customer,order_no,product,amount,reason,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      tid, tenantId, storeMap[t.k], t.type, t.typeLabel, t.status, t.priority,
      t.customer, t.orderNo, t.product, t.amount, t.reason, t.createdAt, ts
    );
    (t.events || []).forEach(([time, text, actor]) => {
      run('INSERT INTO ticket_events (tenant_id,ticket_id,time,text,actor) VALUES (?,?,?,?,?)',
        tenantId, tid, time, text, actor);
    });
  });

  // 看板数据（示例运营基线）
  const dash = JSON.parse(JSON.stringify(DASHBOARD));
  dash.storeRanking = dash.storeRanking.map((r) => ({ ...r, storeId: storeMap[r.storeId] || r.storeId }));
  setSetting(tenantId, 'dashboard', dash);

  // AI 额度（数据概览右上角「余量」）
  setSetting(tenantId, 'quota', { total: 5000, used: 3400, expireAt: '2026-11-29' });

  // 扩展模块种子（质检 / 通知 / 素材 / 预警 / Agent 工作流）
  seedModules(tenantId, storeMap);

  // AI 默认配置
  setSetting(tenantId, 'ai', {
    provider: 'demo',
    baseURL: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    apiKey: '',
    tone: '亲切',
    temperature: 0.7,
    autoReply: true,
  });

  return storeMap;
}

/** 老库升级：已有租户补齐扩展模块数据（幂等） */
const PLATFORM_KEY = { 淘宝: 'tb', 京东: 'jd', 拼多多: 'pdd', 抖音: 'dy' };
function ensureModules(tenantId) {
  try {
    if (!getSetting(tenantId, 'quota', null)) {
      setSetting(tenantId, 'quota', { total: 5000, used: 3400, expireAt: '2026-11-29' });
    }
    const n = get('SELECT COUNT(*) AS n FROM qc_reviews WHERE tenant_id = ?', tenantId).n;
    if (n > 0) return;
    /* 只用 4 个标准演示店铺，避免同名平台额外店铺覆盖映射 */
    const byName = {};
    all('SELECT * FROM stores WHERE tenant_id = ?', tenantId).forEach((s) => { byName[s.name] = s.id; });
    const map = {};
    STORE_DEFS.forEach((def) => { if (byName[def.name]) map[def.key] = byName[def.name]; });
    seedModules(tenantId, map);
  } catch (e) {
    console.error('补齐扩展模块数据失败：', e.message);
  }
}

/* 已存在租户：幂等补录演示商品 + 触发 AI 学习（仅当该店铺缺商品时） */
function ensureDemoProducts(tenantId) {
  /* 只用 4 个标准演示店铺（按 STORE_DEFS 名称匹配），
     避免被同名平台的额外店铺（如「淘宝店铺」「55555」）覆盖映射 */
  const byName = {};
  all('SELECT * FROM stores WHERE tenant_id = ?', tenantId).forEach((s) => { byName[s.name] = s.id; });
  const map = {};
  STORE_DEFS.forEach((def) => { if (byName[def.name]) map[def.key] = byName[def.name]; });
  if (!Object.keys(map).length) return;
  PRODUCTS.forEach((p) => {
    const storeId = map[p.k];
    if (!storeId) return;
    const numIid = p.num + tenantId.slice(-3);
    const hit = get('SELECT 1 FROM shop_items WHERE num_iid = ? AND tenant_id = ?', numIid, tenantId);
    if (hit) return; // 已存在则跳过，避免重复 AI 学习
    const ts = nowISO();
    run(
      `INSERT INTO shop_items
       (num_iid,tenant_id,store_id,title,price,num,outer_id,pic_url,status,modified,description,specs,attrs,synced_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      numIid, tenantId, storeId, p.title, p.price, p.stock || 0, '', p.pic || '', 'onsale', '',
      p.description || '', p.specs || '', p.attrs || '', ts
    );
    learnItemKnowledge(tenantId, storeId, {
      num_iid: numIid, title: p.title, price: p.price,
      description: p.description, specs: p.specs, attrs: p.attrs,
    });
  });
}

/** 平台内置演示租户（首次启动时创建） */
function ensureDemoTenant() {
  const email = 'admin@xiaoman.ai';
  const exist = get('SELECT * FROM users WHERE email = ?', email);
  if (exist) { ensureModules(exist.tenant_id); ensureDemoProducts(exist.tenant_id); return exist.tenant_id; }

  const tenantId = createTenant('小满科技（演示）');
  seedTenant(tenantId);
  const ts = nowISO();
  run(
    `INSERT INTO users (id,tenant_id,name,email,password,role,status,title,created_at)
     VALUES (?,?,?,?,?,'admin','active',?,?)`,
    uid('us'), tenantId, '李经理', email, hashPassword('xiaoman123'), '客服主管 · 全店铺', ts
  );
  run(
    `INSERT INTO users (id,tenant_id,name,email,password,role,status,title,created_at)
     VALUES (?,?,?,?,?,'agent','active',?,?)`,
    uid('us'), tenantId, '王晓雨', 'agent@xiaoman.ai', hashPassword('xiaoman123'), '客服坐席 · 淘宝/京东', ts
  );
  return tenantId;
}


/* 旧版（无分类）短语：用于把历史演示数据升级到「分组 + 个人/团队」结构。
   仅当某租户的短语与旧集合完全一致时才替换，避免动到用户自己新增的内容。 */
const LEGACY_QUICK_REPLIES = [
  '亲，您好～ 很高兴为您服务，请问有什么可以帮您？',
  '亲，付款后 48 小时内为您安排发出，发出后会有物流单号短信通知哦～',
  '亲，支持 7 天无理由退换，运费险可抵扣退回运费，放心选购～',
  '亲，现在下单可领店铺满 99 减 15 优惠券，叠加平台满减更划算～',
  '亲，已为您加急备注优先发货，请您留意物流信息～',
];

function upgradeQuickReplies(tenantId) {
  const rows = all('SELECT id, text, category, scope FROM quick_replies WHERE tenant_id = ?', tenantId);
  if (!rows.length) return false;
  const allDefault = rows.every(
    (r) => (r.category || '通用') === '通用' && (r.scope || 'personal') === 'personal'
  );
  if (!allDefault) return false;
  const have = rows.map((r) => r.text).slice().sort().join('\n');
  const want = LEGACY_QUICK_REPLIES.slice().sort().join('\n');
  if (have !== want) return false;

  run('DELETE FROM quick_replies WHERE tenant_id = ?', tenantId);
  QUICK_REPLIES.forEach((q, i) => {
    run(
      'INSERT INTO quick_replies (id,tenant_id,text,category,scope,use_count,used_at,sort) VALUES (?,?,?,?,?,0,\'\',?)',
      uid('qr'), tenantId, q.text, q.category, q.scope, i
    );
  });
  return true;
}

module.exports = { STORE_DEFS, PRODUCTS, createTenant, seedTenant, ensureDemoTenant, upgradeQuickReplies };
