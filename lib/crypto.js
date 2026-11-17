'use strict';
/**
 * 凭据加密（AES-256-GCM）
 *
 * 平台授权拿到的 AppSecret / access_token / refresh_token 一律加密后入库，
 * 数据库被导出也看不到明文；密钥独立保存在 data/secret.key（权限 600），
 * 或用 APP_SECRET 环境变量派生。二者都没有时才自动生成。
 *
 * 密文格式：v1:<iv_b64>:<tag_b64>:<cipher_b64>
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const KEY_FILE = path.join(DATA_DIR, 'secret.key');

let cachedKey = null;

function loadKey() {
  if (cachedKey) return cachedKey;

  const envSecret = String(process.env.APP_SECRET || '').trim();
  if (envSecret) {
    cachedKey = crypto.scryptSync(envSecret, 'xiaoman.credential.v1', 32);
    return cachedKey;
  }

  try {
    const raw = fs.readFileSync(KEY_FILE, 'utf8').trim();
    const buf = Buffer.from(raw, 'hex');
    if (buf.length === 32) {
      cachedKey = buf;
      return cachedKey;
    }
  } catch (e) { /* 不存在则生成 */ }

  const key = crypto.randomBytes(32);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(KEY_FILE, key.toString('hex'), { mode: 0o600 });
  cachedKey = key;
  return cachedKey;
}

/** 加密字符串；空值返回空串 */
function encrypt(plain) {
  if (plain === undefined || plain === null || plain === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', loadKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

/** 解密；失败返回空串（不抛异常，避免一条坏数据拖垮接口） */
function decrypt(payload) {
  if (!payload) return '';
  const s = String(payload);
  if (!s.startsWith('v1:')) return s;
  try {
    const [, ivB64, tagB64, ctB64] = s.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', loadKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
  } catch (e) {
    return '';
  }
}

/** 脱敏展示：保留首尾各 4 位 */
function mask(value) {
  const s = String(value || '');
  if (!s) return '';
  if (s.length <= 8) return s.slice(0, 2) + '****';
  return s.slice(0, 4) + '****' + s.slice(-4);
}

/** 指纹：用于判断密钥是否变化（不泄露原值） */
function fingerprint(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 12);
}

/**
 * 给 OAuth 的 state 签名，防止回调被伪造（不需要额外建表存 state）
 * 格式：<value>.<exp>.<hmac>
 */
function signState(value, ttlMs = 30 * 60 * 1000) {
  const exp = Date.now() + ttlMs;
  const payload = String(value) + '.' + exp;
  const mac = crypto.createHmac('sha256', loadKey()).update(payload).digest('hex').slice(0, 32);
  return Buffer.from(payload + '.' + mac, 'utf8').toString('base64url');
}

/** 校验并取回 value；失败返回 null */
function verifyState(token) {
  try {
    const raw = Buffer.from(String(token || ''), 'base64url').toString('utf8');
    const idx = raw.lastIndexOf('.');
    if (idx < 0) return null;
    const mac = raw.slice(idx + 1);
    const payload = raw.slice(0, idx);
    const expect = crypto.createHmac('sha256', loadKey()).update(payload).digest('hex').slice(0, 32);
    if (mac.length !== expect.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
    const dot = payload.lastIndexOf('.');
    const value = payload.slice(0, dot);
    const exp = Number(payload.slice(dot + 1));
    if (!exp || exp < Date.now()) return null;
    return value;
  } catch (e) {
    return null;
  }
}

module.exports = { encrypt, decrypt, mask, fingerprint, signState, verifyState, KEY_FILE };
