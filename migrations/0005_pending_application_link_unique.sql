-- 同一链接只允许一条待审申请；并发提交由唯一索引兜底。
-- 历史重复数据保留最新一条，其余标记为已拒绝，避免建索引失败。
UPDATE applications
   SET status = 'rejected',
       review_note = '重复待审链接（升级时自动合并）',
       reviewed_at = datetime('now')
 WHERE status = 'pending'
   AND id NOT IN (
     SELECT MAX(id) FROM applications WHERE status = 'pending' GROUP BY link
   );

CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_pending_link
  ON applications (link) WHERE status = 'pending';
