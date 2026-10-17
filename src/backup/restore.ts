import type { Env } from '../types'
import { fieldSchemas } from '../config/schema'
import { dbTime } from '../util/time'
import { jsonError } from '../util/http'
import type { BackupEnvelope } from './format'

/**
 * 恢复：覆盖式写入。
 *
 * 自然键（分组名、友链链接）映射到新库的自增 id，因此不依赖 sqlite_sequence。
 * 先清空再写入，同一文件重跑结果一致；中途失败时重试同一文件即可。
 * D1 的单次 batch 有语句/子请求上限，故按 100 条一批提交；批次之间不构成事务，
 * 所以清空放在最前、写入顺序按外键依赖（分组 → 友链 → 文章/状态 → 申请）。
 */

const CHUNK = 100

export interface RestoreSummary {
  groups: number
  friends: number
  applications: number
  articles: number
  sourceState: number
  settings: number
  settingsSkipped: number
}

export type RestoreOutcome = { ok: true; summary: RestoreSummary } | { ok: false; response: Response }

async function runChunked<T>(
  stmts: T[],
  run: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < stmts.length; i += CHUNK) {
    await run(stmts.slice(i, i + CHUNK))
  }
}

function validate(envelope: BackupEnvelope): Response | null {
  const { groups, friends, articles, sourceState } = envelope.data

  const groupNames = new Set<string>()
  for (const g of groups) {
    if (groupNames.has(g.name)) return jsonError(400, 'duplicate_group', `备份内分组重名：${g.name}`)
    groupNames.add(g.name)
  }

  const links = new Set<string>()
  for (const f of friends) {
    if (links.has(f.link)) return jsonError(400, 'duplicate_link', `备份内友链重复：${f.link}`)
    links.add(f.link)
    if (!groupNames.has(f.group)) {
      return jsonError(400, 'broken_reference', `友链 ${f.link} 指向不存在的分组「${f.group}」`)
    }
  }

  for (const a of articles ?? []) {
    if (!links.has(a.friend)) {
      return jsonError(400, 'broken_reference', `文章 ${a.link} 指向不存在的友链 ${a.friend}`)
    }
  }
  for (const s of sourceState ?? []) {
    if (!links.has(s.friend)) {
      return jsonError(400, 'broken_reference', `体检状态指向不存在的友链 ${s.friend}`)
    }
  }
  return null
}

function boolInt(v: boolean | null | undefined): number | null {
  if (v === null || v === undefined) return null
  return v ? 1 : 0
}

export async function applyRestore(
  db: Env['DB'],
  envelope: BackupEnvelope,
): Promise<RestoreOutcome> {
  const broken = validate(envelope)
  if (broken) return { ok: false, response: broken }

  const { groups, friends, applications, settings, articles = [], sourceState = [] } = envelope.data
  const configKeys = Object.keys(fieldSchemas)

  // 1. 清空（顺序按外键依赖；不触碰 settings 里的 internal.* 运行时键）
  const wipe = [
    db.prepare('DELETE FROM articles'),
    db.prepare('DELETE FROM source_state'),
    db.prepare('DELETE FROM applications'),
    db.prepare('DELETE FROM friends'),
    db.prepare('DELETE FROM groups'),
  ]
  for (let i = 0; i < configKeys.length; i += CHUNK) {
    const chunk = configKeys.slice(i, i + CHUNK)
    wipe.push(db.prepare(`DELETE FROM settings WHERE key IN (${chunk.map(() => '?').join(',')})`).bind(...chunk))
  }
  await db.batch(wipe)

  // 2. 分组（按 sort 顺序写入，保留展示顺序）
  const groupIdByName = new Map<string, number>()
  const orderedGroups = [...groups].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
  await runChunked(orderedGroups, async (chunk) => {
    const results = await db.batch(
      chunk.map((g) => db.prepare('INSERT INTO groups (name, "desc", sort) VALUES (?, ?, ?)').bind(g.name, g.desc ?? null, g.sort)),
    )
    chunk.forEach((g, i) => {
      const id = Number(results[i]?.meta.last_row_id)
      if (id > 0) groupIdByName.set(g.name, id)
    })
  })

  // 3. 友链
  const friendIdByLink = new Map<string, number>()
  const orderedFriends = [...friends].sort((a, b) => a.sort - b.sort || a.link.localeCompare(b.link))
  await runChunked(orderedFriends, async (chunk) => {
    const results = await db.batch(
      chunk.map((f) =>
        db
          .prepare(
            `INSERT INTO friends (group_id, author, nickname, title, "desc", link, feed, icon, avatar, archs,
                                  since, comment, in_circle, status, sort, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
          )
          .bind(
            groupIdByName.get(f.group)!, f.author, f.nickname ?? null, f.title ?? null, f.desc ?? null,
            f.link, f.feed ?? null, f.icon ?? null, f.avatar ?? null,
            f.archs && f.archs.length > 0 ? JSON.stringify(f.archs) : null,
            f.since, f.comment ?? null, f.inCircle ? 1 : 0, f.status, f.sort,
            f.createdAt ? dbTime(f.createdAt) : null,
          ),
      ),
    )
    chunk.forEach((f, i) => {
      const id = Number(results[i]?.meta.last_row_id)
      if (id > 0) friendIdByLink.set(f.link, id)
    })
  })

  // 4. 文章（可选；按 (友链, guid) 去重）
  const seenArticles = new Set<string>()
  const articleStmts = articles
    .filter((a) => {
      const key = `${a.friend}\u0000${a.guid}`
      if (seenArticles.has(key)) return false
      seenArticles.add(key)
      return true
    })
    .map((a) =>
      db
        .prepare(
          `INSERT INTO articles (friend_id, guid, title, link, author, published_at, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
        )
        .bind(friendIdByLink.get(a.friend)!, a.guid, a.title, a.link, a.author ?? null, dbTime(a.publishedAt), a.fetchedAt ? dbTime(a.fetchedAt) : null),
    )
  await runChunked(articleStmts, (chunk) => db.batch(chunk))

  // 5. 体检状态（可选；每个友链一条）
  const seenStates = new Set<string>()
  const stateStmts = sourceState
    .filter((s) => {
      if (seenStates.has(s.friend)) return false
      seenStates.add(s.friend)
      return true
    })
    .map((s) =>
      db
        .prepare(
          `INSERT INTO source_state (friend_id, etag, last_modified, reachable, crawlable, best_method, http_status,
                                     latency_ms, final_url, backlink_checked, backlink, unreachable_since,
                                     rss_unavailable_since, last_post_published, last_post_days_ago, last_ok_at,
                                     last_error, fail_count, next_check_at, checked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          friendIdByLink.get(s.friend)!, s.etag ?? null, s.lastModified ?? null,
          boolInt(s.reachable), boolInt(s.crawlable), s.bestMethod ?? null,
          s.httpStatus ?? null, s.latencyMs ?? null, s.finalUrl ?? null,
          boolInt(s.backlinkChecked), boolInt(s.backlink),
          s.unreachableSince ? dbTime(s.unreachableSince) : null,
          s.rssUnavailableSince ? dbTime(s.rssUnavailableSince) : null,
          s.lastPostPublished ? dbTime(s.lastPostPublished) : null,
          s.lastPostDaysAgo ?? null,
          s.lastOkAt ? dbTime(s.lastOkAt) : null,
          s.lastError ?? null, s.failCount ?? 0,
          s.nextCheckAt ? dbTime(s.nextCheckAt) : null,
          s.checkedAt ? dbTime(s.checkedAt) : null,
        ),
    )
  await runChunked(stateStmts, (chunk) => db.batch(chunk))

  // 6. 申请队列（保留原状态与时间）
  const appStmts = applications.map((a) =>
    db
      .prepare(
        `INSERT INTO applications (site_name, author, link, avatar, feed, "desc", contact, note, backlink_ok,
                                   backlink_checked_at, backlink_detail, status, review_note, created_at, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?)`,
      )
      .bind(
        a.siteName, a.author ?? null, a.link, a.avatar ?? null, a.feed ?? null, a.desc ?? null,
        a.contact ?? null, a.note ?? null, boolInt(a.backlinkOk),
        a.backlinkCheckedAt ? dbTime(a.backlinkCheckedAt) : null, a.backlinkDetail ?? null,
        a.status, a.reviewNote ?? null,
        a.createdAt ? dbTime(a.createdAt) : null,
        a.reviewedAt ? dbTime(a.reviewedAt) : null,
      ),
  )
  await runChunked(appStmts, (chunk) => db.batch(chunk))

  // 7. 配置（只写入已知键，逐键校验；坏值跳过而不是整表失败）
  let written = 0
  let skipped = 0
  const settingStmts: ReturnType<Env['DB']['prepare']>[] = []
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  for (const [key, value] of Object.entries(settings)) {
    const schema = fieldSchemas[key]
    if (!schema) {
      skipped++
      continue
    }
    const parsed = schema.safeParse(value)
    if (!parsed.success) {
      skipped++
      continue
    }
    settingStmts.push(upsert.bind(key, JSON.stringify(parsed.data)))
    written++
  }
  await runChunked(settingStmts, (chunk) => db.batch(chunk))

  return {
    ok: true,
    summary: {
      groups: orderedGroups.length,
      friends: orderedFriends.length,
      applications: applications.length,
      articles: articleStmts.length,
      sourceState: stateStmts.length,
      settings: written,
      settingsSkipped: skipped,
    },
  }
}
