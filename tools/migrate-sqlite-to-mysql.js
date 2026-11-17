'use strict';
/**
 * 一次性迁移：SQLite（data/xiaoman.db） -> MySQL
 *
 * 用途：项目早期用 SQLite 存过数据，切到 MySQL 后把老数据带过去。
 * 幂等：使用 INSERT IGNORE，重复执行不会产生重复行。
 *
 * 用法：
 *   node tools/migrate-sqlite-to-mysql.js
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const DB_FILE = process.env.DB_FILE || path.join(ROOT, 'data', 'xiaoman.db');

if (!fs.existsSync(DB_FILE)) {
  console.log('[跳过] 没有找到 SQLite 文件：' + DB_FILE);
  process.exit(0);
}

const { DatabaseSync } = require('node:sqlite');
const dbm = require('../lib/db');

if (dbm.driver !== 'mysql') {
  console.error('[中止] 当前驱动不是 MySQL（' + dbm.driver + '），无法迁移');
  process.exit(1);
}

const sqlite = new DatabaseSync(DB_FILE);

// 按外键/引用顺序迁移
const TABLES = [
  'tenants', 'users', 'sessions', 'stores', 'conversations', 'messages',
  'tickets', 'ticket_events', 'knowledge', 'quick_replies', 'settings',
  'audit_logs', 'conv_ai_logs', 'qc_reviews', 'notifications', 'materials',
  'alerts', 'agent_flows',
];

const q = (name) => '`' + name + '`';

let total = 0;
for (const table of TABLES) {
  let rows = [];
  try {
    rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
  } catch (e) {
    console.log(`[跳过] ${table}：源表不存在`);
    continue;
  }
  if (!rows.length) {
    console.log(`[空]   ${table}`);
    continue;
  }

  const cols = Object.keys(rows[0]);
  const placeholders = cols.map(() => '?').join(',');
  const sql =
    `INSERT IGNORE INTO ${table} (${cols.map(q).join(',')}) VALUES (${placeholders})`;

  let ok = 0;
  for (const r of rows) {
    try {
      dbm.run(sql, ...cols.map((c) => (r[c] === undefined ? null : r[c])));
      ok += 1;
    } catch (e) {
      console.error(`[失败] ${table}: ${e.message.slice(0, 160)}`);
      break;
    }
  }
  total += ok;
  console.log(`[迁移] ${table.padEnd(16)} ${ok}/${rows.length}`);
}

console.log('');
console.log(`完成：共写入 ${total} 行到 ${dbm.label}`);

// 校验
for (const table of TABLES) {
  try {
    const n = dbm.get(`SELECT COUNT(*) AS n FROM ${table}`).n;
    process.stdout.write(`${table}=${n}  `);
  } catch (e) { /* ignore */ }
}
console.log('');
try { sqlite.close(); } catch (e) { /* ignore */ }
process.exit(0);
