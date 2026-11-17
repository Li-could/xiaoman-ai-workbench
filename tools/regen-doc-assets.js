'use strict';
/**
 * 重建演示素材的文档文件（.doc RTF / .pdf）：
 * 早期版本的 rtfDoc 把中文裸写为 UTF-8 字节，导致预览与 Word 打开均乱码；
 * 本脚本用修复后的生成器按同名文件幂等重写，内容文本取种子定义。
 * 用法：node tools/regen-doc-assets.js
 */
const path = require('path');
const db = require('../lib/db');
const { generateAsset } = require('../lib/gen-asset');
const { MATERIALS } = require('../lib/seed-modules');

const byName = {};
MATERIALS.forEach((m) => { byName[m.name] = m; });

const rows = db.all("SELECT DISTINCT name, content FROM materials WHERE content LIKE '%.doc' OR content LIKE '%.pdf'");
let n = 0;
rows.forEach((r) => {
  const seed = byName[r.name];
  if (!seed) { console.log('跳过（非种子素材，视为用户上传）:', r.name); return; }
  const url = generateAsset(seed); // 同名幂等重写
  console.log('重建:', r.name, '->', url);
  n++;
});
console.log('完成，共重建', n, '个文档文件');
