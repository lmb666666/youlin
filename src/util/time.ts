/** 时间工具：库内 datetime('now') 存的是 "YYYY-MM-DD HH:MM:SS"（UTC），输出一律 ISO 8601 UTC */

import { isRealYMD } from '@youlin/contracts'

// 库内时间可能是 datetime('now') 的空格格式，也可能是测试/旧数据里的 T 分隔无 Z 格式；
// 两者都按 UTC 解释，避免 Node 在非 UTC 时区把它当成本地时间。
const DB_TS = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/

/** "2026-10-05 13:55:00" → "2026-10-05T13:55:00Z"；已是 ISO 或空则原样/undefined */
export function isoUtc(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  if (DB_TS.test(value)) return value.replace(' ', 'T').replace(/\.\d+$/, '') + 'Z'
  // 已经是 ISO 8601（含 Z）则直接返回；其他格式尝试规整
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) return value
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** 任意时间 → YYYY-MM-DD（UTC） */
export function dateOnly(value: string | number | Date | null | undefined): string | undefined {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return isRealYMD(value) ? value : undefined
  }
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toISOString().slice(0, 10)
}

/** ISO 8601 → SQLite 的 "YYYY-MM-DD HH:MM:SS"（UTC），与 datetime('now') 同格式 */
export function dbTime(iso: string): string {
  return iso.slice(0, 19).replace('T', ' ')
}

/** 距今完整 24 小时周期数（向下取整；用于失联退避，不按日历日切分） */
export function daysSince(iso: string | null | undefined, now = Date.now()): number | undefined {
  const t = isoUtc(iso)
  if (!t) return undefined
  const then = new Date(t).getTime()
  return Math.floor((now - then) / 86_400_000)
}
