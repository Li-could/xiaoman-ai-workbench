'use strict';
/**
 * 小满AI · 电商客服工作台 —— 完整后端（零依赖）
 *
 * 能力：
 *   · 用户注册 / 登录 / 登出 / 改密（scrypt + HttpOnly Session Cookie）
 *   · 多租户数据隔离（每个账号一个工作空间，注册即带演示数据）
 *   · 会话聚合 / 消息收发 / 未读 / 转人工
 *   · 售后工单 / 状态流转 / 处理记录
 *   · 店铺、知识库、快捷话术管理
 *   · 数据看板（真实工单与会话计数 + 运营基线）
 *   · AI：OpenAI 兼容代理 + SSE 流式（未配 Key 走演示引擎）、模型配置、连接测试
 *   · 后台管理：成员管理（角色/禁用/重置密码）、系统统计、操作日志
 *
 * 启动：node server.js     默认 http://127.0.0.1:8787
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

/* 在项目根 .env 里读取配置（PORT / DB_* / TMC_POLL_MS 等）。
   在解析 PORT 之前调用，确保 node server.js 无需手动导出环境变量即可生效。 */
const { loadEnv } = require('./lib/env');
loadEnv();

const dbm = require('./lib/db');
const { all, get, run, uid, nowISO, nowHM, getSetting, setSetting, audit } = dbm;
const auth = require('./lib/auth');
const seed = require('./lib/seed');
const llm = require('./lib/llm');
const poller = require('./lib/poller');
const autoReply = require('./lib/auto-reply');
const flowEngine = require('./lib/flow-engine');
const { productImage } = require('./lib/product-images');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = process.env.PORT || 8787;

/* 首次启动：初始化演示账号 + 演示租户 */
try { seed.ensureDemoTenant(); } catch (e) { console.error('初始化演示数据失败：', e.message); }
/* 把历史（无分类）快捷短语升级为「分组 + 个人/团队」结构，仅对完全匹配旧集合的租户生效 */
try {
  const upgraded = all('SELECT id FROM tenants').filter((t) => seed.upgradeQuickReplies(t.id)).length;
  if (upgraded) console.log(`快捷短语结构已升级：${upgraded} 个租户`);
} catch (e) { console.error('升级快捷短语失败：', e.message); }

/* ==================================================================
   通用工具
   ================================================================== */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject', '.otf': 'font/otf',
  '.map': 'application/json', '.webp': 'image/webp', '.wav': 'audio/wav',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska', '.m4v': 'video/mp4',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.zip': 'application/zip', '.rar': 'application/x-rar-compressed',
};

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit = 1024 * 512) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/* 读取原始二进制（供 multipart 文件上传，单独更高的上限） */
function readBuffer(req, limit = 256 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('文件过大（上限 256MB）')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* 极简但足够健壮的 multipart/form-data 解析（内存模式，适合中文件上传） */
function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  const result = { fields: {}, files: [] };
  if (!m) return result;
  const boundary = '--' + (m[1] || m[2]).trim();
  let pos = buf.indexOf(boundary);
  if (pos < 0) return result;
  pos += boundary.length;
  while (pos < buf.length) {
    if (buf[pos] === 0x0d && buf[pos + 1] === 0x0a) pos += 2;
    else if (buf[pos] === 0x0a) pos += 1;
    if (buf[pos] === 0x2d && buf[pos + 1] === 0x2d) break; // 结束边界 "--"
    const next = buf.indexOf(boundary, pos);
    if (next < 0) break;
    const part = buf.slice(pos, next);
    const he = part.indexOf('\r\n\r\n');
    if (he < 0) { pos = next + boundary.length; continue; }
    const headerLines = part.slice(0, he).toString('utf8').split('\r\n');
    let body = part.slice(he + 4);
    if (body.length >= 2 && body[body.length - 2] === 0x0d && body[body.length - 1] === 0x0a) {
      body = body.slice(0, body.length - 2);
    }
    let name = null, filename = null, ct = null;
    for (const line of headerLines) {
      const ci = line.indexOf(':');
      if (ci < 0) continue;
      const key = line.slice(0, ci).trim().toLowerCase();
      const val = line.slice(ci + 1).trim();
      if (key === 'content-disposition') {
        const nm = /name="([^"]*)"/i.exec(val);
        const fn = /filename="([^"]*)"/i.exec(val);
        if (nm) name = nm[1];
        if (fn) filename = fn[1];
      } else if (key === 'content-type') ct = val;
    }
    if (name == null) { pos = next + boundary.length; continue; }
    if (filename) {
      result.files.push({ name, filename, contentType: ct || 'application/octet-stream', data: body });
    } else {
      result.fields[name] = body.toString('utf8');
    }
    pos = next + boundary.length;
  }
  return result;
}

/* 限流：登录/注册 20 次/分钟；AI 60 次/分钟 */
const buckets = new Map();
function rateLimited(key, max) {
  const now = Date.now();
  const rec = buckets.get(key) || { count: 0, reset: now + 60000 };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + 60000; }
  rec.count++;
  buckets.set(key, rec);
  return rec.count > max;
}

/* ==================================================================
   路由表
   ================================================================== */
const routes = [];
function route(method, pattern, fn, opts = {}) {
  const keys = [];
  const re = new RegExp(
    '^' + pattern.replace(/\/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '$'
  );
  routes.push({ method, re, keys, fn, auth: opts.auth || 'user' });
}

/* ---------------- 认证 ---------------- */
route('POST', '/api/auth/register', async (c) => {
  const ip = c.ip;
  if (rateLimited('reg:' + ip, 20)) return sendJSON(c.res, 429, { error: '操作过于频繁，请稍后再试' });

  const name = String(c.body.name || '').trim();
  const email = String(c.body.email || '').trim().toLowerCase();
  const password = String(c.body.password || '');
  const company = String(c.body.company || '').trim();

  if (name.length < 2 || name.length > 20) return sendJSON(c.res, 400, { error: '姓名需为 2-20 个字符' });
  if (!auth.validEmail(email)) return sendJSON(c.res, 400, { error: '邮箱格式不正确' });
  if (password.length < 6) return sendJSON(c.res, 400, { error: '密码至少 6 位' });
  if (get('SELECT id FROM users WHERE email = ?', email)) {
    return sendJSON(c.res, 409, { error: '该邮箱已注册，请直接登录' });
  }

  /* 新注册账号统一挂到主管理员（首个 admin）所在工作空间下，作为子账号：
     角色 agent、0 点数、默认只读（0 操作权限），需管理员在「子账号管理」里给权限后才能操作 */
  const anchor = get(
    `SELECT * FROM users WHERE role = 'admin' AND status = 'active' ORDER BY created_at ASC, id ASC LIMIT 1`
  );
  const userId = uid('us');
  let tenantId;
  if (anchor) {
    tenantId = anchor.tenant_id;
    run(
      `INSERT INTO users (id,tenant_id,name,email,password,role,status,title,points,created_at,last_login_at)
       VALUES (?,?,?,?,?,'agent','active',?,0,?,?)`,
      userId, tenantId, name, email, auth.hashPassword(password), company || '客服坐席', nowISO(), nowISO()
    );
    audit(tenantId, anchor, '新成员注册', `${name}（${email}）加入工作空间，等待管理员分配权限`, ip);
  } else {
    /* 兜底：系统里还没有任何管理员时，保持旧行为（自建工作空间并成为管理员） */
    tenantId = seed.createTenant(company || `${name}的工作台`);
    seed.seedTenant(tenantId);
    run(
      `INSERT INTO users (id,tenant_id,name,email,password,role,status,title,created_at,last_login_at)
       VALUES (?,?,?,?,?,'admin','active',?,?,?)`,
      userId, tenantId, name, email, auth.hashPassword(password), '工作空间所有者', nowISO(), nowISO()
    );
  }

  const { token } = auth.createSession(userId);
  c.res.setHeader('Set-Cookie', auth.cookieHeader(token, auth.SESSION_DAYS * 86400));
  audit(tenantId, { id: userId, name }, '注册账号', email, ip);
  const tenant = get('SELECT * FROM tenants WHERE id = ?', tenantId);
  return sendJSON(c.res, 200, { ok: true, user: auth.safeUser(get('SELECT * FROM users WHERE id = ?', userId), tenant) });
}, { auth: 'none' });

route('POST', '/api/auth/login', async (c) => {
  const ip = c.ip;
  if (rateLimited('login:' + ip, 20)) return sendJSON(c.res, 429, { error: '尝试过于频繁，请 1 分钟后再试' });

  const email = String(c.body.email || '').trim().toLowerCase();
  const password = String(c.body.password || '');
  if (!email || !password) return sendJSON(c.res, 400, { error: '请输入邮箱与密码' });

  const user = get('SELECT * FROM users WHERE email = ?', email);
  if (!user || !auth.verifyPassword(password, user.password)) {
    return sendJSON(c.res, 401, { error: '邮箱或密码不正确' });
  }
  if (user.status !== 'active') return sendJSON(c.res, 403, { error: '账号已被禁用，请联系管理员' });

  run('UPDATE users SET last_login_at = ? WHERE id = ?', nowISO(), user.id);
  const { token } = auth.createSession(user.id);
  c.res.setHeader('Set-Cookie', auth.cookieHeader(token, auth.SESSION_DAYS * 86400));
  const tenant = get('SELECT * FROM tenants WHERE id = ?', user.tenant_id);
  audit(user.tenant_id, user, '登录', email, ip);
  return sendJSON(c.res, 200, { ok: true, user: auth.safeUser(user, tenant) });
}, { auth: 'none' });

route('POST', '/api/auth/logout', async (c) => {
  auth.destroySession(c.token);
  c.res.setHeader('Set-Cookie', auth.cookieHeader('', 0));
  return sendJSON(c.res, 200, { ok: true });
}, { auth: 'none' });

route('GET', '/api/auth/me', async (c) => {
  return sendJSON(c.res, 200, { user: auth.safeUser(c.user, c.tenant) });
}, { auth: 'none' });

route('POST', '/api/auth/password', async (c) => {
  const oldPw = String(c.body.oldPassword || '');
  const newPw = String(c.body.newPassword || '');
  if (newPw.length < 6) return sendJSON(c.res, 400, { error: '新密码至少 6 位' });
  const row = get('SELECT * FROM users WHERE id = ?', c.user.id);
  if (!auth.verifyPassword(oldPw, row.password)) return sendJSON(c.res, 400, { error: '原密码不正确' });
  run('UPDATE users SET password = ? WHERE id = ?', auth.hashPassword(newPw), c.user.id);
  audit(c.tenant.id, c.user, '修改密码', c.user.email, c.ip);
  return sendJSON(c.res, 200, { ok: true });
});

/* ---------------- 启动数据（一次拉全） ---------------- */
function parsePayload(v) {
  if (!v) return null;
  try { return JSON.parse(v); } catch { return null; }
}
function convView(r, byConv) {
  return {
    id: r.id,
    storeId: r.store_id,
    name: r.customer,
    tags: safeJSON(r.tags, []),
    order: r.order_no
      ? { no: r.order_no, product: r.order_product, amount: r.order_amount, status: r.order_status }
      : null,
    unread: r.unread,
    status: r.status,
    sentiment: r.sentiment,
    lastMsg: r.last_msg,
    lastTime: r.last_time,
    channel: r.channel || '',
    /* 消息带自增 id：前端据此增量追加，避免重复渲染 */
    messages: byConv[r.id] || [],
  };
}

function msgView(m) {
  return {
    id: m.id,
    role: m.role, text: m.text, time: m.time,
    kind: m.kind || '',
    payload: parsePayload(m.payload),
  };
}

/* ---------------- 店铺数据可见范围（子账号按「可接管店铺」过滤） ----------------
 * 管理员 → null（全部可见）；子账号 → store_ids 勾选的店铺；一个都没勾 → 空数组（看不到任何店铺数据） */
function scopedStoreIds(user) {
  if (!user || user.role === 'admin') return null;
  return String(user.store_ids || '').split(',').map((x) => x.trim()).filter(Boolean);
}
/* 拼一段 AND store_id IN (...)；scope=null 时不拼接 */
function scopeWhere(scope, column) {
  if (scope === null || scope === undefined) return { sql: '', params: [] };
  if (!scope.length) return { sql: ` AND ${column} IN ('')`, params: [] };
  return { sql: ` AND ${column} IN (${scope.map(() => '?').join(',')})`, params: scope };
}

function loadConversations(tenantId, scope) {
  const sw = scopeWhere(scope, 'store_id');
  const rows = all(`SELECT * FROM conversations WHERE tenant_id = ?${sw.sql} ORDER BY updated_at DESC`, tenantId, ...sw.params);
  const ids = rows.map((r) => r.id);
  const msgs = ids.length
    ? all(`SELECT id,conv_id,role,text,time,kind,payload FROM messages WHERE tenant_id = ? AND conv_id IN (${ids.map(() => '?').join(',')}) ORDER BY id ASC`, tenantId, ...ids)
    : [];
  const byConv = {};
  msgs.forEach((m) => (byConv[m.conv_id] = byConv[m.conv_id] || []).push(msgView(m)));
  return rows.map((r) => convView(r, byConv));
}

/**
 * 增量：只返回 since 之后有变动的会话（含完整消息，带 id）
 * 供工作台轮询，实现「买家发了消息，客服不用刷新页面就能看到」
 */
function feedConversations(tenantId, sinceIso, scope) {
  const sw = scopeWhere(scope, 'store_id');
  const rows = all(
    `SELECT * FROM conversations WHERE tenant_id = ?${sw.sql} AND updated_at > ? ORDER BY updated_at DESC LIMIT 100`,
    tenantId, ...sw.params, sinceIso
  );
  if (!rows.length) return [];
  const ph = rows.map(() => '?').join(',');
  const msgs = all(
    `SELECT id,conv_id,role,text,time,kind,payload FROM messages WHERE tenant_id = ? AND conv_id IN (${ph}) ORDER BY id ASC`,
    tenantId, ...rows.map((r) => r.id)
  );
  const byConv = {};
  msgs.forEach((m) => (byConv[m.conv_id] = byConv[m.conv_id] || []).push(msgView(m)));
  return rows.map((r) => convView(r, byConv));
}

function loadTickets(tenantId, scope) {
  const sw = scopeWhere(scope, 'store_id');
  const rows = all(`SELECT * FROM tickets WHERE tenant_id = ?${sw.sql} ORDER BY rowid ASC`, tenantId, ...sw.params);
  const evts = all('SELECT ticket_id,time,text,actor FROM ticket_events WHERE tenant_id = ? ORDER BY id ASC', tenantId);
  const byT = {};
  evts.forEach((e) => (byT[e.ticket_id] = byT[e.ticket_id] || []).push({ time: e.time, text: e.text, actor: e.actor }));
  return rows.map((t) => ({
    id: t.id, storeId: t.store_id, type: t.type, typeLabel: t.type_label,
    status: t.status, priority: t.priority, customer: t.customer, orderNo: t.order_no,
    product: t.product, amount: t.amount, reason: t.reason, createdAt: t.created_at,
    timeline: byT[t.id] || [],
  }));
}

function safeJSON(s, dft) {
  try { return JSON.parse(s); } catch (e) { return dft; }
}

route('GET', '/api/bootstrap', async (c) => {
  const t = c.tenant.id;
  const scope = scopedStoreIds(c.user); /* 子账号只能看到被勾选的「可接管店铺」 */
  const stores = all('SELECT * FROM stores WHERE tenant_id = ? ORDER BY sort ASC, rowid ASC', t)
    .filter((s) => !scope || scope.indexOf(String(s.id)) >= 0)
    .map((s) => {
      /* 对外消息接入口：每个店铺都有，买家从这里发消息就能进工作台 */
      let box = null;
      try {
        const ib = inbox.ensureInbox(s.id);
        box = { code: ib.code, url: '/c/' + ib.code, ai: ib.ai, welcome: ib.welcome };
      } catch (e) { box = null; }
      return { id: s.id, name: s.name, platform: s.platform, short: s.short, color: s.color, account: s.account, status: s.status, inbox: box };
    });
  const conversations = loadConversations(t, scope);
  const tickets = loadTickets(t, scope);
  const knowledge = all('SELECT * FROM knowledge WHERE tenant_id = ? ORDER BY rowid ASC', t)
    .map((k) => ({ id: k.id, q: k.q, a: k.a, materialId: k.material_id || '' }));
  const quickReplies = all('SELECT * FROM quick_replies WHERE tenant_id = ? ORDER BY sort ASC', t).map((q) => q.text);
  const cfg = llm.getAiConfig(t);
  let dash = getSetting(t, 'dashboard', null);
  /* 看板里的店铺排行 / 平台分布也只保留授权范围内的店铺 */
  if (dash && scope) {
    const allowedPlatforms = new Set(stores.map((s) => String(s.platform)));
    dash = {
      ...dash,
      storeRanking: (dash.storeRanking || []).filter((r) => scope.indexOf(String(r.storeId)) >= 0),
      platformDist: (dash.platformDist || []).filter((p) => allowedPlatforms.has(String(p.name))),
    };
  }
  const agents = all("SELECT id,name,role,status FROM users WHERE tenant_id = ? AND status='active' ORDER BY rowid ASC", t);

  return sendJSON(c.res, 200, {
    user: auth.safeUser(c.user, c.tenant),
    tenant: { id: c.tenant.id, name: c.tenant.name },
    brand: { name: '小满AI', product: '电商客服工作台', version: '2.0' },
    stores, conversations, tickets, knowledge, quickReplies,
    dashboard: dash,
    ai: llm.publicAi(cfg),
    team: agents.map((a) => ({ id: a.id, name: a.name, role: a.role })),
  });
});

/* ---------------- 会话 ---------------- */
route('POST', '/api/conversations/read-all', async (c) => {
  run('UPDATE conversations SET unread = 0 WHERE tenant_id = ?', c.tenant.id);
  return sendJSON(c.res, 200, { ok: true });
});

route('POST', '/api/conversations/:id/read', async (c) => {
  run('UPDATE conversations SET unread = 0 WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  return sendJSON(c.res, 200, { ok: true });
});

route('POST', '/api/conversations/:id/messages', async (c) => {
  const conv = get('SELECT * FROM conversations WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!conv) return sendJSON(c.res, 404, { error: '会话不存在' });
  const _scope = scopedStoreIds(c.user);
  if (_scope && _scope.indexOf(String(conv.store_id)) < 0) {
    return sendJSON(c.res, 403, { error: '该会话所属店铺不在你的授权范围内' });
  }
  const text = String(c.body.text || '').slice(0, 4000).trim();
  const role = ['agent', 'customer'].includes(c.body.role) ? c.body.role : 'agent';
  /* kind=order 时为订单卡片消息：文本可为空，结构化数据放 payload */
  const kind = c.body.kind === 'order' ? 'order' : '';
  if (!text && !kind) return sendJSON(c.res, 400, { error: '消息内容为空' });
  const payload = kind && c.body.payload ? JSON.stringify(c.body.payload) : '';
  const shown = text || (kind === 'order' ? '[订单卡片]' : '');

  const time = nowHM();
  run('INSERT INTO messages (tenant_id,conv_id,role,text,time,kind,payload,created_at) VALUES (?,?,?,?,?,?,?,?)',
    c.tenant.id, conv.id, role, shown, time, kind, payload, nowISO());
  if (role === 'customer') {
    /* 客户消息：更新列表预览为客户说的话 */
    run(
      'UPDATE conversations SET last_msg = ?, last_time = ?, updated_at = ?, unread = ? WHERE id = ?',
      shown, time, nowISO(), (conv.unread || 0) + 1, conv.id
    );
  } else {
    /* 客服/AI 回复：不覆盖列表预览（保留客户最近说的话），仅刷新排序时间与状态 */
    run(
      'UPDATE conversations SET updated_at = ?, unread = 0, status = ? WHERE id = ?',
      nowISO(), 'human', conv.id
    );
  }
  /* 顾客消息：先触发已启用的工作流（消息触发 + 意图路由），未命中再由「转AI」连续回复兜底 */
  let aiText = '';
  let flowRun = null;
  if (role === 'customer' && kind !== 'order') {
    flowRun = await flowEngine.handleCustomerMessage(c.tenant.id, conv.id);
    if (flowRun) {
      aiText = flowRun.reply;
    } else {
      aiText = await autoReply.maybeAutoReply(c.tenant.id, conv.id);
    }
  }
  /* 网页桥接会话：人工回复与 AI 回复都推入回写队列，由扩展发回平台聊天窗口 */
  try {
    if (role === 'agent' && shown) bridgeOutbox.enqueueForConv(conv.id, shown);
    if (aiText) bridgeOutbox.enqueueForConv(conv.id, aiText);
  } catch (e) { /* 回写入队失败不影响主流程 */ }
  return sendJSON(c.res, 200, {
    ok: true,
    message: { role, text: shown, time, kind, payload: c.body.payload || null },
    aiReply: aiText ? { role: 'ai', text: aiText, time: nowHM() } : null,
    flowRun: flowRun ? { flowId: flowRun.flowId, flowName: flowRun.flowName, intent: flowRun.intent } : null,
  });
});

route('POST', '/api/conversations/:id/status', async (c) => {
  const status = ['ai', 'human', 'waiting'].includes(c.body.status) ? c.body.status : null;
  if (!status) return sendJSON(c.res, 400, { error: '状态不合法' });
  run('UPDATE conversations SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?',
    status, nowISO(), c.params.id, c.tenant.id);
  /* 转 AI 后若最新消息是顾客发的，立即接管回复 */
  let aiText = '';
  if (status === 'ai') aiText = await autoReply.maybeAutoReply(c.tenant.id, c.params.id);
  /* 网页桥接会话：接管回复也回写到平台 */
  if (aiText) { try { bridgeOutbox.enqueueForConv(c.params.id, aiText); } catch (e) {} }
  return sendJSON(c.res, 200, {
    ok: true,
    aiReply: aiText ? { role: 'ai', text: aiText, time: nowHM() } : null,
  });
});

/* ---------------- 售后工单 ---------------- */
route('POST', '/api/tickets/:id/status', async (c) => {
  const status = ['pending', 'processing', 'done'].includes(c.body.status) ? c.body.status : null;
  if (!status) return sendJSON(c.res, 400, { error: '状态不合法' });
  const t = get('SELECT * FROM tickets WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!t) return sendJSON(c.res, 404, { error: '工单不存在' });
  const _scope = scopedStoreIds(c.user);
  if (_scope && _scope.indexOf(String(t.store_id)) < 0) {
    return sendJSON(c.res, 403, { error: '该工单所属店铺不在你的授权范围内' });
  }
  run('UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?', status, nowISO(), t.id);
  run('INSERT INTO ticket_events (tenant_id,ticket_id,time,text,actor) VALUES (?,?,?,?,?)',
    c.tenant.id, t.id, '今天 ' + nowHM(),
    '状态更新为「' + { pending: '待处理', processing: '处理中', done: '已完成' }[status] + '」',
    c.user.name);
  return sendJSON(c.res, 200, { ok: true });
});

route('POST', '/api/tickets/:id/events', async (c) => {
  const text = String(c.body.text || '').slice(0, 500).trim();
  if (!text) return sendJSON(c.res, 400, { error: '内容为空' });
  const _tk = get('SELECT * FROM tickets WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (_tk) {
    const _scope = scopedStoreIds(c.user);
    if (_scope && _scope.indexOf(String(_tk.store_id)) < 0) {
      return sendJSON(c.res, 403, { error: '该工单所属店铺不在你的授权范围内' });
    }
  }
  run('INSERT INTO ticket_events (tenant_id,ticket_id,time,text,actor) VALUES (?,?,?,?,?)',
    c.tenant.id, c.params.id, '今天 ' + nowHM(), text, c.user.name);
  return sendJSON(c.res, 200, { ok: true });
});

/* ---------------- 店铺管理（真实平台接入） ---------------- */
const connectors = require('./lib/connectors');
const storeAuth = require('./lib/store-auth');
const sync = require('./lib/sync');
const secret = require('./lib/crypto');
const platforms = require('./lib/platforms');
const { learnItemKnowledge } = require('./lib/item-knowledge');
const notifyPush = require('./lib/notify-push');
const bridgeOutbox = require('./lib/bridge-outbox');
const inbox = require('./lib/inbox');

/** 回调基地址：优先 PUBLIC_BASE_URL，其次按当前请求推断 */
function baseUrl(c) {
  const fixed = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (fixed) return fixed;
  const host = c.req.headers.host || '127.0.0.1:' + PORT;
  const proto = c.req.headers['x-forwarded-proto'] || 'http';
  return proto + '://' + host;
}

function callbackUrl(c, platform) {
  return baseUrl(c) + '/api/oauth/' + platform + '/callback';
}

function storeWithIntegration(s) {
  const row = storeAuth.getRow(s.id);
  /* 对外消息接入口：任何店铺都有，买家从这里发消息就能进工作台 */
  let inboxView = null;
  try {
    const ib = inbox.ensureInbox(s.id);
    inboxView = { code: ib.code, url: '/c/' + ib.code, ai: ib.ai, welcome: ib.welcome };
  } catch (e) { inboxView = null; }
  if (!row) return { ...s, integration: null, inbox: inboxView };
  const cred = storeAuth.resolve(row);
  return {
    ...s,
    integration: {
      platform: cred.platform,
      env: cred.env,
      app_key: cred.appKey,
      authorized: Boolean(cred.session),
      auth_status: cred.authStatus,
      auth_error: cred.authError,
      shop_id: cred.shopId,
      seller_nick: cred.sellerNick,
      shop_title: cred.shopTitle,
      shop_pic: cred.shopPic,
      token_expired: cred.tokenExpireAt ? cred.tokenExpireAt < Date.now() : false,
      last_sync_at: cred.lastSyncAt,
    },
    inbox: inboxView,
  };
}

/* 单店真实运营统计：商品数 / 知识数 / 总接待人数 / 总转接次数 */
function storeStats(tenantId, storeId) {
  const items = get('SELECT COUNT(*) AS n FROM shop_items WHERE tenant_id = ? AND store_id = ?', tenantId, storeId).n;
  const kb = get('SELECT COUNT(*) AS n FROM store_knowledge WHERE tenant_id = ? AND store_id = ?', tenantId, storeId).n;
  const recv = get('SELECT COUNT(*) AS n FROM conversations WHERE tenant_id = ? AND store_id = ?', tenantId, storeId).n;
  const transfer = get(
    "SELECT COUNT(*) AS n FROM conversations WHERE tenant_id = ? AND store_id = ? AND transferred_at <> ''",
    tenantId, storeId
  ).n;
  const msg = get(
    'SELECT COUNT(*) AS n FROM messages m JOIN conversations cv ON cv.id = m.conv_id WHERE cv.tenant_id = ? AND cv.store_id = ?',
    tenantId, storeId
  ).n;
  return { items: Number(items), knowledge: Number(kb), receives: Number(recv), transfers: Number(transfer), messages: Number(msg) };
}

route('GET', '/api/stores', async (c) => {
  const scope = scopedStoreIds(c.user);
  const rows = all('SELECT * FROM stores WHERE tenant_id = ? ORDER BY sort ASC, rowid ASC', c.tenant.id)
    .filter((s) => !scope || scope.indexOf(String(s.id)) >= 0);
  const allTotal = get('SELECT COUNT(*) AS n FROM stores WHERE tenant_id = ?', c.tenant.id).n;
  const platform = String(c.query.get('platform') || '').trim();
  const kw = String(c.query.get('q') || '').trim().toLowerCase();

  let list = rows;
  if (platform && platform !== '全部平台' && platform !== 'all') {
    list = list.filter((s) => String(s.platform) === platform);
  }
  if (kw) list = list.filter((s) => String(s.name).toLowerCase().indexOf(kw) >= 0);

  return sendJSON(c.res, 200, {
    stores: list.map((s) => ({ ...storeWithIntegration(s), stats: storeStats(c.tenant.id, s.id) })),
    total: list.length,
    all_total: scope ? rows.length : allTotal,
    supported: connectors.catalog(),
    platforms: Array.from(new Set(rows.map((s) => s.platform))),
  });
});

/* 店铺详情：统计 + 商品列表（真实来自 shop_items） */
route('GET', '/api/stores/:id/detail', async (c) => {
  const scope = scopedStoreIds(c.user);
  const s = get('SELECT * FROM stores WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!s || (scope && scope.indexOf(String(s.id)) < 0)) return sendJSON(c.res, 404, { error: '店铺不存在' });

  const kw = String(c.query.get('q') || '').trim();
  let sql = 'SELECT * FROM shop_items WHERE tenant_id = ? AND store_id = ?';
  const args = [c.tenant.id, s.id];
  if (kw) { sql += ' AND (title LIKE ? OR num_iid LIKE ?)'; args.push('%' + kw + '%', '%' + kw + '%'); }
  sql += ' ORDER BY title ASC';

  /* 每个商品已被 AI 学进知识库多少条 */
  const kbMap = {};
  for (const r of all(
    "SELECT product_id, COUNT(*) AS n FROM store_knowledge WHERE tenant_id = ? AND store_id = ? AND type = 'product' GROUP BY product_id",
    c.tenant.id, s.id
  )) kbMap[r.product_id] = Number(r.n);

  const items = all(sql, ...args).map((r) => ({
    num_iid: r.num_iid,
    title: r.title || '',
    price: r.price || '',
    num: Number(r.num || 0),
    pic_url: r.pic_url || '',
    status: r.status || '',
    description: r.description || '',
    specs: r.specs || '',
    attrs: r.attrs || '',
    synced_at: r.synced_at || '',
    kb_count: kbMap[r.num_iid] || 0,
  }));

  return sendJSON(c.res, 200, {
    store: storeWithIntegration(s),
    stats: storeStats(c.tenant.id, s.id),
    items,
    total: items.length,
  });
});

/* 手动添加商品（未接 API 的平台，或补录线上没有的商品资料） */
route('POST', '/api/stores/:id/items', async (c) => {
  const s = get('SELECT * FROM stores WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!s) return sendJSON(c.res, 404, { error: '店铺不存在' });
  const b = c.body || {};
  const title = String(b.title || '').trim();
  if (!title) return sendJSON(c.res, 400, { error: '商品名称必填' });

  let numIid = String(b.num_iid || '').trim();
  if (!numIid) numIid = '9' + String(Date.now()).slice(-9) + String(Math.floor(Math.random() * 90) + 10);
  const exists = get('SELECT num_iid FROM shop_items WHERE num_iid = ? AND tenant_id = ?', numIid, c.tenant.id);
  if (exists) return sendJSON(c.res, 400, { error: '该商品 ID 已存在' });

  run(
    `INSERT INTO shop_items (num_iid,tenant_id,store_id,title,price,num,outer_id,pic_url,status,modified,description,specs,attrs,synced_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    numIid, c.tenant.id, s.id, title.slice(0, 500), String(b.price || ''), Number(b.num || 0), '',
    String(b.pic_url || ''), 'onsale', '', String(b.description || ''), String(b.specs || ''), String(b.attrs || ''), nowISO()
  );

  const learned = learnItemKnowledge(c.tenant.id, s.id, {
    num_iid: numIid, title, price: b.price, description: b.description, specs: b.specs, attrs: b.attrs,
  });
  audit(c.tenant.id, c.user, '新增商品', title, c.ip);
  return sendJSON(c.res, 200, { ok: true, num_iid: numIid, learned });
});

/* 删除商品（连同它被 AI 学到的知识一起清掉） */
route('DELETE', '/api/shop-items/:numIid', async (c) => {
  if (c.user.role !== 'admin') return sendJSON(c.res, 403, { error: '仅管理员可删除商品' });
  const row = get('SELECT * FROM shop_items WHERE num_iid = ? AND tenant_id = ?', c.params.numIid, c.tenant.id);
  if (!row) return sendJSON(c.res, 404, { error: '商品不存在' });
  run('DELETE FROM shop_items WHERE num_iid = ? AND tenant_id = ?', c.params.numIid, c.tenant.id);
  run("DELETE FROM store_knowledge WHERE tenant_id = ? AND store_id = ? AND product_id = ? AND type = 'product'",
    c.tenant.id, row.store_id, c.params.numIid);
  audit(c.tenant.id, c.user, '删除商品', row.title, c.ip);
  return sendJSON(c.res, 200, { ok: true });
});

/* 手动触发「AI 学习这个商品」 */
route('POST', '/api/shop-items/:numIid/learn', async (c) => {
  const row = get('SELECT * FROM shop_items WHERE num_iid = ? AND tenant_id = ?', c.params.numIid, c.tenant.id);
  if (!row) return sendJSON(c.res, 404, { error: '商品不存在' });
  const n = learnItemKnowledge(c.tenant.id, row.store_id, row);
  audit(c.tenant.id, c.user, 'AI 学习商品', row.title, c.ip);
  return sendJSON(c.res, 200, { ok: true, learned: n, message: n ? `已从商品资料里提炼 ${n} 条知识` : '商品资料为空，没什么可学的' });
});

/* 编辑商品参数：AI 学习出来的产品介绍 / 规格 / 属性可人工修订 */
route('PUT', '/api/shop-items/:numIid', async (c) => {
  const row = get('SELECT * FROM shop_items WHERE num_iid = ? AND tenant_id = ?', c.params.numIid, c.tenant.id);
  if (!row) return sendJSON(c.res, 404, { error: '商品不存在' });
  const b = c.body || {};
  const sets = [];
  const args = [];
  if (b.title !== undefined) { sets.push('title = ?'); args.push(String(b.title).slice(0, 500)); }
  if (b.description !== undefined) { sets.push('description = ?'); args.push(String(b.description)); }
  if (b.specs !== undefined) { sets.push('specs = ?'); args.push(String(b.specs)); }
  if (b.attrs !== undefined) { sets.push('attrs = ?'); args.push(String(b.attrs)); }
  if (!sets.length) return sendJSON(c.res, 400, { error: '没有需要更新的字段' });
  args.push(c.params.numIid, c.tenant.id);
  run(`UPDATE shop_items SET ${sets.join(', ')} WHERE num_iid = ? AND tenant_id = ?`, ...args);

  /* 默认保存后让 AI 重新学习（前端可传 learn:false 关闭） */
  let learned = 0;
  if (b.learn !== false) {
    const fresh = get('SELECT * FROM shop_items WHERE num_iid = ? AND tenant_id = ?', c.params.numIid, c.tenant.id);
    learned = learnItemKnowledge(c.tenant.id, fresh.store_id, fresh);
  }

  audit(c.tenant.id, c.user, '编辑商品参数', c.params.numIid, c.ip);
  return sendJSON(c.res, 200, { ok: true, learned });
});

/**
 * 新增店铺：
 *   mode=api  —— 淘宝系，需 AppKey/AppSecret，走 OAuth 授权后读取真实数据
 *   mode=web  —— 其它平台，先在官方页面登录，本系统登记店铺（明确标注未接 API）
 */
route('POST', '/api/stores', async (c) => {
  const platformRaw = String(c.body.platform || '').trim();
  const mode = String(c.body.mode || 'api') === 'web' ? 'web' : 'api';

  /* 先确定平台 key，再做权限校验（管理员可添加全部；子账号需有「可操作」权限且该平台在「可添加平台」列表） */
  let platKey = null, platName = platformRaw;
  if (mode === 'web') {
    const cat = platforms.get(platforms.normalize(platformRaw));
    if (!cat) return sendJSON(c.res, 400, { error: '未知平台：' + platformRaw });
    platKey = cat.key; platName = cat.name;
  } else {
    const conn = connectors.get(platformRaw);
    if (!conn) {
      return sendJSON(c.res, 400, {
        error: `平台「${platformRaw || '未选择'}」还没有接入开放平台 API。目前已完成真实 API 对接的是：` +
          connectors.catalog().map((x) => x.name).join('、'),
        unsupported_platform: true,
        supported: connectors.catalog().map((x) => x.name),
      });
    }
    platKey = conn.key; platName = conn.name;
  }

  if (c.user.role !== 'admin') {
    const pm = auth.parsePermissions(c.user.permissions);
    const allowed = (pm && pm.ops) ? (pm.platforms || []) : [];
    if (allowed.indexOf(platKey) < 0) {
      return sendJSON(c.res, 403, {
        error: `你没有被授权添加「${platName}」平台的店铺。请联系管理员在「子账号管理 → 编辑」中为该账号开通「可添加平台」权限。`,
        need_platform_perm: true, platform: platKey,
      });
    }
  }

  const cat = platforms.get(platforms.normalize(platformRaw));
  const conn = connectors.get(platformRaw);

  /* ---------- 网页登录模式（不接 API） ---------- */
  if (mode === 'web') {
    if (!cat) return sendJSON(c.res, 400, { error: '未知平台：' + platformRaw });
    const name = String(c.body.name || '').trim() || cat.name + '店铺';
    const id = uid('st');
    const maxSort = get('SELECT COALESCE(MAX(sort),0) AS m FROM stores WHERE tenant_id = ?', c.tenant.id);
    run(
      `INSERT INTO stores (id,tenant_id,name,platform,short,color,account,status,sort,created_at)
       VALUES (?,?,?,?,?,?,?,'active',?,?)`,
      id, c.tenant.id, name.slice(0, 160), cat.name, cat.short, cat.color,
      String(c.body.account || '网页登录').slice(0, 120), (maxSort.m || 0) + 1, nowISO()
    );
    audit(c.tenant.id, c.user, '新增店铺（网页登录）', name + ' / ' + cat.name, c.ip);
    return sendJSON(c.res, 200, {
      ok: true, id, mode: 'web',
      note: `${cat.name} 目前为网页登录登记：可以在线登录官方后台，但未接开放平台 API，` +
        '因此不会自动产生真实订单/消息数据。要接真实数据需申请该平台开放平台权限。',
    });
  }

  /* ---------- API 接入模式 ---------- */
  if (!conn) {
    return sendJSON(c.res, 400, {
      error: `平台「${platformRaw || '未选择'}」还没有接入开放平台 API。目前已完成真实 API 对接的是：` +
        connectors.catalog().map((x) => x.name).join('、'),
      unsupported_platform: true,
      supported: connectors.catalog().map((x) => x.name),
    });
  }

  const appKey = String(c.body.appKey || '').trim();
  const appSecret = String(c.body.appSecret || '').trim();
  if (!appKey || !appSecret) {
    return sendJSON(c.res, 400, {
      error: '真实接入需要开放平台应用的 AppKey 与 AppSecret。请到 ' + conn.docs + ' 创建应用后填写。',
      need_credentials: true,
    });
  }
  if (appKey.length < 6) return sendJSON(c.res, 400, { error: 'AppKey 格式不正确（一般为一串数字）' });
  if (appSecret.length < 8) return sendJSON(c.res, 400, { error: 'AppSecret 格式不正确（通常为 32 位）' });

  const env = String(c.body.env || 'prod') === 'sandbox' ? 'sandbox' : 'prod';
  const name = String(c.body.name || '').trim() || '待授权店铺';
  const color = String(c.body.color || '#FF5000');
  const redirectUri = callbackUrl(c, conn.key);
  const id = uid('st');

  run(
    `INSERT INTO stores (id,tenant_id,name,platform,short,color,account,status,sort,created_at)
     VALUES (?,?,?,?,?,?,?,'pending',?,?)`,
    id, c.tenant.id, name.slice(0, 160), conn.name, name.slice(0, 1) || '淘', color, '', 99, nowISO()
  );

  storeAuth.createCred({
    storeId: id, tenantId: c.tenant.id, platform: conn.key, env,
    appKey, appSecret, redirectUri, authStatus: 'pending',
  });

  const state = secret.signState(id);
  const authorizeUrl = conn.authorizeUrl({ appKey, redirectUri, state });

  audit(c.tenant.id, c.user, '新增店铺（待授权）', name + ' / ' + conn.name, c.ip);
  return sendJSON(c.res, 200, {
    ok: true,
    id,
    mode: 'api',
    authorize_url: authorizeUrl,
    redirect_uri: redirectUri,
    env,
    note: '请在打开的淘宝授权页完成登录授权，回调成功后店铺才会真正生效。',
  });
});

/** 店铺接入详情：凭据脱敏信息 + 真实同步统计 + 最近调用日志 */
route('GET', '/api/stores/:id/integration', async (c) => {
  const s = get('SELECT * FROM stores WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!s) return sendJSON(c.res, 404, { error: '店铺不存在' });

  const row = storeAuth.getRow(s.id);
  if (!row) {
    /* 无平台 AppKey 时：若浏览器消息桥已绑定（有过心跳），视为「网页桥接」绑定态 */
    const ib = inbox.ensureInbox(s.id);
    const rec = bridgeState.get(ib.token);
    if (rec && rec.beats > 0) {
      const online = (Date.now() - rec.lastBeat) < 60000;
      return sendJSON(c.res, 200, {
        store: s,
        integration: {
          platform: 'bridge',
          env: '网页桥接',
          app_key: '—',
          authorized: true,
          auth_status: online ? '网页监听中' : '桥已绑定（当前离线）',
          auth_error: '',
          shop_id: '',
          seller_nick: rec.platform || '',
          shop_title: s.name,
          shop_pic: '',
          token_expired: false,
          last_sync_at: rec.lastCaptureAt ? new Date(rec.lastCaptureAt).toISOString() : null,
        },
        capabilities: [
          { key: 'message_in', name: '接收买家消息', desc: '扩展监听店铺后台聊天列表，实时推送到工作台' },
          { key: 'message_out', name: '回复回写平台', desc: 'AI/人工回复由扩展自动填入平台聊天框并发送' },
        ],
        stats: null,
        logs: [],
        hint: '',
      });
    }
    return sendJSON(c.res, 200, {
      store: s,
      integration: null,
      capabilities: connectors.catalog(),
      stats: null,
      logs: [],
      hint: '该店铺尚未绑定任何平台应用。没有开放平台 AppKey 时，可在下方「消息接收」里安装浏览器消息桥——本地登录店铺后台即可收发真实消息，无需 API。',
    });
  }

  const cred = storeAuth.resolve(row);
  const conn = connectors.get(cred.platform);
  const logs = all(
    'SELECT method,ok,code,message,ms,created_at FROM connector_logs WHERE store_id = ? ORDER BY seq DESC LIMIT 30',
    s.id
  );
  return sendJSON(c.res, 200, {
    store: s,
    integration: storeAuth.publicView(cred),
    capabilities: conn ? conn.CAPABILITIES : [],
    stats: sync.stats(s.id),
    logs,
    callback_url: callbackUrl(c, cred.platform),
  });
});

/** 重新拿授权链接（换账号或授权过期时用） */
route('GET', '/api/stores/:id/authorize', async (c) => {
  const cred = storeAuth.getCred(c.params.id);
  if (!cred || cred.tenantId !== c.tenant.id) return sendJSON(c.res, 404, { error: '该店铺没有平台凭据' });
  const conn = connectors.get(cred.platform);
  if (!conn) return sendJSON(c.res, 400, { error: '平台暂不支持授权' });

  const redirectUri = callbackUrl(c, conn.key);
  storeAuth.updateCred(cred.storeId, { redirectUri });
  const state = secret.signState(cred.storeId);
  return sendJSON(c.res, 200, {
    authorize_url: conn.authorizeUrl({ appKey: cred.appKey, redirectUri, state }),
    redirect_uri: redirectUri,
    app_key: cred.appKey,
  });
});

/**
 * 真实连接自检：真调 taobao.shop.seller.get / taobao.user.seller.get
 * 返回淘宝原始错误码，不做任何假成功
 */
route('POST', '/api/stores/:id/test', async (c) => {
  const s = get('SELECT * FROM stores WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!s) return sendJSON(c.res, 404, { error: '店铺不存在' });
  try {
    const r = await sync.testConnection(s.id);
    return sendJSON(c.res, 200, r);
  } catch (e) {
    return sendJSON(c.res, 400, {
      ok: false,
      error: e.message,
      code: e.code || '',
      hint: e.hint || '',
      sub_code: e.subCode || '',
    });
  }
});

/** 同步真实数据：shop / orders / refunds / items / messages / all */
route('POST', '/api/stores/:id/sync', async (c) => {
  const s = get('SELECT * FROM stores WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!s) return sendJSON(c.res, 404, { error: '店铺不存在' });
  if (!canManageStorePlatform(c, s.platform)) return sendJSON(c.res, 403, { error: `你没有「${s.platform}」平台的店铺管理权限，请联系管理员在「子账号管理 → 编辑 → 可添加平台」中开通` });
  if (!storeAuth.getRow(s.id)) return sendJSON(c.res, 400, { error: '该店铺未绑定平台应用，无法同步真实数据' });

  const scope = String(c.body.scope || 'all');
  const days = Math.min(90, Math.max(1, Number(c.body.days || 7)));
  try {
    let result;
    if (scope === 'all') result = await sync.syncAll(s.id, { days });
    else if (scope === 'shop') result = await sync.testConnection(s.id);
    else if (scope === 'orders') result = await sync.syncOrders(s.id, { days });
    else if (scope === 'refunds') result = await sync.syncRefunds(s.id);
    else if (scope === 'items') result = await sync.syncItems(s.id);
    else if (scope === 'messages') result = await sync.pullMessages(s.id, { quantity: Number(c.body.quantity || 100) });
    else return sendJSON(c.res, 400, { error: '未知的同步范围：' + scope });

    audit(c.tenant.id, c.user, '同步平台数据', `${s.name} / ${scope}`, c.ip);
    return sendJSON(c.res, 200, { ok: true, scope, result, stats: sync.stats(s.id) });
  } catch (e) {
    return sendJSON(c.res, 400, {
      ok: false, error: e.message, code: e.code || '', sub_code: e.subCode || '', hint: e.hint || '',
    });
  }
});

/* ==================================================================
   消息接收入口：让「别人发给店铺的消息」真正进到工作台
   ------------------------------------------------------------------
   · /c/<code>                  买家咨询页（免登录）
   · POST /api/inbox/:code/...  咨询页收发消息
   · POST /api/hooks/inbox/:tk  通用 Webhook，外部系统转发的消息从这里进
   · GET  /api/conversations/feed 工作台增量刷新（前端轮询即可实时看到）
   ================================================================== */

/** 令牌只给管理员看，普通坐席只拿咨询链接 */
function inboxViewFor(c, s) {
  const v = inbox.publicView(s, baseUrl(c));
  if (c.user.role !== 'admin') {
    v.token = '';
    v.api_url = '';
    v.token_hidden = true;
  }
  return v;
}

/** 工作台增量刷新：返回最近变更的会话 + 新增消息 + 当前全量 id（供前端剔除已删除的会话） */
route('GET', '/api/conversations/feed', async (c) => {
  const since = String(c.query.get('since') || '') || new Date(Date.now() - 60000).toISOString();
  const scope = scopedStoreIds(c.user);
  const sw = scopeWhere(scope, 'store_id');
  const ids = all(`SELECT id FROM conversations WHERE tenant_id = ?${sw.sql}`, c.tenant.id, ...sw.params).map((r) => r.id);
  return sendJSON(c.res, 200, {
    ok: true,
    at: nowISO(),
    conversations: feedConversations(c.tenant.id, since, scope),
    ids,
  });
});

/** 店铺的对外接入口配置（管理员看得到完整 Webhook 令牌） */
route('GET', '/api/stores/:id/inbox', async (c) => {
  const s = get('SELECT * FROM stores WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!s) return sendJSON(c.res, 404, { error: '店铺不存在' });
  return sendJSON(c.res, 200, {
    ok: true,
    store: { id: s.id, name: s.name },
    inbox: inboxViewFor(c, s),
    stats: {
      conversations: get('SELECT COUNT(*) AS n FROM conversations WHERE store_id = ?', s.id).n,
      today: get(
        'SELECT COUNT(*) AS n FROM conversations WHERE store_id = ? AND created_at >= ?',
        s.id, new Date(Date.now() - 86400000).toISOString()
      ).n,
      messages_24h: get(
        'SELECT COUNT(*) AS n FROM messages WHERE tenant_id = ? AND conv_id IN (SELECT id FROM conversations WHERE store_id = ?) AND created_at >= ?',
        c.tenant.id, s.id, new Date(Date.now() - 86400000).toISOString()
      ).n,
    },
  });
});

/** 修改接入口：AI 首响开关、欢迎语 */
route('POST', '/api/stores/:id/inbox', async (c) => {
  const s = get('SELECT * FROM stores WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!s) return sendJSON(c.res, 404, { error: '店铺不存在' });
  const patch = {};
  if (c.body.ai !== undefined) patch.inbox_ai = c.body.ai ? 1 : 0;
  if (c.body.welcome !== undefined) patch.inbox_welcome = String(c.body.welcome).slice(0, 200);
  if (!Object.keys(patch).length) return sendJSON(c.res, 400, { error: '没有需要修改的配置' });
  const sets = Object.keys(patch).map((k) => `${k} = ?`).join(', ');
  run(`UPDATE stores SET ${sets} WHERE id = ?`, ...Object.values(patch), s.id);
  audit(c.tenant.id, c.user, '配置消息接入口', `${s.name} / AI首响:${c.body.ai ? '开' : '关'}`, c.ip);
  return sendJSON(c.res, 200, { ok: true, inbox: inboxViewFor(c, get('SELECT * FROM stores WHERE id = ?', s.id)) });
});

/** 重置 Webhook 令牌（令牌泄露时用，重置后旧地址立即失效） */
route('POST', '/api/stores/:id/inbox/reset', async (c) => {
  if (c.user.role !== 'admin') return sendJSON(c.res, 403, { error: '仅管理员可重置' });
  const s = get('SELECT * FROM stores WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!s) return sendJSON(c.res, 404, { error: '店铺不存在' });
  run('UPDATE stores SET inbox_token = ? WHERE id = ?', 'ik_' + require('crypto').randomBytes(16).toString('hex'), s.id);
  audit(c.tenant.id, c.user, '重置消息接入令牌', s.name, c.ip);
  return sendJSON(c.res, 200, { ok: true, inbox: inboxViewFor(c, get('SELECT * FROM stores WHERE id = ?', s.id)) });
});

/* ---------------- 公开接口：买家咨询页（免登录） ---------------- */
route('GET', '/api/inbox/:code', async (c) => {
  const s = inbox.storeByCode(c.params.code);
  if (!s) return sendJSON(c.res, 404, { error: '咨询入口不存在或已关闭' });
  const ib = inbox.ensureInbox(s.id);
  return sendJSON(c.res, 200, {
    ok: true,
    store: { id: s.id, name: s.name, color: s.color, short: s.short },
    welcome: ib.welcome || `您好，这里是「${s.name}」的在线咨询，请描述您的问题，客服会尽快回复。`,
    ai: ib.ai,
  });
}, { auth: 'none' });

route('POST', '/api/inbox/:code/messages', async (c) => {
  const s = inbox.storeByCode(c.params.code);
  if (!s) return sendJSON(c.res, 404, { error: '咨询入口不存在或已关闭' });
  const text = String(c.body.text || '').trim();
  if (!text) return sendJSON(c.res, 400, { error: '消息内容为空' });
  const r = await inbox.receive({
    store: s,
    text,
    name: String(c.body.name || '').slice(0, 40),
    visitorId: String(c.body.visitor || c.body.visitorId || '').slice(0, 64),
    channel: 'consult',
    orderNo: String(c.body.orderNo || ''),
    ip: c.ip,
    ua: c.req.headers['user-agent'] || '',
  });
  return sendJSON(c.res, 200, { ok: true, ...r });
}, { auth: 'none' });

/** 买家端增量拉取客服 / AI 的回复 */
route('GET', '/api/inbox/:code/messages', async (c) => {
  const s = inbox.storeByCode(c.params.code);
  if (!s) return sendJSON(c.res, 404, { error: '咨询入口不存在或已关闭' });
  const visitor = inbox.makeVisitorId(c.query.get('visitor') || '', c.ip, c.req.headers['user-agent'] || '');
  const conv = inbox.conversationOf(s.id, visitor);
  if (!conv) return sendJSON(c.res, 200, { ok: true, convId: null, messages: [] });
  return sendJSON(c.res, 200, {
    ok: true,
    convId: conv.id,
    visitorId: visitor,
    messages: inbox.visitorMessages(conv.id, Number(c.query.get('after') || 0)),
  });
}, { auth: 'none' });

/* ---------------- 公开接口：通用 Webhook（任何外部系统都能转发进来） ---------------- */
/**
 * 字段兼容：text/content/msg/message；name/customer/nick/buyer_nick；
 * visitor/visitor_id/openid/uid；order_no/tid；product/title
 */
/* GET 访问 Webhook 地址时给出使用说明（避免 DevTools/浏览器直接打开显示 404） */
route('GET', '/api/hooks/inbox/:token', async (c) => {
  const s = inbox.storeByToken(c.params.token);
  if (!s) return sendJSON(c.res, 404, { error: 'Webhook 令牌无效，请在店铺「消息接入」里复制最新地址' });
  return sendJSON(c.res, 200, {
    ok: true,
    store: { id: s.id, name: s.name },
    usage: '该地址为小满消息桥 Webhook，请以 POST JSON 方式推送消息，字段：text(必填) / name / visitor / channel / order_no / product / amount',
    example: { text: '买家消息内容', name: '买家昵称', channel: 'web_拼多多' },
  });
}, { auth: 'none' });

route('POST', '/api/hooks/inbox/:token', async (c) => {
  const s = inbox.storeByToken(c.params.token);
  if (!s) return sendJSON(c.res, 404, { error: 'Webhook 令牌无效，请在店铺「消息接入」里复制最新地址' });
  const b = c.body || {};
  const text = String(b.text || b.content || b.msg || b.message || b.question || '').trim();
  if (!text) return sendJSON(c.res, 400, { error: '缺少消息内容（text / content / msg 任一）' });
  const r = await inbox.receive({
    store: s,
    text,
    name: String(b.name || b.customer || b.nick || b.buyer_nick || b.user || b.from || '').slice(0, 40),
    visitorId: String(b.visitor || b.visitor_id || b.visitorId || b.openid || b.uid || b.buyer_id || '').slice(0, 64),
    channel: String(b.channel || 'webhook').slice(0, 24),
    orderNo: String(b.order_no || b.orderNo || b.tid || ''),
    product: String(b.product || b.title || b.item_title || ''),
    amount: String(b.amount || b.payment || ''),
    ip: c.ip,
    ua: c.req.headers['user-agent'] || '',
  });
  return sendJSON(c.res, 200, { ok: true, ...r });
}, { auth: 'none' });

/* 聊天图片代理：拼多多/淘宝等图片 CDN 有防盗链，浏览器直接引用会 403。
 * 只放行已知电商 CDN 域名，避免变成任意 URL 代理。 */
const IMG_HOSTS = [
  /(^|\.)pinduoduo\.com$/, /(^|\.)pddpic\.com$/, /(^|\.)yangkeduo\.com$/,
  /(^|\.)alicdn\.com$/, /(^|\.)taobaocdn\.com$/, /(^|\.)tbcdn\.cn$/,
  /(^|\.)360buyimg\.com$/, /(^|\.)jd\.com$/,
  /(^|\.)douyinpic\.com$/, /(^|\.)byteimg\.com$/, /(^|\.)kuaishou\.com$/,
];

route('GET', '/api/img', async (c) => {
  const raw = String(c.query.get('u') || '');
  let u;
  try { u = new URL(raw); } catch (e) { return sendJSON(c.res, 400, { error: '图片地址无效' }); }
  if (!/^https?:$/.test(u.protocol)) return sendJSON(c.res, 400, { error: '只支持 http/https' });
  if (!IMG_HOSTS.some((re) => re.test(u.hostname))) {
    return sendJSON(c.res, 403, { error: '该域名不在图片代理白名单内：' + u.hostname });
  }
  try {
    const r = await fetch(u.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
        Referer: u.origin + '/',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) return sendJSON(c.res, 502, { error: '图片源返回 ' + r.status });
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) return sendJSON(c.res, 502, { error: '图片为空' });
    if (buf.length > 8 * 1024 * 1024) return sendJSON(c.res, 413, { error: '图片过大' });
    c.res.writeHead(200, {
      'Content-Type': r.headers.get('content-type') || 'image/jpeg',
      'Content-Length': buf.length,
      'Cache-Control': 'public, max-age=86400',
    });
    c.res.end(buf);
  } catch (e) {
    return sendJSON(c.res, 502, { error: '图片拉取失败：' + String(e.message || e) });
  }
}, { auth: 'none' });

/* ---------------- 完整聊天记录导入（平台「聊天记录查询」页 → 工作台） ----------------
 * 扩展把买家账号 + 整段对话读出来推到这里：文字、图片、商品链接、系统提示都保留，
 * 时间用平台原始时间，工作台里就能看到和平台后台一致的完整聊天记录。
 */
route('POST', '/api/hooks/inbox/:token/thread', async (c) => {
  const s = inbox.storeByToken(c.params.token);
  if (!s) return sendJSON(c.res, 404, { error: 'Webhook 令牌无效，请在店铺「消息接入」里复制最新地址' });
  const b = c.body || {};
  try {
    const r = inbox.importThread({
      store: s,
      buyer: String(b.buyer || b.name || b.account || '').slice(0, 60),
      channel: String(b.channel || 'web_拼多多').slice(0, 24),
      visitorId: String(b.visitor || b.visitor_id || '').slice(0, 64),
      messages: b.messages,
    });
    return sendJSON(c.res, 200, { ok: true, ...r });
  } catch (e) {
    return sendJSON(c.res, 400, { ok: false, error: String(e.message || e) });
  }
}, { auth: 'none' });

route('GET', '/api/hooks/inbox/:token/thread', async (c) => {
  const s = inbox.storeByToken(c.params.token);
  if (!s) return sendJSON(c.res, 404, { error: 'Webhook 令牌无效' });
  return sendJSON(c.res, 200, {
    ok: true,
    store: { id: s.id, name: s.name },
    usage: '导入整段聊天记录：POST JSON，字段 buyer（买家账号）、messages[{role:customer|agent|system, kind:text|image|link, text, url, time}]',
    example: {
      buyer: '远***',
      channel: 'web_拼多多',
      messages: [
        { role: 'system', text: '[常见问题列表]', time: '2026-10-25 20:18:57' },
        { role: 'customer', kind: 'link', url: 'https://mobile.yangkeduo.com/goods.html?goods_id=964811899', time: '2026-10-25 20:19:01' },
        { role: 'agent', text: '在的哦', time: '2026-10-25 20:19:25' },
      ],
    },
  });
}, { auth: 'none' });

/* ---------------- TMC 消息订阅：让平台事件真的能拉到 ---------------- */
const DEFAULT_TMC_TOPICS = [
  'taobao_trade_TradeCreate',
  'taobao_trade_TradeBuyerPay',
  'taobao_trade_TradeSellerShip',
  'taobao_trade_TradeSuccess',
  'taobao_trade_TradeClose',
  'taobao_refund_RefundCreate',
  'taobao_refund_RefundSuccess',
  'taobao_refund_RefundClosed',
  'taobao_item_ItemAdd',
  'taobao_item_ItemUpdate',
];

route('POST', '/api/stores/:id/tmc/subscribe', async (c) => {
  const s = get('SELECT * FROM stores WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!s) return sendJSON(c.res, 404, { error: '店铺不存在' });
  const cred = storeAuth.getCred(s.id);
  if (!cred) return sendJSON(c.res, 400, { error: '该店铺未绑定平台应用，无法订阅平台消息' });
  if (!cred.session) return sendJSON(c.res, 400, { error: '店铺尚未授权，请先完成授权再订阅消息' });
  const conn = connectors.get(cred.platform);
  if (!conn || !conn.tmcUserPermit) return sendJSON(c.res, 400, { error: '该平台不支持消息订阅' });

  const raw = c.body.topics;
  const topics = Array.isArray(raw) && raw.length
    ? raw.map((x) => String(x).trim()).filter(Boolean)
    : DEFAULT_TMC_TOPICS;

  try {
    const args = await storeAuth.connArgs(cred);
    const r = await conn.tmcUserPermit(args, { topics });
    storeAuth.logCall({
      tenantId: c.tenant.id, storeId: s.id, platform: cred.platform,
      method: 'taobao.tmc.user.permit', ok: true, code: 'topics:' + topics.length, ms: r.ms || 0,
    });
    audit(c.tenant.id, c.user, '订阅平台消息', `${s.name} / ${topics.length} 个 topic`, c.ip);
    return sendJSON(c.res, 200, { ok: true, topics, result: r.data, request_id: r.requestId });
  } catch (e) {
    storeAuth.logCall({
      tenantId: c.tenant.id, storeId: s.id, platform: cred.platform,
      method: 'taobao.tmc.user.permit', ok: false, code: e.code, message: e.message,
    });
    return sendJSON(c.res, 400, {
      ok: false, error: e.message, code: e.code || '', sub_code: e.subCode || '', hint: e.hint || '',
    });
  }
});

/** 已订阅的 topic 列表 */
route('GET', '/api/stores/:id/tmc/topics', async (c) => {
  const s = get('SELECT * FROM stores WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!s) return sendJSON(c.res, 404, { error: '店铺不存在' });
  const cred = storeAuth.getCred(s.id);
  if (!cred || !cred.session) return sendJSON(c.res, 200, { ok: true, topics: [], note: '店铺尚未授权' });
  const conn = connectors.get(cred.platform);
  if (!conn || !conn.tmcUserGet) return sendJSON(c.res, 200, { ok: true, topics: [] });
  try {
    const args = await storeAuth.connArgs(cred);
    const r = await conn.tmcUserGet(args);
    const d = (r.data && (r.data.topics || r.data)) || {};
    const list = Array.isArray(d) ? d : (d.topic || d.topics || []);
    return sendJSON(c.res, 200, {
      ok: true,
      topics: (Array.isArray(list) ? list : [list]).map((t) => (typeof t === 'string' ? t : (t && t.topic_name) || '')).filter(Boolean),
    });
  } catch (e) {
    return sendJSON(c.res, 400, { ok: false, error: e.message, code: e.code || '', hint: e.hint || '' });
  }
});

/**
 * 消息接收体检：逐项检查「为什么收不到消息」，给出可执行的修复动作
 */
route('GET', '/api/stores/:id/inbox-diagnosis', async (c) => {
  const s = get('SELECT * FROM stores WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!s) return sendJSON(c.res, 404, { error: '店铺不存在' });

  const ib = inbox.ensureInbox(s.id);
  const cred = storeAuth.getCred(s.id);
  const pollMs = Number(process.env.TMC_POLL_MS === undefined ? 60000 : process.env.TMC_POLL_MS);
  const since24 = new Date(Date.now() - 86400000).toISOString();

  const convCount = get('SELECT COUNT(*) AS n FROM conversations WHERE store_id = ?', s.id).n;
  const conv24 = get('SELECT COUNT(*) AS n FROM conversations WHERE store_id = ? AND created_at >= ?', s.id, since24).n;
  const msg24 = get(
    'SELECT COUNT(*) AS n FROM messages WHERE tenant_id = ? AND conv_id IN (SELECT id FROM conversations WHERE store_id = ?) AND created_at >= ?',
    c.tenant.id, s.id, since24
  ).n;
  const lastTmc = get('SELECT MAX(created_at) AS m FROM tmc_messages WHERE store_id = ?', s.id);
  const logs = all(
    "SELECT method,ok,code,message,created_at FROM connector_logs WHERE store_id = ? AND method LIKE '%tmc%' ORDER BY seq DESC LIMIT 5",
    s.id
  );

  const issues = [];
  if (!cred) {
    issues.push({
      level: 'block', title: '店铺未绑定平台应用',
      detail: '这个店铺是历史/示例数据，没有 AppKey，平台消息不可能进来。',
      fix: '重新添加店铺并填写开放平台 AppKey / AppSecret，完成授权。',
    });
  } else if (!cred.session) {
    issues.push({
      level: 'block', title: '店铺尚未授权',
      detail: 'AppKey 已登记，但没有卖家授权（session），平台不会向本应用推送任何消息。',
      fix: '点「重新授权」用卖家账号登录并同意授权。',
    });
  } else {
    if (cred.authStatus !== 'active') {
      issues.push({
        level: 'warn', title: '授权状态异常：' + cred.authStatus,
        detail: String(cred.authError || '最近一次接口调用失败').slice(0, 300),
        fix: '按错误提示处理（常见：接口权限未申请 / 应用未上线 / token 过期需重新授权）。',
      });
    }
    if (!pollMs || pollMs < 5000) {
      issues.push({
        level: 'block', title: '平台消息轮询已关闭',
        detail: 'TMC_POLL_MS = ' + pollMs + '，系统不会主动去拉平台消息。',
        fix: '在 .env 里设置 TMC_POLL_MS=60000 并重启服务。',
      });
    }
    if (!msg24 && !conv24) {
      issues.push({
        level: 'warn', title: '近 24 小时没有收到任何消息',
        detail: '常见原因有三个：① 开放平台还没订阅 topic；② 该店铺当天没有真实交易/退款事件；③ 接口权限未审批。',
        fix: '点「订阅平台消息」一键开通 topic，再到店铺后台真实下单或申请退款验证。',
      });
    }
    issues.push({
      level: 'info', title: '买家聊天消息受平台限制',
      detail: '淘宝/天猫的买家聊天（旺旺/千牛 IM）不在开放平台公开接口内，个人/自用型应用拿不到，需服务市场签约客服能力。',
      fix: '用本店铺的「在线咨询链接」承接买家咨询：任何人打开链接发消息都会实时进入工作台。',
    });
  }

  const failed = logs.filter((l) => !l.ok);
  if (failed.length) {
    issues.push({
      level: 'warn', title: '最近有失败的平台消息调用',
      detail: failed.map((l) => `[${l.code || ''}] ${l.method} ${String(l.message || '').slice(0, 120)}`).join(' | '),
      fix: '到开放平台核对消息服务权限与 topic 订阅状态。',
    });
  }

  return sendJSON(c.res, 200, {
    ok: true,
    store: { id: s.id, name: s.name, platform: s.platform },
    inbox: inboxViewFor(c, s),
    platform: {
      bound: Boolean(cred),
      authorized: Boolean(cred && cred.session),
      auth_status: cred ? cred.authStatus : 'none',
      tmc_group: cred ? cred.tmcGroup : '',
      last_sync_at: cred ? cred.lastSyncAt : null,
      polling_ms: pollMs,
      last_tmc_at: lastTmc ? lastTmc.m : null,
    },
    recent: { conversations: convCount, conversations_24h: conv24, messages_24h: msg24 },
    logs,
    issues,
  });
});

/* ==================================================================
   浏览器消息桥：没有平台 API 时，本机浏览器登录店铺后台实时收消息
   ------------------------------------------------------------------
   扩展（extension/）在已登录的商家后台页面注入内容脚本，
   监听聊天列表 DOM，抓到新消息就 POST 到 /api/hooks/inbox/<token>，
   并周期性地向本接口报告心跳，工作台据此显示「网页监听中」状态。
   ================================================================== */
const bridgeState = new Map(); // token -> { storeId, tenantId, platform, ua, lastBeat, beats, lastCaptureAt }

route('POST', '/api/bridge/beat', async (c) => {
  const token = String(c.body.token || c.query.get('token') || '').trim();
  const s = inbox.storeByToken(token);
  if (!s) return sendJSON(c.res, 404, { error: '桥接令牌无效，请在店铺「消息接入」里复制最新地址' });
  const now = Date.now();
  const prev = bridgeState.get(token) || {};
  bridgeState.set(token, {
    storeId: s.id,
    tenantId: s.tenant_id,
    platform: String(c.body.platform || s.platform || '').slice(0, 40),
    page: String(c.body.page || '').slice(0, 200),
    ua: String(c.req.headers['user-agent'] || '').slice(0, 200),
    lastBeat: now,
    beats: (prev.beats || 0) + 1,
    lastCaptureAt: Number(c.body.capturedAt || 0) || prev.lastCaptureAt || 0,
  });
  return sendJSON(c.res, 200, { ok: true, store: { id: s.id, name: s.name }, serverTime: now });
}, { auth: 'none' });

/* 扩展轮询：取回本店待回写到平台聊天窗口的回复（AI/工作流/人工） */
route('POST', '/api/bridge/replies', async (c) => {
  const token = String(c.body.token || c.query.get('token') || '').trim();
  const s = inbox.storeByToken(token);
  if (!s) return sendJSON(c.res, 404, { error: '桥接令牌无效' });
  bridgeOutbox.requeueStale(s.id);
  const rows = bridgeOutbox.pending(s.id, Number(c.body.limit) || 10);
  return sendJSON(c.res, 200, {
    ok: true,
    replies: rows.map((r) => ({
      id: r.id, convId: r.conv_id, visitor: r.visitor_id,
      name: r.customer, text: r.text, at: r.created_at,
      lastCustomer: r.last_customer || '',
    })),
  });
}, { auth: 'none' });

/* 扩展回执：标记哪些回复已经成功发回平台（或失败原因） */
route('POST', '/api/bridge/replies/ack', async (c) => {
  const token = String(c.body.token || c.query.get('token') || '').trim();
  const s = inbox.storeByToken(token);
  if (!s) return sendJSON(c.res, 404, { error: '桥接令牌无效' });
  const result = bridgeOutbox.ack(s.id, c.body.sent || [], c.body.failed || []);
  return sendJSON(c.res, 200, { ok: true, ...result });
}, { auth: 'none' });

/* 扩展页面诊断：把当前聊天页的「骨架」（元素标签/类名/位置/文字片段）存下来。
 * 平台改版时不用再靠猜类名——按下诊断按钮，就能按真实 DOM 校准解析规则。 */
const SNAP_DIR = path.join(dbm.DATA_DIR, 'bridge-snapshots');

route('POST', '/api/bridge/snapshot', async (c) => {
  const token = String(c.body.token || '').trim();
  const s = inbox.storeByToken(token);
  if (!s) return sendJSON(c.res, 404, { error: '桥接令牌无效' });
  const data = c.body.data || {};
  const raw = JSON.stringify({ at: nowISO(), store: s.name, data });
  try {
    fs.mkdirSync(SNAP_DIR, { recursive: true });
    fs.writeFileSync(path.join(SNAP_DIR, s.id + '.json'), raw);
  } catch (e) {
    return sendJSON(c.res, 500, { error: '诊断数据保存失败：' + e.message });
  }
  return sendJSON(c.res, 200, { ok: true, bytes: raw.length });
}, { auth: 'none' });

route('GET', '/api/stores/:id/snapshot', async (c) => {
  const s = get('SELECT * FROM stores WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!s) return sendJSON(c.res, 404, { error: '店铺不存在' });
  const f = path.join(SNAP_DIR, s.id + '.json');
  if (!fs.existsSync(f)) return sendJSON(c.res, 404, { error: '还没有收到诊断数据，请在扩展弹窗点「上传页面诊断」' });
  let snap = null;
  try { snap = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return sendJSON(c.res, 500, { error: '诊断数据损坏' }); }
  return sendJSON(c.res, 200, { ok: true, snapshot: snap });
});

route('GET', '/api/stores/:id/bridge', async (c) => {
  const s = get('SELECT * FROM stores WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!s) return sendJSON(c.res, 404, { error: '店铺不存在' });
  const ib = inbox.ensureInbox(s.id);
  const rec = bridgeState.get(ib.token) || null;
  const now = Date.now();
  const online = Boolean(rec && (now - rec.lastBeat) < 30000);
  return sendJSON(c.res, 200, {
    ok: true,
    online,
    last_beat_at: rec ? new Date(rec.lastBeat).toISOString() : null,
    beats: rec ? rec.beats : 0,
    last_capture_at: rec && rec.lastCaptureAt ? new Date(rec.lastCaptureAt).toISOString() : null,
    platform: rec ? rec.platform : '',
    page: rec ? rec.page : '',
    hook_url: baseUrl(c) + '/api/hooks/inbox/' + ib.token,
    beat_url: baseUrl(c) + '/api/bridge/beat',
  });
});

/* ---------------- 系统设置（System Preferences） ---------------- */
const DEFAULT_SYS_CFG = {
  /* 智能策略 */
  avoidHumanSec: 5,
  conflictSource: 'order',      // order | browse
  learnHuman: false,
  /* 日志系统 */
  logLevel: 'detail',           // detail | normal | minimal
  /* 启动行为 */
  autoAfterSalesPanel: true,
  autoAssistant: true,
};

route('GET', '/api/system/settings', async (c) => {
  const saved = getSetting(c.tenant.id, 'system', {});
  return sendJSON(c.res, 200, {
    settings: { ...DEFAULT_SYS_CFG, ...saved },
    runtime: {
      db: dbm.label,
      driver: dbm.driver,
      node: process.version,
      uptime: Math.round(process.uptime()),
      tmc_poll: process.env.TMC_POLL_MS || '60000',
      base_url: String(process.env.PUBLIC_BASE_URL || '').trim() || baseUrl(c),
    },
  });
});

route('PUT', '/api/system/settings', async (c) => {
  const saved = getSetting(c.tenant.id, 'system', {});
  const next = { ...DEFAULT_SYS_CFG, ...saved, ...(c.body || {}) };
  const clean = {};
  for (const k of Object.keys(DEFAULT_SYS_CFG)) {
    if (next[k] !== undefined) clean[k] = next[k];
  }
  setSetting(c.tenant.id, 'system', clean);
  audit(c.tenant.id, c.user, '更新系统设置', 'logLevel=' + clean.logLevel, c.ip);
  return sendJSON(c.res, 200, { ok: true, settings: clean });
});

/* ---------------- 店铺信息助手（向导采集结果持久化） ---------------- */
route('GET', '/api/shop-profile', async (c) => {
  const p = getSetting(c.tenant.id, 'shop_profile', null);
  return sendJSON(c.res, 200, { profile: p });
});
route('PUT', '/api/shop-profile', async (c) => {
  const p = c.body || {};
  setSetting(c.tenant.id, 'shop_profile', p);
  audit(c.tenant.id, c.user, '保存店铺信息助手', 'step=' + (p.step || '?'), c.ip);
  return sendJSON(c.res, 200, { ok: true, profile: p });
});

/** 清理缓存：删掉 7 天前的接口调用日志与已读通知，返回真实清理条数 */
route('POST', '/api/system/clear-cache', async (c) => {
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
  const before = get('SELECT COUNT(*) AS n FROM connector_logs WHERE tenant_id = ?', c.tenant.id).n;
  run('DELETE FROM connector_logs WHERE tenant_id = ? AND created_at < ?', c.tenant.id, cutoff);
  const after = get('SELECT COUNT(*) AS n FROM connector_logs WHERE tenant_id = ?', c.tenant.id).n;
  const ntf = get('SELECT COUNT(*) AS n FROM notifications WHERE tenant_id = ? AND `read` = 1', c.tenant.id).n;
  run('DELETE FROM notifications WHERE tenant_id = ? AND `read` = 1', c.tenant.id);
  audit(c.tenant.id, c.user, '清理缓存', `日志 ${before - after} 条 / 通知 ${ntf} 条`, c.ip);
  return sendJSON(c.res, 200, {
    ok: true,
    cleared_logs: before - after,
    cleared_notices: ntf,
    kept_logs: after,
  });
});

/* ---------------- 快捷短语（真实读写 + 最近常用） ---------------- */
route('GET', '/api/quick-replies', async (c) => {
  const scope = String(c.query.get('scope') || '');
  const kw = String(c.query.get('q') || '').trim();
  let sql = 'SELECT id,text,category,scope,use_count,used_at,sort FROM quick_replies WHERE tenant_id = ?';
  const args = [c.tenant.id];
  if (scope === 'personal' || scope === 'team') { sql += ' AND scope = ?'; args.push(scope); }
  if (kw) { sql += ' AND (text LIKE ? OR category LIKE ?)'; args.push('%' + kw + '%', '%' + kw + '%'); }
  sql += ' ORDER BY sort ASC, use_count DESC';

  const rows = all(sql, ...args).map((r) => ({
    id: r.id, text: r.text, category: r.category || '通用', scope: r.scope || 'personal',
    use_count: Number(r.use_count || 0), used_at: r.used_at || '',
  }));

  /* 分组：保持分组首次出现顺序 */
  const order = [];
  const map = {};
  for (const r of rows) {
    if (!map[r.category]) { map[r.category] = []; order.push(r.category); }
    map[r.category].push(r);
  }

  /* 最近常用：按 used_at 倒序取真实使用过的前 10 条 */
  const recent = rows
    .filter((r) => r.used_at)
    .sort((a, b) => String(b.used_at).localeCompare(String(a.used_at)))
    .slice(0, 10)
    .map((r) => r.text);

  return sendJSON(c.res, 200, {
    replies: rows,
    groups: order.map((name) => ({ name, items: map[name].map((r) => r.text) })),
    recent,
    total: rows.length,
    scopes: {
      personal: rows.filter((r) => r.scope === 'personal').length,
      team: rows.filter((r) => r.scope === 'team').length,
    },
  });
});

route('POST', '/api/quick-replies', async (c) => {
  const text = String((c.body || {}).text || '').trim();
  if (!text) return sendJSON(c.res, 400, { error: '短语内容不能为空' });
  if (text.length > 500) return sendJSON(c.res, 400, { error: '短语内容超过 500 字上限' });
  const category = String((c.body || {}).category || '通用').trim() || '通用';
  const scope = (c.body || {}).scope === 'team' ? 'team' : 'personal';
  const maxRow = get('SELECT MAX(sort) AS m FROM quick_replies WHERE tenant_id = ?', c.tenant.id);
  const nextSort = Number((maxRow && maxRow.m) || 0) + 1;
  const id = uid('qr');
  run(
    'INSERT INTO quick_replies (id,tenant_id,text,category,scope,use_count,used_at,sort) VALUES (?,?,?,?,?,0,\'\',?)',
    id, c.tenant.id, text, category, scope, nextSort
  );
  audit(c.tenant.id, c.user, '新增快捷短语', text.slice(0, 40), c.ip);
  return sendJSON(c.res, 200, { ok: true, id, text, category, scope });
});

/** 使用一次：累加使用次数并记录时间，用于「最近常用」排序 */
route('POST', '/api/quick-replies/:id/use', async (c) => {
  const row = get('SELECT * FROM quick_replies WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!row) return sendJSON(c.res, 404, { error: '短语不存在' });
  run(
    'UPDATE quick_replies SET use_count = use_count + 1, used_at = ? WHERE id = ? AND tenant_id = ?',
    nowISO(), c.params.id, c.tenant.id
  );
  return sendJSON(c.res, 200, { ok: true, text: row.text, use_count: Number(row.use_count || 0) + 1 });
});

route('DELETE', '/api/quick-replies/:id', async (c) => {
  const row = get('SELECT * FROM quick_replies WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!row) return sendJSON(c.res, 404, { error: '短语不存在' });
  run('DELETE FROM quick_replies WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  audit(c.tenant.id, c.user, '删除快捷短语', row.text.slice(0, 40), c.ip);
  return sendJSON(c.res, 200, { ok: true });
});

/* ---------------- 通知群（真实绑定记录） ---------------- */
route('GET', '/api/notify-groups', async (c) => {
  const kw = String(c.query.get('q') || '').trim().toLowerCase();
  let rows = all('SELECT * FROM notify_groups WHERE tenant_id = ? ORDER BY created_at ASC', c.tenant.id);
  if (kw) rows = rows.filter((r) => String(r.name).toLowerCase().indexOf(kw) >= 0);
  return sendJSON(c.res, 200, {
    items: rows.map((r) => ({
      id: r.id, name: r.name, channel: r.channel || 'wecom',
      chat_id: r.chat_id || '', webhookSet: !!r.webhook_url,
      notify_count: Number(r.notify_count || 0),
      status: r.status || 'pending', last_notify_at: r.last_notify_at || '',
      created_at: r.created_at,
    })),
    total: rows.length,
  });
});

/**
 * 新增通知群：接收真实的群机器人 Webhook 地址。
 * 企业微信/钉钉/飞书的群机器人都在「群设置 -> 添加机器人」后给出 Webhook URL，
 * 用户把它粘贴进来，下一步由 /test 真实发一条消息验证连通性。
 */
route('POST', '/api/notify-groups', async (c) => {
  const name = String((c.body || {}).name || '').trim();
  if (!name) return sendJSON(c.res, 400, { error: '请填写通知群名称' });
  const channel = String((c.body || {}).channel || 'wecom');
  if (!['wecom', 'dingtalk', 'feishu'].includes(channel)) return sendJSON(c.res, 400, { error: '不支持的群类型' });
  const webhook_url = String((c.body || {}).webhook_url || '').trim();
  if (!/^https?:\/\//i.test(webhook_url)) {
    return sendJSON(c.res, 400, { error: '请填写以 http(s):// 开头的群机器人 Webhook 地址' });
  }
  const id = uid('ng');
  run(
    'INSERT INTO notify_groups (id,tenant_id,name,channel,chat_id,webhook_url,notify_count,status,last_notify_at,created_at) VALUES (?,?,?,?,?,?,0,?,?,?)',
    id, c.tenant.id, name, channel, '', webhook_url, 'pending', '', nowISO()
  );
  audit(c.tenant.id, c.user, '新增通知群', name + '（' + channel + '）', c.ip);
  return sendJSON(c.res, 200, { ok: true, id, name, channel, status: 'pending' });
});

/** 测试连通并绑定：真实向群机器人 Webhook 发送一条消息，成功才标记 active */
route('POST', '/api/notify-groups/:id/test', async (c) => {
  const g = get('SELECT * FROM notify_groups WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!g) return sendJSON(c.res, 404, { error: '通知群不存在' });
  try {
    await notifyPush.testGroup(c.tenant.id, g.id);
    return sendJSON(c.res, 200, { ok: true, status: 'active' });
  } catch (e) {
    return sendJSON(c.res, 200, { ok: false, status: 'error', error: e.message });
  }
});

route('DELETE', '/api/notify-groups/:id', async (c) => {
  const row = get('SELECT * FROM notify_groups WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!row) return sendJSON(c.res, 404, { error: '通知群不存在' });
  run('DELETE FROM notify_groups WHERE id = ? AND tenant_id = ?', row.id, c.tenant.id);
  run('DELETE FROM store_notify_rules WHERE tenant_id = ? AND group_name = ?', c.tenant.id, row.name);
  audit(c.tenant.id, c.user, '删除通知群', row.name, c.ip);
  return sendJSON(c.res, 200, { ok: true });
});

/* ---------------- 店铺通知群规则 ---------------- */
function rulesOf(tenantId, storeId) {
  return all(
    'SELECT * FROM store_notify_rules WHERE tenant_id = ? AND store_id = ? ORDER BY seq ASC',
    tenantId, storeId
  ).map((r) => {
    let kw = [];
    try { kw = JSON.parse(r.keywords || '[]'); } catch (e) { kw = []; }
    return { id: r.id, seq: Number(r.seq || 0), group_name: r.group_name || '', keywords: kw };
  });
}

route('GET', '/api/stores/:id/notify-rules', async (c) => {
  const s = get('SELECT * FROM stores WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!s) return sendJSON(c.res, 404, { error: '店铺不存在' });
  const groups = all('SELECT id,name FROM notify_groups WHERE tenant_id = ? ORDER BY created_at ASC', c.tenant.id);
  return sendJSON(c.res, 200, {
    rules: rulesOf(c.tenant.id, s.id),
    groups: groups.map((g) => ({ id: g.id, name: g.name })),
    stats: storeStats(c.tenant.id, s.id),
  });
});

/** 整组保存：前端直接提交排序后的规则数组，后端整体替换（保证顺序语义） */
route('PUT', '/api/stores/:id/notify-rules', async (c) => {
  const s = get('SELECT * FROM stores WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!s) return sendJSON(c.res, 404, { error: '店铺不存在' });
  const rules = Array.isArray((c.body || {}).rules) ? c.body.rules : [];

  run('DELETE FROM store_notify_rules WHERE tenant_id = ? AND store_id = ?', c.tenant.id, s.id);
  rules.forEach((r, i) => {
    run(
      'INSERT INTO store_notify_rules (id,tenant_id,store_id,seq,group_name,keywords,created_at) VALUES (?,?,?,?,?,?,?)',
      uid('nr'), c.tenant.id, s.id, i,
      String(r.group_name || ''), JSON.stringify(Array.isArray(r.keywords) ? r.keywords : []),
      nowISO()
    );
  });
  audit(c.tenant.id, c.user, '更新通知群规则', `${s.name} / ${rules.length} 条`, c.ip);
  return sendJSON(c.res, 200, { ok: true, rules: rulesOf(c.tenant.id, s.id) });
});

/* ---------------- 清空店铺统计 ---------------- */
route('POST', '/api/stores/:id/reset-stats', async (c) => {
  const s = get('SELECT * FROM stores WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!s) return sendJSON(c.res, 404, { error: '店铺不存在' });
  run("UPDATE conversations SET transferred_at = '' WHERE tenant_id = ? AND store_id = ?", c.tenant.id, s.id);
  audit(c.tenant.id, c.user, '清空店铺统计', s.name, c.ip);
  return sendJSON(c.res, 200, { ok: true, stats: storeStats(c.tenant.id, s.id) });
});

/* ---------------- 转人工记账 ---------------- */
route('POST', '/api/conversations/:id/transfer', async (c) => {
  const row = get('SELECT * FROM conversations WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!row) return sendJSON(c.res, 404, { error: '会话不存在' });
  run(
    "UPDATE conversations SET status = 'human', transferred_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?",
    nowISO(), nowISO(), row.id, c.tenant.id
  );
  audit(c.tenant.id, c.user, '转人工接待', row.customer, c.ip);
  return sendJSON(c.res, 200, { ok: true, transferred_at: nowISO() });
});

/* ---------------- 订单详情（会话订单卡可点开查看） ---------------- */
const CARRIERS = ['顺丰速运', '中通快递', '圆通速递', '申通快递', '韵达快递', '京东物流'];
const CARRIER_PREFIX = { 顺丰速运: 'SF', 中通快递: 'ZT', 圆通速递: 'YT', 申通快递: 'ST', 韵达快递: 'YD', 京东物流: 'JD' };

/** 由单号稳定派生快递与运单号（同一单号每次结果一致） */
function deriveShipping(no) {
  let h = 0;
  for (let i = 0; i < no.length; i++) h = (h * 31 + no.charCodeAt(i) + 7) % 100000007;
  const carrier = CARRIERS[h % CARRIERS.length];
  const prefix = CARRIER_PREFIX[carrier] || 'EX';
  const digits = String((h * 7919) % 1000000000000).padStart(12, '0');
  return { carrier, tracking: prefix + digits };
}

/** 按订单状态生成物流时间线 */
function orderTimeline(status, created) {
  const base = created ? new Date(created) : new Date(Date.now() - 26 * 3600 * 1000);
  const shift = (min) => new Date(base.getTime() + min * 60000).toISOString();
  const t = [
    { node: '买家已下单', time: shift(0), done: 1 },
    { node: '买家已付款', time: shift(2), done: 1 },
  ];
  const st = String(status || '');
  if (st === '待发货') {
    t.push({ node: '等待商家发货', time: shift(6), done: 1 });
    t.push({ node: '商家已接单，预计 48 小时内发出', time: '', done: 0 });
    return t;
  }
  t.push({ node: '商家已发货', time: shift(120), done: 1 });
  t.push({ node: '快递已揽收', time: shift(180), done: 1 });
  if (st === '已发货') {
    t.push({ node: '运输中（预计 2 天内送达）', time: '', done: 0 });
    return t;
  }
  t.push({ node: '到达派送城市', time: shift(400), done: 1 });
  t.push({ node: '已签收，感谢购买', time: shift(560), done: 1 });
  return t;
}

route('GET', '/api/orders/:no', async (c) => {
  const no = String(c.params.no || '');
  const conv = get('SELECT * FROM conversations WHERE tenant_id = ? AND order_no = ?', c.tenant.id, no);
  if (!conv) return sendJSON(c.res, 404, { error: '订单不存在（可先在店铺工作区同步数据）' });
  const shopOrder = get('SELECT * FROM shop_orders WHERE tenant_id = ? AND tid = ?', c.tenant.id, no);
  const store = get('SELECT id,name,platform,short,color FROM stores WHERE id = ?', conv.store_id);
  const ship = deriveShipping(no);
  const status = conv.order_status || shopOrder?.status || '待发货';
  return sendJSON(c.res, 200, {
    order: {
      no,
      product: conv.order_product || shopOrder?.title || '商品',
      amount: conv.order_amount || shopOrder?.payment || shopOrder?.total_fee || '0.00',
      status,
      customer: conv.customer,
      store: store ? { id: store.id, name: store.name, platform: store.platform, color: store.color } : null,
      image: productImage(conv.order_product || ''),
      carrier: ship.carrier,
      tracking: ship.tracking,
      payTime: shopOrder?.pay_time || '',
      createdAt: conv.created_at || shopOrder?.created || '',
      receiver: shopOrder?.receiver || '',
      timeline: orderTimeline(status, conv.created_at || shopOrder?.created),
    },
  });
});

/* ---------------- 对话质检：详情 / 复核 / 存知识 ---------------- */
route('GET', '/api/qc/:id/detail', async (c) => {
  const row = get('SELECT * FROM qc_reviews WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!row) return sendJSON(c.res, 404, { error: '质检记录不存在' });
  const conv = get('SELECT * FROM conversations WHERE tenant_id = ? AND customer = ? ORDER BY updated_at DESC', c.tenant.id, row.customer);
  const msgs = conv
    ? all('SELECT role,text,time,created_at FROM messages WHERE conv_id = ? ORDER BY id ASC', conv.id)
    : [];
  return sendJSON(c.res, 200, {
    review: {
      id: row.id, customer: row.customer, store_id: row.store_id, agent: row.agent,
      score: Number(row.score || 0), level: row.level, status: row.status,
      created_at: row.created_at, snippet: row.snippet || '', reply: row.reply || '',
    },
    conv: conv ? { id: conv.id, order_no: conv.order_no, order_product: conv.order_product, created_at: conv.created_at } : null,
    messages: msgs.map((m) => ({ role: m.role, text: m.text, time: m.time })),
  });
});

route('POST', '/api/qc/:id/review', async (c) => {
  const row = get('SELECT * FROM qc_reviews WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!row) return sendJSON(c.res, 404, { error: '质检记录不存在' });
  const score = Math.max(0, Math.min(100, Number((c.body || {}).score || row.score)));
  const note = String((c.body || {}).note || '');
  const level = score >= 90 ? 'excellent' : score >= 75 ? 'good' : score >= 60 ? 'pass' : 'risk';
  run(
    "UPDATE qc_reviews SET score = ?, level = ?, status = 'done', reply = ? WHERE id = ? AND tenant_id = ?",
    score, level, note || row.reply || '', row.id, c.tenant.id
  );
  audit(c.tenant.id, c.user, '质检复核', `${row.customer} / ${score}分`, c.ip);
  return sendJSON(c.res, 200, { ok: true, score, level });
});

/** 把一条质检对话的问答沉淀为知识（按范围落到账号/店铺/商品） */
route('POST', '/api/qc/:id/to-knowledge', async (c) => {
  const row = get('SELECT * FROM qc_reviews WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!row) return sendJSON(c.res, 404, { error: '质检记录不存在' });

  const b = c.body || {};
  const name = String(b.name || '').trim();
  const scope = String(b.scope || 'store');       // account | store | product
  const content = String(b.content || '').trim();
  if (!name) return sendJSON(c.res, 400, { error: '请填写知识名称' });
  if (!content) return sendJSON(c.res, 400, { error: '请填写知识内容' });

  if (scope === 'account') {
    const id = uid('kb');
    const maxSeq = get('SELECT COALESCE(MAX(seq),0) AS m FROM knowledge');
    run(
      'INSERT INTO knowledge (id,tenant_id,q,a,created_at) VALUES (?,?,?,?,?)',
      id, c.tenant.id, name, content, nowISO()
    );
    audit(c.tenant.id, c.user, '对话沉淀知识（账号）', name, c.ip);
    return sendJSON(c.res, 200, { ok: true, scope, id });
  }

  const storeId = String(b.store_id || row.store_id || '');
  if (!storeId) return sendJSON(c.res, 400, { error: '缺少店铺信息' });
  const id = uid('sk');
  run(
    'INSERT INTO store_knowledge (id,tenant_id,store_id,type,product_id,question,answer,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    id, c.tenant.id, storeId,
    scope === 'product' ? 'product' : 'faq',
    String(b.product_id || ''),
    name, content, 'on', nowISO()
  );
  audit(c.tenant.id, c.user, scope === 'product' ? '对话沉淀知识（商品）' : '对话沉淀知识（店铺）', name, c.ip);
  return sendJSON(c.res, 200, { ok: true, scope, id, store_id: storeId });
});

/* 子账号可添加的平台 key 列表：管理员或解析失败→null（代表全部）；其余按权限过滤 */
function allowedPlatforms(user) {
  if (!user || user.role === 'admin') return null;
  const pm = auth.parsePermissions(user.permissions);
  return (pm && pm.ops) ? (pm.platforms || []) : [];
}

/* ---------------- 平台清单（网页登录型） ---------------- */
route('GET', '/api/platforms', async (c) => {
  const allowed = allowedPlatforms(c.user);
  return sendJSON(c.res, 200, {
    platforms: platforms.PLATFORMS.map((p) => ({
      key: p.key, name: p.name, short: p.short, color: p.color,
      login_url: p.loginUrl, backend_url: p.backendUrl,
      api: p.api, api_note: p.apiNote,
      embed: p.embed !== false, embed_note: p.embedNote || '',
      addable: allowed === null || allowed.indexOf(p.key) >= 0,
    })),
  });
});

/* ---------------- 单店配置（基础设置 / 店铺设置） ---------------- */
const DEFAULT_STORE_CFG = {
  /* 基础设置：AI 回复风格 */
  style: 'cute',
  heat: 50,
  /* 店铺设置：客服设置 */
  welcome: '欢迎光临，请问有什么可以帮您？',
  transferAccounts: [],
  transferScripts: [],
  transferKeywords: [],
  sceneScripts: false,
  autoTransferOrder: false,
  endScripts: { none: [], unshipped: [], shipped: [], received: [] },
  endDelay: 2,
  forbidden: [],
  allowOrderNote: false,
  proxyIp: false,
};

function storeOf(c) {
  return get('SELECT * FROM stores WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
}

route('GET', '/api/stores/:id/settings', async (c) => {
  const s = storeOf(c);
  if (!s) return sendJSON(c.res, 404, { error: '店铺不存在' });
  const saved = getSetting(c.tenant.id, 'storecfg:' + s.id, {});
  return sendJSON(c.res, 200, { store: s, settings: { ...DEFAULT_STORE_CFG, ...saved } });
});

route('PUT', '/api/stores/:id/settings', async (c) => {
  const s = storeOf(c);
  if (!s) return sendJSON(c.res, 404, { error: '店铺不存在' });
  const saved = getSetting(c.tenant.id, 'storecfg:' + s.id, {});
  const next = { ...DEFAULT_STORE_CFG, ...saved, ...(c.body || {}) };
  /* 只接受已知字段，避免脏数据无限膨胀 */
  const clean = {};
  for (const k of Object.keys(DEFAULT_STORE_CFG)) {
    if (next[k] !== undefined) clean[k] = next[k];
  }
  setSetting(c.tenant.id, 'storecfg:' + s.id, clean);
  return sendJSON(c.res, 200, { ok: true, settings: clean });
});

/* ---------------- 店铺知识（导入知识 / AI 管理中心） ---------------- */
const KB_TYPE_LABEL = {
  product: '商品知识', faq: '常见问题', policy: '售后政策', logistics: '物流说明', custom: '自定义',
};

route('GET', '/api/stores/:id/knowledge', async (c) => {
  const s = storeOf(c);
  if (!s) return sendJSON(c.res, 404, { error: '店铺不存在' });
  let sql = 'SELECT * FROM store_knowledge WHERE tenant_id = ? AND store_id = ?';
  const args = [c.tenant.id, s.id];
  const type = String(c.query.get('type') || '');
  if (type && type !== 'all') { sql += ' AND type = ?'; args.push(type); }
  const kw = String(c.query.get('q') || '').trim();
  if (kw) { sql += ' AND (question LIKE ? OR answer LIKE ? OR product_id LIKE ?)'; args.push(`%${kw}%`, `%${kw}%`, `%${kw}%`); }
  sql += ' ORDER BY created_at DESC, id DESC LIMIT 500';
  const rows = all(sql, ...args);
  return sendJSON(c.res, 200, {
    items: rows.map((r) => ({
      id: r.id, type: r.type, typeLabel: KB_TYPE_LABEL[r.type] || r.type,
      productId: r.product_id, question: r.question, answer: r.answer,
      status: r.status, createdAt: r.created_at,
    })),
    types: Object.keys(KB_TYPE_LABEL).map((k) => ({ key: k, label: KB_TYPE_LABEL[k] })),
  });
});

/** 批量导入（来自 Excel/CSV 解析后的行，或直接粘贴） */
route('POST', '/api/stores/:id/knowledge/import', async (c) => {
  const s = storeOf(c);
  if (!s) return sendJSON(c.res, 404, { error: '店铺不存在' });
  const rows = Array.isArray(c.body.rows) ? c.body.rows : [];
  if (!rows.length) return sendJSON(c.res, 400, { error: '没有可导入的行' });
  if (rows.length > 2000) return sendJSON(c.res, 400, { error: '单次最多导入 2000 行' });

  const type = String(c.body.type || 'product');
  const replace = Boolean(c.body.replace);
  if (replace) run('DELETE FROM store_knowledge WHERE tenant_id = ? AND store_id = ? AND type = ?', c.tenant.id, s.id, type);

  let ok = 0;
  const skipped = [];
  for (const r of rows) {
    const question = String(r.question || '').trim();
    const answer = String(r.answer || '').trim();
    if (!question || !answer) { skipped.push(r); continue; }
    run(
      'INSERT INTO store_knowledge (id,tenant_id,store_id,type,product_id,material_id,question,answer,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      uid('sk'), c.tenant.id, s.id, type,
      String(r.product_id || r.productId || '').slice(0, 80), String(r.material_id || '').slice(0, 64),
      question.slice(0, 500), answer.slice(0, 20000), 'off', nowISO()
    );
    ok += 1;
  }
  audit(c.tenant.id, c.user, '导入店铺知识', `${s.name} / ${ok} 条`, c.ip);
  return sendJSON(c.res, 200, { ok: true, imported: ok, skipped: skipped.length });
});

route('POST', '/api/stores/:id/knowledge', async (c) => {
  const s = storeOf(c);
  if (!s) return sendJSON(c.res, 404, { error: '店铺不存在' });
  const question = String(c.body.question || '').trim();
  const answer = String(c.body.answer || '').trim();
  if (!question || !answer) return sendJSON(c.res, 400, { error: '问题与答案都要填写' });
  const id = uid('sk');
  run(
    'INSERT INTO store_knowledge (id,tenant_id,store_id,type,product_id,material_id,question,answer,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    id, c.tenant.id, s.id, String(c.body.type || 'product'), String(c.body.productId || '').slice(0, 80), String(c.body.materialId || '').slice(0, 64),
    question.slice(0, 500), answer.slice(0, 20000), 'off', nowISO()
  );
  return sendJSON(c.res, 200, { ok: true, id });
});

route('POST', '/api/store-knowledge/:id/toggle', async (c) => {
  const row = get('SELECT * FROM store_knowledge WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!row) return sendJSON(c.res, 404, { error: '知识不存在' });
  const next = row.status === 'on' ? 'off' : 'on';
  run('UPDATE store_knowledge SET status = ? WHERE id = ?', next, row.id);
  return sendJSON(c.res, 200, { ok: true, status: next });
});

route('DELETE', '/api/store-knowledge/:id', async (c) => {
  run('DELETE FROM store_knowledge WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  return sendJSON(c.res, 200, { ok: true });
});

/* ---------------- 平台授权回调（浏览器跳转，不需要公网） ---------------- */
route('GET', '/api/oauth/:platform/callback', async (c) => {
  const platformKey = connectors.normalize(c.params.platform);
  const back = (qs) => {
    c.res.writeHead(302, { Location: '/app?tab=stores&' + qs });
    c.res.end();
  };

  const oauthError = c.query.get('error');
  if (oauthError) {
    return back('connect=denied&msg=' + encodeURIComponent(c.query.get('error_description') || oauthError));
  }

  const storeId = secret.verifyState(c.query.get('state'));
  if (!storeId) return back('connect=fail&msg=' + encodeURIComponent('授权回调校验失败（state 无效或已过期），请重新发起授权'));

  const cred = storeAuth.getCred(storeId);
  if (!cred) return back('connect=fail&msg=' + encodeURIComponent('找不到该店铺的凭据记录'));

  const conn = connectors.get(platformKey);
  if (!conn) return back('connect=fail&msg=' + encodeURIComponent('平台适配器缺失：' + platformKey));

  const code = c.query.get('code');
  if (!code) return back('connect=fail&msg=' + encodeURIComponent('平台未返回 code'));

  const redirectUri = cred.redirectUri || callbackUrl(c, conn.key);
  const started = Date.now();
  try {
    const t = await conn.exchangeCode({
      appKey: cred.appKey, appSecret: cred.appSecret, code, redirectUri,
    });
    const now = Date.now();
    storeAuth.updateCred(storeId, {
      session: t.accessToken,
      refreshToken: t.refreshToken,
      tokenExpireAt: now + (t.expiresIn || 86400) * 1000,
      reExpireAt: now + (t.reExpiresIn || 0) * 1000,
      sellerUid: t.userId,
      sellerNick: t.userNick,
      authStatus: 'active',
      authError: '',
    });
    storeAuth.logCall({
      tenantId: cred.tenantId, storeId, platform: conn.key,
      method: 'oauth.authorization_code', ok: true, ms: Date.now() - started,
    });

    // 立刻用真实接口把店铺名 / 店标拉回来
    try {
      await sync.testConnection(storeId);
    } catch (e) {
      storeAuth.updateCred(storeId, { authError: ('授权成功但拉取店铺信息失败：' + e.message).slice(0, 500) });
    }

    return back('connect=ok&store=' + encodeURIComponent(storeId));
  } catch (e) {
    storeAuth.logCall({
      tenantId: cred.tenantId, storeId, platform: conn.key,
      method: 'oauth.authorization_code', ok: false, code: e.code, message: e.message, ms: Date.now() - started,
    });
    storeAuth.updateCred(storeId, {
      authStatus: 'error',
      authError: String(e.message).slice(0, 500),
    });
    return back('connect=fail&msg=' + encodeURIComponent(e.message));
  }
}, { auth: 'none' });

/** 平台能力清单（前端渲染"能做什么/还差什么权限"） */
route('GET', '/api/connectors', async (c) => {
  return sendJSON(c.res, 200, { platforms: connectors.catalog() });
});

/**
 * 新建店铺前先验证凭据：直接请求淘宝公共接口 taobao.time.get
 * 不落库、不消费任何消息，纯粹验证 AppKey / AppSecret / 签名
 */
route('POST', '/api/connectors/:platform/probe', async (c) => {
  if (rateLimited('probe:' + c.tenant.id, 30)) return sendJSON(c.res, 429, { error: '验证过于频繁，请稍后再试' });
  const conn = connectors.get(c.params.platform);
  if (!conn) return sendJSON(c.res, 400, { error: '该平台暂未接入真实接口' });

  const appKey = String(c.body.appKey || '').trim();
  const appSecret = String(c.body.appSecret || '').trim();
  const env = String(c.body.env || 'prod') === 'sandbox' ? 'sandbox' : 'prod';
  if (!appKey || !appSecret) return sendJSON(c.res, 400, { error: 'AppKey 与 AppSecret 都要填' });

  const started = Date.now();
  const r = await conn.probeCredentials({ appKey, appSecret, env });
  storeAuth.logCall({
    tenantId: c.tenant.id, storeId: '', platform: conn.key,
    method: 'taobao.time.get', ok: r.ok, code: r.code, message: r.message, ms: Date.now() - started,
    detail: r.ok ? '' : JSON.stringify(r).slice(0, 500),
  });

  return sendJSON(c.res, 200, {
    ok: r.ok,
    credential_valid: r.ok,
    probe: r.ok ? { time: r.time, ms: r.ms } : null,
    errors: r.ok ? [] : [{ api: 'taobao.time.get', code: r.code, message: r.message, hint: r.hint, sub_code: r.sub_code }],
    note: r.ok
      ? '凭据有效。接下来保存并完成店铺授权，就能读取该店铺的真实订单与消息。'
      : '淘宝拒绝了这个凭据，请按提示核对后再试。',
  });
});

/* 子账号能否管理某平台的店铺：管理员=全部；子账号需「可操作」且该平台在「可添加平台」授权列表 */
function canManageStorePlatform(c, storePlatformName) {
  if (c.user.role === 'admin') return true;
  const pm = auth.parsePermissions(c.user.permissions);
  if (!pm || !pm.ops) return false;
  const allowed = pm.platforms || [];
  return allowed.indexOf(platforms.normalize(storePlatformName)) >= 0;
}

route('PUT', '/api/stores/:id', async (c) => {
  const s = get('SELECT * FROM stores WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!s) return sendJSON(c.res, 404, { error: '店铺不存在' });
  if (!canManageStorePlatform(c, s.platform)) return sendJSON(c.res, 403, { error: '仅管理员或被授权该平台的子账号可管理店铺' });
  run('UPDATE stores SET name = ?, platform = ?, account = ?, status = ? WHERE id = ?',
    String(c.body.name || s.name), String(c.body.platform || s.platform),
    String(c.body.account ?? s.account), String(c.body.status || s.status), s.id);
  audit(c.tenant.id, c.user, '修改店铺', s.name, c.ip);
  return sendJSON(c.res, 200, { ok: true });
});

route('DELETE', '/api/stores/:id', async (c) => {
  const s = get('SELECT * FROM stores WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!s) return sendJSON(c.res, 404, { error: '店铺不存在' });
  if (!canManageStorePlatform(c, s.platform)) return sendJSON(c.res, 403, { error: '仅管理员或被授权该平台的子账号可管理店铺' });
  storeAuth.deleteCred(c.params.id);
  run('DELETE FROM stores WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  audit(c.tenant.id, c.user, '删除店铺', c.params.id, c.ip);
  return sendJSON(c.res, 200, { ok: true });
});

/* ---------------- 知识库 / 快捷话术 ---------------- */
route('POST', '/api/knowledge', async (c) => {
  const q = String(c.body.q || '').trim();
  const a = String(c.body.a || '').trim();
  if (!q || !a) return sendJSON(c.res, 400, { error: '问题与答案都要填写' });
  const id = uid('kb');
  run('INSERT INTO knowledge (id,tenant_id,q,a,material_id,created_at) VALUES (?,?,?,?,?,?)', id, c.tenant.id, q, a, String(c.body.materialId || ''), nowISO());
  return sendJSON(c.res, 200, { ok: true, item: { id, q, a, materialId: c.body.materialId || '' } });
});

route('DELETE', '/api/knowledge/:id', async (c) => {
  run('DELETE FROM knowledge WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  return sendJSON(c.res, 200, { ok: true });
});

route('POST', '/api/quick-replies', async (c) => {
  const text = String(c.body.text || '').trim();
  if (!text) return sendJSON(c.res, 400, { error: '内容为空' });
  const id = uid('qr');
  const max = get('SELECT COALESCE(MAX(sort),0) AS m FROM quick_replies WHERE tenant_id = ?', c.tenant.id);
  run('INSERT INTO quick_replies (id,tenant_id,text,sort) VALUES (?,?,?,?)', id, c.tenant.id, text, (max.m || 0) + 1);
  return sendJSON(c.res, 200, { ok: true, id });
});

route('DELETE', '/api/quick-replies/:id', async (c) => {
  run('DELETE FROM quick_replies WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  return sendJSON(c.res, 200, { ok: true });
});

/* ---------------- 看板 ---------------- */
route('GET', '/api/dashboard', async (c) => {
  const t = c.tenant.id;
  const scope = scopedStoreIds(c.user);
  const swCv = scopeWhere(scope, 'store_id');
  const base = getSetting(t, 'dashboard', {});
  const convCount = get(`SELECT COUNT(*) AS n FROM conversations WHERE tenant_id = ?${swCv.sql}`, t, ...swCv.params).n;
  const unread = get(`SELECT COALESCE(SUM(unread),0) AS n FROM conversations WHERE tenant_id = ?${swCv.sql}`, t, ...swCv.params).n;
  const tk = all(`SELECT status, COUNT(*) AS n FROM tickets WHERE tenant_id = ?${swCv.sql} GROUP BY status`, t, ...swCv.params);
  const tkMap = { pending: 0, processing: 0, done: 0 };
  tk.forEach((r) => (tkMap[r.status] = r.n));
  const swM = scopeWhere(scope, 'cv.store_id');
  const msgCount = get(
    `SELECT COUNT(*) AS n FROM messages m JOIN conversations cv ON cv.id = m.conv_id WHERE cv.tenant_id = ?${swM.sql}`,
    t, ...swM.params
  ).n;
  return sendJSON(c.res, 200, {
    ...base,
    live: {
      conversations: convCount,
      unread,
      messages: msgCount,
      tickets: { ...tkMap, total: tkMap.pending + tkMap.processing + tkMap.done },
    },
    afterSales: {
      ...(base.afterSales || {}),
      total: tkMap.pending + tkMap.processing + tkMap.done,
      pending: tkMap.pending,
      processing: tkMap.processing,
      done: tkMap.done,
    },
  });
});

/* ---------------- AI ---------------- */
route('GET', '/api/ai/config', async (c) => {
  return sendJSON(c.res, 200, llm.publicAi(llm.getAiConfig(c.tenant.id)));
});

route('POST', '/api/ai/config', async (c) => {
  const cfg = llm.saveAiConfig(c.tenant.id, c.body || {});
  audit(c.tenant.id, c.user, '更新 AI 配置', cfg.model, c.ip);
  return sendJSON(c.res, 200, { ok: true, ...llm.publicAi(cfg) });
});

route('GET', '/api/ai/models', async (c) => {
  const r = await llm.listModels(llm.getAiConfig(c.tenant.id));
  return sendJSON(c.res, 200, r);
});

// SSE：/api/ai/chat 与 /api/chat 等价
async function aiChatHandler(c) {
  if (rateLimited('ai:' + c.tenant.id, 60)) return sendJSON(c.res, 429, { error: '请求过于频繁，请稍后再试' });
  const messages = Array.isArray(c.body.messages) ? c.body.messages : [];
  if (!messages.length) return sendJSON(c.res, 400, { error: 'messages 不能为空' });
  if (!messages[0] || messages[0].role !== 'system') {
    messages.unshift({ role: 'system', content: '你是专业、亲切的电商客服助手。' });
  }
  messages.forEach((m) => {
    if (typeof m.content === 'string' && m.content.length > 8000) m.content = m.content.slice(0, 8000);
  });

  const cfg = llm.getAiConfig(c.tenant.id);
  if (c.body.temperature != null) cfg.temperature = Number(c.body.temperature) || cfg.temperature;

  if (c.body.convId) {
    run('INSERT INTO conv_ai_logs (tenant_id,conv_id,mode,adopted,created_at) VALUES (?,?,?,0,?)',
      c.tenant.id, c.body.convId, String(c.body.mode || 'chat').slice(0, 20), nowISO());
  }
  llm.streamChat(c.res, cfg, messages, {
    mode: c.body.mode || 'chat',
    meta: c.body.meta || {},
    temperature: cfg.temperature,
    max_tokens: c.body.max_tokens,
  });
}
route('POST', '/api/ai/chat', aiChatHandler);
route('POST', '/api/chat', aiChatHandler);

route('POST', '/api/ai/adopt', async (c) => {
  if (c.body.convId) {
    run(
      `UPDATE conv_ai_logs SET adopted = 1 WHERE id = (
         SELECT id FROM conv_ai_logs WHERE tenant_id = ? AND conv_id = ? ORDER BY id DESC LIMIT 1)`,
      c.tenant.id, c.body.convId
    );
  }
  return sendJSON(c.res, 200, { ok: true });
});

/* ---------------- 后台管理 ---------------- */
route('GET', '/api/admin/users', async (c) => {
  const rows = all('SELECT * FROM users WHERE tenant_id = ? ORDER BY rowid ASC', c.tenant.id);
  const stores = all('SELECT id,name,status,platform,color,short FROM stores WHERE tenant_id = ? ORDER BY rowid ASC', c.tenant.id);
  const storeMap = {};
  stores.forEach((s) => { storeMap[s.id] = s; });
  return sendJSON(c.res, 200, {
    users: rows.map((u) => {
      const ids = String(u.store_ids || '').split(',').map((x) => x.trim()).filter(Boolean);
      const mine = ids.map((id) => storeMap[id]).filter(Boolean);
      return {
        id: u.id, name: u.name, email: u.email, role: u.role, status: u.status,
        title: u.title, createdAt: u.created_at, lastLoginAt: u.last_login_at,
        points: Number(u.points == null ? 1000 : u.points),
        storeIds: mine.map((s) => s.id),
        storeCount: mine.length,
        storeOnline: mine.filter((s) => s.status === 'active').length,
        stores: mine.map((s) => ({ id: s.id, name: s.name, status: s.status, platform: s.platform, color: s.color, short: s.short })),
        permissions: auth.parsePermissions(u.permissions),
        online: !!(get('SELECT 1 AS x FROM sessions WHERE user_id = ? AND expires_at > ?', u.id, Date.now())),
      };
    }),
    allStores: stores.map((s) => ({ id: s.id, name: s.name, status: s.status, platform: s.platform, color: s.color, short: s.short })),
  });
}, { auth: 'admin' });

/* 子账号权限序列化：modules 仅收白名单，ops 布尔；未传则返回 undefined（不改） */
function permsFromBody(body) {
  const p = body && body.permissions;
  if (!p || typeof p !== 'object' || !Array.isArray(p.modules)) return undefined;
  const modules = p.modules.filter((m) => auth.PERM_MODULES.indexOf(m) >= 0);
  const platforms = Array.isArray(p.platforms)
    ? p.platforms.filter((k) => auth.PERM_PLATFORMS.indexOf(k) >= 0)
    : [];
  return JSON.stringify({ modules, ops: !!p.ops, platforms });
}

route('POST', '/api/admin/users', async (c) => {
  const name = String(c.body.name || '').trim();
  const email = String(c.body.email || '').trim().toLowerCase();
  const password = String(c.body.password || '');
  const role = c.body.role === 'admin' ? 'admin' : 'agent';
  if (name.length < 2) return sendJSON(c.res, 400, { error: '姓名至少 2 个字符' });
  if (!auth.validEmail(email)) return sendJSON(c.res, 400, { error: '邮箱格式不正确' });
  if (password.length < 6) return sendJSON(c.res, 400, { error: '初始密码至少 6 位' });
  if (get('SELECT id FROM users WHERE email = ?', email)) {
    return sendJSON(c.res, 409, { error: '该邮箱已被使用' });
  }
  const id = uid('us');
  const points = Math.max(0, parseInt(c.body.points, 10) || 1000);
  const storeIds = Array.isArray(c.body.storeIds) ? c.body.storeIds.map(String).filter(Boolean).join(',') : '';
  const perms = permsFromBody(c.body);
  run(
    `INSERT INTO users (id,tenant_id,name,email,password,role,status,title,points,store_ids,permissions,created_at)
     VALUES (?,?,?,?,?,?,'active',?,?,?,?,?)`,
    id, c.tenant.id, name, email, auth.hashPassword(password), role,
    role === 'admin' ? '管理员' : '客服坐席', points, storeIds,
    role === 'admin' ? null : (perms === undefined ? null : perms), nowISO()
  );
  audit(c.tenant.id, c.user, '新增成员', email, c.ip);
  return sendJSON(c.res, 200, { ok: true, id });
}, { auth: 'admin' });

route('PUT', '/api/admin/users/:id', async (c) => {
  const u = get('SELECT * FROM users WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!u) return sendJSON(c.res, 404, { error: '成员不存在' });
  if (u.id === c.user.id && c.body.status === 'disabled') {
    return sendJSON(c.res, 400, { error: '不能禁用自己' });
  }
  if (c.body.password) {
    if (String(c.body.password).length < 6) return sendJSON(c.res, 400, { error: '密码至少 6 位' });
    run('UPDATE users SET password = ? WHERE id = ?', auth.hashPassword(c.body.password), u.id);
    run('DELETE FROM sessions WHERE user_id = ?', u.id);
  }
  run(
    'UPDATE users SET name = ?, role = ?, status = ?, title = ? WHERE id = ?',
    String(c.body.name || u.name),
    ['admin', 'agent'].includes(c.body.role) ? c.body.role : u.role,
    ['active', 'disabled'].includes(c.body.status) ? c.body.status : u.status,
    String(c.body.title ?? u.title),
    u.id
  );
  if (c.body.points !== undefined) {
    const pts = Math.max(0, parseInt(c.body.points, 10) || 0);
    run('UPDATE users SET points = ? WHERE id = ?', pts, u.id);
  }
  if (Array.isArray(c.body.storeIds)) {
    const ids = c.body.storeIds.map(String).filter(Boolean);
    const valid = ids.filter((id) => get('SELECT id FROM stores WHERE id = ? AND tenant_id = ?', id, c.tenant.id));
    run('UPDATE users SET store_ids = ? WHERE id = ?', valid.join(','), u.id);
  }
  const perms = permsFromBody(c.body);
  if (perms !== undefined && u.role !== 'admin') {
    run('UPDATE users SET permissions = ? WHERE id = ?', perms, u.id);
    /* 不踢会话：子账号下次刷新页面/重新登录后按新权限渲染 */
  }
  audit(c.tenant.id, c.user, '修改成员', u.email, c.ip);
  return sendJSON(c.res, 200, { ok: true });
}, { auth: 'admin' });

/* 单独改密码：不要求其他资料，改完强制该账号所有会话失效 */
route('POST', '/api/admin/users/:id/password', async (c) => {
  const u = get('SELECT * FROM users WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!u) return sendJSON(c.res, 404, { error: '成员不存在' });
  const pwd = String(c.body.password || '');
  if (pwd.length < 6) return sendJSON(c.res, 400, { error: '密码至少 6 位' });
  run('UPDATE users SET password = ? WHERE id = ?', auth.hashPassword(pwd), u.id);
  if (u.id !== c.user.id) run('DELETE FROM sessions WHERE user_id = ?', u.id);
  audit(c.tenant.id, c.user, '修改密码', u.email, c.ip);
  return sendJSON(c.res, 200, { ok: true });
}, { auth: 'admin' });

route('DELETE', '/api/admin/users/:id', async (c) => {
  const u = get('SELECT * FROM users WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!u) return sendJSON(c.res, 404, { error: '成员不存在' });
  if (u.id === c.user.id) return sendJSON(c.res, 400, { error: '不能删除自己' });
  const admins = get("SELECT COUNT(*) AS n FROM users WHERE tenant_id = ? AND role='admin' AND status='active'", c.tenant.id).n;
  if (u.role === 'admin' && admins <= 1) return sendJSON(c.res, 400, { error: '至少保留一名管理员' });
  run('DELETE FROM sessions WHERE user_id = ?', u.id);
  run('DELETE FROM users WHERE id = ?', u.id);
  audit(c.tenant.id, c.user, '删除成员', u.email, c.ip);
  return sendJSON(c.res, 200, { ok: true });
}, { auth: 'admin' });

route('GET', '/api/admin/stats', async (c) => {
  const t = c.tenant.id;
  const n = (sql, ...a) => get(sql, ...a).n;
  const aiTotal = n('SELECT COUNT(*) AS n FROM conv_ai_logs WHERE tenant_id = ?', t);
  const aiAdopted = n('SELECT COUNT(*) AS n FROM conv_ai_logs WHERE tenant_id = ? AND adopted = 1', t);
  return sendJSON(c.res, 200, {
    stats: {
      users: n('SELECT COUNT(*) AS n FROM users WHERE tenant_id = ?', t),
      activeUsers: n("SELECT COUNT(*) AS n FROM users WHERE tenant_id = ? AND status='active'", t),
      stores: n('SELECT COUNT(*) AS n FROM stores WHERE tenant_id = ?', t),
      conversations: n('SELECT COUNT(*) AS n FROM conversations WHERE tenant_id = ?', t),
      messages: n('SELECT COUNT(*) AS n FROM messages WHERE tenant_id = ?', t),
      tickets: n('SELECT COUNT(*) AS n FROM tickets WHERE tenant_id = ?', t),
      knowledge: n('SELECT COUNT(*) AS n FROM knowledge WHERE tenant_id = ?', t),
      aiCalls: aiTotal,
      aiAdoption: aiTotal ? Math.round((aiAdopted / aiTotal) * 100) : 0,
      aiConfigured: !!llm.getAiConfig(t).apiKey,
    },
    tenant: { id: c.tenant.id, name: c.tenant.name, createdAt: c.tenant.created_at },
  });
}, { auth: 'admin' });

route('GET', '/api/admin/logs', async (c) => {
  const rows = all('SELECT * FROM audit_logs WHERE tenant_id = ? ORDER BY id DESC LIMIT 60', c.tenant.id);
  return sendJSON(c.res, 200, { logs: rows });
}, { auth: 'admin' });

/* ==================================================================
   扩展模块：对话质检 / 信息通知 / 素材中心 / 对话预警 / Agent 工作流 / 数据概览
   ================================================================== */
function relTime(iso) {
  const t = new Date(iso).getTime();
  if (!t) return '';
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return m + ' 分钟前';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' 小时前';
  const d = Math.floor(h / 24);
  return d + ' 天前';
}

/* ---------------- 对话质检 ---------------- */
route('GET', '/api/qc', async (c) => {
  const t = c.tenant.id;
  const scope = scopedStoreIds(c.user);
  const sw = scopeWhere(scope, 'store_id');
  const rows = all(`SELECT * FROM qc_reviews WHERE tenant_id = ?${sw.sql} ORDER BY created_at DESC`, t, ...sw.params);
  const items = rows.map((r) => {
    const conv = get('SELECT * FROM conversations WHERE tenant_id = ? AND customer = ? ORDER BY updated_at DESC', t, r.customer);
    const msgCount = conv ? Number(get('SELECT COUNT(*) AS n FROM messages WHERE conv_id = ?', conv.id).n || 0) : 0;
    return {
      id: r.id, customer: r.customer, storeId: r.store_id, agent: r.agent,
      score: r.score, level: r.level, issues: safeJSON(r.issues, []),
      snippet: r.snippet, reply: r.reply, status: r.status,
      productId: conv ? (conv.order_product || '—') : '—',
      msgCount,
      time: relTime(r.created_at), createdAt: r.created_at,
    };
  });
  const avg = items.length ? Math.round(items.reduce((a, b) => a + b.score, 0) / items.length) : 0;
  return sendJSON(c.res, 200, {
    items,
    stats: {
      total: items.length,
      avg,
      risk: items.filter((i) => i.level === 'risk').length,
      pending: items.filter((i) => i.status === 'pending').length,
      excellent: items.filter((i) => i.level === 'excellent').length,
    },
  });
});

route('POST', '/api/qc/:id/review', async (c) => {
  const row = get('SELECT * FROM qc_reviews WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!row) return sendJSON(c.res, 404, { error: '质检记录不存在' });
  run("UPDATE qc_reviews SET status = 'done' WHERE id = ?", row.id);
  audit(c.tenant.id, c.user, '复核对话质检', row.customer, c.ip);
  return sendJSON(c.res, 200, { ok: true, status: 'done' });
});

/* ---------------- 信息通知 ---------------- */
route('GET', '/api/notifications', async (c) => {
  const t = c.tenant.id;
  const items = all('SELECT * FROM notifications WHERE tenant_id = ? ORDER BY created_at DESC', t)
    .map((n) => ({
      id: n.id, type: n.type, title: n.title, body: n.body,
      level: n.level, read: !!n.read, time: relTime(n.created_at),
    }));
  return sendJSON(c.res, 200, { items, unread: items.filter((i) => !i.read).length });
});

route('POST', '/api/notifications/read-all', async (c) => {
  run('UPDATE notifications SET read = 1 WHERE tenant_id = ?', c.tenant.id);
  return sendJSON(c.res, 200, { ok: true });
});

route('POST', '/api/notifications/:id/read', async (c) => {
  run('UPDATE notifications SET read = 1 WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  return sendJSON(c.res, 200, { ok: true });
});

/* ---------------- 素材中心 ---------------- */
route('GET', '/api/materials', async (c) => {
  const items = all('SELECT * FROM materials WHERE tenant_id = ? ORDER BY created_at DESC', c.tenant.id)
    .map((m) => ({
      id: m.id, name: m.name, type: m.type, tag: m.tag,
      size: m.size, color: m.color, time: relTime(m.created_at),
      content: m.content || '',
      poster: m.poster || '',
    }));
  return sendJSON(c.res, 200, { items });
});

route('POST', '/api/materials', async (c) => {
  const name = String((c.body.name || '').toString().trim());
  if (!name) return sendJSON(c.res, 400, { error: '请填写素材名称' });
  const palette = { image: '#165DFF', video: '#722ED1', doc: '#00B42A', text: '#FF7D00' };

  let content = '';
  let size = '—';
  let type = String((c.body.type || 'image').toString());

  const file = (c.files && c.files[0]) || null;
  if (file) {
    /* 有真实文件：按文件类型推断素材类型，落盘到 public/uploads/ */
    const ft = file.contentType || '';
    const fn = file.filename || '';
    type = ft.startsWith('image/') ? 'image'
      : ft.startsWith('video/') ? 'video'
      : ft.startsWith('audio/') ? 'video'
      : (ft === 'application/pdf' || /\.(docx?|xlsx?|pptx?|pdf|txt|csv)$/i.test(fn)) ? 'doc'
      : 'doc';
    try {
      const ext = (fn.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6) || 'bin';
      const dir = path.join(PUBLIC_DIR, 'uploads');
      fs.mkdirSync(dir, { recursive: true });
      const fname = uid('up') + '.' + ext;
      fs.writeFileSync(path.join(dir, fname), file.data);
      content = '/uploads/' + fname;
      const len = file.data.length;
      size = len < 1024 ? len + ' B' : len < 1048576 ? (len / 1024).toFixed(1) + ' KB' : (len / 1048576).toFixed(2) + ' MB';
    } catch (e) {
      return sendJSON(c.res, 500, { error: '文件写入失败：' + e.message });
    }
  } else if (c.body.fileData) {
    /* 兼容旧 JSON base64 方式（小文件） */
    try {
      const dataUrl = String(c.body.fileData);
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      const buf = Buffer.from(base64, 'base64');
      const ext = (String(c.body.fileName || name).split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6) || 'bin';
      const dir = path.join(PUBLIC_DIR, 'uploads');
      fs.mkdirSync(dir, { recursive: true });
      const fname = uid('up') + '.' + ext;
      fs.writeFileSync(path.join(dir, fname), buf);
      content = '/uploads/' + fname;
      size = buf.length < 1024 ? buf.length + ' B' : buf.length < 1048576 ? (buf.length / 1024).toFixed(1) + ' KB' : (buf.length / 1048576).toFixed(2) + ' MB';
    } catch (e) {
      return sendJSON(c.res, 500, { error: '文件写入失败：' + e.message });
    }
  } else if (type === 'text') {
    content = String(c.body.content || '');
  }

  /* 封面图：视频素材没有可播放文件时用它做缩略图（用户可显式传入，或按名称自动匹配商品图） */
  let poster = String(c.body.poster || '');
  if (!poster && type === 'video') poster = productImage(name);

  const row = {
    id: uid('mt'), tenant: c.tenant.id, name, type,
    tag: String(c.body.tag || '未分类'), size,
    color: palette[type] || '#165DFF', poster,
  };
  run(
    'INSERT INTO materials (id,tenant_id,name,type,tag,size,color,content,poster,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    row.id, row.tenant, row.name, row.type, row.tag, row.size, row.color, content, poster, nowISO()
  );
  audit(c.tenant.id, c.user, '新增素材', name, c.ip);
  return sendJSON(c.res, 200, { ok: true, item: { ...row, content, time: '刚刚' } });
});

route('DELETE', '/api/materials/:id', async (c) => {
  const row = get('SELECT * FROM materials WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!row) return sendJSON(c.res, 404, { error: '素材不存在' });
  run('DELETE FROM materials WHERE id = ?', row.id);
  audit(c.tenant.id, c.user, '删除素材', row.name, c.ip);
  return sendJSON(c.res, 200, { ok: true });
});

/* 素材预览：txt / doc(RTF) 渲染为可读 HTML 页面，pdf 内联供 iframe 查看，其余按原文件返回 */
/* 文本文件编码自动识别：BOM（UTF-8/UTF-16LE/BE）→ UTF-8 严格校验 → GBK 兜底 */
function decodeTextFile(buf) {
  if (!buf || !buf.length) return '';
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return buf.slice(3).toString('utf8');
  if (buf[0] === 0xFF && buf[1] === 0xFE) return new TextDecoder('utf-16le').decode(buf.slice(2));
  if (buf[0] === 0xFE && buf[1] === 0xFF) return new TextDecoder('utf-16be').decode(buf.slice(2));
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (!utf8.includes('\uFFFD')) return utf8;
  try { return new TextDecoder('gbk').decode(buf); } catch (e) { return utf8; }
}

function rtfToText(buf) {
  let s = buf.toString('utf8'); // 控制字均为 ASCII；正文若是 UTF-8 裸字节也能正确解出
  /* 按花括号配对整体剔除字体表/颜色表等控制组（避免惰性匹配截断残留字体名） */
  const stripGroup = (name) => {
    const re = new RegExp('\\{\\\\?\\*?\\\\' + name + '\\b');
    const m = re.exec(s);
    if (!m) return;
    let depth = 0;
    for (let i = m.index; i < s.length; i++) {
      if (s[i] === '{') depth++;
      else if (s[i] === '}') {
        depth--;
        if (depth === 0) { s = s.slice(0, m.index) + s.slice(i + 1); return; }
      }
    }
  };
  ['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict'].forEach(stripGroup);
  /* \uN? Unicode 转义（N 有符号 16 位，其后 1 个替代字符一并吃掉），收集代理对 */
  {
    let out = '';
    const re = /\\u(-?\d+)(?:.)/g;
    let last = 0, m;
    const cps = [];
    while ((m = re.exec(s))) {
      out += s.slice(last, m.index);
      last = re.lastIndex;
      let cp = parseInt(m[1], 10);
      if (cp < 0) cp += 65536;
      cps.push([out.length, cp]);
      out += '\u0001'; // 占位，稍后统一替换，便于合成代理对
    }
    out += s.slice(last);
    if (cps.length) {
      const parts = out.split('\u0001');
      let res = parts[0];
      cps.forEach(([, cp], i) => {
        res += String.fromCodePoint(cp) + parts[i + 1];
      });
      // 合并代理对
      s = res.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, (p) => String.fromCodePoint(p.codePointAt(0)));
    }
  }
  /* 连续的 \'xx 转义按整段字节流解码（UTF-8 → GBK → latin1 逐级兜底，覆盖 Word 中文 RTF） */
  s = s.replace(/(\\'[0-9a-f]{2})+/gi, (run) => {
    const hex = (run.match(/[0-9a-f]{2}/gi) || []).join('');
    const bytes = Buffer.from(hex, 'hex');
    const t = bytes.toString('utf8');
    if (!t.includes('\uFFFD')) return t;
    try {
      const g = new TextDecoder('gbk').decode(bytes);
      if (!g.includes('\uFFFD')) return g;
    } catch (e) { /* ignore */ }
    return bytes.toString('latin1');
  });
  s = s.replace(/\\par[d]?\b/g, '\n');
  s = s.replace(/\\line\b/g, '\n');
  s = s.replace(/\\tab\b/g, '    ');
  s = s.replace(/\\[a-z]+-?\d*\s?/gi, '');
  s = s.replace(/[{}]/g, '');
  return s.split('\n').map((l) => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function previewHtml(title, bodyHtml) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title><style>
  body{margin:0;background:#F5F6F7;font-family:'PingFang SC','Microsoft YaHei',sans-serif;color:#1D2129}
  .doc{max-width:760px;margin:24px auto;background:#fff;border-radius:12px;padding:36px 44px;box-shadow:0 2px 10px rgba(29,33,41,.06)}
  h1{font-size:20px;margin:0 0 6px} .meta{font-size:12px;color:#86909C;margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid #F2F3F5}
  pre{white-space:pre-wrap;word-break:break-word;font-family:inherit;font-size:14px;line-height:1.9;margin:0}
  </style></head><body><div class="doc"><h1>${title}</h1><div class="meta">小满 AI · 素材预览</div><pre>${bodyHtml}</pre></div></body></html>`;
}

route('GET', '/api/materials/:id/preview', async (c) => {
  const row = get('SELECT * FROM materials WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!row) return sendJSON(c.res, 404, { error: '素材不存在' });
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const rel = String(row.content || '');

  /* 纯文本素材（content 不是文件路径，直接是文案内容） */
  if (rel && !rel.startsWith('/uploads/') && !rel.startsWith('/')) {
    c.res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    c.res.end(previewHtml(esc(row.name), esc(rel)));
    return;
  }
  if (!rel.startsWith('/uploads/')) return sendJSON(c.res, 404, { error: '该素材没有可预览的文件' });
  const filePath = path.join(PUBLIC_DIR, rel.replace(/\.\./g, ''));
  if (!fs.existsSync(filePath)) return sendJSON(c.res, 404, { error: '素材文件已丢失，请重新上传' });
  const ext = path.extname(filePath).toLowerCase();

  /* 文档类素材若有 UTF-8 文本伴生文件（生成器写入），直接渲染文本页——
     彻底绕开 PDF 字体嵌入 / RTF 编码在各查看器下的兼容问题 */
  const sidecar = filePath + '.txt';
  if (['.pdf', '.doc', '.rtf', '.docx'].includes(ext) && fs.existsSync(sidecar)) {
    const text = decodeTextFile(fs.readFileSync(sidecar));
    c.res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    c.res.end(previewHtml(esc(row.name), esc(text)));
    return;
  }

  if (ext === '.pdf' || ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.mp4', '.webm', '.mov'].includes(ext)) {
    // 浏览器原生可渲染：直接内联返回
    serveFile(c.res, filePath);
    return;
  }
  if (ext === '.txt' || ext === '.csv' || ext === '.md') {
    const text = decodeTextFile(fs.readFileSync(filePath));
    c.res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    c.res.end(previewHtml(esc(row.name), esc(text)));
    return;
  }
  if (ext === '.doc' || ext === '.rtf' || ext === '.docx') {
    const text = rtfToText(fs.readFileSync(filePath));
    const body = text
      ? text.split('\n').map((l) => esc(l) || '&nbsp;').join('\n')
      : '（该文档为二进制格式，暂不支持在线预览，请下载后用 Word / WPS 打开）';
    c.res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    c.res.end(previewHtml(esc(row.name), body));
    return;
  }
  // xlsx / pptx / zip 等二进制格式：提示下载
  const mime = MIME[ext] || 'application/octet-stream';
  c.res.writeHead(200, { 'Content-Type': mime, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}` });
  fs.createReadStream(filePath).pipe(c.res);
});

/* ---------------- 对话预警 ---------------- */
route('GET', '/api/alerts', async (c) => {
  const _sw = scopeWhere(scopedStoreIds(c.user), 'store_id');
  const items = all(`SELECT * FROM alerts WHERE tenant_id = ?${_sw.sql} ORDER BY created_at DESC`, c.tenant.id, ..._sw.params)
    .map((a) => ({
      id: a.id, convId: a.conv_id, customer: a.customer, storeId: a.store_id,
      type: a.type, level: a.level, text: a.text, handled: !!a.handled,
      time: relTime(a.created_at),
    }));
  return sendJSON(c.res, 200, {
    items,
    stats: {
      pending: items.filter((i) => !i.handled).length,
      high: items.filter((i) => i.level === 'high' && !i.handled).length,
      handled: items.filter((i) => i.handled).length,
    },
  });
});

route('POST', '/api/alerts/:id/handle', async (c) => {
  const row = get('SELECT * FROM alerts WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!row) return sendJSON(c.res, 404, { error: '预警不存在' });
  run('UPDATE alerts SET handled = 1 WHERE id = ?', row.id);
  audit(c.tenant.id, c.user, '处理对话预警', row.customer + ' / ' + row.type, c.ip);
  return sendJSON(c.res, 200, { ok: true });
});

/* ---------------- AI Agent 工作流 ---------------- */
route('GET', '/api/flows', async (c) => {
  const items = all('SELECT * FROM agent_flows WHERE tenant_id = ? ORDER BY sort ASC, rowid ASC', c.tenant.id)
    .map((f) => {
      const last = get('SELECT created_at, intent FROM flow_runs WHERE flow_id = ? ORDER BY id DESC LIMIT 1', f.id);
      return {
        id: f.id, name: f.name, description: f.description,
        triggerType: f.trigger_type, triggerDesc: f.trigger_desc,
        steps: safeJSON(f.steps, []), enabled: !!f.enabled,
        runs: f.runs, successRate: f.success_rate,
        lastRunAt: last ? last.created_at : null,
        lastIntent: last ? last.intent : null,
      };
    });
  return sendJSON(c.res, 200, { items });
});

route('GET', '/api/flows/:id/runs', async (c) => {
  const row = get('SELECT id FROM agent_flows WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!row) return sendJSON(c.res, 404, { error: '工作流不存在' });
  const items = all(
    'SELECT id,conv_id,customer,intent,trigger_text,reply,created_at FROM flow_runs WHERE flow_id = ? AND tenant_id = ? ORDER BY id DESC LIMIT 20',
    row.id, c.tenant.id
  );
  return sendJSON(c.res, 200, { items });
});

route('POST', '/api/flows/:id/toggle', async (c) => {
  const row = get('SELECT * FROM agent_flows WHERE id = ? AND tenant_id = ?', c.params.id, c.tenant.id);
  if (!row) return sendJSON(c.res, 404, { error: '工作流不存在' });
  const next = row.enabled ? 0 : 1;
  run('UPDATE agent_flows SET enabled = ? WHERE id = ?', next, row.id);
  audit(c.tenant.id, c.user, next ? '启用工作流' : '停用工作流', row.name, c.ip);
  return sendJSON(c.res, 200, { ok: true, enabled: !!next });
});

/* ---------------- 数据概览（登录后首页） ---------------- */
route('GET', '/api/overview', async (c) => {
  const t = c.tenant.id;
  const scope = scopedStoreIds(c.user); /* 子账号：只统计被授权的店铺 */
  const swConv = scopeWhere(scope, 'cv.store_id');
  const sw = scopeWhere(scope, 'store_id');
  const dash = getSetting(t, 'dashboard', null);
  const quota = getSetting(t, 'quota', { total: 5000, used: 0 });
  const stores = all('SELECT * FROM stores WHERE tenant_id = ? ORDER BY sort ASC, rowid ASC', t)
    .filter((s) => !scope || scope.indexOf(String(s.id)) >= 0)
    .map((s) => {
    const conv = get('SELECT COUNT(*) AS n FROM conversations WHERE tenant_id = ? AND store_id = ?', t, s.id).n;
    const unread = get('SELECT COALESCE(SUM(unread),0) AS n FROM conversations WHERE tenant_id = ? AND store_id = ?', t, s.id).n;
    const msg = get(
      'SELECT COUNT(*) AS n FROM messages m JOIN conversations cv ON cv.id = m.conv_id WHERE cv.tenant_id = ? AND cv.store_id = ?',
      t, s.id
    ).n;
    const credRow = storeAuth.getRow(s.id);
    const cred = credRow ? storeAuth.resolve(credRow) : null;
    return {
      id: s.id, name: s.name, platform: s.platform, short: s.short, color: s.color,
      account: s.account, status: s.status, conversations: conv, unread, messages: msg,
      integration: cred ? {
        platform: cred.platform,
        authorized: Boolean(cred.session),
        auth_status: cred.authStatus,
        auth_error: cred.authError,
        shop_pic: cred.shopPic,
        seller_nick: cred.sellerNick,
        env: cred.env,
        last_sync_at: cred.lastSyncAt,
      } : null,
    };
  });
  /* ---------- 今日实时运营指标（全部来自真实表） ---------- */
  const d0 = new Date();
  d0.setHours(0, 0, 0, 0);
  const todayISO = d0.toISOString();

  const onlineStores = stores.filter((s) => s.status === 'active').length;
  const totalStores = stores.length;

  const todayInbound = get(
    `SELECT COUNT(*) AS n FROM conversations WHERE tenant_id = ?${sw.sql} AND created_at >= ?`, t, ...sw.params, todayISO
  ).n;
  const todayTransfer = get(
    `SELECT COUNT(*) AS n FROM conversations WHERE tenant_id = ?${sw.sql} AND transferred_at >= ?`, t, ...sw.params, todayISO
  ).n;
  const conversion = todayInbound ? Math.round((todayTransfer / todayInbound) * 1000) / 10 : 0;

  /* 昨日同期：用于计算真实的环比变化 */
  const y0 = new Date(d0.getTime() - 86400000);
  const yInbound = get(
    `SELECT COUNT(*) AS n FROM conversations WHERE tenant_id = ?${sw.sql} AND created_at >= ? AND created_at < ?`,
    t, ...sw.params, y0.toISOString(), todayISO
  ).n;
  const yTransfer = get(
    `SELECT COUNT(*) AS n FROM conversations WHERE tenant_id = ?${sw.sql} AND transferred_at >= ? AND transferred_at < ?`,
    t, ...sw.params, y0.toISOString(), todayISO
  ).n;
  const pct = (now, prev) => (prev ? Math.round(((now - prev) / prev) * 1000) / 10 : (now ? 100 : 0));

  /* 今日对话走势：按小时聚合（消息时间即会话发生时间） */
  const trendLabels = [];
  const trendValues = [];
  const nowHour = new Date().getHours();
  for (let h = 0; h <= nowHour; h++) {
    const hh = String(h).padStart(2, '0');
    const n = get(
      `SELECT COUNT(*) AS n FROM messages m
         JOIN conversations cv ON cv.id = m.conv_id
        WHERE cv.tenant_id = ?${swConv.sql} AND m.time LIKE ?`,
      t, ...swConv.params, hh + ':%'
    ).n;
    trendLabels.push(hh + ':00');
    trendValues.push(Number(n));
  }

  /* 对话 TOP 榜：按店铺消息量排序 */
  const topStores = stores
    .map((s) => ({ id: s.id, name: s.name, short: s.short, color: s.color, platform: s.platform, count: s.messages }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const qcAvg = get('SELECT ROUND(AVG(score)) AS v FROM qc_reviews WHERE tenant_id = ?', t);
  const accuracy = qcAvg && qcAvg.v !== null && qcAvg.v !== undefined ? Number(qcAvg.v) : 0;

  /* 智能词库：账号级知识 / 店铺级知识（非商品）/ 商品级知识 */
  const lexAccount = get('SELECT COUNT(*) AS n FROM knowledge WHERE tenant_id = ?', t).n;
  const lexStore = get(
    "SELECT COUNT(*) AS n FROM store_knowledge WHERE tenant_id = ? AND type <> 'product'", t
  ).n;
  const lexProduct = get(
    "SELECT COUNT(*) AS n FROM store_knowledge WHERE tenant_id = ? AND type = 'product'", t
  ).n;

  return sendJSON(c.res, 200, {
    stores,
    quota: { ...quota, remain: Math.max(0, quota.total - quota.used) },
    stats: {
      stores_online: onlineStores,
      stores_total: totalStores,
      today_inbound: Number(todayInbound),
      today_transfer: Number(todayTransfer),
      conversion,
      yesterday: { inbound: Number(yInbound), transfer: Number(yTransfer) },
      delta: {
        inbound: pct(Number(todayInbound), Number(yInbound)),
        transfer: pct(Number(todayTransfer), Number(yTransfer)),
      },
      accuracy,
      trend: { labels: trendLabels, values: trendValues },
      top_stores: topStores,
      lexicon: {
        account: Number(lexAccount),
        store: Number(lexStore),
        product: Number(lexProduct),
        total: Number(lexAccount) + Number(lexStore) + Number(lexProduct),
      },
    },
    kpis: (dash && dash.kpis) || [],
    pendingAlerts: get('SELECT COUNT(*) AS n FROM alerts WHERE tenant_id = ? AND handled = 0', t).n,
    pendingQc: get("SELECT COUNT(*) AS n FROM qc_reviews WHERE tenant_id = ? AND status = 'pending'", t).n,
    pendingTickets: get(`SELECT COUNT(*) AS n FROM tickets WHERE tenant_id = ?${sw.sql} AND status = 'pending'`, t, ...sw.params).n,
    unreadNotices: get('SELECT COUNT(*) AS n FROM notifications WHERE tenant_id = ? AND read = 0', t).n,
  });
});

/* ==================================================================
   HTTP 入口
   ================================================================== */
const PAGES = {
  '/': 'index.html',
  '/login': 'login.html',
  '/register': 'register.html',
  '/app': 'app.html',
  '/admin': 'admin.html',
};

function serveFile(res, filePath) {
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 Not Found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    const noCache = ['.html', '.css', '.js', '.json'].includes(ext);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': noCache ? 'no-cache' : 'public, max-age=604800',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = decodeURIComponent(u.pathname);
  const ip = (req.socket.remoteAddress || 'x').replace('::ffff:', '');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    });
    res.end();
    return;
  }

  /* ---------- API ---------- */
  if (pathname.startsWith('/api/')) {
    const ctx = { req, res, ip, params: {}, query: u.searchParams, body: {} };
    const token = auth.tokenFromReq(req);
    ctx.token = token;
    const row = auth.userByToken(token);
    if (row) {
      ctx.user = row;
      ctx.tenant = get('SELECT * FROM tenants WHERE id = ?', row.tenant_id);
    }
    /* 只读权限拦截：非管理员、未开通「可操作」权限的子账号，禁止一切写操作（只能浏览） */
    if (ctx.user && ctx.user.role !== 'admin' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const isOpenPath = [/^\/api\/auth\//].some((re) => re.test(pathname));
      const perm = auth.parsePermissions(ctx.user.permissions);
      if (!isOpenPath && (!perm || !perm.ops)) {
        return sendJSON(res, 403, { error: '当前账号为只读权限（仅可查看），请联系管理员在「子账号管理 → 编辑」中开通操作权限' });
      }
    }
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      const ct = req.headers['content-type'] || '';
      if (ct.includes('multipart/form-data')) {
        try {
          const buf = await readBuffer(req, 256 * 1024 * 1024);
          const mp = parseMultipart(buf, ct);
          ctx.body = mp.fields;
          ctx.files = mp.files;
        } catch (e) {
          return sendJSON(res, 400, { error: '上传解析失败：' + e.message });
        }
      } else {
        try {
          /* 聊天记录导入可能一次推上千条，放宽到 8MB */
          const raw = await readBody(req, 8 * 1024 * 1024);
          ctx.body = raw ? JSON.parse(raw) : {};
        } catch (e) {
          return sendJSON(res, 400, { error: '请求体解析失败' });
        }
      }
    }

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(pathname);
      if (!m) continue;
      r.keys.forEach((k, i) => { ctx.params[k] = decodeURIComponent(m[i + 1]); });

      if (r.auth === 'user' && !ctx.user) return sendJSON(res, 401, { error: '登录状态已失效，请重新登录' });
      if (r.auth === 'admin' && (!ctx.user || ctx.user.role !== 'admin')) {
        return sendJSON(res, 403, { error: '需要管理员权限' });
      }
      try {
        return await r.fn(ctx);
      } catch (e) {
        console.error('[API]', pathname, e);
        return sendJSON(res, 500, { error: '服务端错误：' + e.message });
      }
    }
    return sendJSON(res, 404, { error: '接口不存在' });
  }

  /* ---------- 页面（带登录态校验） ---------- */
  if (req.method === 'GET' || req.method === 'HEAD') {
    /* 买家在线咨询页：/c/<店铺短码>，免登录 */
    if (/^\/c\/[a-z0-9_-]{4,24}\/?$/i.test(pathname)) {
      return serveFile(res, path.join(PUBLIC_DIR, 'consult.html'));
    }
    let rel = PAGES[pathname];
    if (rel) {
      const row = auth.userByToken(auth.tokenFromReq(req));
      if ((pathname === '/app' || pathname === '/admin') && !row) {
        res.writeHead(302, { Location: '/login' });
        return res.end();
      }
      if (pathname === '/admin' && row && row.role !== 'admin') {
        res.writeHead(302, { Location: '/app' });
        return res.end();
      }
      if ((pathname === '/login' || pathname === '/register') && row) {
        res.writeHead(302, { Location: '/app' });
        return res.end();
      }
      return serveFile(res, path.join(PUBLIC_DIR, rel));
    }

    // 静态资源（防目录穿越）
    const safe = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '');
    const filePath = path.join(PUBLIC_DIR, safe);
    if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('forbidden'); }
    return serveFile(res, filePath);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
});

/* 端口被占用（多半是服务已在运行）时给出人话提示，而不是一大段堆栈 */
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.log('');
    console.log(`  端口 ${PORT} 已被占用 —— 工作台服务很可能已经在运行了。`);
    console.log(`  请直接访问 http://127.0.0.1:${PORT} ；`);
    console.log(`  若要重启，先在任务管理器结束占用该端口的 node 进程，或改用 PORT=8788 node server.js。`);
    console.log('');
    process.exit(0);
  }
  console.error('服务启动失败：', err);
  process.exit(1);
});

server.listen(PORT, async () => {
  /* 启动自清扫：把误抓进来的平台系统号/后台菜单会话清掉（旧版扩展、异常推送兜底） */
  try {
    const swept = await inbox.purgeSystemConversations();
    if (swept > 0) console.log(`  会话清扫   已清除 ${swept} 个平台系统号/菜单项会话`);
  } catch (e) {
    console.warn('  会话清扫失败：', e.message);
  }
  const demo = get('SELECT email FROM users WHERE email = ?', 'admin@xiaoman.ai');
  console.log('');
  console.log('  小满AI · 电商客服工作台 已启动');
  console.log('  ──────────────────────────────────────────');
  console.log(`  本地地址   http://127.0.0.1:${PORT}`);
  console.log(`  数据库     ${dbm.label}`);
  for (const n of dbm.info().notes) console.log(`             · ${n}`);
  if (demo) {
    console.log('  演示账号   admin@xiaoman.ai / xiaoman123   （管理员）');
    console.log('             agent@xiaoman.ai / xiaoman123   （客服坐席）');
  }
  const poll = poller.start(process.env.TMC_POLL_MS === undefined ? 60000 : Number(process.env.TMC_POLL_MS));
  console.log(`  平台接入   淘宝/天猫 TOP（真实接口，凭据加密存储）`);
  console.log(`  消息拉取   ${poll.started ? 'TMC 轮询已开启 · 每 ' + Math.round(poll.intervalMs / 1000) + ' 秒' : '已关闭（TMC_POLL_MS）'}`);
  console.log('  ──────────────────────────────────────────');
  console.log('');
});
