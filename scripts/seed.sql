-- 本地示例数据（幂等：重复执行不产生重复行）
-- 执行：pnpm seed   （= wrangler d1 execute youlin --local --file=scripts/seed.sql）

INSERT INTO groups (name, "desc", sort)
SELECT '朋友们', '在这里添加你关注的博客。', 0
WHERE NOT EXISTS (SELECT 1 FROM groups WHERE name = '朋友们');

INSERT INTO groups (name, "desc", sort)
SELECT '技术区', '技术与开发博客。', 1
WHERE NOT EXISTS (SELECT 1 FROM groups WHERE name = '技术区');

INSERT INTO friends (group_id, author, nickname, title, "desc", link, feed, icon, avatar, archs, since, comment, sort)
SELECT (SELECT id FROM groups WHERE name = '朋友们'), 'Liang', '老梁', 'Liang 的博客', '一位数码科技爱好者',
       'https://blog.liang.one/', 'https://blog.liang.one/atom.xml', 'https://blog.liang.one/favicon.ico',
       'https://bu.dusays.com/2026/07/12/6a532cc8ab04a.webp', '["Nuxt"]', '2024-08-25', '好友，数码科技方向', 0
WHERE NOT EXISTS (SELECT 1 FROM friends WHERE link = 'https://blog.liang.one/');

INSERT INTO friends (group_id, author, title, "desc", link, feed, icon, since, sort)
SELECT (SELECT id FROM groups WHERE name = '朋友们'), 'Aki', 'Aki 的小站', '随手记录生活',
       'https://aki.example.com/', 'https://aki.example.com/feed.xml', 'https://aki.example.com/favicon.ico', '2025-01-02', 1
WHERE NOT EXISTS (SELECT 1 FROM friends WHERE link = 'https://aki.example.com/');

INSERT INTO friends (group_id, author, title, "desc", link, feed, icon, archs, since, sort)
SELECT (SELECT id FROM groups WHERE name = '技术区'), 'Bo', 'Bo 的实验室', '前端与工程化',
       'https://bo.example.com/', 'https://bo.example.com/rss.xml', 'https://bo.example.com/favicon.ico',
       '["VitePress"]', '2025-06-11', 0
WHERE NOT EXISTS (SELECT 1 FROM friends WHERE link = 'https://bo.example.com/');

INSERT INTO friends (group_id, author, title, link, icon, since, status, sort)
SELECT (SELECT id FROM groups WHERE name = '技术区'), 'Cy', 'Cy 的笔记', 'https://cy.example.com/',
       'https://cy.example.com/favicon.ico', '2025-09-01', 'hidden', 1
WHERE NOT EXISTS (SELECT 1 FROM friends WHERE link = 'https://cy.example.com/');

-- 示例体检状态（体现 health 字段输出）
INSERT INTO source_state (friend_id, reachable, crawlable, backlink_checked, backlink, latency_ms,
                          last_post_published, last_post_days_ago, checked_at)
SELECT f.id, 1, 1, 1, 1, 840, datetime('now', '-3 days'), 3, datetime('now', '-1 hour')
FROM friends f WHERE f.link = 'https://blog.liang.one/'
  AND NOT EXISTS (SELECT 1 FROM source_state s WHERE s.friend_id = f.id);

INSERT INTO source_state (friend_id, reachable, crawlable, backlink_checked, backlink, latency_ms,
                          unreachable_since, last_error, fail_count, checked_at)
SELECT f.id, 0, 0, 1, 0, NULL, datetime('now', '-12 days'), 'DNS resolution failed', 4, datetime('now', '-2 hour')
FROM friends f WHERE f.link = 'https://bo.example.com/'
  AND NOT EXISTS (SELECT 1 FROM source_state s WHERE s.friend_id = f.id);

-- 示例朋友圈文章（体现接口二数据形状；正式抓取在 P1 接入）
INSERT INTO articles (friend_id, guid, title, link, author, published_at)
SELECT f.id, 'seed-1', '近期小记（1）', 'https://blog.liang.one/posts/6b4e8a1', 'Liang', '2026-09-20T12:04:00Z'
FROM friends f WHERE f.link = 'https://blog.liang.one/'
  AND NOT EXISTS (SELECT 1 FROM articles a WHERE a.friend_id = f.id AND a.guid = 'seed-1');

INSERT INTO articles (friend_id, guid, title, link, author, published_at)
SELECT f.id, 'seed-2', '家用 NAS 折腾手记', 'https://blog.liang.one/posts/nas-notes', 'Liang', '2026-09-28T09:30:00Z'
FROM friends f WHERE f.link = 'https://blog.liang.one/'
  AND NOT EXISTS (SELECT 1 FROM articles a WHERE a.friend_id = f.id AND a.guid = 'seed-2');
