import type { D1Database, Fetcher } from '@cloudflare/workers-types'

export interface Env {
  DB: D1Database
  ADMIN_TOKEN: string
  TURNSTILE_SECRET?: string
  GITHUB_PAT?: string
  /** 覆盖级配置：JSON 文本，扁平 camelCase 点号键（DESIGN §9） */
  YOULIN_CONFIG_OVERRIDES?: string
  ASSETS: Fetcher
}

/** 应用级配置（嵌套视图，由扁平 settings 合并而来） */
export interface AppConfig {
  site: {
    name: string
    url: string
    logo: string
    description: string
    timezone: string
    locale: string
  }
  crawl: {
    enabled: boolean
    batchSize: number
    maxPerFriend: number
    outputMaxArticles: number
    futureToleranceDays: number
    retentionDays: number
    timeoutSeconds: number
    userAgent: string
    concurrency: number
  }
  linkCheck: {
    enabled: boolean
    maxAgeHours: number
    timeoutSeconds: number
    concurrency: number
    statusApiUrl: string
    /** [失联天数, 复查间隔小时] 升序阶梯 */
    backoffLadder: [number, number][]
  }
  backlink: {
    enabled: boolean
    authorUrl: string
  }
  proxy: {
    url: string
    mode: 'off' | 'fallback' | 'always'
  }
  apply: {
    enabled: boolean
    rateLimitPerDay: number
    turnstile: boolean
    turnstileSiteKey: string
    backlinkPolicy: 'mark' | 'reject' | 'off'
    autoApprove: boolean
    requiredFields: string[]
    intro: string
    successMessage: string
  }
  api: {
    cacheSeconds: number
    corsOrigin: string
    includeHidden: boolean
    maxLimit: number
  }
  rebuild: {
    enabled: boolean
    provider: 'webhook' | 'github_dispatch'
    webhookUrl: string
    githubRepo: string
    eventType: string
    auto: boolean
    debounceSeconds: number
  }
  ui: {
    theme: 'system' | 'light' | 'dark'
    accentColor: string
    pageSize: number
  }
  security: {
    sessionDays: number
    loginRateLimit: number
  }
  notify: {
    webhookUrl: string
    events: string[]
  }
}

/** DB 里的时间是 datetime('now') → "YYYY-MM-DD HH:MM:SS"（UTC） */
export type DbTimestamp = string

/** Hono 泛型：Bindings=wrangler 绑定，Variables=请求内共享 */
export interface AppEnv {
  Bindings: Env
  Variables: { cfg: AppConfig }
}
