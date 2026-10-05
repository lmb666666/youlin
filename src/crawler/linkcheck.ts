import type { Env, AppConfig } from '../types'
import { parseFeed, withResolvedGuids } from './parse'
import { extractDeclaredFeeds, commonFeedPaths } from './discover'
import { fetchRemote, nextIntervalHours } from './http'
import { daysSince } from '../util/time'
import type { FriendRow } from './crawl'

/**
 * 体检（DESIGN §6 三路口径）：
 *   RSS 可解析 = 可达 + 可抓取（进朋友圈）
 *   → RSS 不可用：发现常见 feed 路径 → 首页可达 = 可达但不可抓取（只进接口一/体检）
 *   → 首页也不可达：可选第三方状态 API 兜底（api_only，只标记可达性）
 * 反链检测：抓对方站点页面，检索是否含指向 backlink.authorUrl 的链接。
 */

export interface HealthResult {
  reachable: boolean
  crawlable: boolean
  bestMethod: 'rss' | 'homepage' | 'api' | 'none'
  httpStatus: number | null
  latencyMs: number | null
  finalUrl: string | null
  lastError: string | null
  discoveredFeed: string | null
  backlinkChecked: boolean
  backlink: boolean | null
  lastPostPublished: string | null
}

export async function checkFriendHealth(env: Env, cfg: AppConfig, friend: FriendRow): Promise<HealthResult> {
  const result: HealthResult = {
    reachable: false, crawlable: false, bestMethod: 'none', httpStatus: null, latencyMs: null,
    finalUrl: null, lastError: null, discoveredFeed: null, backlinkChecked: false, backlink: null,
    lastPostPublished: null,
  }

  // ── 第一路：已知 feed ──
  if (friend.feed) {
    const res = await fetchRemote(env, { url: friend.feed, cfg, timeoutSeconds: cfg.linkCheck.timeoutSeconds, proxyMode: 'fallback' })
    if (!res.error && res.status === 200) {
      try {
        const entries = await withResolvedGuids(await parseFeed(res.body ?? ''))
        result.reachable = true
        result.crawlable = true
        result.bestMethod = 'rss'
        result.httpStatus = res.status
        result.latencyMs = res.latencyMs
        result.finalUrl = res.finalUrl
        result.lastPostPublished = newestPublished(entries)
        await checkBacklink(env, cfg, friend, result)
        return result
      } catch { /* 落入第二路 */ }
    } else if (res.error || res.status === 0) {
      // feed 网络层失败不代表站点不可达，但先记下来； homepage 通了再改判
      result.lastError = res.error ?? `feed HTTP ${res.status}`
    }
  }

  // ── 第二路：首页 + feed 发现 ──
  const home = await fetchRemote(env, { url: friend.link, cfg, timeoutSeconds: cfg.linkCheck.timeoutSeconds, proxyMode: 'fallback' })
  if (!home.error && home.status < 400 && home.body !== null) {
    result.reachable = true
    result.httpStatus = home.status
    result.latencyMs = home.latencyMs
    result.finalUrl = home.finalUrl
    result.lastError = null

    // feed 发现（已知 feed 失败或缺失时）：声明式 <link> 优先，再试常见路径
    const declared = extractDeclaredFeeds(home.body, home.finalUrl)
    const candidates = [...(friend.feed ? [] : declared), ...(friend.feed ? [] : commonFeedPaths(friend.link))].slice(0, 4)
    for (const candidate of candidates) {
      const feedRes = await fetchRemote(env, { url: candidate, cfg, timeoutSeconds: cfg.linkCheck.timeoutSeconds, proxyMode: 'fallback' })
      if (feedRes.error || feedRes.status !== 200) continue
      try {
        const entries = await withResolvedGuids(await parseFeed(feedRes.body ?? ''))
        result.crawlable = true
        result.bestMethod = 'rss'
        result.discoveredFeed = candidate
        result.lastPostPublished = newestPublished(entries)
        break
      } catch { /* 下一个候选 */ }
    }
    if (!result.crawlable) {
      result.bestMethod = 'homepage'
      // 顺路做反链：首页 HTML 已在手
      await checkBacklink(env, cfg, friend, result, home.body)
      return result
    }
    await checkBacklink(env, cfg, friend, result)
    return result
  }

  // ── 第三路：第三方状态 API 兜底 ──
  if (cfg.linkCheck.statusApiUrl) {
    const apiRes = await fetchRemote(env, {
      url: cfg.linkCheck.statusApiUrl.replace('{url}', encodeURIComponent(friend.link)),
      cfg, timeoutSeconds: cfg.linkCheck.timeoutSeconds, proxyMode: 'off',
      headers: { Accept: 'application/json,text/plain' },
    })
    if (!apiRes.error && apiRes.status < 400) {
      result.reachable = true
      result.bestMethod = 'api'
      result.httpStatus = apiRes.status
      result.latencyMs = apiRes.latencyMs
    } else {
      result.lastError = apiRes.error ?? `status api HTTP ${apiRes.status}`
    }
  } else if (!result.lastError) {
    result.lastError = home.error ?? (home.status ? `homepage HTTP ${home.status}` : 'network_error')
  }
  return result
}

function newestPublished(entries: { publishedAt: string }[]): string | null {
  if (entries.length === 0) return null
  return entries.reduce((max, e) => (e.publishedAt > max ? e.publishedAt : max), entries[0]!.publishedAt)
}

/** 反链检测：多形态匹配自家域名（https/http/协议相对/裸域）。pageHtml 已有则不再抓取；仅对 2xx 页面判定 */
async function checkBacklink(env: Env, cfg: AppConfig, friend: FriendRow, result: HealthResult, pageHtml?: string): Promise<void> {
  if (!cfg.backlink.enabled) return
  const mine = normalizeDomain(cfg.backlink.authorUrl || cfg.site.url)
  if (!mine) return
  result.backlinkChecked = true
  if (pageHtml !== undefined) {
    result.backlink = htmlContainsBacklink(pageHtml, mine)
    return
  }
  const res = await fetchRemote(env, { url: friend.link, cfg, timeoutSeconds: cfg.linkCheck.timeoutSeconds, proxyMode: 'fallback' })
  result.backlink = res.status >= 200 && res.status < 300 && res.body !== null ? htmlContainsBacklink(res.body, mine) : null
}

export function normalizeDomain(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) return null
  try {
    const u = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
    return u.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

/** https://x / http://x / //x / //www.x / 裸域（href 内） */
export function htmlContainsBacklink(html: string, domain: string): boolean {
  const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`href\\s*=\\s*["']https?://(www\\.)?${escaped}[:/"']`, 'i'),
    new RegExp(`href\\s*=\\s*["']//(www\\.)?${escaped}[:/"']`, 'i'),
    new RegExp(`href\\s*=\\s*["']https?://[^/"']*\\.${escaped}[:/"']`, 'i'),
  ]
  return patterns.some((p) => p.test(html))
}

/** 把体检结果写回 source_state（失联/RSS 不可用起始时间、退避都在 JS 算好） */
export async function persistHealth(
  db: Env['DB'],
  cfg: AppConfig,
  friendId: number,
  r: HealthResult,
  previous: { unreachable_since: string | null; rss_unavailable_since: string | null; fail_count: number } | null,
): Promise<void> {
  const nowDb = new Date().toISOString().slice(0, 19).replace('T', ' ')
  const unreachableSince = r.reachable ? null : (previous?.unreachable_since ?? nowDb)
  const rssUnavailableSince = r.crawlable ? null : (previous?.rss_unavailable_since ?? nowDb)
  const failCount = r.reachable ? 0 : (previous?.fail_count ?? 0) + 1
  const unreachableDays = r.reachable ? null : daysSince(previous?.unreachable_since) ?? 0
  const lastPostDb = r.lastPostPublished ? r.lastPostPublished.slice(0, 19).replace('T', ' ') : null
  const lastPostDays = r.lastPostPublished
    ? Math.max(0, Math.floor((Date.now() - new Date(r.lastPostPublished).getTime()) / 86_400_000))
    : null

  await db.prepare(
    `INSERT INTO source_state (
       friend_id, reachable, crawlable, best_method, http_status, latency_ms, final_url,
       backlink_checked, backlink, unreachable_since, rss_unavailable_since,
       last_post_published, last_post_days_ago, last_error, fail_count, checked_at, next_check_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now', ?))
     ON CONFLICT(friend_id) DO UPDATE SET
       reachable = excluded.reachable, crawlable = excluded.crawlable, best_method = excluded.best_method,
       http_status = excluded.http_status, latency_ms = excluded.latency_ms, final_url = excluded.final_url,
       backlink_checked = excluded.backlink_checked, backlink = excluded.backlink,
       unreachable_since = excluded.unreachable_since, rss_unavailable_since = excluded.rss_unavailable_since,
       last_post_published = COALESCE(excluded.last_post_published, source_state.last_post_published),
       last_post_days_ago = COALESCE(excluded.last_post_days_ago, source_state.last_post_days_ago),
       last_error = excluded.last_error, fail_count = excluded.fail_count,
       checked_at = excluded.checked_at, next_check_at = excluded.next_check_at`,
  )
    .bind(
      friendId,
      r.reachable ? 1 : 0,
      r.crawlable ? 1 : 0,
      r.bestMethod,
      r.httpStatus,
      r.latencyMs,
      r.finalUrl,
      r.backlinkChecked ? 1 : 0,
      r.backlink === null ? null : r.backlink ? 1 : 0,
      unreachableSince,
      rssUnavailableSince,
      lastPostDb,
      lastPostDays,
      r.lastError,
      failCount,
      `+${Math.round(nextIntervalHours(unreachableDays, cfg, cfg.linkCheck.maxAgeHours))} minutes`,
    )
    .run()
}
