'use strict';
/**
 * 把当前 SQLite 工作库（data/xiaoman.db）的数据完整上传到 MySQL(xiaoman)。
 * 步骤（幂等、可重跑）：
 *  1) 首次运行：建备份库 xiaoman_bak_YYYYMMDD 并复制现有 xiaoman 全量数据（可回滚）
 *     若备份库已存在：保留不动
 *  2) 还原 xiaoman 为备份库内容（保证每次都从干净原始状态开始）
 *  3) 逐表把 SQLite 数据写入 xiaoman（按列名交集插入，标识符加反引号，跳过不存在的列）
 */
const { DatabaseSync } = require('node:sqlite');
const mysql = require('mysql2/promise');
const path = require('path');

const SQLITE_FILE = path.join(__dirname, '..', 'data', 'xiaoman.db');
const MYCFG = {
  host: '127.0.0.1', port: 3306, user: 'root', password: 'lizhanyu18',
  database: 'xiaoman', multipleStatements: true,
};

const q = (id) => '`' + String(id).replace(/`/g, '``') + '`';
const toBuf = (v) => (v instanceof Uint8Array ? Buffer.from(v) : v);

(async () => {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const BAK = 'xiaoman_bak_' + today;

  // 1) SQLite
  const sdb = new DatabaseSync(SQLITE_FILE);
  sdb.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const sqliteTables = sdb
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map(r => r.name);

  // 2) MySQL root
  const root = await mysql.createConnection({ ...MYCFG, database: undefined, multipleStatements: true });
  const [dbs] = await root.query('SHOW DATABASES');
  const exists = dbs.map(x => Object.values(x)[0]).includes(BAK);
  if (!exists) {
    await root.query('CREATE DATABASE ' + q(BAK) + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    const [lt] = await root.query('SHOW TABLES FROM xiaoman');
    const liveNames = lt.map(x => Object.values(x)[0]);
    for (const t of liveNames) {
      await root.query(`CREATE TABLE ${q(BAK)}.${q(t)} LIKE xiaoman.${q(t)}`);
      const [cnt] = await root.query(`SELECT COUNT(*) n FROM xiaoman.${q(t)}`);
      if (cnt[0].n > 0) await root.query(`INSERT INTO ${q(BAK)}.${q(t)} SELECT * FROM xiaoman.${q(t)}`);
    }
    console.log('[backup] created', BAK, 'from original xiaoman');
  } else {
    console.log('[backup]', BAK, 'already exists, kept as-is');
  }

  // 3) 还原 xiaoman = BAK
  const [lt] = await root.query('SHOW TABLES FROM xiaoman');
  const liveNames = lt.map(x => Object.values(x)[0]);
  await root.query('SET FOREIGN_KEY_CHECKS=0');
  for (const t of liveNames) {
    await root.query(`DELETE FROM xiaoman.${q(t)}`);
    const [cnt] = await root.query(`SELECT COUNT(*) n FROM ${q(BAK)}.${q(t)}`);
    if (cnt[0].n > 0) await root.query(`INSERT INTO xiaoman.${q(t)} SELECT * FROM ${q(BAK)}.${q(t)}`);
  }
  await root.query('SET FOREIGN_KEY_CHECKS=1');
  await root.end();
  console.log('[restore] xiaoman restored from', BAK);

  // 4) 上传 SQLite -> xiaoman
  const conn = await mysql.createConnection(MYCFG);
  await conn.query('SET FOREIGN_KEY_CHECKS=0');
  const [colRows] = await conn.query(
    "SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='xiaoman'"
  );
  const mysqlCols = {};
  for (const r of colRows) (mysqlCols[r.TABLE_NAME] = mysqlCols[r.TABLE_NAME] || []).push(r.COLUMN_NAME);

  let totalInserted = 0;
  for (const t of sqliteTables) {
    if (!mysqlCols[t]) { console.log(`[skip] ${t} not in mysql`); continue; }
    const info = sdb.prepare(`PRAGMA table_info(${t})`).all().map(r => r.name);
    const cols = info.filter(c => mysqlCols[t].includes(c));
    if (cols.length === 0) { console.log(`[skip] ${t} no common cols`); continue; }

    await conn.query(`DELETE FROM ${q(t)}`);

    const rows = sdb.prepare(`SELECT * FROM ${t}`).all();
    if (rows.length === 0) { console.log(`[migrate] ${t}: 0 rows`); continue; }

    const ph = '(' + cols.map(() => '?').join(',') + ')';
    const colSql = cols.map(c => q(c)).join(',');
    const CHUNK = 200;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const vals = [];
      const params = [];
      for (const row of slice) { vals.push(ph); params.push(...cols.map(c => toBuf(row[c]))); }
      await conn.query(`INSERT INTO ${q(t)} (${colSql}) VALUES ${vals.join(',')}`, params);
      inserted += slice.length;
    }
    totalInserted += inserted;
    console.log(`[migrate] ${t}: ${inserted} rows`);
  }
  await conn.query('SET FOREIGN_KEY_CHECKS=1');
  await conn.end();
  sdb.close();
  console.log('DONE. totalInserted =', totalInserted);
})().catch(e => { console.error('MIGRATION ERROR:', e); process.exit(1); });
