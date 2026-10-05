// 从 src/config/definition.ts（配置的单一事实源）生成 docs/configuration.md 的配置表格。
// 用法：node scripts/gen-config-docs.mjs   （Node ≥ 22.6 原生导入 TS）
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { CONFIG_GROUPS, CONFIG_VERSION } = await import(join(root, 'src/config/definition.ts'))

const fmtDefault = (f) => {
  if (f.default === '') return '空'
  if (Array.isArray(f.default)) return '`' + JSON.stringify(f.default) + '`'
  if (typeof f.default === 'string') return f.default === 'true' ? '`true`' : `\`${f.default}\``
  if (typeof f.default === 'number') return `\`${f.default}\``
  return `\`${String(f.default)}\``
}

const lines = [`<!-- 由 scripts/gen-config-docs.mjs 从 src/config/definition.ts 生成，请勿手改；改配置后运行：pnpm docs:config -->`, '']
lines.push(`当前配置版本：\`${CONFIG_VERSION}\``, '')
for (const g of CONFIG_GROUPS) {
  lines.push(`### ${g.label}（\`${g.key}.*\`）`, '', g.description, '')
  lines.push('| 键 | 默认值 | 说明 |', '| --- | --- | --- |')
  for (const f of g.fields) {
    const type = f.type === 'enum' && f.options ? `（${f.options.join(' / ')}）` : ''
    lines.push(`| \`${f.key}\` | ${fmtDefault(f)} | ${f.label}${type}。${f.description} |`)
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
