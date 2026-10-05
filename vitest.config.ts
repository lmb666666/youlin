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
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, 'migrations')),
        },
      },
    }),
  ],
  test: {
    setupFiles: ['./tests/apply-migrations.ts'],
  },
}))
