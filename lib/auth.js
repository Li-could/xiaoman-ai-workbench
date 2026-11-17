'use strict';
/**
 * 认证：scrypt 密码哈希 + 服务端 session（HttpOnly Cookie）
 * 不引入 JWT，密钥全部留在服务端，token 可随时吊销。
 */
const crypto = require('crypto');
const { all, get, run, uid, nowISO } = require('./db');

const SESSION_DAYS = 7;
const COOKIE = 'xm_session';

/* ---------------- 密码 ---------------- */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(pw, stored) {
  try {
    const [tag, salt, hash] = String(stored).split('$');
    if (tag !== 'scrypt' || !salt || !hash) return false;
    const calc = crypto.scryptSync(String(pw), salt, 64).toString('hex');
    const a = Buffer.from(calc, 'hex');
    const b = Buffer.from(hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

/* ---------------- session ---------------- */
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const exp = Date.now() + SESSION_DAYS * 864e5;
  run('INSERT INTO sessions (token,user_id,expires_at,created_at) VALUES (?,?,?,?)',
    token, userId, exp, nowISO());
  return { token, expiresAt: exp };
}

function destroySession(token) {
  if (token) run('DELETE FROM sessions WHERE token = ?', token);
}

function userByToken(token) {
  if (!token) return null;
  const row = get(
    `SELECT s.token, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
    token
  );
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    destroySession(token);
    return null;
  }
  if (row.status !== 'active') return null;
  return row;
}

/* ---------------- Cookie ---------------- */
function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  raw.split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i < 0) return;
    const k = p.slice(0, i).trim();
    const v = p.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function tokenFromReq(req) {
  const c = parseCookies(req);
  if (c[COOKIE]) return c[COOKIE];
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return null;
}

function cookieHeader(token, maxAgeSec) {
  const base = `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
  return maxAgeSec ? `${base}; Max-Age=${maxAgeSec}` : `${base}; Max-Age=0`;
}

/* ---------------- 校验 ---------------- */
function validEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || '').trim());
}

/* ---------------- 子账号权限 ----------------
   permissions 存 JSON 字符串：{"modules":["overview",...],"ops":true|false,"platforms":["taobao",...]}
   - modules：可见模块 key 列表（系统管理类永远不给子账号，由 role==='admin' 控制）
   - ops：true=可操作；false=只读（只能看，不能增删改）
   - platforms：允许「添加店铺」的平台 key 列表（仅当 ops=true 时生效）；为空则即便可操作也无法添加任何店铺
   - NULL/解析失败 → null（未配置）：前端按「可见全部基础模块 + 只读」处理，无法添加店铺 */
const PERM_MODULES = [
  'overview', 'inbox', 'aftersales', 'dashboard',
  'workspace', 'stores', 'qc', 'knowledge',
  'flows', 'notify', 'materials', 'alerts',
];

/* 允许被「添加店铺」授权的平台白名单（与 lib/platforms.js 的 key 保持一致） */
const PERM_PLATFORMS = [
  'douyin', 'pdd', 'kuaishou', 'jd', 'channels',
  'xhs', 'hours', 'taobao', 'taofactory', 'tmall',
];

function parsePermissions(raw) {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return null;
    const modules = Array.isArray(o.modules)
      ? o.modules.filter((m) => PERM_MODULES.indexOf(m) >= 0)
      : [];
    const platforms = Array.isArray(o.platforms)
      ? o.platforms.filter((p) => PERM_PLATFORMS.indexOf(p) >= 0)
      : [];
    return { modules, ops: !!o.ops, platforms };
  } catch (e) {
    return null;
  }
}

function safeUser(u, tenant) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    title: u.title || '',
    tenantId: u.tenant_id,
    tenantName: tenant ? tenant.name : '',
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
    permissions: parsePermissions(u.permissions),
  };
}

module.exports = {
  COOKIE, SESSION_DAYS,
  hashPassword, verifyPassword,
  createSession, destroySession, userByToken,
  parseCookies, tokenFromReq, cookieHeader,
  validEmail, safeUser, uid,
  PERM_MODULES, PERM_PLATFORMS, parsePermissions,
};
