-- P2：申请限流（DESIGN §4.3「每 IP 每天 apply.rateLimitPerDay 次」）
-- 只统计"成功提交"的申请；计数按 UTC 日期分桶，旧日期行在提交时机会性清理。
CREATE TABLE apply_rate_limit (
  ip TEXT NOT NULL,
  day TEXT NOT NULL,          -- YYYY-MM-DD（UTC）
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, day)
);
