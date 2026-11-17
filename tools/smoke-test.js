'use strict';
/**
 * 全链路回归测试（Node 内置 fetch，不依赖任何测试框架）
 *   node tools/smoke-test.js [baseUrl]
 */
const BASE = process.argv[2] || 'http://127.0.0.1:8787';

let pass = 0;
let fail = 0;
const fails = [];

function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log('  ✓ ' + name); }
  else { fail += 1; fails.push(name); console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

function jar() {
  const store = new Map();
  return {
    header: () => [...store].map(([k, v]) => k + '=' + v).join('; '),
    absorb: (res) => {
      const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const c of raw) {
        const [pair] = c.split(';');
        const i = pair.indexOf('=');
        store.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }
    },
  };
}

async function req(j, method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (j.header()) headers.Cookie = j.header();
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  j.absorb(res);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* 非 JSON */ }
  return { status: res.status, json, text };
}

(async () => {
  console.log('\n== 1. 页面路由 ==');
  for (const [p, expect] of [['/', 200], ['/login', 200], ['/register', 200], ['/app', 302], ['/admin', 302]]) {
    const r = await fetch(BASE + p, { redirect: 'manual' });
    ok(`GET ${p} → ${r.status}`, r.status === expect, 'expect ' + expect);
  }

  console.log('\n== 2. 登录 ==');
  const admin = jar();
  let r = await req(admin, 'POST', '/api/auth/login', { email: 'admin@xiaoman.ai', password: 'xiaoman123' });
  ok('管理员登录成功', r.status === 200 && r.json && r.json.ok !== false, r.status + ' ' + r.text.slice(0, 100));
  r = await req(jar(), 'POST', '/api/auth/login', { email: 'admin@xiaoman.ai', password: 'wrong-pass' });
  ok('错误密码被拒绝', r.status === 401 || r.status === 400, String(r.status));

  console.log('\n== 3. 核心数据读取（MySQL） ==');
  r = await req(admin, 'GET', '/api/bootstrap');
  const B = r.json || {};
  ok('bootstrap 返回', r.status === 200 && !!B.user);
  ok('店铺 ≥ 1 个', (B.stores || []).length >= 1, String((B.stores || []).length));
  /* 会话数会随真实使用增长，不能写死；验证"非空 + 每条会话结构完整（id + messages 数组）" */
  ok('会话列表非空且结构完整', (B.conversations || []).length >= 1 && (B.conversations || []).every((c) => c.id && Array.isArray(c.messages)), String((B.conversations || []).length));
  ok('工单 6 个', (B.tickets || []).length === 6, String((B.tickets || []).length));
  ok('工单时间线非空', ((B.tickets || [])[0] || {}).timeline?.length > 0);
  ok('会话 tags 已反序列化', Array.isArray(((B.conversations || [])[0] || {}).tags));
  ok('消息已加载', ((B.conversations || [])[0] || {}).messages?.length > 0);
  ok('看板 KPI 5 项', (B.dashboard?.kpis || []).length === 5, String((B.dashboard?.kpis || []).length));
  ok('知识库非空', (B.knowledge || []).length > 0);
  ok('快捷话术非空', (B.quickReplies || []).length > 0);
  ok('成员列表非空', (B.team || []).length > 0);

  console.log('\n== 4. 写入：发消息 / 工单流转 ==');
  const conv = (B.conversations || [])[0];
  const previewBefore = conv.lastMsg;
  const mark = 'DB-VERIFY-' + Date.now();
  r = await req(admin, 'POST', `/api/conversations/${conv.id}/messages`, { text: mark, role: 'agent' });
  ok('发送消息 200', r.status === 200, String(r.status));
  r = await req(admin, 'GET', '/api/bootstrap');
  const conv2 = (r.json?.conversations || []).find((c) => c.id === conv.id);
  const last = (conv2?.messages || []).slice(-1)[0];
  ok('消息已落库并能读回', last && last.text === mark, JSON.stringify(last));
  /* 列表预览必须保留「客户最近说的话」，我方回复不覆盖（2026-10 起的规则） */
  ok('会话预览保留客户原话（回复不覆盖）', conv2.lastMsg === previewBefore, conv2.lastMsg);

  const tk = (B.tickets || [])[0];
  r = await req(admin, 'POST', `/api/tickets/${tk.id}/status`, { status: 'processing' });
  ok('工单状态流转 200', r.status === 200, String(r.status));
  r = await req(admin, 'GET', '/api/bootstrap');
  const tk2 = (r.json?.tickets || []).find((x) => x.id === tk.id);
  ok('工单状态已持久化', tk2.status === 'processing', tk2 && tk2.status);
  ok('工单留痕 +1', (tk2.timeline || []).length > (tk.timeline || []).length);

  console.log('\n== 5. 各业务模块接口 ==');
  for (const p of ['/api/overview', '/api/qc', '/api/notifications', '/api/materials', '/api/alerts', '/api/flows', '/api/stores', '/api/admin/stats', '/api/admin/users', '/api/admin/logs']) {
    r = await req(admin, 'GET', p);
    ok('GET ' + p, r.status === 200 && r.json !== null, String(r.status));
  }

  console.log('\n== 6. 增删：知识 / 店铺 / 素材 ==');
  r = await req(admin, 'POST', '/api/knowledge', { q: '能否开专票', a: '支持，下单后联系客服登记抬头，7 个工作日寄出。' });
  const kid = r.json?.item?.id;
  ok('新增知识条目', r.status === 200 && !!kid, String(r.status));
  if (kid) {
    r = await req(admin, 'DELETE', '/api/knowledge/' + kid);
    ok('删除知识条目', r.status === 200, String(r.status));
  }

  /* 平台清单 */
  r = await req(admin, 'GET', '/api/platforms');
  ok('GET /api/platforms', r.status === 200 && (r.json.platforms || []).length >= 10, String(r.status));
  r = await req(admin, 'GET', '/api/connectors');
  ok('GET /api/connectors', r.status === 200 && (r.json.platforms || []).length >= 1, String(r.status));

  /* 网页登录型店铺 */
  r = await req(admin, 'POST', '/api/stores', { mode: 'web', name: '回归测试店', platform: '小红书', account: 'test_xhs' });
  const sid = r.json?.id;
  ok('新增店铺（网页登录）', r.status === 200 && !!sid, r.text.slice(0, 120));

  /* 淘宝 API 模式缺凭据必须被拒（不允许静默创建） */
  r = await req(admin, 'POST', '/api/stores', { mode: 'api', platform: '淘宝', name: '无凭据店' });
  ok('淘宝接入缺凭据被拒绝', r.status === 400 && r.json?.need_credentials === true, r.text.slice(0, 120));

  /* 未接入 API 的平台不允许走 api 模式 */
  r = await req(admin, 'POST', '/api/stores', { mode: 'api', platform: '京东', name: 'x', appKey: '12345678', appSecret: 'abcdefgh12345678' });
  ok('未接 API 平台被拒绝', r.status === 400 && r.json?.unsupported_platform === true, r.text.slice(0, 120));

  if (sid) {
    r = await req(admin, 'GET', '/api/stores/' + sid + '/settings');
    ok('读取店铺设置', r.status === 200 && !!r.json.settings, String(r.status));

    r = await req(admin, 'PUT', '/api/stores/' + sid + '/settings', { style: 'pro', heat: 70, welcome: '测试欢迎语' });
    ok('保存店铺设置', r.status === 200 && r.json.settings.style === 'pro', r.text.slice(0, 120));

    r = await req(admin, 'POST', '/api/stores/' + sid + '/knowledge/import', {
      type: 'product',
      rows: [{ product_id: '1001', question: '什么时候发货', answer: '48 小时内' }, { product_id: '', question: '', answer: '' }],
    });
    ok('导入店铺知识', r.status === 200 && r.json.imported === 1, r.text.slice(0, 120));

    r = await req(admin, 'GET', '/api/stores/' + sid + '/knowledge');
    const k0 = (r.json.items || [])[0];
    ok('读取店铺知识', r.status === 200 && (r.json.items || []).length === 1, String(r.status));

    if (k0) {
      r = await req(admin, 'POST', '/api/store-knowledge/' + k0.id + '/toggle', {});
      ok('知识启用开关', r.status === 200 && r.json.status === 'on', r.text.slice(0, 120));
      r = await req(admin, 'DELETE', '/api/store-knowledge/' + k0.id);
      ok('删除知识', r.status === 200, String(r.status));
    }

    r = await req(admin, 'DELETE', '/api/stores/' + sid);
    ok('删除店铺', r.status === 200, String(r.status));
  }

  r = await req(admin, 'POST', '/api/materials', { name: '回归素材.png', type: 'image', tag: '测试' });
  const mid = r.json?.item?.id;
  ok('新增素材', r.status === 200 && !!mid, r.text.slice(0, 120));
  if (mid) {
    r = await req(admin, 'DELETE', '/api/materials/' + mid);
    ok('删除素材', r.status === 200, String(r.status));
  }

  console.log('\n== 7. 工作流开关 / 预警处理 / 通知已读 ==');
  r = await req(admin, 'GET', '/api/flows');
  const flow = (r.json?.items || [])[0];
  if (flow) {
    const before = flow.enabled;
    r = await req(admin, 'POST', `/api/flows/${flow.id}/toggle`);
    ok('工作流开关生效', r.status === 200, String(r.status));
    r = await req(admin, 'POST', `/api/flows/${flow.id}/toggle`);
    ok('工作流可切回', r.status === 200 && before !== undefined);
  }
  r = await req(admin, 'GET', '/api/alerts');
  const alert = (r.json?.items || []).find((a) => !a.handled);
  if (alert) {
    r = await req(admin, 'POST', `/api/alerts/${alert.id}/handle`);
    ok('预警标记处理', r.status === 200, String(r.status));
  }
  r = await req(admin, 'POST', '/api/notifications/read-all');
  ok('通知全部已读', r.status === 200, String(r.status));

  console.log('\n== 8. 快捷短语 / 系统设置 ==');
  r = await req(admin, 'GET', '/api/quick-replies');
  ok('快捷短语可按分组返回', r.status === 200 && Array.isArray(r.json?.groups) && r.json.groups.length > 0,
    `分组 ${(r.json?.groups || []).length} / 共 ${r.json?.total} 条`);
  ok('快捷短语区分个人与团队', r.status === 200 &&
    typeof r.json?.scopes?.personal === 'number' && typeof r.json?.scopes?.team === 'number',
    `个人 ${r.json?.scopes?.personal} / 团队 ${r.json?.scopes?.team}`);

  r = await req(admin, 'POST', '/api/quick-replies', { text: '冒烟测试短语', category: '通用', scope: 'personal' });
  const qrId = r.json?.id;
  ok('新增快捷短语', r.status === 200 && !!qrId, String(r.status));

  if (qrId) {
    r = await req(admin, 'POST', `/api/quick-replies/${qrId}/use`);
    ok('使用短语累加次数', r.status === 200 && r.json?.use_count === 1, String(r.json?.use_count));
    r = await req(admin, 'GET', '/api/quick-replies');
    ok('最近常用已更新', (r.json?.recent || []).indexOf('冒烟测试短语') === 0);
    r = await req(admin, 'DELETE', `/api/quick-replies/${qrId}`);
    ok('删除快捷短语', r.status === 200, String(r.status));
  }
  r = await req(admin, 'POST', '/api/quick-replies', { text: '' });
  ok('空短语被拒绝', r.status === 400, String(r.status));

  r = await req(admin, 'GET', '/api/system/settings');
  ok('系统设置可读取', r.status === 200 && typeof r.json?.settings?.logLevel === 'string',
    r.json?.settings?.logLevel);
  ok('运行信息含数据库与 Node 版本', !!(r.json?.runtime?.db && r.json?.runtime?.node),
    r.json?.runtime?.db);
  const oldLevel = r.json?.settings?.logLevel;
  r = await req(admin, 'PUT', '/api/system/settings', { logLevel: 'minimal' });
  ok('系统设置可保存', r.status === 200 && r.json?.settings?.logLevel === 'minimal');
  await req(admin, 'PUT', '/api/system/settings', { logLevel: oldLevel });

  r = await req(admin, 'POST', '/api/system/clear-cache');
  ok('清理缓存返回真实条数', r.status === 200 && typeof r.json?.cleared_logs === 'number',
    `日志 ${r.json?.cleared_logs} / 通知 ${r.json?.cleared_notices}`);

  console.log('\n== 9. AI 接口（SSE 流式） ==');
  {
    const res = await fetch(BASE + '/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: admin.header() },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: '你是电商客服' },
          { role: 'user', content: '这个T恤什么时候发货？' },
        ],
        mode: 'chat',
        meta: { product: '纯棉T恤' },
      }),
    });
    const text = await res.text();
    let out = '';
    for (const line of text.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const s = line.slice(5).trim();
      if (s === '[DONE]') continue;
      try { const o = JSON.parse(s); if (o.t) out += o.t; } catch (e) { /* ignore */ }
    }
    ok('AI 流式返回内容', res.status === 200 && out.length > 0, 'len=' + out.length);
    console.log('    回复片段：' + out.slice(0, 60) + (out.length > 60 ? '…' : ''));
  }

  console.log('\n== 10. 注册与多租户隔离 ==');
  const guest = jar();
  const email = 'smoke' + Date.now() + '@test.local';
  r = await req(guest, 'POST', '/api/auth/register', { name: '隔离测试', company: '隔离测试店', email, password: 'test123456' });
  ok('新用户注册成功', r.status === 200 && r.json && r.json.ok !== false, r.text.slice(0, 120));
  r = await req(guest, 'GET', '/api/bootstrap');
  const G = r.json || {};
  const guestTenantId = G.tenant && G.tenant.id;
  ok('新租户有自己的数据', (G.conversations || []).length > 0, String((G.conversations || []).length));
  ok('新租户看不到管理员店铺', !(G.stores || []).some((s) => (B.stores || []).some((x) => x.id === s.id)));
  ok('新租户 ID 不同', G.tenant && B.tenant && G.tenant.id !== B.tenant.id);
  r = await req(guest, 'GET', '/api/admin/stats');
  ok('普通租户管理员可访问自己的后台', r.status === 200, String(r.status));

  console.log('\n== 11. 权限边界 ==');
  const agent = jar();
  r = await req(agent, 'POST', '/api/auth/login', { email: 'agent@xiaoman.ai', password: 'xiaoman123' });
  ok('坐席登录成功', r.status === 200, String(r.status));
  r = await req(agent, 'GET', '/api/bootstrap');
  ok('坐席可读业务数据', r.status === 200, String(r.status));
  r = await req(agent, 'GET', '/api/admin/stats');
  ok('坐席访问后台接口被拒', r.status === 403, String(r.status));
  r = await req(jar(), 'GET', '/api/bootstrap');
  ok('未登录访问接口被拒', r.status === 401 || r.status === 403, String(r.status));

  console.log('\n───────────────');
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) { console.log('失败项：' + fails.join('、')); process.exitCode = 1; }

  /* 清理测试过程中产生的数据，保持库干净 */
  try {
    const dbm = require('../lib/db');
    const cleaned = cleanTenant(dbm, guestTenantId);
    dbm.run("DELETE FROM messages WHERE text LIKE 'DB-VERIFY-%'");
    resyncConvSummary(dbm);
    if (cleaned) console.log('已清理测试租户 ' + guestTenantId + '（' + cleaned + ' 行）');
  } catch (e) {
    console.log('测试数据清理跳过：' + String(e.message).slice(0, 80));
  }
})();

function cleanTenant(dbm, tenantId) {
  if (!tenantId) return 0;
  const tables = [
    'messages', 'ticket_events', 'tickets', 'conversations', 'knowledge',
    'quick_replies', 'conv_ai_logs', 'audit_logs', 'qc_reviews', 'notifications',
    'materials', 'alerts', 'agent_flows', 'stores', 'settings',
  ];
  let n = 0;
  for (const t of tables) n += dbm.run('DELETE FROM ' + t + ' WHERE tenant_id = ?', tenantId).changes;
  dbm.run('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE tenant_id = ?)', tenantId);
  dbm.run('DELETE FROM users WHERE tenant_id = ?', tenantId);
  dbm.run('DELETE FROM tenants WHERE id = ?', tenantId);
  return n;
}

/** 让会话摘要与最后一条消息保持一致 */
function resyncConvSummary(dbm) {
  for (const c of dbm.all('SELECT id FROM conversations')) {
    const m = dbm.get('SELECT text, time FROM messages WHERE conv_id = ? ORDER BY id DESC LIMIT 1', c.id);
    if (m) dbm.run('UPDATE conversations SET last_msg = ?, last_time = ? WHERE id = ?', m.text, m.time, c.id);
  }
}
