'use strict';
/**
 * 数据库连通性自检
 *   node tools/db-check.js
 *
 * 会打印：当前驱动、连接目标、18 张表的行数、以及一条中文读写往返测试。
 */
const dbm = require('../lib/db');

const info = dbm.info();

console.log('');
console.log('  数据库自检');
console.log('  ──────────────────────────────────────────');
console.log('  驱动      ' + info.driver);
console.log('  目标      ' + info.label);
for (const n of info.notes) console.log('  说明      ' + n);
if (info.mysql) {
  console.log('  地址      ' + info.mysql.host + ':' + info.mysql.port);
  console.log('  账号      ' + info.mysql.user);
  console.log('  库名      ' + info.mysql.database);
}
console.log('  ──────────────────────────────────────────');

const TABLES = [
  'tenants', 'users', 'sessions', 'stores', 'conversations', 'messages',
  'tickets', 'ticket_events', 'knowledge', 'quick_replies', 'settings',
  'audit_logs', 'conv_ai_logs', 'qc_reviews', 'notifications', 'materials',
  'alerts', 'agent_flows',
];

let total = 0;
for (const t of TABLES) {
  const n = dbm.get('SELECT COUNT(*) AS n FROM ' + t).n;
  total += n;
  console.log('  ' + t.padEnd(16) + String(n).padStart(6) + ' 行');
}
console.log('  ──────────────────────────────────────────');
console.log('  合计              ' + String(total).padStart(6) + ' 行');

/* 中文读写往返测试（临时表，用完即删） */
try {
  dbm.run('CREATE TABLE IF NOT EXISTS __ping (id INT PRIMARY KEY, txt VARCHAR(64), n INT)');
  dbm.run('DELETE FROM __ping');
  const sample = '中文写入测试·小满AI';
  dbm.run('INSERT INTO __ping (id, txt, n) VALUES (?,?,?)', 1, sample, 42);
  const back = dbm.get('SELECT txt, n FROM __ping WHERE id = ?', 1);
  const okUtf8 = back && back.txt === sample;
  console.log('  中文往返  ' + (okUtf8 ? '正常（' + back.txt + '）' : '异常：' + JSON.stringify(back)));
  dbm.run('DROP TABLE __ping');
} catch (e) {
  console.log('  中文往返  跳过（' + e.message.slice(0, 60) + '）');
}

console.log('');
