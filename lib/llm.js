'use strict';
/**
 * 大模型层：OpenAI 兼容代理 + SSE 流式；未配置 Key 时使用本地演示引擎。
 * 配置按租户存储（settings 表 key = 'ai'），环境变量作为全局兜底。
 */
const http = require('http');
const https = require('https');
const { getSetting, setSetting } = require('./db');

const DEFAULTS = {
  provider: 'demo',
  baseURL: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  apiKey: '',
  tone: '亲切',
  temperature: 0.7,
  autoReply: true,
};

function getAiConfig(tenantId) {
  const saved = getSetting(tenantId, 'ai', {}) || {};
  const cfg = { ...DEFAULTS, ...saved };
  // 环境变量兜底（适合部署，优先级最高）
  if (process.env.LLM_BASE_URL) cfg.baseURL = process.env.LLM_BASE_URL;
  if (process.env.LLM_MODEL) cfg.model = process.env.LLM_MODEL;
  if (process.env.LLM_API_KEY) cfg.apiKey = process.env.LLM_API_KEY;
  if (process.env.LLM_PROVIDER) cfg.provider = process.env.LLM_PROVIDER;
  return cfg;
}

function saveAiConfig(tenantId, patch) {
  const cur = getSetting(tenantId, 'ai', {}) || {};
  const next = { ...DEFAULTS, ...cur };
  if (typeof patch.provider === 'string') next.provider = patch.provider;
  if (typeof patch.baseURL === 'string' && patch.baseURL.trim()) next.baseURL = patch.baseURL.trim().replace(/\/+$/, '');
  if (typeof patch.model === 'string' && patch.model.trim()) next.model = patch.model.trim();
  if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) next.apiKey = patch.apiKey.trim();
  if (patch.clearKey === true) next.apiKey = '';
  if (typeof patch.tone === 'string') next.tone = patch.tone;
  if (typeof patch.temperature === 'number') next.temperature = Math.max(0, Math.min(2, patch.temperature));
  if (typeof patch.autoReply === 'boolean') next.autoReply = patch.autoReply;
  setSetting(tenantId, 'ai', next);
  return next;
}

function publicAi(cfg) {
  return {
    provider: cfg.apiKey ? cfg.provider : 'demo',
    baseURL: cfg.baseURL,
    model: cfg.model,
    tone: cfg.tone,
    temperature: cfg.temperature,
    autoReply: cfg.autoReply,
    configured: !!cfg.apiKey,
    demo: !cfg.apiKey,
  };
}

/* ---------------- SSE ---------------- */
const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
};
function sseSend(res, obj) { try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (e) {} }
function sseDone(res) { try { res.write('data: [DONE]\n\n'); res.end(); } catch (e) {} }

/* ---------------- 演示引擎 ---------------- */
function demoGenerate(messages, mode, meta) {
  meta = meta || {};
  const userMsgs = (messages || []).filter((m) => m.role === 'user').slice(-3).map((m) => m.content || '').join(' ');
  const text = userMsgs || '';
  const t = text.toLowerCase();
  const has = (...kw) => kw.some((k) => t.includes(k.toLowerCase()));
  const product = meta.product || '';
  const orderNo = meta.orderNo || '';
  const amount = meta.amount || '';

  if (mode === 'copy') {
    const name = meta.product || '这款好物';
    return (
      `【商品标题】${name} 高性价比之选｜品质升级 顺丰包邮 7天无理由\n\n` +
      `【核心卖点】\n` +
      `1. 用料扎实：精选优质材质，做工细节经得起放大看，耐用更省心。\n` +
      `2. 体验升级：贴合日常使用场景的人性化设计，上手零门槛。\n` +
      `3. 售后无忧：7 天无理由退换 + 运费险，买得放心用得安心。\n\n` +
      `【详情文案】\n` +
      `还在为挑选${name}纠结吗？我们把功夫都花在你看得见和看不见的细节里。\n` +
      `现在下单享店铺限时优惠，叠加平台满减更划算，库存有限先到先得～\n\n` +
      `（演示文案，配置大模型后可生成更贴合你商品的专属内容）`
    );
  }

  if (mode === 'polish') {
    const src = meta.text || text || '';
    if (!src) return '请先输入需要润色的内容～';
    return (
      `亲，${src.replace(/^亲[，,]?\s*/, '').replace(/[。！!]+$/, '')}～ ` +
      `有任何疑问都可以随时找我，我会第一时间帮您跟进处理哦～`
    );
  }

  if (mode === 'aftersales') {
    const reason = meta.reason || text || '';
    const type = meta.ticketType || '售后';
    return (
      `【处理建议】\n` +
      `1. 先核实订单${orderNo ? '（' + orderNo + '）' : ''}与${type}原因：${reason || '客户诉求待确认'}。\n` +
      `2. 若在 7 天无理由范围内且商品完好，可直接同意${type}，系统自动生成退货地址。\n` +
      `3. 若为质量问题，主动承担来回运费并优先补发/退款，避免升级投诉。\n` +
      `4. 处理时效控制在 24 小时内，并在工单中留痕。\n\n` +
      `【安抚话术】\n` +
      `亲，非常抱歉给您带来不便～ 您反馈的${reason || '问题'}我们已第一时间核实，` +
      `这边马上为您优先处理，预计 24 小时内给您明确答复，请您放心～` +
      (amount ? `涉及金额 ￥${amount}，我们会按平台规则原路退回。` : '')
    );
  }

  if (has('物流', '快递', '发货', '什么时候到', '几天到', '到货', '单号', '催')) {
    return `亲～${product ? product + '的' : ''}订单${orderNo ? '（' + orderNo + '）' : ''}我们会在付款后 48 小时内安排发出，` +
      `发出后会有短信推送物流单号，正常情况下 3-4 天送达，您也可以在订单里实时查看物流进度哦～`;
  }
  if (has('退款', '退货', '换货', '退换', '退了', '不想要')) {
    return `亲，我们支持 7 天无理由退换哦～ 您在「我的订单」里点申请售后，选择退货退款并填写原因，` +
      `把商品保持完好寄回即可，我们收到后 24 小时内为您处理，运费险还能抵扣退回运费，放心～`;
  }
  if (has('尺码', '码数', '大小', '身高', '体重', '偏大', '偏小', '穿几码', '小了', '大了', '选码', '斤')) {
    return `亲，按您平时穿的尺码选就可以啦～ 如果偏瘦可以选小一码，偏壮建议正常码；` +
      `要是拿不准，把身高体重发我，我帮您精确推荐～ 而且支持 7 天无理由换码，放心拍～`;
  }
  if (has('颜色', '材质', '面料', '成分', '质量', '做工', '什么料')) {
    return `亲，${product ? product : '这款'}采用精选优质材质，做工细节经得起放大看，` +
      `颜色以详情页实拍为准（已尽量还原）。您更在意哪方面，我可以帮您重点说明～`;
  }
  if (has('优惠', '便宜', '券', '活动', '满减', '打折', '价格', '多少钱')) {
    return `亲，现在下单可以领店铺满 99 减 15 的优惠券哦～ 叠加平台跨店满减会更划算，` +
      `库存有限先到先得，我这边给您备注优先发货～ 有任何问题随时找我～`;
  }
  if (has('发票', '开票', '税号', '报销')) {
    return `亲，支持开具电子发票～ 您在订单详情里填写发票抬头和税号即可，开好后会发送到您预留的邮箱，如果需要专票我们也可以协助处理～`;
  }
  if (has('你好', '在吗', '在么', '请问', '您好', 'hi', 'hello')) {
    return `亲，您好～ 我是小满AI客服，很高兴为您服务，请问有什么可以帮您？商品、发货、售后都可以问我哦～`;
  }
  if (has('谢谢', '感谢', '好的', '收到')) {
    return `不客气亲～ 能帮到您就好，后续有任何问题随时找我，祝您购物愉快，记得给个好评哦～`;
  }
  return `亲，收到您的消息啦～ 请问您是想了解商品、发货进度，还是售后处理呢？` +
    (product ? `您咨询的「${product}」我可以帮您详细看看～` : '我这边马上帮您跟进～');
}

function streamDemo(res, text) {
  res.writeHead(200, SSE_HEADERS);
  let i = 0;
  const step = () => {
    if (i >= text.length) { sseDone(res); return; }
    const n = 2 + Math.floor(Math.random() * 3);
    sseSend(res, { t: text.slice(i, i + n) });
    i += n;
    setTimeout(step, 18 + Math.random() * 22);
  };
  step();
}

/* ---------------- 真实模型代理 ---------------- */
function proxyChat(res, cfg, messages, opts) {
  let target;
  try {
    target = new URL(cfg.baseURL.replace(/\/+$/, '') + '/chat/completions');
  } catch (e) {
    res.writeHead(200, SSE_HEADERS);
    sseSend(res, { error: 'Base URL 配置无效：' + cfg.baseURL });
    sseDone(res);
    return;
  }
  const payload = JSON.stringify({
    model: cfg.model,
    messages,
    stream: true,
    temperature: typeof opts.temperature === 'number' ? opts.temperature : cfg.temperature,
    max_tokens: opts.max_tokens || 900,
  });
  const lib = target.protocol === 'https:' ? https : http;
  const req = lib.request(target, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + cfg.apiKey,
      Accept: 'text/event-stream',
    },
    timeout: 60000,
  }, (up) => {
    if (up.statusCode >= 400) {
      let b = '';
      up.on('data', (d) => (b += d));
      up.on('end', () => {
        res.writeHead(200, SSE_HEADERS);
        let msg = '上游模型返回 ' + up.statusCode;
        try { msg += '：' + (JSON.parse(b).error?.message || b.slice(0, 300)); }
        catch (e) { msg += '：' + b.slice(0, 300); }
        sseSend(res, { error: msg });
        sseDone(res);
      });
      return;
    }
    res.writeHead(200, SSE_HEADERS);
    let buf = '';
    up.setEncoding('utf8');
    up.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line || !line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') { sseDone(res); return; }
        try {
          const j = JSON.parse(data);
          const delta = j.choices && j.choices[0] && j.choices[0].delta;
          if (delta && delta.content) sseSend(res, { t: delta.content });
        } catch (e) { /* 忽略无法解析的帧 */ }
      }
    });
    up.on('end', () => { try { sseDone(res); } catch (e) {} });
    up.on('error', (e) => { sseSend(res, { error: '上游连接中断：' + e.message }); sseDone(res); });
  });
  req.on('error', (e) => {
    try { res.writeHead(200, SSE_HEADERS); sseSend(res, { error: '连接模型服务失败：' + e.message }); sseDone(res); } catch (x) {}
  });
  req.on('timeout', () => req.destroy(new Error('请求超时')));
  req.write(payload);
  req.end();
}

/** 统一入口：有 Key 走真实模型，否则演示引擎 */
function streamChat(res, cfg, messages, opts = {}) {
  if (!cfg.apiKey) return streamDemo(res, demoGenerate(messages, opts.mode, opts.meta));
  return proxyChat(res, cfg, messages, opts);
}

/** 非流式补全：返回整段文本（用于服务端自动回复；失败返回空串） */
function completeChat(cfg, messages, opts = {}) {
  if (!cfg.apiKey) return Promise.resolve(demoGenerate(messages, opts.mode, opts.meta));
  return new Promise((resolve) => {
    let target;
    try { target = new URL(cfg.baseURL.replace(/\/+$/, '') + '/chat/completions'); }
    catch (e) { return resolve(''); }
    const payload = JSON.stringify({
      model: cfg.model,
      messages,
      stream: false,
      temperature: typeof opts.temperature === 'number' ? opts.temperature : cfg.temperature,
      max_tokens: opts.max_tokens || 600,
    });
    const lib = target.protocol === 'https:' ? https : http;
    const req = lib.request(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
      timeout: 45000,
    }, (up) => {
      let b = '';
      up.on('data', (d) => (b += d));
      up.on('end', () => {
        try {
          const j = JSON.parse(b);
          const ch = (j.choices && j.choices[0]) || {};
          const msg = ch.message || {};
          resolve(String(msg.content || ch.text || '').trim());
        } catch (e) { resolve(''); }
      });
    });
    req.on('error', () => resolve(''));
    req.on('timeout', () => { try { req.destroy(); } catch (e) {} resolve(''); });
    req.write(payload);
    req.end();
  });
}

function listModels(cfg) {
  return new Promise((resolve) => {
    if (!cfg.apiKey) {
      return resolve({
        demo: true,
        models: ['deepseek-chat', 'deepseek-reasoner', 'qwen-plus', 'moonshot-v1-8k', 'gpt-4o-mini'],
      });
    }
    let target;
    try { target = new URL(cfg.baseURL.replace(/\/+$/, '') + '/models'); }
    catch (e) { return resolve({ demo: false, models: [], error: 'Base URL 无效' }); }
    const lib = target.protocol === 'https:' ? https : http;
    const r = lib.request(target, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + cfg.apiKey },
      timeout: 15000,
    }, (up) => {
      let b = '';
      up.on('data', (d) => (b += d));
      up.on('end', () => {
        try {
          const j = JSON.parse(b);
          const list = (j.data || j.models || []).map((m) => m.id || m.name || m).filter(Boolean);
          resolve({ demo: false, models: list });
        } catch (e) {
          resolve({ demo: false, models: [], error: '解析模型列表失败' });
        }
      });
    });
    r.on('error', (e) => resolve({ demo: false, models: [], error: e.message }));
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.end();
  });
}

module.exports = {
  DEFAULTS, getAiConfig, saveAiConfig, publicAi,
  streamChat, listModels, demoGenerate, completeChat,
};
