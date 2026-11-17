/* ===================================================================
   小满AI · 电商客服工作台 — 应用逻辑 (Vue 3)
   =================================================================== */
const { createApp } = Vue;

const EMPTY_DASH = {
  kpis: [],
  trend7d: { labels: [], ai: [], human: [] },
  platformDist: [],
  satisfactionTrend: { labels: [], values: [] },
  storeRanking: [],
  afterSales: {},
};

const PLATFORMS = ['淘宝', '京东', '拼多多', '抖音', '小红书', '快手', '视频号', '自建站'];
const PLATFORM_COLOR = {
  淘宝: '#FF5000', 京东: '#E1251B', 拼多多: '#E02E24', 抖音: '#161823',
  小红书: '#FF2442', 快手: '#FF6600', 视频号: '#07C160', 自建站: '#165DFF',
};

const APP = {
  data() {
    const B = window.__BOOT__ || {};
    const clone = (o) => JSON.parse(JSON.stringify(o || []));
    const firstConv = (B.conversations || [])[0];
    const firstTicket = (B.tickets || [])[0];
    return {
      brand: B.brand || { name: '小满AI', product: '电商客服工作台' },
      user: B.user || { name: '访客', email: '', role: 'agent' },
      tenant: B.tenant || { name: '' },
      team: B.team || [],
      stores: B.stores || [],
      conversations: clone(B.conversations),
      tickets: clone(B.tickets),
      dashboard: B.dashboard || EMPTY_DASH,
      knowledge: clone(B.knowledge),
      quickReplies: clone(B.quickReplies),
      userMenu: false,

      /* ---------- 数据概览 ---------- */
      overview: {
        stores: [], kpis: [], quota: { total: 5000, used: 0, remain: 5000 },
        pendingAlerts: 0, pendingQc: 0, pendingTickets: 0, unreadNotices: 0,
        stats: {
          stores_online: 0, stores_total: 0, today_inbound: 0, today_transfer: 0,
          conversion: 0, accuracy: 0,
          trend: { labels: [], values: [] }, top_stores: [],
          lexicon: { account: 0, store: 0, product: 0, total: 0 },
          delta: { inbound: 0, transfer: 0 },
        },
      },
      overviewLoaded: false,
      railTab: 'store',

      /* ---------- 对话质检 ---------- */
      qc: { items: [], stats: { total: 0, avg: 0, risk: 0, pending: 0, excellent: 0 } },
      qcFilter: 'all',
      qcLoaded: false,
      qcPlatform: '', qcStoreKw: '', qcBuyerKw: '', qcDate: '',
      qcStoreId: '',
      qcPage: 1, qcPageSize: 10,
      qcDetailOpen: false,
      qcDetail: {
        loading: false, saving: false, savingKb: false, kbSaved: false,
        review: { id: '', customer: '', store_id: '', agent: '', score: 0, level: '', status: '', created_at: '', note: '' },
        conv: null, messages: [], star: 5,
        kbMode: false, kbForm: { name: '', scope: 'store', content: '', productId: '' },
      },

      /* ---------- 信息通知 ---------- */
      notices: [],
      noticeUnread: 0,
      noticeFilter: 'all',
      noticeLoaded: false,
      notifyGroups: [],
      ngWizardOpen: false, ngStep: 1, ngNewName: '', ngChannel: 'wecom',
      ngWebhook: '', ngBindCode: '', ngBusy: false, ngPendingId: '',
      ngTestMsg: '', ngTestOk: false,

      /* ---------- 店铺信息助手（向导） ---------- */
      wizardOpen: false, wizardStep: 1,
      wizardData: {
        tone: '', nickname: '', welcome: '',
        shipFrom: [], couriers: [], allowSpecify: '',
        shipTime: '', freeShipping: '', remoteNote: '',
        returnWindow: '', quality: '', freight: '',
      },
      wizSel: { shipFrom: false, couriers: false },
      wizardSteps: [
        { key: 'intro', title: '引导页面' },
        { key: 'style', title: '客服风格' },
        { key: 'logistics', title: '物流设置' },
        { key: 'shipping', title: '发货政策' },
        { key: 'aftersale', title: '售后政策' },
        { key: 'done', title: '完成设置' },
      ],
      wizOpts: {
        tones: ['专业', '亲切', '活泼', '简洁'],
        shipFrom: ['浙江杭州', '广东广州', '江苏苏州', '上海', '北京', '海外仓'],
        couriers: ['顺丰速运', '中通快递', '圆通速递', '申通快递', '韵达快递', '京东物流', '邮政EMS'],
        shipTime: ['24 小时内', '48 小时内', '72 小时内', '预售款按约定'],
        returnWindow: ['7 天', '15 天', '30 天'],
        quality: ['优先退款', '优先换货', '退款/换货任选'],
        freight: ['商家承担', '买家承担', '协商处理'],
      },

      /* ---------- 订单卡片（AI 客服内可直接查看 / 操作） ---------- */
      ordOpen: false, ordLoading: false,
      ord: {
        no: '', product: '', amount: '', status: '', customer: '', store: null,
        image: '', carrier: '', tracking: '', receiver: '', createdAt: '', payTime: '', timeline: [],
      },

      /* ---------- 素材中心 ---------- */
      materials: [],
      matFilter: 'all',
      matSearch: '',
      matLoaded: false,
      matOpen: false,
      matView: null,
      zoomUrl: '',
      matForm: { name: '', type: 'image', tag: '商品图', size: '1.0 MB' },

      /* ---------- 对话预警 ---------- */
      alerts: [],
      alertStats: { pending: 0, high: 0, handled: 0 },
      alertFilter: 'pending',
      alertLoaded: false,

      /* ---------- AI Agent 工作流 ---------- */
      flows: [],
      flowRunsOpen: false,
      flowRunsLoading: false,
      flowRuns: [],
      flowRunsFlow: null,
      flowLoaded: false,
      flowExpand: null,
      flowView: 'canvas',        // canvas | list
      flowActive: '',
      flowPos: {},               // { 'flowId:index': {x,y} } 自定义拖动位置
      flowDrag: null,

      /* ---------- 店铺管理（真实平台接入） ---------- */
      storeOpen: false,
      storeStep: 'web', // web | api | authorize
      storeForm: { name: '', platform: '淘宝', appKey: '', appSecret: '', env: 'prod', color: '#FF5000' },
      platforms: PLATFORMS,
      platformList: [],
      pickedKey: '',
      pickedPlatform: null,
      pickProxy: false,
      webForm: { name: '', account: '' },
      webFrameFailed: false,
      webFrameLoaded: false,
      wsFrameFailed: false,
      wsFrameLoaded: false,
      wsBlocked: false,           // 平台禁止内嵌 → 走独立窗口
      wsBlockedUrl: '',
      wsBlockedName: '',
      wsBlockedNote: '',
      wsCurrentStore: null,
      connectorList: [],          // /api/connectors 返回的真实能力清单
      storeSaving: false,
      storeTesting: false,
      storeTest: null,            // 连接自检结果
      storeAuthorizeUrl: '',

      /* ---------- 店铺管理（表格 + 详情 + 编辑商品） ---------- */
      storeList: [],
      storePlatforms: [],
      storeFilterPlatform: '',
      storeFilterQ: '',
      storePage: 1,
      storePageSize: 8,
      storeInfoOpen: false,
      storeInfo: { store: {}, stats: { items: 0, knowledge: 0, receives: 0, transfers: 0, messages: 0 }, items: [] },
      storeInfoLoading: false,
      prodQ: '',            // 详情弹窗里的商品搜索词
      prodPage: 1,
      prodPageSize: 8,
      storeEditOpen: false,
      storeEditForm: { id: '', name: '', platform: '', account: '', status: 'active' },
      storeEditSaving: false,
      newItemOpen: false,
      newItemSaving: false,
      newItem: { title: '', num_iid: '', price: '', pic_url: '', description: '', specs: '', attrs: '' },
      editItemOpen: false,
      editItem: { num_iid: '', title: '', description: '', specs: '', attrs: '', pic_url: '', price: '', learn: true, kbCount: 0 },
      editItemSaving: false,
      /* 接入详情 */
      detailOpen: false,
      detailStore: null,
      detail: { integration: null, capabilities: [], stats: null, logs: [] },
      detailDiag: null,        // 消息接收体检结果（含对外接入口）
      detailBridge: null,      // 浏览器消息桥状态（网页登录监听）
      bridgeTimer: null,       // 监听状态轮询定时器
      tmcSubscribing: false,
      detailLoading: false,
      detailTesting: false,
      detailSyncing: false,
      syncBusy: '',

      /* ---------- 店铺工作区（内置浏览器） ---------- */
      wsStoreId: '',
      wsUrl: '',
      wsHistory: [],
      wsIndex: -1,
      wsTab: 'logged',

      /* ---------- 店铺右键菜单 ---------- */
      ctx: { show: false, x: 0, y: 0, store: null },

      /* ---------- 店铺配置面板 ---------- */
      cfgOpen: false,
      cfgWiz: false,          // 在店铺设置弹窗内展开「店铺信息助手」向导
      cfgStore: null,
      cfgTab: 'basic',
      cfgTabs: [
        { key: 'basic', label: '基础设置', icon: 'fa-sliders' },
        { key: 'import', label: '导入知识', icon: 'fa-upload' },
        { key: 'knowledge', label: 'AI管理中心', icon: 'fa-book' },
        { key: 'settings', label: '店铺设置', icon: 'fa-cogs' },
      ],
      cfgSaving: false,
      cfg: {
        style: 'cute', heat: 50,
        welcome: '欢迎光临，请问有什么可以帮您？',
        transferAccounts: [], transferScripts: [], transferKeywords: [],
        sceneScripts: false, autoTransferOrder: false,
        endScripts: { none: [], unshipped: [], shipped: [], received: [] },
        endDelay: 2, forbidden: [], allowOrderNote: false, proxyIp: false,
      },
      replyStyles: [
        { key: 'loli', name: '萝莉型', desc: '软萌可爱，语气亲切', icon: 'fa-heart', color: '#F5319D', bg: '#FFF0F6' },
        { key: 'cute', name: '可爱型', desc: '活泼俏皮，轻松友好', icon: 'fa-smile-o', color: '#165DFF', bg: '#EEF3FF' },
        { key: 'practical', name: '实用性', desc: '简洁高效，直奔主题', icon: 'fa-check-circle', color: '#00B42A', bg: '#E8FFEA' },
        { key: 'pro', name: '专业型', desc: '严谨规范，商务正式', icon: 'fa-briefcase', color: '#0FC6C2', bg: '#E8FFFB' },
        { key: 'warm', name: '热情型', desc: '主动积极，情绪饱满', icon: 'fa-fire', color: '#FF7D00', bg: '#FFF7E8' },
        { key: 'cool', name: '高冷型', desc: '简洁克制，不多废话', icon: 'fa-snowflake-o', color: '#722ED1', bg: '#F5EEFF' },
        { key: 'humor', name: '幽默型', desc: '风趣有梗，拉近距离', icon: 'fa-bolt', color: '#86909C', bg: '#F7F8FA' },
        { key: 'gentle', name: '温柔型', desc: '耐心细腻，安抚情绪', icon: 'fa-moon-o', color: '#165DFF', bg: '#EEF3FF' },
      ],
      accInput: '', scriptInput: '', kwInput: '', endInput: '',
      endTab: 'none',
      forbidFrom: '', forbidTo: '',
      /* 店铺设置 · 通知群规则 */
      cfgRules: [], cfgGroups: [], cfgStats: null, cfgRulesLoading: false,
      nrKwInput: '', nrNewGroupName: '',

      /* ---------- 店铺知识 ---------- */
      storeKb: [],
      kbTypes: [
        { key: 'product', label: '商品知识' }, { key: 'faq', label: '常见问题' },
        { key: 'policy', label: '售后政策' }, { key: 'logistics', label: '物流说明' },
        { key: 'custom', label: '自定义' },
      ],
      kbLoading: false,
      kbFilterType: 'all',
      kbFilterQ: '',
      kbAddOpen: false,
      kbNew: { type: 'product', productId: '', question: '', answer: '' },
      kbRows: [],
      kbPaste: '',
      pasteOpen: false,
      importType: 'product',
      importReplace: false,
      kbImporting: false,

      /* ---------- 知识管理 ---------- */
      kbSearch: '',
      kbOpen: false,
      kbForm: { q: '', a: '', materialId: '' },

      /* ---------- 系统设置（System Preferences） ---------- */
      sysOpen: false,
      sysRuntime: null,
      sysSaving: false,
      clearing: false,
      sys: {
        avoidHumanSec: 5,
        conflictSource: 'order',      // order | browse
        learnHuman: false,
        logLevel: 'detail',           // detail | normal | minimal
        autoAfterSalesPanel: true,
        autoAssistant: true,
      },

      /* ---------- 快捷短语栏 ---------- */
      qrOpen: false,
      qrTab: 'quick',                 // order | search | goods | quick
      qrScope: 'recent',              // recent | mine | team
      qrSearch: '',
      qrGroupOpen: '',
      qrList: [],                     // /api/quick-replies → replies
      qrRecent: [],                   // /api/quick-replies → recent
      qrLoaded: false,
      qrAdding: false,
      qrNewText: '',
      qrNewCategory: '通用',

      /* ---------- 子账号管理 ---------- */
      members: [],
      allStores: [],
      memberLoaded: false,
      memberOpen: null,
      memberSaving: false,
      memberSearch: '',
      memberOnline: 'all',
      memberPage: 1,
      memberPageSize: 10,
      pwdOpen: null,
      pwdForm: { password: '', confirm: '' },
      pwdSaving: false,

      route: 'overview',
      // inbox
      convFilter: 'all',
      convStoreId: '',
      convKb: {},                 // storeId -> 已启用的店铺知识（含 AI 学到的商品资料）
      convSearch: '',
      activeConvId: firstConv ? firstConv.id : null,
      /* 实时接收：轮询增量（买家在咨询页 / Webhook 发来的消息会自动出现） */
      feedSince: '',
      feedTimer: null,
      newInbound: 0,
      mobileChat: false,
      draft: '',
      aiSuggest: '',
      aiSuggestLoading: false,
      aiSwitching: false,
      aiSuggestSource: 'reply',
      // aftersales
      ticketFilter: 'all',
      activeTicketId: firstTicket ? firstTicket.id : null,
      advice: '',
      adviceLoading: false,
      // settings / AI
      ai: B.ai || { provider: 'demo', baseURL: 'https://api.deepseek.com', model: 'deepseek-chat', configured: false, demo: true },
      cfgProvider: 'deepseek',
      cfgBaseURL: (B.ai && B.ai.baseURL) || 'https://api.deepseek.com',
      cfgModel: (B.ai && B.ai.model) || 'deepseek-chat',
      cfgKey: '',
      cfgTesting: false,
      cfgTestMsg: '',
      cfgTestOk: null,
      models: [],
      temperature: B.ai && typeof B.ai.temperature === 'number' ? B.ai.temperature : 0.7,
      autoReply: B.ai ? B.ai.autoReply !== false : true,
      tone: (B.ai && B.ai.tone) || '亲切',
      // copywriting modal
      copyOpen: false,
      copyProduct: '',
      copyResult: '',
      copyLoading: false,
      // 客服协助 / 教程
      helpOpen: false,
      tutorOpen: false,
      // ui
      toasts: [],
      serverDown: false,
    };
  },

  computed: {
    wizPercent() {
      const total = this.wizardSteps.length;
      return Math.round(((this.wizardStep - 1) / (total - 1)) * 100);
    },
    wizEta() {
      return Math.max(1, this.wizardSteps.length - this.wizardStep);
    },
    /** 向导是否已完成过（有核心配置即视为已完成） */
    wizDone() {
      const d = this.wizardData;
      return !!(d.tone && d.shipFrom.length && d.couriers.length && d.shipTime && d.returnWindow);
    },
    wizCanNext() {
      if (this.wizardStep === 3) return this.wizardData.shipFrom.length > 0 && this.wizardData.couriers.length > 0;
      if (this.wizardStep === 2) return !!this.wizardData.tone;
      if (this.wizardStep === 4) return !!this.wizardData.shipTime && !!this.wizardData.freeShipping;
      if (this.wizardStep === 5) return !!this.wizardData.returnWindow && !!this.wizardData.quality && !!this.wizardData.freight;
      return true;
    },
    platformOf() {
      return (id) => this.stores.find((s) => s.id === id) || { short: '?', color: '#86909C', name: '未知店铺', platform: '—' };
    },
    wsCurrentName() {
      const s = this.stores.find((x) => x.id === this.wsStoreId);
      return s ? s.name : '该店铺';
    },
    totalUnread() {
      return this.conversations.reduce((a, c) => a + (c.unread || 0), 0);
    },
    pendingTickets() {
      return this.tickets.filter((t) => t.status === 'pending').length;
    },
    /* 会话聚合顶部的「平台分组」筛选标签：全部 / 未读 / 淘宝天猫 / 拼多多 / 抖音 / 京东 ……
       只要接过店的平台都列出来（哪怕当前没有会话），淘宝+天猫归并为「淘宝/天猫」；
       每个标签带上该平台的会话数与未读数，点击即只显示该平台的店铺会话 */
    convPlatformTabs() {
      const map = {}; const order = [];
      const TAB = {
        taobao: '淘宝/天猫', tmall: '淘宝/天猫', taofactory: '淘工厂', douyin: '抖音',
        jd: '京东', pdd: '拼多多', kuaishou: '快手', xhs: '小红书', channels: '视频号',
        wechat: '微信小店', hours: '小时达',
      };
      const COLOR = {
        taobao: '#FF5000', taofactory: '#FF6A00', douyin: '#161823', jd: '#E1251B',
        pdd: '#E02E24', kuaishou: '#FF6600', xhs: '#FF2442', channels: '#07C160',
        wechat: '#07C160', hours: '#165DFF',
      };
      const stores = this.stores || [];
      for (const s of stores) {
        const k = this.storePlatformKey(s);
        if (!k) continue;
        const gk = (k === 'taobao' || k === 'tmall') ? 'taobao' : k;
        if (!map[gk]) {
          map[gk] = { value: gk, label: TAB[gk] || s.platform || k, color: COLOR[gk] || s.color || '#86909C', storeCount: 0, count: 0, unread: 0 };
          order.push(gk);
        }
        map[gk].storeCount++;
      }
      /* 会话数 / 未读数按店铺归属统计 */
      for (const c of (this.conversations || [])) {
        const st = stores.find((s) => s.id === c.storeId);
        const k = this.storePlatformKey(st);
        if (!k) continue;
        const gk = (k === 'taobao' || k === 'tmall') ? 'taobao' : k;
        if (!map[gk]) continue;
        map[gk].count++;
        map[gk].unread += (c.unread || 0);
      }
      return order.map((k) => map[k]);
    },
    /* 选中平台后，二级「按店铺」筛选：该平台下已接入的店铺 */
    convStoreChips() {
      if (!this.convFilter || this.convFilter === 'all' || this.convFilter === 'unread') return [];
      const gk = this.convFilter;
      return (this.stores || [])
        .filter((s) => {
          const k = this.storePlatformKey(s);
          if (!k) return false;
          return ((k === 'taobao' || k === 'tmall') ? 'taobao' : k) === gk;
        })
        .map((s) => {
          const n = (this.conversations || []).filter((c) => c.storeId === s.id).length;
          return { id: s.id, name: s.name, count: n, color: s.color };
        });
    },
    /* 当前筛选范围的文字说明：淘宝/天猫 · 全部 3 家店 */
    convScope() {
      const tab = this.convPlatformTabs.find((t) => t.value === this.convFilter);
      if (!tab) return { label: '全部平台', sub: (this.stores || []).length + ' 家店铺', color: '#165DFF' };
      const picked = (this.stores || []).find((s) => s.id === this.convStoreId);
      return {
        label: tab.label,
        sub: picked ? picked.name : '全部 ' + tab.storeCount + ' 家店',
        color: tab.color,
      };
    },
    storePages() {
      return Math.max(1, Math.ceil((this.storeList || []).length / this.storePageSize));
    },
    pagedStores() {
      const start = (this.storePage - 1) * this.storePageSize;
      return (this.storeList || []).slice(start, start + this.storePageSize);
    },
    /* 店铺详情弹窗里的商品列表：本地搜索 + 分页 */
    storeProds() {
      const list = (this.storeInfo && this.storeInfo.items) || [];
      const q = (this.prodQ || '').trim().toLowerCase();
      if (!q) return list;
      return list.filter((it) => (it.title + ' ' + it.num_iid).toLowerCase().includes(q));
    },
    storeProdPages() {
      return Math.max(1, Math.ceil(this.storeProds.length / this.prodPageSize));
    },
    pagedStoreProds() {
      const start = (this.prodPage - 1) * this.prodPageSize;
      return this.storeProds.slice(start, start + this.prodPageSize);
    },
    /* 已接入店铺涉及的平台（用于详情弹窗/统计文案） */
    storePlatformOptions() {
      return Array.from(new Set((this.storeList || []).map((s) => s.platform))).filter(Boolean);
    },
    memberList() {
      let list = this.members || [];
      const q = (this.memberSearch || '').trim().toLowerCase();
      if (q) list = list.filter((m) => (m.name + ' ' + m.email + ' ' + (m.title || '')).toLowerCase().includes(q));
      if (this.memberOnline === 'online') list = list.filter((m) => m.online && m.status === 'active');
      if (this.memberOnline === 'offline') list = list.filter((m) => !m.online);
      if (this.memberOnline === 'disabled') list = list.filter((m) => m.status !== 'active');
      return list;
    },
    memberPages() {
      return Math.max(1, Math.ceil(this.memberList.length / this.memberPageSize));
    },
    pagedMembers() {
      const start = (this.memberPage - 1) * this.memberPageSize;
      return this.memberList.slice(start, start + this.memberPageSize);
    },
    filteredConvs() {
      let list = this.conversations;
      if (this.convFilter === 'unread') {
        list = list.filter((c) => c.unread > 0);
      } else if (this.convFilter && this.convFilter !== 'all') {
        const gk = this.convFilter;
        list = list.filter((c) => this.convPlatformKeyOfStore(c.storeId) === gk);
      }
      /* 二级筛选：只看某个店铺 */
      if (this.convStoreId) list = list.filter((c) => c.storeId === this.convStoreId);
      const q = this.convSearch.trim().toLowerCase();
      if (q) list = list.filter((c) => (c.name + ' ' + this.lastMsgOf(c)).toLowerCase().includes(q));
      return list;
    },
    activeConv() {
      return this.conversations.find((c) => c.id === this.activeConvId) || null;
    },
    filteredTickets() {
      if (this.ticketFilter === 'all') return this.tickets;
      return this.tickets.filter((t) => t.status === this.ticketFilter);
    },
    activeTicket() {
      return this.tickets.find((t) => t.id === this.activeTicketId) || null;
    },
    routeMeta() {
      const map = {
        overview: { title: '数据概览', sub: '店铺接入状态 · 今日运营关键指标' },
        inbox: { title: '会话聚合', sub: '多店铺统一接待 · AI 辅助回复' },
        aftersales: { title: '售后助手', sub: '退款退货 · 物流异常 · AI 处理建议' },
        dashboard: { title: '数据看板', sub: '接待效率 · AI 效能 · 服务质量' },
        stores: { title: '店铺管理', sub: '平台授权 · 账号绑定 · 接待开关' },
        workspace: { title: '店铺工作区', sub: '内置浏览器 · 多账号登录态 · 官方后台' },
        qc: { title: '对话质检', sub: '自动打分 · 违规识别 · 人工复核' },
        knowledge: { title: '知识管理', sub: '店铺知识库 · AI 回复依据' },
        flows: { title: 'AI Agent 工作流', sub: '触发器 · 智能决策 · 自动执行' },
        notify: { title: '信息通知', sub: '系统消息 · 风险提醒 · 套餐与版本' },
        materials: { title: '素材中心', sub: '商品图 / 视频 / 文档 / 话术统一管理' },
        alerts: { title: '对话预警', sub: '情绪 · 超时 · 敏感词 · 退款风险' },
        subaccounts: { title: '子账号管理', sub: '坐席账号 · 角色权限 · 状态控制' },
        settings: { title: 'AI 设置', sub: '大模型接入 · 语气 · 自动化策略' },
      };
      return map[this.route] || map.inbox;
    },

    /* ---------- 扩展模块的派生数据 ---------- */
    qcList() {
      if (this.qcFilter === 'all') return this.qc.items;
      if (this.qcFilter === 'pending') return this.qc.items.filter((i) => i.status === 'pending');
      return this.qc.items.filter((i) => i.level === this.qcFilter);
    },
    qcPlatforms() {
      const seen = {};
      const out = [];
      for (const s of (this.stores || [])) {
        const k = this.convPlatformKeyOfStore(s.id);
        if (!k || seen[k]) continue;
        seen[k] = 1;
        const tab = this.convPlatformTabs.find((t) => t.value === k);
        out.push({ key: k, name: (tab && tab.label) || s.platform });
      }
      return out;
    },
    /* 质检筛选可选的店铺（按已选平台收窄） */
    qcStoreOptions() {
      return (this.stores || []).filter((s) => {
        if (!this.qcPlatform) return true;
        return this.convPlatformKeyOfStore(s.id) === this.qcPlatform;
      });
    },
    qcFiltered() {
      let list = this.qc.items;
      if (this.qcFilter === 'all') { /* 全部 */ }
      else if (this.qcFilter === 'pending') list = list.filter((i) => i.status === 'pending');
      else list = list.filter((i) => i.level === this.qcFilter);
      if (this.qcPlatform) list = list.filter((i) => this.convPlatformKeyOfStore(i.storeId) === this.qcPlatform);
      if (this.qcStoreId) list = list.filter((i) => i.storeId === this.qcStoreId);
      if (this.qcStoreKw.trim()) {
        const k = this.qcStoreKw.trim().toLowerCase();
        list = list.filter((i) => this.platformOf(i.storeId).platform.toLowerCase().includes(k));
      }
      if (this.qcBuyerKw.trim()) {
        const k = this.qcBuyerKw.trim().toLowerCase();
        list = list.filter((i) => (i.customer || '').toLowerCase().includes(k));
      }
      if (this.qcDate) {
        const now = Date.now();
        const limit = this.qcDate === 'today' ? 86400000 : (Number(this.qcDate) * 86400000);
        list = list.filter((i) => {
          const t = new Date(i.createdAt.replace(/-/g, '/')).getTime();
          return !isNaN(t) && (now - t) <= limit;
        });
      }
      return list;
    },
    qcTotalPages() {
      return Math.max(1, Math.ceil(this.qcFiltered.length / this.qcPageSize));
    },
    qcPaged() {
      const s = (this.qcPage - 1) * this.qcPageSize;
      return this.qcFiltered.slice(s, s + this.qcPageSize);
    },
    noticeList() {
      if (this.noticeFilter === 'all') return this.notices;
      if (this.noticeFilter === 'unread') return this.notices.filter((n) => !n.read);
      return this.notices.filter((n) => n.type === this.noticeFilter);
    },
    ngQrSvg() {
      const code = this.ngBindCode || 'xiaoman';
      let h = 2166136261;
      for (let i = 0; i < code.length; i++) { h ^= code.charCodeAt(i); h = Math.imul(h, 16777619); }
      const N = 21, cell = 6, pad = 4;
      const size = N * cell + pad * 2;
      let rects = '';
      const finder = (ox, oy) => {
        rects += `<rect x="${pad + ox * cell}" y="${pad + oy * cell}" width="${7 * cell}" height="${7 * cell}" fill="#1D2129"/>`;
        rects += `<rect x="${pad + (ox + 1) * cell}" y="${pad + (oy + 1) * cell}" width="${5 * cell}" height="${5 * cell}" fill="#fff"/>`;
        rects += `<rect x="${pad + (ox + 2) * cell}" y="${pad + (oy + 2) * cell}" width="${3 * cell}" height="${3 * cell}" fill="#165DFF"/>`;
      };
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          if ((x < 7 && y < 7) || (x >= N - 7 && y < 7) || (x < 7 && y >= N - 7)) continue;
          h ^= (x * 31 + y * 17 + 7); h = Math.imul(h, 16777619);
          if ((h >>> 0) % 100 < 48) rects += `<rect x="${pad + x * cell}" y="${pad + y * cell}" width="${cell}" height="${cell}" fill="#1D2129"/>`;
        }
      }
      finder(0, 0); finder(N - 7, 0); finder(0, N - 7);
      return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg"><rect width="${size}" height="${size}" fill="#fff"/>${rects}</svg>`;
    },
    matList() {
      let list = this.materials;
      if (this.matFilter !== 'all') list = list.filter((m) => m.type === this.matFilter);
      const q = this.matSearch.trim().toLowerCase();
      if (q) list = list.filter((m) => (m.name + ' ' + m.tag).toLowerCase().includes(q));
      return list;
    },
    alertList() {
      if (this.alertFilter === 'pending') return this.alerts.filter((a) => !a.handled);
      if (this.alertFilter === 'done') return this.alerts.filter((a) => a.handled);
      return this.alerts;
    },
    kbList() {
      const q = this.kbSearch.trim().toLowerCase();
      if (!q) return this.knowledge;
      return this.knowledge.filter((k) => (k.q + ' ' + k.a).toLowerCase().includes(q));
    },
    /* 平台下拉：只把真正实现了对接的平台标为可选 */
    platformOptions() {
      if (this.connectorList.length) {
        return this.connectorList.map((c) => ({ name: c.aliases[0] || c.name, supported: true, key: c.key }));
      }
      return this.platforms.map((p) => ({ name: p, supported: p === '淘宝', key: p === '淘宝' ? 'taobao' : '' }));
    },
    currentConnector() {
      const p = this.storeForm.platform;
      return this.connectorList.find((c) => (c.aliases || []).includes(p) || c.name === p) || null;
    },
    redirectUriPreview() {
      const key = (this.currentConnector && this.currentConnector.key) || 'taobao';
      return location.origin + '/api/oauth/' + key + '/callback';
    },
    cfgTabLabel() {
      const t = this.cfgTabs.find((x) => x.key === this.cfgTab);
      return t ? t.label : '';
    },
    wsAccounts() {
      const list = this.overview.stores || [];
      if (this.wsTab === 'logged') return list.filter((s) => s.status === 'active');
      return list.filter((s) => s.status !== 'active');
    },
    endTabs() {
      return [
        { key: 'none', label: '无订单', icon: 'fa-file-o' },
        { key: 'unshipped', label: '待发货', icon: 'fa-clock-o' },
        { key: 'shipped', label: '已发货', icon: 'fa-truck' },
        { key: 'received', label: '已签收', icon: 'fa-check-circle-o' },
      ];
    },
    endTabLabel() {
      const t = this.endTabs.find((x) => x.key === this.endTab);
      return t ? t.label : '';
    },
    /* 按风格 + 热度生成预览文案，和 AI 实际拼 prompt 的口径一致 */
    stylePreview() {
      const base = {
        loli: '会的呀~今天就会安排发货哒，到了会有短信通知喔♡',
        cute: '今天就发货喔~嘻嘻，放心啦~',
        practical: '今天安排发货，发出后会有物流单号短信通知。',
        pro: '您好，本单今日安排出库，发货后将同步物流单号，请注意查收。',
        warm: '亲爱的放心！今天就给您安排发出，物流信息我第一时间通知您~',
        cool: '今天发，单号后补。',
        humor: '已经排队出门啦，今天肯定不让它在家过夜的~',
        gentle: '您别着急，今天就会安排发货的，发出后我把单号发您~',
      }[this.cfg.style] || '今天安排发货。';
      const short = base.split(/[，,]/)[0].replace(/[~～]/g, '') + '。';
      if (this.cfg.heat < 34) return short;
      if (this.cfg.heat > 67) return base + '还有别的想了解的随时问我~';
      return base;
    },
    /* ---------- 快捷短语栏：按范围 + 关键词实时分组 ---------- */
    qrGroups() {
      const kw = String(this.qrSearch || '').trim().toLowerCase();
      const hit = (s) => !kw || String(s || '').toLowerCase().indexOf(kw) >= 0;

      if (this.qrScope === 'recent') {
        const items = (this.qrRecent || []).filter((t) => hit(t));
        return [{ name: '最近常用', items }];
      }
      const scope = this.qrScope === 'team' ? 'team' : 'personal';
      const order = [];
      const map = {};
      for (const r of this.qrList) {
        if ((r.scope || 'personal') !== scope) continue;
        if (!hit(r.text) && !hit(r.category)) continue;
        if (!map[r.category]) { map[r.category] = []; order.push(r.category); }
        map[r.category].push(r.text);
      }
      return order.map((name) => ({ name, items: map[name] }));
    },
    qrScopeCount() {
      return {
        recent: (this.qrRecent || []).length,
        mine: this.qrList.filter((r) => (r.scope || 'personal') === 'personal').length,
        team: this.qrList.filter((r) => r.scope === 'team').length,
      };
    },
    /* ---------- 数据概览派生 ---------- */
    ovStats() {
      return this.overview.stats || {};
    },
    ovKpis() {
      const st = this.ovStats;
      const d = st.delta || {};
      return [
        {
          key: 'stores', title: '店铺数量(在线)',
          value: `${st.stores_online || 0}/${st.stores_total || 0}`,
          delta: 0, to: 'stores', icon: 'fa-sitemap', color: '#165DFF', bg: '#EEF3FF',
        },
        {
          key: 'inbound', title: '今日进线数量',
          value: st.today_inbound || 0,
          delta: d.inbound || 0, to: 'inbox', icon: 'fa-sign-in', color: '#00B42A', bg: '#E8FFEA',
        },
        {
          key: 'transfer', title: '今日转接数量',
          value: st.today_transfer || 0,
          delta: d.transfer || 0, to: 'inbox', icon: 'fa-exchange', color: '#FF7D00', bg: '#FFF7E8',
        },
        {
          key: 'conv', title: '转换率',
          value: st.conversion || 0, suffix: '%',
          delta: 0, to: 'dashboard', icon: 'fa-percent', color: '#722ED1', bg: '#F5EEFF',
        },
      ];
    },
    ovTop() {
      return (this.ovStats.top_stores || []).slice(0, 6);
    },
    ovAccuracy() {
      return Math.max(0, Math.min(100, Math.round(this.ovStats.accuracy || 0)));
    },
    ovRingBg() {
      const p = this.ovAccuracy;
      return `conic-gradient(var(--primary) 0% ${p}%, #EEF0F3 ${p}% 100%)`;
    },
    /* 带动效的圆环样式：--ovp 供 CSS 注册属性扫入动画使用 */
    ovRingStyle() {
      const p = this.ovAccuracy;
      return {
        background: `conic-gradient(var(--primary) 0% calc(var(--ovp) * 1%), #EEF0F3 calc(var(--ovp) * 1%) 100%)`,
        '--ovp': p,
      };
    },
    ovLex() {
      return this.ovStats.lexicon || { account: 0, store: 0, product: 0, total: 0 };
    },
    /* 今日对话走势：真实消息按小时聚合，直接生成 SVG */
    ovTrendSvg() {
      const t = this.ovStats.trend || { labels: [], values: [] };
      const labels = t.labels || [];
      const values = t.values || [];
      const W = 640, H = 240, padL = 34, padR = 16, padT = 16, padB = 30;
      const iw = W - padL - padR, ih = H - padT - padB;
      if (!labels.length) {
        return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%">
          <text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="#C9CDD4" font-size="12">今日暂无消息</text></svg>`;
      }
      const maxV = Math.max.apply(null, values.concat([1]));
      const top = Math.max(1, Math.ceil(maxV * 1.2));
      const x = (i) => padL + (labels.length === 1 ? iw / 2 : (i * iw) / (labels.length - 1));
      const y = (v) => padT + ih * (1 - v / top);

      let grid = '';
      for (let g = 0; g <= 4; g++) {
        const val = (top * g) / 4;
        const gy = y(val);
        grid += `<line x1="${padL}" y1="${gy}" x2="${W - padR}" y2="${gy}" stroke="#F2F3F5" stroke-width="1"/>`;
        grid += `<text x="${padL - 8}" y="${gy + 3.5}" text-anchor="end" fill="#C9CDD4" font-size="10">${Math.round(val)}</text>`;
      }
      const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
      const line = 'M' + pts.join(' L');
      const area = `${line} L${x(values.length - 1).toFixed(1)},${padT + ih} L${x(0).toFixed(1)},${padT + ih} Z`;

      let dots = '';
      values.forEach((v, i) => {
        dots += `<circle class="ov-dot" style="animation-delay:${(600 + i * 55).toFixed(0)}ms" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" fill="#fff" stroke="#165DFF" stroke-width="1.6"/>`;
      });
      let xlab = '';
      const stepLabel = Math.max(1, Math.ceil(labels.length / 7));
      labels.forEach((lb, i) => {
        if (i % stepLabel && i !== labels.length - 1) return;
        xlab += `<text x="${x(i).toFixed(1)}" y="${H - 10}" text-anchor="middle" fill="#86909C" font-size="10">${lb}</text>`;
      });

      return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="none">
        <defs><linearGradient id="ovg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#165DFF" stop-opacity="0.16"/>
          <stop offset="100%" stop-color="#165DFF" stop-opacity="0"/>
        </linearGradient></defs>
        ${grid}
        <path class="ov-area" d="${area}" fill="url(#ovg)"/>
        <path class="ov-line" pathLength="1" d="${line}" fill="none" stroke="#165DFF" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${dots}${xlab}
      </svg>`;
    },
    overviewStores() { return this.overview.stores || []; },
    quotaPct() {
      const q = this.overview.quota || {};
      return q.total ? Math.min(100, Math.round((q.used / q.total) * 100)) : 0;
    },
    enabledFlows() { return this.flows.filter((f) => f.enabled).length; },
    /* ---------- 权限 ---------- */
    isPermAdmin() { return !!(this.user && this.user.role === 'admin'); },
    permOps() {
      if (this.isPermAdmin) return true;
      const p = this.user && this.user.permissions;
      return !!(p && p.ops);
    },
    permModuleList() { return PERM_MODULE_META; },
    permPlatformList() { return PERM_PLATFORM_META; },
    /* 能否出现「添加店铺」入口：管理员永远可；子账号需「可操作」且至少被授权 1 个平台 */
    canAddStore() {
      if (this.isPermAdmin) return true;
      const p = this.user && this.user.permissions;
      return !!(p && p.ops && p.platforms && p.platforms.length);
    },
    /* 添加店铺弹窗里可选择的平台（管理员=全部；子账号=被授权的平台） */
    addablePlatforms() {
      return (this.platformList || []).filter((p) => p.addable);
    },
    hiddenPlatformCount() {
      return (this.platformList || []).length - (this.addablePlatforms || []).length;
    },
    /* ---------- 工作流画布 ---------- */
    flowCurrent() {
      return this.flows.find((f) => f.id === this.flowActive) || this.flows[0] || null;
    },
    flowNodes() {
      const f = this.flowCurrent;
      if (!f) return [];
      const NODE_W = 208, GAP = 74, NODE_H = 98;
      const list = [
        { kind: 'trigger', name: this.flowTriggerText(f.triggerType), desc: f.triggerDesc || '满足条件即开始执行' },
      ];
      (f.steps || []).forEach((s) => list.push({ kind: 'step', type: s.type, name: s.name, desc: s.desc || '' }));
      list.push({ kind: 'end', name: '完成', desc: '写入执行日志与统计' });
      return list.map((n, i) => {
        const key = f.id + ':' + i;
        const p = this.flowPos[key];
        return Object.assign({}, n, {
          i, key,
          x: p ? p.x : 28 + i * (NODE_W + GAP),
          y: p ? p.y : 64,
          w: NODE_W, h: NODE_H,
        });
      });
    },
    flowLinks() {
      const ns = this.flowNodes;
      const out = [];
      for (let i = 0; i < ns.length - 1; i += 1) {
        const a = ns[i], b = ns[i + 1];
        const x1 = a.x + a.w, y1 = a.y + a.h / 2;
        const x2 = b.x, y2 = b.y + b.h / 2;
        const dx = Math.max(36, Math.abs(x2 - x1) / 2);
        out.push({ key: a.key, d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}` });
      }
      return out;
    },
    flowCanvasW() {
      const ns = this.flowNodes;
      return ns.length ? Math.max(720, Math.max(...ns.map((n) => n.x + n.w)) + 56) : 720;
    },
    flowCanvasH() {
      const ns = this.flowNodes;
      return ns.length ? Math.max(300, Math.max(...ns.map((n) => n.y + n.h)) + 56) : 300;
    },
    donutSegments() {
      return this.buildDonut(this.dashboard.platformDist);
    },
    trendChart() {
      const d = this.dashboard.trend7d;
      return this.buildChart(d.labels, [
        { name: 'AI 接待', color: '#165DFF', data: d.ai },
        { name: '人工接待', color: '#0EA5B7', data: d.human },
      ], { w: 640, h: 240, step: 200 });
    },
    satChart() {
      const d = this.dashboard.satisfactionTrend;
      return this.buildChart(d.labels, [{ name: '满意度', color: '#FF7D00', data: d.values }], { w: 640, h: 240, step: 1, minBase: 80 });
    },
    kpiSpark() {
      return (arr) => this.sparkPath(arr);
    },
  },

  methods: {
    /* ---------- 通用 ---------- */
    now() {
      const d = new Date();
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    },
    toast(msg, type = 'ok') {
      const id = Date.now() + Math.random();
      this.toasts.push({ id, msg, type });
      setTimeout(() => { this.toasts = this.toasts.filter((t) => t.id !== id); }, 3400);
    },
    go(route) {
      /* 权限守卫：系统管理仅管理员；其余模块按子账号 permissions 控制可见性 */
      if (route === 'subaccounts' || route === 'settings') {
        if (!this.isPermAdmin) return this.toast('仅管理员可访问系统管理', 'warn');
      } else if (route && !this.canSee(route)) {
        return this.toast('暂无该模块权限，请联系管理员开通', 'warn');
      }
      this.route = route;
      this.userMenu = false;
      const loader = {
        overview: 'loadOverview',
        stores: 'loadStoreList',
        qc: 'loadQc',
        notify: 'loadNotices',
        materials: 'loadMaterials',
        knowledge: 'loadMaterials',
        alerts: 'loadAlerts',
        flows: 'loadFlows',
        subaccounts: 'loadMembers',
      }[route];
      if (loader && this[loader]) this[loader]();
    },
    storeColor(id) { return this.platformOf(id).color; },
    storeShort(id) { return this.platformOf(id).short; },
    lastMsgOf(c) {
      if (c.lastMsg) return c.lastMsg;
      const m = c.messages[c.messages.length - 1];
      return m ? m.text : '';
    },
    initial(name) { return (name || '客').slice(0, 1); },
    avatarBg(name) {
      const colors = ['#165DFF', '#722ED1', '#0EA5B7', '#FF7D00', '#00B42A', '#E1251B', '#4E5969'];
      let h = 0;
      for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) % colors.length;
      return colors[h];
    },
    statusPill(s) {
      return { ai: 'AI 接待', human: '人工', waiting: '待接待' }[s] || s;
    },
    statusClass(s) {
      return { ai: 'pill-ai', human: 'pill-human', waiting: 'pill-wait' }[s] || 'pill-ai';
    },
    sentimentTag(s) {
      return { negative: ['tag-red', '情绪负面'], positive: ['tag-green', '情绪正向'], neutral: ['tag-gray', '情绪平稳'] }[s] || ['tag-gray', '—'];
    },
    ticketStatusTag(s) {
      return { pending: ['tag-orange', '待处理'], processing: ['tag-blue', '处理中'], done: ['tag-green', '已完成'] }[s] || ['tag-gray', s];
    },
    ticketTypeTag(t) {
      return {
        refund: ['tag-red', '退款'], return: ['tag-orange', '退货退款'], only_refund: ['tag-red', '仅退款'],
        logistics: ['tag-blue', '物流异常'], dispute: ['tag-purple', '交易纠纷'],
      }[t] || ['tag-gray', t];
    },
    priorityTag(p) {
      return { high: ['tag-red', '高优先级'], normal: ['tag-blue', '普通'], low: ['tag-gray', '低'] }[p] || ['tag-gray', p];
    },
    fmtDelta(v) { return (v > 0 ? '+' : '') + v + '%'; },

    /* ---------- 会话 ---------- */
    /**
     * 实时接收：增量拉取有变动的会话
     * 买家在咨询页发消息、外部系统 Webhook 转发、平台 TMC 消息进来后，
     * 客服端无需刷新页面即可看到新会话与新消息。
     */
    async pollFeed() {
      if (document.hidden) return;
      try {
        const j = await this.req('/api/conversations/feed?since=' + encodeURIComponent(this.feedSince));
        this.feedSince = j.at || this.feedSince;
        let fresh = 0;
        for (const nc of (j.conversations || [])) {
          const idx = this.conversations.findIndex((c) => c.id === nc.id);
          if (idx < 0) {           // 新会话：直接插到列表最前
            this.conversations.unshift(nc);
            fresh += (nc.messages || []).filter((m) => m.role === 'customer').length || 1;
            continue;
          }
          const old = this.conversations[idx];
          const maxId = old.messages.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0);
          const add = (nc.messages || []).filter((m) => (Number(m.id) || 0) > maxId);
          if (add.length) {
            old.messages.push(...add);
            if (this.activeConvId === nc.id) this.scrollChatBottom();
            fresh += add.filter((m) => m.role === 'customer').length;
          }
          old.lastMsg = nc.lastMsg;
          old.lastTime = nc.lastTime;
          old.status = nc.status;
          if (this.activeConvId === nc.id) {
            old.unread = 0;
            if (add.length) {
              fetch('/api/conversations/' + encodeURIComponent(nc.id) + '/read', { method: 'POST' }).catch(() => {});
            }
          } else {
            old.unread = nc.unread;
          }
        }
        if (fresh) this.newInbound += fresh;
        /* 服务端已删除的会话（如平台系统号被清扫）→ 前端同步移除，避免列表残留脏数据 */
        if (Array.isArray(j.ids) && j.ids.length >= 0) {
          const alive = new Set(j.ids);
          const before = this.conversations.length;
          if (before) {
            this.conversations = this.conversations.filter((c) => alive.has(c.id));
            if (this.conversations.length !== before && this.activeConvId && !alive.has(this.activeConvId)) {
              this.activeConvId = '';
            }
          }
        }
      } catch (e) { /* 轮询失败静默，下一个周期自动重试 */ }
    },
    clearInbound() {
      this.newInbound = 0;
      this.go('inbox');
    },
    openConv(c) {
      this.activeConvId = c.id;
      c.unread = 0;
      this.mobileChat = true;
      this.aiSuggest = '';
      this.draft = '';
      this.loadConvKb(c.storeId);
      this.scrollChatBottom();
      fetch('/api/conversations/' + encodeURIComponent(c.id) + '/read', { method: 'POST' }).catch(() => {});
    },
    /* 拉取本店已启用的店铺知识（商品资料 / FAQ / 售后政策…），供 AI 回复引用 */
    async loadConvKb(storeId) {
      if (!storeId) return;
      if (this.convKb[storeId]) return;
      this.convKb[storeId] = [];
      try {
        const j = await this.req('/api/stores/' + encodeURIComponent(storeId) + '/knowledge?type=all');
        this.convKb[storeId] = (j.items || []).filter((k) => k.status !== 'off').slice(0, 80);
      } catch (e) { /* 没有知识不影响回复 */ }
    },
    scrollChatBottom() {
      this.$nextTick(() => {
        const el = this.$refs.chatBody;
        if (el) el.scrollTop = el.scrollHeight;
      });
    },
    useQuick(text) { this.draft = text; },
    markAllRead() {
      const n = this.totalUnread;
      if (!n) { this.toast('当前没有未读消息', 'warn'); return; }
      this.conversations.forEach((c) => { c.unread = 0; });
      fetch('/api/conversations/read-all', { method: 'POST' }).catch(() => {});
      this.toast(`已将 ${n} 条未读标记为已读`, 'ok');
    },
    async send() {
      const c = this.activeConv;
      const text = this.draft.trim();
      if (!c || !text) return;
      const time = this.now();
      c.messages.push({ role: 'agent', text, time });
      c.lastMsg = text; c.lastTime = time; c.status = 'human'; c.unread = 0;
      this.draft = '';
      this.aiSuggest = '';
      this.scrollChatBottom();
      try {
        await fetch('/api/conversations/' + encodeURIComponent(c.id) + '/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, role: 'agent' }),
        });
        this.toast('消息已发送', 'ok');
      } catch (e) {
        this.toast('发送失败：' + e.message, 'err');
      }
      if (this.autoReply) this.simulateCustomer(c, text);
    },
    simulateCustomer(c, agentText) {
      // 轻量模拟顾客追问，让演示会话更真实（非 AI 调用，避免消耗额度）
      const guess = /发货|物流|快递|几天/.test(agentText)
        ? ['好的，那我等着哈', '能不能今天就发呀']
        : /退|换|售后/.test(agentText)
          ? ['那我怎么操作呢', '好吧，我先去申请']
          : /优惠|券|价格/.test(agentText)
            ? ['好的我拍下', '还有别的优惠吗']
            : ['好的谢谢', '嗯嗯明白了'];
      const pick = guess[Math.floor(Math.random() * guess.length)];
      setTimeout(async () => {
        c.messages.push({ role: 'customer', text: pick, time: this.now() });
        c.lastMsg = pick; c.lastTime = this.now();
        if (this.activeConvId !== c.id) c.unread = (c.unread || 0) + 1;
        this.scrollChatBottom();
        try {
          const r = await fetch('/api/conversations/' + encodeURIComponent(c.id) + '/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: pick, role: 'customer' }),
          });
          /* 服务端即刻触发工作流/AI 回复，回显到对话里 */
          if (r.ok) {
            const j = await r.json().catch(() => ({}));
            if (j.flowRun) {
              this.toast('已触发工作流「' + j.flowRun.flowName + '」（' + j.flowRun.intent + '）', 'ok');
              const f = this.flows.find((x) => x.id === j.flowRun.flowId);
              if (f) f.runs = (f.runs || 0) + 1;
            }
            if (j.aiReply) {
              setTimeout(() => {
                c.messages.push({ role: 'ai', text: j.aiReply.text, time: j.aiReply.time });
                c.lastMsg = j.aiReply.text; c.lastTime = j.aiReply.time;
                c.unread = 0;
                this.scrollChatBottom();
              }, 1200);
            }
          }
        } catch (e) { /* 忽略演示消息落库失败 */ }
      }, 1600 + Math.random() * 1200);
    },

    /* ---------- 账号 / 导航 ---------- */
    logout() {
      fetch('/api/auth/logout', { method: 'POST' }).finally(() => { location.href = '/login'; });
    },
    toAdmin() { location.href = '/admin'; },
    async reloadAll() {
      try {
        const r = await fetch('/api/bootstrap');
        if (r.status === 401) { location.href = '/login'; return; }
        const b = await r.json();
        window.__BOOT__ = b;
        this.conversations = JSON.parse(JSON.stringify(b.conversations || []));
        this.tickets = JSON.parse(JSON.stringify(b.tickets || []));
        this.stores = b.stores || [];
        this.dashboard = b.dashboard || EMPTY_DASH;
        this.knowledge = b.knowledge || [];
        this.quickReplies = b.quickReplies || [];
        this.ai = b.ai || this.ai;
        this.toast('数据已刷新', 'ok');
      } catch (e) {
        this.toast('刷新失败：' + e.message, 'err');
      }
    },

    /* ---------- AI 提示词 ---------- */
    systemPrompt(conv, mode) {
      const st = this.platformOf(conv.storeId);
      const kb = this.knowledge.map((k) => `- ${k.q}：${k.a}`).join('\n');
      const order = conv.order
        ? `当前订单：${conv.order.product}，单号 ${conv.order.no}，金额 ￥${conv.order.amount}，状态「${conv.order.status}」。` +
          (this.ord && this.ord.no === conv.order.no && this.ord.tracking
            ? ` 承运快递：${this.ord.carrier}，运单号 ${this.ord.tracking}。`
            : '')
        : '当前无关联订单。';
      /* 店铺知识（商品资料是 AI 从商品信息里学来的，买家问产地/规格/卖点直接用） */
      const items = this.convKb[conv.storeId] || [];
      const op = conv.order ? String(conv.order.product || '') : '';
      const ranked = items.slice().sort((a, b) => {
        const hit = (x) => (op && String(x.question || '').indexOf(op) >= 0 ? 1 : 0);
        return hit(b) - hit(a);
      });
      const storeKb = ranked.slice(0, 16).map((k) => `- ${k.question}：${String(k.answer || '').slice(0, 800)}`).join('\n');
      if (mode === 'copy') {
        return `你是资深电商文案策划。为「${this.brand.name}」撰写高转化商品文案。输出格式：\n【商品标题】\n【核心卖点】3 条，分点\n【详情文案】一段\n要求真实有感染力，不夸大、不使用"最/第一/绝对"等违规用语。`;
      }
      if (mode === 'aftersales') {
        return `你是资深电商售后专家。针对售后工单输出：\n【处理建议】分点、可执行，符合平台规则；\n【安抚话术】可直接发给顾客、真诚克制。不承诺无法兑现的赔付。`;
      }
      if (mode === 'polish') {
        return `你是电商客服话术润色助手。把用户给出的客服草稿润色得更亲切、专业、简洁，保持原意，只输出润色后的文本，不要解释。`;
      }
      return (
        `你是「${this.brand.name}」电商客服工作台的 AI 客服助手，当前服务店铺「${st.name}」（平台：${st.platform}）。\n` +
        `语气：${this.tone}、专业、简洁，像真人客服。\n` +
        `硬性规则：\n` +
        `1. 不承诺无法兑现的售后与赔付；涉及退款/赔付按平台规则说明，必要时建议转人工核实。\n` +
        `2. 不索取、不复述密码、验证码、身份证、银行卡等敏感信息。\n` +
        `3. 不发送站外链接，不引导私下交易。\n` +
        `4. 回复 2~4 句，口语化，必要时分点；不要输出"客服："之类前缀。\n` +
        `5. 优先依据店铺知识作答，不编造商品参数；规格、产地、材质、价格一律以「商品资料」为准。\n` +
        `店铺知识：\n${kb}\n` +
        (storeKb ? `商品资料（按本商品优先）：\n${storeKb}\n` : '') +
        `${order}`
      );
    },
    historyMessages(conv, limit = 8) {
      const msgs = conv.messages.slice(-limit).map((m) => ({
        role: m.role === 'customer' ? 'user' : 'assistant',
        content: m.text,
      }));
      return msgs;
    },

    /* ---------- SSE 流式核心 ---------- */
    async streamChat({ messages, mode = 'chat', meta = {}, onDelta, signal }) {
      let res;
      try {
        res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages,
            mode,
            meta,
            temperature: this.temperature,
            convId: (mode === 'chat' || mode === 'polish') && this.activeConv ? this.activeConv.id : null,
          }),
          signal,
        });
      } catch (e) {
        this.serverDown = true;
        throw new Error('无法连接后端服务，请确认 server.js 已启动');
      }
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error('服务返回 ' + res.status + (t ? '：' + t.slice(0, 120) : ''));
      }
      this.serverDown = false;
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buf = '';
      let full = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') return full;
            let obj;
            try { obj = JSON.parse(data); } catch (e) { continue; }
            if (obj.error) throw new Error(obj.error);
            if (obj.t) { full += obj.t; onDelta && onDelta(obj.t, full); }
          }
        }
      }
      return full;
    },

    /* ---------- AI 生成回复 ---------- */
    async aiReply() {
      const c = this.activeConv;
      if (!c || this.aiSuggestLoading) return;
      this.aiSuggestLoading = true;
      this.aiSuggest = '';
      this.aiSuggestSource = 'reply';
      await this.loadConvKb(c.storeId);
      const messages = [
        { role: 'system', content: this.systemPrompt(c, 'chat') },
        ...this.historyMessages(c),
      ];
      if (messages[messages.length - 1].role !== 'user') {
        messages.push({ role: 'user', content: '请基于以上对话，生成一条给顾客的回复。' });
      }
      try {
        await this.streamChat({
          messages,
          mode: 'chat',
          meta: { product: c.order?.product, orderNo: c.order?.no, amount: c.order?.amount },
          onDelta: (d, full) => { this.aiSuggest = full; },
        });
      } catch (e) {
        this.toast('AI 生成失败：' + e.message, 'err');
        this.aiSuggest = '';
      } finally {
        this.aiSuggestLoading = false;
      }
    },
    async aiPolish() {
      const c = this.activeConv;
      const src = this.draft.trim();
      if (!src) { this.toast('请先在输入框写点内容，再让 AI 润色', 'warn'); return; }
      if (this.aiSuggestLoading) return;
      this.aiSuggestLoading = true;
      this.aiSuggest = '';
      this.aiSuggestSource = 'polish';
      try {
        await this.streamChat({
          messages: [
            { role: 'system', content: this.systemPrompt(c, 'polish') },
            { role: 'user', content: src },
          ],
          mode: 'polish',
          meta: { text: src },
          onDelta: (d, full) => { this.aiSuggest = full; },
        });
      } catch (e) {
        this.toast('润色失败：' + e.message, 'err');
      } finally {
        this.aiSuggestLoading = false;
      }
    },
    /* ================= 订单卡（会话内真实可用） ================= */
    /** 聊天图片地址：平台 CDN 常做防盗链，统一走服务端代理（白名单域名） */
    chatImg(url) {
      const u = String(url || '').trim();
      if (!u) return '';
      if (!/^https?:\/\//i.test(u)) return u;
      return '/api/img?u=' + encodeURIComponent(u);
    },
    /** 聊天图片加载失败：先退回直连原图，再失败才显示占位（不留空白框） */
    imgBroken(e) {
      const img = e && e.target;
      if (!img) return;
      const orig = img.getAttribute('data-orig');
      if (orig && !img.dataset.retried && img.getAttribute('src') !== orig) {
        img.dataset.retried = '1';
        img.src = orig;
        return;
      }
      img.style.display = 'none';
      const box = img.parentElement;
      if (box && box.classList) box.classList.add('fail');
    },
    /** 按商品名取真实商品图（与后端 lib/product-images.js 保持一致） */
    productImg(name) {
      const n = String(name || '');
      const map = [
        [/苹果|水果|富士|冰糖|果园/, 'apple.png'],
        [/开衫|毛衣|针织|外套|披肩|羊毛/, 'cardigan.png'],
        [/收纳箱|收纳架|收纳|整理箱|置物/, 'storage-box.png'],
        [/折叠凳|凳子|马扎|板凳|凳/, 'stool.png'],
        [/眼罩|真丝|睡眠|丝巾/, 'eye-mask.png'],
        [/运动鞋|跑鞋|休闲鞋|板鞋|老爹鞋|鞋/, 'sneakers.png'],
        [/T恤|短袖|卫衣|衬衫/, 'tshirt-main.png'],
        [/保温杯|水杯|保温壶|杯/, 'thermos-scene.png'],
        [/赠品|礼包|礼物|周边/, 'gift-set.png'],
      ];
      for (const [re, f] of map) if (re.test(n)) return '/uploads/products/' + f;
      return '';
    },
    orderStatusTag(s) {
      return { 待发货: 'tag-orange', 已发货: 'tag-blue', 已签收: 'tag-green', 已完成: 'tag-green' }[s] || 'tag-gray';
    },
    async openOrderDetail(order) {
      const no = (order && order.no) || (this.activeConv && this.activeConv.order ? this.activeConv.order.no : '');
      if (!no) return this.toast('该会话没有关联订单', 'warn');
      this.ordOpen = true;
      this.ordLoading = true;
      try {
        const j = await this.fetchOrderWithRetry(no);
        this.ord = Object.assign({}, this.ord, j.order);
        if (!this.ord.image) this.ord.image = this.productImg(this.ord.product);
      } catch (e) {
        this.toast('订单读取失败：' + (e.message === 'Failed to fetch' ? '网络连接中断（服务可能正在重启），请稍后重试' : e.message), 'err');
        this.ordOpen = false;
      } finally {
        this.ordLoading = false;
      }
    },
    /* 订单详情读取：网络瞬断自动重试一次 */
    async fetchOrderWithRetry(no, tries) {
      tries = tries || 2;
      try {
        return await this.req('/api/orders/' + encodeURIComponent(no));
      } catch (e) {
        if (e.message === 'Failed to fetch' && tries > 1) {
          await new Promise((r) => setTimeout(r, 800));
          return this.fetchOrderWithRetry(no, tries - 1);
        }
        throw e;
      }
    },
    copyOrderNo(no) { this.copyText(no); },
    /* ---------- AI 接管切换：转AI 顶替自动回复 / 转人工停止，可反复切换 ---------- */
    async toAI() {
      const c = this.activeConv;
      if (!c || this.aiSwitching) return;
      this.aiSwitching = true;
      try {
        const j = await this.req('/api/conversations/' + encodeURIComponent(c.id) + '/status', {
          method: 'POST', body: JSON.stringify({ status: 'ai' }),
        });
        c.status = 'ai';
        if (j.aiReply) {
          c.messages.push({ role: 'ai', text: j.aiReply.text, time: j.aiReply.time });
          c.lastMsg = j.aiReply.text; c.lastTime = j.aiReply.time;
          this.scrollChatBottom();
        }
        this.toast('AI 已接管：顾客新消息将由 AI 自动回复', 'ok');
      } catch (e) { this.toast(e.message, 'err'); }
      finally { this.aiSwitching = false; }
    },
    async toHuman() {
      const c = this.activeConv;
      if (!c) return;
      try {
        await this.req('/api/conversations/' + encodeURIComponent(c.id) + '/transfer', { method: 'POST' });
        c.status = 'human';
        this.toast('已转为人工接待，AI 自动回复已停止', 'ok');
      } catch (e) { this.toast(e.message, 'err'); }
    },
    /** 按场景生成一条可直接发送的话术（用真实订单数据，不消耗额度） */
    orderReply(kind, o) {
      const p = o.product || '商品';
      const no = o.no || '';
      if (kind === 'logistics') {
        if (o.status === '待发货') {
          return `亲，您的订单「${p}」（单号 ${no}）已付款成功，我们会在 48 小时内安排发出，发出后第一时间同步运单号给您～`;
        }
        return `亲，您的订单「${p}」（单号 ${no}）已由${o.carrier || '快递'}发出，运单号 ${o.tracking || '—'}，当前状态「${o.status}」，正常 2-3 天送达，物流有异常随时找我～`;
      }
      if (kind === 'ship') {
        if (o.status === '待发货') {
          return `亲，您的订单（${no}）我已经帮您标记加急，今天会优先安排出库，发出后马上同步单号给您～`;
        }
        return `亲，订单 ${no} 已经发出啦，${o.carrier || '快递'}承运，运单号 ${o.tracking || '—'}，我帮您盯着物流，有更新第一时间告诉您～`;
      }
      return `亲，${p} 支持 7 天无理由退换，签收后 7 天内商品及包装完好即可申请；质量问题由我们承担运费。订单 ${no}，您可以在订单页点「申请售后」，我这边同步帮您走流程～`;
    },
    async askOrder(kind) {
      const c = this.activeConv;
      if (!c || !c.order) return this.toast('该会话没有关联订单', 'warn');
      // 先拉一次订单详情，拿到真实承运 / 运单号再生成话术
      if (this.ord.no !== c.order.no) {
        try {
          const j = await this.req('/api/orders/' + encodeURIComponent(c.order.no));
          this.ord = Object.assign({}, this.ord, j.order);
          if (!this.ord.image) this.ord.image = this.productImg(this.ord.product);
        } catch (e) { /* 拉不到详情就用会话内订单数据兜底 */ }
      }
      const merged = Object.assign({}, c.order, this.ord.no === c.order.no ? this.ord : {});
      this.draft = this.orderReply(kind, merged);
      this.$nextTick(() => {
        const ta = this.$refs.composerInput;
        if (ta) { ta.focus(); this.autoGrow(ta); }
      });
      this.toast('已生成回复，可编辑后发送', 'ok');
    },
    async sendOrderCard() {
      const c = this.activeConv;
      if (!c || !c.order) return this.toast('该会话没有关联订单', 'warn');
      const payload = Object.assign({}, c.order, this.ord.no === c.order.no ? { carrier: this.ord.carrier, tracking: this.ord.tracking } : {});
      const time = this.now();
      c.messages.push({ role: 'agent', kind: 'order', payload, text: '[订单卡片]', time });
      c.lastMsg = '[订单卡片]';
      c.lastTime = time;
      c.status = 'human';
      c.unread = 0;
      this.scrollChatBottom();
      try {
        await this.req('/api/conversations/' + encodeURIComponent(c.id) + '/messages', {
          method: 'POST',
          body: JSON.stringify({ role: 'agent', kind: 'order', payload }),
        });
        this.toast('订单卡已发给顾客', 'ok');
      } catch (e) {
        this.toast('发送失败：' + e.message, 'err');
      }
    },

    adoptSuggestion() {
      const convId = this.activeConv ? this.activeConv.id : null;
      this.draft = this.aiSuggest;
      this.aiSuggest = '';
      this.$nextTick(() => {
        const ta = this.$refs.composerInput;
        if (ta) { ta.focus(); this.autoGrow(ta); }
      });
      this.toast('已采纳为草稿，可编辑后发送', 'ok');
      if (convId) {
        fetch('/api/ai/adopt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ convId }),
        }).catch(() => {});
      }
    },
    clearSuggestion() { this.aiSuggest = ''; },
    autoGrow(el) {
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    },

    /* ---------- 售后 AI ---------- */
    async askAdvice() {
      const t = this.activeTicket;
      if (!t || this.adviceLoading) return;
      this.adviceLoading = true;
      this.advice = '';
      const summary =
        `工单类型：${t.typeLabel}\n店铺：${this.platformOf(t.storeId).name}（${this.platformOf(t.storeId).platform}）\n` +
        `订单：${t.orderNo}\n商品：${t.product}\n金额：￥${t.amount}\n顾客诉求：${t.reason}`;
      try {
        await this.streamChat({
          messages: [
            { role: 'system', content: this.systemPrompt({ storeId: t.storeId }, 'aftersales') },
            { role: 'user', content: summary },
          ],
          mode: 'aftersales',
          meta: { reason: t.reason, ticketType: t.typeLabel, orderNo: t.orderNo, amount: t.amount, product: t.product },
          onDelta: (d, full) => { this.advice = full; },
        });
      } catch (e) {
        this.toast('AI 建议生成失败：' + e.message, 'err');
      } finally {
        this.adviceLoading = false;
      }
    },
    async setTicketStatus(status) {
      const t = this.activeTicket;
      if (!t) return;
      const prev = t.status;
      t.status = status;
      t.timeline.push({ time: '今天 ' + this.now(), text: '状态更新为「' + { pending: '待处理', processing: '处理中', done: '已完成' }[status] + '」', actor: this.user.name });
      try {
        const r = await fetch('/api/tickets/' + encodeURIComponent(t.id) + '/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        });
        if (!r.ok) throw new Error((await r.json()).error || '更新失败');
        this.toast('工单状态已更新', 'ok');
        this.refreshPending();
      } catch (e) {
        t.status = prev;
        this.toast('更新失败：' + e.message, 'err');
      }
    },
    refreshPending() {
      fetch('/api/dashboard').then((r) => r.json()).then((d) => {
        if (d.afterSales) this.dashboard.afterSales = d.afterSales;
        if (d.live) this.dashboard.live = d.live;
      }).catch(() => {});
    },
    copyAdvice() {
      if (!this.advice) return;
      navigator.clipboard?.writeText(this.advice).then(
        () => this.toast('已复制到剪贴板', 'ok'),
        () => this.toast('复制失败，请手动选择', 'err')
      );
    },

    /* ---------- 文案生成 ---------- */
    openCopy() { this.copyOpen = true; this.copyResult = ''; },
    async genCopy() {
      const p = this.copyProduct.trim();
      if (!p) { this.toast('请输入商品名称或卖点', 'warn'); return; }
      if (this.copyLoading) return;
      this.copyLoading = true;
      this.copyResult = '';
      try {
        await this.streamChat({
          messages: [
            { role: 'system', content: this.systemPrompt({ storeId: 'tb' }, 'copy') },
            { role: 'user', content: '商品：' + p },
          ],
          mode: 'copy',
          meta: { product: p },
          onDelta: (d, full) => { this.copyResult = full; },
        });
      } catch (e) {
        this.toast('文案生成失败：' + e.message, 'err');
      } finally {
        this.copyLoading = false;
      }
    },

    /* ---------- 设置 / 模型 ---------- */
    presets() {
      return [
        { key: 'deepseek', label: 'DeepSeek', baseURL: 'https://api.deepseek.com', model: 'deepseek-chat' },
        { key: 'qwen', label: '通义千问', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
        { key: 'moonshot', label: 'Kimi', baseURL: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
        { key: 'openai', label: 'OpenAI', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
        { key: 'custom', label: '自定义', baseURL: '', model: '' },
      ];
    },
    applyPreset(p) {
      this.cfgProvider = p.key;
      if (p.key !== 'custom') { this.cfgBaseURL = p.baseURL; this.cfgModel = p.model; }
    },
    async loadConfig() {
      try {
        const r = await fetch('/api/ai/config');
        if (r.status === 401) { location.href = '/login'; return; }
        const j = await r.json();
        Object.assign(this.ai, j);
        this.cfgBaseURL = j.baseURL || this.cfgBaseURL;
        this.cfgModel = j.model || this.cfgModel;
        if (typeof j.temperature === 'number') this.temperature = j.temperature;
        if (typeof j.autoReply === 'boolean') this.autoReply = j.autoReply;
        if (j.tone) this.tone = j.tone;
      } catch (e) { /* 后端未启动 */ }
    },
    async loadModels() {
      try {
        const r = await fetch('/api/ai/models');
        const j = await r.json();
        this.models = j.models || [];
      } catch (e) { this.models = []; }
    },
    async saveConfig() {
      try {
        const r = await fetch('/api/ai/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: this.cfgProvider,
            baseURL: this.cfgBaseURL,
            model: this.cfgModel,
            apiKey: this.cfgKey,
            tone: this.tone,
            temperature: this.temperature,
            autoReply: this.autoReply,
          }),
        });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || '保存失败');
        Object.assign(this.ai, j);
        this.cfgKey = '';
        this.toast(j.demo ? '已保存（未填 Key，仍为演示模式）' : '已保存，AI 已切换为真实模型', 'ok');
        this.loadModels();
      } catch (e) {
        this.toast('保存失败：' + e.message, 'err');
      }
    },
    async testConnection() {
      if (this.cfgTesting) return;
      this.cfgTesting = true;
      this.cfgTestMsg = '';
      this.cfgTestOk = null;
      // 先保存再测
      try {
        await fetch('/api/ai/config', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: this.cfgProvider, baseURL: this.cfgBaseURL, model: this.cfgModel,
            apiKey: this.cfgKey, tone: this.tone, temperature: this.temperature, autoReply: this.autoReply,
          }),
        });
        await this.loadConfig();
        let out = '';
        await this.streamChat({
          messages: [
            { role: 'system', content: '你是测试助手，只回复"连接成功"。' },
            { role: 'user', content: 'ping' },
          ],
          mode: 'chat',
          onDelta: (d, full) => { out = full; },
        });
        this.cfgTestOk = true;
        this.cfgTestMsg = '连接成功：' + (out || '(已返回)').slice(0, 40);
      } catch (e) {
        this.cfgTestOk = false;
        this.cfgTestMsg = '连接失败：' + e.message;
      } finally {
        this.cfgTesting = false;
      }
    },
    clearKey() {
      this.cfgKey = '';
      fetch('/api/ai/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearKey: true }),
      }).then(() => { this.loadConfig(); this.toast('已清除 Key，切换为演示模式', 'warn'); });
    },

    /* ---------- 图表构造（纯 SVG） ---------- */
    buildChart(labels, series, opts = {}) {
      const w = opts.w || 640, h = opts.h || 240;
      const padL = 40, padR = 14, padT = 14, padB = 28;
      const iw = w - padL - padR, ih = h - padT - padB;
      const allVals = series.flatMap((s) => s.data);
      const dataMax = Math.max(...allVals, 1);
      const dataMin = opts.minBase != null ? Math.min(...allVals, opts.minBase) : 0;
      const base = opts.minBase != null ? opts.minBase : 0;
      let top;
      if (opts.step === 1) {
        top = Math.ceil(dataMax + (dataMax - base) * 0.15);
      } else {
        const step = opts.step || 200;
        top = Math.ceil(dataMax / step) * step || step;
      }
      const lo = base;
      const span = Math.max(top - lo, 1);
      const x = (i) => padL + (labels.length === 1 ? iw / 2 : (i * iw) / (labels.length - 1));
      const y = (v) => padT + ih * (1 - (v - lo) / span);
      const gridCount = 4;
      const grid = [];
      for (let i = 0; i <= gridCount; i++) {
        const val = lo + (span * i) / gridCount;
        grid.push({ y: y(val), label: Math.round(val * 10) / 10 });
      }
      const outSeries = series.map((s) => {
        const pts = s.data.map((v, i) => ({ x: x(i), y: y(v), v }));
        const line = pts.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ');
        const bottom = padT + ih;
        const area = line + ` L ${pts[pts.length - 1].x.toFixed(1)} ${bottom} L ${pts[0].x.toFixed(1)} ${bottom} Z`;
        return { ...s, pts, line, area };
      });
      const xLabels = labels.map((l, i) => ({ x: x(i), label: l }));
      return { w, h, padL, padR, padT, padB, iw, ih, grid, xLabels, series: outSeries, top };
    },
    buildDonut(items, size = 168, stroke = 24) {
      const total = items.reduce((a, b) => a + b.value, 0) || 1;
      const r = (size - stroke) / 2;
      const c = 2 * Math.PI * r;
      let offset = 0;
      return items.map((it) => {
        const frac = it.value / total;
        const len = frac * c;
        const seg = { ...it, r, c, len, dash: `${len} ${c - len}`, offset, pct: Math.round(frac * 100) };
        offset += len;
        return seg;
      });
    },
    sparkPath(arr, w = 66, h = 24) {
      const max = Math.max(...arr), min = Math.min(...arr);
      const rng = max - min || 1;
      return arr
        .map((v, i) => {
          const x = (i * w) / (arr.length - 1);
          const y = h - ((v - min) / rng) * (h - 4) - 2;
          return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
        })
        .join(' ');
    },
    donutOffset(seg) { return seg.offset; },

    /* ================= 通用请求 ================= */
    async req(url, opt = {}) {
      // 上传文件用 FormData 时不能手动设 Content-Type，交给浏览器带 boundary
      const headers = (opt.body instanceof FormData) ? {} : { 'Content-Type': 'application/json' };
      const r = await fetch(url, { headers, ...opt });
      if (r.status === 401) { location.href = '/login'; throw new Error('登录已失效'); }
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || 'HTTP ' + r.status);
      return j;
    },

    /* ================= 数据概览 ================= */
    async loadOverview() {
      try {
        const j = await this.req('/api/overview');
        this.overview = {
          stores: j.stores || [],
          kpis: j.kpis || [],
          quota: j.quota || { total: 5000, used: 0, remain: 5000 },
          pendingAlerts: j.pendingAlerts || 0,
          pendingQc: j.pendingQc || 0,
          pendingTickets: j.pendingTickets || 0,
          unreadNotices: j.unreadNotices || 0,
          stats: j.stats || { stores_online: 0, stores_total: 0, today_inbound: 0, today_transfer: 0, conversion: 0, accuracy: 0, trend: { labels: [], values: [] }, top_stores: [], lexicon: { account: 0, store: 0, product: 0, total: 0 }, delta: { inbound: 0, transfer: 0 } },
        };
        this.noticeUnread = j.unreadNotices || 0;
        this.overviewLoaded = true;
      } catch (e) { this.toast('概览加载失败：' + e.message, 'err'); }
    },
    maskAccount(s) {
      const t = String(s || '');
      if (/^1\d{10}$/.test(t)) return t.slice(0, 3) + '****' + t.slice(-4);
      return t;
    },
    kpiBy(key, dft) {
      const k = (this.overview.kpis || []).find((x) => x.key === key || x.label === key);
      return k ? k.value : dft;
    },

    /* ================= 对话质检 ================= */
    async loadQc() {
      try {
        const j = await this.req('/api/qc');
        this.qc = { items: j.items || [], stats: j.stats || this.qc.stats };
        this.qcLoaded = true;
      } catch (e) { this.toast('质检数据加载失败', 'err'); }
    },
    resetQcFilter() {
      this.qcPlatform = '';
      this.qcStoreId = '';
      this.qcStoreKw = '';
      this.qcBuyerKw = '';
      this.qcDate = '';
      this.qcFilter = 'all';
      this.qcPage = 1;
    },
    qcColor(level) {
      return { excellent: '#00B42A', good: '#165DFF', risk: '#F53F3F' }[level] || '#86909C';
    },
    qcBg(level) {
      return { excellent: '#E8FFEA', good: '#EEF3FF', risk: '#FFECE8' }[level] || '#F2F3F5';
    },
    qcLevelText(level) {
      return { excellent: '优秀', good: '合格', risk: '风险' }[level] || level;
    },
    async reviewQc(item) {
      try {
        await this.req('/api/qc/' + encodeURIComponent(item.id) + '/review', { method: 'POST' });
        item.status = 'done';
        this.qc.stats.pending = Math.max(0, this.qc.stats.pending - 1);
        this.toast('已标记复核完成', 'ok');
      } catch (e) { this.toast(e.message, 'err'); }
    },
    async openQcDetail(item) {
      this.qcDetailOpen = true;
      this.qcDetail = {
        loading: true, saving: false, savingKb: false, kbSaved: false,
        review: { id: item.id, customer: item.customer, store_id: item.storeId, agent: item.agent, score: item.score, level: item.level, status: item.status, created_at: item.createdAt, note: '' },
        conv: null, messages: [], star: Math.max(1, Math.round(item.score / 20)),
        kbMode: false, kbForm: { name: item.customer ? ('关于' + item.customer + '的咨询') : '', scope: 'store', content: (item.reply || ''), productId: item.productId || '' },
      };
      try {
        const j = await this.req('/api/qc/' + encodeURIComponent(item.id) + '/detail');
        this.qcDetail.conv = j.conv;
        this.qcDetail.messages = j.messages || [];
        if (j.review) {
          this.qcDetail.review.score = j.review.score;
          this.qcDetail.review.level = j.review.level;
          this.qcDetail.review.status = j.review.status;
          this.qcDetail.review.created_at = j.review.created_at;
          this.qcDetail.star = Math.max(1, Math.round((j.review.score || 0) / 20));
          if (j.review.reply) this.qcDetail.kbForm.content = j.review.reply;
        }
        if (j.conv && j.conv.order_product) this.qcDetail.kbForm.productId = j.conv.order_product;
      } catch (e) { this.toast('详情加载失败：' + e.message, 'err'); }
      finally { this.qcDetail.loading = false; }
    },
    setQcStar(n) {
      this.qcDetail.star = n;
      this.qcDetail.review.score = n * 20;
      this.qcDetail.review.level = n >= 5 ? 'excellent' : n >= 4 ? 'good' : n >= 3 ? 'pass' : 'risk';
    },
    async submitQcReview() {
      if (this.qcDetail.saving) return;
      this.qcDetail.saving = true;
      try {
        const j = await this.req('/api/qc/' + encodeURIComponent(this.qcDetail.review.id) + '/review', {
          method: 'POST',
          body: JSON.stringify({ score: this.qcDetail.review.score, note: this.qcDetail.review.note || '' }),
        });
        this.qcDetail.review.status = 'done';
        if (j.level) this.qcDetail.review.level = j.level;
        const it = this.qc.items.find((x) => x.id === this.qcDetail.review.id);
        if (it) { it.status = 'done'; it.score = this.qcDetail.review.score; it.level = this.qcDetail.review.level; }
        this.toast('质检结果已保存', 'ok');
      } catch (e) { this.toast(e.message, 'err'); }
      finally { this.qcDetail.saving = false; }
    },
    async saveQcKnowledge() {
      if (this.qcDetail.savingKb) return;
      const f = this.qcDetail.kbForm;
      if (!f.name.trim()) return this.toast('请填写知识名称', 'warn');
      if (!f.content.trim()) return this.toast('请填写知识内容', 'warn');
      this.qcDetail.savingKb = true;
      try {
        await this.req('/api/qc/' + encodeURIComponent(this.qcDetail.review.id) + '/to-knowledge', {
          method: 'POST',
          body: JSON.stringify({
            name: f.name, scope: f.scope, content: f.content,
            store_id: this.qcDetail.review.store_id, product_id: f.productId || '',
          }),
        });
        this.qcDetail.kbSaved = true;
        this.toast('已沉淀到知识库', 'ok');
      } catch (e) { this.toast(e.message, 'err'); }
      finally { this.qcDetail.savingKb = false; }
    },

    /* ================= 信息通知 ================= */
    async loadNotices() {
      try {
        const j = await this.req('/api/notifications');
        this.notices = j.items || [];
        this.noticeUnread = j.unread || 0;
        this.noticeLoaded = true;
        await this.loadNotifyGroups();
      } catch (e) { this.toast('通知加载失败', 'err'); }
    },
    noticeStyle(type) {
      return {
        system: ['fa-cog', '#EEF3FF', '#165DFF'],
        alert: ['fa-exclamation-triangle', '#FFECE8', '#F53F3F'],
        billing: ['fa-credit-card', '#FFF7E8', '#FF7D00'],
        update: ['fa-rocket', '#F5EEFF', '#722ED1'],
      }[type] || ['fa-bell', '#F2F3F5', '#86909C'];
    },
    async readNotice(n) {
      if (n.read) return;
      try {
        await this.req('/api/notifications/' + encodeURIComponent(n.id) + '/read', { method: 'POST' });
        n.read = true;
        this.noticeUnread = Math.max(0, this.noticeUnread - 1);
      } catch (e) { /* 忽略 */ }
    },
    async markAllNotices() {
      if (!this.noticeUnread) return this.toast('没有未读通知', 'warn');
      try {
        await this.req('/api/notifications/read-all', { method: 'POST' });
        this.notices.forEach((n) => { n.read = true; });
        this.noticeUnread = 0;
        this.toast('已全部标记为已读', 'ok');
      } catch (e) { this.toast(e.message, 'err'); }
    },

    /* ================= 通知群（三步绑定向导） ================= */
    async loadNotifyGroups() {
      try {
        const j = await this.req('/api/notify-groups');
        this.notifyGroups = j.items || [];
      } catch (e) { /* 忽略 */ }
    },
    ngChannelText(ch) {
      return { wecom: '企业微信 · VX群', dingtalk: '钉钉', feishu: '飞书' }[ch] || ch;
    },
    ngChannelIcon(ch) {
      return { wecom: 'fa-weixin', dingtalk: 'fa-comment', feishu: 'fa-paper-plane' }[ch] || 'fa-bell';
    },
    ngWebhookPlaceholder() {
      if (this.ngChannel === 'wecom') return 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxx';
      if (this.ngChannel === 'dingtalk') return 'https://oapi.dingtalk.com/robot/send?access_token=xxxx';
      return 'https://open.feishu.cn/open-apis/bot/v2/hook/xxxx';
    },
    openNgWizard() {
      this.ngWizardOpen = true;
      this.ngStep = 1; this.ngNewName = ''; this.ngChannel = 'wecom';
      this.ngWebhook = ''; this.ngBindCode = ''; this.ngPendingId = '';
      this.ngTestMsg = ''; this.ngTestOk = false;
    },
    async ngAddBot() {
      if (!this.ngNewName.trim()) return this.toast('请填写群名称', 'warn');
      // 第一步仅收集名称与类型，第二步粘贴 Webhook 后统一创建并测试
      this.ngStep = 2;
      this.ngTestMsg = ''; this.ngTestOk = false;
    },
    async ngTestBind() {
      if (!this.ngNewName.trim()) return this.toast('请先填写群名称', 'warn');
      if (!this.ngWebhook.trim()) return this.toast('请粘贴群机器人 Webhook 地址', 'warn');
      this.ngBusy = true; this.ngTestMsg = ''; this.ngTestOk = false;
      try {
        // 1) 创建通知群（含真实 Webhook 地址）
        const g = await this.req('/api/notify-groups', {
          method: 'POST',
          body: JSON.stringify({ name: this.ngNewName, channel: this.ngChannel, webhook_url: this.ngWebhook }),
        });
        this.ngPendingId = g.id;
        // 2) 真实向群机器人发送测试消息，验证连通
        const j = await this.req('/api/notify-groups/' + encodeURIComponent(g.id) + '/test', { method: 'POST' });
        if (j.ok) {
          this.ngTestOk = true;
          this.ngTestMsg = '连接成功！已向该群发送一条测试消息。';
          this.ngStep = 3;
        } else {
          this.ngTestOk = false;
          this.ngTestMsg = '连接失败：' + (j.error || '未知错误') + '（请检查 Webhook 地址是否正确、群机器人是否开启）';
        }
      } catch (e) {
        this.ngTestOk = false;
        this.ngTestMsg = '连接失败：' + e.message;
      } finally { this.ngBusy = false; }
    },
    ngFinish() {
      this.ngWizardOpen = false;
      this.loadNotifyGroups();
      this.toast('通知群已添加并连通', 'ok');
    },
    async delNg(g) {
      if (!confirm('删除通知群「' + g.name + '」？')) return;
      try {
        await this.req('/api/notify-groups/' + encodeURIComponent(g.id), { method: 'DELETE' });
        this.notifyGroups = this.notifyGroups.filter((x) => x.id !== g.id);
        this.toast('已删除', 'ok');
      } catch (e) { this.toast(e.message, 'err'); }
    },

    /* ================= 店铺信息助手（向导 · 内嵌在「店铺设置」弹窗里） ================= */
    async openWizard() {
      const store = this.cfgStore || (this.stores && this.stores.length ? this.stores[0] : null);
      if (!store) return this.toast('还没有店铺，先创建一家店铺再配置', 'warn');
      this.cfgStore = store;
      this.cfgTab = 'settings';
      this.cfgOpen = true;
      this.cfgWiz = true;
      this.wizardOpen = true;
      this.wizardStep = 1;
      this.wizSel = { shipFrom: false, couriers: false };
      await this.loadCfg(store);
      try {
        const j = await this.req('/api/shop-profile');
        if (j.profile) Object.assign(this.wizardData, j.profile);
      } catch (e) { /* 全新配置，忽略 */ }
    },
    closeWizard() {
      this.cfgWiz = false;
      this.wizardOpen = false;
      this.cfgTab = 'settings';
    },
    async nextWizard() {
      if (!this.wizCanNext) return;
      if (this.wizardStep < this.wizardSteps.length) {
        this.wizardStep++;
        // 进入「完成设置」页时把配置真正落到店铺设置与 AI 知识里
        if (this.wizardStep === this.wizardSteps.length) await this.finishWizard();
      }
    },
    /** 向导结果写回店铺设置：欢迎语 + 物流/售后兜底话术 */
    applyWizardToCfg() {
      const d = this.wizardData;
      if (d.welcome) this.cfg.welcome = d.welcome;
      const add = (s) => { if (s && !this.cfg.transferScripts.includes(s)) this.cfg.transferScripts.push(s); };
      if (d.shipFrom.length || d.couriers.length) {
        add(`物流：从${d.shipFrom.join('、') || '—'}发出，常用${d.couriers.join('、') || '—'}，` +
            `${d.allowSpecify === 'yes' ? '支持' : d.allowSpecify === 'no' ? '不支持' : '未设置'}指定快递。`);
      }
      if (d.shipTime || d.freeShipping) {
        add(`发货：${d.shipTime || '48 小时内'}发出，${d.freeShipping === 'yes' ? '全店包邮' : d.freeShipping === 'no' ? '不包邮' : '包邮政策未设置'}` +
            (d.remoteNote ? `；${d.remoteNote}` : '') + '。');
      }
      if (d.returnWindow || d.quality || d.freight) {
        add(`售后：${d.returnWindow || '7 天'}无理由退换，质量问题${d.quality || '优先处理'}，退货运费${d.freight || '协商处理'}。`);
      }
    },
    /** 向导结果写成店铺知识，AI 回复直接引用（去重，已存在则跳过） */
    async saveWizardKnowledge() {
      const d = this.wizardData;
      const shipFrom = d.shipFrom.join('、') || '—';
      const couriers = d.couriers.join('、') || '—';
      const specify = d.allowSpecify === 'yes' ? '支持' : d.allowSpecify === 'no' ? '不支持' : '暂未设置';
      const rows = [
        {
          type: 'logistics',
          question: '从哪发货？用什么快递？多久发出？',
          answer: `我们从${shipFrom}发出，常用快递：${couriers}；${specify}买家指定快递。下单后${d.shipTime || '48 小时内'}安排发出，` +
                  `${d.freeShipping === 'yes' ? '全店包邮' : d.freeShipping === 'no' ? '不包邮' : '包邮政策以详情页为准'}` +
                  (d.remoteNote ? `。${d.remoteNote}` : '。'),
        },
        {
          type: 'policy',
          question: '退换货和售后怎么处理的？',
          answer: `支持${d.returnWindow || '7 天'}无理由退换（商品及包装需完好）；出现质量问题${d.quality || '优先处理'}，` +
                  `退货运费${d.freight || '协商处理'}。${d.remoteNote || ''}`,
        },
      ];
      if (!this.storeKb.length) {
        try { await this.loadStoreKb(); } catch (e) { /* 读不到就按新增处理 */ }
      }
      for (const r of rows) {
        if (this.storeKb.some((k) => k.question === r.question)) continue;
        try {
          const j = await this.req('/api/stores/' + encodeURIComponent(this.cfgStore.id) + '/knowledge', {
            method: 'POST', body: JSON.stringify(r),
          });
          // 新增知识默认关闭，这里自动启用，保证 AI 能直接用上
          if (j && j.id) {
            await this.req('/api/store-knowledge/' + encodeURIComponent(j.id) + '/toggle', { method: 'POST', body: '{}' });
          }
        } catch (e) { /* 单条失败不影响整体 */ }
      }
    },
    async finishWizard() {
      const d = this.wizardData;
      this.applyWizardToCfg();
      try {
        await this.req('/api/shop-profile', { method: 'PUT', body: JSON.stringify({ ...d, step: this.wizardStep }) });
      } catch (e) {
        this.toast('店铺档案保存失败：' + e.message, 'err');
      }
      if (this.cfgStore) {
        try {
          await this.req('/api/stores/' + encodeURIComponent(this.cfgStore.id) + '/settings', {
            method: 'PUT', body: JSON.stringify(this.cfg),
          });
          await this.saveWizardKnowledge();
          this.toast('设置完成，已写入店铺设置并同步给 AI 知识', 'ok');
        } catch (e) {
          this.toast('店铺设置保存失败：' + e.message, 'err');
        }
      }
    },
    prevWizard() {
      if (this.wizardStep > 1) this.wizardStep--;
    },
    toggleWiz(group, val) {
      const arr = this.wizardData[group];
      const i = arr.indexOf(val);
      if (i >= 0) arr.splice(i, 1); else arr.push(val);
    },
    addWizCustom(group, e) {
      const v = e.target.value.trim();
      if (v && !this.wizardData[group].includes(v)) this.wizardData[group].push(v);
      e.target.value = '';
    },

    /* ================= 素材中心 ================= */
    async loadMaterials() {
      try {
        const j = await this.req('/api/materials');
        this.materials = j.items || [];
        this.matLoaded = true;
      } catch (e) { this.toast('素材加载失败', 'err'); }
    },
    matIcon(type) {
      return { image: 'fa-file-image-o', video: 'fa-file-video-o', doc: 'fa-file-text-o', text: 'fa-file-code-o' }[type] || 'fa-file-o';
    },
    matTypeText(type) {
      return { image: '图片', video: '视频', doc: '文档', text: '文案' }[type] || type;
    },
    materialById(id) {
      return this.materials.find((m) => m.id === id) || { name: '已删除素材', content: '' };
    },
    /* 点击素材卡打开预览：图片大图 / 视频播放 / pdf iframe / txt·doc 渲染成可读页 */
    async previewMaterial(m) {
      if (!m) return;
      if (typeof m === 'string') m = { id: m };
      /* 只传 id（深链场景）：先查本地，缺失则拉取素材列表 */
      if (m && !m.name) {
        let found = this.materialById(m.id);
        if (!found || found.name === '已删除素材' || (!found.content && !found.poster)) {
          await this.loadMaterials();
          found = this.materialById(m.id);
        }
        if (!found || found.name === '已删除素材') return this.toast('素材不存在或已删除', 'warn');
        m = found;
      }
      const bust = Date.now();
      let url = m.content || '';
      if (m.type === 'doc' || m.type === 'text') {
        if (!url) return this.toast('该素材没有关联文件', 'warn');
        url = '/api/materials/' + encodeURIComponent(m.id) + '/preview?_=' + bust;
      } else if (!url) {
        return this.toast('该素材没有可预览的文件', 'warn');
      }
      this.matView = Object.assign({}, m, { viewUrl: url });
    },
    closeMatView() {
      this.matView = null;
    },
    /* 通用图片放大层：店铺详情商品图 / 订单详情缩略图 / 消息订单卡均可点击放大 */
    zoomImage(url) {
      if (!url) return this.toast('该商品暂无图片', 'warn');
      this.zoomUrl = url;
    },
    closeZoom() {
      this.zoomUrl = '';
    },
    openMat() {
      this.matForm = { name: '', type: 'image', tag: '商品图', size: '1.0 MB', file: null, fileName: '', fileData: '' };
      this.matOpen = true;
    },
    onMatFile(e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      this.matForm.file = file;
      this.matForm.fileName = file.name;
      this.matForm.size = file.size < 1024 ? file.size + ' B' : file.size < 1048576 ? Math.round(file.size / 1024) + ' KB' : (file.size / 1048576).toFixed(2) + ' MB';
      if (!this.matForm.name) this.matForm.name = file.name.replace(/\.[^.]+$/, '');
      const t = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video'
        : (file.type === 'application/pdf' || /\.(docx?|xlsx?|pptx?|pdf|txt|csv)$/i.test(file.name)) ? 'doc' : 'text';
      this.matForm.type = t;
    },
    async addMaterial() {
      const f = this.matForm;
      if (!f.name.trim()) return this.toast('请填写素材名称', 'warn');
      try {
        // 真实文件用 multipart/form-data 上传，绕开 JSON 体积上限
        const fd = new FormData();
        fd.append('name', f.name);
        fd.append('type', f.type);
        fd.append('tag', f.tag || '未分类');
        if (f.file) fd.append('file', f.file, f.file.name);
        else if (f.type === 'text' && f.content) fd.append('content', f.content);
        const j = await this.req('/api/materials', { method: 'POST', body: fd });
        this.materials.unshift(j.item);
        this.matOpen = false;
        this.toast('素材已上传入库' + (j.item.content ? '（真实文件已保存）' : '（仅登记元信息）'), 'ok');
      } catch (e) { this.toast(e.message, 'err'); }
    },
    async delMaterial(m) {
      if (!confirm('确定删除素材「' + m.name + '」？')) return;
      try {
        await this.req('/api/materials/' + encodeURIComponent(m.id), { method: 'DELETE' });
        this.materials = this.materials.filter((x) => x.id !== m.id);
        this.toast('已删除', 'ok');
      } catch (e) { this.toast(e.message, 'err'); }
    },

    /* ================= 对话预警 ================= */
    async loadAlerts() {
      try {
        const j = await this.req('/api/alerts');
        this.alerts = j.items || [];
        this.alertStats = j.stats || this.alertStats;
        this.alertLoaded = true;
      } catch (e) { this.toast('预警加载失败', 'err'); }
    },
    alertIcon(type) {
      return {
        情绪激动: 'fa-fire', 退款风险: 'fa-undo', 超时未回复: 'fa-clock-o',
        敏感词: 'fa-shield', 催发货: 'fa-truck',
      }[type] || 'fa-bell';
    },
    alertColor(level) {
      return { high: '#F53F3F', mid: '#FF7D00', low: '#86909C' }[level] || '#86909C';
    },
    async handleAlert(a) {
      try {
        await this.req('/api/alerts/' + encodeURIComponent(a.id) + '/handle', { method: 'POST' });
        a.handled = true;
        this.alertStats.pending = Math.max(0, this.alertStats.pending - 1);
        this.alertStats.handled += 1;
        this.toast('预警已处理', 'ok');
      } catch (e) { this.toast(e.message, 'err'); }
    },
    gotoConvOf(a) {
      const c = this.conversations.find((x) => x.name === a.customer);
      this.route = 'inbox';
      if (c) this.openConv(c);
      else this.toast('该顾客的会话已结束，可在会话聚合中搜索', 'warn');
    },

    /* ================= AI Agent 工作流 ================= */
    async openFlowRuns(f) {
      this.flowRunsFlow = f;
      this.flowRunsOpen = true;
      this.flowRunsLoading = true;
      try {
        const j = await this.req('/api/flows/' + encodeURIComponent(f.id) + '/runs');
        this.flowRuns = j.items || [];
      } catch (e) { this.toast('运行记录加载失败', 'err'); }
      finally { this.flowRunsLoading = false; }
    },
    async loadFlows() {
      try {
        const j = await this.req('/api/flows');
        this.flows = j.items || [];
        this.flowLoaded = true;
        if (!this.flowActive && this.flows.length) this.flowActive = this.flows[0].id;
        try {
          const saved = JSON.parse(localStorage.getItem('xm_flow_pos') || '{}');
          if (saved && typeof saved === 'object') this.flowPos = saved;
        } catch (e) { /* ignore */ }
      } catch (e) { this.toast('工作流加载失败', 'err'); }
    },
    async toggleFlow(f) {
      try {
        const j = await this.req('/api/flows/' + encodeURIComponent(f.id) + '/toggle', { method: 'POST' });
        f.enabled = j.enabled;
        this.toast(f.name + (f.enabled ? ' 已启用' : ' 已停用'), f.enabled ? 'ok' : 'warn');
      } catch (e) { this.toast(e.message, 'err'); }
    },
    stepClass(type) {
      return { ai: 'ai', action: 'action' }[type] || '';
    },
    stepLabel(type) {
      return { trigger: '触发', ai: 'AI', action: '执行', branch: '判断' }[type] || type;
    },
    flowTriggerText(t) {
      return { message: '消息触发', order: '订单触发', schedule: '定时任务', event: '事件触发' }[t] || t;
    },
    /* ---------- 工作流画布交互 ---------- */
    flowSelect(f) {
      this.flowActive = f.id;
      this.flowExpand = null;
    },
    flowNodeKind(kind) {
      return { trigger: '触发器', step: '执行节点', end: '结束' }[kind] || kind;
    },
    flowNodeIcon(n) {
      if (n.kind === 'trigger') return { message: 'fa-comments-o', order: 'fa-shopping-cart', schedule: 'fa-clock-o', event: 'fa-bolt' }[this.flowCurrent.triggerType] || 'fa-crosshairs';
      if (n.kind === 'end') return 'fa-flag-checkered';
      return { ai: 'fa-magic', action: 'fa-cogs', branch: 'fa-code-fork' }[n.type] || 'fa-cube';
    },
    flowStartDrag(n, ev) {
      if (!ev || ev.button !== 0) return;
      this.flowDrag = { key: n.key, startX: ev.clientX, startY: ev.clientY, ox: n.x, oy: n.y };
      const move = (e) => this.flowMove(e);
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        this.flowEndDrag();
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    flowMove(e) {
      const d = this.flowDrag;
      if (!d) return;
      const x = Math.max(0, d.ox + (e.clientX - d.startX));
      const y = Math.max(0, d.oy + (e.clientY - d.startY));
      this.flowPos[d.key] = { x, y };
    },
    flowEndDrag() {
      if (!this.flowDrag) return;
      this.flowDrag = null;
      try { localStorage.setItem('xm_flow_pos', JSON.stringify(this.flowPos)); } catch (e) { /* ignore */ }
    },
    resetFlowLayout() {
      this.flowPos = {};
      try { localStorage.removeItem('xm_flow_pos'); } catch (e) { /* ignore */ }
      this.toast('已恢复默认布局', 'ok');
    },

    /* ================= 店铺管理（真实平台接入） ================= */
    platformColor(p) { return PLATFORM_COLOR[p] || '#165DFF'; },

    async loadConnectors() {
      try {
        const j = await this.req('/api/connectors');
        this.connectorList = j.platforms || [];
      } catch (e) { /* 保持默认 */ }
    },

    async loadPlatforms() {
      if (this.platformList.length) return;
      try {
        const j = await this.req('/api/platforms');
        this.platformList = j.platforms || [];
      } catch (e) { /* ignore */ }
    },

    openStore() {
      this.storeStep = 'web';
      this.storeTest = null;
      this.storeAuthorizeUrl = '';
      this.pickedKey = '';
      this.pickedPlatform = null;
      this.webForm = { name: '', account: '' };
      this.storeForm = { name: '', platform: '淘宝', appKey: '', appSecret: '', env: 'prod', color: '#FF5000' };
      this.storeOpen = true;
      this.loadPlatforms();
      this.loadConnectors();
    },

    /* iframe 加载失败检测：内嵌浏览器无法访问外网或被平台禁止嵌入时，
       4 秒后仍无成功加载则显示「在系统浏览器打开」兜底，避免直接裸露「拒绝连接」错误页 */
    checkWebFrame() {
      this.webFrameLoaded = false;
      this.webFrameFailed = false;
      clearTimeout(this._wf);
      this._wf = setTimeout(() => { if (!this.webFrameLoaded) this.webFrameFailed = true; }, 4000);
    },
    onWebFrameLoad() { this.webFrameLoaded = true; },
    onWebFrameError() { clearTimeout(this._wf); this.webFrameFailed = true; },
    retryWebFrame() { this.checkWebFrame(); },
    checkWsFrame() {
      if (!this.wsUrl) { this.wsFrameFailed = false; return; }
      this.wsFrameLoaded = false;
      this.wsFrameFailed = false;
      clearTimeout(this._wsf);
      this._wsf = setTimeout(() => { if (!this.wsFrameLoaded) this.wsFrameFailed = true; }, 4000);
    },
    onWsFrameLoad() { this.wsFrameLoaded = true; },
    onWsFrameError() { clearTimeout(this._wsf); this.wsFrameFailed = true; },
    retryWsFrame() { this.checkWsFrame(); },

    /* ---------- 店铺管理：表格 + 详情 + 编辑商品 ---------- */
    async loadStoreList() {
      try {
        const j = await this.req('/api/stores?platform=' + encodeURIComponent(this.storeFilterPlatform || '') + '&q=' + encodeURIComponent(this.storeFilterQ || ''));
        this.storeList = j.stores || [];
        this.storePlatforms = j.platforms || [];
        this.storePage = 1;
      } catch (e) { /* ignore */ }
    },
    openStoreInfo(s) {
      this.storeInfo = { store: s, stats: { items: 0, knowledge: 0, receives: 0, transfers: 0, messages: 0 }, items: [] };
      this.prodQ = '';
      this.prodPage = 1;
      this.storeInfoOpen = true;
      this.storeInfoLoading = true;
      this.req('/api/stores/' + encodeURIComponent(s.id) + '/detail')
        .then((j) => { if (j && j.store) this.storeInfo = j; })
        .catch(() => {})
        .then(() => { this.storeInfoLoading = false; });
    },
    async reloadStoreInfo() {
      const st = this.storeInfo && this.storeInfo.store;
      if (!st || !st.id) return;
      try {
        const j = await this.req('/api/stores/' + encodeURIComponent(st.id) + '/detail');
        if (j && j.store) this.storeInfo = j;
      } catch (e) { /* ignore */ }
    },
    /* 编辑店铺基础信息：名称 / 平台 / 绑定账号 / 接待状态 */
    openStoreEdit(s) {
      this.storeEditForm = {
        id: s.id, name: s.name, platform: s.platform,
        account: s.account || '', status: s.status || 'active',
      };
      this.storeEditOpen = true;
    },
    async saveStoreEdit() {
      const f = this.storeEditForm;
      if (!f.name.trim()) return this.toast('店铺名称不能为空', 'warn');
      this.storeEditSaving = true;
      try {
        await this.req('/api/stores/' + encodeURIComponent(f.id), {
          method: 'PUT',
          body: JSON.stringify({ name: f.name.trim(), platform: f.platform, account: f.account, status: f.status }),
        });
        this.storeEditOpen = false;
        this.toast('店铺信息已保存', 'ok');
        await this.loadStoreList();
        if (this.storeInfoOpen) await this.reloadStoreInfo();
      } catch (e) {
        this.toast(e.message, 'err');
      } finally {
        this.storeEditSaving = false;
      }
    },
    openEditItem(it) {
      this.editItem = {
        num_iid: it.num_iid, title: it.title,
        description: it.description || '', specs: it.specs || '', attrs: it.attrs || '',
        pic_url: it.pic_url || '', price: it.price || '', learn: true, kbCount: it.kb_count || 0,
      };
      this.editItemOpen = true;
    },
    async saveEditItem() {
      this.editItemSaving = true;
      try {
        const j = await this.req('/api/shop-items/' + encodeURIComponent(this.editItem.num_iid), {
          method: 'PUT',
          body: JSON.stringify({
            title: this.editItem.title,
            description: this.editItem.description,
            specs: this.editItem.specs,
            attrs: this.editItem.attrs,
            learn: this.editItem.learn,
          }),
        });
        this.editItemOpen = false;
        this.toast(this.editItem.learn
          ? `已保存，AI 从商品资料学到 ${j.learned || 0} 条知识`
          : '商品参数已保存', 'ok');
        if (this.storeInfoOpen) await this.reloadStoreInfo();
        this.loadStoreList();
      } catch (e) {
        this.toast(e.message, 'err');
      } finally {
        this.editItemSaving = false;
      }
    },
    /* 单个商品立即让 AI 学习 */
    async learnItem(it) {
      try {
        const j = await this.req('/api/shop-items/' + encodeURIComponent(it.num_iid) + '/learn', { method: 'POST', body: '{}' });
        this.toast(j.message || '已学习', 'ok');
        await this.reloadStoreInfo();
        this.loadStoreList();
      } catch (e) {
        this.toast(e.message, 'err');
      }
    },
    openNewItem() {
      this.newItem = { title: '', num_iid: '', price: '', pic_url: '', description: '', specs: '', attrs: '' };
      this.newItemOpen = true;
    },
    async saveNewItem() {
      const st = this.storeInfo && this.storeInfo.store;
      if (!st || !st.id) return;
      if (!this.newItem.title.trim()) return this.toast('商品名称必填', 'warn');
      this.newItemSaving = true;
      try {
        const j = await this.req('/api/stores/' + encodeURIComponent(st.id) + '/items', {
          method: 'POST', body: JSON.stringify(this.newItem),
        });
        this.newItemOpen = false;
        this.toast(`已新增商品，AI 学到 ${j.learned || 0} 条知识`, 'ok');
        await this.reloadStoreInfo();
        this.loadStoreList();
      } catch (e) {
        this.toast(e.message, 'err');
      } finally {
        this.newItemSaving = false;
      }
    },

    pickPlatform(p) {
      this.pickedKey = p.key;
      this.pickedPlatform = p;
      this.storeStep = 'web';
      this.webForm = { name: '', account: '' };
      this.storeForm.platform = p.name;
      this.storeForm.color = p.color;
      this.storeTest = null;
      if (p.embed === false) {
        clearTimeout(this._wf);
        this.webFrameFailed = false;
      } else {
        this.checkWebFrame();
      }
    },

    /* 网页登录登记（不产生假数据，明确标注未接 API） */
    async saveWebStore() {
      const p = this.pickedPlatform;
      if (!p) return;
      this.storeSaving = true;
      try {
        const j = await this.req('/api/stores', {
          method: 'POST',
          body: JSON.stringify({
            mode: 'web', platform: p.name,
            name: this.webForm.name, account: this.webForm.account,
            proxyIp: this.pickProxy,
          }),
        });
        this.storeOpen = false;
        this.toast('店铺已添加' + (p.api ? '' : '（仅网页登录，未接 API）'), 'ok');
        if (j.note) setTimeout(() => this.toast(j.note, 'warn'), 600);
        await this.loadOverview();
        this.loadStoreList();
        // 添加完成后直接进入店铺工作区，登录后即可看到与“外部正常登录”一致的商家后台
        if (j && j.id) this.openWorkspace({ id: j.id, platform: p.name, name: this.webForm.name || p.name });
      } catch (e) {
        this.toast(e.message, 'err');
      } finally {
        this.storeSaving = false;
      }
    },

    /* ---------- 子账号权限 ---------- */
    canSee(mod) {
      if (!this.user) return false;
      if (this.user.role === 'admin') return true;
      const p = this.user.permissions;
      const mods = p && Array.isArray(p.modules) ? p.modules : PERM_MODULE_KEYS;
      return mods.indexOf(mod) >= 0;
    },
    permSummary(m) {
      if (m.role === 'admin') return '全部权限';
      const p = m.permissions;
      const n = p && Array.isArray(p.modules) ? p.modules.length : PERM_MODULE_KEYS.length;
      const mode = (p && p.ops) ? '可操作' : '只读';
      const pn = (p && p.platforms && p.platforms.length) || 0;
      return mode + ' · ' + n + ' 个模块' + (p && p.ops ? ' · 可添加 ' + pn + ' 个平台' : '');
    },
    togglePermModule(key) {
      const m = this.memberOpen;
      if (!m) return;
      const arr = m.form.permissions.modules;
      const i = arr.indexOf(key);
      if (i >= 0) arr.splice(i, 1); else arr.push(key);
    },
    setAllPermModules(on) {
      const m = this.memberOpen;
      if (!m) return;
      m.form.permissions.modules = on ? PERM_MODULE_KEYS.slice() : [];
    },
    togglePermPlatform(key) {
      const m = this.memberOpen;
      if (!m) return;
      if (!m.form.permissions.platforms) m.form.permissions.platforms = [];
      const arr = m.form.permissions.platforms;
      const i = arr.indexOf(key);
      if (i >= 0) arr.splice(i, 1); else arr.push(key);
    },
    setAllPermPlatforms(on) {
      const m = this.memberOpen;
      if (!m) return;
      m.form.permissions.platforms = on ? PERM_PLATFORM_META.map((x) => x.key) : [];
    },
    /* 平台名 → key（与后端 permissions.platforms 的 key 对齐） */
    platKeyOf(name) {
      if (!name) return '';
      const m = {
        '淘宝': 'taobao', '天猫': 'tmall', '京东': 'jd', '拼多多': 'pdd',
        '抖音飞鸽': 'douyin', '抖音': 'douyin', '快手': 'kuaishou',
        '小红书': 'xhs', '视频号': 'channels', '微信小店': 'channels',
        '小时达': 'hours', '淘工厂': 'taofactory',
      };
      return m[name] || String(name).toLowerCase();
    },
    /* 当前用户能否管理某店铺：管理员=全部；子账号需「可操作」且该店铺平台在授权列表 */
    canManageStore(s) {
      if (this.isPermAdmin) return true;
      const p = this.user && this.user.permissions;
      if (!p || !p.ops) return false;
      const allowed = p.platforms || [];
      return allowed.indexOf(this.platKeyOf(s && s.platform)) >= 0;
    },

    /* ---------- 店铺工作区（内置浏览器） ---------- */
    openWorkspace(s) {
      this.route = 'workspace';
      this.storeOpen = false;
      this.selectWsStore(s);
    },

    async selectWsStore(s) {
      if (!s) return;
      this.wsStoreId = s.id;
      if (!this.platformList.length) await this.loadPlatforms();
      const p = this.platformForStore(s);
      const authed = Boolean(s.integration && s.integration.authorized);
      // 登录后默认进入商家后台（商品/订单都在这里），未登录时商家后台会自动跳到登录页，
      // 登录成功后再跳回后台——和“从外面正常登录”的体验一致，可在内嵌浏览器里点击商品等操作
      const url = p ? (p.backend_url || p.login_url) : '';
      this.wsCurrentStore = s;
      // 平台明确禁止被内嵌（frame-ancestors）：直接给「独立窗口」，不再让用户看「拒绝连接」
      if (p && p.embed === false) {
        this.wsBlocked = true;
        this.wsBlockedUrl = url;
        this.wsBlockedName = p.name;
        this.wsBlockedNote = p.embed_note || '';
        this.wsUrl = '';
        this.wsHistory = url ? [url] : [];
        this.wsIndex = url ? 0 : -1;
        clearTimeout(this._wsf);
        this.wsFrameFailed = false;
        return;
      }
      this.wsBlocked = false;
      this.wsBlockedUrl = '';
      this.wsHistory = url ? [url] : [];
      this.wsIndex = url ? 0 : -1;
      this.wsUrl = url;
      this.checkWsFrame();
    },
    /** 用独立浏览器窗口打开：共享本机浏览器会话，登录态能保留，可正常点商品等操作 */
    openExternalWin(url) {
      const u = url || this.wsBlockedUrl || this.wsUrl;
      if (!u) return this.toast('没有可打开的地址', 'warn');
      const w = Math.min(1500, Math.max(1100, window.screen.availWidth - 120));
      const h = Math.min(980, Math.max(720, window.screen.availHeight - 90));
      const win = window.open(u, 'xm_seller_' + Date.now(),
        `width=${w},height=${h},left=${Math.max(0, (window.screen.availWidth - w) / 2)},top=${Math.max(0, (window.screen.availHeight - h) / 2)},menubar=no,toolbar=no,location=yes,status=no,resizable=yes,scrollbars=yes`);
      if (!win) this.toast('浏览器拦截了新窗口，请允许弹出窗口后重试', 'warn');
    },
    copyWsUrl() {
      this.copyUrl(this.wsBlockedUrl || this.wsUrl);
    },
    copyUrl(u) {
      if (!u) return this.toast('没有可复制的地址', 'warn');
      if (navigator.clipboard) navigator.clipboard.writeText(u).then(() => this.toast('地址已复制', 'ok'), () => this.toast('复制失败', 'warn'));
      else this.toast('地址：' + u, 'warn');
    },

    wsGo(url, reset) {
      if (!url) return;
      if (reset) {
        this.wsHistory = [url];
        this.wsIndex = 0;
      } else {
        this.wsHistory = this.wsHistory.slice(0, this.wsIndex + 1);
        this.wsHistory.push(url);
        this.wsIndex = this.wsHistory.length - 1;
      }
      this.wsUrl = url;
      this.checkWsFrame();
    },

    wsBack() {
      if (this.wsIndex <= 0) return;
      this.wsIndex -= 1;
      this.wsUrl = this.wsHistory[this.wsIndex];
      this.checkWsFrame();
    },

    wsForward() {
      if (this.wsIndex >= this.wsHistory.length - 1) return;
      this.wsIndex += 1;
      this.wsUrl = this.wsHistory[this.wsIndex];
      this.checkWsFrame();
    },

    wsReload() {
      if (!this.wsUrl) return;
      const u = this.wsUrl;
      this.wsUrl = '';
      this.$nextTick(() => { this.wsUrl = u; this.checkWsFrame(); });
    },

    wsStatusText(s) {
      if (!s.integration) return s.status === 'active' ? '登录中' : '未登录';
      if (s.integration.auth_status === 'error') return '接入异常';
      if (s.integration.authorized) return '登录中';
      return '未登录';
    },
    wsStatusClass(s) {
      const t = this.wsStatusText(s);
      return t === '登录中' ? 'ok' : (t === '接入异常' ? 'bad' : 'warn');
    },
    wsTime(s) {
      const t = s.integration && s.integration.last_sync_at;
      return t ? this.fmtTime(t) : '';
    },

    openCfgFromWs(tab) {
      const s = (this.overviewStores || []).find((x) => x.id === this.wsStoreId);
      if (!s) return this.toast('先选择一个店铺', 'warn');
      this.ctx = { show: false, x: 0, y: 0, store: s };
      this.openCfg(tab);
    },

    /* ---------- 右键菜单 ---------- */
    openStoreMenu(s, e) {      const menuW = 168, menuH = 232;
      const x = Math.min(e.clientX, window.innerWidth - menuW - 8);
      const y = Math.min(e.clientY, window.innerHeight - menuH - 8);
      this.ctx = { show: true, x: Math.max(8, x), y: Math.max(8, y), store: s };
    },

    platformForStore(s) {
      if (!s) return null;
      const n = String(s.platform || '');
      return this.platformList.find((p) => n.indexOf(p.name) >= 0 || p.name.indexOf(n) >= 0) || null;
    },

    /* 概览页：直接打开该店铺对应的平台官方后台 */
    openBackendOf(s) {
      const p = this.platformForStore(s);
      if (!p || !p.backend_url) return this.toast('没有找到该平台的商家后台地址', 'warn');
      window.open(p.backend_url, '_blank', 'noopener');
    },

    /* 概览页「店铺词库 / 商品词库」：直接跳到首个店铺的知识面板 */
    async openStoreKbFirst() {
      const s = this.overviewStores[0];
      if (!s) return this.toast('还没有接入店铺', 'warn');
      this.cfgStore = s;
      this.ctx = { show: false, x: 0, y: 0, store: s };
      await this.openCfg('knowledge');
    },

    openBackend() {
      const s = this.ctx.store;
      this.ctx.show = false;
      const p = this.platformForStore(s);
      if (!p || !p.backend_url) return this.toast('没有找到该平台的商家后台地址', 'warn');
      window.open(p.backend_url, '_blank', 'noopener');
    },

    /* ---------- 配置面板 ---------- */
    closeCfg() {
      this.cfgOpen = false;
      this.cfgWiz = false;
      this.wizardOpen = false;
    },
    async openCfg(tab) {
      const s = this.ctx.store;
      this.ctx.show = false;
      if (!s) return;
      this.cfgStore = s;
      this.cfgTab = tab;
      this.cfgOpen = true;
      await this.loadPlatforms();
      if (tab === 'knowledge' || tab === 'import') this.loadStoreKb();
      if (tab === 'basic' || tab === 'settings') await this.loadCfg(s);
      if (tab === 'settings') await this.loadNotifyRules(s);
    },

    /* ---------- 店铺设置：通知群规则 ---------- */
    async loadNotifyRules(s) {
      const st = s || this.cfgStore;
      if (!st) return;
      this.cfgRulesLoading = true;
      try {
        const j = await this.req('/api/stores/' + encodeURIComponent(st.id) + '/notify-rules');
        this.cfgRules = (j.rules || []).map((r) => ({
          group_name: r.group_name || '',
          keywords: Array.isArray(r.keywords) ? r.keywords.slice() : [],
        }));
        this.cfgGroups = j.groups || [];
        this.cfgStats = j.stats || null;
        if (!this.cfgRules.length) this.cfgRules.push({ group_name: '', keywords: [] });
      } catch (e) {
        this.toast('通知群规则加载失败：' + e.message, 'err');
      } finally { this.cfgRulesLoading = false; }
    },
    addRule() { this.cfgRules.push({ group_name: '', keywords: [] }); },
    delRule(i) { this.cfgRules.splice(i, 1); },
    moveRule(i, d) {
      const j = i + d;
      if (j < 0 || j >= this.cfgRules.length) return;
      const arr = this.cfgRules;
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    },
    addRuleKw(r) {
      const v = (this.nrKwInput || '').trim();
      if (!v) return;
      if (!r.keywords.includes(v)) r.keywords.push(v);
      this.nrKwInput = '';
    },
    delRuleKw(r, k) { r.keywords.splice(r.keywords.indexOf(k), 1); },
    async saveNotifyRules() {
      const s = this.cfgStore;
      if (!s) return;
      const rules = this.cfgRules
        .filter((r) => r.group_name || r.keywords.length)
        .map((r) => ({ group_name: r.group_name, keywords: r.keywords }));
      try {
        const j = await this.req('/api/stores/' + encodeURIComponent(s.id) + '/notify-rules', {
          method: 'PUT', body: JSON.stringify({ rules }),
        });
        this.cfgRules = (j.rules || []).map((r) => ({ group_name: r.group_name, keywords: r.keywords || [] }));
        if (!this.cfgRules.length) this.cfgRules.push({ group_name: '', keywords: [] });
        this.toast('通知群规则已保存', 'ok');
      } catch (e) { this.toast(e.message, 'err'); }
    },
    async refreshNotifyGroups() {
      const s = this.cfgStore;
      if (!s) return;
      await this.loadNotifyGroups();
      await this.loadNotifyRules(s);
      this.toast('群列表已刷新', 'ok');
    },
    async resetNotifyGroups() {
      if (!confirm('重置后本店铺所有通知群规则会被清空，确定？')) return;
      const s = this.cfgStore;
      if (!s) return;
      try {
        await this.req('/api/stores/' + encodeURIComponent(s.id) + '/notify-rules', {
          method: 'PUT', body: JSON.stringify({ rules: [] }),
        });
        this.cfgRules = [{ group_name: '', keywords: [] }];
        this.toast('已重置通知群', 'ok');
      } catch (e) { this.toast(e.message, 'err'); }
    },
    async addNgFromCfg() {
      const name = (this.nrNewGroupName || '').trim();
      if (!name) return this.toast('请填写群名称', 'warn');
      try {
        const g = await this.req('/api/notify-groups', { method: 'POST', body: JSON.stringify({ name, channel: 'wecom' }) });
        this.cfgGroups.push({ id: g.id, name: g.name });
        this.nrNewGroupName = '';
        this.toast('通知群已添加', 'ok');
      } catch (e) { this.toast(e.message, 'err'); }
    },
    async resetStoreStats() {
      const s = this.cfgStore;
      if (!s) return;
      if (!confirm('清空「' + s.name + '」的统计信息（转接次数、接待人数等）？历史对话不会被删除。')) return;
      try {
        const j = await this.req('/api/stores/' + encodeURIComponent(s.id) + '/reset-stats', { method: 'POST' });
        this.cfgStats = j.stats || null;
        this.toast('统计信息已清空', 'ok');
      } catch (e) { this.toast(e.message, 'err'); }
    },

    async loadCfg(s) {
      try {
        const j = await this.req('/api/stores/' + encodeURIComponent(s.id) + '/settings');
        const st = j.settings || {};
        this.cfg = {
          ...this.cfg, ...st,
          transferAccounts: st.transferAccounts || [],
          transferScripts: st.transferScripts || [],
          transferKeywords: st.transferKeywords || [],
          forbidden: st.forbidden || [],
          endScripts: {
            none: [], unshipped: [], shipped: [], received: [],
            ...(st.endScripts || {}),
          },
        };
      } catch (e) {
        this.toast('读取配置失败：' + e.message, 'err');
      }
    },

    async saveCfg() {
      if (!this.cfgStore) return;
      this.cfgSaving = true;
      try {
        await this.req('/api/stores/' + encodeURIComponent(this.cfgStore.id) + '/settings', {
          method: 'PUT', body: JSON.stringify(this.cfg),
        });
        this.toast('设置已保存，AI 会按新配置回复', 'ok');
      } catch (e) {
        this.toast(e.message, 'err');
      } finally {
        this.cfgSaving = false;
      }
    },

    /* ================= 系统设置 ================= */
    async openSystem() {
      this.sysOpen = true;
      try {
        const j = await this.req('/api/system/settings');
        this.sys = Object.assign({}, this.sys, j.settings || {});
        this.sysRuntime = j.runtime || null;
      } catch (e) {
        this.toast('系统设置加载失败：' + e.message, 'err');
      }
    },

    async saveSystem() {
      this.sysSaving = true;
      try {
        await this.req('/api/system/settings', { method: 'PUT', body: JSON.stringify(this.sys) });
        this.toast('系统设置已保存', 'ok');
        this.sysOpen = false;
      } catch (e) {
        this.toast('保存失败：' + e.message, 'err');
      } finally {
        this.sysSaving = false;
      }
    },

    async clearCache() {
      this.clearing = true;
      try {
        const j = await this.req('/api/system/clear-cache', { method: 'POST', body: '{}' });
        this.toast(`已清理 ${j.cleared_logs || 0} 条接口日志、${j.cleared_notices || 0} 条已读通知`, 'ok');
      } catch (e) {
        this.toast('清理失败：' + e.message, 'err');
      } finally {
        this.clearing = false;
      }
    },

    /* ================= 快捷短语栏 ================= */
    toggleQuick() {
      this.qrOpen = !this.qrOpen;
      if (this.qrOpen && !this.qrLoaded) this.loadQuickReplies();
    },

    async loadQuickReplies() {
      try {
        const j = await this.req('/api/quick-replies');
        this.qrList = j.replies || [];
        this.qrRecent = j.recent || [];
        this.qrLoaded = true;
        this.autoOpenQrGroup();
      } catch (e) {
        this.toast('快捷短语加载失败：' + e.message, 'err');
      }
    },

    /* 默认展开第一个分组，避免打开面板看到一片空白 */
    autoOpenQrGroup() {
      const gs = this.qrGroups;
      if (!gs.length) { this.qrGroupOpen = ''; return; }
      if (this.qrGroupOpen && gs.some((x) => x.name === this.qrGroupOpen)) return;
      this.qrGroupOpen = gs[0].name;
    },

    /* 点击短语：插入输入框 + 记录一次真实使用（驱动「最近常用」排序） */
    async useQuickReply(text) {
      if (!text) return;
      this.draft = this.draft ? this.draft + text : text;
      this.$nextTick(() => {
        const el = this.$refs.composerInput;
        if (el) { el.focus(); this.autoGrow(el); }
      });

      const hit = this.qrList.find((r) => r.text === text);
      this.qrRecent = [text].concat(this.qrRecent.filter((t) => t !== text)).slice(0, 10);
      if (!hit) return;
      try {
        await this.req('/api/quick-replies/' + encodeURIComponent(hit.id) + '/use', { method: 'POST', body: '{}' });
        hit.use_count = (hit.use_count || 0) + 1;
        hit.used_at = new Date().toISOString();
      } catch (e) { /* 记使用次数失败不影响插入 */ }
    },

    async addQuickReply() {
      const text = String(this.qrNewText || '').trim();
      if (!text) return this.toast('请先输入短语内容', 'warn');
      this.qrAdding = true;
      try {
        await this.req('/api/quick-replies', {
          method: 'POST',
          body: JSON.stringify({
            text,
            category: this.qrNewCategory || '通用',
            scope: this.qrScope === 'team' ? 'team' : 'personal',
          }),
        });
        this.qrNewText = '';
        this.qrLoaded = false;
        await this.loadQuickReplies();
        this.toast('短语已保存', 'ok');
      } catch (e) {
        this.toast('保存失败：' + e.message, 'err');
      } finally {
        this.qrAdding = false;
      }
    },

    async delQuickReply(text) {
      const hit = this.qrList.find((r) => r.text === text);
      if (!hit) return;
      try {
        await this.req('/api/quick-replies/' + encodeURIComponent(hit.id), { method: 'DELETE' });
        this.qrLoaded = false;
        await this.loadQuickReplies();
        this.toast('已删除', 'ok');
      } catch (e) {
        this.toast('删除失败：' + e.message, 'err');
      }
    },

    addTo(field, value) {
      const v = String(value || '').trim();
      if (!v) return;
      if (!Array.isArray(this.cfg[field])) this.cfg[field] = [];
      if (this.cfg[field].indexOf(v) >= 0) return this.toast('已经添加过了', 'warn');
      this.cfg[field].push(v);
    },

    addEnd() {
      const v = String(this.endInput || '').trim();
      if (!v) return;
      if (!this.cfg.endScripts[this.endTab]) this.cfg.endScripts[this.endTab] = [];
      this.cfg.endScripts[this.endTab].push(v);
      this.endInput = '';
    },

    addForbid() {
      const from = String(this.forbidFrom || '').trim();
      if (!from) return;
      this.cfg.forbidden.push({ from, to: String(this.forbidTo || '').trim() });
      this.forbidFrom = '';
      this.forbidTo = '';
    },

    /* ---------- 店铺知识 ---------- */
    async loadStoreKb() {
      if (!this.cfgStore) return;
      this.kbLoading = true;
      try {
        const qs = new URLSearchParams({ type: this.kbFilterType, q: this.kbFilterQ });
        const j = await this.req('/api/stores/' + encodeURIComponent(this.cfgStore.id) + '/knowledge?' + qs);
        this.storeKb = j.items || [];
        if (j.types) this.kbTypes = j.types;
      } catch (e) {
        this.toast('读取知识失败：' + e.message, 'err');
      } finally {
        this.kbLoading = false;
      }
    },

    async addStoreKb() {
      const n = this.kbNew;
      if (!n.question.trim() || !n.answer.trim()) return this.toast('问题与答案都要填写', 'warn');
      try {
        await this.req('/api/stores/' + encodeURIComponent(this.cfgStore.id) + '/knowledge', {
          method: 'POST', body: JSON.stringify(n),
        });
        this.kbNew = { type: n.type, productId: '', question: '', answer: '' };
        this.kbAddOpen = false;
        this.toast('知识已保存', 'ok');
        this.loadStoreKb();
      } catch (e) { this.toast(e.message, 'err'); }
    },

    async toggleStoreKb(k) {
      try {
        const j = await this.req('/api/store-knowledge/' + encodeURIComponent(k.id) + '/toggle', { method: 'POST', body: '{}' });
        k.status = j.status;
      } catch (e) { this.toast(e.message, 'err'); }
    },

    async delStoreKb(k) {
      if (!confirm('删除这条知识？')) return;
      try {
        await this.req('/api/store-knowledge/' + encodeURIComponent(k.id), { method: 'DELETE' });
        this.storeKb = this.storeKb.filter((x) => x.id !== k.id);
        this.toast('已删除', 'ok');
      } catch (e) { this.toast(e.message, 'err'); }
    },

    /* 解析 CSV / TSV 文本为行数组 */
    parseTable(text) {
      const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim());
      if (!lines.length) return [];
      const delim = lines[0].indexOf('\t') >= 0 ? '\t' : ',';
      const cells = (line) => {
        const out = [];
        let cur = '', inQ = false;
        for (let i = 0; i < line.length; i += 1) {
          const ch = line[i];
          if (ch === '"') {
            if (inQ && line[i + 1] === '"') { cur += '"'; i += 1; } else inQ = !inQ;
          } else if (ch === delim && !inQ) { out.push(cur); cur = ''; }
          else cur += ch;
        }
        out.push(cur);
        return out.map((s) => s.trim());
      };
      let rows = lines.map(cells);
      if (/商品|商品id|question|问题/i.test(rows[0].join(''))) rows = rows.slice(1);
      return rows
        .filter((r) => r.length >= 2)
        .map((r) => ({ productId: r[0] || '', question: r[1] || '', answer: r.slice(2).join(delim) || '' }));
    },

    onKbFile(ev) {
      const f = ev.target.files && ev.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const rows = this.parseTable(reader.result);
        if (!rows.length) return this.toast('没有解析到有效行，请检查文件格式', 'warn');
        this.kbRows = rows;
        this.toast('已解析 ' + rows.length + ' 行，确认后点保存', 'ok');
      };
      reader.readAsText(f, 'utf-8');
      ev.target.value = '';
    },

    parsePaste() {
      const rows = this.parseTable(this.kbPaste);
      if (!rows.length) return this.toast('没有解析到有效行', 'warn');
      this.kbRows = rows;
      this.pasteOpen = false;
      this.toast('已解析 ' + rows.length + ' 行', 'ok');
    },

    downloadTemplate() {
      const csv = '商品ID,问题,答案\n100112476983,什么时候发货,付款后 48 小时内发出，节假日顺延\n100112476983,支持七天无理由吗,支持 7 天无理由退换，需保持吊牌完整\n';
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '商品知识导入模板.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    },

    async saveKbImport() {
      if (!this.cfgStore || !this.kbRows.length) return;
      this.kbImporting = true;
      try {
        const j = await this.req('/api/stores/' + encodeURIComponent(this.cfgStore.id) + '/knowledge/import', {
          method: 'POST',
          body: JSON.stringify({
            type: this.importType, replace: this.importReplace,
            rows: this.kbRows.map((r) => ({ product_id: r.productId, question: r.question, answer: r.answer })),
          }),
        });
        this.toast(`导入成功 ${j.imported} 条` + (j.skipped ? `，跳过 ${j.skipped} 条空行` : ''), 'ok');
        this.kbRows = [];
        this.cfgTab = 'knowledge';
        this.loadStoreKb();
      } catch (e) {
        this.toast(e.message, 'err');
      } finally {
        this.kbImporting = false;
      }
    },


    onPlatformChange() {
      this.storeForm.color = this.platformColor(this.storeForm.platform);
      this.storeTest = null;
    },

    /* 仅验证凭据：直接请求淘宝公共接口，不创建店铺 */
    async testStoreCred() {
      const f = this.storeForm;
      if (!f.appKey || !f.appSecret) return this.toast('先填写 AppKey 与 AppSecret', 'warn');
      if (!this.currentConnector) return this.toast('该平台暂未接入真实接口', 'warn');
      this.storeTesting = true;
      this.storeTest = null;
      try {
        const j = await this.req('/api/connectors/' + this.currentConnector.key + '/probe', {
          method: 'POST',
          body: JSON.stringify({ appKey: f.appKey, appSecret: f.appSecret, env: f.env }),
        });
        this.storeTest = j;
        this.toast(j.ok ? '凭据有效，可以去授权了' : '淘宝拒绝了这组凭据', j.ok ? 'ok' : 'err');
      } catch (e) {
        this.storeTest = { ok: false, errors: [{ api: 'local', code: '', message: e.message }] };
        this.toast(e.message, 'err');
      } finally {
        this.storeTesting = false;
      }
    },

    async saveStore() {
      const f = this.storeForm;
      if (!this.currentConnector) return this.toast('该平台暂未接入真实接口', 'warn');
      if (!f.appKey.trim() || !f.appSecret.trim()) {
        return this.toast('真实接入必须填写 AppKey 与 AppSecret', 'warn');
      }
      this.storeSaving = true;
      try {
        const j = await this.req('/api/stores', {
          method: 'POST',
          body: JSON.stringify({
            platform: f.platform, name: f.name, appKey: f.appKey.trim(),
            appSecret: f.appSecret.trim(), env: f.env, color: f.color,
          }),
        });
        this.storeAuthorizeUrl = j.authorize_url;
        this.storeStep = 'authorize';
        this.toast('凭据已加密保存，请完成授权', 'ok');
        await this.loadOverview();
        const list = await this.req('/api/stores');
        this.stores = list.stores || this.stores;
      } catch (e) {
        this.toast(e.message, 'err');
      } finally {
        this.storeSaving = false;
      }
    },

    /* ---------- 授权结果回跳 ---------- */
    handleConnectResult() {
      const q = new URLSearchParams(location.search);
      const connect = q.get('connect');
      if (!connect) return;
      const msg = q.get('msg') || '';
      const storeId = q.get('store') || '';
      history.replaceState(null, '', location.pathname + '#stores');
      if (connect === 'ok') {
        this.toast('授权成功，已拉取真实店铺信息', 'ok');
        this.loadOverview().then(() => {
          const s = (this.overview.stores || []).find((x) => x.id === storeId);
          if (s) this.openStoreDetail(s);
        });
      } else if (connect === 'denied') {
        this.toast('你取消了淘宝授权：' + msg, 'warn');
      } else {
        this.toast('授权失败：' + msg, 'err');
      }
    },

    /* ---------- 接入详情 ---------- */
    async openStoreDetail(s) {
      this.detailStore = s;
      this.detailOpen = true;
      this.detailLoading = true;
      this.detail = { integration: null, capabilities: [], stats: null, logs: [] };
      this.detailDiag = null;
      try {
        const [j, d, b] = await Promise.all([
          this.req('/api/stores/' + encodeURIComponent(s.id) + '/integration'),
          /* 消息接收体检：为什么收不到消息、怎么修 */
          this.req('/api/stores/' + encodeURIComponent(s.id) + '/inbox-diagnosis').catch(() => null),
          /* 浏览器消息桥：网页登录模式下是否正在监听 */
          this.req('/api/stores/' + encodeURIComponent(s.id) + '/bridge').catch(() => null),
        ]);
        this.detail = j;
        this.detailDiag = d;
        this.detailBridge = b;
      } catch (e) {
        this.toast('读取接入信息失败：' + e.message, 'err');
      } finally {
        this.detailLoading = false;
      }
      this.startBridgePolling();
    },

    /* 网页监听状态实时自检：扩展一连上，指示灯自己变绿，不用手动刷新 */
    startBridgePolling() {
      if (this.bridgeTimer) { clearInterval(this.bridgeTimer); this.bridgeTimer = null; }
      this.bridgeTimer = setInterval(async () => {
        if (!this.detailOpen || !this.detailStore) {
          clearInterval(this.bridgeTimer); this.bridgeTimer = null; return;
        }
        try {
          const b = await this.req('/api/stores/' + encodeURIComponent(this.detailStore.id) + '/bridge');
          const wasOnline = this.detailBridge && this.detailBridge.online;
          this.detailBridge = b;
          if (!wasOnline && b.online) this.toast('网页监听已上线，正在接收店铺消息', 'ok');
        } catch (e) { /* 轮询失败静默 */ }
      }, 5000);
    },

    /* 一键复制 Webhook 给扩展用 */
    copyBridgeHook() {
      const u = (this.detailBridge && this.detailBridge.hook_url)
        || (this.detailDiag && this.detailDiag.inbox && this.detailDiag.inbox.api_url) || '';
      if (!u) { this.toast('Webhook 地址还没生成', 'err'); return; }
      this.copyText(u);
      this.toast('Webhook 已复制，粘到扩展弹窗即可', 'ok');
    },

    /* 一键打开店铺后台客服页（扩展监听的目标页面） */
    openMerchantChat() {
      window.open('https://mms.pinduoduo.com/', '_blank');
      this.toast('已打开拼多多商家后台；登录后保持该页面开着即可监听', 'ok');
    },

    /* ---------- 消息接入：让买家发来的消息真正进到工作台 ---------- */
    consultUrl() {
      const ib = this.detailDiag && this.detailDiag.inbox;
      if (!ib) return '';
      const u = ib.url || ('/c/' + ib.code);
      /* 相对地址按当前访问的域名补全：本机打开就是本机地址，云端打开就是云端地址 */
      return /^https?:\/\//i.test(u) ? u : (location.origin + u);
    },
    copyConsult() {
      const u = this.consultUrl();
      if (!u) return;
      this.copyText(u);
      this.toast('咨询链接已复制，发给买家即可收到消息', 'ok');
    },
    openConsult() {
      const u = this.consultUrl();
      if (u) window.open(u, '_blank');
    },
    async toggleInboxAi() {
      if (!this.detailStore || !this.detailDiag) return;
      const next = this.detailDiag.inbox.ai ? 0 : 1;
      try {
        const j = await this.req('/api/stores/' + encodeURIComponent(this.detailStore.id) + '/inbox', {
          method: 'POST', body: JSON.stringify({ ai: next }),
        });
        this.detailDiag.inbox = j.inbox;
        this.toast(next ? '已开启 AI 首响：买家发消息立即自动回复' : '已关闭 AI 首响，买家消息由人工接待', 'ok');
      } catch (e) { this.toast(e.message, 'err'); }
    },
    async resetInboxToken() {
      if (!this.detailStore) return;
      if (!confirm('重置后旧的 Webhook 地址立即失效，确定继续？')) return;
      try {
        const j = await this.req('/api/stores/' + encodeURIComponent(this.detailStore.id) + '/inbox/reset', { method: 'POST', body: '{}' });
        if (this.detailDiag) this.detailDiag.inbox = j.inbox;
        this.toast('Webhook 令牌已重置', 'ok');
      } catch (e) { this.toast(e.message, 'err'); }
    },
    async subscribeTmc() {
      if (!this.detailStore) return;
      this.tmcSubscribing = true;
      try {
        const j = await this.req('/api/stores/' + encodeURIComponent(this.detailStore.id) + '/tmc/subscribe', { method: 'POST', body: '{}' });
        this.toast('已提交订阅：' + (j.topics || []).length + ' 个 topic。之后有订单/退款事件就会推送进来', 'ok');
      } catch (e) {
        this.toast('订阅失败：' + e.message + (e.message && /授权|session/.test(e.message) ? '（请先完成店铺授权）' : ''), 'err');
      } finally {
        this.tmcSubscribing = false;
        try {
          this.detailDiag = await this.req('/api/stores/' + encodeURIComponent(this.detailStore.id) + '/inbox-diagnosis');
        } catch (e) { /* ignore */ }
      }
    },

    async reloadDetail() {
      if (!this.detailStore) return;
      try {
        const j = await this.req('/api/stores/' + encodeURIComponent(this.detailStore.id) + '/integration');
        this.detail = j;
      } catch (e) { /* ignore */ }
    },

    async testCurrent() {
      if (!this.detailStore) return;
      this.detailTesting = true;
      try {
        const j = await this.req('/api/stores/' + encodeURIComponent(this.detailStore.id) + '/test', { method: 'POST', body: '{}' });
        if (j.ok && j.need_authorize) this.toast('凭据有效，还需完成店铺授权', 'warn');
        else if (j.ok) this.toast('连接正常，已读回真实店铺：' + ((j.shop && j.shop.title) || (j.seller && j.seller.nick) || ''), 'ok');
        else this.toast('连接失败：' + ((j.errors && j.errors[0] && j.errors[0].message) || '未知错误'), 'err');
        await this.reloadDetail();
        await this.loadOverview();
      } catch (e) {
        this.toast('自检失败：' + e.message, 'err');
      } finally {
        this.detailTesting = false;
      }
    },

    async reauthorize() {
      if (!this.detailStore) return;
      const w = window.open('', '_blank');
      try {
        const j = await this.req('/api/stores/' + encodeURIComponent(this.detailStore.id) + '/authorize');
        if (w) w.location = j.authorize_url;
        else this.toast('浏览器拦截了弹窗，请手动打开：' + j.authorize_url, 'warn');
      } catch (e) {
        if (w) w.close();
        this.toast(e.message, 'err');
      }
    },

    async syncCurrent(scope) {
      if (!this.detailStore) return;
      this.detailSyncing = true;
      try {
        await this.doSync(this.detailStore, scope);
        await this.reloadDetail();
      } finally {
        this.detailSyncing = false;
      }
    },

    async syncStore(s, scope) {
      this.syncBusy = s.id;
      try {
        await this.doSync(s, scope || 'all');
      } finally {
        this.syncBusy = '';
      }
    },

    async doSync(s, scope) {
      try {
        const j = await this.req('/api/stores/' + encodeURIComponent(s.id) + '/sync', {
          method: 'POST', body: JSON.stringify({ scope: scope || 'all', days: 7 }),
        });
        if (scope === 'all') {
          const steps = (j.result && j.result.steps) || [];
          const bad = steps.filter((x) => !x.ok);
          if (bad.length) {
            this.toast('部分同步失败：' + bad.map((b) => b.step + ' [' + b.code + '] ' + b.message).join('；'), 'err');
          } else {
            this.toast('同步完成：' + this.syncSummary(j.stats), 'ok');
          }
        } else {
          this.toast('同步完成：' + this.syncSummary(j.stats), 'ok');
        }
        await this.loadOverview();
      } catch (e) {
        this.toast('同步失败：' + e.message, 'err');
      }
    },

    syncSummary(st) {
      if (!st) return '';
      return `${st.orders} 订单 / ${st.refunds} 退款 / ${st.items} 商品 / ${st.messages} 消息`;
    },

    authStatusText(s) {
      return { pending: '待授权', active: '已接入', expired: '授权过期', error: '接入异常' }[s] || '未接入';
    },
    /* 复制文本（商品 ID 之类） */
    copyText(t) {
      const s = String(t == null ? '' : t);
      if (!s) return;
      const done = () => this.toast('已复制：' + s, 'ok');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(s).then(done).catch(() => {
          const ta = document.createElement('textarea');
          ta.value = s; document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); done(); } catch (e) { this.toast('复制失败，请手动选择', 'warn'); }
          ta.remove();
        });
      } else {
        const ta = document.createElement('textarea');
        ta.value = s; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); done(); } catch (e) { this.toast('复制失败，请手动选择', 'warn'); }
        ta.remove();
      }
    },
    storeStatusTag(s) {
      if (s.integration && !s.integration.authorized) return this.authStatusText(s.integration.auth_status);
      return s.status === 'active' ? '接待中' : '已暂停';
    },
    storeStatusClass(s) {
      if (s.integration && !s.integration.authorized) return 'tag-orange';
      return s.status === 'active' ? 'tag-green' : 'tag-gray';
    },
    intgText(s) {
      if (!s.integration) return '未接入平台';
      return this.authStatusText(s.integration.auth_status);
    },
    intgClass(s) {
      if (!s.integration) return 'none';
      return { active: 'ok', pending: 'warn', expired: 'bad', error: 'bad' }[s.integration.auth_status] || 'none';
    },
    intgIcon(s) {
      if (!s.integration) return 'fa-unlink';
      return {
        active: 'fa-check-circle', pending: 'fa-clock-o', expired: 'fa-exclamation-circle', error: 'fa-exclamation-triangle',
      }[s.integration.auth_status] || 'fa-unlink';
    },
    tokenLeftText(it) {
      if (!it || !it.token_expire_at) return '—';
      if (it.token_expired) return '已过期';
      const sec = it.token_expires_in;
      if (sec > 86400) return Math.floor(sec / 86400) + ' 天';
      if (sec > 3600) return Math.floor(sec / 3600) + ' 小时';
      return Math.max(0, Math.floor(sec / 60)) + ' 分钟';
    },
    fmtTime(iso) {
      if (!iso) return '—';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      const p = (n) => String(n).padStart(2, '0');
      return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    },
    /* 把店铺的 platform 字符串归一为平台 key（优先用平台清单，否则用内置别名表） */
    storePlatformKey(s) {
      const n = String((s && s.platform) || '');
      if (!n) return null;
      const p = (this.platformList || []).find((x) => n.indexOf(x.name) >= 0 || x.name.indexOf(n) >= 0);
      if (p && p.key) return p.key;
      const ALIAS = {
        '淘宝': 'taobao', '天猫': 'taobao', '淘宝/天猫': 'taobao', '淘工厂': 'taofactory',
        '抖音飞鸽': 'douyin', '抖音': 'douyin', '京东': 'jd', '拼多多': 'pdd',
        '快手': 'kuaishou', '小红书': 'xhs', '视频号': 'channels', '微信小店': 'wechat', '小时达': 'hours',
      };
      return ALIAS[n] || n.toLowerCase();
    },
    /* 店铺 id → 归一后的平台分组 key（淘宝/天猫合并为 taobao） */    convPlatformKeyOfStore(storeId) {
      const s = (this.stores || []).find((x) => x.id === storeId);
      const k = this.storePlatformKey(s);
      if (!k) return null;
      return (k === 'taobao' || k === 'tmall') ? 'taobao' : k;
    },
    pickConvPlatform(v) {
      this.convFilter = v;
      this.convStoreId = '';
      this.mobileChat = false;
    },
    pickConvStore(id) {
      this.convStoreId = this.convStoreId === id ? '' : id;
      this.mobileChat = false;
    },
    /* 完整日期时间：2026-10-29 10:44（质检列表等表格用） */
    fmtDate(iso) {
      if (!iso) return '—';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    },

    async toggleStore(s) {
      const next = s.status === 'active' ? 'disabled' : 'active';
      try {
        await this.req('/api/stores/' + encodeURIComponent(s.id), { method: 'PUT', body: JSON.stringify({ status: next }) });
        s.status = next;
        this.toast('店铺已' + (next === 'active' ? '开启' : '暂停') + '接待', 'ok');
      } catch (e) { this.toast(e.message, 'err'); }
    },
    async delStore(s) {
      if (!confirm('删除店铺「' + s.name + '」后其会话将不再展示，确定？')) return;
      try {
        await this.req('/api/stores/' + encodeURIComponent(s.id), { method: 'DELETE' });
        this.overview.stores = this.overview.stores.filter((x) => x.id !== s.id);
        this.stores = this.stores.filter((x) => x.id !== s.id);
        this.toast('店铺已删除', 'ok');
      } catch (e) { this.toast(e.message, 'err'); }
    },

    /* ================= 知识管理 ================= */
    async addKb() {
      const f = this.kbForm;
      if (!f.q.trim() || !f.a.trim()) return this.toast('问题与答案都要填写', 'warn');
      try {
        const j = await this.req('/api/knowledge', { method: 'POST', body: JSON.stringify({ q: f.q, a: f.a, materialId: f.materialId || '' }) });
        this.knowledge.unshift(j.item);
        this.kbForm = { q: '', a: '', materialId: '' };
        this.kbOpen = false;
        this.toast('知识已保存，AI 回复会立即参考', 'ok');
      } catch (e) { this.toast(e.message, 'err'); }
    },
    async delKb(k) {
      if (!confirm('删除知识「' + k.q + '」？')) return;
      try {
        await this.req('/api/knowledge/' + encodeURIComponent(k.id), { method: 'DELETE' });
        this.knowledge = this.knowledge.filter((x) => x.id !== k.id);
        this.toast('已删除', 'ok');
      } catch (e) { this.toast(e.message, 'err'); }
    },

    /* ================= 子账号管理 ================= */
    async loadMembers() {
      if (this.user.role !== 'admin') return;
      try {
        const j = await this.req('/api/admin/users');
        this.members = j.users || [];
        this.allStores = j.allStores || [];
        this.memberLoaded = true;
      } catch (e) { this.toast('成员加载失败：' + e.message, 'err'); }
    },
    openMember(u) {
      const permOf = (x) => (x && x.permissions
        ? { modules: (x.permissions.modules || []).slice(), ops: !!x.permissions.ops, platforms: (x.permissions.platforms || []).slice() }
        : { modules: PERM_MODULE_KEYS.slice(), ops: false, platforms: [] });
      this.memberOpen = u
        ? { mode: 'edit', id: u.id, form: { name: u.name, email: u.email, role: u.role, status: u.status, title: u.title || '', points: u.points || 0, storeIds: (u.storeIds || []).slice(), password: '', permissions: permOf(u) } }
        : { mode: 'create', form: { name: '', email: '', role: 'agent', title: '客服坐席', password: '', points: 1000, storeIds: [], permissions: { modules: PERM_MODULE_KEYS.slice(), ops: false, platforms: [] } } };
    },
    toggleMemberStore(m, id) {
      const f = this.memberOpen && this.memberOpen.form;
      if (!f) return;
      const i = f.storeIds.indexOf(id);
      if (i >= 0) f.storeIds.splice(i, 1); else f.storeIds.push(id);
    },
    openPwd(u) { this.pwdOpen = u; this.pwdForm = { password: '', confirm: '' }; },
    async savePwd() {
      if (!this.pwdOpen || this.pwdSaving) return;
      const f = this.pwdForm;
      if (f.password.length < 6) return this.toast('密码至少 6 位', 'warn');
      if (f.password !== f.confirm) return this.toast('两次输入不一致', 'warn');
      this.pwdSaving = true;
      try {
        await this.req('/api/admin/users/' + this.pwdOpen.id + '/password', { method: 'POST', body: JSON.stringify({ password: f.password }) });
        this.toast('密码已更新' + (this.pwdOpen.id === this.user.id ? '，请重新登录' : '，该账号旧会话已失效'), 'ok');
        this.pwdOpen = null;
      } catch (e) { this.toast(e.message, 'err'); }
      finally { this.pwdSaving = false; }
    },
    async saveMember() {
      const m = this.memberOpen;
      if (!m || this.memberSaving) return;
      const f = m.form;
      if (m.mode === 'create') {
        if (f.name.trim().length < 2) return this.toast('姓名至少 2 个字', 'warn');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email)) return this.toast('邮箱格式不正确', 'warn');
        if (f.password.length < 6) return this.toast('初始密码至少 6 位', 'warn');
      }
      this.memberSaving = true;
      try {
        if (m.mode === 'create') {
          const body = Object.assign({}, f);
          if (f.role === 'admin') delete body.permissions; /* 管理员天然全权限 */
          await this.req('/api/admin/users', { method: 'POST', body: JSON.stringify(body) });
          this.toast(f.role === 'admin' ? '管理员账号已创建' : '子账号已创建（默认只读，可在编辑中开权限）', 'ok');
        } else {
          const body = { name: f.name, role: f.role, status: f.status, title: f.title, points: Number(f.points) || 0, storeIds: f.storeIds };
          if (f.role !== 'admin') body.permissions = f.permissions;
          if (f.password) body.password = f.password;
          await this.req('/api/admin/users/' + m.id, { method: 'PUT', body: JSON.stringify(body) });
          this.toast('已保存，子账号刷新页面后按新权限生效', 'ok');
        }
        this.memberOpen = null;
        await this.loadMembers();
      } catch (e) { this.toast(e.message, 'err'); }
      finally { this.memberSaving = false; }
    },
    async toggleMember(u) {
      const next = u.status === 'active' ? 'disabled' : 'active';
      if (!confirm((next === 'active' ? '启用' : '禁用') + '「' + u.name + '」？')) return;
      try {
        await this.req('/api/admin/users/' + u.id, { method: 'PUT', body: JSON.stringify({ status: next }) });
        u.status = next;
        this.toast('已更新', 'ok');
      } catch (e) { this.toast(e.message, 'err'); }
    },
    async delMember(u) {
      if (!confirm('删除「' + u.name + '」后无法恢复，确定？')) return;
      try {
        await this.req('/api/admin/users/' + u.id, { method: 'DELETE' });
        this.members = this.members.filter((x) => x.id !== u.id);
        this.toast('已删除', 'ok');
      } catch (e) { this.toast(e.message, 'err'); }
    },
    roleText(r) { return r === 'admin' ? '管理员' : '客服坐席'; },

    /* ---------- 数据概览数字滚动（纯视觉，不改数据） ---------- */
    playOvCount() {
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) return;
      const ease = (t) => 1 - Math.pow(1 - t, 3);
      const animate = (node, target, delay) => {
        const dur = 850;
        const t0 = performance.now() + delay;
        const step = (now) => {
          const p = Math.min(1, Math.max(0, (now - t0) / dur));
          node.textContent = String(Math.round(target * ease(p)));
          if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      };
      const proc = (el) => {
        const first = el.childNodes[0];
        if (!first || first.nodeType !== 3) return;
        const mm = first.textContent.trim().match(/^(\d+)(\/(\d+))?$/);
        if (!mm) return;
        if (mm[2]) {
          /* "8/11" 形式：分子分母同时滚动 */
          const a = +mm[1], b = +mm[3];
          const t0 = performance.now() + 380, dur = 850;
          const step = (now) => {
            const p = Math.min(1, Math.max(0, (now - t0) / dur));
            first.textContent = Math.round(a * ease(p)) + '/' + Math.round(b * ease(p));
            if (p < 1) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        } else {
          animate(first, +mm[1], 380);
        }
      };
      this.$nextTick(() => {
        document.querySelectorAll('.ov-kpi-num').forEach(proc);
        document.querySelectorAll('.ov-ring-in span').forEach(proc);
        document.querySelectorAll('.ov-lex-item b').forEach(proc);
      });
    },
  },

  watch: {
    /* 数据概览：数据到达后播放数字滚动 */
    overview() { this.playOvCount(); },
    /* 切换范围/搜索词后重算默认展开分组 */
    qrScope() { this.qrGroupOpen = ''; this.$nextTick(() => this.autoOpenQrGroup()); },    qrSearch() { this.qrGroupOpen = ''; this.$nextTick(() => this.autoOpenQrGroup()); },
    qcFilter() { this.qcPage = 1; },
    qcPlatform() { this.qcPage = 1; },
    qcStoreKw() { this.qcPage = 1; },
    qcBuyerKw() { this.qcPage = 1; },
    qcDate() { this.qcPage = 1; },
    qcPageSize() { this.qcPage = 1; },
    memberSearch() { this.memberPage = 1; },
    memberOnline() { this.memberPage = 1; },
    memberPageSize() { this.memberPage = 1; },
    convFilter() { this.convStoreId = ''; },
    qcStoreId() { this.qcPage = 1; },
  },

  mounted() {
    /* 权限路由：非管理员默认落在其可见的第一个模块（无 permissions 配置=可见全部基础模块） */
    if (this.user && this.user.role !== 'admin' && !this.canSee(this.route)) {
      const first = PERM_MODULE_KEYS.find((k) => this.canSee(k));
      if (first) this.route = first;
    }
    this.loadConfig();
    this.loadModels();
    this.scrollChatBottom();
    /* 实时接收：每 3.5 秒增量拉取新会话 / 新消息 */
    this.feedSince = new Date().toISOString();
    this.feedTimer = setInterval(() => { this.pollFeed(); }, 3500);
    this.loadOverview();
    this.loadConnectors();
    this.loadPlatforms();
    if (this.user.role === 'admin') this.loadMembers();
    /* 授权回调 / 外部跳转可以带 ?tab=stores 直达某个模块（走 go 才会触发该模块的数据加载） */
    const tab = new URLSearchParams(location.search).get('tab');
    if (tab) this.go(tab);
    /* 深链：#wizard 直接打开店铺信息助手（#wizard3 可直达第 3 步） */
    const wm = location.hash.match(/^#wizard([1-6])?$/);
    if (wm && this.user.role === 'admin') {
      this.openWizard();
      if (wm[1]) this.wizardStep = Number(wm[1]);
    }
    /* 深链：#order=单号 直接打开订单详情 */
    const om = location.hash.match(/^#order=([A-Za-z0-9_-]+)$/);
    if (om) {
      this.go('inbox');
      this.openOrderDetail({ no: decodeURIComponent(om[1]) });
    }
    /* 深链：#material=ID 直接打开素材预览 */
    const mm2 = location.hash.match(/^#material=([\w-]+)$/);
    if (mm2) {
      this.go('materials');
      this.previewMaterial(mm2[1]);
    }
    this.handleConnectResult();
  },
  beforeUnmount() {
    if (this.feedTimer) { clearInterval(this.feedTimer); this.feedTimer = null; }
  },
};

/* ==================================================================
   子账号权限模型
   - 管理员（role==='admin'）：全部模块可见 + 可操作，不受 permissions 限制
   - 子账号：permissions.modules 控制可见模块；permissions.ops 控制可否操作
   - permissions 为空（未配置）：默认可见全部基础模块，但只读
   ================================================================== */
const PERM_MODULE_META = [
  { key: 'overview', label: '数据概览' },
  { key: 'inbox', label: '会话聚合' },
  { key: 'aftersales', label: '售后助手' },
  { key: 'dashboard', label: '数据看板' },
  { key: 'workspace', label: '店铺工作区' },
  { key: 'stores', label: '店铺管理' },
  { key: 'qc', label: '对话质检' },
  { key: 'knowledge', label: '知识管理' },
  { key: 'flows', label: 'AI Agent 工作流' },
  { key: 'notify', label: '信息通知' },
  { key: 'materials', label: '素材中心' },
  { key: 'alerts', label: '对话预警' },
];
const PERM_MODULE_KEYS = PERM_MODULE_META.map((m) => m.key);

/* 可添加平台白名单（与 lib/platforms.js 的 key 一致），用于「子账号管理 → 编辑 → 可添加平台」 */
const PERM_PLATFORM_META = [
  { key: 'douyin', label: '抖音飞鸽' },
  { key: 'pdd', label: '拼多多' },
  { key: 'kuaishou', label: '快手' },
  { key: 'jd', label: '京东' },
  { key: 'channels', label: '视频号' },
  { key: 'xhs', label: '小红书' },
  { key: 'hours', label: '小时达' },
  { key: 'taobao', label: '淘宝' },
  { key: 'taofactory', label: '淘工厂' },
  { key: 'tmall', label: '天猫' },
];

/* ==================================================================
   启动：先校验登录态并拉取工作台数据，再挂载（未登录直接跳登录页）
   ================================================================== */
(async function boot() {
  const bootEl = document.getElementById('app-boot');
  try {
    const r = await fetch('/api/bootstrap', { headers: { Accept: 'application/json' } });
    if (r.status === 401) {
      location.href = '/login';
      return;
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    window.__BOOT__ = await r.json();
  } catch (e) {
    if (bootEl) {
      bootEl.innerHTML =
        '<div style="color:#F53F3F;font-size:14px;text-align:center;line-height:1.9">' +
        '加载失败：' + e.message +
        '<br><span style="color:#86909C;font-size:12px">请确认 server.js 已启动，然后刷新页面</span></div>';
    }
    return;
  }
  if (bootEl) bootEl.remove();
  createApp(APP).mount('#app');
})();
