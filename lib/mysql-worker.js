'use strict';
/**
 * MySQL 同步桥 —— 工作线程侧
 *
 * 为什么需要它：整个业务代码（server.js / lib/*.js）是按「同步数据库」写的
 * （node:sqlite 本身就是同步 API）。mysql2 只有异步 API，为了不把 90+ 处
 * 调用点全部改成 async/await（极易漏 await 造成静默 bug），这里用一个
 * worker_threads + SharedArrayBuffer/Atomics 的同步桥接：
 *
 *   主线程 postMessage(sql) → Atomics.wait 阻塞
 *   工作线程执行查询 → postMessage(结果) → Atomics.notify 唤醒主线程
 *
 * 语义与原来的 SQLite 同步调用完全一致，主线程仍然一次只跑一条 SQL。
 */
const { workerData } = require('worker_threads');
const mysql = require('mysql2/promise');

const { port, signalSab, cfg } = workerData;
const signal = new Int32Array(signalSab);

function notify() {
  Atomics.store(signal, 0, 1);
  Atomics.notify(signal, 0);
}

let pool = null;

async function init() {
  // 1) 先不带库名连接，确保目标库存在
  const boot = await mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    charset: 'utf8mb4',
    connectTimeout: cfg.connectTimeout || 8000,
  });
  await boot.query(
    'CREATE DATABASE IF NOT EXISTS `' + String(cfg.database).replace(/`/g, '') + '` ' +
    'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  );
  await boot.end();

  // 2) 建连接池
  pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: cfg.connectionLimit || 8,
    queueLimit: 0,
    dateStrings: true,
    connectTimeout: cfg.connectTimeout || 8000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  });

  const conn = await pool.getConnection();
  try {
    await conn.query('SELECT 1');
  } finally {
    conn.release();
  }
}

port.on('message', async (msg) => {
  try {
    const [rows] = await pool.query(msg.sql, msg.params || []);
    if (Array.isArray(rows)) {
      port.postMessage({ ok: true, rows });
    } else {
      port.postMessage({
        ok: true,
        rows: [],
        affectedRows: rows.affectedRows || 0,
        insertId: typeof rows.insertId === 'number' ? rows.insertId : 0,
        warningStatus: rows.warningStatus || 0,
      });
    }
  } catch (e) {
    port.postMessage({
      ok: false,
      error: (e && e.message) || String(e),
      code: (e && e.code) || 'MYSQL_ERROR',
    });
  } finally {
    notify();
  }
});

init()
  .then(() => port.postMessage({ ready: true }))
  .catch((e) => port.postMessage({ ready: false, error: (e && e.message) || String(e), code: (e && e.code) || '' }))
  .finally(notify);
