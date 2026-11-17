/* 把每个会话的列表预览(last_msg/last_time)改为该会话「最近一条客户消息」 */
const db = require('../lib/db');
(async () => {
  const convs = await db.all('SELECT id, customer, last_msg FROM conversations');
  let fixed = 0;
  for (const cv of convs) {
    const msgs = await db.all(
      "SELECT text, time, kind FROM messages WHERE conv_id = ? AND role = 'customer' ORDER BY id DESC LIMIT 1",
      cv.id
    );
    if (!msgs.length) continue; // 没有客户消息的会话不动
    const m = msgs[0];
    const shown = m.text || (m.kind === 'order' ? '[订单卡片]' : '');
    if (!shown) continue;
    if (cv.last_msg !== shown) {
      await db.run('UPDATE conversations SET last_msg = ?, last_time = ? WHERE id = ?', shown.slice(0, 100), m.time, cv.id);
      fixed++;
    }
  }
  console.log('修正会话数:', fixed, '/', convs.length);
  const check = await db.all('SELECT customer, last_msg, last_time FROM conversations ORDER BY updated_at DESC LIMIT 8');
  check.forEach((r) => console.log(' -', r.customer, '|', String(r.last_msg || '').slice(0, 30), '|', r.last_time));
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
