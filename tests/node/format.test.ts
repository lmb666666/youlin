import { describe, expect, it } from 'vitest'
import { formatDateTime, settingsDateTimeOptions } from '../../web/src/lib/format'

describe('管理台日期格式化', () => {
  it('按 site.timezone 转换', () => {
    const iso = '2026-10-05T13:05:00Z'
    expect(formatDateTime(iso, { timeZone: 'UTC' })).toContain('13:05')
    expect(formatDateTime(iso, { timeZone: 'Asia/Shanghai' })).toContain('21:05')
  })

  it('非法 locale/timezone 不抛错，回退默认值', () => {
    const iso = '2026-10-05T13:05:00Z'
    expect(formatDateTime(iso, { locale: 'en-US', timeZone: 'Not/AZone' })).toBeTruthy()
    expect(formatDateTime(iso, { locale: 'en-US' })).not.toBe(formatDateTime(iso, { locale: 'zh-CN' }))
  })

  it('空值与非法时间', () => {
    expect(formatDateTime(null)).toBe('—')
    expect(formatDateTime('not-a-date')).toBe('not-a-date')
  })

  it('从设置对象提取选项', () => {
    expect(settingsDateTimeOptions({ 'site.locale': 'en-US', 'site.timezone': 'UTC' })).toEqual({
      locale: 'en-US',
      timeZone: 'UTC',
    })
  })
})
