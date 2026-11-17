/* 端到端验证：通知群真实连通 + 按平台格式化推送 */
const http = require('http');
const { get } = require('../lib/db');
const { pushToGroups } = require('../lib/notify-push');

const BASE = 'http://127.0.0.1:8787';
const MOCK_PORT = 8899;
const received = []; // { channel, payload }

function startMock() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        let payload = null;
        try { payload = JSON.parse(body); } catch (e) {}
        received.push({ path: req.url, payload });
        // 模拟企业微信成功响应
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ errcode: 0, errmsg: 'ok' }));
      });
    });
    srv.listen(MOCK_PORT, () => resolve(srv));
  });
}

async function login() {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@xiaoman.ai', password: 'xiaoman123' }),
  });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  return sc.map((s) => s.split(';')[0]).join('; ');
}
async function api(cookie, method, url, body) {
  const r = await fetch(BASE + url, {
    method, headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

(async () => {
  const srv = await startMock();
  const cookie = await login();
  const tenant = get('SELECT tenant_id FROM users WHERE email = ?', 'admin@xiaoman.ai').tenant_id;
  console.log('tenant =', tenant);

  const channels = ['wecom', 'dingtalk', 'feishu'];
  let pass = 0, fail = 0;
  const assert = (cond, msg) => { if (cond) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗', msg); } };

  for (const ch of channels) {
    console.log(`\n[${ch}] 创建并测试连通`);
    const webhook = `http://127.0.0.1:${MOCK_PORT}/${ch}`;
    const created = await api(cookie, 'POST', '/api/notify-groups', { name: '测试-' + ch, channel: ch, webhook_url: webhook });
    assert(created.json.ok === true, '创建通知群成功');
    const id = created.json.id;
    const test = await api(cookie, 'POST', `/api/notify-groups/${id}/test`, {});
    assert(test.json.ok === true, '测试连通返回 ok');
    const got = received.find((r) => r.path === '/' + ch);
    assert(!!got, '模拟群机器人收到了真实 POST');
    if (got) {
      if (ch === 'wecom') assert(got.payload && got.payload.msgtype === 'markdown' && got.payload.markdown.content.includes('连接测试'), '企业微信格式为 markdown');
      if (ch === 'dingtalk') assert(got.payload && got.payload.msgtype === 'markdown' && got.payload.markdown.title, '钉钉格式为 markdown(带title)');
      if (ch === 'feishu') assert(got.payload && got.payload.msgtype === 'text' && got.payload.content.text, '飞书格式为 text');
    }
  }

  console.log('\n[自动推送] 预警类通知应推送到已绑定群');
  const before = received.length;
  pushToGroups(tenant, { title: '退款预警', body: '订单 123 申请退款', level: 'warning', type: 'store' });
  await new Promise((r) => setTimeout(r, 1200));
  assert(received.length > before, `预警通知已推送（收到 ${received.length - before} 条）`);

  console.log('\n[自动推送] info 类通知不应推送');
  const beforeInfo = received.length;
  pushToGroups(tenant, { title: '普通消息', body: 'hello', level: 'info', type: 'store' });
  await new Promise((r) => setTimeout(r, 800));
  assert(received.length === beforeInfo, 'info 级未推送（符合预期）');

  console.log('\n[错误处理] 无效 Webhook 地址应返回失败');
  const bad = await api(cookie, 'POST', '/api/notify-groups', { name: '坏地址', channel: 'wecom', webhook_url: 'http://127.0.0.1:1/' });
  assert(bad.json.ok === true, '坏地址群创建成功（pending）');
  const badTest = await api(cookie, 'POST', `/api/notify-groups/${bad.json.id}/test`, {});
  assert(badTest.json.ok === false && badTest.json.error, '测试连通返回失败并带错误信息: ' + (badTest.json.error || ''));

  srv.close();
  console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
