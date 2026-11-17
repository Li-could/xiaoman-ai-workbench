'use strict';
/**
 * 极简 .env 读取（零依赖）
 * - 从项目根目录读取 .env
 * - 已存在的真实环境变量优先，不会被 .env 覆盖（部署时用环境变量注入更安全）
 */
const fs = require('fs');
const path = require('path');

let cached = null;

function parse(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function loadEnv(file) {
  if (cached) return cached;
  const p = file || process.env.ENV_FILE || path.join(__dirname, '..', '.env');
  let map = {};
  try {
    if (fs.existsSync(p)) map = parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    map = {};
  }
  for (const k of Object.keys(map)) {
    if (process.env[k] === undefined) process.env[k] = map[k];
  }
  cached = map;
  return map;
}

module.exports = { loadEnv, parse };
