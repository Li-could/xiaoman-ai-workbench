'use strict';
/**
 * 淘宝 / 天猫 开放平台（TOP）连接器
 *
 * 纯 Node 实现，不依赖官方 SDK，覆盖真实接入所需的全部环节：
 *   · 网关调用与三项签名（md5 / hmac / hmac-sha256）
 *   · OAuth2 授权链接、用 code 换 token、refresh_token 续期
 *   · 卖家店铺 / 卖家信息 / 已卖出交易 / 退款 / 在售商品
 *   · 消息服务 TMC 的 API 拉取消费（taobao.tmc.messages.consume + confirm）
 *
 * 所有返回值都来自真实网关；失败时抛 TopError，带淘宝原始错误码，
 * 绝不用假数据兜底，避免"看起来接通了其实没通"。
 */
const crypto = require('crypto');
const https = require('https');

const GATEWAY = {
  prod: 'https://eco.taobao.com/router/rest',
  sandbox: 'https://gw.api.tbsandbox.com/router/rest',
};
const OAUTH = {
  authorize: 'https://oauth.taobao.com/authorize',
  token: 'https://oauth.taobao.com/token',
};

/* ---------------- 错误 ---------------- */
class TopError extends Error {
  constructor({ code, msg, subCode, subMsg, httpStatus, raw }) {
    super(msg || subMsg || 'TOP 调用失败');
    this.name = 'TopError';
    this.code = code === undefined ? '' : String(code);
    this.subCode = subCode || '';
    this.subMsg = subMsg || '';
    this.httpStatus = httpStatus || 0;
    this.raw = raw;
    this.hint = hintFor(this.code, this.subCode, this.subMsg, msg);
  }
  toJSON() {
    return {
      code: this.code, msg: this.message, sub_code: this.subCode,
      sub_msg: this.subMsg, hint: this.hint, http_status: this.httpStatus,
    };
  }
}

function hintFor(code, subCode, subMsg, msg) {
  const text = `${subCode || ''} ${subMsg || ''} ${msg || ''}`.toLowerCase();

  /* 淘宝的错误码在不同接口上会漂移，所以优先按返回原文判断 */
  if (/invalid app key|invalid appkey|app key is invalid/.test(text)) {
    return 'AppKey 无效：请核对开放平台「应用管理」里的 AppKey，并确认环境（正式/沙箱）选对';
  }
  if (/invalid signature|signature error|sign not match/.test(text)) {
    return '签名校验失败：AppSecret 与 AppKey 不匹配，注意不要复制多余空格';
  }
  if (/invalid timestamp|timestamp/.test(text) && /\d{4}-\d{2}-\d{2}/.test(text)) {
    return '时间戳超出允许范围，请检查本机系统时间';
  }
  if (/missing session|invalid session|session expired|session not exist/.test(text)) {
    return '店铺授权无效或已过期，请重新授权';
  }
  if (/insufficient|no permission|not authorized|permission denied|api not authorized/.test(text)) {
    return '接口权限不足：需要在开放平台「接口权限」里申请该接口后才能调用';
  }
  if (/invalid parameter|isv\.invalid-parameter/.test(text)) {
    return '参数不合法：' + (subMsg || msg || '');
  }
  if (/app call limited|limit exceeded|flow/.test(text)) {
    return '接口调用量超限：开放平台当日流量包已用完，或调用过快';
  }

  const map = {
    '7': '应用调用受限（可能未上线，或接口权限未获批）',
    '11': '当前应用没有该接口的调用权限',
    '21': '缺少 session（店铺尚未授权）',
    '22': 'session 无效或已过期，请重新授权',
    '25': '签名无效：AppSecret 与 AppKey 不匹配',
    '26': '时间戳无效，请检查本机系统时间',
    '27': 'AppKey 无效',
    '29': 'AppKey 无效，或签名方式与开放平台配置不一致',
    '40': '缺少必填参数',
    '50': '淘宝服务端返回错误，通常是参数值不合法',
  };
  return map[String(code)] || subMsg || msg || '';
}

/* ---------------- 工具 ---------------- */
/** 淘宝要求北京时间 yyyy-MM-dd HH:mm:ss */
function topTimestamp(date = new Date()) {
  try {
    return date.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ');
  } catch (e) {
    const d = new Date(date.getTime() + 8 * 3600 * 1000);
    return d.toISOString().slice(0, 19).replace('T', ' ');
  }
}

function toParamString(v) {
  if (v === true) return 'true';
  if (v === false) return 'false';
  return String(v);
}

/**
 * TOP 签名
 *   1. 除 sign 外全部参数（含系统参数）按参数名字典序排序
 *   2. 依次拼接 key + value（不做 URL 编码，中文按 UTF-8）
 *   3. md5：secret + 拼接串 + secret，取 MD5 大写
 *      hmac / hmac-sha256：以 secret 为密钥对拼接串做 HMAC，取 hex 大写
 */
function sign(params, appSecret, signMethod = 'md5') {
  const keys = Object.keys(params)
    .filter((k) => k !== 'sign' && params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort();
  let base = '';
  for (const k of keys) base += k + toParamString(params[k]);

  if (signMethod === 'hmac') {
    return crypto.createHmac('md5', appSecret).update(base, 'utf8').digest('hex').toUpperCase();
  }
  if (signMethod === 'hmac-sha256') {
    return crypto.createHmac('sha256', appSecret).update(base, 'utf8').digest('hex').toUpperCase();
  }
  return crypto.createHash('md5').update(appSecret + base + appSecret, 'utf8').digest('hex').toUpperCase();
}

function encodeBody(obj) {
  return Object.keys(obj)
    .filter((k) => obj[k] !== undefined && obj[k] !== null && obj[k] !== '')
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(toParamString(obj[k])))
    .join('&');
}

/** 底层 HTTPS 请求，返回 { status, text } */
function httpRequest(url, { method = 'POST', body = '', headers = {}, timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + (u.search || ''),
        method,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'xiaoman-workbench/1.0 (top-connector)',
          ...headers,
        },
        timeout,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('timeout', () => req.destroy(new Error('请求淘宝网关超时（' + timeout + 'ms）')));
    req.on('error', (e) => reject(e));
    if (body) req.write(body);
    req.end();
  });
}

/** 淘宝 JSON 里列表字段常被包一层：{ trades: { trade: [...] } } 或直接数组 */
function pickList(container, itemKey) {
  if (!container) return [];
  if (Array.isArray(container)) return container;
  const v = container[itemKey];
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') return [v];
  return [];
}

/* ---------------- 网关调用 ---------------- */
/**
 * 调用任意 TOP 接口
 * @param {object} opts
 * @param {string} opts.appKey
 * @param {string} opts.appSecret
 * @param {string} [opts.session]     店铺授权拿到的 access_token
 * @param {'prod'|'sandbox'} [opts.env]
 * @param {string} opts.method        如 taobao.shop.seller.get
 * @param {object} [opts.params]      业务参数
 * @param {'md5'|'hmac'|'hmac-sha256'} [opts.signMethod]
 */
async function call(opts) {
  const {
    appKey, appSecret, session = '', env = 'prod', method,
    params = {}, signMethod = 'md5', timeout = 15000,
  } = opts || {};

  if (!appKey) throw new TopError({ code: 'LOCAL', msg: '缺少 AppKey' });
  if (!appSecret) throw new TopError({ code: 'LOCAL', msg: '缺少 AppSecret' });
  if (!method) throw new TopError({ code: 'LOCAL', msg: '缺少接口名 method' });

  const system = {
    method,
    app_key: appKey,
    timestamp: topTimestamp(),
    format: 'json',
    v: '2.0',
    sign_method: signMethod,
  };
  if (session) system.session = session;

  const merged = { ...system };
  for (const k of Object.keys(params)) {
    const v = params[k];
    if (v === undefined || v === null || v === '') continue;
    merged[k] = toParamString(v);
  }
  merged.sign = sign(merged, appSecret, signMethod);

  const url = GATEWAY[env] || GATEWAY.prod;
  const started = Date.now();
  let res;
  try {
    res = await httpRequest(url, { method: 'POST', body: encodeBody(merged), timeout });
  } catch (e) {
    throw new TopError({ code: 'NETWORK', msg: '网络请求失败：' + e.message, raw: String(e.stack || '') });
  }
  const ms = Date.now() - started;

  if (res.status !== 200) {
    throw new TopError({ code: 'HTTP_' + res.status, msg: '网关返回 HTTP ' + res.status, httpStatus: res.status, raw: res.text.slice(0, 500) });
  }

  let json;
  try {
    json = JSON.parse(res.text);
  } catch (e) {
    throw new TopError({ code: 'BAD_JSON', msg: '网关返回内容不是合法 JSON', raw: res.text.slice(0, 500) });
  }

  if (json.error_response) {
    const er = json.error_response;
    throw new TopError({
      code: er.code, msg: er.msg || er.sub_msg, subCode: er.sub_code, subMsg: er.sub_msg, raw: res.text.slice(0, 800),
    });
  }

  const respKey = method.replace(/\./g, '_') + '_response';
  const data = json[respKey] !== undefined ? json[respKey] : json;
  const requestId = (data && data.request_id) || '';
  return { ok: true, data, requestId, ms, endpoint: url, shape: respKey };
}

/* ---------------- OAuth ---------------- */
function authorizeUrl({ appKey, redirectUri, state = '', view = 'web' }) {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: appKey,
    redirect_uri: redirectUri,
    state,
    view,
  });
  return OAUTH.authorize + '?' + q.toString();
}

async function postOAuth(form) {
  const body = encodeBody(form);
  const res = await httpRequest(OAUTH.token, { method: 'POST', body, timeout: 15000 });
  let json;
  try { json = JSON.parse(res.text); } catch (e) {
    throw new TopError({ code: 'BAD_JSON', msg: 'OAuth 返回非 JSON：' + res.text.slice(0, 200), raw: res.text.slice(0, 500) });
  }
  if (json.error || json.error_description) {
    throw new TopError({
      code: json.error || 'OAUTH_ERROR',
      msg: json.error_description || '授权换取 token 失败',
      subMsg: json.error_description || '',
      raw: res.text.slice(0, 500),
    });
  }
  return normalizeToken(json);
}

function safeDecode(s) {
  if (typeof s !== 'string') return s || '';
  try { return decodeURIComponent(s); } catch (e) { return s; }
}

function normalizeToken(json) {
  return {
    accessToken: json.access_token || '',
    refreshToken: json.refresh_token || '',
    expiresIn: Number(json.expires_in || 0),
    reExpiresIn: Number(json.re_expires_in || 0),
    userId: String(json.taobao_user_id || json.user_id || ''),
    userNick: safeDecode(json.taobao_user_nick || json.user_nick || ''),
  };
}

function exchangeCode({ appKey, appSecret, code, redirectUri }) {
  return postOAuth({
    grant_type: 'authorization_code',
    client_id: appKey,
    client_secret: appSecret,
    code,
    redirect_uri: redirectUri,
  });
}

function refreshSession({ appKey, appSecret, refreshToken }) {
  return postOAuth({
    grant_type: 'refresh_token',
    client_id: appKey,
    client_secret: appSecret,
    refresh_token: refreshToken,
  });
}

/* ---------------- 业务封装 ---------------- */
const F = {
  shop: 'sid,cid,title,pic_path,created',
  user: 'user_id,nick,sex',
  trade: 'tid,type,status,payment,total_fee,created,pay_time,buyer_nick,receiver_name,receiver_state,receiver_city,orders.title,orders.num,orders.price,orders.oid',
  refund: 'refund_id,tid,status,created,modified,buyer_nick,refund_fee,reason,item_title',
  item: 'num_iid,title,price,num,outer_id,pic_url,modified',
};

function shopSellerGet(c, extra = {}) {
  return call({ ...c, method: 'taobao.shop.seller.get', params: { fields: F.shop, ...extra } });
}

function userSellerGet(c, extra = {}) {
  return call({ ...c, method: 'taobao.user.seller.get', params: { fields: F.user, ...extra } });
}

function tradesSoldGet(c, { startCreated, endCreated, status, pageNo = 1, pageSize = 40, useHasNext = true } = {}) {
  return call({
    ...c,
    method: 'taobao.trades.sold.get',
    params: {
      fields: F.trade,
      start_created: startCreated,
      end_created: endCreated,
      status,
      page_no: pageNo,
      page_size: pageSize,
      use_has_next: useHasNext,
    },
  });
}

function refundsReceiveGet(c, { pageNo = 1, pageSize = 40, status } = {}) {
  return call({
    ...c, method: 'taobao.refunds.receive.get',
    params: { fields: F.refund, page_no: pageNo, page_size: pageSize, status },
  });
}

function itemsOnsaleGet(c, { pageNo = 1, pageSize = 40, q } = {}) {
  return call({
    ...c, method: 'taobao.items.onsale.get',
    params: { fields: F.item, page_no: pageNo, page_size: pageSize, q },
  });
}

/** 拉取 TMC 消息（不需要 session，按 appKey 的分组拉） */
function tmcConsume(c, { groupName = 'default', quantity = 100 } = {}) {
  const n = Math.min(200, Math.max(10, Number(quantity) || 100));
  return call({
    ...c, method: 'taobao.tmc.messages.consume',
    params: { group_name: groupName === 'default' ? undefined : groupName, quantity: n },
  });
}

/** 确认消息已消费（否则约 6 分钟后重发） */
function tmcConfirm(c, { groupName = 'default', messageIds = [] } = {}) {
  if (!messageIds.length) return Promise.resolve({ ok: true, data: { is_success: true }, ms: 0 });
  return call({
    ...c, method: 'taobao.tmc.messages.confirm',
    params: {
      group_name: groupName === 'default' ? undefined : groupName,
      s_message_ids: messageIds.slice(0, 200).join(','),
    },
  });
}

/** 为已授权用户开通消息服务（订阅 topics） */
function tmcUserPermit(c, { topics } = {}) {
  return call({
    ...c, method: 'taobao.tmc.user.permit',
    params: { topics: Array.isArray(topics) ? topics.join(',') : topics },
  });
}

/** 查询用户已授权的 topic 列表 */
function tmcUserGet(c) {
  return call({ ...c, method: 'taobao.tmc.user.get', params: {} });
}

/**
 * 获取淘宝服务器时间：不需要 session 的公共接口
 * 用来在不惊动任何业务数据的前提下验证 AppKey + AppSecret + 签名是否正确
 * （比用 consume 探活安全，不会把真实消息消费掉）
 */
function timeGet(c) {
  return call({ ...c, method: 'taobao.time.get', params: {} });
}

/**
 * 凭据探活：成功说明 AppKey/AppSecret/签名三者一致
 * 返回 { ok, time, error }
 */
async function probeCredentials(c) {
  try {
    const r = await timeGet(c);
    const t = r.data && (r.data.time || r.data);
    return { ok: true, time: typeof t === 'string' ? t : '', ms: r.ms, requestId: r.requestId };
  } catch (e) {
    return { ok: false, code: e.code, message: e.message, hint: e.hint, sub_code: e.subCode };
  }
}

/** 新建消息分组，把用户挂到分组下（多店铺隔离拉取时用） */
function tmcGroupAdd(c, { groupName, userNick, topics }) {
  return call({
    ...c, method: 'taobao.tmc.group.add',
    params: {
      group_name: groupName,
      user_nick: userNick,
      topics: Array.isArray(topics) ? topics.join(',') : topics,
    },
  });
}

/* ---------------- 能力矩阵（真实权限，不做假设） ---------------- */
const CAPABILITIES = [
  { key: 'shop', name: '店铺信息', api: 'taobao.shop.seller.get', need: '基础 API（默认有）' },
  { key: 'seller', name: '卖家账号', api: 'taobao.user.seller.get', need: '基础 API（默认有）' },
  { key: 'orders', name: '已卖出订单', api: 'taobao.trades.sold.get', need: '交易类目权限' },
  { key: 'refunds', name: '收到退款', api: 'taobao.refunds.receive.get', need: '退款类目权限' },
  { key: 'items', name: '在售商品', api: 'taobao.items.onsale.get', need: '商品类目权限' },
  { key: 'tmc', name: '消息推送（TMC 拉取）', api: 'taobao.tmc.messages.consume', need: '消息服务 + 订阅 topic' },
  { key: 'im', name: '买家聊天收发', api: '千牛/客服机器人（非公开 TOP 接口）', need: '需企业入驻服务市场并签约客服能力' },
];

module.exports = {
  name: '淘宝/天猫',
  key: 'taobao',
  GATEWAY, OAUTH, CAPABILITIES,
  TopError,
  sign, topTimestamp, pickList, call,
  authorizeUrl, exchangeCode, refreshSession,
  shopSellerGet, userSellerGet, tradesSoldGet, refundsReceiveGet, itemsOnsaleGet,
  tmcConsume, tmcConfirm, tmcUserPermit, tmcUserGet, tmcGroupAdd,
  timeGet, probeCredentials,
  FIELDS: F,
};
