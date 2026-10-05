import { env as testEnv } from 'cloudflare:test'
import type { Env } from '../src/types'

/** 运行时绑定（wrangler.jsonc + vitest 注入），统一用应用的 Env 类型 */
export const env = testEnv as unknown as Env
