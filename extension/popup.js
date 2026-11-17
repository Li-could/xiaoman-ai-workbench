'use strict';
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var st = document.getElementById('status');

  function show(kind, text) {
    st.className = 'status ' + kind;
    st.textContent = text;
  }

  function load() {
    chrome.storage.sync.get({ hookUrl: '', enabled: true, selectors: null, onlyUnread: true, autoHarvest: true }, function (v) {
      document.getElementById('hookUrl').value = v.hookUrl || '';
      document.getElementById('enabled').checked = v.enabled !== false;
      document.getElementById('onlyUnread').checked = v.onlyUnread !== false;
      document.getElementById('autoHarvest').checked = v.autoHarvest !== false;
      var sel = v.selectors || {};
      document.getElementById('selList').value = sel.list || '';
      document.getElementById('selItem').value = sel.item || '';
      document.getElementById('selName').value = sel.name || '';
      document.getElementById('selText').value = sel.text || '';
      document.getElementById('selInput').value = sel.input || '';
      document.getElementById('selSend').value = sel.send || '';
      if (v.hookUrl) show('ok', '已配置，保存后即可监听');
    });
  }

  function save(cb) {
    var sel = {
      list: document.getElementById('selList').value.trim(),
      item: document.getElementById('selItem').value.trim(),
      name: document.getElementById('selName').value.trim(),
      text: document.getElementById('selText').value.trim(),
      input: document.getElementById('selInput').value.trim(),
      send: document.getElementById('selSend').value.trim(),
    };
    if (!sel.list && !sel.item && !sel.name && !sel.text && !sel.input && !sel.send) sel = null;
    chrome.storage.sync.set({
      hookUrl: document.getElementById('hookUrl').value.trim(),
      enabled: document.getElementById('enabled').checked,
      onlyUnread: document.getElementById('onlyUnread').checked,
      autoHarvest: document.getElementById('autoHarvest').checked,
      selectors: sel,
    }, function () {
      if (cb) cb();
    });
  }

  document.getElementById('save').addEventListener('click', function () {
    var url = document.getElementById('hookUrl').value.trim();
    if (!/^http:\/\/127\.0\.0\.1:\d+\/api\/hooks\/inbox\//.test(url) && !/^https?:\/\//.test(url)) {
      show('err', 'Webhook 地址格式不对，请从工作台复制完整地址');
      return;
    }
    save(function () { show('ok', '已保存，请到店铺后台页面查看监听状态'); });
  });

  document.getElementById('test').addEventListener('click', function () {
    var url = document.getElementById('hookUrl').value.trim();
    if (!url) { show('err', '请先填 Webhook 地址'); return; }
    var beat = url.replace(/\/api\/hooks\/inbox\/[^/?]+/, '') + '/api/bridge/beat';
    var token = (url.match(/\/api\/hooks\/inbox\/([^/?]+)/) || [])[1] || '';
    show('warn', '正在连接工作台…');
    fetch(beat, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, platform: 'test' }),
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.ok) show('ok', '连接成功：' + (j.store ? j.store.name : '工作台') + '，可以开始监听');
        else show('err', '连接失败：' + ((j && j.error) || '未知错误'));
      })
      .catch(function () { show('err', '连不上工作台，请确认 server.js 已启动（127.0.0.1:8787）'); });
  });

  /* 提示当前标签页是否停在「聊天页」——只有聊天页才会抓消息 */
  function checkPage() {
    var hint = document.getElementById('pageHint');
    if (!hint) return;
    function put(cls, text) { hint.className = 'status ' + cls; hint.textContent = text; }
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        var t = tabs && tabs[0];
        if (!t || !t.url) { put('warn', '读不到当前页面，请打开拼多多商家后台聊天页'); return; }
        var url = t.url, host = '';
        try { host = new URL(url).host; } catch (e) { host = ''; }
        var marketplace = /pinduoduo|taobao|tmall|jd\.com|jinritemai|douyin|kuaishou|weixin/.test(host);
        var chatPage = /chat|message|session|conversation|kefu|im\//i.test(url);
        if (!marketplace) { put('warn', '当前页不是店铺后台（' + (host || '本地页') + '）'); return; }
        if (!chatPage) {
          put('err', '当前停在「' + host + '」的非聊天页，不会抓消息 —— 请打开客服聊天页');
          return;
        }
        put('ok', '已在聊天页实时监听：' + host);
      });
    } catch (e) {
      put('warn', '无法检查当前页面');
    }
  }

  load();
  checkPage();

  /* ---------- 导入「聊天记录查询」页的整段对话 ---------- */
  function showHarvest(kind, text) {
    var el = document.getElementById('harvestStatus');
    if (!el) return;
    el.style.display = 'block';
    el.className = 'status ' + kind;
    el.textContent = text;
  }

  var hv = document.getElementById('harvest');
  if (hv) {
    hv.addEventListener('click', function () {
      hv.disabled = true;
      hv.textContent = '采集中…请勿切换页面';
      showHarvest('warn', '正在逐个买家读取聊天记录，请不要关闭或切换这个标签页…');
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        var t = tabs && tabs[0];
        if (!t || !t.id) { hv.disabled = false; hv.textContent = '导入本页聊天记录（含图片/链接）'; showHarvest('err', '读不到当前标签页'); return; }
        chrome.tabs.sendMessage(t.id, { __xm: true, type: 'harvest' }, function (r) {
          hv.disabled = false;
          hv.textContent = '导入本页聊天记录（含图片/链接）';
          if (chrome.runtime.lastError) {
            showHarvest('err', '页面没响应，请刷新该页面后重试（扩展更新后必须刷新）');
            return;
          }
          if (!r) { showHarvest('err', '采集失败：没有返回结果'); return; }
          if (!r.ok) { showHarvest('err', r.error || '采集失败'); return; }
          var msg = '已导入 ' + r.buyers + ' 个买家 / ' + r.messages + ' 条消息（新增 ' + (r.inserted || 0) + ' 条，跳过重复 ' + (r.skipped || 0) + ' 条）';
          showHarvest('ok', msg);
        });
      });
    });
  }

  /* 展示上一轮采集结果 */
  try {
    chrome.storage.local.get({ harvestStatus: null }, function (v) {
      var s = v && v.harvestStatus;
      if (!s) return;
      var when = new Date(s.at || Date.now());
      var hh = ('0' + when.getHours()).slice(-2) + ':' + ('0' + when.getMinutes()).slice(-2);
      if (!s.buyers) return;
      showHarvest('ok', hh + ' 已导入 ' + s.buyers + ' 个买家 / ' + s.messages + ' 条消息');
    });
  } catch (e) { /* 忽略 */ }

  /* 探测当前页能不能采集：识别到几个买家账号 */
  try {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var t = tabs && tabs[0];
      if (!t || !t.id) return;
      chrome.tabs.sendMessage(t.id, { __xm: true, type: 'histCheck' }, function (r) {
        if (chrome.runtime.lastError || !r || !r.ok) return;
        if (!r.isHistory) return;
        if (r.buyers > 0) showHarvest('ok', '当前页可采集：识别到 ' + r.buyers + ' 个买家账号');
        else showHarvest('warn', '这是聊天记录查询页，但还没查出结果 —— 先选时间范围点「查询」');
      });
    });
  } catch (e) { /* 忽略 */ }
  /* ---------- 抓取「当前正在聊的这个客户」的整段对话 ---------- */
  var lv = document.getElementById('liveOne');
  var lh = document.getElementById('liveHint');
  function showLive(kind, text) {
    if (!lh) return;
    lh.style.display = 'block';
    lh.className = 'status ' + kind;
    lh.textContent = text;
  }
  function activeTab(cb) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) { cb(tabs && tabs[0]); });
  }
  if (lv) {
    lv.addEventListener('click', function () {
      var old = lv.textContent;
      lv.disabled = true;
      lv.textContent = '读取中…';
      showLive('warn', '正在读取右侧聊天窗口…');
      activeTab(function (t) {
        if (!t || !t.id) { lv.disabled = false; lv.textContent = old; showLive('err', '读不到当前标签页'); return; }
        chrome.tabs.sendMessage(t.id, { __xm: true, type: 'liveCheck', push: true }, function (r) {
          lv.disabled = false;
          lv.textContent = old;
          if (chrome.runtime.lastError) {
            showLive('err', '这个页面还没被扩展接管：请按 F5 刷新页面后重试（扩展更新后必须刷新）');
            return;
          }
          if (!r) { showLive('err', '没有返回结果'); return; }
          if (!r.ok) { showLive('err', (r.info && r.info.error) || r.error || '读取失败：请先打开某个客户的聊天窗口'); return; }
          var n = (r.info && r.info.count) || (r.read && r.read.count) || 0;
          showLive('ok', '已同步「' + (r.name || '当前客户') + '」的 ' + n + ' 条消息到工作台');
        });
      });
    });
  }

  /* 页面诊断：把当前聊天页骨架传给工作台，便于校准抓取规则 */
  var dg = document.getElementById('diag');
  if (dg) {
    dg.addEventListener('click', function () {
      var old = dg.textContent;
      dg.disabled = true;
      dg.textContent = '上传中…';
      activeTab(function (t) {
        if (!t || !t.id) { dg.disabled = false; dg.textContent = old; showLive('err', '读不到当前标签页'); return; }
        chrome.tabs.sendMessage(t.id, { __xm: true, type: 'snapshotReq' }, function (r) {
          dg.disabled = false;
          dg.textContent = old;
          if (chrome.runtime.lastError) { showLive('err', '这个页面还没被扩展接管：请按 F5 刷新后重试'); return; }
          if (!r || !r.ok) { showLive('err', '上传失败：' + ((r && (r.error || '')) || '请确认已登录工作台账号')); return; }
          var lv2 = r.live || {};
          showLive('ok', '诊断已上传（' + Math.round((r.bytes || 0) / 1024) + 'KB）｜解析器读到 ' +
            (lv2.count || 0) + ' 条消息' + (lv2.name ? '，客户：' + lv2.name : ''));
        });
      });
    });
  }

  /* 打开弹窗时先自检一次：有没有接管这个页面、能不能读到聊天区 */
  setTimeout(function () {
    activeTab(function (t) {
      if (!t || !t.id) return;
      chrome.tabs.sendMessage(t.id, { __xm: true, type: 'liveCheck' }, function (r) {
        if (chrome.runtime.lastError) {
          showLive('err', '当前页没被扩展接管（不是店铺后台，或刚更新扩展还没刷新页面）');
          return;
        }
        if (!r) return;
        if (!r.ok) { if (r.error) showLive('warn', r.error); return; }
        var cs = (r.sample || []).filter(function (m) { return m.role === 'customer'; });
        var last = cs[cs.length - 1];
        showLive('ok', '识别到 ' + r.count + ' 条消息，当前客户：' + (r.name || '（未识别）') +
          (last ? '｜客户最后说：' + String(last.text).slice(0, 16) : ''));
      });
    });
  }, 250);
})();
