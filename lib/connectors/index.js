'use strict';
/**
 * 平台连接器注册表
 *
 * 只有真正实现了对接的平台才会出现在这里。没实现的平台不会伪装成可用，
 * 前端拿到 supported=false 后会明确提示"尚未对接"，避免出现演示效果。
 */
const taobao = require('./taobao');

const REGISTRY = {
  taobao: {
    ...taobao,
    aliases: ['淘宝', '天猫', 'taobao', 'tmall'],
    envs: ['prod', 'sandbox'],
    /** 该平台是否需要 AppKey/AppSecret */
    needsApp: true,
    docs: 'https://open.taobao.com',
  },
};

/** 平台名 → key（兼容前端传"淘宝/天猫"这种中文名） */
function normalize(platform) {
  const p = String(platform || '').trim();
  if (!p) return '';
  for (const key of Object.keys(REGISTRY)) {
    const c = REGISTRY[key];
    if (key === p.toLowerCase()) return key;
    if ((c.aliases || []).some((a) => a.toLowerCase() === p.toLowerCase())) return key;
    if (p.indexOf(c.name) >= 0 || p.indexOf('天猫') >= 0 && key === 'taobao') return key;
  }
  return p.toLowerCase();
}

function get(platform) {
  return REGISTRY[normalize(platform)] || null;
}

function supported(platform) {
  return Boolean(get(platform));
}

/** 供前端展示：哪些平台能真接、哪些还没做 */
function catalog() {
  return Object.keys(REGISTRY).map((key) => ({
    key,
    name: REGISTRY[key].name,
    aliases: REGISTRY[key].aliases,
    supported: true,
    capabilities: REGISTRY[key].CAPABILITIES,
    docs: REGISTRY[key].docs,
  }));
}

module.exports = { REGISTRY, normalize, get, supported, catalog };
