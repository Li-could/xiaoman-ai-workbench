'use strict';
/**
 * 一次性回填：为 content 为空的素材生成真实资源文件并更新库。
 * 幂等：已带 /uploads/ 的素材跳过；重复运行安全。
 */
const { all, run } = require('../lib/db');
const { generateAsset } = require('../lib/gen-asset');

const TEXT_BANK = {
  '双11大促话术包': '双11 大促话术包\n\n- 满减：「店铺满 99 减 15，可叠加平台跨店满减哦～」\n- 催付：「亲的优惠名额仅剩 2 小时，拍下锁定更划算～」\n- 转人工：「这个问题我帮您转专属顾问，稍等一下下～」',
  '物流时效说明': '物流时效说明\n\n- 普通快递：48 小时内揽收，江浙沪 2 日达，偏远 4-5 日。\n- 预售商品：按详情页约定时间发货。\n- 异常件：停留超 3 天主动触达顾客并补发 / 退款。',
  '售后处理SOP': '售后处理 SOP\n\n1. 先安抚情绪，确认问题类型。\n2. 质量问题：承担运费，引导"质量问题"退货。\n3. 物流异常：查询节点，主动告知时效并补偿券。\n4. 超时未回复：2 分钟内首响，超 4 分钟升级主管。',
};

(function backfill() {
  const rows = all("SELECT * FROM materials WHERE content IS NULL OR content = ''");
  console.log('待回填素材数:', rows.length);
  let n = 0;
  for (const m of rows) {
    const text = TEXT_BANK[(m.name || '').replace(/\.[a-z0-9]+$/i, '')];
    const url = generateAsset({
      name: m.name, type: m.type, tag: m.tag, color: m.color,
      text: text || (m.name + '\n\n（演示占位内容）'),
    });
    run('UPDATE materials SET content = ? WHERE id = ?', url || '', m.id);
    n++;
    console.log('  +', m.name, '->', url || '(占位图标)');
  }
  console.log('回填完成:', n, '条');
})();
