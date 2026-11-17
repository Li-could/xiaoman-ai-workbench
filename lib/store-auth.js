'use strict';
/**
 * 店铺凭据管理
 *
 * 职责：凭据的加密落库、token 自动续期、真实连接自检、调用日志。
 * AppSecret / access_token / refresh_token 只以密文入库，接口只回脱敏值。
 */
const db = require('./db');
const { encrypt, decrypt, mask } = require('./crypto');
const connectors = require('./connectors');

const TOKEN_SAFETY_MS = 5 * 60 * 1000; // 提前 5 分钟续期

function getRow(storeId) {
  return db.get('SELECT * FROM store_credentials WHERE store_id = ?', storeId);
}

/** 解密成可直接用的凭据对象 */
function resolve(row) {
  if (!row) return null;
  return {
    storeId: row.store_id,
    tenantId: row.tenant_id,
    platform: row.platform,
    env: row.api_env || 'prod',
    appKey: row.app_key || '',
    appSecret: decrypt(row.app_secret_enc),
    session: decrypt(row.session_enc),
    refreshToken: decrypt(row.refresh_enc),
    tokenExpireAt: Number(row.token_expire_at || 0),
    reExpireAt: Number(row.re_expire_at || 0),
    shopId: row.shop_id || '',
    sellerUid: row.seller_uid || '',
    sellerNick: row.seller_nick || '',
    shopTitle: row.shop_title || '',
    shopPic: row.shop_pic || '',
    redirectUri: row.redirect_uri || '',
    authStatus: row.auth_status || 'pending',
    authError: row.auth_error || '',
    tmcGroup: row.tmc_group || 'default',
    tmcLastId: Number(row.tmc_last_id || 0),
    lastSyncAt: row.last_sync_at || null,
  };
}

function getCred(storeId) {
  return resolve(getRow(storeId));
}

const SECRET_FIELDS = {
  appSecret: 'app_secret_enc',
  session: 'session_enc',
  refreshToken: 'refresh_enc',
};

/**
 * 新增凭据
 */
function createCred(data) {
  const now = db.nowISO();
  db.run(
    `INSERT INTO store_credentials
      (store_id,tenant_id,platform,api_env,app_key,app_secret_enc,session_enc,refresh_enc,
       token_expire_at,re_expire_at,shop_id,seller_uid,seller_nick,shop_title,shop_pic,
       redirect_uri,auth_status,auth_error,tmc_group,tmc_last_id,last_sync_at,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    data.storeId, data.tenantId, data.platform, data.env || 'prod', data.appKey || '',
    encrypt(data.appSecret || ''), encrypt(data.session || ''), encrypt(data.refreshToken || ''),
    data.tokenExpireAt || 0, data.reExpireAt || 0,
    data.shopId || '', data.sellerUid || '', data.sellerNick || '', data.shopTitle || '', data.shopPic || '',
    data.redirectUri || '', data.authStatus || 'pending', data.authError || '',
    data.tmcGroup || 'default', 0, null, now, now
  );
  return getCred(data.storeId);
}

/** 更新凭据；patch 里的 appSecret/session/refreshToken 会被加密 */
function updateCred(storeId, patch) {
  const sets = [];
  const vals = [];
  for (const k of Object.keys(patch)) {
    if (patch[k] === undefined) continue;
    if (SECRET_FIELDS[k]) {
      sets.push(`${SECRET_FIELDS[k]} = ?`);
      vals.push(encrypt(patch[k]));
      continue;
    }
    const colMap = {
      env: 'api_env', appKey: 'app_key', tokenExpireAt: 'token_expire_at', reExpireAt: 're_expire_at',
      shopId: 'shop_id', sellerUid: 'seller_uid', sellerNick: 'seller_nick', shopTitle: 'shop_title',
      shopPic: 'shop_pic', redirectUri: 'redirect_uri', authStatus: 'auth_status', authError: 'auth_error',
      tmcGroup: 'tmc_group', tmcLastId: 'tmc_last_id', lastSyncAt: 'last_sync_at',
    };
    if (!colMap[k]) continue;
    sets.push(`${colMap[k]} = ?`);
    vals.push(patch[k]);
  }
  if (!sets.length) return getCred(storeId);
  sets.push('updated_at = ?');
  vals.push(db.nowISO(), storeId);
  db.run(`UPDATE store_credentials SET ${sets.join(', ')} WHERE store_id = ?`, ...vals);
  return getCred(storeId);
}

function deleteCred(storeId) {
  db.run('DELETE FROM store_credentials WHERE store_id = ?', storeId);
}

/** 给前端的脱敏视图（绝不返回明文 secret / token） */
function publicView(cred, extra = {}) {
  if (!cred) return null;
  const now = Date.now();
  return {
    store_id: cred.storeId,
    platform: cred.platform,
    env: cred.env,
    app_key: cred.appKey,
    app_secret_masked: mask(cred.appSecret),
    has_secret: Boolean(cred.appSecret),
    authorized: Boolean(cred.session),
    session_masked: mask(cred.session),
    token_expire_at: cred.tokenExpireAt,
    token_expires_in: cred.tokenExpireAt ? Math.max(0, Math.round((cred.tokenExpireAt - now) / 1000)) : 0,
    token_expired: cred.tokenExpireAt ? cred.tokenExpireAt < now : false,
    can_refresh: Boolean(cred.refreshToken) && (!cred.reExpireAt || cred.reExpireAt > now),
    shop_id: cred.shopId,
    seller_uid: cred.sellerUid,
    seller_nick: cred.sellerNick,
    shop_title: cred.shopTitle,
    shop_pic: cred.shopPic,
    redirect_uri: cred.redirectUri,
    auth_status: cred.authStatus,
    auth_error: cred.authError,
    tmc_group: cred.tmcGroup,
    last_sync_at: cred.lastSyncAt,
    ...extra,
  };
}

/** 记录一次真实 API 调用 */
function logCall({ tenantId, storeId, platform, method, ok, code, message, ms, detail }) {
  try {
    db.run(
      'INSERT INTO connector_logs (tenant_id,store_id,platform,method,ok,code,message,ms,detail,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      tenantId, storeId || '', platform || '', method || '', ok ? 1 : 0,
      String(code || '').slice(0, 80), String(message || '').slice(0, 500),
      Number(ms || 0), detail ? String(detail).slice(0, 4000) : '', db.nowISO()
    );
  } catch (e) { /* 日志失败不影响主流程 */ }
}

/**
 * 保证有可用 session：快过期时用 refresh_token 自动续期
 * 返回 { session, refreshed }
 */
async function ensureSession(cred) {
  if (!cred) throw new Error('店铺凭据不存在');
  if (!cred.session) throw new Error('店铺尚未授权，请先完成淘宝授权');
  if (!cred.tokenExpireAt) return { session: cred.session, refreshed: false };

  const needRefresh = cred.tokenExpireAt - TOKEN_SAFETY_MS < Date.now();
  if (!needRefresh) return { session: cred.session, refreshed: false };
  if (!cred.refreshToken) return { session: cred.session, refreshed: false };
  if (cred.reExpireAt && cred.reExpireAt < Date.now()) {
    throw new Error('授权已过期且刷新令牌失效，请重新授权');
  }

  const conn = connectors.get(cred.platform);
  if (!conn || !conn.refreshSession) return { session: cred.session, refreshed: false };

  const started = Date.now();
  try {
    const t = await conn.refreshSession({
      appKey: cred.appKey, appSecret: cred.appSecret, refreshToken: cred.refreshToken,
    });
    const now = Date.now();
    updateCred(cred.storeId, {
      session: t.accessToken,
      refreshToken: t.refreshToken || cred.refreshToken,
      tokenExpireAt: now + (t.expiresIn || 86400) * 1000,
      reExpireAt: t.reExpiresIn ? now + t.reExpiresIn * 1000 : cred.reExpireAt,
      authStatus: 'active',
      authError: '',
    });
    logCall({ tenantId: cred.tenantId, storeId: cred.storeId, platform: cred.platform, method: 'oauth.refresh_token', ok: true, ms: Date.now() - started });
    return { session: t.accessToken, refreshed: true };
  } catch (e) {
    logCall({
      tenantId: cred.tenantId, storeId: cred.storeId, platform: cred.platform,
      method: 'oauth.refresh_token', ok: false, code: e.code, message: e.message, ms: Date.now() - started,
    });
    updateCred(cred.storeId, { authStatus: 'expired', authError: String(e.message).slice(0, 500) });
    throw new Error('授权续期失败：' + e.message);
  }
}

/** 组装连接器调用参数 */
async function connArgs(cred, { withSession = true } = {}) {
  const args = { appKey: cred.appKey, appSecret: cred.appSecret, env: cred.env };
  if (withSession) {
    const { session } = await ensureSession(cred);
    args.session = session;
  }
  return args;
}

module.exports = {
  getRow, getCred, resolve, createCred, updateCred, deleteCred,
  publicView, logCall, ensureSession, connArgs,
};
