/* 买家在线咨询页逻辑（零依赖）
 * 发消息 → POST /api/inbox/:code/messages → 服务端落库并触发工作流 / AI 首响
 * 收回复 → GET  /api/inbox/:code/messages（按消息 id 增量轮询）
 */
(function () {
  var code = (location.pathname.match(/^\/c\/([a-z0-9_-]{4,24})/i) || [])[1] || '';
  var $ = function (id) { return document.getElementById(id); };
  var KEY_V = 'xm_visitor_' + code;
  var KEY_N = 'xm_nick_' + code;

  var visitor = localStorage.getItem(KEY_V) || '';
  if (!visitor) {
    visitor = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(KEY_V, visitor);
  }
  var lastId = 0;
  var stop = false;

  function el(tag, cls, text) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text !== undefined) d.textContent = text;
    return d;
  }
  function scrollBottom() {
    var s = $('scroller');
    s.scrollTop = s.scrollHeight;
  }
  function roleName(r) {
    if (r === 'agent') return '客服';
    if (r === 'ai') return '智能助手';
    return '我';
  }

  function appendMsg(m) {
    var box = el('div', 'msg' + (m.role === 'customer' ? ' me' : ''));
    var wrap = el('div');
    var role = el('div', 'who', roleName(m.role));
    var bubble = el('div', 'bubble');
    bubble.appendChild(document.createTextNode(m.text));
    bubble.appendChild(el('span', 'time', m.time || ''));
    wrap.appendChild(role);
    wrap.appendChild(bubble);
    box.appendChild(wrap);
    $('msgs').appendChild(box);
    if (m.id) lastId = Math.max(lastId, Number(m.id));
    scrollBottom();
  }

  function sys(text) {
    $('msgs').appendChild(el('div', 'sys', text));
    scrollBottom();
  }

  /* 拉取客服 / AI 的回复（增量） */
  function pull() {
    if (stop) return;
    return fetch('/api/inbox/' + encodeURIComponent(code) + '/messages?visitor=' + encodeURIComponent(visitor) + '&after=' + lastId)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) return;
        (j.messages || []).forEach(appendMsg);
        if (j.messages && j.messages.length) scrollBottom();
      })
      .catch(function () { /* 网络抖动，下个周期再试 */ });
  }

  function send() {
    var input = $('input');
    var text = String(input.value || '').trim();
    if (!text) return;
    var nick = String($('nick').value || '').trim();
    if (nick) localStorage.setItem(KEY_N, nick);
    $('send').disabled = true;
    input.value = '';
    /* 不在本地回显，发送成功后直接从服务端增量拉取（含 AI / 客服回复），避免重复渲染 */
    fetch('/api/inbox/' + encodeURIComponent(code) + '/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitor: visitor, name: nick, text: text }),
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) {
          sys('发送失败：' + ((j && j.error) || '请稍后重试'));
          return;
        }
        pull();
      })
      .catch(function () { sys('网络异常，消息未发出，请重试'); })
      .then(function () { $('send').disabled = false; });
  }

  function boot() {
    if (!code) {
      $('msgs').innerHTML = '';
      $('msgs').appendChild(el('div', 'err', '链接缺少店铺代码，请向商家索取正确的咨询链接。'));
      return;
    }
    fetch('/api/inbox/' + encodeURIComponent(code))
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (res) {
        var j = res.j;
        if (!j || !j.ok) {
          $('shopName').textContent = '咨询入口不可用';
          $('msgs').appendChild(el('div', 'err', (j && j.error) || '该店铺的咨询入口不存在或已关闭。'));
          stop = true;
          return;
        }
        document.title = '在线咨询 · ' + j.store.name;
        $('shopName').textContent = j.store.name;
        $('shopShort').textContent = (j.store.short || j.store.name || '店').slice(0, 1);
        if (j.store.color) $('shopShort').style.background = j.store.color;
        $('shopSub').innerHTML = '<span class="dot"></span>' + (j.ai ? '智能助手在线，通常会立即回复' : '在线，客服会尽快回复');
        if (j.welcome) { $('welcome').textContent = j.welcome; $('welcome').classList.add('show'); }
        $('nick').value = localStorage.getItem(KEY_N) || '';
        sys('已接通「' + j.store.name + '」，请描述您的问题');
        pull();
      })
      .catch(function () {
        $('shopName').textContent = '网络异常';
        $('msgs').appendChild(el('div', 'err', '无法连接客服服务，请检查网络后刷新页面。'));
      });
  }

  $('send').addEventListener('click', send);
  $('input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) { e.preventDefault(); send(); }
  });
  $('nick').addEventListener('blur', function () {
    var v = String($('nick').value || '').trim();
    if (v) localStorage.setItem(KEY_N, v);
  });

  boot();
  setInterval(pull, 2500);
})();
