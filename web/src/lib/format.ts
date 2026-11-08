export interface DateTimeOptions {
  locale?: string
  timeZone?: string
}

/** 管理台日期显示：locale/timezone 来自 site.locale / site.timezone，非法值回退默认 */
export function formatDateTime(value: string | null | undefined, opts: DateTimeOptions = {}): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const locale = opts.locale?.trim() || 'zh-CN'
  const timeZone = opts.timeZone?.trim()
  try {
    return date.toLocaleString(locale, {
      hour12: false,
      ...(timeZone ? { timeZone } : {}),
    })
  } catch {
    return date.toLocaleString('zh-CN', { hour12: false })
  }
}

export function settingsDateTimeOptions(settings: Record<string, unknown>): DateTimeOptions {
  return {
    locale: typeof settings['site.locale'] === 'string' ? settings['site.locale'] : undefined,
    timeZone: typeof settings['site.timezone'] === 'string' ? settings['site.timezone'] : undefined,
  }
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
]

/** 相对时间：用于「最近文章」「待审申请」等列表；无法解析时回退原文。 */
export function formatRelative(value: string | null | undefined, locale = 'zh-CN'): string {
  if (!value) return '—'
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return value
  const diff = time - Date.now()
  const abs = Math.abs(diff)
  try {
    const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    for (const [unit, ms] of UNITS) {
      if (abs >= ms) return formatter.format(Math.round(diff / ms), unit)
    }
    return '刚刚'
  } catch {
    return value
  }
}

export function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
