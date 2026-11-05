-- 登录尝试日志：按 IP 做一小时滑动窗口限流（跨进程/重启生效）
CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_at ON login_attempts (ip, at);
