import type { Env } from '../types'
import { AppError } from '../errors'
import { fieldSchemas } from '../config/schema'
import { replaceAllData } from '../repositories/backup'
import type { BackupEnvelope } from './format'

/**
 * 恢复：覆盖式写入。
 *
 * 自然键（分组名、友链链接）映射到新库的自增 id，因此不依赖 sqlite_sequence。
 * 清空与写入在同一事务里：中途失败整体回滚，旧数据不会丢失。
 */

export interface RestoreSummary {
  groups: number
  friends: number
  applications: number
  articles: number
  sourceState: number
  settings: number
  settingsSkipped: number
}

function validate(envelope: BackupEnvelope): void {
  const { groups, friends, articles, sourceState } = envelope.data

  const groupNames = new Set<string>()
  for (const g of groups) {
    if (groupNames.has(g.name)) throw new AppError(400, 'duplicate_group', `备份内分组重名：${g.name}`)
    groupNames.add(g.name)
  }

  const links = new Set<string>()
  for (const f of friends) {
    if (links.has(f.link)) throw new AppError(400, 'duplicate_link', `备份内友链重复：${f.link}`)
    links.add(f.link)
    if (!groupNames.has(f.group)) {
      throw new AppError(400, 'broken_reference', `友链 ${f.link} 指向不存在的分组「${f.group}」`)
    }
  }

  for (const a of articles ?? []) {
    if (!links.has(a.friend)) {
      throw new AppError(400, 'broken_reference', `文章 ${a.link} 指向不存在的友链 ${a.friend}`)
    }
  }
  for (const s of sourceState ?? []) {
    if (!links.has(s.friend)) {
      throw new AppError(400, 'broken_reference', `体检状态指向不存在的友链 ${s.friend}`)
    }
  }
}

export async function applyRestore(
  db: Env['DB'],
  envelope: BackupEnvelope,
): Promise<RestoreSummary> {
  validate(envelope)

  const { groups, friends, applications, settings } = envelope.data

  // 配置只写入已知键，逐键校验；坏值跳过而不是整表失败
  let skipped = 0
  const settingsRows: { key: string; value: string }[] = []
  for (const [key, value] of Object.entries(settings)) {
    const schema = fieldSchemas[key]
    if (!schema) {
      skipped++
      continue
    }
    const parsed = schema.safeParse(value)
    if (!parsed.success) {
      skipped++
      continue
    }
    settingsRows.push({ key, value: JSON.stringify(parsed.data) })
  }

  const counts = replaceAllData(db, envelope.data, settingsRows, Object.keys(fieldSchemas))

  return {
    groups: groups.length,
    friends: friends.length,
    applications: applications.length,
    articles: counts.articles,
    sourceState: counts.sourceState,
    settings: counts.settings,
    settingsSkipped: skipped,
  }
}
