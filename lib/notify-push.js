/**
 * 通知群真实推送
 * 企业微信 / 钉钉 / 飞书 的「群机器人」均通过 Webhook 地址接收消息。
 * 用户在自己群里添加官方机器人 -> 拿到 Webhook 地址 -> 粘贴进本系统 -> 绑定。
 * 之后站内产生的预警/质检类通知会按平台格式真实推送到该群。
 */
const { all, run, nowISO } = require('./db');

const CHANNELS = {
  wecom:    { label: '企业微信（VX群）', icon: 'fa-weixin',     test: '【小满AI】通知群已成功连接 ✅' },
  dingtalk: { label: '钉钉',          icon: 'fa-comment',     test: '【小满AI】通知群已成功连接 ✅' },
  feishu:   { label: '飞书',          icon: 'fa-paper-plane', test: '【小满AI】通知群已成功连接 ✅' },
};

function buildPayload(channel, title, body) {
  const safe = String(body || '').replace(/\n/g, '\n> ');
  if (channel === 'wecom') {
    return { msgtype: 'markdown', markdown: { content: `### ${title}\n> ${safe}` } };
  }
  if (channel === 'dingtalk') {
    return { msgtype: 'markdown', markdown: { title, text: `### ${title}\n> ${safe}` } };
  }
  // feishu
  return { msgtype: 'text', content: { text: `${title}\n${body || ''}` } };
}

async function sendOne(group, title, body) {
  if (!group.webhook_url || !/^https?:\/\//i.test(group.webhook_url)) {
    throw new Error('群未配置有效的 Webhook 地址');
  }
  const payload = buildPayload(group.channel, title, body);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  let res;
  try {
    res = await fetch(group.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const txt = await res.text().catch(() => '');
  // 企业微信：成功返回 {"errcode":0,"errmsg":"ok"}；其他错误带非 0 errcode
  if (group.channel === 'wecom') {
    try {
      const j = JSON.parse(txt);
      if (j && j.errcode && Number(j.errcode) !== 0) {
        throw new Error('企业微信返回错误：' + (j.errmsg || txt.slice(0, 200)));
      }
    } catch (e) { if (e.message.includes('企业微信')) throw e; }
  }
  if (!res.ok) throw new Error('推送失败：HTTP ' + res.status + (txt ? ' ' + txt.slice(0, 200) : ''));
  return true;
}

/** 测试连通并绑定：发送一条测试消息，成功则标记 active */
async function testGroup(tenantId, groupId) {
  const rows = all('SELECT * FROM notify_groups WHERE id = ? AND tenant_id = ?', groupId, tenantId);
  const g = rows && rows[0];
  if (!g) throw new Error('通知群不存在');
  await sendOne(g, '🔔 连接测试', (CHANNELS[g.channel] && CHANNELS[g.channel].test) || '您的通知群已成功连接 ✅');
  run('UPDATE notify_groups SET status=?, notify_count=notify_count+1, last_notify_at=? WHERE id=?',
    'active', nowISO(), g.id);
  return true;
}

/** 自动推送：通知产生时调用（fire-and-forget，单群失败不影响其他群/主流程） */
function pushToGroups(tenantId, opts) {
  const { title = '', body = '', level = 'info', type = '' } = opts || {};
  // 仅推送预警/质检类（warning / error / critical），避免刷屏
  if (!['warning', 'error', 'critical'].includes(level)) return;
  Promise.resolve().then(async () => {
    try {
      const groups = all('SELECT * FROM notify_groups WHERE tenant_id = ? AND status = ?', tenantId, 'active');
      for (const g of groups) {
        if (!g.webhook_url) continue;
        try {
          await sendOne(g, title, body);
          run('UPDATE notify_groups SET notify_count=notify_count+1, last_notify_at=? WHERE id=?', nowISO(), g.id);
        } catch (e) { /* 单群失败不影响其他群 */ }
      }
    } catch (e) { /* ignore */ }
  });
}

module.exports = { CHANNELS, buildPayload, sendOne, testGroup, pushToGroups };
