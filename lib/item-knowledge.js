'use strict';
/**
 * 商品资料 → 店铺商品知识（AI 自动学习）
 *
 * 只做「结构化搬运」，不生成也没有编造：把商品自身的标题、产品介绍、规格、
 * 属性、价格拆成一条条买家会问的问答，写进 store_knowledge（type=product），
 * 这样 AI 回复买家时能直接引用到商品参数。
 */
const { run, uid, nowISO } = require('./db');

/** 行内 "key:value" / "key：value" 拆解 */
function splitKV(line) {
  const t = String(line || '').trim();
  if (!t) return null;
  const m = t.match(/^(.+?)[:：]\s*(.+)$/);
  if (!m) return null;
  const k = m[1].trim();
  const v = m[2].trim();
  return k && v ? { k, v } : null;
}

/**
 * @param {string} tenantId
 * @param {string} storeId
 * @param {object} item  shop_items 行：title / num_iid / price / description / specs / attrs
 * @returns {number} 学到的知识条数
 */
function learnItemKnowledge(tenantId, storeId, item) {
  const title = String((item && item.title) || '').trim();
  const numIid = String((item && item.num_iid) || '').trim();
  if (!title || !numIid) return 0;

  /* 先清掉这个商品上一次的学习结果，避免重复堆叠 */
  run(
    "DELETE FROM store_knowledge WHERE tenant_id = ? AND store_id = ? AND product_id = ? AND type = 'product'",
    tenantId, storeId, numIid
  );

  const rows = [];
  const push = (q, a) => {
    const qq = String(q || '').trim().replace(/\s+/g, ' ').slice(0, 500);
    const aa = String(a || '').trim().slice(0, 20000);
    if (qq && aa) rows.push({ q: qq, a: aa });
  };

  const desc = String(item.description || '').trim();
  if (desc) push(`${title} 的产品介绍和卖点是什么？`, desc);

  const specs = String(item.specs || '').trim();
  if (specs) {
    push(`${title} 有哪些规格/套餐？分别多少钱？`, specs);
    for (const line of specs.split(/\r?\n/)) {
      const kv = splitKV(line);
      if (kv) push(`${title} 的「${kv.k}」多少钱？`, `${kv.k}：${kv.v}`);
    }
  }

  const attrs = String(item.attrs || '').trim();
  if (attrs) {
    push(`${title} 的产地、材质、包装等商品属性是什么？`, attrs);
    for (const line of attrs.split(/\r?\n|；|;/)) {
      const kv = splitKV(line);
      if (kv) push(`${title} 的${kv.k}是什么？`, `${kv.k}：${kv.v}`);
    }
  }

  const price = String(item.price || '').trim();
  if (price) {
    push(`${title} 多少钱？`, `当前售价 ${price}${price.indexOf('元') >= 0 ? '' : ' 元'}，以商品页实时价格为准。`);
  }

  const now = nowISO();
  for (const r of rows) {
    run(
      'INSERT INTO store_knowledge (id,tenant_id,store_id,type,product_id,material_id,question,answer,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      uid('sk'), tenantId, storeId, 'product', numIid, '', r.q, r.a, 'on', now
    );
  }
  return rows.length;
}

module.exports = { learnItemKnowledge };
