'use strict';
/**
 * 浏览器消息桥 · 回写出队列（Bridge Outbox）
 * ------------------------------------------------------------------
 * 与「收消息」相对的一半：把回复送回平台聊天窗口。
 *
 * 背景：拼多多/淘宝的客服聊天 API 不对外开放（需服务市场签约），
 * 所以回写走浏览器扩展——工作台产生的回复（AI 首响 / 工作流 / 人工客服）
 * 先入本队列，扩展在商家后台页面轮询取走，自动找到对应买家会话、
 * 填入输入框并点击发送，买家在平台侧即可看到回复。
 *
 * 只对「网页桥接」来源（channel 以 web_ 开头）的会话生效，
 * 咨询页 / Webhook 会话本身有自己的回传通道，不入此队列。
 */
const db = require('./db');
const { get, all, run, nowISO } = db;

/** 该会话是否来自浏览器桥（拼多多/千牛等网页监听） */
function isBridgeChannel(channel) {
  return String(channel || '').indexOf('web_') === 0;
}

/**
 * 把一条待回写的回复入队
 * @param {object} p { tenantId, storeId, convId, visitorId, customer, text }
 * @returns {number|null} 队列 id；不该入队时返回 null
 */
function enqueue(p) {
  const text = String(p.text || '').trim();
  if (!text) return null;
  if (!isBridgeChannel(p.channel)) return null;
  /* 同一会话相同文本 30 秒内不重复入队（AI + 工作流双触发兜底） */
  const dup = get(
    `SELECT id FROM bridge_outbox
      WHERE conv_id = ? AND text = ? AND created_at >= ? LIMIT 1`,
    p.convId, text, new Date(Date.now() - 30000).toISOString()
  );
  if (dup) return dup.id;
  run(
    `INSERT INTO bridge_outbox (tenant_id,store_id,conv_id,visitor_id,customer,text,status,created_at)
     VALUES (?,?,?,?,?,?,'pending',?)`,
    p.tenantId, p.storeId, p.convId, String(p.visitorId || ''), String(p.customer || '').slice(0, 120),
    text.slice(0, 2000), nowISO()
  );
  const row = get('SELECT MAX(id) AS id FROM bridge_outbox WHERE conv_id = ?', p.convId);
  return row ? row.id : null;
}

/** 便捷入口：按会话 id 入队（自动带出租户/店铺/渠道判断） */
function enqueueForConv(convId, text) {
  const conv = get('SELECT id,tenant_id,store_id,visitor_id,customer,channel FROM conversations WHERE id = ?', convId);
  if (!conv || !isBridgeChannel(conv.channel)) return null;
  return enqueue({
    tenantId: conv.tenant_id, storeId: conv.store_id, convId: conv.id,
    visitorId: conv.visitor_id, customer: conv.customer, channel: conv.channel, text,
  });
}

/** 扩展轮询：取某店铺待回写的回复（最多 10 条，不标记，等 ack）
 *  附带 last_customer：该会话最后一条「客户文字」，扩展据此确认当前打开的
 *  聊天窗口确实是这位买家（拼多多会话列表常为空/懒加载，按名字切不到时用内容校验）。*/
function pending(storeId, limit = 10) {
  return all(
    `SELECT o.id, o.conv_id, o.visitor_id, o.customer, o.text, o.created_at,
            (SELECT m.text FROM messages m
              WHERE m.conv_id = o.conv_id AND m.role = 'customer' AND m.kind = 'text'
              ORDER BY m.id DESC LIMIT 1) AS last_customer
       FROM bridge_outbox o
      WHERE o.store_id = ? AND o.status = 'pending'
      ORDER BY o.id ASC LIMIT ?`,
    storeId, Math.min(Number(limit) || 10, 50)
  );
}

/**
 * 扩展回执：标记发送结果
 * @param {string} storeId
 * @param {number[]} sentIds   已成功发送的 id
 * @param {Array<{id:number,error:string}>} failed 发送失败的
 */
function ack(storeId, sentIds = [], failed = []) {
  const now = nowISO();
  let sent = 0;
  for (const id of sentIds || []) {
    run(
      `UPDATE bridge_outbox SET status = 'sent', sent_at = ? WHERE id = ? AND store_id = ? AND status = 'pending'`,
      now, Number(id) || 0, storeId
    );
    sent++;
  }
  for (const f of failed || []) {
    run(
      `UPDATE bridge_outbox SET status = 'failed', error = ? WHERE id = ? AND store_id = ? AND status = 'pending'`,
      String((f && f.error) || '').slice(0, 500), Number(f && f.id) || 0, storeId
    );
  }
  return { sent, failed: (failed || []).length };
}

/** 发送失败/超时（10 分钟未取走）的可以重新挂起，避免丢回复 */
function requeueStale(storeId) {
  run(
    `UPDATE bridge_outbox SET status = 'pending'
      WHERE store_id = ? AND status = 'failed' AND created_at >= ?`,
    storeId, new Date(Date.now() - 10 * 60 * 1000).toISOString()
  );
}

module.exports = { isBridgeChannel, enqueue, enqueueForConv, pending, ack, requeueStale };
