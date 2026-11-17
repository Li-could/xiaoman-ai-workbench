'use strict';
/**
 * 扩展模块种子数据：对话质检 / 信息通知 / 素材中心 / 对话预警 / AI Agent 工作流
 * 新租户初始化时一并播种，保证每个模块都"有东西可看、可点"。
 */
const { run, uid, nowISO } = require('./db');
const { generateAsset, posterFor } = require('./gen-asset');

const ago = (min) => new Date(Date.now() - min * 60 * 1000).toISOString();

/* ---------------- 对话质检 ---------------- */
const QC = [
  {
    customer: '张女士', k: 'tb', agent: '王晓雨', score: 96, level: 'excellent', status: 'done',
    issues: [], min: 12,
    snippet: '我178，140斤，平时穿L，怕买小了或者大了',
    reply: '按您身高体重建议选 L 码，肩宽与衣长都在合适区间；若担心偏紧可选 XL，支持 7 天无理由换码～',
  },
  {
    customer: '李先生', k: 'tb', agent: '小满AI', score: 62, level: 'risk', status: 'pending',
    issues: ['情绪未安抚', '出现"不知道"', '未给出时效承诺'], min: 26,
    snippet: '昨天下的单什么时候发货啊，等好久了，着急穿',
    reply: '亲，这个我这边不知道呢，您再等等吧。',
  },
  {
    customer: '王同学', k: 'jd', agent: '小满AI', score: 88, level: 'good', status: 'done',
    issues: ['未主动推荐关联商品'], min: 48,
    snippet: '杯子保温效果怎么样',
    reply: '这款采用 316 不锈钢双层真空结构，95℃ 热水 6 小时后仍有 68℃ 以上，通勤完全够用哦～',
  },
  {
    customer: '陈女士', k: 'pdd', agent: '王晓雨', score: 71, level: 'risk', status: 'pending',
    issues: ['超时未回复 4 分钟', '未确认退货运费承担方'], min: 73,
    snippet: '收到货袖口开线了，我要退货，运费谁出？',
    reply: '质量问题我们承担运费，您先申请退货退款，选择"质量问题"即可。',
  },
  {
    customer: '刘先生', k: 'dy', agent: '小满AI', score: 92, level: 'excellent', status: 'done',
    issues: [], min: 105,
    snippet: '直播间说的赠品还有吗',
    reply: '有的亲～ 下单备注"直播"即可随单发出同款收纳袋，数量有限先到先得哦。',
  },
  {
    customer: '周女士', k: 'tb', agent: '王晓雨', score: 78, level: 'good', status: 'done',
    issues: ['话术偏模板化', '未二次确认需求'], min: 160,
    snippet: '想买两件有优惠吗',
    reply: '亲，店铺满 99 减 15，可叠加平台跨店满减哦。',
  },
];

/* ---------------- 信息通知 ---------------- */
const NOTICES = [
  { type: 'alert', title: '「李先生」会话情绪升级为负面', body: 'AI 检测到顾客连续 2 次催发货并使用感叹语气，建议转人工安抚。', level: 'danger', read: 0, min: 8 },
  { type: 'system', title: 'AI 回复额度已使用 68%', body: '本月套餐 5000 条，已使用 3400 条，剩余 1600 条，预计可用 12 天。', level: 'warn', read: 0, min: 35 },
  { type: 'update', title: 'v2.3 已上线：对话质检支持自定义规则', body: '可在「对话质检 - 质检规则」中配置禁用词、必答项与响应时长阈值。', level: 'info', read: 0, min: 120 },
  { type: 'billing', title: '套餐续费提醒', body: '当前套餐将于 11 月 12 日到期，续费可保留历史会话与知识库。', level: 'info', read: 1, min: 400 },
  { type: 'system', title: '拼多多店铺授权即将过期', body: '「小满优选」授权剩余 5 天，过期后将停止同步消息，请及时重新授权。', level: 'warn', read: 1, min: 620 },
  { type: 'system', title: '新成员「赵子琪」已加入', body: '角色：客服坐席 · 拼多多，已分配 1 个店铺权限。', level: 'info', read: 1, min: 1400 },
  { type: 'update', title: '本周质检报告已生成', body: '平均得分 84.5，风险会话 2 条，点击查看完整报告。', level: 'info', read: 1, min: 2600 },
];

/* ---------------- 素材中心 ---------------- */
const MATERIALS = [
  { name: '纯棉T恤-主图-01.jpg', type: 'image', tag: '商品图', size: '1.2 MB', color: '#165DFF', min: 20 },
  { name: '纯棉T恤-细节图-03.jpg', type: 'image', tag: '商品图', size: '860 KB', color: '#0EA5B7', min: 25 },
  { name: '运动鞋-开箱视频.mp4', type: 'video', tag: '视频', size: '18.4 MB', color: '#722ED1', min: 90 },
  { name: '售后处理SOP.docx', type: 'doc', tag: '内部文档', size: '248 KB', color: '#00B42A', min: 150,
    text: '售后处理 SOP\n\n1. 先安抚情绪，确认问题类型（质量 / 物流 / 描述不符）。\n2. 质量问题：承担运费，引导"质量问题"退货。\n3. 物流异常：查询节点，主动告知预计时效并补偿券。\n4. 超时未回复：2 分钟内必须首响，超 4 分钟升级主管。' },
  { name: '双11大促话术包.txt', type: 'text', tag: '话术', size: '12 KB', color: '#FF7D00', min: 300,
    text: '双11 大促话术包\n\n- 满减：「店铺满 99 减 15，可叠加平台跨店满减哦～」\n- 催付：「亲的优惠名额仅剩 2 小时，拍下锁定更划算～」\n- 转人工：「这个问题我帮您转专属顾问，稍等一下下～」' },
  { name: '保温杯-场景图-02.jpg', type: 'image', tag: '商品图', size: '2.1 MB', color: '#F53F3F', min: 520 },
  { name: '物流时效说明.pdf', type: 'doc', tag: '内部文档', size: '96 KB', color: '#4E5969', min: 900,
    text: '物流时效说明\n\n- 普通快递：48 小时内揽收，江浙沪 2 日达，偏远 4-5 日。\n- 预售商品：按详情页约定时间发货。\n- 异常件：停留超 3 天主动触达顾客并补发 / 退款。' },
  { name: '直播间赠品说明.png', type: 'image', tag: '活动素材', size: '640 KB', color: '#165DFF', min: 1500 },
];

/* ---------------- 对话预警 ---------------- */
const ALERTS = [
  { customer: '李先生', k: 'tb', type: '情绪激动', level: 'high', text: '连续 3 条催发货并出现感叹语气，情绪分 -0.72', min: 6, handled: 0 },
  { customer: '陈女士', k: 'pdd', type: '退款风险', level: 'high', text: '会话中出现「退货」「开线」「投诉」等高风险词，订单金额 ¥159', min: 22, handled: 0 },
  { customer: '孙先生', k: 'jd', type: '超时未回复', level: 'mid', text: '顾客最后一条消息已等待 4 分 12 秒，超出首响目标（30 秒）', min: 41, handled: 0 },
  { customer: '郑女士', k: 'dy', type: '敏感词', level: 'mid', text: '顾客提及「假货」「315」，建议人工介入并保留证据', min: 88, handled: 0 },
  { customer: '吴女士', k: 'tb', type: '催发货', level: 'low', text: '同一订单 24 小时内第 2 次询问发货进度', min: 210, handled: 1 },
];

/* ---------------- AI Agent 工作流 ---------------- */
const FLOWS = [
  {
    name: '智能首响 · 全平台', triggerType: 'message', triggerDesc: '顾客发送第一条消息时触发',
    description: '3 秒内基于店铺知识生成个性化首响，识别意图并打标，复杂问题自动转人工。',
    enabled: 1, runs: 12840, successRate: 98, min: 30,
    steps: [
      { type: 'trigger', name: '新消息进入', desc: '任一店铺收到顾客消息' },
      { type: 'ai', name: '意图识别', desc: '分类为售前咨询 / 售后 / 物流 / 投诉' },
      { type: 'ai', name: '知识检索 + 生成回复', desc: '命中店铺知识库，按语气模板生成' },
      { type: 'branch', name: '置信度判断', desc: '低于 0.75 或识别为投诉 → 转人工' },
    ],
  },
  {
    name: '催发货安抚', triggerType: 'event', triggerDesc: '识别到「发货 / 几天到 / 催」关键词',
    description: '查询订单发货状态，按承诺时效回复并自动打「加急」标，同步仓储群。',
    enabled: 1, runs: 3268, successRate: 96, min: 80,
    steps: [
      { type: 'trigger', name: '命中催发货意图', desc: '关键词 + 订单状态联合判断' },
      { type: 'action', name: '查询订单物流', desc: '调用订单接口获取最新节点' },
      { type: 'ai', name: '生成安抚话术', desc: '含致歉 + 时效承诺 + 补偿券' },
      { type: 'action', name: '打标并通知仓储', desc: '会话标「加急」，推送仓储群' },
    ],
  },
  {
    name: '退款挽单', triggerType: 'event', triggerDesc: '顾客发起退款申请时触发',
    description: '先判断退款原因，质量问题走快速通道，非质量原因尝试用补偿券挽单。',
    enabled: 1, runs: 1246, successRate: 88, min: 200,
    steps: [
      { type: 'trigger', name: '退款申请', desc: '平台退款事件回调' },
      { type: 'branch', name: '原因分流', desc: '质量问题 / 七天无理由 / 其他' },
      { type: 'ai', name: '生成挽单方案', desc: '补偿券额度按客单价与历史价值计算' },
      { type: 'action', name: '创建售后工单', desc: '自动分派至对应坐席' },
    ],
  },
  {
    name: '物流异常跟进', triggerType: 'schedule', triggerDesc: '每小时扫描一次在途订单',
    description: '扫描 48 小时无揽收或停留超 3 天的订单，主动联系顾客并补发/退款。',
    enabled: 0, runs: 812, successRate: 92, min: 600,
    steps: [
      { type: 'trigger', name: '定时扫描', desc: '每小时一次' },
      { type: 'action', name: '筛选异常订单', desc: '无揽收 / 中转停滞 / 派送失败' },
      { type: 'ai', name: '生成主动触达话术', desc: '按异常类型生成说明与方案' },
    ],
  },
  {
    name: '售后自动分派', triggerType: 'event', triggerDesc: '新售后工单创建时触发',
    description: '按店铺 + 问题类型 + 坐席负载自动分派，超时未处理自动升级给主管。',
    enabled: 1, runs: 2043, successRate: 99, min: 1200,
    steps: [
      { type: 'trigger', name: '工单创建', desc: '来自会话或平台回调' },
      { type: 'branch', name: '负载匹配', desc: '按当前待处理量与技能标签' },
      { type: 'action', name: '分派坐席', desc: '超 30 分钟未响应升级主管' },
    ],
  },
];

function seedModules(tenantId, storeMap) {
  const ts = nowISO();

  QC.forEach((r) => {
    run(
      `INSERT INTO qc_reviews (id,tenant_id,customer,store_id,agent,score,level,issues,snippet,reply,status,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      uid('qc'), tenantId, r.customer, storeMap[r.k] || '', r.agent, r.score, r.level,
      JSON.stringify(r.issues || []), r.snippet, r.reply, r.status, ago(r.min)
    );
  });

  NOTICES.forEach((n) => {
    run(
      `INSERT INTO notifications (id,tenant_id,type,title,body,level,read,created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      uid('nt'), tenantId, n.type, n.title, n.body, n.level, n.read, ago(n.min)
    );
  });

  MATERIALS.forEach((m) => {
    const content = generateAsset(m); // 生成真实可预览/可下载的资源文件（命中商品图时用真实照片）
    const poster = posterFor(m.name); // 视频等无 content 素材的封面图
    run(
      `INSERT INTO materials (id,tenant_id,name,type,tag,size,color,content,poster,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      uid('mt'), tenantId, m.name, m.type, m.tag, m.size, m.color, content, poster, ago(m.min)
    );
  });

  ALERTS.forEach((a) => {
    run(
      `INSERT INTO alerts (id,tenant_id,conv_id,customer,store_id,type,level,text,handled,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      uid('al'), tenantId, '', a.customer, storeMap[a.k] || '', a.type, a.level, a.text, a.handled, ago(a.min)
    );
  });

  FLOWS.forEach((f, i) => {
    run(
      `INSERT INTO agent_flows (id,tenant_id,name,description,trigger_type,trigger_desc,steps,enabled,runs,success_rate,sort,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      uid('fl'), tenantId, f.name, f.description, f.triggerType, f.triggerDesc,
      JSON.stringify(f.steps || []), f.enabled, f.runs, f.successRate, i, ts
    );
  });
}

module.exports = { seedModules, MATERIALS };
