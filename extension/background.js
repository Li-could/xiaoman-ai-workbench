'use strict';
/* 小满消息桥 · 后台 Service Worker
 * 职责：
 *  1. 周期性向工作台报告心跳（/api/bridge/beat），让工作台显示「网页监听中」
 *  2. 内容脚本抓到新消息后，由这里统一 POST 到 /api/hooks/inbox/<token>
 *  3. 统一读取配置（popup 里保存的 hook 地址 / 开关）
 */

const ALARM = 'xm-beat';
/* MV3 规定 alarms 最小周期为 0.5 分钟（30s），小于该值会被强制钳制并在部分版本报错 */
const BEAT_MIN = 0.5;

/* 绑定店铺（农得利植保店）的收单令牌。同一个令牌在本机与线上服务都有效，
 * 因此扩展会自动在下面几个地址里挑一个「活着的」用：
 *   1. 本机工作台 127.0.0.1:8787（本地启动 server.js 时首选）
 *   2. 线上工作台 kefu.zhimengxuan.com（本机没开时自动兜底）
 * 用户不需要再手动填任何地址。 */
const STORE_TOKEN = 'ik_24fbd34f003454b62cdb10a15b6593fc';
const ENDPOINTS = [
  'https://kefu.zhimengxuan.com',
  'http://127.0.0.1:8787',
];
const DEFAULT_HOOK_URL = ENDPOINTS[0] + '/api/hooks/inbox/' + STORE_TOKEN;

/* 记住上次连通的地址，减少失败重试 */
let activeBase = '';
try {
  chrome.storage.local.get({ activeBase: '' }, (v) => { activeBase = (v && v.activeBase) || ''; });
} catch (e) { /* ignore */ }

function originOf(url) {
  try { return new URL(url).origin; } catch (e) { return ''; }
}

/* 自动配置 Webhook：没有配置或配置成旧地址时，写入本机默认地址 */
function ensureDefaultCfg() {
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.get({ hookUrl: '', enabled: true }, (v) => {
        if (chrome.runtime.lastError) return resolve();
        const cur = String((v && v.hookUrl) || '').trim();
        const usable = Boolean(tokenOf(cur));
        if (usable && v.enabled) {
          if (!activeBase) activeBase = originOf(cur);
          return resolve();
        }
        chrome.storage.sync.set(
          { hookUrl: DEFAULT_HOOK_URL, enabled: true },
          () => { activeBase = ENDPOINTS[0]; resolve(); }
        );
      });
    } catch (e) { resolve(); }
  });
}

/* 统一请求：按「上次可用 → 本机 → 线上」顺序尝试，任一成功即记住 */
async function apiFetch(path, body, opts) {
  const o = opts || {};
  const tries = [];
  if (activeBase) tries.push(activeBase);
  ENDPOINTS.forEach((b) => { if (tries.indexOf(b) < 0) tries.push(b); });
  let lastErr = '';
  for (let i = 0; i < tries.length; i++) {
    const base = tries[i];
    try {
      const r = await fetch(base + path, {
        method: o.method || 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      /* 令牌错/店铺不存在这类业务错误不该换地址重试，直接返回 */
      if (r.ok || (r.status >= 400 && r.status < 500 && j && j.error)) {
        if (r.ok && activeBase !== base) {
          activeBase = base;
          try { chrome.storage.local.set({ activeBase: base }); } catch (e) { /* ignore */ }
        }
        return Object.assign({ __status: r.status, __ok: r.ok }, j);
      }
      lastErr = 'HTTP ' + r.status;
    } catch (e) {
      lastErr = String((e && e.message) || e);
    }
  }
  return { __ok: false, __offline: true, error: lastErr || '连不上工作台' };
}
function hookPath() { return '/api/hooks/inbox/' + STORE_TOKEN; }

function cfg() {
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.get(
        { hookUrl: '', beatUrl: '', enabled: true, selectors: null },
        (v) => {
          if (chrome.runtime.lastError) return resolve({ hookUrl: '', beatUrl: '', enabled: true, selectors: null });
          resolve(v || {});
        }
      );
    } catch (e) {
      resolve({ hookUrl: '', beatUrl: '', enabled: true, selectors: null });
    }
  });
}

/* 由 hook 地址推导 beat 地址（同一台服务） */
function beatUrlOf(hookUrl) {
  try {
    const u = new URL(hookUrl);
    return u.origin + '/api/bridge/beat';
  } catch (e) { return ''; }
}
function tokenOf(hookUrl) {
  const m = /\/api\/hooks\/inbox\/([^/?]+)/.exec(hookUrl || '');
  return m ? m[1] : '';
}
function platformOf(host) {
  if (/pinduoduo/.test(host)) return '拼多多';
  if (/taobao|tmall/.test(host)) return '淘宝/天猫';
  if (/jd\.com/.test(host)) return '京东';
  if (/kuaishou/.test(host)) return '快手';
  if (/douyin|jinritemai/.test(host)) return '抖店';
  if (/weixin\.qq/.test(host)) return '微信小店';
  return host || '网页';
}

/* 心跳 */
async function beat(extra = {}) {
  const c = await cfg();
  if (!c.enabled || !c.hookUrl) return;
  try {
    await apiFetch('/api/bridge/beat', {
      token: tokenOf(c.hookUrl) || STORE_TOKEN,
      platform: platformOf(extra.host || (extra.url ? new URL(extra.url).host : '')),
      page: extra.url || '',
      capturedAt: extra.capturedAt || 0,
    });
  } catch (e) { /* 工作台没启动时静默，下个周期再试 */ }
}

/* 转发新消息到工作台 */
async function forward(msg) {
  const c = await cfg();
  if (!c.enabled || !c.hookUrl) return { ok: false, error: '未配置或未开启' };
  const j = await apiFetch(hookPath(), msg);
  return { ok: Boolean(j.__ok && j.ok), status: j.__status, error: j.error || '' };
}

/* 转发整段聊天记录到工作台（平台「聊天记录查询」页导入） */
async function forwardThread(payload) {
  const c = await cfg();
  if (!c.enabled || !c.hookUrl) return { ok: false, error: '未配置或未开启' };
  const j = await apiFetch(hookPath() + '/thread', payload);
  return Object.assign({ ok: Boolean(j.__ok && j.ok), status: j.__status }, j);
}

/* 上传「当前聊天页结构诊断」（不含任何账号密码，只有元素与文字片段，用于校准抓取规则） */
async function postSnapshot(payload) {
  const c = await cfg();
  if (!c.enabled || !c.hookUrl) return { ok: false, error: '未配置或未开启' };
  const j = await apiFetch('/api/bridge/snapshot', {
    token: tokenOf(c.hookUrl) || STORE_TOKEN,
    data: payload.data || payload,
  });
  return Object.assign({ ok: Boolean(j.__ok && j.ok), status: j.__status }, j);
}

/* 轮询工作台：取回待「回写到平台聊天窗口」的回复 */
async function pollReplies() {
  const c = await cfg();
  if (!c.enabled || !c.hookUrl) return { ok: false, replies: [] };
  const j = await apiFetch('/api/bridge/replies', {
    token: tokenOf(c.hookUrl) || STORE_TOKEN,
    limit: 5,
  });
  return { ok: Boolean(j.__ok && j.ok), replies: j.replies || [] };
}

/* 回执：告诉工作台哪些回复已成功发回平台 */
async function ackReplies(sent, failed) {
  const c = await cfg();
  if (!c.hookUrl) return { ok: false };
  const j = await apiFetch('/api/bridge/replies/ack', {
    token: tokenOf(c.hookUrl) || STORE_TOKEN,
    sent: sent || [],
    failed: failed || [],
  });
  return { ok: Boolean(j.__ok && j.ok) };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.__xm) return;
  if (msg.type === 'capture') {
    forward(msg.payload).then(sendResponse);
    return true; // 异步
  }
  /* 整段聊天记录导入 */
  if (msg.type === 'thread') {
    forwardThread(msg.payload).then(sendResponse);
    return true;
  }
  /* 采集进度：存到本地存储，弹窗打开时展示 */
  if (msg.type === 'harvestStatus') {
    try { chrome.storage.local.set({ harvestStatus: msg.status || null }); } catch (e) { /* 忽略 */ }
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'beat') {
    /* 内容脚本上来的 url 优先（包含 iframe 所在页），避免显示成「网页 / 空页面」 */
    const u = msg.url || (sender.tab && sender.tab.url) || '';
    beat({ url: u, capturedAt: msg.capturedAt }).then(() => sendResponse({ ok: true }));
    return true;
  }
  /* 页面结构诊断：上传聊天页骨架，便于按真实 DOM 校准解析规则 */
  if (msg.type === 'snapshot') {
    postSnapshot(msg.payload && msg.payload.data ? msg.payload : { data: msg.payload || {} })
      .then(sendResponse);
    return true;
  }
  if (msg.type === 'ping') {
    cfg().then((c) => sendResponse({ enabled: c.enabled, hasHook: Boolean(c.hookUrl) }));
    return true;
  }
  /* 内容脚本轮询待回写的回复 */
  if (msg.type === 'pollReplies') {
    pollReplies().then(sendResponse);
    return true;
  }
  /* 内容脚本回执发送结果 */
  if (msg.type === 'ackReplies') {
    ackReplies(msg.sent, msg.failed).then(sendResponse);
    return true;
  }
});

chrome.alarms.create(ALARM, { periodInMinutes: BEAT_MIN });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) beat().catch(() => {}); });

/* 安装/更新后：写入默认 Webhook + 重建心跳闹钟 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: BEAT_MIN });
  ensureDefaultCfg();
});
/* 浏览器启动时兜底一次（防止只装未刷的情况） */
chrome.runtime.onStartup.addListener(() => { ensureDefaultCfg(); });
ensureDefaultCfg();
