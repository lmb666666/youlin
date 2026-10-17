import fs from 'node:fs'
import type { Env } from '../types'

/** 读取 .env（本地开发/Compose 用；已存在的环境变量优先） */
export function loadDotEnv(file = '.env'): void {
  if (!fs.existsSync(file)) return
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

function optional(name: string): string | undefined {
  const v = process.env[name]?.trim()
  return v ? v : undefined
}

/** 环境变量 → 应用的 Env（与 Workers 的绑定同名） */
export function createEnv(db: Env['DB']): Env {
  const adminToken = optional('ADMIN_TOKEN')
  if (!adminToken) {
    throw new Error('缺少 ADMIN_TOKEN 环境变量：它是管理台登录口令，也是会话签名密钥')
  }
  return {
    DB: db,
    ADMIN_TOKEN: adminToken,
    TURNSTILE_SECRET: optional('TURNSTILE_SECRET'),
    GITHUB_PAT: optional('GITHUB_PAT'),
    WEBDAV_PASSWORD: optional('WEBDAV_PASSWORD'),
    YOULIN_CONFIG_OVERRIDES: optional('YOULIN_CONFIG_OVERRIDES'),
  }
}
