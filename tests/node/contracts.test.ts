import { describe, it, expect } from 'vitest'
import {
  applyFormSchema,
  applicationApproveSchema,
  backupPreviewSchema,
  friendCreateSchema,
  groupCreateSchema,
  publicLinksResponseSchema,
  settingsSchemaResponseSchema,
} from '@youlin/contracts'

describe('共享契约', () => {
  it('分组/友链输入：拒绝非法 URL 与空名称', () => {
    expect(groupCreateSchema.safeParse({ name: '' }).success).toBe(false)
    expect(groupCreateSchema.safeParse({ name: '技术区', desc: null }).success).toBe(true)

    const base = {
      groupId: 1,
      title: '站点',
      link: 'https://example.com/',
      since: '2026-01-01',
    }
    expect(friendCreateSchema.safeParse(base).success).toBe(true)
    expect(friendCreateSchema.safeParse({ ...base, link: 'javascript:alert(1)' }).success).toBe(false)
    expect(friendCreateSchema.safeParse({ ...base, since: '2026-02-30' }).success).toBe(false)
  })

  it('申请表单：允许空链接进入服务端中文校验，拒绝未知字段', () => {
    expect(applyFormSchema.safeParse({ link: '' }).success).toBe(true)
    expect(applyFormSchema.safeParse({ link: 'not-a-url' }).success).toBe(false)
    expect(applyFormSchema.safeParse({ link: 'https://a.example.com/', extra: 1 }).success).toBe(false)
  })

  it('审核覆盖：strict 拒绝未知字段', () => {
    expect(applicationApproveSchema.safeParse({ groupId: 1, title: 'x' }).success).toBe(true)
    expect(applicationApproveSchema.safeParse({ groupId: 1, unknown: true }).success).toBe(false)
  })

  it('公开接口与设置 schema 的运行时结构可解析', () => {
    expect(
      publicLinksResponseSchema.safeParse({
        groups: [{ name: '友邻', links: [{ author: 'A', link: 'https://a.example.com/', since: '2026-01-01' }] }],
      }).success,
    ).toBe(true)

    expect(
      settingsSchemaResponseSchema.safeParse({
        version: 1,
        groups: [{ key: 'site', label: '站点', description: '', fields: [{ key: 'site.name', type: 'string', default: '友邻', label: '站点名', description: '' }] }],
      }).success,
    ).toBe(true)
  })

  it('备份预览：counts 必须完整', () => {
    const base = {
      version: 1,
      exportedAt: '2026-01-01T00:00:00Z',
      appVersion: null,
      counts: { groups: 1, friends: 2, applications: 0, articles: 0, settings: 3 },
      includeArticles: false,
    }
    expect(backupPreviewSchema.safeParse(base).success).toBe(true)
    expect(backupPreviewSchema.safeParse({ ...base, counts: { groups: 1 } }).success).toBe(false)
  })
})
