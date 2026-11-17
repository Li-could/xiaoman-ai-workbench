'use strict';
/**
 * AI Agent 工作流引擎（消息触发型）
 * ------------------------------------------------------------------
 * 顾客消息到达时立刻执行：
 *   1. 读取该租户已启用的工作流（agent_flows.enabled = 1）
 *   2. 按关键词/意图匹配：催发货安抚、退款挽单、售后自动分派；
 *      其余消息由「智能首响 · 全平台」兜底（结合店铺知识与当前订单回答）
 *   3. 调用大模型生成针对订单/商品问题的回复并落库（role='ai'）
 *   4. 工作流 runs 真实 +1，并写入 flow_runs 运行记录（画布/列表可见）
 *
 * 与「转AI」的关系：工作流是自动化规则，只要启用就对触发条件生效；
 * 未命中任何工作流且会话处于 AI 接待模式时，由 auto-reply 兜底连续回复。
 */
const { get, all, run, nowISO, nowHM } = require('./db');
const llm = require('./llm');
const { buildSystemPrompt } = require('./auto-reply');

/* 意图 → 工作流匹配（按 flow 名称关键词定位种子/自建工作流） */
const INTENT_RULES = [
  {
    intent: '催发货', flowKey: /催发货|发货安抚/,
    match: /发货|催一?下|催催|几天|什么时候发|啥时候发|多久|物流|快递|到哪|还没发|揽收|派送/,
    directive: '顾客在催发货/询问物流。请结合当前订单状态与发货时效，先安抚情绪，再给出明确的发货/到货时间承诺；若订单已发货，告知快递与最新节点。',
  },
  {
    intent: '退款挽单', flowKey: /退款|挽单/,
    match: /退款|退货|退钱|退掉|不想要|申请退|仅退款|退货退款/,
    directive: '顾客想退款/退货。先询问具体原因并表达理解；若非质量问题，结合店铺退换规则尝试挽单（如小额补偿券）；语气诚恳，不要强硬拒绝。',
  },
  {
    intent: '售后问题', flowKey: /售后|分派/,
    match: /售后|投诉|质量|坏了|破损|开线|瑕疵|假货|315|赔偿/,
    directive: '顾客反馈售后/质量问题。先致歉并确认问题细节（可请顾客发照片），说明店铺售后政策与处理时效，让顾客放心会有人跟进到底。',
  },
];

/** 通用兜底工作流（智能首响） */
const FALLBACK_FLOW_KEY = /首响|全平台/;

/**
 * 顾客消息触发工作流
 * @returns {Promise<{flowId:string,flowName:string,intent:string,reply:string}|null>}
 *          命中的工作流执行结果；未命中/未启用任何流程返回 null
 */
async function handleCustomerMessage(tenantId, convId) {
  try {
    const conv = get('SELECT * FROM conversations WHERE id = ? AND tenant_id = ?', convId, tenantId);
    if (!conv) return null;

    const lastMsg = get(
      'SELECT role, text FROM messages WHERE tenant_id = ? AND conv_id = ? ORDER BY id DESC LIMIT 1',
      tenantId, convId
    );
    if (!lastMsg || lastMsg.role !== 'customer') return null; // 只响应顾客最新消息
    const text = String(lastMsg.text || '');

    const flows = all(
      'SELECT * FROM agent_flows WHERE tenant_id = ? AND enabled = 1 ORDER BY sort ASC, rowid ASC',
      tenantId
    );
    if (!flows.length) return null;

    /* 1) 意图匹配 */
    let flow = null;
    let intent = '咨询';
    let directive = '顾客咨询订单或商品问题。请结合店铺知识与当前订单，直接、准确地回答；不知道的信息不要编造，可请顾客稍等人工确认。';
    for (const rule of INTENT_RULES) {
      if (!rule.match.test(text)) continue;
      const f = flows.find((x) => rule.flowKey.test(x.name));
      if (f) { flow = f; intent = rule.intent; directive = rule.directive; break; }
    }
    /* 2) 兜底：智能首响（triggerType = message 的流程） */
    if (!flow) {
      flow = flows.find((x) => FALLBACK_FLOW_KEY.test(x.name))
        || flows.find((x) => x.trigger_type === 'message');
    }
    if (!flow) return null;

    /* 3) 生成回复（店铺资料 + 知识库 + 当前订单 + 流程指令） */
    const cfg = llm.getAiConfig(tenantId);
    const history = all(
      'SELECT role, text FROM messages WHERE tenant_id = ? AND conv_id = ? ORDER BY id DESC LIMIT 12',
      tenantId, convId
    ).reverse().map((m) => ({
      role: m.role === 'customer' ? 'user' : 'assistant',
      content: m.text,
    }));
    const reply = await llm.completeChat(cfg, [
      { role: 'system', content: buildSystemPrompt(tenantId, conv, cfg) + '\n\n【当前执行工作流：' + flow.name + '】\n' + directive },
      ...history,
    ], {
      mode: 'chat',
      meta: { product: conv.order_product, orderNo: conv.order_no, amount: conv.order_amount },
    });
    const answer = String(reply || '').trim();
    if (!answer) return null;

    /* 4) 落库：回复消息 + 会话刷新 + 运行记录 + 计数 */
    const time = nowHM();
    run('INSERT INTO messages (tenant_id,conv_id,role,text,time,kind,payload,created_at) VALUES (?,?,?,?,?,?,?,?)',
      tenantId, convId, 'ai', answer.slice(0, 2000), time, 'text', null, nowISO());
    /* 回复是「我们发出去的话」，不覆盖列表预览（last_msg 始终保留客户最近说的话），只刷新排序时间 */
    run('UPDATE conversations SET updated_at = ? WHERE id = ?', nowISO(), convId);
    run('UPDATE agent_flows SET runs = runs + 1 WHERE id = ?', flow.id);
    run('INSERT INTO flow_runs (tenant_id,flow_id,flow_name,conv_id,customer,intent,trigger_text,reply,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      tenantId, flow.id, flow.name, convId, conv.customer || '', intent, text.slice(0, 500), answer.slice(0, 1000), nowISO());

    return { flowId: flow.id, flowName: flow.name, intent, reply: answer, time };
  } catch (e) {
    console.warn('[flow-engine]', e.message);
    return null;
  }
}

/** 工作流最近运行记录 */
function recentRuns(tenantId, flowId, limit = 10) {
  if (flowId) {
    return all('SELECT * FROM flow_runs WHERE tenant_id = ? AND flow_id = ? ORDER BY id DESC LIMIT ?',
      tenantId, flowId, limit);
  }
  return all('SELECT * FROM flow_runs WHERE tenant_id = ? ORDER BY id DESC LIMIT ?', tenantId, limit);
}

module.exports = { handleCustomerMessage, recentRuns };
