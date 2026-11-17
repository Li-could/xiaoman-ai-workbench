'use strict';
/**
 * 淘宝沙箱连通性探针（本地开发用，不落库）
 *
 * 用法（本地临时验证，密钥只在进程内使用，不写盘）:
 *   APP_KEY=123 APP_SECRET=abc ENV=sandbox node tools/taobao-sandbox-probe.js
 *   # 若还要验证卖家类接口（如店铺信息），带 SESSION:
 *   APP_KEY=123 APP_SECRET=abc SESSION=tokxxx ENV=sandbox node tools/taobao-sandbox-probe.js
 *
 * 验证项:
 *   1. taobao.time.get  —— 公共接口，只需 AppKey+AppSecret，验证签名/连通/环境
 *   2. （可选）taobao.shop.seller.get —— 需 SESSION，验证授权是否到位
 */
const taobao = require('../lib/connectors/taobao');

const appKey = process.env.APP_KEY || '';
const appSecret = process.env.APP_SECRET || '';
const session = process.env.SESSION || '';
const env = (process.env.ENV || 'sandbox').toLowerCase();

function fail(msg) {
  console.error('缺少必要参数: ' + msg);
  console.error('用法: APP_KEY=xxx APP_SECRET=xxx [SESSION=xxx] [ENV=sandbox] node tools/taobao-sandbox-probe.js');
  process.exit(2);
}

if (!appKey) fail('APP_KEY');
if (!appSecret) fail('APP_SECRET');

(async () => {
  console.log('== 淘宝沙箱探针 ==');
  console.log('环境 env   :', env);
  console.log('网关 gateway:', taobao.GATEWAY[env] || taobao.GATEWAY.prod);
  console.log('AppKey    :', appKey);
  console.log('AppSecret :', appSecret.slice(0, 4) + '****(' + appSecret.length + '位)');
  console.log('SESSION   :', session ? session.slice(0, 6) + '****' : '(空，仅测公共接口)');
  console.log('');

  // 1) 公共接口：taobao.time.get
  console.log('[1/2] 调用 taobao.time.get（验证 AppKey/AppSecret/签名/环境）...');
  const probe = await taobao.probeCredentials({ appKey, appSecret, env });
  if (probe.ok) {
    console.log('  ✅ OK  淘宝时间:', probe.time, '| 耗时', probe.ms, 'ms | requestId', probe.requestId);
  } else {
    console.log('  ❌ FAIL code:', probe.code);
    console.log('        message:', probe.message);
    console.log('        hint   :', probe.hint);
    console.log('        sub_code:', probe.sub_code);
    console.log('\n（沙箱环境需先到开放平台「应用管理」开启沙箱；若提示 AppKey 无效，确认 env 是否应为 sandbox）');
    process.exit(1);
  }

  // 2) 卖家接口（可选）
  if (session) {
    console.log('\n[2/2] 调用 taobao.shop.seller.get（验证授权 SESSION）...');
    try {
      const r = await taobao.shopSellerGet({ appKey, appSecret, env, session });
      const shop = r.data && r.data.shop;
      console.log('  ✅ OK  店铺:', shop ? (shop.title || shop.sid) : '(返回空)');
    } catch (e) {
      console.log('  ❌ FAIL', e.code, '-', e.message);
      console.log('        hint:', e.hint);
    }
  } else {
    console.log('\n[2/2] 跳过卖家接口（未提供 SESSION）。要测订单/店铺类接口，请带上 SESSION 再跑一次。');
  }

  console.log('\n探针完成。');
})().catch((e) => {
  console.error('探针异常:', e && e.message ? e.message : e);
  process.exit(3);
});
