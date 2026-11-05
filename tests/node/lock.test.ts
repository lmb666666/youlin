import { describe, it, expect, afterEach } from 'vitest'
import { env } from '../helpers'
import { acquireLock, readLock, releaseLock, renewLock } from '../../src/repositories/locks'

const KEY = 'internal.testLock'

afterEach(async () => {
  await env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(KEY).run()
})

describe('调度锁', () => {
  it('同一时间只允许一个持有者；过期后可被接管', async () => {
    expect(await acquireLock(env.DB, KEY, 'a', 1_000, 1_000)).toBe(true)
    expect(await acquireLock(env.DB, KEY, 'b', 1_000, 1_500)).toBe(false)
    expect((await readLock(env.DB, KEY))?.owner).toBe('a')

    // 到期后 b 可以接管
    expect(await acquireLock(env.DB, KEY, 'b', 1_000, 2_500)).toBe(true)
    expect((await readLock(env.DB, KEY))?.owner).toBe('b')
  })

  it('释放必须匹配 owner，避免误删新持有者的锁', async () => {
    await acquireLock(env.DB, KEY, 'a', 1_000, 1_000)
    await releaseLock(env.DB, KEY, 'other')
    expect((await readLock(env.DB, KEY))?.owner).toBe('a')

    await releaseLock(env.DB, KEY, 'a')
    expect(await readLock(env.DB, KEY)).toBeNull()
  })

  it('续租只对当前 owner 生效', async () => {
    await acquireLock(env.DB, KEY, 'a', 1_000, 1_000)
    expect(await renewLock(env.DB, KEY, 'b', 1_000, 1_500)).toBe(false)
    expect(await renewLock(env.DB, KEY, 'a', 5_000, 1_500)).toBe(true)
    expect((await readLock(env.DB, KEY))?.expiresAt).toBe(6_500)
  })

  it('非法 JSON 的旧值视为过期', async () => {
    await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .bind(KEY, 'not-json')
      .run()
    expect(await acquireLock(env.DB, KEY, 'a', 1_000, 1_000)).toBe(true)
  })
})
