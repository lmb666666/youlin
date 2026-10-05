import { describe, it, expect, beforeEach } from 'vitest'
import { env } from './helpers'
import { CONFIG_FIELDS, CONFIG_KEYS, CONFIG_TOP_KEYS } from '../src/config/definition'
import { settingsZod, settingsSchemaPayload, fieldSchemas, toNested } from '../src/config/schema'
import { loadFlatSettings, defaultsFlat } from '../src/config/loader'
import type { AppConfig } from '../src/types'

beforeEach(async () => {
  // 同一测试文件内状态跨用例持久，先清空
  await env.DB.exec('DELETE FROM settings')
})

describe('配置定义（DESIGN §9 完整性）', () => {
  it('每个配置项都有默认值、label 与说明', () => {
    for (const f of CONFIG_FIELDS) {
      expect(f.default !== undefined, `${f.key} 缺默认值`).toBe(true)
      expect(f.label.length > 0, `${f.key} 缺 label`).toBe(true)
      expect(f.description.length > 0, `${f.key} 缺 description`).toBe(true)
    }
  })

  it('键名 camelCase 点号且无重复', () => {
    const keys = CONFIG_KEYS
    expect(new Set(keys).size).toBe(keys.length)
    for (const k of keys) {
      expect(k).toMatch(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/)
    }
    for (const top of CONFIG_TOP_KEYS) expect(top).toMatch(/^[a-z][a-zA-Z0-9]*$/)
  })

  it('zod 拒绝未知键与类型错误，接受全默认', () => {
    expect(settingsZod.safeParse(defaultsFlat()).success).toBe(true)
    expect(settingsZod.safeParse({ ...defaultsFlat(), 'nope.x': 1 }).success).toBe(false)
    expect(settingsZod.safeParse({ ...defaultsFlat(), 'crawl.batchSize': 'x' }).success).toBe(false)
    expect(settingsZod.safeParse({ ...defaultsFlat(), 'crawl.batchSize': 999 }).success).toBe(false)
    expect(settingsZod.safeParse({ ...defaultsFlat(), 'linkCheck.backoffLadder': [[1]] }).success).toBe(false)
    expect(settingsZod.safeParse({ ...defaultsFlat(), 'ui.theme': 'blue' }).success).toBe(false)
    expect(fieldSchemas['site.name']).toBeDefined()
  })

  it('schema payload 覆盖全部键', () => {
    const payload = settingsSchemaPayload()
    const schemaKeys = payload.groups.flatMap((g) => g.fields.map((f) => f.key))
    expect([...schemaKeys].sort()).toEqual([...CONFIG_KEYS].sort())
    expect(payload.version).toBe(1)
  })
})

describe('配置加载三层合并', () => {
  it('无表无覆盖 → 全默认', async () => {
    const flat = await loadFlatSettings(env.DB, { YOULIN_CONFIG_OVERRIDES: '' } as never)
    expect(flat).toEqual(defaultsFlat())
  })

  it('settings 表覆盖默认值；坏 JSON/坏类型按键回退', async () => {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').bind('site.name', JSON.stringify('测试站')),
      env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').bind('crawl.batchSize', JSON.stringify(7)),
      env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').bind('api.cacheSeconds', '"not-json-object-ok"'),
      env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').bind('bad.key', '"unknown-stripped"'),
    ])
    const flat = await loadFlatSettings(env.DB, { YOULIN_CONFIG_OVERRIDES: '' } as never)
    expect(flat['site.name']).toBe('测试站')
    expect(flat['crawl.batchSize']).toBe(7)
    expect(flat['api.cacheSeconds']).toBe(300) // 类型非法（string 而非 number）→ 按键回退默认
    expect('bad.key' in flat).toBe(false) // 未知键剔除
  })

  it('环境变量覆盖层优先于表', async () => {
    await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').bind('site.name', JSON.stringify('表里的名字')).run()
    const overrides = JSON.stringify({ 'site.name': '环境变量优先', 'api.cacheSeconds': 30 })
    const flat = await loadFlatSettings(env.DB, { YOULIN_CONFIG_OVERRIDES: overrides } as never)
    expect(flat['site.name']).toBe('环境变量优先')
    expect(flat['api.cacheSeconds']).toBe(30)
    expect(flat['crawl.batchSize']).toBe(3)

    // 坏覆盖 JSON 不致命
    const flat2 = await loadFlatSettings(env.DB, { YOULIN_CONFIG_OVERRIDES: '{oops' } as never)
    expect(flat2['site.name']).toBe('表里的名字')
  })

  it('嵌套视图结构与 AppConfig 顶层分组一致', () => {
    const nested = toNested(defaultsFlat())
    expect(Object.keys(nested).sort()).toEqual([...CONFIG_TOP_KEYS].sort())
    const cfg = nested as unknown as AppConfig
    expect(cfg.site.name).toBe('我的博客')
    expect(cfg.crawl.maxPerFriend).toBe(5)
    expect(cfg.api.corsOrigin).toBe('*')
    expect(cfg.security.sessionDays).toBe(30)
  })
})
