import type { AppConfig, Env } from './types'
import { runtimeGet, runtimeSet, userAgent } from './crawler/http'

/**
 * 重建触发器（DESIGN §9.6）：可选能力，只服务"构建时接入"的站点。
 *   webhook：通用 POST（兼容 CF Pages / Vercel Deploy Hook 与任意 CI）
 *   github_dispatch：GitHub repository_dispatch（需 GITHUB_PAT，fine-grained、仅单仓库）
 * 防抖：internal.lastRebuildAt，间隔小于 rebuild.debounceSeconds 时跳过。
 */

export interface RebuildResult {
  triggered: boolean
  provider?: string
  debounced?: boolean
  error?: string
}

export async function triggerRebuild(env: Env, cfg: AppConfig, reason: string): Promise<RebuildResult> {
  if (!cfg.rebuild.enabled) return { triggered: false, error: 'rebuild_disabled' }

  const last = (await runtimeGet(env.DB, 'internal.lastRebuildAt')) as string | null
  if (last && Date.now() - new Date(last).getTime() < cfg.rebuild.debounceSeconds * 1000) {
    return { triggered: false, debounced: true }
  }

  const payload = { event: 'youlin.data-changed', reason, at: new Date().toISOString() }
  try {
    if (cfg.rebuild.provider === 'webhook') {
      if (!cfg.rebuild.webhookUrl) return { triggered: false, error: 'webhook_url_missing' }
      const res = await fetch(cfg.rebuild.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': userAgent(cfg) },
        body: JSON.stringify(payload),
      })
      if (!res.ok) return { triggered: false, error: `webhook HTTP ${res.status}` }
    } else {
      if (!cfg.rebuild.githubRepo) return { triggered: false, error: 'github_repo_missing' }
      if (!env.GITHUB_PAT) return { triggered: false, error: 'github_pat_missing' }
      const res = await fetch(`https://api.github.com/repos/${cfg.rebuild.githubRepo}/dispatches`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.GITHUB_PAT}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': userAgent(cfg),
        },
        body: JSON.stringify({ event_type: cfg.rebuild.eventType, client_payload: payload }),
      })
      if (res.status !== 204) return { triggered: false, error: `github HTTP ${res.status}` }
    }
    await runtimeSet(env.DB, 'internal.lastRebuildAt', new Date().toISOString())
    return { triggered: true, provider: cfg.rebuild.provider }
  } catch (e) {
    return { triggered: false, error: e instanceof Error ? e.message : String(e) }
  }
}
