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
