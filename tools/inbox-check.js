'use strict';
/**
 * 消息接收入口 端到端自测
 * 覆盖：店铺接入口生成 → 买家发消息（免登录）→ 工作台增量可见 → AI/工作流回复 → 买家端可见 → Webhook 转发
 * 用法：node tools/inbox-check.js
 */
const BASE = process.env.BASE || 'http://127.0.0.1:8787';

let cookie = '';
const log = (...a) => console.log(...a);
let pass = 0;
let fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; log('  ✔ ' + name, extra === undefined ? '' : extra); }
  else { fail++; log('  ✘ ' + name, extra === undefined ? '' : extra); }
}

async function api(method, path, body, withAuth = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (withAuth && cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  let json = null;
  try { json = await res.json(); } catch (e) { json = { _text: await res.text() }; }
  return { status: res.status, json };
}

(async () => {
  log('\n=== 消息接收链路自测 ===\n');

  /* 1. 登录 */
  const login = await api('POST', '/api/auth/login', { email: 'admin@xiaoman.ai', password: 'xiaoman123' }, false);
  check('登录成功', login.status === 200 && login.json.ok, login.json.error || '');
  if (!login.json.ok) process.exit(1);

  /* 2. 取店铺与接入口 */
  const boot = await api('GET', '/api/bootstrap');
  const stores = (boot.json.stores || []).filter((s) => s.inbox && s.inbox.code);
  check('店铺已生成咨询接入口', stores.length > 0, stores.length ? stores[0].name + ' → /c/' + stores[0].inbox.code : '无');
  if (!stores.length) process.exit(1);
  const store = stores[0];
  const code = store.inbox.code;

  const detail = await api('GET', `/api/stores/${store.id}/inbox`);
  check('接入口详情含 Webhook 地址', Boolean(detail.json.inbox && detail.json.inbox.api_url), detail.json.inbox ? detail.json.inbox.api_url : '');
  const token = detail.json.inbox.token;

  /* 3. 免登录拿店铺信息（买家端首屏） */
  const info = await api('GET', `/api/inbox/${code}`, null, false);
  check('买家端可读取店铺信息（免登录）', info.status === 200 && info.json.ok, info.json.store ? info.json.store.name : info.json.error);

  /* 4. 模拟买家发消息（完全免登录） */
  const visitor = 'v_test_' + Date.now().toString(36);
  const askText = '我拍的T恤什么时候发货？急用，能催一下吗';
  const sent = await api('POST', `/api/inbox/${code}/messages`, { visitor, name: '买家小李', text: askText }, false);
  check('买家消息发送成功', sent.status === 200 && sent.json.ok, sent.json.error || ('conv=' + sent.json.convId));
  const convId = sent.json.convId;

  /* 5. 工作台增量能看到新会话与新消息 */
  const feed = await api('GET', '/api/conversations/feed?since=' + new Date(Date.now() - 10000).toISOString());
  const hasConv = (feed.json.conversations || []).some((c) => c.id === convId);
  const feedConv = (feed.json.conversations || []).find((c) => c.id === convId);
  const hasMsg = Boolean(feedConv && (feedConv.messages || []).some((m) => m.role === 'customer'));
  check('工作台增量拿到新会话', hasConv);
  check('工作台增量拿到顾客消息', hasMsg);

  /* 6. 自动回复（工作流优先，其次 AI 首响） */
  const replied = Boolean(sent.json.aiReply);
  check('消息到达后自动回复', replied, sent.json.flowRun ? '工作流：' + sent.json.flowRun.flowName + ' / ' + sent.json.flowRun.intent : (sent.json.aiReply ? 'AI 首响' : '未触发（检查 AI 配置与工作流开关）'));
  if (replied) log('     回复内容：' + String(sent.json.aiReply).slice(0, 80) + '…');

  /* 7. 买家端能看到 AI / 客服回复 */
  const pulled = await api('GET', `/api/inbox/${code}/messages?visitor=${visitor}&after=0`, null, false);
  const roles = (pulled.json.messages || []).map((m) => m.role);
  check('买家端可拉取会话消息', pulled.json.ok && pulled.json.messages.length > 0, '角色序列：' + roles.join(' → '));
  check('买家端收到非本人回复', roles.some((r) => r === 'ai' || r === 'agent'));

  /* 8. 通用 Webhook：外部系统转发消息 */
  const hook = await api('POST', `/api/hooks/inbox/${token}`, {
    text: '订单什么时候能到？', name: '王女士', visitor: 'v_hook_' + Date.now().toString(36),
    channel: 'webhook', order_no: 'T20261031001', product: '纯棉T恤',
  }, false);
  check('Webhook 转发消息成功', hook.status === 200 && hook.json.ok, hook.json.error || ('conv=' + hook.json.convId));

  /* 9. 令牌错误必须拒绝 */
  const bad = await api('POST', '/api/hooks/inbox/ik_wrong_token', { text: 'hi' }, false);
  check('无效 Webhook 令牌被拒绝', bad.status === 404);

  /* 10. 消息接收诊断 */
  const diag = await api('GET', `/api/stores/${store.id}/inbox-diagnosis`);
  check('消息接收诊断可用', diag.status === 200 && Array.isArray(diag.json.issues), (diag.json.issues || []).map((i) => i.title).join(' | '));

  /* 清理本次测试产生的会话，避免污染演示数据（回归断言会话数量固定） */
  try {
    const db = require('../lib/db');
    const ids = [convId, hook.json && hook.json.convId].filter(Boolean);
    for (const id of ids) {
      db.run('DELETE FROM messages WHERE conv_id = ?', id);
      db.run('DELETE FROM conversations WHERE id = ?', id);
    }
    db.run("DELETE FROM notifications WHERE type = 'inbox' AND body LIKE '%买家小李%'");
    db.run("DELETE FROM notifications WHERE type = 'inbox' AND body LIKE '%王女士%'");
    log('  · 已清理测试会话 ' + ids.length + ' 个');
  } catch (e) { log('  ! 清理失败：' + e.message); }

  log(`\n结果：通过 ${pass} / 失败 ${fail}\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常：', e); process.exit(1); });
