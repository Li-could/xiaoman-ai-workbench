'use strict';
/**
 * MySQL 同步客户端（主线程侧）
 *
 * 对外暴露与 node:sqlite 完全一致的同步 API：
 *   client.all(sql, params)  -> 行数组
 *   client.get(sql, params)  -> 单行或 null
 *   client.run(sql, params)  -> { changes, lastInsertRowid }
 *   client.exec(ddlText)     -> 逐条执行建表语句
 *
 * 另外负责把 SQLite 写法的 SQL 翻译成 MySQL 能跑的：
 *   - INSERT OR IGNORE      -> INSERT IGNORE
 *   - ORDER BY rowid ASC    -> ORDER BY seq ASC（seq 为自增顺序列）
 *   - 保留字 read / key     -> 加反引号
 */
const path = require('path');
const { Worker, MessageChannel, receiveMessageOnPort } = require('worker_threads');

const WORKER_FILE = path.join(__dirname, 'mysql-worker.js');

/** SQLite 写法 -> MySQL 写法 */
function translate(sql) {
  let s = String(sql);
  s = s.replace(/\bINSERT\s+OR\s+IGNORE\b/gi, 'INSERT IGNORE');
  s = s.replace(/\bINSERT\s+OR\s+REPLACE\b/gi, 'REPLACE');
  // rowid 只出现在 ORDER BY 里，MySQL 侧每张需要的表都有自增 seq 列
  s = s.replace(/(?<![\w`])rowid(?![\w`])/gi, 'seq');
  // MySQL 保留字（小写标识符，已加引号的不重复处理）
  s = s.replace(/(?<![\w`])read(?![\w`])/g, '`read`');
  s = s.replace(/(?<![\w`])key(?![\w`])/g, '`key`');
  return s;
}

class MysqlClient {
  constructor(cfg) {
    this.cfg = cfg;
    this.signalBuf = new SharedArrayBuffer(4);
    this.signal = new Int32Array(this.signalBuf);
    this.sleeper = new Int32Array(new SharedArrayBuffer(4));

    const { port1, port2 } = new MessageChannel();
    this.port = port1;

    this.workerError = null;
    this.worker = new Worker(WORKER_FILE, {
      workerData: { port: port2, signalSab: this.signalBuf, cfg },
      transferList: [port2],
    });
    this.worker.on('error', (e) => {
      this.workerError = e;
      Atomics.store(this.signal, 0, 1);
      Atomics.notify(this.signal, 0);
    });
    this.worker.unref();

    const ready = this._awaitMessage(cfg.bootTimeout || 20000);
    if (!ready || ready.ready !== true) {
      throw new Error(
        (ready && ready.error) ||
        (this.workerError && this.workerError.message) ||
        'MySQL 工作线程初始化超时'
      );
    }
  }

  /** 阻塞等待工作线程通知 */
  _awaitNotify(timeout) {
    const r = Atomics.wait(this.signal, 0, 0, timeout);
    Atomics.store(this.signal, 0, 0);
    return r !== 'timed-out';
  }

  /** 同步取回工作线程发来的消息 */
  _takeMessage() {
    for (let i = 0; i < 2000; i += 1) {
      const got = receiveMessageOnPort(this.port);
      if (got && got.message !== undefined) return got.message;
      Atomics.wait(this.sleeper, 0, 0, 1);
    }
    return null;
  }

  _awaitMessage(timeout) {
    const ok = this._awaitNotify(timeout);
    if (!ok) return null;
    return this._takeMessage();
  }

  /**
   * 执行一条 SQL
   * @returns {{rows: any[], affectedRows?: number, insertId?: number}}
   */
  query(sql, params) {
    const translated = translate(sql);
    this.port.postMessage({ sql: translated, params: (params || []).map(normValue) });
    const ok = this._awaitNotify(this.cfg.queryTimeout || 60000);
    if (!ok) {
      throw new Error('MySQL 查询超时（' + String(sql).slice(0, 90) + '…）');
    }
    const msg = this._takeMessage();
    if (!msg) throw new Error('MySQL 未返回结果（' + String(sql).slice(0, 60) + '…）');
    if (!msg.ok) {
      const err = new Error('MySQL 错误：' + msg.error + ' | SQL: ' + String(sql).slice(0, 120));
      err.code = msg.code;
      throw err;
    }
    return msg;
  }

  all(sql, params) {
    return this.query(sql, params).rows || [];
  }

  get(sql, params) {
    const rows = this.query(sql, params).rows || [];
    return rows.length ? rows[0] : null;
  }

  run(sql, params) {
    const r = this.query(sql, params);
    return { changes: r.affectedRows || 0, lastInsertRowid: r.insertId || 0 };
  }

  exec(ddl) {
    const parts = String(ddl)
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of parts) {
      // 多行 DDL 里的纯注释语句跳过
      if (/^--/.test(stmt) && !/\bCREATE\b|\bALTER\b|\bINSERT\b/i.test(stmt)) continue;
      this.query(stmt, []);
    }
  }

  end() {
    try { this.worker.terminate(); } catch (e) { /* ignore */ }
  }
}

/** undefined -> null；布尔 -> 0/1；对象 -> JSON 字符串（与 SQLite 路径保持一致） */
function normValue(v) {
  if (v === undefined) return null;
  if (v === true) return 1;
  if (v === false) return 0;
  if (typeof v === 'object' && v !== null) return JSON.stringify(v);
  if (typeof v === 'bigint') return Number(v);
  return v;
}

module.exports = { MysqlClient, translate };
