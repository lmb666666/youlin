/**
 * SQLite 访问层最小接口：应用只依赖 prepare/bind/first/all/run/batch 与 last_row_id。
 * Node 侧由 better-sqlite3 适配（见 server/db.ts），测试使用同一实现。
 */
export interface DbMeta {
  last_row_id?: number
  changes?: number
  duration?: number
}

export interface DbResult<T = unknown> {
  results?: T[]
  success?: boolean
  meta: DbMeta
}

export interface DbStatement {
  bind(...values: unknown[]): DbStatement
  first<T = unknown>(): Promise<T | null>
  all<T = unknown>(): Promise<DbResult<T> & { results: T[] }>
  run<T = unknown>(): Promise<DbResult<T>>
}

export interface Db {
  prepare(query: string): DbStatement
  batch<T = unknown>(statements: DbStatement[]): Promise<DbResult<T>[]>
  /** 执行多条 SQL（迁移与测试清表用） */
  exec(query: string): Promise<unknown>
}

export interface Env {
  DB: Db
  ADMIN_TOKEN: string
  TURNSTILE_SECRET?: string
  GITHUB_PAT?: string
  /** WebDAV 备份密码（Basic 认证；只读环境变量，不写库、不进备份） */
  WEBDAV_PASSWORD?: string
  /** 覆盖级配置：JSON 文本，扁平 camelCase 点号键（DESIGN §9） */
  YOULIN_CONFIG_OVERRIDES?: string
  /** 反向代理信任级别：off 不信任 XFF；loopback 仅信任回环 peer；private 信任私网 peer（Docker/内网反代） */
  TRUST_PROXY?: 'off' | 'loopback' | 'private'
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
  backup: {
    enabled: boolean
    schedule: 'hourly' | 'daily' | 'weekly'
    includeArticles: boolean
    retain: number
    webdavUrl: string
    webdavUsername: string
    webdavPath: string
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

/** Hono 泛型：Bindings=运行时依赖，Variables=请求内共享 */
export interface AppEnv {
  Bindings: Env
  Variables: { cfg: AppConfig }
}
