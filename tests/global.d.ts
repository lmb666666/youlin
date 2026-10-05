import type { Env } from '../src/types'

declare module 'cloudflare:test' {
  // 测试运行时注入的绑定（vitest.config.ts miniflare.bindings）
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[]
  }
}
