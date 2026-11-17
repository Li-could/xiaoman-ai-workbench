'use strict';
/* 小满消息桥 · 内容脚本（注入到商家后台页面）
 * 原理：不需要平台 API。页面已经登录、聊天列表本来就展示在 DOM 里，
 * 这里做的是「读屏」——周期扫描会话列表，发现"谁发了什么新话"就上报。
 *
 * 抓取策略（按优先级）：
 *  1. 用户在扩展弹窗里配置的自定义选择器（最准）
 *  2. 当前站点的内置适配器
 *  3. 通用启发式：遍历疑似会话项元素，取第一行作昵称、最后一行作最新话术
 *
 * 用「昵称+话术」做指纹去重，同一句话只上报一次。
 */
(function () {
  if (window.__xmBridgeLoaded) return;
  window.__xmBridgeLoaded = true;

  const TAG = '[小满消息桥]';

  /* ---------------- 上下文失效保护 ----------------
   * 扩展被重新加载/更新后，本页面里的旧脚本 chrome.runtime 会失效，
   * 继续调用会抛 "Extension context invalidated"。这里检测到失效
   * 就停掉所有定时器和观察器，静默退出，等用户刷新页面加载新脚本。
   */
  let alive = true;
  const timers = new Set();
  const observers = new Set();

  function ctxOk() {
    try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
  }
  function shutdown() {
    if (!alive) return;
    alive = false;
    timers.forEach((t) => clearInterval(t));
    observers.forEach((o) => { try { o.disconnect(); } catch (e) {} });
    console.log(TAG, '扩展已更新，本页面监听已停止；刷新页面后即可恢复');
  }
  function isInvalidErr(err) {
    return /Extension context invalidated|Cannot read propert|disconnected/i.test(String((err && err.message) || err || ''));
  }

  /* ---------------- 站点适配器 ---------------- */
  /* 各平台客服工作台的 DOM 结构会变，这里给常见值；抓不准时在弹窗里自定义选择器 */
  const ADAPTERS = [
    {
      match: /pinduoduo\.com/,
      name: '拼多多',
      list: '.conversation-list, [class*="conversation"], [class*="session-list"], [class*="chat-list"]',
      item: '[class*="conversation-item"], [class*="session-item"], [class*="chat-item"], li',
      input: 'textarea, [contenteditable="true"]',
      send: '',   // 留空走「发送」文字按钮启发式
    },
    {
      match: /taobao|tmall/,
      name: '淘宝/千牛',
      list: '[class*="contact"], [class*="session"], [class*="conversation"]',
      item: '[class*="contact-item"], [class*="session-item"], li',
      input: 'textarea, [contenteditable="true"]',
      send: '',
    },
    {
      match: /jinritemai|douyin/,
      name: '抖店',
      list: '[class*="session"], [class*="conversation"], [class*="im-list"]',
      item: '[class*="session-item"], [class*="conversation-item"], li',
      input: 'textarea, [contenteditable="true"]',
      send: '',
    },
    {
      match: /jd\.com/,
      name: '京东',
      list: '[class*="session"], [class*="chat"], [class*="contact"]',
      item: '[class*="session-item"], [class*="chat-item"], li',
      input: 'textarea, [contenteditable="true"]',
      send: '',
    },
  ];

  function adapterFor(host) {
    return ADAPTERS.find((a) => a.match.test(host)) || null;
  }

  function cfg() {
    return new Promise((resolve) => {
      if (!ctxOk()) { shutdown(); return resolve(null); }
      try {
        chrome.storage.sync.get({ hookUrl: '', enabled: true, selectors: null, onlyUnread: true, autoHarvest: true }, (v) => {
          /* chrome.runtime.lastError 存在说明调用失败（如上下文失效） */
          if (chrome.runtime.lastError) {
            if (isInvalidErr(chrome.runtime.lastError)) shutdown();
            return resolve(null);
          }
          resolve(v || null);
        });
      } catch (e) {
        if (isInvalidErr(e)) shutdown();
        resolve(null);
      }
    });
  }

  /* 安全地向后台发消息：上下文失效时静默停机 */
  function safeSend(msg, cb) {
    if (!alive || !ctxOk()) { shutdown(); return; }
    try {
      chrome.runtime.sendMessage(msg, (resp) => {
        if (chrome.runtime.lastError) {
          if (isInvalidErr(chrome.runtime.lastError)) shutdown();
          return;
        }
        if (cb) cb(resp);
      });
    } catch (e) {
      if (isInvalidErr(e)) shutdown();
    }
  }

  /* 平台官方/系统账号黑名单：这些是平台给商家发的通知、以及商家后台左侧导航菜单项，不是买家，不抓取 */
  const NAME_JUNK = /争议澄清|履行.{0,4}义务|须知|公告|声明|规则|协议|提示|加载|没有更多/;
  const SYSTEM_ACCOUNTS = /(共享仓|流量数据|供货管理|商品推广|平台通知|平台消息|平台公告|系统消息|系统通知|官方通知|官方消息|商家成长|店铺通知|违规|活动通知|招商|入驻|平台客服|客服助手|通知中心|营销工具|数据中心|订单提醒|官方活动|推广概况|全站营销|多活动|全店报名|限量上大促|抢单神器|品牌权益|优店优品|品质诊断|商品领航员|类目服务费|机会商品|商品工具|商品素材|商品体检|价格管理|评价管理|商品列表|降退款督导|挽单工具|拦截快递|小额打款|极速退款|消费者体验|商家举证|工单管理|偏远大件|商家寄件|发货权益|物流异常|上门安装|报备额度|物流概况|电子面单|物流工具|订单开票|发货中心|包裹中心|官方ERP|打单工具|TEMU|售后工作台|订单查询|发布新商品|后台首页|新客立减|多多视频|营销活动|服务数据|经营总览|交易数据|商品数据|营销书院|推广账户|推广工具|推广报表|明星店铺|直播推广|店铺营销|营销中心|商品管理|订单管理|售后管理|物流管理|数据中心|店铺管理|账户资金|多多进宝|服务市场)/;

  /* 平台 UI 标签（会话列表顶部的「全部 / 未读 / 待回复」、后台栏目标题等）：精确匹配，不是买家昵称 */
  const UI_LABELS = new Set([
    '全部', '未读', '待回复', '已回复', '全部会话', '全部消息', '会话', '消息', '搜索',
    '店铺动态', '营销推广', '平台动态', '规则更新', '重要通知', '公告', '通知', '系统消息',
    '平台消息', '官方消息', '客服消息', '店铺通知', '活动通知', '订单通知', '售后通知',
  ]);
  function isUiLabel(name) {
    return UI_LABELS.has(String(name || '').trim());
  }

  /* 识别「未读角标」：真实买家来新消息才会有未读数/小红点；我们自己回复过的没有 */
  function hasUnread(el) {
    let els = [];
    try { els = Array.from(el.querySelectorAll('[class*="badge"],[class*="unread"],[class*="count"],[class*="dot"],[class*="num"],[class*="tip"],[class*="red"]')); } catch (e) { return true; }
    for (const b of els) {
      if (!visible(b)) continue;
      const t = (b.textContent || '').trim();
      if (/^\d{1,3}$/.test(t) && parseInt(t, 10) > 0) return true;
      /* 无文字的小红点 */
      if (!t) { const r = b.getBoundingClientRect(); if (r.width > 0 && r.width <= 16 && r.height > 0 && r.height <= 16) return true; }
    }
    return false;
  }

  /* 去掉预览里的发言者前缀（如 "我：xxx"、"客服：xxx"），用于判断是否是我们自己发的话 */
  function stripSpeaker(t) {
    return String(t || '').replace(/^(我|客服|小利|店小二|本人)[:：]\s*/, '').trim();
  }

  /* 我们刚回写到平台的回复（防自抓循环）：text → 时间 */
  const selfSent = new Map();
  const SELF_TTL = 30 * 60 * 1000;
  function rememberSelf(text) {
    const k = String(text || '').trim().slice(0, 500);
    if (k) selfSent.set(k, Date.now());
  }
  function wasSentByUs(text) {
    const k = stripSpeaker(text).slice(0, 500);
    if (!k) return false;
    for (const [sent, t] of selfSent) {
      if (Date.now() - t > SELF_TTL) { selfSent.delete(sent); continue; }
      if (sent === k || sent.indexOf(k) === 0 || k.indexOf(sent) === 0) return true;
    }
    return false;
  }

  /* 提取一个会话项的 { 昵称, 最新话术 } */
  function pickItem(el, sel) {
    const full = (el.innerText || '').trim();
    if (!full) return null;
    const lines = full.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    if (!lines.length) return null;

    let name = '';
    let text = '';
    if (sel && sel.name) {
      const n = el.querySelector(sel.name);
      if (n) name = (n.innerText || '').trim();
    }
    if (sel && sel.text) {
      const t = el.querySelector(sel.text);
      if (t) text = (t.innerText || '').trim();
    }
    if (!name) name = lines[0];
    if (!text) text = lines[lines.length - 1];
    /* 名字和话术取到同一段时，话术取第二行 */
    if (text === name && lines.length > 1) text = lines[1];
    /* 标题和预览完全一样 → 这是后台导航菜单项（如"包裹中心/包裹中心"），不是聊天会话 */
    if (text === name) return null;
    if (!name || !text) return null;
    return { name: name.slice(0, 40), text: text.slice(0, 500) };
  }

  /* 已上报指纹（昵称:话术 → 时间），避免同一句话重复推送 */
  const seen = new Map();
  const SEEN_TTL = 10 * 60 * 1000;
  function isNew(fp) {
    const t = seen.get(fp) || 0;
    if (Date.now() - t < SEEN_TTL) return false;
    return true;
  }
  function mark(fp) { seen.set(fp, Date.now()); }

  /* 判断当前页是不是「聊天/客服」页面：商家后台首页、商品页等也有大量列表项，
   * 在那些页面扫描会把菜单、功能入口误当成买家会话。 */
  function looksLikeChatPage() {
    const u = (location.pathname + location.search).toLowerCase();
    if (/chat|message|session|conversation|kefu|im\//.test(u)) return true;
    /* URL 看不出来时，用「页面里有聊天输入框」作为判据（聊天页必有输入框） */
    let eds = [];
    try {
      eds = Array.from(document.querySelectorAll('textarea, [contenteditable="true"]'));
    } catch (e) { return false; }
    for (const el of eds) {
      const r = el.getBoundingClientRect();
      if (r.width > 100 && r.height > 14) return true;
    }
    /* 再兜底：页面里有多处时间分隔条，且中间有可滚动的大区块 → 基本就是聊天页 */
    try {
      let n = 0;
      const leaves = textLeaves(document.body, 400);
      for (const lf of leaves) {
        if (lf.text.length <= 24 && TIME_BAR.test(lf.text.replace(/\s+/g, ' ').trim())) n++;
        if (n >= 2) break;
      }
      if (n >= 2) return !!findChatPanel();
    } catch (e) { /* 忽略 */ }
    return false;
  }

  /* DOM 一变就扫一次；用时间戳节流而不是 setTimeout（后台标签页里定时器会被浏览器
   * 降频到 1 次/分钟，直接调用才不会被拖慢） */
  let scanning = false;
  let lastScanAt = 0;
  function scan() {
    if (!alive || scanning) return;
    const now = Date.now();
    if (now - lastScanAt < 700) return;
    lastScanAt = now;
    scanning = true;
    scanInner().catch((e) => {
      if (isInvalidErr(e)) shutdown();
      /* 其它异常静默，避免刷屏 */
    }).then(() => { scanning = false; }, () => { scanning = false; });
  }
  async function scanInner() {
    if (!alive) return;
    if (!ctxOk()) { shutdown(); return; }
    const c = await cfg();
    if (!c || !alive) return;
    if (!c.enabled || !c.hookUrl) return;
    /* 心跳先行：不管当前页能不能抓，都让工作台知道扩展停在哪一页（便于排查"接了但收不到"） */
    if (window.top === window) {
      safeSend({ __xm: true, type: 'beat', url: location.href, capturedAt: 0 });
    }
    /* 「聊天记录查询」页交给专门的采集逻辑，不做实时扫描（否则左侧账号列表会被当成会话） */
    if (isHistoryPage()) return;
    /* 非聊天页不扫描：避免把后台首页的菜单/功能入口当成买家会话 */
    if (!looksLikeChatPage()) return;
    /* 聊天页：先把「当前打开这段对话」的完整内容推过去（客户 + 我方，含图片/链接） */
    try { await captureLive(c); } catch (e) { /* 单人面板没找到就跳过，不影响列表抓取 */ }

    const host = location.host;
    const ad = adapterFor(host);
    const sel = c.selectors || {};
    const listSel = sel.list || (ad && ad.list) || '';
    const itemSel = sel.item || (ad && ad.item) || 'li, [class*="item"]';

    /* 找到会话列表容器；找不到就在 body 下按项选择器找 */
    let scope = document.body;
    if (listSel) {
      const l = document.querySelector(listSel);
      if (l) scope = l;
    }
    let items = [];
    try { items = Array.from(scope.querySelectorAll(itemSel)); } catch (e) { items = []; }

    /* 只保留"像会话项"的：有文字、长度适中、在可视区 */
    items = items.filter((el) => {
      const t = (el.innerText || '').trim();
      if (t.length < 2 || t.length > 600) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }).slice(0, 50);

    let found = 0;
    for (const el of items) {
      const it = pickItem(el, sel);
      if (!it) continue;
      /* 跳过平台官方/系统账号（共享仓管理、流量数据这类是平台通知，不是买家） */
      if (SYSTEM_ACCOUNTS.test(it.name)) continue;
      /* 跳过列表顶部的功能标签（全部 / 未读 / 店铺动态 …） */
      if (isUiLabel(it.name)) continue;
      /* 默认只抓「有未读角标」的会话：我们自己回复过的会话没有未读，防止把回复又抓回来 */
      if (c.onlyUnread !== false && !hasUnread(el)) continue;
      /* 兜底：预览文字若是我们刚发出去的回复，跳过 */
      if (wasSentByUs(it.text)) continue;
      const fp = it.name + ':' + it.text;
      if (!isNew(fp)) continue;
      mark(fp);

      safeSend({
        __xm: true, type: 'capture',
        payload: {
          text: it.text,
          name: it.name,
          visitor: 'web_' + simpleHash(host + it.name),
          channel: 'web_' + ((ad && ad.name) || host),
          page: location.href,
        },
      }, (resp) => {
        if (resp && resp.ok) found++;
      });
    }
    /* 心跳（顺便上报"最近一次抓到消息的时间"和当前页面，便于工作台显示平台/页面） */
    safeSend({
      __xm: true, type: 'beat',
      url: location.href,
      capturedAt: items.length ? Date.now() : 0,
    });
  }

  function simpleHash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
    return h.toString(36);
  }

  /* ---------------- 聊天记录查询页：整段对话导入 ----------------
   * 平台后台的「聊天记录查询」页能直接看到 买家账号 + 全部往来消息
   * （文字、商品链接、图片、系统提示、每条消息的时间）。
   * 这里把页面读出来，按买家逐条推给工作台，形成和平台一致的完整会话记录。
   */
  const TIME_RE = /20\d{2}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?/;

  function textOf(el) { return ((el && el.innerText) || '').trim(); }

  /* 是不是"聊天记录查询"页：有「消费者账号」列，或「查询结果 + 聊天记录」表头 */
  function isHistoryPage() {
    const t = textOf(document.body).slice(0, 8000);
    if (/消费者账号/.test(t)) return true;
    return /查询结果/.test(t) && /聊天记录/.test(t);
  }

  function countTimes(el) {
    let n = 0;
    try {
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let x;
      while ((x = w.nextNode())) {
        if (TIME_RE.test(x.nodeValue || '')) n++;
        if (n > 2) break;
      }
    } catch (e) { return 0; }
    return n;
  }

  /* 所有"时间"叶子节点：每条聊天记录右侧都有「2026-10-25 20:18:57」 */
  function timeNodes() {
    const out = [];
    if (!document.body) return out;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let el;
    while ((el = w.nextNode())) {
      if (el.children.length) continue;
      const t = (el.textContent || '').trim();
      if (t.length <= 20 && TIME_RE.test(t)) out.push(el);
    }
    return out;
  }

  /* 从一个时间节点向上找"一整行"（只含这一个时间，且宽度够） */
  function rowOf(timeEl) {
    let el = timeEl;
    for (let i = 0; i < 7; i++) {
      const p = el.parentElement;
      if (!p || p === document.body) break;
      if (countTimes(p) > 1) break;
      el = p;
      if (p.getBoundingClientRect().width > 340) break;
    }
    return el;
  }

  /* 解析一行聊天记录 → [{role,kind,text,url,time}] */
  function parseRow(row, buyerName) {
    const full = textOf(row);
    if (!full) return [];
    const tm = full.match(TIME_RE);
    const time = tm ? tm[0] : '';
    const body = tm ? full.replace(TIME_RE, '') : full;
    const lines = body.split(/\n+/).map((s) => s.trim()).filter(Boolean);

    /* 第一行是发言者；个别行前面还有「客服」小标 */
    let idx = 0;
    if (lines[0] && /^(客服|官方|店小二|商家)$/.test(lines[0]) && lines.length > 1) idx = 1;
    const speaker = lines[idx] || '';
    let content = lines.slice(idx + 1).join('\n').trim();

    let role = 'agent';
    if (/系统消息|系统提示|系统通知/.test(speaker) || /系统消息/.test(lines.slice(0, 2).join(' '))) role = 'system';
    else if (buyerName && speaker.indexOf(buyerName) !== -1) role = 'customer';

    /* 图片：过滤掉头像（宽高很小） */
    const imgs = [];
    try {
      Array.from(row.querySelectorAll('img')).forEach((img) => {
        const r = img.getBoundingClientRect();
        const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
        if (src && /^https?:\/\//.test(src) && r.width > 50 && r.height > 40) imgs.push(src);
      });
    } catch (e) { /* 忽略 */ }

    const out = [];
    /* 文本 / 商品链接 */
    if (content) {
      const lm = content.match(/https?:\/\/[^\s"'）)]+/);
      if (lm) {
        out.push({ role, kind: 'link', text: lm[0], url: lm[0], time });
      } else {
        out.push({ role, kind: 'text', text: content.slice(0, 2000), time });
      }
    }
    /* 图片（商品图/买家拍照） */
    imgs.slice(0, 6).forEach((src) => out.push({ role, kind: 'image', text: '[图片]', url: src, time }));
    return out;
  }

  /* 左侧「消费者账号」列表项 */
  function findBuyerItems() {
    const out = [];
    const seen = new Set();
    let els = [];
    try { els = Array.from(document.querySelectorAll('div,li,tr,span,a')); } catch (e) { return out; }
    for (const el of els) {
      const t = textOf(el);
      if (!t || t.length > 26) continue;
      /* 脱敏账号：远*** / 花*** / a***b */
      if (!/^[^\s*]{1,14}\*{2,}[^\s*]{0,8}$/.test(t)) continue;
      if (seen.has(t)) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || r.width > 320) continue;
      seen.add(t);
      out.push({ el, name: t });
    }
    return out;
  }

  /* 读当前右侧面板的整段对话 */
  function readThread(buyerName) {
    const msgs = [];
    const nodes = timeNodes();
    for (const tn of nodes) {
      const row = rowOf(tn);
      parseRow(row, buyerName).forEach((m) => msgs.push(m));
    }
    /* 页面上有可能是倒序，按时间升序排一下（无时间的排前面） */
    msgs.sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
    return msgs;
  }

  /* ---------------- 实时对话面板：直接读「当前打开的这段对话」 ----------------
   * 不依赖平台固定的类名（各家后台改版频繁），只用三件事：
   *   ① 找到聊天输入框 → 从它往上找到可滚动的消息区；
   *   ② 每条消息用「气泡相对面板中线的左右位置」判断是谁说的（左=客户，右=我方）；
   *   ③ 居中的短文本（如「以上是历史消息」）当系统提示。
   * 这样只要客户在这个窗口里说话，几秒内就能把整段对话同步到工作台。
   */
    /* 时间分隔条：支持「10-25 20:18」「2026-10-25 20:18」「昨天 20:18」
   * 以及「星期天 / 昨天 / 今天 / 10月25日」这类纯日期标签 */
  const TIME_BAR = /^(?:(?:20\d{2})[-/年])?\d{1,2}[-/月]\d{1,2}日?\s*\d{1,2}:\d{2}(?::\d{2})?$|^(?:今天|昨天|前天)(?:\s*\d{1,2}:\d{2})?$|^星期[一二三四五六日天]$|^周[一二三四五六日天]$|^\d{1,2}月\d{1,2}日$|^\d{1,2}:\d{2}(?::\d{2})?$/;

  function isScrollable(el) {
    try {
      const st = getComputedStyle(el);
      if (!/(auto|scroll|overlay)/.test(st.overflowY)) return false;
      return el.clientHeight > 120 && el.clientWidth > 150;
    } catch (e) { return false; }
  }

  function textLeaves(root, limit) {
    const out = [];
    if (!root) return out;
    let w;
    try { w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT); } catch (e) { return out; }
    let el;
    while ((el = w.nextNode())) {
      if (el.children.length) continue;
      const t = (el.textContent || '').trim();
      if (!t) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      out.push({ el, text: t });
      if (out.length >= (limit || 800)) break;
    }
    return out;
  }

  function inputBox() {
    let eds = [];
    try { eds = Array.from(document.querySelectorAll('textarea, [contenteditable="true"]')); } catch (e) { return null; }
    let best = null;
    let bestA = 0;
    for (const el of eds) {
      const r = el.getBoundingClientRect();
      if (r.width < 80 || r.height < 16) continue;
      if (r.top < 0 || r.left < 0 || r.top > innerHeight) continue;
      const a = r.width * r.height;
      if (a > bestA) { bestA = a; best = el; }
    }
    return best;
  }

  /* 在候选容器里找「文字最多」的可滚动区 */
  function bestScroller(root) {
    let cand = null;
    let bestN = 0;
    let list = [];
    try { list = Array.from(root.querySelectorAll('div,ul,section,main')); } catch (e) { return null; }
    for (const el of list) {
      if (!isScrollable(el)) continue;
      const n = textLeaves(el, 300).length;
      if (n > bestN) { bestN = n; cand = el; }
    }
    return cand && bestN >= 2 ? cand : null;
  }

  /* 找「聊天消息区」。
   * 关键点：不能只认「可滚动」——对话很短时消息区根本没有滚动条，
   * 那样就会误判成左侧会话列表。所以改成：
   *   以输入框为锚点，取「位于输入框上方、文字最多、面积最小」的那一块。
   * 这样左右两栏（会话列表 / 订单栏）都会自然被排除。 */
  function findChatPanel() {
    const inp = inputBox();
    if (inp) {
      const ir = inp.getBoundingClientRect();
      let best = null;
      let bestScore = -1e9;
      let list = [];
      try { list = Array.from(document.querySelectorAll('div,ul,section,main')); } catch (e) { list = []; }
      for (const el of list) {
        if (el === document.body || el.contains(inp)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 160 || r.height < 110) continue;
        if (r.bottom > ir.top + 6) continue;      /* 必须在输入框上方 */
        if (r.top < 0 || r.left < 0) continue;
        /* 必须和输入框在同一列：这样左侧会话列表、右侧订单栏都会被排除掉
         * （拼多多后台的输入框在最底部，若不加这条会把整个左栏都算进消息区） */
        if (r.left < ir.left - 80 || r.right > ir.right + 80) continue;
        const leaves = textLeaves(el, 120).length;
        if (leaves < 2) continue;
        const scrollable = isScrollable(el) ? 1 : 0;
        /* 文字越多越像消息区；可滚动加分；面积越大越可能是外层容器，扣分 */
        const score = leaves * 10 + scrollable * 25 - (r.width * r.height) / 800000;
        if (score > bestScore) { bestScore = score; best = el; }
      }
      if (best) return best;
    }
    /* 退一步：从输入框向上找可滚动、文字最多的容器 */
    let node = inp;
    for (let i = 0; i < 7 && node && node !== document.body; i++) {
      const c = bestScroller(node);
      if (c) return c;
      node = node.parentElement;
    }
    /* 最后兜底：全页可滚动元素里文字最多、且靠页面中间的那个 */
    let cand = null;
    let best = -1e9;
    let all = [];
    try { all = Array.from(document.querySelectorAll('div,ul,section')); } catch (e) { return null; }
    for (const el of all) {
      if (!isScrollable(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 260 || r.height < 200) continue;
      const n = textLeaves(el, 300).length;
      const cen = r.left + r.width / 2;
      const score = n * 10 - Math.abs(cen - innerWidth / 2) / 6;
      if (score > best) { best = score; cand = el; }
    }
    return cand;
  }

  /* 从文字叶子往上，找出这一条消息的「气泡」范围 */
  function bubbleOf(leafEl, panel, pr) {
    let el = leafEl;
    for (let i = 0; i < 8; i++) {
      const p = el.parentElement;
      if (!p || p === panel || p === document.body) break;
      const pw = p.getBoundingClientRect().width;
      if (pw > pr.width * 0.92) break;
      el = p;
    }
    return el;
  }

  /* 从气泡往上找到它所在的「一整行」（宽度接近聊天区宽度） */
  function rowOfBubble(bubble, panel, pr) {
    let el = bubble;
    for (let i = 0; i < 6; i++) {
      const p = el.parentElement;
      if (!p || p === panel || p === document.body) break;
      el = p;
      if (el.getBoundingClientRect().width >= pr.width * 0.9) break;
    }
    return el;
  }

  /* 判断一条消息是谁说的：先看头像在左还是在右（最可靠，和人眼看的一致），
   * 没有头像时再看气泡左右留白；两边都差不多、且是短文本 → 系统提示。 */
  function classifyRow(row, bubble, pr, text) {
    let av = null;
    try {
      const kids = Array.from(row.querySelectorAll('*'));
      for (const k of kids) {
        const r = k.getBoundingClientRect();
        if (r.width >= 18 && r.width <= 58 && r.height >= 18 && r.height <= 58) {
          if (Math.abs(r.width - r.height) <= 14) { av = r; break; }
        }
      }
    } catch (e) { /* 忽略 */ }
    if (av) {
      const ac = av.left + av.width / 2;
      const pc = pr.left + pr.width / 2;
      if (ac < pc - 8) return 'customer';
      if (ac > pc + 8) return 'agent';
    }
    const br = bubble.getBoundingClientRect();
    const lg = br.left - pr.left;
    const rg = pr.right - br.right;
    if (lg + 8 < rg) return 'customer';
    if (rg + 8 < lg) return 'agent';
    return text.length <= 40 ? 'system' : 'customer';
  }

  /* 聊天区里不属于对话内容的杂项：已读回执、发送状态、手机端标记、输入中提示等 */
  const NOISE_TEXT = /^(已读|未读|送达|已送达|发送中|发送失败|重新发送|撤回|对方正在输入[.…]*|查看更多|展开|收起|加载中.*|正在加载[.…]*|没有更多了|暂无更多|下拉加载更多|上拉加载更多|载入中.*)$/;
  const NOISE_LINE = /^(来自手机端|来自电脑端|邀请关注|亲，在吗[？?]?$)/;

  /* 头像上是昵称首字（如「游」「我」），不能当成消息内容。
   * 判定：这个文字所在的某个近方形小格子（18~60px）——头像的典型尺寸。 */
  function inAvatar(el, panel) {
    let n = el;
    for (let i = 0; i < 4 && n && n !== panel && n !== document.body; i++) {
      const r = n.getBoundingClientRect();
      const w = r.width;
      const h = r.height;
      if (w >= 18 && w <= 60 && h >= 18 && h <= 60 && Math.abs(w - h) <= 12) return true;
      n = n.parentElement;
    }
    return false;
  }

  function readLiveThread() {
    const panel = findChatPanel();
    if (!panel) return { ok: false, error: '没找到聊天消息区，请打开某个客户的聊天窗口', msgs: [], name: '' };
    const pr = panel.getBoundingClientRect();
    if (pr.width < 200 || pr.height < 120) return { ok: false, error: '聊天区太小，无法读取', msgs: [], name: '' };
    const leaves = textLeaves(panel, 700);
    const rows = [];
    /* 时间分隔条先单独收集，最后按「位置在消息上方」分配，
     * 避免图片这类后处理的元素被套上错误的时间。 */
    const bars = [];
    for (const lf of leaves) {
      const t = lf.text.replace(/\s+/g, ' ').trim();
      if (t.length <= 24 && TIME_BAR.test(t)) {
        bars.push({ top: lf.el.getBoundingClientRect().top, text: t });
        continue;
      }
      if (!t || NOISE_TEXT.test(t)) continue;
      if (t.length <= 20 && NOISE_LINE.test(t)) continue;
      if (inAvatar(lf.el, panel)) continue;
      const bubble = bubbleOf(lf.el, panel, pr);
      const br = bubble.getBoundingClientRect();
      if (br.height < 8 || br.width < 8) continue;
      const row = rowOfBubble(bubble, panel, pr);
      rows.push({ top: br.top, bot: br.bottom, role: classifyRow(row, bubble, pr, t), kind: 'text', text: t, url: '', time: '', _n: rows.length });
    }
    /* 图片：头像以外的大图（商品图 / 买家实拍） */
    try {
      Array.from(panel.querySelectorAll('img')).forEach((img) => {
        const r = img.getBoundingClientRect();
        const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
        if (!src || !/^https?:\/\//.test(src)) return;
        if (r.width < 60 || r.height < 50) return;
        if (inAvatar(img, panel)) return;
        const row = rowOfBubble(img, panel, pr);
        rows.push({ top: r.top, bot: r.bottom, role: classifyRow(row, img, pr, 'x'), kind: 'image', text: '[图片]', url: src, time: '', _n: rows.length });
      });
    } catch (e) { /* 忽略 */ }

    rows.sort((a, b) => (a.top - b.top) || (a._n - b._n));
    bars.sort((a, b) => a.top - b.top);
    /* 位置在消息上方的最近一个时间条 → 这条消息的时间 */
    let bi = 0;
    let cur = '';
    for (const r of rows) {
      while (bi < bars.length && bars[bi].top <= r.top + 4) { cur = bars[bi].text; bi++; }
      r.time = cur;
    }

    /* 合并：同一个气泡被拆成多个文字叶子时拼回一句；
     * 同一角色、上下紧挨（间距 < 12px）的两段文字算同一个气泡。 */
    const merged = [];
    for (const r of rows) {
      const last = merged[merged.length - 1];
      const adjacent = last && last.kind === 'text' && r.kind === 'text' &&
        last.role === r.role && (r.top - last.bot) < 4;
      if (adjacent) {
        if (last.text.indexOf(r.text) === -1) last.text = (last.text + ' ' + r.text).trim();
        last.bot = Math.max(last.bot, r.bot);
        continue;
      }
      merged.push({ top: r.top, bot: r.bot, role: r.role, kind: r.kind, text: r.text, url: r.url || '', time: r.time || '' });
    }
    const msgs = merged.map((m) => ({ role: m.role, kind: m.kind, text: m.text, url: m.url, time: m.time }));
    return { ok: true, msgs, count: msgs.length, panel: { w: Math.round(pr.width), h: Math.round(pr.height) } };
  }

  /* 当前正在聊的客户名：优先取左侧列表里「选中态」的那一项 */
  let lastActiveName = '';
  function activeBuyerName() {
    let found = '';
    try {
      const els = Array.from(document.querySelectorAll('[class*="active"],[class*="selected"],[class*="current"],[class*="checked"]'));
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.height < 18 || r.height > 140) continue;
        if (r.width < 40 || r.width > 400) continue;
        if (r.left > innerWidth * 0.55) continue; /* 只看左边那一栏 */
        const t = textOf(el);
        if (!t) continue;
        const first = t.split(/\n+/)[0].trim();
        if (!first || first.length > 20) continue;
        if (/^\d+$/.test(first)) continue;
        if (/[:：]/.test(first)) continue;
        if (isUiLabel(first) || SYSTEM_ACCOUNTS.test(first) || NAME_JUNK.test(first)) continue;
        found = first;
        break;
      }
    } catch (e) { /* 忽略 */ }
    /* 列表没有「选中态」时，退一步读聊天区正上方那一行的标题（就是当前客户名） */
    if (!found) {
      try {
        const panel = findChatPanel();
        if (panel) {
          const pr = panel.getBoundingClientRect();
          let best = '';
          let bestD = 1e9;
          const cands = Array.from(document.querySelectorAll('span,div,a,b,strong,em'));
          for (const el of cands) {
            const r = el.getBoundingClientRect();
            if (r.width < 20 || r.width > 260) continue;
            if (r.bottom > pr.top + 2 || r.bottom < pr.top - 80) continue;
            if (r.left < pr.left - 12 || r.right > pr.right + 12) continue;
            const t = textOf(el);
            if (!t || t.length > 20 || t.indexOf('\n') !== -1) continue;
            if (/^\d+$/.test(t) || /[:：]/.test(t)) continue;
            if (isUiLabel(t) || SYSTEM_ACCOUNTS.test(t) || NAME_JUNK.test(t)) continue;
            if (/(拼多多|淘宝|天猫|京东|抖音|快手|客服|工作台|转接|接待|订单|商品)/.test(t)) continue;
            const d = Math.abs(pr.top - r.bottom);
            if (d < bestD) { bestD = d; best = t; }
          }
          if (best) found = best;
        }
      } catch (e) { /* 忽略 */ }
    }
    if (found) { lastActiveName = found; return found; }
    return lastActiveName;
  }

  const liveSeen = new Map();
  async function captureLive() {
    const c = await cfg();
    if (!c || !c.enabled || !c.hookUrl) return { ok: false, error: '未开启监听或没填 Webhook' };
    const r = readLiveThread();
    if (!r.ok) return r;
    const name = activeBuyerName();
    /* 名字必须是「像客户名」的：页面上的横幅/提示语不能被当成客户名，
     * 否则会凭空多出一个「争议澄清义务」这类假会话。 */
    if (!name || NAME_JUNK.test(name)) {
      return { ok: false, error: '没能识别出当前客户名（会话列表可能没有选中态）', count: r.count, msgs: r.msgs };
    }
    let msgs = r.msgs.filter((m) => !(m.role === 'system' && m.text === name));
    if (!msgs.length) return { ok: false, error: '聊天区没读到消息', name, count: 0 };
    if (msgs.length > 200) msgs = msgs.slice(-200);
    const sig = msgs.length + '|' + msgs[msgs.length - 1].role + '|' + msgs[msgs.length - 1].text;
    if (liveSeen.get(name) === sig) return { ok: true, name, count: msgs.length, messages: 0, unchanged: true };
    liveSeen.set(name, sig);
    const host = location.host;
    const ad = adapterFor(host);
    const resp = await sendAsync({
      __xm: true, type: 'thread',
      payload: {
        buyer: name,
        channel: 'web_' + ((ad && ad.name) || host),
        visitor: 'web_' + simpleHash(host + name),
        messages: msgs,
      },
    });
    return { ok: !!(resp && resp.ok), name, count: msgs.length, resp: resp || null };
  }

  let harvesting = false;
  let lastHarvestAt = 0;
  const threadSeen = new Map();
  async function harvestHistory(auto) {
    if (harvesting) return { ok: false, error: '正在采集中，请稍候' };
    if (!isHistoryPage()) return { ok: false, error: '当前页不是「聊天记录查询」页，请先打开并查询出结果' };
    const c = await cfg();
    if (!c || !c.hookUrl) return { ok: false, error: '请先在上方填写并保存 Webhook 地址' };
    harvesting = true;
    const stat = { buyers: 0, messages: 0, skipped: 0, failed: 0, at: Date.now(), auto: !!auto, detail: [] };
    try {
      const items = findBuyerItems();
      if (!items.length) return { ok: false, error: '没找到买家账号列表，请先点「查询」出结果再采集' };
      const host = location.host;
      for (const it of items.slice(0, 60)) {
        if (!alive) break;
        try {
          it.el.click();
          await sleep(700);
          let msgs = readThread(it.name);
          /* 面板可能还没刷出来，重试两次 */
          for (let k = 0; k < 2 && !msgs.length; k++) { await sleep(700); msgs = readThread(it.name); }
          /* 面板还停在上一个买家（一个客户消息都没解析到）→ 再等一次，仍不对就跳过，避免张冠李戴 */
          if (msgs.length && !msgs.some((m) => m.role === 'customer')) {
            await sleep(800);
            msgs = readThread(it.name);
          }
          if (!msgs.length) { stat.failed++; continue; }
          if (!msgs.some((m) => m.role === 'customer')) {
            stat.failed++;
            stat.detail.push({ buyer: it.name, error: '右侧聊天记录未切换，已跳过' });
            continue;
          }
          const sig = it.name + '|' + msgs.length + '|' + (msgs[msgs.length - 1].time || '');
          if (threadSeen.get(it.name) === sig) { stat.skipped++; continue; }
          threadSeen.set(it.name, sig);
          const resp = await sendAsync({
            __xm: true, type: 'thread',
            payload: {
              buyer: it.name,
              channel: 'web_' + ((adapterFor(host) && adapterFor(host).name) || host),
              visitor: 'web_' + simpleHash(host + it.name),
              messages: msgs,
            },
          });
          if (resp && resp.ok) {
            stat.buyers++;
            stat.messages += msgs.length;
            stat.detail.push({ buyer: it.name, n: msgs.length, inserted: resp.inserted });
          } else {
            stat.failed++;
            stat.detail.push({ buyer: it.name, n: msgs.length, error: (resp && resp.error) || '推送失败' });
          }
        } catch (e) {
          stat.failed++;
        }
        await sleep(250);
      }
      return { ok: true, ...stat };
    } finally {
      harvesting = false;
      lastHarvestAt = Date.now();
      safeSend({ __xm: true, type: 'harvestStatus', status: stat });
    }
  }

  function sendAsync(msg) {
    return new Promise((resolve) => safeSend(msg, resolve));
  }

  /* ---------------- 回复回写平台 ----------------
   * 工作台产生的回复（AI/工作流/人工）进入服务端队列，
   * 这里轮询取回后：找到对应买家会话 → 点开 → 填入输入框 → 点发送，
   * 买家在拼多多/千牛等平台侧即可看到回复。
   */
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  /* 在会话列表里按昵称找到会话项并点开 */
  /* 从文字节点往上找一个「像一行会话」的可点区域 */
  function clickableAncestor(el) {
    let n = el;
    for (let i = 0; i < 6 && n && n !== document.body; i++) {
      const r = n.getBoundingClientRect();
      if (r.height >= 30 && r.height <= 150 && r.width >= 120) return n;
      n = n.parentElement;
    }
    return el;
  }

  function openConversationByName(name, sel) {
    const ad = adapterFor(location.host);
    const itemSel = (sel && sel.item) || (ad && ad.item) || 'li, [class*="item"]';
    let items = [];
    try { items = Array.from(document.querySelectorAll(itemSel)); } catch (e) { items = []; }
    const target = items.find((el) => visible(el) && (el.innerText || '').indexOf(name) !== -1);
    if (target) { target.click(); return true; }

    /* 兜底：平台类名混淆（如拼多多的 _3B2xY）时选择器对不上，
     * 改用几何位置找——左栏里「第一行文字就是客户名」的最小元素，点它。 */
    let cands = [];
    try { cands = Array.from(document.querySelectorAll('div,li,dd,dt,a,section')); } catch (e) { return false; }
    const lim = innerWidth * 0.55;
    let best = null;
    let bestA = Infinity;
    for (const el of cands) {
      const r = el.getBoundingClientRect();
      if (r.width < 80 || r.height < 22 || r.height > 160) continue;
      if (r.left + r.width / 2 > lim) continue;          /* 只看左边那一栏 */
      if (r.top < 0 || r.bottom > innerHeight + 4) continue;
      const t = (el.innerText || '').trim();
      if (!t || t.length > 80) continue;
      const first = t.split(/\n+/)[0].trim();
      if (first !== name && first.indexOf(name) !== 0) continue;
      const a = r.width * r.height;
      if (a < bestA) { bestA = a; best = el; }
    }
    if (!best) return false;
    clickableAncestor(best).click();
    return true;
  }

  /* 找到聊天输入框（排除列表搜索框：优先可视区右侧/底部的 textarea 或 contenteditable） */
  function findChatInput(sel) {
    const ad = adapterFor(location.host);
    const inputSel = (sel && sel.input) || (ad && ad.input) || 'textarea, [contenteditable="true"]';
    let cands = [];
    try { cands = Array.from(document.querySelectorAll(inputSel)).filter(visible); } catch (e) { return null; }
    if (!cands.length) return null;
    /* 优先选页面偏下、偏右的（聊天输入框一般在右下方），排除左上角搜索框 */
    cands.sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return (rb.top + rb.left) - (ra.top + ra.left);
    });
    return cands[0];
  }

  /* 向输入框填字（兼容 React 受控组件） */
  function fillInput(el, text) {
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value');
      if (setter && setter.set) setter.set.call(el, text); else el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      /* contenteditable：execCommand 能被大多数富文本框架识别 */
      el.textContent = '';
      const ok = document.execCommand && document.execCommand('insertText', false, text);
      if (!ok) {
        el.innerText = text;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      }
    }
  }

  /* 点击发送：优先自定义选择器，其次「发送」文字按钮，最后回车键兜底 */
  function clickSend(inputEl, sel) {
    const ad = adapterFor(location.host);
    const sendSel = (sel && sel.send) || (ad && ad.send) || '';
    if (sendSel) {
      const btn = document.querySelector(sendSel);
      if (visible(btn)) { btn.click(); return true; }
    }
    const btns = Array.from(document.querySelectorAll('button, [role="button"], a, div, span'))
      .filter((el) => visible(el) && (el.innerText || '').trim() === '发送');
    if (btns.length) {
      /* 选离输入框最近的那个「发送」 */
      const ri = inputEl.getBoundingClientRect();
      btns.sort((a, b) => {
        const da = Math.abs(a.getBoundingClientRect().top - ri.top) + Math.abs(a.getBoundingClientRect().left - ri.left);
        const db = Math.abs(b.getBoundingClientRect().top - ri.top) + Math.abs(b.getBoundingClientRect().left - ri.left);
        return da - db;
      });
      btns[0].click();
      return true;
    }
    /* 回车兜底 */
    ['keydown', 'keypress', 'keyup'].forEach((type) => {
      inputEl.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    });
    return true;
  }

  function inputValue(el) {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return String(el.value || '');
    return String(el.innerText || el.textContent || '');
  }

  function pressEnter(el) {
    ['keydown', 'keypress', 'keyup'].forEach((type) => {
      el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    });
  }

  /* 买家昵称比对：平台会把名字打码成「福***哥」，两边都按「首字+末字」宽松比 */
  function nameLike(a, b) {
    const norm = (s) => String(s || '').replace(/[\s*＊·.。]/g, '');
    const x = norm(a); const y = norm(b);
    if (!x || !y) return false;
    if (x === y) return true;
    if (x.length >= 2 && y.indexOf(x) !== -1) return true;
    if (y.length >= 2 && x.indexOf(y) !== -1) return true;
    return x.charAt(0) === y.charAt(0) && x.charAt(x.length - 1) === y.charAt(y.length - 1) && x.length >= 2 && y.length >= 2;
  }

  /* 当前聊天窗口顶部那个买家名（标题栏在消息区正上方、与消息区同列） */
  function currentChatName() {
    const panel = findChatPanel();
    if (!panel) return '';
    const pr = panel.getBoundingClientRect();
    let best = ''; let bestTop = -1;
    let cands = [];
    try { cands = Array.from(document.querySelectorAll('div,span,a,h1,h2,h3,h4,strong,b,p')); } catch (e) { return ''; }
    for (const el of cands) {
      const r = el.getBoundingClientRect();
      if (r.width < 36 || r.height < 12 || r.height > 44) continue;
      if (r.bottom > pr.top + 6) continue;              /* 必须在消息区上方 */
      if (r.top < 0) continue;
      if (r.left + 20 < pr.left || r.right - 20 > pr.right) continue;
      const t = (el.innerText || '').trim();
      if (!t || t.length > 30 || /\n/.test(t)) continue;
      if (NOISE_TEXT.test(t) || NOISE_LINE.test(t)) continue;
      if (r.top > bestTop) { bestTop = r.top; best = t; }  /* 越靠近消息区越可能是标题 */
    }
    return best;
  }

  /* 当前打开的聊天窗是否就是这位买家：先比标题名，再比「最后一句客户原话」 */
  function chatIsCustomer(r) {
    const nm = currentChatName();
    if (nm && r.name && nameLike(nm, r.name)) return true;
    let thread; try { thread = readLiveThread(); } catch (e) { return false; }
    if (!thread || !thread.ok) return false;
    const want = String(r.lastCustomer || '').trim();
    if (!want) return false;
    const tail = (thread.msgs || []).filter((m) => m.role === 'customer').slice(-6);
    return tail.some((m) => {
      const t = String(m.text || '').trim();
      if (!t) return false;
      return t === want || t.indexOf(want) !== -1 || want.indexOf(t) !== -1;
    });
  }

  /* 投递一条回复到平台聊天窗口 */
  async function deliverReply(r, sel) {
    /* 平台会话列表常常是空的 / 懒加载（老会话不在「今日接待」里），
     * 这时按名字切不过去，但只要当前打开的正是这位买家，就直接发。 */
    let onTarget = false;
    try { onTarget = chatIsCustomer(r); } catch (e) { onTarget = false; }
    if (!onTarget) {
      if (!openConversationByName(r.name, sel)) {
        return { ok: false, error: '会话列表里找不到买家「' + r.name + '」，请在平台左侧点开 TA 的会话（或保持该会话打开）后重试' };
      }
      await sleep(900); /* 等聊天窗切换 */
    }
    const input = findChatInput(sel);
    if (!input) return { ok: false, error: '找不到聊天输入框' };
    fillInput(input, r.text);
    await sleep(250);
    /* 填完必须确认真的进了输入框，否则平台侧发出去的是空消息 */
    if (!inputValue(input).trim()) return { ok: false, error: '文字没填进输入框（编辑器不接受赋值）' };
    clickSend(input, sel);
    await sleep(450);
    /* 输入框还留着原文时，先看聊天区里是不是已经出现这句话；
     * 没出现才补一次回车（避免重复发两条） */
    let still = inputValue(input).trim();
    if (still) {
      let shownAlready = false;
      try {
        const now = readLiveThread();
        shownAlready = (now.msgs || []).slice(-3)
          .some((m) => m.role !== 'customer' && m.text.indexOf(String(r.text).slice(0, 12)) !== -1);
      } catch (e) { /* 忽略 */ }
      if (!shownAlready) {
        pressEnter(input);
        await sleep(450);
        still = inputValue(input).trim();
      } else {
        still = '';
      }
    }
    if (still) return { ok: false, error: '已填入但发送未生效，请在页面上手动点一次发送' };
    /* 记下我们发出去的话，扫描时遇到预览回显则跳过，防止自抓循环 */
    rememberSelf(r.text);
    return { ok: true };
  }

  /* 轮询并投递，带防重入 */
  let delivering = false;
  function pollAndDeliver() {
    if (!alive || delivering) return;
    delivering = true;
    safeSend({ __xm: true, type: 'pollReplies' }, async (resp) => {
      try {
        if (!resp || !resp.ok || !resp.replies || !resp.replies.length) return;
        const c = await cfg();
        const sel = (c && c.selectors) || {};
        const sent = [];
        const failed = [];
        for (const r of resp.replies) {
          try {
            const res = await deliverReply(r, sel);
            if (res.ok) sent.push(r.id); else failed.push({ id: r.id, error: res.error });
          } catch (e) {
            failed.push({ id: r.id, error: String(e.message || e) });
          }
          await sleep(600);
        }
        if (sent.length || failed.length) {
          safeSend({ __xm: true, type: 'ackReplies', sent: sent, failed: failed });
        }
        if (sent.length) console.log(TAG, '已回写', sent.length, '条回复到平台');
      } finally {
        delivering = false;
      }
    });
    /* 防 safeSend 回调丢失导致卡死 */
    setTimeout(() => { delivering = false; }, 30000);
  }

  /* 定时扫描（2.5s）+ DOM 变化时立即补一次 */
  timers.add(setInterval(() => { if (alive) scan(); }, 2500));
  /* 回复回写轮询：每 4s 检查一次工作台的待回写队列 */
  timers.add(setInterval(() => { if (alive) pollAndDeliver(); }, 4000));
  setTimeout(() => { if (alive) pollAndDeliver(); }, 3000);
  const mo = new MutationObserver((muts) => {
    if (!alive) { mo.disconnect(); return; }
    for (const m of muts) {
      if (m.addedNodes && m.addedNodes.length) { scan(); break; }
    }
  });
  observers.add(mo);
  try { mo.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
  setTimeout(() => { if (alive) scan(); }, 2000);

  /* ---------------- 页面结构诊断 ----------------
   * 平台页面改版频繁，猜类名很容易失效。这里把聊天页的「骨架」抽出来上传：
   * 只包含标签名、类名、位置尺寸、文字片段，不含密码/账号信息。
   * 有了它就能按真实 DOM 精确校准抓取规则，而不是靠猜。
   */
  function boxOf(el) {
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left), y: Math.round(r.top),
      w: Math.round(r.width), h: Math.round(r.height),
    };
  }
  function cut(t, n) {
    return String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, n || 40);
  }
  function clsOf(el) {
    const c = el.className;
    if (typeof c === 'string') return cut(c, 80);
    return '';
  }
  function buildSnapshot() {
    const snap = {
      url: location.href,
      title: document.title,
      viewport: { w: innerWidth, h: innerHeight },
      frames: [],
      inputs: [],
      buttons: [],
      scrollers: [],
      texts: [],
      classHits: [],
      bodyText: cut(document.body ? document.body.innerText : '', 500),
      live: null,
      historyPage: false,
    };
    const push = (arr, o, max) => { if (arr.length < (max || 60)) arr.push(o); };

    try {
      snap.historyPage = isHistoryPage();
    } catch (e) { /* 忽略 */ }

    try {
      Array.from(document.querySelectorAll('iframe')).forEach((f) => {
        push(snap.frames, Object.assign({ src: cut(f.getAttribute('src'), 140) }, boxOf(f)), 10);
      });
    } catch (e) { /* 忽略 */ }

    try {
      Array.from(document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"]')).forEach((el) => {
        const b = boxOf(el);
        if (b.w < 60 || b.h < 12) return;
        push(snap.inputs, Object.assign({
          tag: el.tagName.toLowerCase(), cls: clsOf(el),
          ph: cut(el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '', 40),
        }, b), 12);
      });
    } catch (e) { /* 忽略 */ }

    try {
      Array.from(document.querySelectorAll('button, a, div[role="button"], span')).forEach((el) => {
        const t = cut(el.innerText, 12);
        if (!t || t.length > 8) return;
        if (!/发送|回复|确定|提交/.test(t)) return;
        const b = boxOf(el);
        if (b.w < 24 || b.w > 200 || b.h < 14) return;
        push(snap.buttons, Object.assign({ tag: el.tagName.toLowerCase(), cls: clsOf(el), text: t }, b), 12);
      });
    } catch (e) { /* 忽略 */ }

    try {
      Array.from(document.querySelectorAll('div,ul,section,main')).forEach((el) => {
        const needScroll = el.scrollHeight - el.clientHeight;
        const b = boxOf(el);
        if (b.w < 260 || b.h < 150) return;
        if (needScroll < 30) return;
        push(snap.scrollers, Object.assign({
          cls: clsOf(el), leaves: textLeaves(el, 60).length, cut: cut(el.innerText, 50),
        }, b), 20);
      });
    } catch (e) { /* 忽略 */ }

    /* 消息气泡候选：类名里带 msg/bubble/chat/message 的元素 */
    try {
      Array.from(document.querySelectorAll('[class*="msg" i],[class*="bubble" i],[class*="message" i],[class*="chat" i],[class*="item" i]')).forEach((el) => {
        const b = boxOf(el);
        if (b.w < 40 || b.h < 14) return;
        if (b.y < -200 || b.y > innerHeight + 400) return;
        const t = cut(el.innerText, 30);
        if (!t) return;
        push(snap.classHits, Object.assign({
          tag: el.tagName.toLowerCase(), cls: clsOf(el), text: t,
        }, b), 70);
      });
    } catch (e) { /* 忽略 */ }

    /* 所有可见文字叶子（含精确位置），用于判断气泡左右归属 */
    try {
      textLeaves(document.body, 120).forEach((lf) => {
        const t = cut(lf.text, 26);
        if (!t) return;
        push(snap.texts, Object.assign({ text: t, cls: clsOf(lf.el.parentElement || lf.el) }, boxOf(lf.el)), 60);
      });
    } catch (e) { /* 忽略 */ }

    /* 现有解析器跑一遍的结果，便于对比「规则读到了什么」 */
    try {
      const r = readLiveThread();
      snap.live = {
        ok: !!r.ok, count: r.count || 0, error: r.error || '',
        name: (function () { try { return activeBuyerName(); } catch (e) { return ''; } })(),
        chatPage: (function () { try { return looksLikeChatPage(); } catch (e) { return false; } })(),
        sample: (r.msgs || []).slice(-8),
      };
    } catch (e) { snap.live = { ok: false, error: String((e && e.message) || e) }; }
    return snap;
  }

  /* 自动上传一次「页面结构诊断」：平台结构一改版，抓取就容易失准。
   * 每个页面会话自动传一次，工作台侧就能按真实 DOM 精确校准，不用再靠猜。 */
  let snapSent = false;
  setTimeout(() => {
    if (!alive || snapSent) return;
    try {
      if (window.top !== window) return;          /* 只在主框架上报 */
      if (!looksLikeChatPage()) return;
      snapSent = true;
      const data = buildSnapshot();
      safeSend({ __xm: true, type: 'snapshot', payload: { data } });
    } catch (e) { /* 忽略 */ }
  }, 6000);

  /* 弹窗里点「导入本页聊天记录」时，从这里响应 */
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || !msg.__xm) return;
      if (msg.type === 'snapshotReq') {
        (async () => {
          const data = buildSnapshot();
          const resp = await sendAsync({ __xm: true, type: 'snapshot', payload: { data } });
          sendResponse({
            ok: !!(resp && resp.ok), bytes: (resp && resp.bytes) || 0,
            error: (resp && resp.error) || '', live: data.live, url: location.href,
          });
        })().catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
        return true; /* 异步响应 */
      }
      if (msg.type === 'harvest') {
        harvestHistory(false)
          .then((r) => sendResponse(r))
          .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
        return true; /* 异步响应 */
      }
      if (msg.type === 'histCheck') {
        const isH = isHistoryPage();
        sendResponse({ ok: true, isHistory: isH, buyers: isH ? findBuyerItems().length : 0 });
        return false;
      }
      /* 弹窗「抓取当前对话」：只读不点，返回诊断信息，方便确认到底抓到了什么 */
      if (msg.type === 'liveCheck') {
        (async () => {
          const r = readLiveThread();
          const name = activeBuyerName();
          if (msg.push) {
            const p = await captureLive();
            sendResponse({ ok: !!p.ok, pushed: !!p.ok, info: p, read: { ok: r.ok, count: r.count || 0 }, name, url: location.href });
            return;
          }
          sendResponse({
            ok: !!r.ok,
            name,
            count: r.count || 0,
            error: r.error || '',
            sample: (r.msgs || []).slice(-6),
            url: location.href,
            panel: r.panel || null,
          });
        })().catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
        return true;
      }
    });
  } catch (e) { /* 老浏览器忽略 */ }

  /* 自动采集：停在「聊天记录查询」页且查询出结果时，每分钟检查一次，5 分钟内最多采一轮 */
  timers.add(setInterval(() => {
    if (!alive || harvesting) return;
    if (Date.now() - lastHarvestAt < 5 * 60 * 1000) return;
    cfg().then((c) => {
      if (!c || !c.enabled || !c.hookUrl || c.autoHarvest === false) return;
      if (!isHistoryPage()) return;
      harvestHistory(true).catch(() => {});
    }).catch(() => {});
  }, 60000));

  console.log(TAG, '已注入', location.host);

  /* 调试用：把内部解析函数挂到页面上（线上无副作用），
   * 方便用 mock 页面在真实浏览器里验证抓取算法，而不是靠猜 DOM。 */
  try {
    window.__xmBridgeApi = {
      readLiveThread: readLiveThread,
      activeBuyerName: activeBuyerName,
      buildSnapshot: buildSnapshot,
      findChatPanel: findChatPanel,
      openConversationByName: openConversationByName,
      deliverReply: deliverReply,
    };
  } catch (e) { /* 忽略 */ }
})();
