'use strict';
/* 把真实生成的图片/视频与真实SOP/话术文案写入素材中心，使其可在前台打开查看 */
const fs = require('fs');
const path = require('path');
const { all, run } = require('../lib/db');

const UP = path.join(__dirname, '..', 'public', 'uploads');

/* ---------- 真实文案（按真实客服场景撰写） ---------- */
const wordsDouble11 = `【双11大促客服话术包】

一、开场问候（自动欢迎）
您好～欢迎来到小满旗舰店！双11活动火爆进行中，有什么产品问题随时问我哦～

二、活动机制讲解
1）跨店满减：每满300减50，上不封顶，可叠加店铺券；
2）预售现货：付定金立减，11月11日付尾款，早买早发货；
3）前N件优惠：今晚8点整，前200名下单送同款袜子一双；
4）直播间专属：进直播间领5元无门槛券，整点抽奖免单。

三、催付 / 促单话术
亲，您看中的这款库存不多啦，活动价仅限今天，现在下单还能叠加满减，比平时便宜不少，要不帮您先锁单？

四、物流时效
双11期间全国大部分地区48小时内发货，偏远地区顺延1-2天，快递合作中通/顺丰，可在"我的订单"实时查物流哦～

五、售后承诺
支持7天无理由退换，质量问题包邮退，运费险已为您开启，买得放心！

六、结束语
感谢亲的支持～记得关注店铺领券，下次回购更划算！有问题随时找我，在线秒回～`;

const afterSalesSop = `【售后处理标准作业流程 SOP】

一、适用范围
适用于小满旗舰店 / 小满自营店全部订单的售前咨询、售中跟进与售后纠纷处理。

二、退换货政策
1. 7天无理由：商品完好、不影响二次销售，签收后7日内可申请；
2. 质量问题：自签收起15日内，提供照片/视频证据，核实后包邮退换；
3. 错发/漏发：24小时内核实并补发，优先发顺丰到付。

三、退款时效
- 未发货：申请后立即退款，原路退回1-3个工作日到账；
- 已发货：建议拒收或退回后24小时内审核退款；
- 平台介入：配合提交凭证，48小时内响应。

四、差评 / 投诉处理
1. 第一时间私信致歉，了解顾客真实诉求；
2. 小额补偿（≤20元）客服可当场赠送运费险 / 优惠券；
3. 大额或疑似恶意索赔上报主管，禁止与顾客争吵。

五、升级机制
普通咨询 → 高级坐席 → 售后主管 → 平台仲裁，逐级响应，首响 SLA ≤ 3 分钟。`;

const shippingDoc = `【物流时效说明】

一、发货时效
- 现货订单：付款后24-48小时内发出（双11等大促顺延至72小时）；
- 定制 / 预售：以商品页标注发货时间为准。

二、合作快递
中通、圆通、顺丰（指定/加付可选），系统按收货地址智能分配。

三、区域时效参考（签收）
- 江浙沪皖：1-2天
- 华北 / 华南 / 华中：2-3天
- 西南 / 西北 / 东北：3-5天
- 新疆 / 西藏 / 港澳台：5-7天（港澳台需另行报关）

四、节假日与异常
法定节假日及大促期间时效顺延；遇暴雨 / 暴雪等不可抗力以快递官方公告为准。

五、物流异常处理
超过上述时效未更新物流，客服主动核实并赔付运费险；丢件按订单全额赔付。`;

/* ---------- 素材名 → 真实文件 / 文案 映射 ---------- */
const MAP = {
  '纯棉T恤-主图-01.jpg': { type: 'image', content: '/uploads/products/tshirt-main.png', poster: '/uploads/products/tshirt-main.png' },
  '纯棉T恤-细节图-03.jpg': { type: 'image', content: '/uploads/products/tshirt-detail.png', poster: '/uploads/products/tshirt-detail.png' },
  '保温杯-场景图-02.jpg': { type: 'image', content: '/uploads/products/thermos-scene.png', poster: '/uploads/products/thermos-scene.png' },
  '直播间赠品说明.png': { type: 'image', content: '/uploads/products/gift-set.png', poster: '/uploads/products/gift-set.png' },
  '运动鞋-开箱视频.mp4': { type: 'video', content: '/uploads/sneakers-unboxing.mp4', poster: '/uploads/products/sneakers.png' },
  '双11大促话术包.txt': { type: 'text', content: '', text: wordsDouble11 },
  '售后处理SOP.docx': { type: 'doc', content: '/uploads/售后处理SOP.docx.doc', sidecar: afterSalesSop },
  '物流时效说明.pdf': { type: 'doc', content: '/uploads/物流时效说明.pdf.pdf', sidecar: shippingDoc },
};

let nImg = 0, nVid = 0, nText = 0, nDoc = 0;
for (const m of all('SELECT id,name,type FROM materials')) {
  const cfg = MAP[m.name];
  if (!cfg) continue;
  if (cfg.type === 'text') {
    run('UPDATE materials SET content = ? WHERE id = ?', cfg.text, m.id);
    nText++;
  } else if (cfg.type === 'doc') {
    run('UPDATE materials SET content = ? WHERE id = ?', cfg.content, m.id);
    if (cfg.sidecar) {
      const base = path.join(UP, cfg.content.replace('/uploads/', ''));
      fs.writeFileSync(base + '.txt', cfg.sidecar, 'utf8');
    }
    nDoc++;
  } else if (cfg.type === 'video') {
    run('UPDATE materials SET content = ?, poster = ? WHERE id = ?', cfg.content, cfg.poster, m.id);
    nVid++;
  } else {
    run('UPDATE materials SET content = ?, poster = ? WHERE id = ?', cfg.content, cfg.poster, m.id);
    nImg++;
  }
}
console.log(`已更新素材：图片 ${nImg} · 视频 ${nVid} · 文案 ${nText} · 文档 ${nDoc}`);
