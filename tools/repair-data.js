'use strict';
/**
 * 数据修复脚本：
 *  1. 清理孤儿数据：shop_items / store_knowledge 里 store_id 在 stores 表已不存在的行
 *     （来自被清理的测试租户 / 旧 seed，已无法在 UI 访问，属垃圾数据）。
 *  2. 幂等补齐演示商品：确保演示租户 4 个标准店铺商品 + 商品知识齐全。
 *  3. 给演示账号下 3 个用户自建店铺（55555 / 11123 / 淘宝店铺）补上平台对应的
 *     示例商品，并触发 AI 商品学习，使「店铺管理 → 查看商品」不再为空。
 */
const { all, get, run, uid, nowISO } = require('../lib/db');
const { PRODUCTS, ensureDemoTenant } = require('../lib/seed');
const { learnItemKnowledge } = require('../lib/item-knowledge');

const ADMIN_TENANT = 'tn_f012019cb6da04f960';
const PLAT = { '淘宝': 'tb', '京东': 'jd', '拼多多': 'pdd', '抖音': 'dy' };

function main() {
  // ---- 1. 清理孤儿 ----
  const oiBefore = get("SELECT COUNT(*) c FROM shop_items WHERE store_id NOT IN (SELECT id FROM stores)").c;
  const okBefore = get("SELECT COUNT(*) c FROM store_knowledge WHERE store_id NOT IN (SELECT id FROM stores)").c;
  run('DELETE FROM shop_items WHERE store_id NOT IN (SELECT id FROM stores)');
  run('DELETE FROM store_knowledge WHERE store_id NOT IN (SELECT id FROM stores)');
  console.log(`[清理] 孤儿商品 ${oiBefore} 条、孤儿商品知识 ${okBefore} 条 已删除`);

  // ---- 2. 标准店铺幂等补齐 ----
  ensureDemoTenant();
  const std = all(
    `SELECT s.id, s.name, COUNT(si.num_iid) c
     FROM stores s LEFT JOIN shop_items si ON si.store_id = s.id
     WHERE s.tenant_id = ? AND s.name IN ('小满旗舰店','小满自营店','小满优选','小满好物')
     GROUP BY s.id, s.name ORDER BY s.name`,
    ADMIN_TENANT
  );
  console.log('[标准店铺] 商品数:');
  std.forEach((r) => console.log(`   ${r.name}: ${r.c} 件商品`));

  // ---- 3. 用户自建店铺补示例商品 ----
  const userStores = all(
    "SELECT id, name, platform FROM stores WHERE tenant_id = ? AND name IN ('55555','11123','淘宝店铺')",
    ADMIN_TENANT
  );
  console.log(`[用户店铺] 待处理 ${userStores.length} 个`);
  userStores.forEach((st) => {
    const key = PLAT[st.platform];
    const existing = get('SELECT 1 FROM shop_items WHERE store_id = ?', st.id);
    if (existing) {
      console.log(`   ${st.name}（${st.platform}）已有商品，跳过`);
      return;
    }
    const items = PRODUCTS.filter((p) => p.k === key);
    if (!items.length) {
      console.log(`   ${st.name}（${st.platform}）无对应平台商品，跳过`);
      return;
    }
    items.forEach((p) => {
      const numIid = p.num + st.id.slice(-4);
      run(
        `INSERT INTO shop_items
         (num_iid,tenant_id,store_id,title,price,num,outer_id,pic_url,status,modified,description,specs,attrs,synced_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        numIid, ADMIN_TENANT, st.id, p.title, p.price, p.stock || 0, '', p.pic || '', 'onsale', '',
        p.description || '', p.specs || '', p.attrs || '', nowISO()
      );
      const n = learnItemKnowledge(ADMIN_TENANT, st.id, {
        num_iid: numIid, title: p.title, price: p.price,
        description: p.description, specs: p.specs, attrs: p.attrs,
      });
      console.log(`   + ${st.name}（${st.platform}）添加「${p.title}」并学习 ${n} 条知识`);
    });
  });

  // ---- 汇总 ----
  const totalItems = get('SELECT COUNT(*) c FROM shop_items WHERE tenant_id = ?', ADMIN_TENANT).c;
  const totalKn = get('SELECT COUNT(*) c FROM store_knowledge WHERE tenant_id = ?', ADMIN_TENANT).c;
  console.log(`\n[完成] 演示租户现有商品 ${totalItems} 件、商品知识 ${totalKn} 条`);
}

main();
