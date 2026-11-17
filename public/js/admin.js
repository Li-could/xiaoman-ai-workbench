/* ===================================================================
   小满AI · 后台管理逻辑
   =================================================================== */
const { createApp } = Vue;

const PLATFORMS = ['淘宝', '京东', '拼多多', '抖音', '小红书', '快手', '视频号', '自建站'];
const PLATFORM_COLOR = {
  淘宝: '#FF5000', 京东: '#E1251B', 拼多多: '#E02E24', 抖音: '#161823',
  小红书: '#FF2442', 快手: '#FF6600', 视频号: '#07C160', 自建站: '#165DFF',
};

createApp({
  data() {
    return {
      user: {},
      tenant: {},
      tab: 'overview',
      stats: {},
      logs: [],
      users: [],
      stores: [],
      loading: true,
      toasts: [],
      userModal: null,
      storeModal: null,
      saving: false,
      platforms: PLATFORMS,
    };
  },

  computed: {
    title() {
      return { overview: '概览', users: '成员管理', stores: '店铺管理', logs: '操作日志' }[this.tab] || '概览';
    },
    sub() {
      return {
        overview: '工作空间运行状态与核心数据',
        users: '邀请坐席、分配角色、控制访问权限',
        stores: '接入的各平台店铺与账号',
        logs: '最近 60 条管理操作留痕',
      }[this.tab] || '';
    },
    activeUsers() {
      return this.users.filter((u) => u.status === 'active').length;
    },
  },

  methods: {
    toast(msg, type = 'ok') {
      const id = Date.now() + Math.random();
      this.toasts.push({ id, msg, type });
      setTimeout(() => { this.toasts = this.toasts.filter((t) => t.id !== id); }, 3200);
    },

    async api(url, opt = {}) {
      const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opt });
      if (r.status === 401) { location.href = '/login'; throw new Error('登录已失效'); }
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || 'HTTP ' + r.status);
      return j;
    },

    initial(n) { return (n || '?').slice(0, 1); },
    avatarBg(name) {
      const colors = ['#165DFF', '#722ED1', '#0EA5B7', '#FF7D00', '#00B42A', '#E1251B', '#4E5969'];
      let h = 0;
      for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) % colors.length;
      return colors[h];
    },
    roleTag(r) { return r === 'admin' ? ['tag-purple', '管理员'] : ['tag-blue', '客服坐席']; },
    statusTag(s) { return s === 'active' ? ['tag-green', '正常'] : ['tag-red', '已禁用']; },
    fmtTime(s) {
      if (!s) return '—';
      const d = new Date(s);
      if (isNaN(d)) return s;
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    },

    async loadAll() {
      try {
        const b = await this.api('/api/bootstrap');
        this.user = b.user || {};
        this.tenant = b.tenant || {};
        await Promise.all([this.loadStats(), this.loadUsers(), this.loadStores(), this.loadLogs()]);
      } catch (e) {
        this.toast(e.message, 'err');
      } finally {
        this.loading = false;
      }
    },
    async loadStats() {
      const j = await this.api('/api/admin/stats');
      this.stats = j.stats || {};
      this.tenant = { ...this.tenant, ...(j.tenant || {}) };
    },
    async loadUsers() {
      const j = await this.api('/api/admin/users');
      this.users = j.users || [];
    },
    async loadStores() {
      const j = await this.api('/api/stores');
      this.stores = j.stores || [];
    },
    async loadLogs() {
      const j = await this.api('/api/admin/logs');
      this.logs = j.logs || [];
    },

    /* ---------- 成员 ---------- */
    openCreateUser() {
      this.userModal = { mode: 'create', form: { name: '', email: '', role: 'agent', password: '', title: '' } };
    },
    openEditUser(u) {
      this.userModal = {
        mode: 'edit', id: u.id,
        form: { name: u.name, email: u.email, role: u.role, status: u.status, title: u.title || '', password: '' },
      };
    },
    async saveUser() {
      const m = this.userModal;
      if (!m || this.saving) return;
      const f = m.form;
      if (m.mode === 'create') {
        if (f.name.trim().length < 2) return this.toast('姓名至少 2 个字', 'warn');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email)) return this.toast('邮箱格式不正确', 'warn');
        if (f.password.length < 6) return this.toast('初始密码至少 6 位', 'warn');
      }
      this.saving = true;
      try {
        if (m.mode === 'create') {
          await this.api('/api/admin/users', { method: 'POST', body: JSON.stringify(f) });
          this.toast('成员已创建，账号可立即登录', 'ok');
        } else {
          await this.api('/api/admin/users/' + m.id, { method: 'PUT', body: JSON.stringify(f) });
          this.toast('成员信息已更新', 'ok');
        }
        this.userModal = null;
        await Promise.all([this.loadUsers(), this.loadStats(), this.loadLogs()]);
      } catch (e) {
        this.toast(e.message, 'err');
      } finally {
        this.saving = false;
      }
    },
    async toggleUser(u) {
      const next = u.status === 'active' ? 'disabled' : 'active';
      const word = next === 'active' ? '启用' : '禁用';
      if (!confirm(`确定要${word}「${u.name}」吗？`)) return;
      try {
        await this.api('/api/admin/users/' + u.id, { method: 'PUT', body: JSON.stringify({ status: next }) });
        this.toast(`已${word} ${u.name}`, 'ok');
        await Promise.all([this.loadUsers(), this.loadLogs()]);
      } catch (e) {
        this.toast(e.message, 'err');
      }
    },
    async delUser(u) {
      if (!confirm(`删除「${u.name}」后无法恢复，确定继续？`)) return;
      try {
        await this.api('/api/admin/users/' + u.id, { method: 'DELETE' });
        this.toast('成员已删除', 'ok');
        await Promise.all([this.loadUsers(), this.loadStats(), this.loadLogs()]);
      } catch (e) {
        this.toast(e.message, 'err');
      }
    },

    /* ---------- 店铺 ---------- */
    openCreateStore() {
      this.storeModal = { mode: 'create', form: { name: '', platform: '淘宝', short: '淘', account: '', color: PLATFORM_COLOR['淘宝'] } };
    },
    openEditStore(s) {
      this.storeModal = {
        mode: 'edit', id: s.id,
        form: { name: s.name, platform: s.platform, short: s.short, account: s.account || '', status: s.status },
      };
    },
    onPlatformChange() {
      const p = this.storeModal.form.platform;
      this.storeModal.form.color = PLATFORM_COLOR[p] || '#165DFF';
      this.storeModal.form.short = p.slice(0, 1);
    },
    async saveStore() {
      const m = this.storeModal;
      if (!m || this.saving) return;
      if (!m.form.name.trim()) return this.toast('请填写店铺名称', 'warn');
      this.saving = true;
      try {
        if (m.mode === 'create') {
          await this.api('/api/stores', { method: 'POST', body: JSON.stringify(m.form) });
          this.toast('店铺已添加', 'ok');
        } else {
          await this.api('/api/stores/' + m.id, { method: 'PUT', body: JSON.stringify(m.form) });
          this.toast('店铺已更新', 'ok');
        }
        this.storeModal = null;
        await Promise.all([this.loadStores(), this.loadStats(), this.loadLogs()]);
      } catch (e) {
        this.toast(e.message, 'err');
      } finally {
        this.saving = false;
      }
    },
    async delStore(s) {
      if (!confirm(`删除店铺「${s.name}」？该店铺下的历史会话不会被删除。`)) return;
      try {
        await this.api('/api/stores/' + s.id, { method: 'DELETE' });
        this.toast('店铺已删除', 'ok');
        await Promise.all([this.loadStores(), this.loadStats(), this.loadLogs()]);
      } catch (e) {
        this.toast(e.message, 'err');
      }
    },

    async logout() {
      await fetch('/api/auth/logout', { method: 'POST' });
      location.href = '/login';
    },
  },

  mounted() {
    this.loadAll();
  },
}).mount('#app');
