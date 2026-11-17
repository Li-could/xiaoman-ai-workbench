'use strict';
/** 重建演示子账号 addtest@xiaoman.ai（ops=true, platforms=[taobao,jd]），写入 MySQL 与 SQLite 保持一致 */
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const mysql = require('mysql2/promise');

const SQLITE_FILE = require('path').join(__dirname, '..', 'data', 'xiaoman.db');
const TENANT = 'tn_f012019cb6da04f960'; // 与 admin/agent 同租户
const EMAIL = 'addtest@xiaoman.ai';
const PW = 'xiaoman123';

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

(async () => {
  const id = 'us_' + crypto.randomBytes(8).toString('hex');
  const password = hashPassword(PW);
  const permissions = JSON.stringify({
    modules: ['overview','inbox','aftersales','dashboard','workspace','stores','qc','knowledge','flows','notify','materials','alerts'],
    ops: true,
    platforms: ['taobao', 'jd'],
  });
  const now = new Date().toISOString();
  const cols = ['id','tenant_id','name','email','password','role','status','title','points','store_ids','created_at','last_login_at','permissions'];
  const vals = [id, TENANT, '演示子账号', EMAIL, password, 'agent', 'active', '子账号 · 淘宝/京东', 1000, '', now, null, permissions];

  // MySQL
  const c = await mysql.createConnection({ host:'127.0.0.1', port:3306, user:'root', password:'lizhanyu18', database:'xiaoman' });
  const [ex] = await c.query('SELECT id FROM users WHERE email = ?', [EMAIL]);
  if (ex.length) {
    console.log('MySQL: addtest already exists, skip insert (id=' + ex[0].id + ')');
  } else {
    await c.query(`INSERT INTO users (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')})`, vals);
    console.log('MySQL: inserted addtest, id=' + id);
  }
  await c.end();

  // SQLite
  const sdb = new DatabaseSync(SQLITE_FILE);
  const exist = sdb.prepare('SELECT id FROM users WHERE email = ?').get(EMAIL);
  if (exist) {
    console.log('SQLite: addtest already exists, skip');
  } else {
    const ph = cols.map(()=>'?').join(',');
    sdb.prepare(`INSERT INTO users (${cols.join(',')}) VALUES (${ph})`).run(...vals);
    console.log('SQLite: inserted addtest');
  }
  sdb.close();
  console.log('DONE');
})().catch(e => { console.error('ERR', e); process.exit(1); });
