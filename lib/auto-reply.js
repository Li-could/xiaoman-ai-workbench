'use strict';
/**
 * 会话 AI 自动接管
 * ------------------------------------------------------------------
 * 顾客新消息到达（站内模拟 / 平台 TMC 同步）时，若会话处于 AI 接待模式
 * （conversations.status = 'ai'）且租户开启了 AI 自动回复，
 * 则结合店铺知识与当前订单生成一条 AI 回复并落库（role='ai'）。
 * 「转人工」把会话状态切回 human 即停止；「转AI」切回 ai 即恢复。
 */
const { get, all, run, nowISO, nowHM, getSetting } = require('./db');
const llm = require('./llm');

/** 组装服务端系统提示：店铺信息助手资料 + 店铺知识 + 当前订单 */
function buildSystemPrompt(tenantId, conv, cfg) {
  const store = conv.store_id ? get('SELECT name, platform FROM stores WHERE id = ?', conv.store_id) : null;
  const profile = getSetting(tenantId, 'shop-profile', {}) || {};
  const kb = all(
    "SELECT question, answer FROM store_knowledge WHERE tenant_id = ? AND store_id = ? AND status = 'on' LIMIT 6",
    tenantId, conv.store_id || ''
  );

  const lines = [
    `你是「${store ? store.name : '小满店铺'}」${profile.nickname ? '客服' + profile.nickname : '的 AI 客服助手'}，` +
    `语气${profile.tone || cfg.tone || '亲切'}，直接输出发给顾客的一段话，不要任何解释与前后缀。`,
  ];
  if (profile.welcome) lines.push(`欢迎语口径：${profile.welcome}`);
  const couriers = (profile.couriers || []).filter(Boolean).join('、');
  if (couriers) lines.push(`合作快递：${couriers}${profile.allowSpecify ? '；' + profile.allowSpecify : ''}`);
  if (profile.shipTime) lines.push(`发货时效：${profile.shipTime}`);
  if (profile.freeShipping) lines.push(`包邮说明：${profile.freeShipping}${profile.remoteNote ? '；' + profile.remoteNote : ''}`);
  if (profile.returnWindow) lines.push(`退换规则：${profile.returnWindow}`);
  if (profile.quality) lines.push(`质量问题处理：${profile.quality}`);
  if (profile.freight) lines.push(`运费承担：${profile.freight}`);
  kb.forEach((k) => { if (k.answer) lines.push(`知识：${(k.question || '').slice(0, 40)} → ${String(k.answer).slice(0, 120)}`); });
  if (conv.order_no) {
    lines.push(`当前订单：${conv.order_product || '商品'}，单号 ${conv.order_no}，金额 ￥${conv.order_amount || '—'}，状态「${conv.order_status || '待发货'}」。回答物流/售后问题时务必结合该订单。`);
  }
  lines.push('约束：单次回复控制在 120 字以内；不承诺规则外的赔付；拿不准的售后问题建议顾客稍等人工跟进。');
  return lines.join('\n');
}

/**
 * 顾客消息到达后尝试自动回复
 * @returns {Promise<string>} 生成的回复文本；未触发（非 AI 模式等）返回 ''
 */
async function maybeAutoReply(tenantId, convId) {
  try {
    const conv = get('SELECT * FROM conversations WHERE id = ? AND tenant_id = ?', convId, tenantId);
    if (!conv || conv.status !== 'ai') return '';
    const cfg = llm.getAiConfig(tenantId);
    if (!cfg.autoReply) return '';

    const rows = all(
      'SELECT role, text FROM messages WHERE tenant_id = ? AND conv_id = ? ORDER BY id DESC LIMIT 12',
      tenantId, convId
    ).reverse();
    if (!rows.length) return '';
    const last = rows[rows.length - 1];
    if (last.role !== 'customer') return ''; // 只回应顾客的最新消息，防止自回

    const history = rows.map((m) => ({
      role: m.role === 'customer' ? 'user' : 'assistant',
      content: m.text,
    }));
    const reply = await llm.completeChat(cfg, [
      { role: 'system', content: buildSystemPrompt(tenantId, conv, cfg) },
      ...history,
    ], {
      mode: 'chat',
      meta: { product: conv.order_product, orderNo: conv.order_no, amount: conv.order_amount },
    });
    const text = String(reply || '').trim();
    if (!text) return '';

    const time = nowHM();
    run('INSERT INTO messages (tenant_id,conv_id,role,text,time,kind,payload,created_at) VALUES (?,?,?,?,?,?,?,?)',
      tenantId, convId, 'ai', text.slice(0, 2000), time, 'text', null, nowISO());
    /* AI 回复不覆盖列表预览（last_msg 保留客户最近说的话），仅清未读并刷新排序时间 */
    run('UPDATE conversations SET unread = 0, updated_at = ? WHERE id = ?', nowISO(), convId);
    try {
      run('INSERT INTO conv_ai_logs (tenant_id,conv_id,mode,adopted,created_at) VALUES (?,?,?,1,?)',
        tenantId, convId, 'auto', nowISO());
    } catch (e) { /* 日志失败不影响回复 */ }
    return text;
  } catch (e) {
    console.warn('[auto-reply]', e.message);
    return '';
  }
}

module.exports = { maybeAutoReply, buildSystemPrompt };
