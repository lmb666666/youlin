// 发版前校验三处版本号一致：package.json / web/package.json / src/version.ts。
// 任何一处漏改都会让备份元信息（app.version）或镜像标签漂移。
import { readFileSync } from 'node:fs'

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8')).version
const root = read('../package.json')
const web = read('../web/package.json')
const app = /^export const APP_VERSION = '([^']+)'$/m.exec(
  readFileSync(new URL('../src/version.ts', import.meta.url), 'utf8'),
)?.[1]

if (root !== web || root !== app) {
  console.error(`版本号不一致：package.json=${root} web/package.json=${web} src/version.ts=${app}`)
  process.exit(1)
}
console.log(`版本一致：${root}`)
