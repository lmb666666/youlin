// 从 src/config/definition.ts（配置的单一事实源）生成 docs/configuration.md 的配置表格。
// 用法：node scripts/gen-config-docs.mjs   （Node ≥ 24 原生导入 TS）
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { CONFIG_GROUPS, CONFIG_VERSION } = await import(join(root, 'src/config/definition.ts'))

const fmtDefault = (f) => {
  if (f.default === '') return '空'
  if (Array.isArray(f.default)) return '`' + JSON.stringify(f.default) + '`'
  if (typeof f.default === 'string') return `\`${f.default}\``
  return `\`${String(f.default)}\``
}

const TYPE_LABEL = {
  string: '文本',
  text: '长文本',
  number: '数字',
  boolean: '布尔',
  enum: '枚举',
  stringList: '字符串列表',
  json: 'JSON',
}

const fmtType = (f) => {
  if (f.type === 'number' && (f.min !== undefined || f.max !== undefined)) {
    return `数字（${f.min ?? '−∞'}–${f.max ?? '∞'}）`
  }
  if (f.type === 'enum') return `枚举（${(f.options ?? []).join(' / ')}）`
  return TYPE_LABEL[f.type] ?? f.type
}

const GROUP_EN = {
  site: 'Site',
  crawl: 'Crawl',
  linkCheck: 'Link Check',
  backlink: 'Backlink',
  proxy: 'Proxy',
  apply: 'Apply',
  api: 'API',
  rebuild: 'Rebuild',
  ui: 'UI',
  backup: 'Backup',
  security: 'Security',
  notify: 'Notify',
}

const md = (value) => String(value).replace(/\|/g, '\\|')

const lines = [`<!-- 由 scripts/gen-config-docs.mjs 从 src/config/definition.ts 生成，请勿手改；改配置后运行：pnpm docs:config -->`, '']
lines.push(`当前配置版本：\`${CONFIG_VERSION}\``, '')
for (const g of CONFIG_GROUPS) {
  lines.push(`### ${g.label} | ${GROUP_EN[g.key] ?? g.key}（\`${g.key}.*\`）`, '', md(g.description), '')
  lines.push('| 键 | 类型 | 默认值 | 说明 |', '| --- | --- | --- | --- |')
  for (const f of g.fields) {
    const description = `${f.label}。${f.description}`.replace(/。。/g, '。')
    lines.push(`| \`${f.key}\` | ${fmtType(f)} | ${fmtDefault(f)} | ${md(description)} |`)
  }
  lines.push('')
}

const docPath = join(root, 'docs/configuration.md')
if (!existsSync(docPath)) {
  console.error('docs/configuration.md 不存在，请先创建含标记的文档骨架')
  process.exit(1)
}
const doc = readFileSync(docPath, 'utf8')
const start = '<!-- CONFIG_TABLE_START -->'
const end = '<!-- CONFIG_TABLE_END -->'
if (!doc.includes(start) || !doc.includes(end)) {
  console.error(`docs/configuration.md 缺少 ${start} / ${end} 标记`)
  process.exit(1)
}
const next = doc.replace(
  new RegExp(`${start}[\\s\\S]*${end}`),
  `${start}\n${lines.join('\n').trimEnd()}\n${end}`,
)
writeFileSync(docPath, next)
console.log(`docs/configuration.md 已更新（${CONFIG_GROUPS.length} 组配置）`)
