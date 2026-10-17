import path from 'node:path'
import { defineConfig } from 'vitest/config'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          ADMIN_TOKEN: 'test-admin-token',
          TURNSTILE_SECRET: 'test-turnstile-secret',
          GITHUB_PAT: 'test-github-pat',
          WEBDAV_PASSWORD: 'davpass',
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, 'migrations')),
        },
      },
    }),
  ],
  test: {
    setupFiles: ['./tests/apply-migrations.ts'],
    // Node 侧用例在独立的 vitest.node.config.ts 里跑（需要 better-sqlite3）
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/node/**'],
  },
}))
