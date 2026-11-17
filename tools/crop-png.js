'use strict';
/**
 * 纯 Node（无第三方依赖）PNG 裁剪工具
 * 用途：把生成图右下角的水印区域裁掉（按比例裁高度），保持宽度不变。
 * 支持 bitDepth=8、colorType 0/2/4/6、非隔行扫描的 PNG。
 *
 * 用法：node tools/crop-png.js <src.png> <dst.png> [keepRatio=0.9]
 */
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

/* ---------- CRC32 ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ---------- 读块 ---------- */
function readChunks(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG 文件');
  const chunks = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    chunks.push({ type, data });
    off += 12 + len;
  }
  return chunks;
}

/* ---------- 写块 ---------- */
function writeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/* ---------- Paeth 预测 ---------- */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/* ---------- 反 filter，得到原始像素行 ---------- */
function unfilter(raw, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const ft = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const v = line[x];
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let val;
      if (ft === 0) val = v;
      else if (ft === 1) val = v + a;
      else if (ft === 2) val = v + b;
      else if (ft === 3) val = v + ((a + b) >> 1);
      else if (ft === 4) val = v + paeth(a, b, c);
      else throw new Error('未知 filter 类型: ' + ft);
      cur[x] = val & 0xff;
    }
  }
  return out;
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function cropPng(srcBuf, keepRatio) {
  const chunks = readChunks(srcBuf);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const interlace = ihdr.data[12];
  if (bitDepth !== 8 || interlace !== 0 || !CHANNELS[colorType]) {
    throw new Error(`不支持的 PNG 参数 bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}`);
  }
  const bpp = CHANNELS[colorType];
  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const raw = zlib.inflateSync(idat);
  const pixels = unfilter(raw, width, height, bpp);

  const newH = Math.max(1, Math.round(height * keepRatio));
  const stride = width * bpp;

  // 重新装成 filter=0 的扫描行
  const lines = Buffer.alloc((stride + 1) * newH);
  for (let y = 0; y < newH; y++) {
    lines[y * (stride + 1)] = 0;
    pixels.copy(lines, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const outIhdr = Buffer.from(ihdr.data);
  outIhdr.writeUInt32BE(newH, 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    writeChunk('IHDR', outIhdr),
    writeChunk('IDAT', zlib.deflateSync(lines, { level: 9 })),
    writeChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- 命令行入口 ---------- */
if (require.main === module) {
  const [, , src, dst, ratio] = process.argv;
  if (!src || !dst) {
    console.error('用法: node tools/crop-png.js <src.png> <dst.png> [keepRatio=0.9]');
    process.exit(1);
  }
  const keep = ratio ? Number(ratio) : 0.9;
  const out = cropPng(fs.readFileSync(src), keep);
  fs.mkdirSync(path.dirname(path.resolve(dst)), { recursive: true });
  fs.writeFileSync(dst, out);
  console.log(`OK ${path.basename(src)} -> ${path.basename(dst)} (keep ${Math.round(keep * 100)}%) ${out.length} bytes`);
}

module.exports = { cropPng };
