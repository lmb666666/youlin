import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * Drizzle schema：与 migrations/*.sql 的 SQLite 结构一一对应。
 *
 * 迁移仍由现有 raw SQL 迁移器负责；这里只作为查询与类型层，避免两套 DDL 同时生成。
 */

export const groups = sqliteTable(
  'groups',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    desc: text('desc'),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [uniqueIndex('idx_groups_name').on(t.name)],
)

export const friends = sqliteTable(
  'friends',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    author: text('author').notNull(),
    nickname: text('nickname'),
    title: text('title'),
    desc: text('desc'),
    link: text('link').notNull(),
    feed: text('feed'),
    icon: text('icon'),
    avatar: text('avatar'),
    archs: text('archs', { mode: 'json' }).$type<string[]>(),
    since: text('since').notNull(),
    comment: text('comment'),
    inCircle: integer('in_circle').notNull().default(1),
    status: text('status').notNull().default('active'),
    sort: integer('sort').notNull().default(0),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex('idx_friends_link').on(t.link),
    index('idx_friends_group').on(t.groupId, t.sort),
  ],
)

export const articles = sqliteTable(
  'articles',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    friendId: integer('friend_id')
      .notNull()
      .references(() => friends.id, { onDelete: 'cascade' }),
    guid: text('guid').notNull(),
    title: text('title').notNull(),
    link: text('link').notNull(),
    author: text('author'),
    publishedAt: text('published_at').notNull(),
    fetchedAt: text('fetched_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex('idx_articles_key').on(t.friendId, t.guid),
    index('idx_articles_published').on(t.publishedAt),
  ],
)

export const sourceState = sqliteTable('source_state', {
  friendId: integer('friend_id')
    .primaryKey()
    .references(() => friends.id, { onDelete: 'cascade' }),
  etag: text('etag'),
  lastModified: text('last_modified'),
  reachable: integer('reachable'),
  crawlable: integer('crawlable'),
  bestMethod: text('best_method'),
  httpStatus: integer('http_status'),
  latencyMs: integer('latency_ms'),
  finalUrl: text('final_url'),
  backlinkChecked: integer('backlink_checked'),
  backlink: integer('backlink'),
  unreachableSince: text('unreachable_since'),
  rssUnavailableSince: text('rss_unavailable_since'),
  lastPostPublished: text('last_post_published'),
  lastPostDaysAgo: integer('last_post_days_ago'),
  lastOkAt: text('last_ok_at'),
  lastError: text('last_error'),
  failCount: integer('fail_count').notNull().default(0),
  nextCheckAt: text('next_check_at'),
  checkedAt: text('checked_at'),
})

export const applications = sqliteTable(
  'applications',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    siteName: text('site_name').notNull(),
    author: text('author'),
    link: text('link').notNull(),
    avatar: text('avatar'),
    feed: text('feed'),
    desc: text('desc'),
    contact: text('contact'),
    note: text('note'),
    backlinkOk: integer('backlink_ok'),
    backlinkCheckedAt: text('backlink_checked_at'),
    backlinkDetail: text('backlink_detail'),
    status: text('status').notNull().default('pending'),
    reviewNote: text('review_note'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    reviewedAt: text('reviewed_at'),
  },
  (t) => [
    index('idx_applications_status').on(t.status, t.createdAt),
    uniqueIndex('idx_applications_pending_link').on(t.link).where(sql`${t.status} = 'pending'`),
  ],
)

export const applyRateLimit = sqliteTable(
  'apply_rate_limit',
  {
    ip: text('ip').notNull(),
    day: text('day').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.ip, t.day] })],
)

export const loginAttempts = sqliteTable(
  'login_attempts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ip: text('ip').notNull(),
    at: integer('at').notNull(),
  },
  (t) => [index('idx_login_attempts_ip_at').on(t.ip, t.at)],
)

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

export type GroupRow = typeof groups.$inferSelect
export type FriendRow = typeof friends.$inferSelect
export type ArticleRow = typeof articles.$inferSelect
export type SourceStateRow = typeof sourceState.$inferSelect
export type ApplicationRow = typeof applications.$inferSelect
export type SettingRow = typeof settings.$inferSelect
