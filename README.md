# 小满AI · 电商客服工作台（全栈版 v4 · MySQL · 真实平台接入）

一套可注册、可登录、可多人协作的电商客服 SaaS：**多店铺会话聚合 · AI 自动回复 · 售后助手 · 数据看板 · 后台管理**。

**所有业务数据持久化在本机 MySQL**（18 张表，多租户隔离），重启 / 换机器都不丢。
前端零构建（Vue 3 + 原生 CSS），后端 Node 原生 `http`，数据库唯一依赖是 `mysql2`。

> 品牌「小满AI」为独立命名，与任何既有产品无关。

---

## 本版新增：真实平台接入（不再是演示数据）

| 功能 | 实现方式 |
|---|---|
| 添加店铺 | 左侧平台选择面板（10 个平台）+ 右侧内嵌官方登录页 |
| 淘宝 / 天猫 / 淘工厂 | **真实 TOP 开放平台 API**：店铺信息、订单、退款、商品、TMC 消息 |
| 其它平台 | 网页登录登记，界面明确标注「未接 API」，不生成假数据 |
| 店铺右键菜单 | 基础设置 / 导入知识 / AI管理中心 / 店铺设置 / 店铺后台 |
| 基础设置 | 8 种 AI 回复风格 + 回复热度 + 实时对话预览 |
| 导入知识 | CSV/TSV 上传、粘贴导入、模板下载，按商品ID+问题+答案入库 |
| AI管理中心 | 店铺知识列表：类型筛选、搜索、启用/关闭、删除 |
| 店铺设置 | 转接账号/话术/关键词、进线欢迎语、按订单状态的会话结束语、违禁词替换 |
| 店铺工作区 | 内置浏览器：左侧账号列表（登录中/未登录）、顶部工具栏与地址栏、右侧真实页面 |

**接入前必读**：[`docs/淘宝开放平台接入指引.md`](docs/淘宝开放平台接入指引.md)

凭据安全：AppSecret / access_token / refresh_token 全部 AES-256-GCM 加密后入库，
密钥在 `data/secret.key`（首次启动生成），接口只返回脱敏值。
删除该文件将导致已存凭据无法解密，请务必纳入备份。


---

## 一、快速开始（PyCharm）

### 0) 先准备数据库（3 步）

```bash
# 1. 确认本机 MySQL 已启动（默认 3306）
# 2. 在项目根目录创建 .env（仓库里给了 .env.example，复制改名即可）
copy .env.example .env      # Windows
#    然后修改 DB_USER / DB_PASSWORD 为你自己的账号密码

# 3. 安装数据库驱动（只需一次）
npm install mysql2 --registry=https://registry.npmmirror.com
```

出于安全，仓库不包含 `.env`（已在 `.gitignore` 中排除）；请按 `.env.example` 自行填写数据库账号密码。示例连接：`root@127.0.0.1:3306/xiaoman`。
库 `xiaoman` **不需要手动创建**，首次启动会自动 `CREATE DATABASE IF NOT EXISTS` 并建好全部表。

### 1) 启动

1. PyCharm → `File → Open` → 选择本目录 `E:\Python\xiaoman-workbench`
2. 右键 **`start.py`** → `Run 'start'`（或点右上角绿色三角）
3. 浏览器自动打开 `http://127.0.0.1:8787`

也可以直接命令行：`node server.js`，或双击 `启动工作台.bat`。

启动日志会直接告诉你数据写到了哪：

```
  数据库     MySQL · root@127.0.0.1:3306/xiaoman
             · MySQL 连接成功，所有数据写入 MySQL
```

> 若 MySQL 连不上（未启动 / 密码不对 / 没装驱动），服务**不会崩**，会自动回落到本地
> `data/xiaoman.db`（SQLite）并在日志里明确提示。想让连不上直接报错，设 `DB_STRICT=1`。

**演示账号（首次启动自动创建）**

| 角色 | 邮箱 | 密码 | 权限 |
|---|---|---|---|
| 管理员 | `admin@xiaoman.ai` | `****`（见 .env/部署配置） | 工作台 + 后台管理（成员/店铺/日志） |
| 客服坐席 | `agent@xiaoman.ai` | `****`（见 .env/部署配置） | 仅工作台，访问 `/admin` 会被拦回 |

新用户可在 `/register` 自助注册：**注册即自动创建一个独立工作空间**，并灌入一套演示数据（4 个店铺 / 10 个会话 / 6 张售后工单 / 6 条知识库），注册完立刻能上手，不需要手动造数据。

---

## 二、页面与路由

| 路由 | 页面 | 说明 |
|---|---|---|
| `/` | 落地页 | 产品介绍页（顶部有「登录 / 免费注册」入口） |
| `/login` | 登录 | 已登录会自动跳 `/app` |
| `/register` | 注册 | 建账号 + 建工作空间 + 种演示数据 |
| `/app` | 工作台 | 未登录跳 `/login`；登录后默认进入**数据概览**首页（店铺状态 + 6 大能力入口） |
| `/admin` | 后台管理 | 仅 `admin` 角色；概览 / 成员 / 店铺 / 操作日志 |

---

## 三、功能清单

### 工作台 `/app`

左侧导航按原产品结构分为 5 组：**工作台 / AI 控制中心 / AI 自动化 / 店铺运营 / 系统管理**。

- **数据概览（登录首页）**：顶部工作条（账号、添加店铺、待办、教程、设置、刷新、AI 余量）、左栏「店铺中 / 未登录」店铺切换、6 张能力卡片（多平台聚合 / 进化无限 / 数据同步 / 强大模型 / 风险监控 / 售后全能）、信任背书标签、客服协助（二维码）与使用教程
- **多店铺会话聚合**：4 平台统一收件箱、平台角标、未读计数、情绪标签（正/平/负）、客户标签、搜索、全部已读
- **聊天**：消息气泡（顾客 / AI / 人工）、订单卡片、快捷话术、Enter 发送、Shift+Enter 换行、转人工、演示用顾客追问
- **AI 自动回复**：结合店铺知识 + 当前订单上下文生成回复，SSE 逐字流式输出，可采纳 / 重新生成
- **AI 润色**：把草稿润色成亲切专业的客服话术
- **AI 文案生成**：商品标题 / 卖点 / 详情文案
- **售后助手**：6 类工单（退款/退货/物流异常/仅退款/纠纷）、处理时间线、AI 处理建议 + 安抚话术、状态流转（落库 + 留痕）
- **数据看板**：5 项 KPI + 双曲线趋势 + 平台环图 + 满意度趋势 + 店铺排行（纯手写 SVG，无图表库）
- **店铺管理**：店铺卡片（平台色标 / 账号 / 会话 / 消息 / 未读）、新增店铺、暂停或开启接待、删除、打开对应会话
- **对话质检**：AI 按响应时长 / 话术规范 / 情绪安抚 / 解决方案四维打分，风险会话标红，问题标签、顾客原话与回复对照、一键标记复核
- **知识管理**：店铺知识的新增 / 搜索 / 删除，快捷话术一览；AI 回复即时引用
- **AI Agent 工作流**：触发器 + 步骤链路可视化（触发 / 判断 / AI / 执行）、启用开关、运行次数与成功率、步骤说明展开
- **信息通知**：系统 / 预警 / 更新 / 套餐四类，未读红点、分类筛选、单条已读、全部已读
- **素材中心**：图片 / 视频 / 文档 / 文案分类、搜索、上传登记、删除
- **对话预警**：情绪激动、退款风险、超时未回复、敏感词、催发货；分级色条、一键「去会话」或标记处理
- **子账号管理**：成员列表（角色 / 状态 / 在线状态）、新增子账号、编辑、改角色、禁用启用、删除（管理员专属，非管理员显示权限提示）
- **AI 设置**：多厂商预设、Base URL / 模型 / API Key、连接测试、语气、temperature、自动化开关

### 后台管理 `/admin`
- **概览**：成员数、店铺数、会话数、消息数、工单数、AI 调用与采纳率、模型状态、工作空间信息
- **成员管理**：新增坐席（分配角色 / 初始密码）、编辑、禁用/启用、重置密码、删除（含「不能删自己」「至少保留一名管理员」保护）
- **店铺管理**：新增 / 编辑 / 删除店铺，平台色标自动匹配
- **操作日志**：登录、改配置、增删成员/店铺等操作留痕

---

## 四、技术架构

```
xiaoman-workbench/
├── server.js               # HTTP 入口：路由分发 / 静态服务 / 登录态校验
├── .env                    # 数据库与大模型配置（含密码，勿提交）
├── lib/
│   ├── db.js               # 双驱动数据层：MySQL 优先，SQLite 兜底；建表 + 通用查询
│   ├── env.js              # 零依赖 .env 读取
│   ├── mysql-client.js     # MySQL 同步客户端（SQL 方言翻译 + 同步桥主线程侧）
│   ├── mysql-worker.js     # MySQL 同步桥工作线程（mysql2 连接池）
│   ├── auth.js             # scrypt 密码哈希、Session、Cookie、校验
│   ├── seed.js             # 新租户种子数据 + 内置演示账号 + 老库升级
│   ├── seed-modules.js     # 扩展模块种子（质检/通知/素材/预警/工作流）
│   └── llm.js              # OpenAI 兼容代理（SSE 流式）+ 演示引擎
├── tools/
│   ├── db-check.js         # 数据库自检（驱动/目标/各表行数/中文往返）
│   ├── migrate-sqlite-to-mysql.js  # 老 SQLite 数据一次性迁到 MySQL
│   └── smoke-test.js       # 全链路回归测试（54 项，含多租户隔离）
├── public/
│   ├── index.html          # 落地页
│   ├── login.html          # 登录
│   ├── register.html       # 注册
│   ├── app.html            # 工作台（含数据概览 + 8 个扩展模块）
│   ├── admin.html          # 后台管理
│   ├── css/{app,auth,admin,console}.css
│   ├── js/{app,admin}.js
│   └── vendor/vue.global.prod.js
├── data/xiaoman.db         # 仅在回落到 SQLite 时生成
├── start.py                # PyCharm 一键启动器
└── 启动工作台.bat
```

- **前端**：Vue 3（本地 vendor，无构建步骤）+ 原生 CSS 设计系统 + 手写 SVG 图表
- **后端**：Node 原生 `http`（无 Express）；数据库访问层保持同步语义，业务代码简单直白
- **认证**：`scrypt` 加盐哈希 + 服务端 Session（`xm_session`，HttpOnly / SameSite=Lax / 7 天）
- **多租户**：所有业务表带 `tenant_id`，查询一律带租户条件，账号之间数据完全隔离

### 数据库连接（MySQL）

配置全部在 `.env`，也可用真实环境变量覆盖（部署时更安全）：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DB_DRIVER` | `mysql` | `mysql` 走 MySQL；`sqlite` 强制用本地文件 |
| `DB_HOST` / `DB_PORT` | `127.0.0.1` / `3306` | MySQL 地址 |
| `DB_USER` / `DB_PASSWORD` | `root` / — | 账号密码 |
| `DB_NAME` | `xiaoman` | 库名，不存在会自动创建 |
| `DB_STRICT` | `0` | `1` = 连不上直接报错，不回落 SQLite |

**为什么数据库访问是同步的**：整个业务代码（`server.js` 与 `lib/*.js`）共 90+ 处数据库调用，
原本按 `node:sqlite` 的同步语义编写。为避免把全部调用点改成 `async/await` 而漏 `await`
造成难排查的 bug，这里用 `worker_threads` + `SharedArrayBuffer/Atomics` 做了个**同步桥**
（`lib/mysql-worker.js`）：主线程把 SQL 发给工作线程后阻塞等待，工作线程用 `mysql2` 连接池
执行完再把结果抛回。对外 API 与原来完全一致（`all` / `get` / `run`），行为也一致——请求串行处理。

**SQL 方言适配**（`lib/mysql-client.js` 的 `translate()`）：
`INSERT OR IGNORE` → `INSERT IGNORE`；`ORDER BY rowid` → `ORDER BY seq`（每张需要的表都有自增 `seq` 列，
保持插入顺序语义）；MySQL 保留字 `read` / `key` 自动加反引号。业务代码里的 SQL 一行都不用改。

### 常用命令

```bash
node tools/db-check.js                      # 数据库自检：驱动/目标/各表行数/中文往返
node tools/migrate-sqlite-to-mysql.js       # 把 data/xiaoman.db 里的老数据一次性迁到 MySQL
node tools/smoke-test.js                    # 全链路回归测试（54 项）
npm run db:check / npm run db:migrate / npm test
```

### 数据表

18 张表，全部在 MySQL 库 `xiaoman` 中（InnoDB / utf8mb4）：

`tenants` / `users` / `sessions` / `stores` / `conversations` / `messages` / `tickets` / `ticket_events` / `knowledge` / `quick_replies` / `settings` / `audit_logs` / `conv_ai_logs` / `qc_reviews` / `notifications` / `materials` / `alerts` / `agent_flows`

---

## 五、API 速查

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | 注册（建租户 + 管理员 + 种子数据 + 自动登录） |
| POST | `/api/auth/login` | 登录（写 HttpOnly Cookie） |
| POST | `/api/auth/logout` | 登出（销毁 session） |
| GET | `/api/auth/me` | 当前登录用户 |
| POST | `/api/auth/password` | 修改密码（校验原密码） |
| GET | `/api/bootstrap` | 工作台一次性数据（用户/店铺/会话/工单/看板/AI 配置） |
| GET | `/api/overview` | 数据概览（店铺聚合统计、AI 余量、待办计数） |
| GET | `/api/qc` · POST `/api/qc/:id/review` | 对话质检列表 / 标记复核 |
| GET | `/api/notifications` · POST `/api/notifications/read-all` · POST `/api/notifications/:id/read` | 信息通知 |
| GET/POST | `/api/materials` · DELETE `/api/materials/:id` | 素材中心 |
| GET | `/api/alerts` · POST `/api/alerts/:id/handle` | 对话预警 / 处理 |
| GET | `/api/flows` · POST `/api/flows/:id/toggle` | AI Agent 工作流 / 启停 |
| POST | `/api/conversations/:id/messages` | 发送消息（`role=agent/customer`） |
| POST | `/api/conversations/:id/read` · `/api/conversations/read-all` | 已读 |
| POST | `/api/conversations/:id/status` | 转 AI / 人工 / 待接待 |
| POST | `/api/tickets/:id/status` · `/events` | 工单流转 / 追加处理记录 |
| GET/POST/PUT/DELETE | `/api/stores` | 店铺管理 |
| POST/DELETE | `/api/knowledge` · `/api/quick-replies` | 知识库 / 快捷话术 |
| GET | `/api/dashboard` | 看板（真实计数 + 运营基线） |
| GET/POST | `/api/ai/config` · `/api/ai/models` | 模型配置 / 模型列表 |
| POST | `/api/ai/chat`（别名 `/api/chat`） | SSE 流式对话 |
| POST | `/api/ai/adopt` | 记录 AI 建议被采纳（用于采纳率） |
| GET | `/api/admin/users` · `/api/admin/stats` · `/api/admin/logs` | 后台数据（仅 admin） |
| POST/PUT/DELETE | `/api/admin/users/:id` | 成员增改删（仅 admin） |

---

## 六、接入真实大模型

右上角「演示模式 · 去接入」→ **AI 设置**：

1. 选预设（DeepSeek / 通义千问 / Kimi / OpenAI）或自定义；
2. 填 **Base URL**、**模型**、**API Key**；
3. 「保存配置」→「测试连接」，显示连接成功即已切换真实模型。

| 厂商 | Base URL | 模型示例 |
|---|---|---|
| DeepSeek | `https://api.deepseek.com` | `deepseek-chat` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| Kimi | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |

配置**按工作空间存储**（`settings` 表），Key 只在服务端、绝不下发浏览器。
部署环境可用环境变量做全局兜底：`LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY`。

---

## 七、部署

标准 Node 服务，监听 `process.env.PORT`（默认 8787）。按你的终端选对应一条执行：

Windows PowerShell（本机开发推荐）：

```powershell
$env:PORT=8080; node server.js
```

Windows CMD：

```bat
set PORT=8080 && node server.js
```

Linux / macOS：

```bash
PORT=8080 node server.js
```

不设置 `PORT` 时直接 `node server.js` 即可，默认监听 8787；Windows 上也可以双击 `启动工作台.bat`。

注意：
- **数据库**：生产环境用环境变量注入连接信息，别把 `.env` 提交或打包到公网
  （`DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME`，`DB_STRICT=1` 可让连不上时直接失败而不是回落）；
- 容器/无数据库的托管环境里若连不上 MySQL，会自动回落到容器内 SQLite 文件——**那种情况下数据不持久**，
  只能当演示用；要真持久化请挂一个可用的 MySQL；
- 首次启动若库里没有账号，会自动创建演示账号与演示租户；
- 生产环境建议置于 HTTPS 反代之后（Cookie 才能带 `Secure`）。

---

## 八、安全设计

- 密码 `scrypt` 加盐哈希，永不明文存储；登录失败不区分「邮箱不存在 / 密码错」
- Session 存服务端，可随时吊销；禁用账号后旧 session 立即失效
- 登录/注册按 IP 限流（20 次/分钟），AI 接口按租户限流（60 次/分钟）
- 全部管理接口二次校验角色（`admin`），坐席访问返回 403
- 前端渲染 AI 输出为纯文本（不使用 `innerHTML`），避免 XSS
- 请求体大小限制 512KB，消息内容截断 4000 字，模型输入截断 8000 字
- `.gitignore` 已排除 `data/`（含 Key 与用户数据）

---

## 九、边界说明（实事求是）

- **平台数据**：会话 / 订单 / 工单是演示数据。真实接入淘宝、京东、拼多多、抖音需要走各平台开放平台（淘宝开放平台、京东宙斯、拼多多开放平台、抖音开放平台）的商家授权与消息 Webhook，属后续对接工作。
- **AI 是真实链路**：配置 Key 后，回复 / 润色 / 售后建议 / 文案都是真实大模型调用（服务端代理 + SSE 流式）；未配置时由本地演示引擎生成，界面明确标注「演示模式」。
- **未做**：找回密码（需邮件服务）、手机号/微信登录、多租户账单、附件上传、消息撤回。
- **新增模块的数据**：对话质检、信息通知、素材中心、对话预警、AI Agent 工作流的初始内容随租户初始化一起播种（与业务逻辑真实连通：质检复核、通知已读、素材增删、预警处理、工作流启停都会落库），但不会真的去平台抓数据、也不会真的执行外部动作。
- **数据库**：业务数据全部落在 MySQL（本机 `xiaoman` 库），已验证重启后会话、消息、工单、AI 配置、登录态全部保留；表结构由服务启动时自动创建，老 SQLite 数据可用 `npm run db:migrate` 一次性迁移。

## 十、可扩展方向

平台消息 Webhook 双向同步、会话分配与工单 SLA、知识库在线编辑与向量检索、敏感词质检、报表导出、多语言、Redis 会话与水平扩容。
