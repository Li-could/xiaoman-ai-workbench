'use strict';
/**
 * 真实数据同步
 *
 * 把淘宝返回的店铺 / 订单 / 退款 / 商品 / TMC 消息落进本地 MySQL，
 * 供工作台的会话、售后助手、数据看板直接使用。全部为真实接口返回，
 * 任一步失败都会把淘宝原始错误码记进 connector_logs 并抛给上层展示。
 */
const db = require('./db');
const autoReply = require('./auto-reply');
const flowEngine = require('./flow-engine');
const storeAuth = require('./store-auth');
const connectors = require('./connectors');

/* ---------------- 通用 ---------------- */
function pad(n) { return String(n).padStart(2, '0'); }

/** 淘宝要北京时间 yyyy-MM-dd HH:mm:ss */
function fmtTop(date) {
  try {
    return date.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ');
  } catch (e) {
    const d = new Date(date.getTime() + 8 * 3600 * 1000);
    return d.toISOString().slice(0, 19).replace('T', ' ');
  }
}

/** 跨驱动 upsert */
function upsertRow(table, row, pk) {
  const cols = Object.keys(row);
  const vals = cols.map((c) => row[c]);
  const ph = cols.map(() => '?').join(',');
  if (db.driver === 'mysql') {
    const upd = cols.filter((c) => c !== pk).map((c) => `\`${c}\`=VALUES(\`${c}\`)`).join(',');
    db.run(
      `INSERT INTO ${table} (${cols.map((c) => '`' + c + '`').join(',')}) VALUES (${ph}) ` +
      `ON DUPLICATE KEY UPDATE ${upd}`,
      ...vals
    );
  } else {
    const upd = cols.filter((c) => c !== pk).map((c) => `${c}=excluded.${c}`).join(',');
    db.run(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES (${ph}) ` +
      `ON CONFLICT(${pk}) DO UPDATE SET ${upd}`,
      ...vals
    );
  }
}

function requireCred(storeId) {
  const cred = storeAuth.getCred(storeId);
  if (!cred) throw new Error('该店铺还没有配置平台凭据');
  const conn = connectors.get(cred.platform);
  if (!conn) throw new Error('平台「' + cred.platform + '」暂未接入真实接口');
  return { cred, conn };
}

/** 统一包裹一次真实调用：记录日志、按需更新授权状态 */
async function trace(cred, method, fn) {
  const started = Date.now();
  try {
    const r = await fn();
    storeAuth.logCall({
      tenantId: cred.tenantId, storeId: cred.storeId, platform: cred.platform,
      method, ok: true, code: r && r.requestId ? 'request_id:' + r.requestId : '', ms: Date.now() - started,
    });
    return r;
  } catch (e) {
    storeAuth.logCall({
      tenantId: cred.tenantId, storeId: cred.storeId, platform: cred.platform,
      method, ok: false, code: e.code, message: e.message, ms: Date.now() - started,
      detail: e.raw || (e.subMsg || ''),
    });
    if (String(e.code) === '21' || String(e.subCode).indexOf('session') >= 0) {
      storeAuth.updateCred(cred.storeId, { authStatus: 'expired', authError: String(e.message).slice(0, 500) });
    }
    throw e;
  }
}

/* ---------------- 店铺信息 ---------------- */
/**
 * 连接自检：真实调用两个接口验证凭据与授权是否有效
 * 成功会把真实店铺名、店标写回 stores 表
 */
async function testConnection(storeId) {
  const { cred, conn } = requireCred(storeId);
  const errors = [];
  let shop = null;
  let seller = null;

  /* 还没有授权时：先验证 AppKey / AppSecret / 签名是否正确 */
  if (!cred.session) {
    let probe = null;
    if (conn.probeCredentials) {
      const started = Date.now();
      probe = await conn.probeCredentials({ appKey: cred.appKey, appSecret: cred.appSecret, env: cred.env });
      storeAuth.logCall({
        tenantId: cred.tenantId, storeId, platform: cred.platform,
        method: 'taobao.time.get', ok: probe.ok, code: probe.code,
        message: probe.message || '', ms: Date.now() - started,
      });
    } else {
      probe = { ok: false, code: 'LOCAL', message: '该平台没有提供凭据探活接口' };
    }

    if (!probe.ok) {
      storeAuth.updateCred(storeId, {
        authStatus: 'error',
        authError: `[${probe.code || ''}] ${probe.message || ''}`.slice(0, 500),
      });
      return {
        ok: false,
        credential_valid: false,
        need_authorize: true,
        errors: [{ api: 'taobao.time.get', code: probe.code, message: probe.message, hint: probe.hint }],
        credential: storeAuth.publicView(storeAuth.getCred(storeId)),
      };
    }

    storeAuth.updateCred(storeId, { authStatus: 'pending', authError: '' });
    return {
      ok: true,
      credential_valid: true,
      need_authorize: true,
      probe,
      errors: [],
      note: 'AppKey / AppSecret 有效，还需要完成店铺授权才能读取该店铺数据。',
      credential: storeAuth.publicView(storeAuth.getCred(storeId)),
    };
  }

  /* 已授权：验证 session 还能不能读真实店铺数据 */
  const args = await storeAuth.connArgs(cred);

  try {
    const r = await trace(cred, 'taobao.shop.seller.get', () => conn.shopSellerGet(args));
    shop = (r.data && r.data.shop) || null;
  } catch (e) {
    errors.push({ api: 'taobao.shop.seller.get', code: e.code, message: e.message, hint: e.hint, sub_code: e.subCode || '' });
  }

  try {
    const r = await trace(cred, 'taobao.user.seller.get', () => conn.userSellerGet(args));
    seller = (r.data && r.data.user) || null;
  } catch (e) {
    errors.push({ api: 'taobao.user.seller.get', code: e.code, message: e.message, hint: e.hint, sub_code: e.subCode || '' });
  }

  const ok = Boolean(shop || seller);
  if (ok) {
    const patch = {
      shopId: shop && shop.sid ? String(shop.sid) : cred.shopId,
      shopTitle: (shop && shop.title) || cred.shopTitle,
      shopPic: shop && shop.pic_path ? absolutePic(shop.pic_path) : cred.shopPic,
      sellerUid: seller && seller.user_id ? String(seller.user_id) : cred.sellerUid,
      sellerNick: (seller && seller.nick) || cred.sellerNick,
      authStatus: 'active',
      authError: '',
      lastSyncAt: db.nowISO(),
    };
    storeAuth.updateCred(storeId, patch);
    applyStoreProfile(storeId, patch);
  } else {
    storeAuth.updateCred(storeId, {
      authStatus: errors.some((e) => String(e.code) === '21') ? 'expired' : 'error',
      authError: errors.map((e) => `[${e.code}] ${e.message}`).join(' | ').slice(0, 500),
    });
  }

  return {
    ok,
    shop,
    seller,
    errors,
    credential: storeAuth.publicView(storeAuth.getCred(storeId)),
  };
}

function absolutePic(p) {
  if (!p) return '';
  if (/^https?:\/\//.test(p)) return p;
  return 'https://img.alicdn.com' + (p.startsWith('/') ? p : '/' + p);
}

/** 把真实店铺信息写回工作台的店铺卡片 */
function applyStoreProfile(storeId, patch) {
  const s = db.get('SELECT * FROM stores WHERE id = ?', storeId);
  if (!s) return;
  const name = patch.shopTitle || s.name;
  const account = patch.sellerNick || s.account;
  const short = (name || s.short || '').trim().slice(0, 1) || s.short;
  db.run(
    'UPDATE stores SET name = ?, account = ?, short = ?, status = ? WHERE id = ?',
    String(name).slice(0, 160), String(account).slice(0, 120), short, 'active', storeId
  );
}

/* ---------------- 订单 ---------------- */
async function syncOrders(storeId, { days = 7, maxPages = 10 } = {}) {
  const { cred, conn } = requireCred(storeId);
  const args = await storeAuth.connArgs(cred);
  const now = new Date();
  const start = new Date(now.getTime() - Math.min(90, Math.max(1, days)) * 86400000);

  let saved = 0;
  let page = 1;
  let hasNext = true;
  let total = 0;
  const nowIso = db.nowISO();

  while (hasNext && page <= maxPages) {
    const r = await trace(cred, 'taobao.trades.sold.get', () => conn.tradesSoldGet(args, {
      startCreated: fmtTop(start), endCreated: fmtTop(now), pageNo: page, pageSize: 40,
    }));
    const list = conn.pickList(r.data && r.data.trades, 'trade');
    if (page === 1) total = Number((r.data && r.data.total_results) || list.length);

    for (const t of list) {
      const orders = conn.pickList(t.orders, 'order');
      const row = {
        tid: String(t.tid),
        tenant_id: cred.tenantId,
        store_id: storeId,
        buyer_nick: String(t.buyer_nick || ''),
        status: String(t.status || ''),
        payment: String(t.payment || ''),
        total_fee: String(t.total_fee || ''),
        created: String(t.created || ''),
        pay_time: String(t.pay_time || ''),
        receiver: [t.receiver_state, t.receiver_city, t.receiver_name].filter(Boolean).join(' ').slice(0, 255),
        title: orders.map((o) => o.title).filter(Boolean).join(' / ').slice(0, 500),
        items_json: JSON.stringify(orders),
        synced_at: nowIso,
      };
      upsertRow('shop_orders', row, 'tid');
      saved += 1;
    }

    hasNext = Boolean(r.data && (r.data.has_next === true || r.data.has_next === 'true'));
    if (!list.length) break;
    page += 1;
  }

  storeAuth.updateCred(storeId, { lastSyncAt: nowIso });
  return { scope: 'orders', total, saved, pages: page - 1, range: { start: fmtTop(start), end: fmtTop(now) } };
}

/* ---------------- 退款 / 售后 ---------------- */
const REFUND_STATUS = {
  WAIT_SELLER_AGREE: '等待卖家同意',
  WAIT_BUYER_RETURN_GOODS: '等待买家退货',
  WAIT_SELLER_CONFIRM_GOODS: '等待卖家确认收货',
  SELLER_REFUSE_BUYER: '卖家拒绝',
  CLOSED: '退款关闭',
  SUCCESS: '退款成功',
  WAIT_SELLER_CONFIRM_MONEY: '等待卖家确认退款',
};

async function syncRefunds(storeId, { maxPages = 10 } = {}) {
  const { cred, conn } = requireCred(storeId);
  const args = await storeAuth.connArgs(cred);
  const nowIso = db.nowISO();

  let saved = 0;
  let created = 0;
  let page = 1;
  let hasNext = true;

  while (hasNext && page <= maxPages) {
    const r = await trace(cred, 'taobao.refunds.receive.get', () => conn.refundsReceiveGet(args, { pageNo: page, pageSize: 40 }));
    const list = conn.pickList(r.data && r.data.refunds, 'refund');
    if (!list.length) break;

    for (const f of list) {
      const status = String(f.status || '');
      const row = {
        refund_id: String(f.refund_id),
        tenant_id: cred.tenantId,
        store_id: storeId,
        tid: String(f.tid || ''),
        buyer_nick: String(f.buyer_nick || ''),
        status,
        refund_fee: String(f.refund_fee || ''),
        reason: String(f.reason || '').slice(0, 255),
        memo: '',
        item_title: String(f.item_title || '').slice(0, 500),
        created: String(f.created || ''),
        modified: String(f.modified || ''),
        synced_at: nowIso,
      };
      upsertRow('shop_refunds', row, 'refund_id');
      saved += 1;

      // 售后助手：真实退款单进工单池（按退款单号去重）
      const exists = db.get(
        'SELECT id FROM tickets WHERE tenant_id = ? AND store_id = ? AND order_no = ? AND type = ?',
        cred.tenantId, storeId, row.refund_id, 'refund'
      );
      if (!exists) {
        const id = db.uid('tk');
        db.run(
          `INSERT INTO tickets (id,tenant_id,store_id,type,type_label,status,priority,customer,order_no,product,amount,reason,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          id, cred.tenantId, storeId, 'refund', '退款售后', 'pending',
          Number(row.refund_fee) >= 500 ? 'high' : 'normal',
          row.buyer_nick, row.refund_id, row.item_title, row.refund_fee,
          row.reason || REFUND_STATUS[status] || status, nowIso, nowIso
        );
        created += 1;
      }
    }

    hasNext = Boolean(r.data && (r.data.has_next === true || r.data.has_next === 'true'));
    page += 1;
  }

  storeAuth.updateCred(storeId, { lastSyncAt: nowIso });
  return { scope: 'refunds', saved, tickets_created: created, pages: page - 1 };
}

/* ---------------- 商品 ---------------- */
async function syncItems(storeId, { maxPages = 10 } = {}) {
  const { cred, conn } = requireCred(storeId);
  const args = await storeAuth.connArgs(cred);
  const nowIso = db.nowISO();

  let saved = 0;
  let page = 1;
  let hasNext = true;

  while (hasNext && page <= maxPages) {
    const r = await trace(cred, 'taobao.items.onsale.get', () => conn.itemsOnsaleGet(args, { pageNo: page, pageSize: 40 }));
    const list = conn.pickList(r.data && r.data.items, 'item');
    if (!list.length) break;

    for (const it of list) {
      upsertRow('shop_items', {
        num_iid: String(it.num_iid),
        tenant_id: cred.tenantId,
        store_id: storeId,
        title: String(it.title || '').slice(0, 500),
        price: String(it.price || ''),
        num: Number(it.num || 0),
        outer_id: String(it.outer_id || '').slice(0, 120),
        pic_url: String(it.pic_url || '').slice(0, 500),
        status: 'onsale',
        modified: String(it.modified || ''),
        synced_at: nowIso,
      }, 'num_iid');
      saved += 1;
    }

    hasNext = Boolean(r.data && (r.data.has_next === true || r.data.has_next === 'true'));
    page += 1;
  }

  storeAuth.updateCred(storeId, { lastSyncAt: nowIso });
  return { scope: 'items', saved, pages: page - 1 };
}

/* ---------------- TMC 消息 ---------------- */
function classifyTopic(topic) {
  const t = String(topic || '').toLowerCase();
  if (t.indexOf('refund') >= 0) return { kind: 'refund', label: '售后', level: 'warning' };
  if (t.indexOf('trade') >= 0) return { kind: 'trade', label: '交易', level: 'info' };
  if (t.indexOf('item') >= 0) return { kind: 'item', label: '商品', level: 'info' };
  if (t.indexOf('im') >= 0 || t.indexOf('wangwang') >= 0 || t.indexOf('qianniu') >= 0) {
    return { kind: 'im', label: '客服会话', level: 'info' };
  }
  return { kind: 'other', label: '通知', level: 'info' };
}

function parseContent(content) {
  if (!content) return {};
  if (typeof content === 'object') return content;
  try { return JSON.parse(String(content)); } catch (e) { return { raw: String(content) }; }
}

async function pullMessages(storeId, { quantity = 100, confirm = true } = {}) {
  const { cred, conn } = requireCred(storeId);
  if (!cred.session) throw new Error('店铺尚未授权，无法拉取消息');

  // TMC 不需要 session，只需要 appKey/secret
  const args = { appKey: cred.appKey, appSecret: cred.appSecret, env: cred.env };
  const r = await trace(cred, 'taobao.tmc.messages.consume', () => conn.tmcConsume(args, {
    groupName: cred.tmcGroup, quantity,
  }));

  const list = conn.pickList(r.data && r.data.messages, 'tmc_message');
  const nowIso = db.nowISO();
  const handledIds = [];
  let fresh = 0;

  for (const m of list) {
    const msgId = String(m.id || m.msg_id || '');
    if (!msgId) continue;

    const dup = db.get('SELECT msg_id FROM tmc_messages WHERE msg_id = ?', msgId);
    if (dup) { handledIds.push(msgId); continue; }

    const topic = String(m.topic || '');
    const content = parseContent(m.content);
    const userNick = String(m.user_nick || content.buyer_nick || '');
    const meta = classifyTopic(topic);

    db.run(
      'INSERT INTO tmc_messages (msg_id,tenant_id,store_id,topic,pub_time,user_nick,content,handled,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      msgId, cred.tenantId, storeId, topic, String(m.pub_time || ''), userNick,
      JSON.stringify(content).slice(0, 60000), 1, nowIso
    );
    fresh += 1;

    const title = `${meta.label}消息 · ${topic}`;
    const body = buildBody(meta.kind, topic, content, userNick);
    db.run(
      'INSERT INTO notifications (id,tenant_id,type,title,body,level,`read`,created_at) VALUES (?,?,?,?,?,?,0,?)',
      db.uid('ntf'), cred.tenantId, 'store', title.slice(0, 255), body.slice(0, 2000), meta.level, nowIso
    );
    // 真实推送：预警/质检类通知按规则自动发到绑定的群机器人（fire-and-forget）
    try {
      require('./notify-push').pushToGroups(cred.tenantId, {
        title: title.slice(0, 255), body: body.slice(0, 2000), level: meta.level, type: 'store',
      });
    } catch (e) { /* 推送失败不影响主流程 */ }

    // 平台事件统一进「会话聚合」：客服在工作台里能直接看到并接手
    // （原来只有退款类进会话，导致交易 / 商品 / 客服类消息客服根本看不到）
    if (userNick) {
      const orderNo = String(content.tid || content.refund_id || content.oid || '');
      const text = body.replace(/<[^>]+>/g, '').slice(0, 200);
      const conv = db.get(
        'SELECT id FROM conversations WHERE tenant_id = ? AND store_id = ? AND order_no = ? AND customer = ?',
        cred.tenantId, storeId, orderNo, userNick
      );
      if (conv) {
        db.run('UPDATE conversations SET last_msg = ?, last_time = ?, unread = unread + 1, updated_at = ? WHERE id = ?',
          text, nowIso, nowIso, conv.id);
        db.run('INSERT INTO messages (tenant_id,conv_id,role,text,time,created_at) VALUES (?,?,?,?,?,?)',
          cred.tenantId, conv.id, 'customer', text, db.nowHM(), nowIso);
        // 先触发已启用的工作流（消息触发+意图路由），未命中再由 AI 接待模式兜底
        flowEngine.handleCustomerMessage(cred.tenantId, conv.id)
          .then((r) => (r ? null : autoReply.maybeAutoReply(cred.tenantId, conv.id)))
          .catch(() => {});
      } else {
        const cid = db.uid('cv');
        const store = db.get('SELECT inbox_ai FROM stores WHERE id = ?', storeId);
        const tag = meta.kind === 'refund' ? '售后' : meta.label;
        db.run(
          `INSERT INTO conversations (id,tenant_id,store_id,customer,tags,order_no,order_product,order_amount,order_status,unread,status,sentiment,last_msg,last_time,created_at,transferred_at,updated_at,channel,visitor_id)
           VALUES (?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,'',?,?,?)`,
          cid, cred.tenantId, storeId, userNick, JSON.stringify([tag]), orderNo,
          String(content.item_title || content.title || content.subject || '').slice(0, 255),
          String(content.payment || content.refund_fee || ''), String(content.status || ''),
          store && Number(store.inbox_ai) === 0 ? 'waiting' : 'ai',
          meta.kind === 'refund' ? 'negative' : 'neutral',
          text, nowIso, nowIso, nowIso, 'taobao', ''
        );
        db.run('INSERT INTO messages (tenant_id,conv_id,role,text,time,created_at) VALUES (?,?,?,?,?,?)',
          cred.tenantId, cid, 'customer', text, db.nowHM(), nowIso);
        flowEngine.handleCustomerMessage(cred.tenantId, cid)
          .then((r) => (r ? null : autoReply.maybeAutoReply(cred.tenantId, cid)))
          .catch(() => {});
      }
    }

    handledIds.push(msgId);
  }

  let confirmed = 0;
  if (confirm && handledIds.length) {
    try {
      await conn.tmcConfirm(args, { groupName: cred.tmcGroup, messageIds: handledIds });
      confirmed = handledIds.length;
    } catch (e) {
      storeAuth.logCall({
        tenantId: cred.tenantId, storeId: cred.storeId, platform: cred.platform,
        method: 'taobao.tmc.messages.confirm', ok: false, code: e.code, message: e.message,
      });
    }
  }

  const lastId = list.reduce((mx, m) => Math.max(mx, Number(m.id || 0) || 0), cred.tmcLastId || 0);
  storeAuth.updateCred(storeId, { tmcLastId: lastId, lastSyncAt: nowIso });

  return {
    scope: 'messages',
    received: list.length,
    fresh,
    duplicates: list.length - fresh,
    confirmed,
    topics: Array.from(new Set(list.map((m) => m.topic))).slice(0, 20),
  };
}

function buildBody(kind, topic, content, userNick) {
  const c = content || {};
  const parts = [];
  if (userNick) parts.push('买家：' + userNick);
  if (c.tid) parts.push('订单号：' + c.tid);
  if (c.refund_id) parts.push('退款单号：' + c.refund_id);
  if (c.status) parts.push('状态：' + c.status);
  if (c.payment) parts.push('金额：￥' + c.payment);
  if (c.refund_fee) parts.push('退款金额：￥' + c.refund_fee);
  if (c.reason) parts.push('原因：' + c.reason);
  if (c.title) parts.push('商品：' + c.title);
  if (!parts.length) parts.push(JSON.stringify(c).slice(0, 300));
  parts.push('topic：' + topic);
  return parts.join('\n');
}

/* ---------------- 一次同步全部 ---------------- */
async function syncAll(storeId, { days = 7 } = {}) {
  const steps = [];
  const run = async (name, fn) => {
    try {
      steps.push({ step: name, ok: true, result: await fn() });
    } catch (e) {
      steps.push({ step: name, ok: false, code: e.code || '', message: e.message, hint: e.hint || '' });
    }
  };
  await run('shop', () => testConnection(storeId));
  await run('orders', () => syncOrders(storeId, { days }));
  await run('refunds', () => syncRefunds(storeId));
  await run('items', () => syncItems(storeId));
  await run('messages', () => pullMessages(storeId, { quantity: 100 }));
  const okCount = steps.filter((s) => s.ok).length;
  return { ok: okCount === steps.length, steps, ok_count: okCount, total: steps.length };
}

/* ---------------- 本地统计（供前端展示真实同步结果） ---------------- */
function stats(storeId) {
  const one = (sql) => {
    const r = db.get(sql, storeId);
    return Number((r && (r.n || r.m)) || 0);
  };
  return {
    orders: one('SELECT COUNT(*) AS n FROM shop_orders WHERE store_id = ?'),
    items: one('SELECT COUNT(*) AS n FROM shop_items WHERE store_id = ?'),
    refunds: one('SELECT COUNT(*) AS n FROM shop_refunds WHERE store_id = ?'),
    messages: one('SELECT COUNT(*) AS n FROM tmc_messages WHERE store_id = ?'),
    last_message_at: (db.get('SELECT MAX(created_at) AS m FROM tmc_messages WHERE store_id = ?', storeId) || {}).m || null,
  };
}

module.exports = {
  testConnection, syncOrders, syncRefunds, syncItems, pullMessages, syncAll, stats,
  fmtTop, absolutePic,
};
