#!/usr/bin/env node
/**
 * 模板静态体检：扫描 public/app.html 里的 Vue 表达式，找出「模板用了、app.js 里却没有」的
 * 方法 / 字段。这类缺失不会在接口层报错，只会在浏览器渲染时抛 TypeError，直接把整页刷白。
 *
 * 用法：node tools/audit-template.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public/app.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');

/* 1) 收集 v-for 的局部变量名（避免把循环别名当成缺失字段） */
let m;
const loopVars = new Set();
const vfor = /v-for="([^"]*)"/g;
while ((m = vfor.exec(html))) {
  const tail = m[1].split(/\bin\b/)[0] || '';
  tail.replace(/[()[\]]/g, ' ').split(/[\s,]+/).forEach((n) => { if (/^[A-Za-z_$][\w$]*$/.test(n)) loopVars.add(n); });
}
const IGNORE = new Set(['$event', '$refs', '$el', '$emit', '$nextTick', '$set', '$forceUpdate']);
IGNORE.forEach((n) => loopVars.add(n));

/* 2) 收集要检查的表达式片段 */
const exprs = [];
const mustache = /\{\{([\s\S]*?)\}\}/g;
while ((m = mustache.exec(html))) exprs.push(m[1]);

const attr = /(?:@[\w.:-]+|v-[\w:.-]+|:[\w.:-]+)="([^"]*)"/g;
while ((m = attr.exec(html))) exprs.push(m[1]);

/* 2) 抽方法调用（排除 JS 内置与常见全局） */
const BUILTIN = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function', 'new', 'in', 'of',
  'Number', 'String', 'Boolean', 'Array', 'Object', 'Date', 'Math', 'JSON', 'parseInt', 'parseFloat',
  'isNaN', 'encodeURIComponent', 'decodeURIComponent', 'setTimeout', 'clearTimeout', 'alert', 'confirm',
]);

const calls = new Map();
for (const e of exprs) {
  const re = /(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
  let c;
  while ((c = re.exec(e))) {
    const name = c[1];
    if (BUILTIN.has(name)) continue;
    if (!calls.has(name)) calls.set(name, e.trim().slice(0, 90));
  }
}

/* 3) 抽属性访问的根标识符（a.b -> a），排除字面量与局部变量 */
const roots = new Map();
for (const e of exprs) {
  const re = /(?:^|[^.\w$'"])([A-Za-z_$][\w$]*)(?=\s*[.[)])/g;
  let r;
  while ((r = re.exec(e))) {
    const name = r[1];
    if (BUILTIN.has(name)) continue;
    if (!roots.has(name)) roots.set(name, e.trim().slice(0, 90));
  }
}

const missingCalls = [];
for (const [name, sample] of calls) {
  const defined =
    new RegExp(`(^|[^\\w$.])${name}\\s*\\(`, 'm').test(js) ||
    new RegExp(`(^|[^\\w$.])${name}\\s*:\\s*(async\\s*)?(\\(|function)`, 'm').test(js) ||
    new RegExp(`(^|[^\\w$.])${name}\\s*:\\s*(async\\s*)?[A-Za-z_$][\\w$]*\\s*,`, 'm').test(js);
  if (!defined) missingCalls.push({ name, sample });
}

const missingRoots = [];
for (const [name, sample] of roots) {
  if (loopVars.has(name)) continue;
  if (new RegExp(`(^|[^\\w$.'"])${name}([^\\w$]|$)`, 'm').test(js)) continue;
  missingRoots.push({ name, sample });
}

const pad = (s, n) => String(s).padEnd(n, ' ');
if (!missingCalls.length && !missingRoots.length) {
  console.log(`✓ 模板体检通过：${calls.size} 个方法调用、${roots.size} 个属性引用全部有定义`);
  process.exit(0);
}
if (missingCalls.length) {
  console.log(`✗ 模板调用了未定义的方法（${missingCalls.length}）：`);
  for (const r of missingCalls) console.log('  - ' + pad(r.name, 18) + ' ← ' + r.sample);
}
if (missingRoots.length) {
  console.log(`✗ 模板引用了不存在的字段（${missingRoots.length}）：`);
  for (const r of missingRoots) console.log('  - ' + pad(r.name, 18) + ' ← ' + r.sample);
}
process.exit(1);
