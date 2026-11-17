'use strict';
/**
 * 存量数据升级：把素材中心占位图换成真实商品照片
 *  - image 类型且命中商品图映射：content 指向 /uploads/products/xxx.png
 *  - 所有素材：poster 写入封面图（视频卡片缩略图用）
 * 幂等，可重复执行。
 */
const { all, run } = require('../lib/db');
const { productImage, posterFor } = require('../lib/product-images');

const rows = all('SELECT id,name,type,content,poster FROM materials');
let nContent = 0, nPoster = 0;
const missing = [];

for (const m of rows) {
  const photo = productImage(m.name);
  if (photo) {
    const fs = require('fs');
    const file = require('path').join(__dirname, '..', 'public', photo.replace(/^\//, ''));
    if (!fs.existsSync(file)) missing.push(photo);
  }
  if (m.type === 'image' && photo && m.content !== photo) {
    run('UPDATE materials SET content = ? WHERE id = ?', photo, m.id);
    nContent++;
  }
  const poster = posterFor(m.name);
  if (poster && m.poster !== poster) {
    run('UPDATE materials SET poster = ? WHERE id = ?', poster, m.id);
    nPoster++;
  }
}

console.log(`素材 ${rows.length} 条：更新真实图片 ${nContent} 条，写入封面图 ${nPoster} 条`);
if (missing.length) console.log('缺少文件：', [...new Set(missing)].join(', '));
