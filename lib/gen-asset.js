'use strict';
/**
 * 演示素材资源生成器
 * - 为「素材中心」的种子数据生成真实可预览的图片（SVG）、文本、PDF 文件，
 *   写入 public/uploads/ 并返回可访问的 URL，使卡片能真正显示预览而非占位图标。
 * 所有函数为纯函数 / 幂等写盘，可重复调用。
 */
const fs = require('fs');
const path = require('path');
const { productImage, posterFor, videoFile } = require('./product-images');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');

/* ---------- 颜色工具 ---------- */
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [22, 93, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lighten([r, g, b], k = 0.35) {
  return [
    Math.round(r + (255 - r) * k),
    Math.round(g + (255 - g) * k),
    Math.round(b + (255 - b) * k),
  ];
}
function rgbCss([r, g, b]) { return `rgb(${r},${g},${b})`; }

/* ---------- 图标路径（在 120x120 视窗内居中绘制） ---------- */
function iconPath(kind) {
  switch (kind) {
    case 'video':
      return '<polygon points="48,40 88,60 48,80" fill="#fff"/>';
    case 'doc':
      return '<rect x="42" y="34" width="36" height="52" rx="4" fill="#fff"/>' +
        '<rect x="50" y="44" width="20" height="3" fill="#94a3b8"/>' +
        '<rect x="50" y="54" width="20" height="3" fill="#94a3b8"/>' +
        '<rect x="50" y="64" width="14" height="3" fill="#94a3b8"/>';
    case 'text':
      return '<rect x="38" y="36" width="44" height="34" rx="8" fill="#fff"/>' +
        '<polygon points="50,70 50,82 64,70" fill="#fff"/>' +
        '<rect x="46" y="46" width="28" height="3" fill="#94a3b8"/>' +
        '<rect x="46" y="54" width="20" height="3" fill="#94a3b8"/>';
    case 'gift':
      return '<rect x="44" y="58" width="32" height="24" rx="3" fill="#fff"/>' +
        '<rect x="44" y="50" width="32" height="10" fill="#fff"/>' +
        '<rect x="57" y="50" width="6" height="32" fill="#f59e0b"/>';
    case 'image':
    default:
      return '<rect x="38" y="40" width="44" height="40" rx="5" fill="#fff"/>' +
        '<circle cx="52" cy="54" r="6" fill="#94a3b8"/>' +
        '<polygon points="42,76 58,58 68,70 76,62 78,76" fill="#94a3b8"/>';
  }
}

/* ---------- 生成一张素材预览图（SVG） ---------- */
function materialSvg({ name, tag, color = '#165DFF', kind = 'image', w = 600, h = 400 }) {
  const base = hexToRgb(color);
  const top = rgbCss(base);
  const bottom = rgbCss(lighten(base, 0.45));
  const gid = 'g' + Math.abs(hashStr(name + color)).toString(36);
  const label = (name || '素材').replace(/\.[a-z0-9]+$/i, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${top}"/>
      <stop offset="1" stop-color="${bottom}"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#${gid})"/>
  <circle cx="${w - 90}" cy="90" r="150" fill="#ffffff" opacity="0.08"/>
  <circle cx="80" cy="${h - 70}" r="110" fill="#ffffff" opacity="0.06"/>
  <g transform="translate(${w / 2 - 105}, ${h / 2 - 165}) scale(2.1)" fill-opacity="0.95">${iconPath(kind)}</g>
  <text x="${w / 2}" y="${h - 64}" text-anchor="middle" font-family="'PingFang SC','Microsoft YaHei',sans-serif" font-size="34" font-weight="700" fill="#ffffff">${escapeXml(label)}</text>
  <text x="${w / 2}" y="${h - 30}" text-anchor="middle" font-family="'PingFang SC','Microsoft YaHei',sans-serif" font-size="18" fill="#ffffff" opacity="0.85">${escapeXml(tag || '')} · 小满 AI 素材</text>
</svg>`;
}

function escapeXml(s) {
  return String(s || '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/* ---------- 真实文本文件 ---------- */
function textFile(content) {
  return content;
}
/* ---------- 极简 RTF（.doc）：Word / WPS 可直接打开 ---------- */
/* RTF 中文字符必须用 \uN? 转义（N 为有符号 16 位码位，? 为替代字符），
   裸写 UTF-8 字节会被按 ANSI 解释而乱码 */
function rtfEscape(s) {
  let out = '';
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0);
    if (ch === '\\' || ch === '{' || ch === '}') { out += '\\' + ch; continue; }
    if (cp < 0x80) { out += ch; continue; }
    if (cp < 0x10000) {
      out += '\\u' + (cp > 0x7FFF ? cp - 0x10000 : cp) + '?';
    } else {
      const v = cp - 0x10000;
      out += '\\u' + (0xD800 + (v >> 10) - 0x10000) + '?\\u' + (0xDC00 + (v & 0x3FF) - 0x10000) + '?';
    }
  }
  return out;
}
function rtfDoc(text) {
  const body = String(text || '').split('\n')
    .map((l) => rtfEscape(l))
    .map((l) => (l ? l : ' '))
    .join('\\par\n');
  return '{\\rtf1\\ansi\\ansicpg936\\deff0{\\fonttbl{\\f0\\fnil\\fcharset134 Microsoft YaHei;}}\\fs22\\f0 ' + body + '\\par}';
}
/* ---------- 极简但合法的 PDF ---------- */
/* 含中文时使用非嵌入 CID 字体 STSong-Light + UniGB-UCS2-H 编码（浏览器 PDF 查看器与 WPS 均可渲染），
   纯英文仍用 Helvetica 保持最小体积 */
function minimalPdf(text) {
  const rawLines = String(text || '小满 AI 素材').split('\n');
  const hasCjk = /[^\x00-\xff]/.test(String(text || ''));
  // 按页宽自动折行（中文约 32 字/行，英文约 64 字符/行）
  const lines = [];
  rawLines.forEach((l) => {
    let cur = '';
    for (const ch of l) {
      cur += ch;
      const w = [...cur].reduce((a, c) => a + (c.codePointAt(0) > 0xff ? 1 : 0.5), 0);
      if (w >= 32) { lines.push(cur); cur = ''; }
    }
    lines.push(cur || ' ');
  });

  let content;
  let fontObj;
  if (hasCjk) {
    const hexOf = (l) => '<' + [...l].map((c) => {
      const cp = c.codePointAt(0);
      if (cp < 0x10000) return cp.toString(16).padStart(4, '0');
      const v = cp - 0x10000;
      return (0xD800 + (v >> 10)).toString(16).padStart(4, '0') + (0xDC00 + (v & 0x3FF)).toString(16).padStart(4, '0');
    }).join('').toUpperCase() + '>';
    content = lines.map((l, i) =>
      `BT /F1 13 Tf 60 ${720 - i * 22} Td ${hexOf(l)} Tj ET`
    ).join('\n');
    fontObj = '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [6 0 R] >>';
  } else {
    content = lines.map((l, i) =>
      `BT /F1 14 Tf 60 ${720 - i * 22} Td (${pdfEscape(l)}) Tj ET`
    ).join('\n');
    fontObj = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  }

  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    fontObj,
    ...(hasCjk ? ['<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 2 >> >>'] : []),
  ];
  let pdf = '%PDF-1.4\n';
  let offset = pdf.length;
  const offsets = [];
  objs.forEach((o, i) => {
    offsets[i + 1] = offset;
    const body = `${i + 1} 0 obj\n${o}\nendobj\n`;
    pdf += body;
    offset += body.length;
  });
  const xrefStart = offset;
  pdf += `xref\n0 ${objs.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objs.length; i++) {
    pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return pdf;
}
function pdfEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/* ---------- 写盘 + 返回 URL ---------- */
function ensureDir() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
const usedNames = new Set();
function uniqueFile(base, ext) {
  let name = base + ext;
  let i = 2;
  while (usedNames.has(name)) name = `${base}-${i++}${ext}`;
  usedNames.add(name);
  return name;
}

/**
 * 为一条素材生成真实资源，返回可访问 URL（或 null 表示不生成）。
 * @param {{name:string,type:string,tag?:string,color?:string,text?:string}} m
 */
function writeAsset(base, ext, content) {
  // 同一素材名重复生成时复用同名文件（幂等，避免 -2/-3 副本堆积）
  const fn = base + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, fn), content);
  return '/uploads/' + fn;
}

/* 为文档类素材写 UTF-8 文本伴生文件（<文件名>.txt），
   预览接口优先读它渲染，彻底绕开 PDF/RTF 字体与编码兼容问题 */
function writeSidecar(url, text) {
  try {
    fs.writeFileSync(path.join(UPLOAD_DIR, url.replace('/uploads/', '') + '.txt'), String(text || ''), 'utf8');
  } catch (e) { /* 伴生文件失败不影响主文件 */ }
}

function generateAsset(m) {
  ensureDir();
  const safe = (m.name || 'material').replace(/[^\w\u4e00-\u9fa5.-]/g, '_').slice(0, 40);
  if (m.type === 'image') {
    /* 命中真实商品照片时直接用照片，不再生成渐变占位图 */
    const photo = productImage(m.name);
    if (photo) return photo;
    const kind = m.tag === '活动素材' ? 'gift' : 'image';
    const svg = materialSvg({ name: m.name, tag: m.tag, color: m.color, kind });
    return writeAsset('demo-' + safe, '.svg', svg);
  }
  if (m.type === 'text') {
    return writeAsset(safe, '.txt', m.text || (m.name + '\n\n（演示话术占位内容）'));
  }
  if (m.type === 'doc' && /\.pdf$/i.test(m.name || '')) {
    const src = m.text || (m.name + '\n\n（演示文档占位内容）');
    const url = writeAsset(safe, '.pdf', minimalPdf(src));
    writeSidecar(url, src);
    return url;
  }
  if (m.type === 'doc') {
    // docx/xlsx 等复杂格式不生成，改用 RTF(.doc)：Word / WPS 可直接打开
    const src = m.text || (String(m.name || '演示文档').replace(/\.[a-z0-9]+$/i, '') + '\n\n（演示文档占位内容，可自行上传真实文件替换）');
    const url = writeAsset(safe, '.doc', rtfDoc(src));
    writeSidecar(url, src);
    return url;
  }
  if (m.type === 'video') {
    /* 命中真实视频文件时直接绑定，可播放；否则返回 ''（仅封面占位） */
    return videoFile(m.name);
  }
  return '';
}

module.exports = { materialSvg, generateAsset, minimalPdf, textFile, posterFor, UPLOAD_DIR };
