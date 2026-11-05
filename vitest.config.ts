import { defineConfig } from 'vitest/config'

/** 全部测试统一跑在 Node + better-sqlite3；Workers/workerd 已归档 */
export default defineConfig({
  test: {
    environment: 'node',
    env: { LOG_LEVEL: 'silent' },
    include: ['tests/**/*.test.ts'],
    testTimeout: 20_000,
  },
})
