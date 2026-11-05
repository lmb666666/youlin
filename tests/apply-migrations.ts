import { applyD1Migrations, env } from 'cloudflare:test'
import type { D1Migration } from 'cloudflare:test'
import { setConfigCacheMs } from '../src/config/loader'

// 测试里直接写 settings 表，关闭配置缓存，避免用例间读到旧值
setConfigCacheMs(0)

await applyD1Migrations(
  (env as unknown as { DB: D1Database }).DB,
  (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
)
