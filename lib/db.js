'use strict';
/**
 * 数据层（双驱动）
 *
 * 默认走 MySQL：所有业务数据（租户/用户/会话/消息/工单/质检/通知/素材/预警/工作流…）
 * 全部落在本地 MySQL 库中，重启、换机器都不丢。
 *
 * 若 MySQL 不可用（例如线上环境没有本地数据库），自动回落到 node:sqlite 单文件库，
 * 保证服务不会因为数据库连不上而整个挂掉。可用 DB_DRIVER 强制指定：
 *   DB_DRIVER=mysql|sqlite
 *   DB_STRICT=1   MySQL 连不上时直接报错（不静默回落）
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { loadEnv } = require('./env');
loadEnv();

const DATA_DIR = path.join(__dirname, '..', 'data');
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { /* ignore */ }
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'xiaoman.db');

/* ==================================================================
   配置
   ================================================================== */
function mysqlConfig() {
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'lizhanyu18',
    database: process.env.DB_NAME || 'xiaoman',
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT || 8000),
    queryTimeout: Number(process.env.DB_QUERY_TIMEOUT || 60000),
  };
}

const WANT_DRIVER = String(process.env.DB_DRIVER || 'mysql').toLowerCase();

/* ==================================================================
   MySQL 建表语句
   ================================================================== */
const MYSQL_DDL = `
CREATE TABLE IF NOT EXISTS tenants (
  id          VARCHAR(64)  NOT NULL,
  name        VARCHAR(200) NOT NULL,
  created_at  VARCHAR(40)  NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  seq           BIGINT       NOT NULL AUTO_INCREMENT,
  id            VARCHAR(64)  NOT NULL,
  tenant_id     VARCHAR(64)  NOT NULL,
  name          VARCHAR(120) NOT NULL,
  email         VARCHAR(190) NOT NULL,
  password      VARCHAR(255) NOT NULL,
  role          VARCHAR(20)  NOT NULL DEFAULT 'agent',
  status        VARCHAR(20)  NOT NULL DEFAULT 'active',
  title         VARCHAR(120) DEFAULT '',
  points        INT          NOT NULL DEFAULT 1000,
  store_ids     VARCHAR(512) NOT NULL DEFAULT '',
  created_at    VARCHAR(40)  NOT NULL,
  last_login_at VARCHAR(40)  DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_seq (seq),
  UNIQUE KEY uk_users_email (email),
  KEY idx_users_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  seq        BIGINT      NOT NULL AUTO_INCREMENT,
  token      VARCHAR(80) NOT NULL,
  user_id    VARCHAR(64) NOT NULL,
  expires_at BIGINT      NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  PRIMARY KEY (token),
  UNIQUE KEY uk_sessions_seq (seq),
  KEY idx_sessions_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stores (
  seq        BIGINT       NOT NULL AUTO_INCREMENT,
  id         VARCHAR(64)  NOT NULL,
  tenant_id  VARCHAR(64)  NOT NULL,
  name       VARCHAR(160) NOT NULL,
  platform   VARCHAR(40)  NOT NULL,
  short      VARCHAR(20)  NOT NULL,
  color      VARCHAR(20)  NOT NULL,
  account    VARCHAR(120) DEFAULT '',
  status     VARCHAR(20)  NOT NULL DEFAULT 'active',
  sort       INT          NOT NULL DEFAULT 0,
  created_at VARCHAR(40)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_stores_seq (seq),
  KEY idx_stores_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS conversations (
  id            VARCHAR(64)  NOT NULL,
  tenant_id     VARCHAR(64)  NOT NULL,
  store_id      VARCHAR(64)  NOT NULL,
  customer      VARCHAR(120) NOT NULL,
  tags          VARCHAR(500) DEFAULT '[]',
  order_no      VARCHAR(80)  DEFAULT '',
  order_product VARCHAR(255) DEFAULT '',
  order_amount  VARCHAR(40)  DEFAULT '',
  order_status  VARCHAR(40)  DEFAULT '',
  unread        INT          NOT NULL DEFAULT 0,
  status        VARCHAR(20)  NOT NULL DEFAULT 'waiting',
  sentiment     VARCHAR(20)  NOT NULL DEFAULT 'neutral',
  last_msg      VARCHAR(500) DEFAULT '',
  last_time     VARCHAR(40)  DEFAULT '',
  created_at    VARCHAR(40)  NOT NULL DEFAULT '',
  transferred_at VARCHAR(40) NOT NULL DEFAULT '',
  updated_at    VARCHAR(40)  NOT NULL,
  PRIMARY KEY (id),
  KEY idx_conv_tenant (tenant_id),
  KEY idx_conv_store (store_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messages (
  id         BIGINT      NOT NULL AUTO_INCREMENT,
  tenant_id  VARCHAR(64) NOT NULL,
  conv_id    VARCHAR(64) NOT NULL,
  role       VARCHAR(20) NOT NULL,
  text       TEXT        NOT NULL,
  time       VARCHAR(20) NOT NULL,
  kind       VARCHAR(16) NOT NULL DEFAULT '',
  payload    TEXT,
  created_at VARCHAR(40) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_msg_conv (conv_id),
  KEY idx_msg_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tickets (
  seq        BIGINT       NOT NULL AUTO_INCREMENT,
  id         VARCHAR(64)  NOT NULL,
  tenant_id  VARCHAR(64)  NOT NULL,
  store_id   VARCHAR(64)  NOT NULL,
  type       VARCHAR(40)  NOT NULL,
  type_label VARCHAR(60)  NOT NULL,
  status     VARCHAR(20)  NOT NULL DEFAULT 'pending',
  priority   VARCHAR(20)  NOT NULL DEFAULT 'normal',
  customer   VARCHAR(120) NOT NULL,
  order_no   VARCHAR(80)  DEFAULT '',
  product    VARCHAR(255) DEFAULT '',
  amount     VARCHAR(40)  DEFAULT '',
  reason     TEXT,
  created_at VARCHAR(40)  NOT NULL,
  updated_at VARCHAR(40)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_tickets_seq (seq),
  KEY idx_tickets_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ticket_events (
  id        BIGINT       NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64)  NOT NULL,
  ticket_id VARCHAR(64)  NOT NULL,
  time      VARCHAR(40)  NOT NULL,
  text      VARCHAR(500) NOT NULL,
  actor     VARCHAR(60)  NOT NULL,
  PRIMARY KEY (id),
  KEY idx_evt_ticket (ticket_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS knowledge (
  seq        BIGINT       NOT NULL AUTO_INCREMENT,
  id         VARCHAR(64)  NOT NULL,
  tenant_id  VARCHAR(64)  NOT NULL,
  q          VARCHAR(500) NOT NULL,
  a          TEXT         NOT NULL,
  created_at VARCHAR(40)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_knowledge_seq (seq),
  KEY idx_knowledge_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quick_replies (
  id        VARCHAR(64)  NOT NULL,
  tenant_id VARCHAR(64)  NOT NULL,
  text      VARCHAR(500) NOT NULL,
  category  VARCHAR(64)  NOT NULL DEFAULT '通用',
  scope     VARCHAR(16)  NOT NULL DEFAULT 'personal',
  use_count INT          NOT NULL DEFAULT 0,
  used_at   VARCHAR(40)  NOT NULL DEFAULT '',
  sort      INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_quick_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settings (
  tenant_id VARCHAR(64)  NOT NULL,
  \`key\`     VARCHAR(120) NOT NULL,
  \`value\`   LONGTEXT,
  PRIMARY KEY (tenant_id, \`key\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id         BIGINT       NOT NULL AUTO_INCREMENT,
  tenant_id  VARCHAR(64)  NOT NULL,
  user_id    VARCHAR(64)  DEFAULT NULL,
  user_name  VARCHAR(120) DEFAULT NULL,
  action     VARCHAR(160) NOT NULL,
  target     VARCHAR(255) DEFAULT '',
  ip         VARCHAR(64)  DEFAULT '',
  created_at VARCHAR(40)  NOT NULL,
  PRIMARY KEY (id),
  KEY idx_log_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS conv_ai_logs (
  id         BIGINT      NOT NULL AUTO_INCREMENT,
  tenant_id  VARCHAR(64) NOT NULL,
  conv_id    VARCHAR(64) DEFAULT NULL,
  mode       VARCHAR(40) DEFAULT NULL,
  adopted    INT         NOT NULL DEFAULT 0,
  created_at VARCHAR(40) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_ailog_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS flow_runs (
  id         BIGINT       NOT NULL AUTO_INCREMENT,
  tenant_id  VARCHAR(64)  NOT NULL,
  flow_id    VARCHAR(64)  NOT NULL,
  flow_name  VARCHAR(160) NOT NULL,
  conv_id    VARCHAR(64)  DEFAULT NULL,
  customer   VARCHAR(120) DEFAULT '',
  intent     VARCHAR(60)  DEFAULT '',
  trigger_text TEXT,
  reply      TEXT,
  created_at VARCHAR(40)  NOT NULL,
  PRIMARY KEY (id),
  KEY idx_flowrun_tenant (tenant_id),
  KEY idx_flowrun_flow (flow_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bridge_outbox (
  id         BIGINT       NOT NULL AUTO_INCREMENT,
  tenant_id  VARCHAR(64)  NOT NULL,
  store_id   VARCHAR(64)  NOT NULL,
  conv_id    VARCHAR(64)  NOT NULL,
  visitor_id VARCHAR(80)  DEFAULT '',
  customer   VARCHAR(120) DEFAULT '',
  text       TEXT         NOT NULL,
  status     VARCHAR(16)  NOT NULL DEFAULT 'pending',
  error      VARCHAR(500) DEFAULT '',
  created_at VARCHAR(40)  NOT NULL,
  sent_at    VARCHAR(40)  DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_bo_store (store_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qc_reviews (
  seq        BIGINT       NOT NULL AUTO_INCREMENT,
  id         VARCHAR(64)  NOT NULL,
  tenant_id  VARCHAR(64)  NOT NULL,
  customer   VARCHAR(120) NOT NULL,
  store_id   VARCHAR(64)  DEFAULT '',
  agent      VARCHAR(120) DEFAULT '',
  score      INT          NOT NULL DEFAULT 80,
  level      VARCHAR(20)  NOT NULL DEFAULT 'good',
  issues     VARCHAR(500) DEFAULT '[]',
  snippet    TEXT,
  reply      TEXT,
  status     VARCHAR(20)  NOT NULL DEFAULT 'pending',
  created_at VARCHAR(40)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_qc_seq (seq),
  KEY idx_qc_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  seq        BIGINT       NOT NULL AUTO_INCREMENT,
  id         VARCHAR(64)  NOT NULL,
  tenant_id  VARCHAR(64)  NOT NULL,
  type       VARCHAR(20)  NOT NULL DEFAULT 'system',
  title      VARCHAR(255) NOT NULL,
  body       TEXT,
  level      VARCHAR(20)  NOT NULL DEFAULT 'info',
  \`read\`     TINYINT      NOT NULL DEFAULT 0,
  created_at VARCHAR(40)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ntf_seq (seq),
  KEY idx_ntf_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS materials (
  seq        BIGINT       NOT NULL AUTO_INCREMENT,
  id         VARCHAR(64)  NOT NULL,
  tenant_id  VARCHAR(64)  NOT NULL,
  name       VARCHAR(255) NOT NULL,
  type       VARCHAR(20)  NOT NULL DEFAULT 'image',
  tag        VARCHAR(80)  DEFAULT '',
  size       VARCHAR(40)  DEFAULT '',
  color      VARCHAR(20)  DEFAULT '#165DFF',
  content    TEXT,
  poster     VARCHAR(255) DEFAULT '',
  created_at VARCHAR(40)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_mat_seq (seq),
  KEY idx_mat_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alerts (
  seq        BIGINT       NOT NULL AUTO_INCREMENT,
  id         VARCHAR(64)  NOT NULL,
  tenant_id  VARCHAR(64)  NOT NULL,
  conv_id    VARCHAR(64)  DEFAULT '',
  customer   VARCHAR(120) NOT NULL,
  store_id   VARCHAR(64)  DEFAULT '',
  type       VARCHAR(60)  NOT NULL DEFAULT '情绪激动',
  level      VARCHAR(20)  NOT NULL DEFAULT 'mid',
  text       TEXT,
  handled    TINYINT      NOT NULL DEFAULT 0,
  created_at VARCHAR(40)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_alert_seq (seq),
  KEY idx_alert_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_flows (
  seq          BIGINT       NOT NULL AUTO_INCREMENT,
  id           VARCHAR(64)  NOT NULL,
  tenant_id    VARCHAR(64)  NOT NULL,
  name         VARCHAR(160) NOT NULL,
  description  TEXT,
  trigger_type VARCHAR(40)  DEFAULT 'message',
  trigger_desc VARCHAR(255) DEFAULT '',
  steps        TEXT,
  enabled      TINYINT      NOT NULL DEFAULT 1,
  runs         INT          NOT NULL DEFAULT 0,
  success_rate INT          NOT NULL DEFAULT 95,
  sort         INT          NOT NULL DEFAULT 0,
  created_at   VARCHAR(40)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_flow_seq (seq),
  KEY idx_flow_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ---------------- 平台真实接入：凭据 / 调用日志 / 同步数据 ---------------- */
CREATE TABLE IF NOT EXISTS store_credentials (
  store_id        VARCHAR(64)  NOT NULL,
  tenant_id       VARCHAR(64)  NOT NULL,
  platform        VARCHAR(40)  NOT NULL,
  api_env         VARCHAR(20)  NOT NULL DEFAULT 'prod',
  app_key         VARCHAR(120) NOT NULL DEFAULT '',
  app_secret_enc  TEXT,
  session_enc     TEXT,
  refresh_enc     TEXT,
  token_expire_at BIGINT       NOT NULL DEFAULT 0,
  re_expire_at    BIGINT       NOT NULL DEFAULT 0,
  shop_id         VARCHAR(80)  DEFAULT '',
  seller_uid      VARCHAR(80)  DEFAULT '',
  seller_nick     VARCHAR(120) DEFAULT '',
  shop_title      VARCHAR(200) DEFAULT '',
  shop_pic        VARCHAR(500) DEFAULT '',
  redirect_uri    VARCHAR(300) DEFAULT '',
  auth_status     VARCHAR(30)  NOT NULL DEFAULT 'pending',
  auth_error      VARCHAR(500) DEFAULT '',
  tmc_group       VARCHAR(80)  DEFAULT 'default',
  tmc_last_id     BIGINT       NOT NULL DEFAULT 0,
  last_sync_at    VARCHAR(40)  DEFAULT NULL,
  created_at      VARCHAR(40)  NOT NULL,
  updated_at      VARCHAR(40)  NOT NULL,
  PRIMARY KEY (store_id),
  KEY idx_cred_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS connector_logs (
  seq        BIGINT       NOT NULL AUTO_INCREMENT,
  tenant_id  VARCHAR(64)  NOT NULL,
  store_id   VARCHAR(64)  DEFAULT '',
  platform   VARCHAR(40)  NOT NULL,
  method     VARCHAR(120) NOT NULL,
  ok         TINYINT      NOT NULL DEFAULT 0,
  code       VARCHAR(80)  DEFAULT '',
  message    VARCHAR(500) DEFAULT '',
  ms         INT          NOT NULL DEFAULT 0,
  detail     MEDIUMTEXT,
  created_at VARCHAR(40)  NOT NULL,
  PRIMARY KEY (seq),
  KEY idx_clog_tenant (tenant_id),
  KEY idx_clog_store (store_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shop_orders (
  tid          VARCHAR(64)  NOT NULL,
  tenant_id    VARCHAR(64)  NOT NULL,
  store_id     VARCHAR(64)  NOT NULL,
  buyer_nick   VARCHAR(120) DEFAULT '',
  status       VARCHAR(40)  DEFAULT '',
  payment      VARCHAR(40)  DEFAULT '',
  total_fee    VARCHAR(40)  DEFAULT '',
  created      VARCHAR(40)  DEFAULT '',
  pay_time     VARCHAR(40)  DEFAULT '',
  receiver     VARCHAR(255) DEFAULT '',
  title        VARCHAR(500) DEFAULT '',
  items_json   TEXT,
  synced_at    VARCHAR(40)  NOT NULL,
  PRIMARY KEY (tid),
  KEY idx_order_tenant (tenant_id),
  KEY idx_order_store (store_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shop_items (
  num_iid    VARCHAR(64)  NOT NULL,
  tenant_id  VARCHAR(64)  NOT NULL,
  store_id   VARCHAR(64)  NOT NULL,
  title      VARCHAR(500) DEFAULT '',
  price      VARCHAR(40)  DEFAULT '',
  num        INT          NOT NULL DEFAULT 0,
  outer_id   VARCHAR(120) DEFAULT '',
  pic_url    VARCHAR(500) DEFAULT '',
  status     VARCHAR(40)  DEFAULT '',
  modified   VARCHAR(40)  DEFAULT '',
  description MEDIUMTEXT,
  specs      TEXT,
  attrs      TEXT,
  synced_at  VARCHAR(40)  NOT NULL,
  PRIMARY KEY (num_iid),
  KEY idx_item_tenant (tenant_id),
  KEY idx_item_store (store_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shop_refunds (
  refund_id  VARCHAR(64)  NOT NULL,
  tenant_id  VARCHAR(64)  NOT NULL,
  store_id   VARCHAR(64)  NOT NULL,
  tid        VARCHAR(64)  DEFAULT '',
  buyer_nick VARCHAR(120) DEFAULT '',
  status     VARCHAR(40)  DEFAULT '',
  refund_fee VARCHAR(40)  DEFAULT '',
  reason     VARCHAR(255) DEFAULT '',
  memo       VARCHAR(500) DEFAULT '',
  item_title VARCHAR(500) DEFAULT '',
  created    VARCHAR(40)  DEFAULT '',
  modified   VARCHAR(40)  DEFAULT '',
  synced_at  VARCHAR(40)  NOT NULL,
  PRIMARY KEY (refund_id),
  KEY idx_refund_tenant (tenant_id),
  KEY idx_refund_store (store_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tmc_messages (
  msg_id     VARCHAR(64)  NOT NULL,
  tenant_id  VARCHAR(64)  NOT NULL,
  store_id   VARCHAR(64)  NOT NULL,
  topic      VARCHAR(120) NOT NULL,
  pub_time   VARCHAR(40)  DEFAULT '',
  user_nick  VARCHAR(120) DEFAULT '',
  content    MEDIUMTEXT,
  handled    TINYINT      NOT NULL DEFAULT 0,
  created_at VARCHAR(40)  NOT NULL,
  PRIMARY KEY (msg_id),
  KEY idx_tmc_tenant (tenant_id),
  KEY idx_tmc_store (store_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS store_knowledge (
  seq        BIGINT       NOT NULL AUTO_INCREMENT,
  id         VARCHAR(64)  NOT NULL,
  tenant_id  VARCHAR(64)  NOT NULL,
  store_id   VARCHAR(64)  NOT NULL,
  type       VARCHAR(40)  NOT NULL DEFAULT 'product',
  product_id VARCHAR(80)  DEFAULT '',
  question   VARCHAR(500) DEFAULT '',
  answer     MEDIUMTEXT,
  status     VARCHAR(20)  NOT NULL DEFAULT 'off',
  created_at VARCHAR(40)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_sk_seq (seq),
  KEY idx_sk_tenant (tenant_id),
  KEY idx_sk_store (store_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* 通知群（企微群机器人绑定） */
CREATE TABLE IF NOT EXISTS notify_groups (
  id             VARCHAR(64)  NOT NULL,
  tenant_id      VARCHAR(64)  NOT NULL,
  name           VARCHAR(160) NOT NULL,
  channel        VARCHAR(40)  NOT NULL DEFAULT 'wecom',
  chat_id        VARCHAR(160) DEFAULT '',
  webhook_url    VARCHAR(512) NOT NULL DEFAULT '',
  notify_count   INT          NOT NULL DEFAULT 0,
  status         VARCHAR(20)  NOT NULL DEFAULT 'pending',
  last_notify_at VARCHAR(40)  DEFAULT '',
  created_at     VARCHAR(40)  NOT NULL,
  PRIMARY KEY (id),
  KEY idx_ng_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* 店铺通知群规则：按 seq 从上到下匹配，命中第一条即发送 */
CREATE TABLE IF NOT EXISTS store_notify_rules (
  id         VARCHAR(64)  NOT NULL,
  tenant_id  VARCHAR(64)  NOT NULL,
  store_id   VARCHAR(64)  NOT NULL,
  seq        INT          NOT NULL DEFAULT 0,
  group_name VARCHAR(160) DEFAULT '',
  keywords   VARCHAR(500) DEFAULT '[]',
  created_at VARCHAR(40)  NOT NULL,
  PRIMARY KEY (id),
  KEY idx_nr_store (store_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

/* ==================================================================
   SQLite 建表语句（兜底 / 离线可用）
   ================================================================== */
const SQLITE_DDL = `
CREATE TABLE IF NOT EXISTS tenants (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password      TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'agent',
  status        TEXT NOT NULL DEFAULT 'active',
  title         TEXT DEFAULT '',
  points        INTEGER NOT NULL DEFAULT 1000,
  store_ids     TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stores (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  name       TEXT NOT NULL,
  platform   TEXT NOT NULL,
  short      TEXT NOT NULL,
  color      TEXT NOT NULL,
  account    TEXT DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'active',
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  store_id      TEXT NOT NULL,
  customer      TEXT NOT NULL,
  tags          TEXT DEFAULT '[]',
  order_no      TEXT DEFAULT '',
  order_product TEXT DEFAULT '',
  order_amount  TEXT DEFAULT '',
  order_status  TEXT DEFAULT '',
  unread        INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'waiting',
  sentiment     TEXT NOT NULL DEFAULT 'neutral',
  last_msg      TEXT DEFAULT '',
  last_time     TEXT DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT '',
  transferred_at TEXT NOT NULL DEFAULT '',
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id  TEXT NOT NULL,
  conv_id    TEXT NOT NULL,
  role       TEXT NOT NULL,
  text       TEXT NOT NULL,
  time       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT '',
  payload    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conv_id);

CREATE TABLE IF NOT EXISTS tickets (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  store_id   TEXT NOT NULL,
  type       TEXT NOT NULL,
  type_label TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',
  priority   TEXT NOT NULL DEFAULT 'normal',
  customer   TEXT NOT NULL,
  order_no   TEXT DEFAULT '',
  product    TEXT DEFAULT '',
  amount     TEXT DEFAULT '',
  reason     TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ticket_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  time      TEXT NOT NULL,
  text      TEXT NOT NULL,
  actor     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evt_ticket ON ticket_events(ticket_id);

CREATE TABLE IF NOT EXISTS knowledge (
  id        TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  q         TEXT NOT NULL,
  a         TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quick_replies (
  id        TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  text      TEXT NOT NULL,
  category  TEXT NOT NULL DEFAULT '通用',
  scope     TEXT NOT NULL DEFAULT 'personal',
  use_count INTEGER NOT NULL DEFAULT 0,
  used_at   TEXT NOT NULL DEFAULT '',
  sort      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  tenant_id TEXT NOT NULL,
  key       TEXT NOT NULL,
  value     TEXT,
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  user_id   TEXT,
  user_name TEXT,
  action    TEXT NOT NULL,
  target    TEXT DEFAULT '',
  ip        TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_tenant ON audit_logs(tenant_id);

CREATE TABLE IF NOT EXISTS conv_ai_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id  TEXT NOT NULL,
  conv_id    TEXT,
  mode       TEXT,
  adopted    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS flow_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id    TEXT NOT NULL,
  flow_id      TEXT NOT NULL,
  flow_name    TEXT NOT NULL,
  conv_id      TEXT,
  customer     TEXT DEFAULT '',
  intent       TEXT DEFAULT '',
  trigger_text TEXT,
  reply        TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_flowrun_tenant ON flow_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_flowrun_flow ON flow_runs(flow_id);

CREATE TABLE IF NOT EXISTS bridge_outbox (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id  TEXT NOT NULL,
  store_id   TEXT NOT NULL,
  conv_id    TEXT NOT NULL,
  visitor_id TEXT DEFAULT '',
  customer   TEXT DEFAULT '',
  text       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',
  error      TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  sent_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_bo_store ON bridge_outbox(store_id, status);

CREATE TABLE IF NOT EXISTS qc_reviews (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  customer   TEXT NOT NULL,
  store_id   TEXT DEFAULT '',
  agent      TEXT DEFAULT '',
  score      INTEGER NOT NULL DEFAULT 80,
  level      TEXT NOT NULL DEFAULT 'good',
  issues     TEXT DEFAULT '[]',
  snippet    TEXT DEFAULT '',
  reply      TEXT DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qc_tenant ON qc_reviews(tenant_id);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'system',
  title      TEXT NOT NULL,
  body       TEXT DEFAULT '',
  level      TEXT NOT NULL DEFAULT 'info',
  read       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ntf_tenant ON notifications(tenant_id);

CREATE TABLE IF NOT EXISTS materials (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'image',
  tag        TEXT DEFAULT '',
  size       TEXT DEFAULT '',
  color      TEXT DEFAULT '#165DFF',
  content    TEXT DEFAULT '',
  poster     TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mat_tenant ON materials(tenant_id);

CREATE TABLE IF NOT EXISTS alerts (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  conv_id    TEXT DEFAULT '',
  customer   TEXT NOT NULL,
  store_id   TEXT DEFAULT '',
  type       TEXT NOT NULL DEFAULT '情绪激动',
  level      TEXT NOT NULL DEFAULT 'mid',
  text       TEXT DEFAULT '',
  handled    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alert_tenant ON alerts(tenant_id);

CREATE TABLE IF NOT EXISTS agent_flows (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  description  TEXT DEFAULT '',
  name         TEXT NOT NULL,
  trigger_type TEXT DEFAULT 'message',
  trigger_desc TEXT DEFAULT '',
  steps        TEXT DEFAULT '[]',
  enabled      INTEGER NOT NULL DEFAULT 1,
  runs         INTEGER NOT NULL DEFAULT 0,
  success_rate INTEGER NOT NULL DEFAULT 95,
  sort         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_flow_tenant ON agent_flows(tenant_id);

/* ---------------- 平台真实接入：凭据 / 调用日志 / 同步数据 ---------------- */
CREATE TABLE IF NOT EXISTS store_credentials (
  store_id        TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  platform        TEXT NOT NULL,
  api_env         TEXT NOT NULL DEFAULT 'prod',
  app_key         TEXT NOT NULL DEFAULT '',
  app_secret_enc  TEXT,
  session_enc     TEXT,
  refresh_enc     TEXT,
  token_expire_at INTEGER NOT NULL DEFAULT 0,
  re_expire_at    INTEGER NOT NULL DEFAULT 0,
  shop_id         TEXT DEFAULT '',
  seller_uid      TEXT DEFAULT '',
  seller_nick     TEXT DEFAULT '',
  shop_title      TEXT DEFAULT '',
  shop_pic        TEXT DEFAULT '',
  redirect_uri    TEXT DEFAULT '',
  auth_status     TEXT NOT NULL DEFAULT 'pending',
  auth_error      TEXT DEFAULT '',
  tmc_group       TEXT DEFAULT 'default',
  tmc_last_id     INTEGER NOT NULL DEFAULT 0,
  last_sync_at    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS connector_logs (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id  TEXT NOT NULL,
  store_id   TEXT DEFAULT '',
  platform   TEXT NOT NULL,
  method     TEXT NOT NULL,
  ok         INTEGER NOT NULL DEFAULT 0,
  code       TEXT DEFAULT '',
  message    TEXT DEFAULT '',
  ms         INTEGER NOT NULL DEFAULT 0,
  detail     TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clog_store ON connector_logs(store_id);

CREATE TABLE IF NOT EXISTS shop_orders (
  tid        TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  store_id   TEXT NOT NULL,
  buyer_nick TEXT DEFAULT '',
  status     TEXT DEFAULT '',
  payment    TEXT DEFAULT '',
  total_fee  TEXT DEFAULT '',
  created    TEXT DEFAULT '',
  pay_time   TEXT DEFAULT '',
  receiver   TEXT DEFAULT '',
  title      TEXT DEFAULT '',
  items_json TEXT,
  synced_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shop_items (
  num_iid   TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  store_id  TEXT NOT NULL,
  title     TEXT DEFAULT '',
  price     TEXT DEFAULT '',
  num       INTEGER NOT NULL DEFAULT 0,
  outer_id  TEXT DEFAULT '',
  pic_url   TEXT DEFAULT '',
  status    TEXT DEFAULT '',
  modified  TEXT DEFAULT '',
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shop_refunds (
  refund_id  TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  store_id   TEXT NOT NULL,
  tid        TEXT DEFAULT '',
  buyer_nick TEXT DEFAULT '',
  status     TEXT DEFAULT '',
  refund_fee TEXT DEFAULT '',
  reason     TEXT DEFAULT '',
  memo       TEXT DEFAULT '',
  item_title TEXT DEFAULT '',
  created    TEXT DEFAULT '',
  modified   TEXT DEFAULT '',
  synced_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tmc_messages (
  msg_id     TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  store_id   TEXT NOT NULL,
  topic      TEXT NOT NULL,
  pub_time   TEXT DEFAULT '',
  user_nick  TEXT DEFAULT '',
  content    TEXT,
  handled    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tmc_store ON tmc_messages(store_id);

CREATE TABLE IF NOT EXISTS store_knowledge (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  store_id   TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'product',
  product_id TEXT DEFAULT '',
  question   TEXT DEFAULT '',
  answer     TEXT,
  status     TEXT NOT NULL DEFAULT 'off',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sk_store ON store_knowledge(store_id);

CREATE TABLE IF NOT EXISTS notify_groups (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  name           TEXT NOT NULL,
  channel        TEXT NOT NULL DEFAULT 'wecom',
  chat_id        TEXT DEFAULT '',
  webhook_url    TEXT NOT NULL DEFAULT '',
  notify_count   INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'pending',
  last_notify_at TEXT DEFAULT '',
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ng_tenant ON notify_groups(tenant_id);

CREATE TABLE IF NOT EXISTS store_notify_rules (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  store_id   TEXT NOT NULL,
  seq        INTEGER NOT NULL DEFAULT 0,
  group_name TEXT DEFAULT '',
  keywords   TEXT DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nr_store ON store_notify_rules(store_id);
`;

/* ==================================================================
   驱动装载
   ================================================================== */
let driver = 'sqlite';
let label = '';
let sqliteHandle = null;
let mysqlHandle = null;
let sqliteApi = null;

function bootSQLite() {
  const _emit = process.emitWarning;
  process.emitWarning = function (w, ...rest) {
    if (String(w).indexOf('SQLite') >= 0) return;
    return _emit.call(process, w, ...rest);
  };
  const { DatabaseSync } = require('node:sqlite');
  const h = new DatabaseSync(DB_FILE);
  try { h.exec('PRAGMA journal_mode = WAL'); } catch (e) { /* ignore */ }
  h.exec('PRAGMA foreign_keys = ON');
  h.exec(SQLITE_DDL);
  sqliteHandle = h;
  driver = 'sqlite';
  label = 'SQLite · ' + DB_FILE;
  return h;
}

function bootMySQL() {
  const { MysqlClient } = require('./mysql-client');
  const cfg = mysqlConfig();
  const client = new MysqlClient(cfg);
  client.exec(MYSQL_DDL);
  mysqlHandle = client;
  driver = 'mysql';
  label = `MySQL · ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`;
  return client;
}

const bootLog = [];

if (WANT_DRIVER === 'sqlite') {
  bootSQLite();
  bootLog.push('DB_DRIVER=sqlite，使用本地 SQLite 文件');
} else {
  try {
    bootMySQL();
    bootLog.push('MySQL 连接成功，所有数据写入 MySQL');
  } catch (e) {
    if (String(process.env.DB_STRICT || '') === '1') throw e;
    bootLog.push('MySQL 连接失败（' + String(e.message).slice(0, 120) + '），已回落到 SQLite');
    bootSQLite();
  }
}

/* ==================================================================
   同步 API
   ================================================================== */
function norm(args) {
  return args.map((v) => {
    if (v === undefined) return null;
    if (v === true) return 1;
    if (v === false) return 0;
    if (typeof v === 'object' && v !== null) return JSON.stringify(v);
    if (typeof v === 'bigint') return Number(v);
    return v;
  });
}

function all(sql, ...args) {
  if (driver === 'mysql') return mysqlHandle.all(sql, norm(args));
  return sqliteHandle.prepare(sql).all(...norm(args));
}

function get(sql, ...args) {
  if (driver === 'mysql') return mysqlHandle.get(sql, norm(args));
  const r = sqliteHandle.prepare(sql).get(...norm(args));
  return r === undefined ? null : r;
}

function run(sql, ...args) {
  if (driver === 'mysql') return mysqlHandle.run(sql, norm(args));
  return sqliteHandle.prepare(sql).run(...norm(args));
}

/** 仅供迁移脚本使用：切换底层实现（不改变 driver） */
function rawQuery(sql, params) {
  if (driver === 'mysql') return mysqlHandle.query(sql, params || []);
  return { rows: sqliteHandle.prepare(sql).all(...(params || [])) };
}

/* ---------------- 通用工具 ---------------- */
const pad = (n) => String(n).padStart(2, '0');

function nowISO() {
  return new Date().toISOString();
}
function nowHM() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(9).toString('hex')}`;
}

/* ---------------- settings 便捷读写 ---------------- */
function getSetting(tenantId, key, dft = null) {
  const r = get('SELECT value FROM settings WHERE tenant_id = ? AND key = ?', tenantId, key);
  if (!r) return dft;
  const raw = r.value;
  try { return JSON.parse(raw); } catch (e) { return raw; }
}

function setSetting(tenantId, key, value) {
  const v = JSON.stringify(value);
  if (driver === 'mysql') {
    run(
      'INSERT INTO settings (tenant_id, `key`, `value`) VALUES (?,?,?) ' +
      'ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
      tenantId, key, v
    );
  } else {
    run(
      'INSERT INTO settings (tenant_id, key, value) VALUES (?,?,?) ' +
      'ON CONFLICT(tenant_id,key) DO UPDATE SET value = excluded.value',
      tenantId, key, v
    );
  }
}

function audit(tenantId, user, action, target, ip) {
  run(
    'INSERT INTO audit_logs (tenant_id,user_id,user_name,action,target,ip,created_at) VALUES (?,?,?,?,?,?,?)',
    tenantId, user ? user.id : null, user ? user.name : 'system', action, target || '', ip || '', nowISO()
  );
}

/** 启动信息（供服务端日志展示） */
function info() {
  const cfg = mysqlConfig();
  return {
    driver,
    label,
    mysql: driver === 'mysql'
      ? { host: cfg.host, port: cfg.port, user: cfg.user, database: cfg.database }
      : null,
    sqliteFile: DB_FILE,
    notes: bootLog,
  };
}

/* ---------------- 轻量迁移：给已存在的老库补列 ---------------- */
function tableColumns(table) {
  try {
    if (driver === 'mysql') {
      return rawQuery(
        'SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
        [table]
      ).rows.map((r) => String(r.c).toLowerCase());
    }
    return rawQuery(`PRAGMA table_info(${table})`).rows.map((r) => String(r.name).toLowerCase());
  } catch (e) {
    return [];
  }
}

function ensureColumns() {
  const wanted = [
    ['quick_replies', 'category', "VARCHAR(64) NOT NULL DEFAULT '通用'", "TEXT NOT NULL DEFAULT '通用'"],
    ['quick_replies', 'scope', "VARCHAR(16) NOT NULL DEFAULT 'personal'", "TEXT NOT NULL DEFAULT 'personal'"],
    ['quick_replies', 'use_count', 'INT NOT NULL DEFAULT 0', 'INTEGER NOT NULL DEFAULT 0'],
    ['quick_replies', 'used_at', "VARCHAR(40) NOT NULL DEFAULT ''", "TEXT NOT NULL DEFAULT ''"],
    /* 会话：进线时间与转人工时间，用于「今日进线 / 今日转接 / 转换率」真实统计 */
    ['conversations', 'created_at', "VARCHAR(40) NOT NULL DEFAULT ''", "TEXT NOT NULL DEFAULT ''"],
    ['conversations', 'transferred_at', "VARCHAR(40) NOT NULL DEFAULT ''", "TEXT NOT NULL DEFAULT ''"],
    /* 商品：AI 学习出来的详情参数（产品介绍 / 规格信息 / 属性信息） */
    ['shop_items', 'description', 'MEDIUMTEXT', 'TEXT'],
    ['shop_items', 'specs', 'TEXT', 'TEXT'],
    ['shop_items', 'attrs', 'TEXT', 'TEXT'],
    /* 知识 / 店铺知识：可引用已上传的素材 */
    ['knowledge', 'material_id', "VARCHAR(64) NOT NULL DEFAULT ''", "TEXT NOT NULL DEFAULT ''"],
    ['store_knowledge', 'material_id', "VARCHAR(64) NOT NULL DEFAULT ''", "TEXT NOT NULL DEFAULT ''"],
    /* 通知群：真实群机器人 Webhook 地址（企业微信/钉钉/飞书） */
    ['notify_groups', 'webhook_url', "VARCHAR(512) NOT NULL DEFAULT ''", "TEXT NOT NULL DEFAULT ''"],
    /* 子账号：AI 剩余点数 + 可接管的店铺（逗号分隔 store.id） */
    ['users', 'points', 'INT NOT NULL DEFAULT 1000', 'INTEGER NOT NULL DEFAULT 1000'],
    /* 子账号权限：JSON {"modules":["overview",...],"ops":false}，NULL=未配置（默认只读可看全部基础模块） */
    ['users', 'permissions', "TEXT", "TEXT"],
    /* 素材：封面图（视频素材无 content 时用它做卡片缩略图） */
    ['materials', 'poster', "VARCHAR(255) NOT NULL DEFAULT ''", "TEXT NOT NULL DEFAULT ''"],
    /* 消息：消息类型，text=普通文本、order=订单卡片 */
    ['messages', 'kind', "VARCHAR(16) NOT NULL DEFAULT ''", "TEXT NOT NULL DEFAULT ''"],
    ['messages', 'payload', "TEXT", "TEXT"],
    ['users', 'store_ids', "VARCHAR(512) NOT NULL DEFAULT ''", "TEXT NOT NULL DEFAULT ''"],
    /* 店铺：对外消息接收入口（咨询页短码 + Webhook 令牌 + 是否 AI 首响） */
    ['stores', 'inbox_code', "VARCHAR(24) NOT NULL DEFAULT ''", "TEXT NOT NULL DEFAULT ''"],
    ['stores', 'inbox_token', "VARCHAR(64) NOT NULL DEFAULT ''", "TEXT NOT NULL DEFAULT ''"],
    ['stores', 'inbox_ai', "INT NOT NULL DEFAULT 1", "INTEGER NOT NULL DEFAULT 1"],
    ['stores', 'inbox_welcome', "VARCHAR(200) NOT NULL DEFAULT ''", "TEXT NOT NULL DEFAULT ''"],
    /* 会话：消息来源渠道与访客标识（用于同一买家多次发消息归到同一会话） */
    ['conversations', 'channel', "VARCHAR(24) NOT NULL DEFAULT ''", "TEXT NOT NULL DEFAULT ''"],
    ['conversations', 'visitor_id', "VARCHAR(64) NOT NULL DEFAULT ''", "TEXT NOT NULL DEFAULT ''"],
  ];
  const cache = {};
  for (const [table, col, myType, liteType] of wanted) {
    if (!cache[table]) cache[table] = tableColumns(table);
    const have = cache[table];
    if (!have.length) continue;
    if (have.indexOf(col) >= 0) continue;
    try {
      run(`ALTER TABLE ${table} ADD COLUMN ${col} ${driver === 'mysql' ? myType : liteType}`);
      have.push(col);
    } catch (e) { /* 并发建列或权限不足时忽略，不影响启动 */ }
  }

  /* 回填：历史会话没有进线时间，用最后更新时间兜底 */
  try {
    run("UPDATE conversations SET created_at = updated_at WHERE created_at = '' OR created_at IS NULL");
    run("UPDATE conversations SET transferred_at = updated_at WHERE transferred_at = '' AND status = 'human'");
  } catch (e) { /* ignore */ }

  /* 回填：子账号点数与店铺归属（管理员管全部店铺，坐席按账号轮询分配） */
  try {
    run('UPDATE users SET points = 1000 WHERE points IS NULL OR points < 0');
    const allStoreIds = all('SELECT id FROM stores ORDER BY id').map((s) => s.id);
    run("UPDATE users SET store_ids = ? WHERE role = 'admin' AND (store_ids IS NULL OR store_ids = '')", allStoreIds.join(','));
    const agents = all("SELECT id FROM users WHERE role = 'agent' AND (store_ids IS NULL OR store_ids = '') ORDER BY id");
    if (agents.length) {
      agents.forEach((a, i) => {
        const mine = allStoreIds.filter((_, k) => k % agents.length === i);
        run('UPDATE users SET store_ids = ? WHERE id = ?', mine.join(','), a.id);
      });
    }
  } catch (e) { /* ignore */ }
}
try { ensureColumns(); } catch (e) { /* ignore */ }

module.exports = {
  db: mysqlHandle || sqliteHandle,
  sqlite: sqliteHandle,
  mysql: mysqlHandle,
  get driver() { return driver; },
  get label() { return label; },
  DB_FILE, DATA_DIR,
  all, get, run, rawQuery, uid, nowISO, nowHM,
  getSetting, setSetting, audit, info,
};
