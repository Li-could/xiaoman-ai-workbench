'use strict';
/**
 * 消息接收入口（Inbox Gateway）
 * ------------------------------------------------------------------
 * 解决「店铺授权成功，但收不到别人发来的消息」这一核心问题。
 *
 * 淘宝/天猫开放平台只开放交易、退款、商品类 TMC 事件，买家聊天内容（旺旺/千牛 IM）
 * 不对外开放（需服务市场签约才能拿到）。因此本模块把"消息收进来"做成
 * 与平台无关的通用入口：
 *
 *   1. 每个店铺自动生成一个对外咨询短码（/c/<code>）与 Webhook 令牌
 *   2. 买家在咨询页发消息  →  POST /api/inbox/:code/messages
 *   3. 任意外部系统转发    →  POST /api/hooks/inbox/:token
 *      （淘宝客服机器人、抖店、京东、自建小程序、独立站表单都能推）
 *   4. 消息落库 → 建/复用会话 → 触发工作流 → AI 首响 → 站内通知
 *   5. 客服在工作台回复 → 买家端轮询可见，形成闭环
 *
 * 全程真实读写数据库，无任何模拟数据。
 */
const crypto = require('crypto');
const db = require('./db');
const { get, all, run, uid, nowISO, nowHM } = db;

const CHANNEL_LABEL = {
  consult: '店铺咨询页',
  webhook: '外部转发',
  taobao: '淘宝/天猫',
  sim: '模拟买家',
};

/* ---------------- 店铺接入口 ---------------- */
function newCode() {
  /* 6 位小写字母数字，URL 安全、便于口头传播 */
  return crypto.randomBytes(4).toString('hex').slice(0, 6);
}
function newToken() {
  return 'ik_' + crypto.randomBytes(16).toString('hex');
}

/**
 * 保证店铺有对外接入口（没有就生成）
 * @returns {{code:string,token:string,ai:number,welcome:string}}
 */
function ensureInbox(storeId) {
  const s = get('SELECT id,tenant_id,name,inbox_code,inbox_token,inbox_ai,inbox_welcome FROM stores WHERE id = ?', storeId);
  if (!s) throw new Error('店铺不存在');
  let code = String(s.inbox_code || '').trim();
  let token = String(s.inbox_token || '').trim();

  if (!code) {
    for (let i = 0; i < 8; i++) {
      const c = newCode();
      if (!get('SELECT id FROM stores WHERE inbox_code = ?', c)) { code = c; break; }
    }
  }
  if (!token) token = newToken();
  if (!code || !token || code !== s.inbox_code || token !== s.inbox_token) {
    run('UPDATE stores SET inbox_code = ?, inbox_token = ? WHERE id = ?', code, token, storeId);
  }
  return {
    code,
    token,
    ai: s.inbox_ai === undefined || s.inbox_ai === null ? 1 : Number(s.inbox_ai),
    welcome: String(s.inbox_welcome || ''),
  };
}

function storeByCode(code) {
  return get('SELECT * FROM stores WHERE inbox_code = ?', String(code || '').trim());
}
function storeByToken(token) {
  return get('SELECT * FROM stores WHERE inbox_token = ?', String(token || '').trim());
}

/** 给前端展示：短码 + 完整链接 + Webhook 令牌（仅管理员可见） */
function publicView(store, base) {
  const inbox = ensureInbox(store.id);
  return {
    code: inbox.code,
    token: inbox.token,
    ai: inbox.ai,
    welcome: inbox.welcome,
    url: `${base}/c/${inbox.code}`,
    api_url: `${base}/api/hooks/inbox/${inbox.token}`,
  };
}

/* ---------------- 会话与消息 ---------------- */
function channelLabel(ch) {
  const v = String(ch || '');
  /* 网页桥接来源：web_拼多多 / web_千牛 …… 直接显示平台名 */
  if (v.indexOf('web_') === 0) {
    const p = v.slice(4).trim();
    return p ? p + '店铺' : '网页监听';
  }
  if (CHANNEL_LABEL[v]) return CHANNEL_LABEL[v];
  if (v === 'web' || v === '') return '店铺后台';
  return '店铺咨询';
}

/** 访客标识：优先用前端传的，其次按 IP+UA 生成稳定值 */
function makeVisitorId(input, ip, ua) {
  const v = String(input || '').trim();
  if (v) return v.slice(0, 64);
  const seed = `${ip || ''}|${String(ua || '').slice(0, 120)}`;
  return 'v_' + crypto.createHash('md5').update(seed).digest('hex').slice(0, 16);
}

/**
 * 找到该访客在该店铺的会话（7 天内），没有就新建
 */
function findOrCreateConversation({ store, visitorId, name, channel, orderNo = '', product = '', amount = '' }) {
  const tenantId = store.tenant_id;
  const existed = get(
    `SELECT * FROM conversations
      WHERE tenant_id = ? AND store_id = ? AND visitor_id = ?
        AND created_at >= ?
      ORDER BY updated_at DESC LIMIT 1`,
    tenantId, store.id, visitorId,
    new Date(Date.now() - 7 * 86400 * 1000).toISOString()
  );
  if (existed) return { conv: existed, created: false };

  const inbox = ensureInbox(store.id);
  const id = uid('cv');
  const now = nowISO();
  const who = String(name || '').trim() || ('访客' + visitorId.slice(-4));
  run(
    `INSERT INTO conversations
      (id,tenant_id,store_id,customer,tags,order_no,order_product,order_amount,order_status,
       unread,status,sentiment,last_msg,last_time,created_at,transferred_at,updated_at,channel,visitor_id)
     VALUES (?,?,?,?,?,?,?,?,?,0,?, 'neutral',?,?,?, '',?,?,?)`,
    id, tenantId, store.id, who, JSON.stringify([channelLabel(channel)]),
    String(orderNo).slice(0, 80), String(product).slice(0, 255), String(amount).slice(0, 40), '',
    inbox.ai ? 'ai' : 'waiting',
    '', now, now, now, String(channel || 'consult').slice(0, 24), visitorId
  );
  return { conv: get('SELECT * FROM conversations WHERE id = ?', id), created: true };
}

/** 5 秒内同会话相同文本视为重复推送，避免 Webhook 重试造成刷屏 */
function isDuplicate(tenantId, convId, text) {
  const row = get(
    `SELECT id FROM messages
      WHERE tenant_id = ? AND conv_id = ? AND role = 'customer' AND text = ?
        AND created_at >= ?
      ORDER BY id DESC LIMIT 1`,
    tenantId, convId, text, new Date(Date.now() - 5000).toISOString()
  );
  return Boolean(row);
}

/* 平台官方/系统账号（如拼多多的「共享仓管理」「流量数据」「供货管理」）
 * 以及商家后台左侧导航菜单项（如「包裹中心」「订单查询」「售后工作台」），
 * 是平台给商家的通知或功能入口，不是买家，不进入客服会话。 */
const SYSTEM_ACCOUNTS = /(共享仓|流量数据|供货管理|商品推广|平台通知|平台消息|平台公告|系统消息|系统通知|官方通知|官方消息|商家成长|店铺通知|违规|活动通知|招商|入驻|平台客服|客服助手|通知中心|营销工具|数据中心|订单提醒|官方活动|推广概况|全站营销|多活动|全店报名|限量上大促|抢单神器|品牌权益|优店优品|品质诊断|商品领航员|类目服务费|机会商品|商品工具|商品素材|商品体检|价格管理|评价管理|商品列表|降退款督导|挽单工具|拦截快递|小额打款|极速退款|消费者体验|商家举证|工单管理|偏远大件|商家寄件|发货权益|物流异常|上门安装|报备额度|物流概况|电子面单|物流工具|订单开票|发货中心|包裹中心|官方ERP|打单工具|TEMU|售后工作台|订单查询|发布新商品|后台首页|新客立减|多多视频|营销活动|服务数据|经营总览|交易数据|商品数据|营销书院|推广账户|推广工具|推广报表|明星店铺|直播推广|店铺营销|营销中心|商品管理|订单管理|售后管理|物流管理|店铺管理|账户资金|多多进宝|服务市场|争议澄清|履行.{0,4}义务|须知|公告|声明|规则|协议|没有更多|正在加载|加载中)/;

/* 平台 UI 标签（「全部 / 未读 / 店铺动态」这类栏目标题）：精确匹配，不是买家昵称 */
const UI_LABELS = new Set([
  '全部', '未读', '待回复', '已回复', '全部会话', '全部消息', '会话', '消息', '搜索',
  '店铺动态', '营销推广', '平台动态', '规则更新', '重要通知', '公告', '通知', '系统消息',
  '平台消息', '官方消息', '客服消息', '店铺通知', '活动通知', '订单通知', '售后通知',
]);

/**
 * 是否属于「平台系统号 / 后台功能标签」——不是真人买家
 */
function isPlatformAccount(name) {
  const n = String(name || '').trim();
  if (!n) return false;
  if (UI_LABELS.has(n)) return true;
  return SYSTEM_ACCOUNTS.test(n);
}

/**
 * 接收一条来自买家的消息（统一入口）
 * @param {object} p
 * @param {object} p.store        店铺行
 * @param {string} p.text         消息正文
 * @param {string} [p.name]       买家昵称
 * @param {string} [p.visitorId]  访客标识
 * @param {string} [p.channel]    consult | webhook | taobao
 * @param {string} [p.orderNo]
 * @param {string} [p.product]
 * @param {string} [p.amount]
 * @param {string} [p.ip]
 * @param {string} [p.ua]
 */
async function receive(p) {
  const store = p.store;
  const text = String(p.text || '').trim().slice(0, 4000);
  if (!text) throw new Error('消息内容为空');

  /* 平台官方/系统账号、后台功能标签不入会话（即便旧版扩展推送过来也直接忽略） */
  const buyerName = String(p.name || '').trim();
  if (buyerName && isPlatformAccount(buyerName)) {
    return { convId: null, visitorId: '', created: false, ignored: true, reason: '平台系统账号，已忽略', aiReply: '', flowRun: null };
  }
  /* 平台界面文字 / 店铺水印，不当作客户消息 */
  if (isUiNoise(text, 'customer', store.name)) {
    return { convId: null, visitorId: '', created: false, ignored: true, reason: '平台界面文字，已忽略', aiReply: '', flowRun: null };
  }
  /* 后台导航菜单特征：标题与"消息内容"完全相同（如「包裹中心 / 包裹中心」），一律视为菜单项 */
  if (buyerName && buyerName === text) {
    return { convId: null, visitorId: '', created: false, ignored: true, reason: '平台菜单项，已忽略', aiReply: '', flowRun: null };
  }

  const visitorId = makeVisitorId(p.visitorId, p.ip, p.ua);
  const channel = String(p.channel || 'consult');
  const { conv, created } = findOrCreateConversation({
    store, visitorId, name: p.name, channel,
    orderNo: p.orderNo || '', product: p.product || '', amount: p.amount || '',
  });
  const tenantId = store.tenant_id;

  if (isDuplicate(tenantId, conv.id, text)) {
    return { convId: conv.id, visitorId, duplicate: true, aiReply: '', flowRun: null };
  }

  const time = nowHM();
  const now = nowISO();

  run('INSERT INTO messages (tenant_id,conv_id,role,text,time,kind,payload,created_at) VALUES (?,?,?,?,?,?,?,?)',
    tenantId, conv.id, 'customer', text, time, 'text', null, now);
  run(
    `UPDATE conversations
        SET last_msg = ?, last_time = ?, updated_at = ?,
            unread = unread + 1,
            status = CASE WHEN status = '' OR status IS NULL THEN 'waiting' ELSE status END
      WHERE id = ?`,
    text.slice(0, 500), time, now, conv.id
  );

  /* 站内通知：让客服在「信息通知」里也能看到新咨询 */
  try {
    run(
      'INSERT INTO notifications (id,tenant_id,type,title,body,level,`read`,created_at) VALUES (?,?,?,?,?,?,0,?)',
      uid('ntf'), tenantId, 'inbox',
      `新咨询 · ${store.name}`.slice(0, 255),
      `${conv.customer}：${text.slice(0, 200)}`.slice(0, 2000),
      'warning', now
    );
  } catch (e) { /* 通知失败不影响消息入库 */ }

  /* 触发：先走已启用的工作流（意图路由），未命中且会话处于 AI 接待则由 AI 首响 */
  let aiReply = '';
  let flowRun = null;
  try {
    const flowEngine = require('./flow-engine');
    flowRun = await flowEngine.handleCustomerMessage(tenantId, conv.id);
    if (flowRun) {
      aiReply = flowRun.reply;
    } else {
      const autoReply = require('./auto-reply');
      aiReply = await autoReply.maybeAutoReply(tenantId, conv.id);
    }
  } catch (e) {
    console.warn('[inbox] 自动回复失败：', e.message);
  }

  /* 网页桥接会话：把回复推入回写队列，扩展会把它发回平台聊天窗口 */
  if (aiReply) {
    try {
      require('./bridge-outbox').enqueue({
        tenantId, storeId: store.id, convId: conv.id, visitorId,
        customer: conv.customer, channel: conv.channel, text: aiReply,
      });
    } catch (e) { /* 入队失败不影响收件 */ }
  }

  return {
    convId: conv.id,
    visitorId,
    created,
    messageId: null,
    time,
    aiReply: aiReply || '',
    flowRun: flowRun ? { flowId: flowRun.flowId, flowName: flowRun.flowName, intent: flowRun.intent } : null,
  };
}

/** 买家端拉取：按消息 id 增量 */
function visitorMessages(convId, afterId = 0) {
  const rows = all(
    'SELECT id,role,text,time,kind FROM messages WHERE conv_id = ? AND id > ? ORDER BY id ASC LIMIT 200',
    convId, Number(afterId) || 0
  );
  return rows.map((m) => ({
    id: m.id, role: m.role, text: m.text, time: m.time, kind: m.kind || '',
  }));
}

/** 按访客取会话（买家端刷新时用） */
function conversationOf(storeId, visitorId) {
  return get(
    `SELECT * FROM conversations
      WHERE store_id = ? AND visitor_id = ? AND created_at >= ?
      ORDER BY updated_at DESC LIMIT 1`,
    storeId, visitorId, new Date(Date.now() - 7 * 86400 * 1000).toISOString()
  );
}

/* ---------------- 完整聊天记录导入 ----------------
 * 平台后台的「聊天记录查询」页能拿到买家账号 + 整段对话（文字/图片/商品链接/系统提示/时间），
 * 浏览器扩展把这些读出来推到这里，落成一条完整会话，工作台里就能像平台一样逐条看。
 */
const ROLE_ALIAS = {
  customer: 'customer', buyer: 'customer', user: 'customer', 买家: 'customer', 消费者: 'customer', 客户: 'customer',
  agent: 'agent', shop: 'agent', seller: 'agent', service: 'agent', 商家: 'agent', 客服: 'agent', 我: 'agent',
  ai: 'ai', system: 'system', sys: 'system', 系统: 'system', 系统消息: 'system',
};
const KIND_ALIAS = {
  text: 'text', image: 'image', img: 'image', pic: 'image', picture: 'image', 图片: 'image',
  link: 'link', url: 'link', goods: 'link', 链接: 'link',
  system: 'text', 系统: 'text',
};

function normRole(r) {
  const k = String(r || '').trim().toLowerCase();
  return ROLE_ALIAS[k] || ROLE_ALIAS[String(r || '').trim()] || 'customer';
}
function normKind(kind, text, url) {
  const k = String(kind || '').trim().toLowerCase();
  const mapped = KIND_ALIAS[k] || KIND_ALIAS[String(kind || '').trim()];
  if (mapped) return mapped;
  if (url && /\.(png|jpe?g|gif|webp|bmp)(\?|$)/i.test(url)) return 'image';
  if (/^https?:\/\//i.test(String(text || ''))) return 'link';
  return 'text';
}
/* 平台时间 → 展示用「MM-DD HH:MM」；只有时分的保持原样 */
function normTime(t) {
  const s = String(t || '').trim();
  if (!s) return nowHM();
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})/.exec(s);
  if (m) return `${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')} ${m[4].padStart(2, '0')}:${m[5]}`;
  m = /^(\d{1,2}):(\d{2})/.exec(s);
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
  return s.slice(0, 24);
}
function msgKey(role, text, time, url) {
  /* 不把 time 放进指纹：同一段聊天被反复抓取时，平台每次渲染的时间条可能不同，
   * 带上时间会导致「同一句话被当成新消息」重复入库。 */
  return [role, String(text || '').slice(0, 200), url || ''].join('|');
}

/* ---- 网页桥接的界面噪声：平台把「复制 / 来自手机端 / 店铺水印 / 快捷话术」也渲染在
 * 聊天区里，扩展按几何位置抓取时会把它们混进来。统一在服务端清掉，
 * 这样即使扩展版本旧、抓得糙，工作台里看到的仍然是干净的真实对话。 ---- */
const NOISE_EXACT = new Set([
  '复制', '已读', '未读', '删除', '撤回', '查看商品规格', '查看订单', '查看详情',
  '没有更多了', '正在加载', '加载更多', '加载更多会话', '加载中', '下拉加载更多',
  '来自手机端', '来自电脑端', '主账号', '-自动回复', '自动回复', '转人工', '转移会话',
  '发送', '取消', '确定', '收起', '展开', '点击添加备注信息', '快捷短语', '常用语',
  '邀请关注', '邀请下单', '小额打款', '小额收款', '邀请开票', '发送订单卡', '发送优惠券',
]);
/* 平台给的「快捷问题」气泡：只在不是我方客服真发的时候丢弃，
 * 客户真这么问的（"有货吗？"）照常入库。 */
const NOISE_AGENT_ONLY = new Set(['有货吗？', '什么时候发货？', '什么快递', '在吗？', '多少钱？']);
const NOISE_RE = [
  /^商品ID[:：]?/i,
  /^当前用户来自/,
  /^\/\s*\d+\s*人团$/,          /* "/2人团" 这种价格尾巴 */
  /^[￥¥]\s*[\d.]+$/,            /* 单独一条价格 */
  /^\d+$/,                        /* 孤零零的数字（商品卡里的编号） */
  /^(今天|昨天|前天|星期[一二三四五六日天]|周[一二三四五六日天])$/,
  /^\d{1,2}[:：]\d{2}(:\d{2})?$/,  /* 只有时间 */
];

/** 这条消息是不是平台界面文字 / 店铺水印，而不是真正的聊天内容 */
function isUiNoise(text, role, storeName) {
  const t = String(text || '').replace(/\uFFFC/g, '').replace(/\s+/g, ' ').trim();
  if (!t) return true;
  if (t.length <= 1) return true;                       /* "1" 这种商品卡编号 */
  if (NOISE_EXACT.has(t)) return true;
  if (String(role) !== 'customer' && NOISE_AGENT_ONLY.has(t)) return true;
  if (storeName && t === String(storeName).trim()) return true;  /* 聊天区的店铺水印 */
  for (const re of NOISE_RE) if (re.test(t)) return true;
  return false;
}

/**
 * 导入一段完整聊天记录
 * @param {object} p
 * @param {object} p.store      店铺行
 * @param {string} p.buyer      买家账号（平台里可能就是「远***」这种脱敏昵称）
 * @param {string} [p.channel]  web_拼多多
 * @param {string} [p.visitorId]
 * @param {Array}  p.messages   [{ role, kind, text, url, time }]
 */
/** 列表预览优先取这种消息：客户说的文字，且不是纯价格/纯占位符 */
function isPreviewText(m) {
  if (!m || m.role !== 'customer') return false;
  if (m.kind && m.kind !== 'text') return false;
  const t = String(m.text || '').trim();
  if (!t || t === '[图片]' || t === '[链接]' || t === '商品链接') return false;
  if (/^[￥¥]\s*[\d.]+$/.test(t)) return false;
  return true;
}

function importThread(p) {
  const store = p.store;
  const buyer = String(p.buyer || p.name || '').trim().slice(0, 60);
  if (!buyer) throw new Error('缺少买家账号（buyer）');
  const raw = Array.isArray(p.messages) ? p.messages : [];
  if (!raw.length) throw new Error('聊天记录为空（messages）');

  /* 系统号不建会话 */
  if (isPlatformAccount(buyer)) {
    return { ignored: true, reason: '平台系统账号，已忽略', inserted: 0, skipped: 0, total: raw.length };
  }

  const tenantId = store.tenant_id;
  const channel = String(p.channel || 'web_拼多多').slice(0, 24);

  /* 先按「店铺 + 昵称」找已有会话，找不到再建，避免与实时抓取产生同名两条 */
  let conv = get(
    `SELECT * FROM conversations WHERE tenant_id = ? AND store_id = ? AND customer = ?
      ORDER BY updated_at DESC LIMIT 1`,
    tenantId, store.id, buyer
  );
  let created = false;
  if (!conv) {
    const vid = String(p.visitorId || '').trim()
      || ('web_' + crypto.createHash('md5').update(store.id + '|' + buyer).digest('hex').slice(0, 16));
    const r = findOrCreateConversation({ store, visitorId: vid, name: buyer, channel });
    conv = r.conv;
    created = r.created;
  }

  /* 已有消息指纹，重复导入时跳过（用「计数」而不是集合：客户连发两句「好的」也能正确区分） */
  const had = all('SELECT role, text, time, kind, payload FROM messages WHERE conv_id = ?', conv.id);
  const seenKeys = new Map();
  had.forEach((m) => {
    let url = '';
    try { url = (JSON.parse(m.payload || '{}') || {}).url || ''; } catch (e) { /* 忽略 */ }
    const k = msgKey(m.role, m.text, m.time, url);
    seenKeys.set(k, (seenKeys.get(k) || 0) + 1);
  });

  /* 归一化 + 按时间排序（保持平台里的原始先后） */
  const list = raw.slice(0, 3000).map((m) => {
    if (!m) return null;
    /* 平台界面文字 / 店铺水印直接丢弃，不写库；带链接/图片的卡片不算界面文字 */
    const hasMedia = String(m.url || m.src || m.href || '').trim() || /image|link/.test(String(m.kind || m.type || ''));
    if (!hasMedia && isUiNoise(m.text || m.content || '', m.role || m.from || m.side, store.name)) return null;
    const url = String(m.url || m.src || m.href || '').trim().slice(0, 1000);
    const role = normRole(m.role || m.from || m.side);
    let text = String(m.text || m.content || '').trim();
    const kind = normKind(m.kind || m.type, text, url);
    if (!text) text = kind === 'image' ? '[图片]' : (kind === 'link' ? (url || '[链接]') : '');
    if (!text) return null;
    /* 商品链接正文可能是一长串 URL，压成一句人话，原文放 payload */
    const isLink = kind === 'link';
    return {
      role,
      kind,
      text: (isLink ? '商品链接' : text).slice(0, 2000),
      time: normTime(m.time || m.at || m.ts),
      payload: kind === 'text' ? null : { url, title: String(m.title || '').slice(0, 200), raw: isLink ? text.slice(0, 1000) : '' },
      _sort: String(m.time || m.at || ''),
    };
  }).filter(Boolean).sort((a, b) => String(a._sort).localeCompare(String(b._sort)));

  let inserted = 0;
  let skipped = 0;
  let newCustomer = 0;
  let lastCustomer = null;
  let lastCustomerText = null;   /* 客户最后一句「文字」，用于列表预览（比 [图片] 有用） */
  let lastAny = null;
  const now = nowISO();
  for (const m of list) {
    const url = (m.payload && m.payload.url) || '';
    const key = msgKey(m.role, m.text, m.time, url);
    const left = seenKeys.get(key) || 0;
    if (left > 0) {
      seenKeys.set(key, left - 1);
      skipped++;
      if (m.role === 'customer') {
        lastCustomer = m;
        if (isPreviewText(m)) lastCustomerText = m;
      }
      lastAny = m;
      continue;
    }
    run(
      'INSERT INTO messages (tenant_id,conv_id,role,text,time,kind,payload,created_at) VALUES (?,?,?,?,?,?,?,?)',
      tenantId, conv.id, m.role, m.text, m.time, m.kind === 'text' ? 'text' : m.kind,
      m.payload ? JSON.stringify(m.payload) : null, now
    );
    inserted++;
    if (m.role === 'customer') {
      lastCustomer = m;
      if (isPreviewText(m)) lastCustomerText = m;
      newCustomer++;
    }
    lastAny = m;
  }

  /* 列表预览：保留客户最近说的「一句话」（图片/链接这类没内容的只作兜底） */
  const preview = lastCustomerText || lastCustomer || lastAny;
  if (preview) {
    const tags = (() => { try { const t = JSON.parse(conv.tags || '[]'); return t.length ? t : [channelLabel(channel)]; } catch (e) { return [channelLabel(channel)]; } })();
    run(
      'UPDATE conversations SET last_msg = ?, last_time = ?, channel = ?, tags = ?, unread = COALESCE(unread, 0) + ?, updated_at = ? WHERE id = ?',
      String(preview.text || '').slice(0, 500), preview.time, channel, JSON.stringify(tags),
      Math.min(newCustomer, 99), now, conv.id
    );
  }

  return { convId: conv.id, buyer, created, inserted, skipped, total: list.length, lastTime: preview ? preview.time : '' };
}

/**
 * 清扫误抓进来的「平台系统号 / 后台导航菜单」会话（返回清除条数）。
 * 判定两条：① 昵称命中系统号黑名单；② 该会话的客户消息内容全部等于昵称本身（菜单项特征）。
 * 只会动网页桥接（web_*）来源的会话，真实买家会话不受影响。
 */
async function purgeSystemConversations() {
  const rows = all("SELECT id, customer, last_msg, channel FROM conversations WHERE channel LIKE 'web%'");
  let killed = 0;
  for (const cv of rows) {
    const name = String(cv.customer || '').trim();
    if (!name) continue;
    let junk = isPlatformAccount(name);
    if (!junk && String(cv.last_msg || '').trim() === name) {
      /* 预览就是名字本身，且没有一条真实客户内容 → 菜单项 */
      const msgs = all("SELECT text FROM messages WHERE conv_id = ? AND role = 'customer'", cv.id);
      junk = msgs.every((m) => String(m.text || '').trim() === name || !String(m.text || '').trim());
    }
    if (!junk) continue;
    run('DELETE FROM messages WHERE conv_id = ?', cv.id);
    try { run('DELETE FROM flow_runs WHERE conv_id = ?', cv.id); } catch (e) { /* 表结构差异忽略 */ }
    try { run('DELETE FROM bridge_outbox WHERE conv_id = ?', cv.id); } catch (e) { /* 同上 */ }
    run('DELETE FROM conversations WHERE id = ?', cv.id);
    killed++;
  }
  return killed;
}

module.exports = {
  CHANNEL_LABEL, channelLabel,
  ensureInbox, storeByCode, storeByToken, publicView,
  makeVisitorId, findOrCreateConversation,
  receive, visitorMessages, conversationOf,
  importThread,
  purgeSystemConversations,
};
