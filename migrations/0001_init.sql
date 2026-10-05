-- 友邻 Youlin · 初始结构（DESIGN §3）
-- 迁移文件只增不改；破坏性结构变更开新文件。

CREATE TABLE groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  "desc" TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);

-- 友链（字段对应接口一的 links）
CREATE TABLE friends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  nickname TEXT,                               -- 网站趣称
  title TEXT,
  "desc" TEXT,
  link TEXT NOT NULL,
  feed TEXT,
  icon TEXT,
  avatar TEXT,
  archs TEXT,                                  -- JSON 数组
  since TEXT NOT NULL,                         -- 订阅日期 YYYY-MM-DD
  comment TEXT,
  in_circle INTEGER NOT NULL DEFAULT 1,        -- 纳入朋友圈抓取（关掉即不进朋友圈）
  status TEXT NOT NULL DEFAULT 'active',       -- active | hidden（hidden 不出现在接口输出）
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_friends_link ON friends(link);
CREATE INDEX idx_friends_group ON friends(group_id, sort);

CREATE TABLE articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  friend_id INTEGER NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  guid TEXT NOT NULL,                          -- 去重键：guid，缺失时用 link 的 sha1
  title TEXT NOT NULL,
  link TEXT NOT NULL,
  author TEXT,
  published_at TEXT NOT NULL,                  -- 发布时间（ISO 8601 UTC）
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_articles_key ON articles(friend_id, guid);
CREATE INDEX idx_articles_published ON articles(published_at DESC);

-- 每源抓取/体检状态（对应接口一的 health 字段）
CREATE TABLE source_state (
  friend_id INTEGER PRIMARY KEY REFERENCES friends(id) ON DELETE CASCADE,
  etag TEXT,
  last_modified TEXT,
  reachable INTEGER,                           -- 0/1/null（null=未检测）
  crawlable INTEGER,
  best_method TEXT,                            -- rss | homepage | api | none
  http_status INTEGER,
  latency_ms INTEGER,
  final_url TEXT,
  backlink_checked INTEGER,
  backlink INTEGER,
  unreachable_since TEXT,
  rss_unavailable_since TEXT,
  last_post_published TEXT,
  last_post_days_ago INTEGER,
  last_ok_at TEXT,
  last_error TEXT,
  fail_count INTEGER NOT NULL DEFAULT 0,
  next_check_at TEXT,
  checked_at TEXT
);

CREATE TABLE applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_name TEXT NOT NULL,
  author TEXT,
  link TEXT NOT NULL,
  avatar TEXT,
  feed TEXT,
  "desc" TEXT,
  contact TEXT,
  note TEXT,
  backlink_ok INTEGER,
  backlink_checked_at TEXT,
  backlink_detail TEXT,
  status TEXT NOT NULL DEFAULT 'pending',      -- pending | approved | rejected
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);
CREATE INDEX idx_applications_status ON applications(status, created_at);

-- 应用级配置（§9）：key 为 camelCase 点号键（如 site.name），value 为 JSON 编码值
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
