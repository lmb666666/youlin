import { defineConfig } from 'vitest/config'

/** Node 运行时用例：真实 SQLite（better-sqlite3）+ 同一套 Hono 应用 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/node/**/*.test.ts'],
    testTimeout: 20_000,
  },
})
