'use strict';
/**
 * TMC 消息轮询器
 *
 * 淘宝的消息服务支持「API 拉取消费」，所以本机没有公网域名也能收真实消息。
 * 只对 auth_status=active 且拿到 session 的店铺轮询；串行执行，避免把接口
 * 流量包打空。间隔由 TMC_POLL_MS 控制，设为 0 可关闭。
 */
const db = require('./db');
const storeAuth = require('./store-auth');
const sync = require('./sync');

let timer = null;
let running = false;
let lastRunAt = null;
let lastResult = null;

async function tick() {
  if (running) return;
  running = true;
  const started = Date.now();
  const summary = { at: db.nowISO(), stores: 0, fresh: 0, errors: [] };
  try {
    const rows = db.all(
      "SELECT store_id FROM store_credentials WHERE auth_status = 'active' AND session_enc IS NOT NULL AND session_enc <> ''"
    );
    for (const r of rows) {
      try {
        const res = await sync.pullMessages(r.store_id, { quantity: 100 });
        summary.stores += 1;
        summary.fresh += res.fresh;
      } catch (e) {
        summary.errors.push({ store: r.store_id, code: e.code || '', message: String(e.message).slice(0, 160) });
      }
    }
  } catch (e) {
    summary.errors.push({ store: '-', message: String(e.message).slice(0, 160) });
  } finally {
    running = false;
    lastRunAt = summary.at;
    lastResult = { ...summary, ms: Date.now() - started };
  }
}

function start(intervalMs) {
  const ms = Number(intervalMs || 0);
  if (!ms || ms < 5000) return { started: false, reason: 'TMC_POLL_MS 未开启或过小' };
  if (timer) return { started: true, intervalMs: ms };
  timer = setInterval(() => { tick().catch(() => {}); }, ms);
  if (timer.unref) timer.unref();
  setTimeout(() => { tick().catch(() => {}); }, 3000).unref?.();
  return { started: true, intervalMs: ms };
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

function status() {
  return { running, last_run_at: lastRunAt, last_result: lastResult };
}

module.exports = { start, stop, status, tick };
