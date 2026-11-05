import { describe, expect, it } from 'vitest'
import { gzipBytes, gunzipBytes } from '../../src/backup/codec'

describe('备份解压上限', () => {
  it('解压流超过上限时中止，不会完整分配', async () => {
    const gz = await gzipBytes(new Uint8Array(4096))
    await expect(gunzipBytes(gz, 1024)).rejects.toThrow('inflated_too_large')
    expect((await gunzipBytes(gz)).byteLength).toBe(4096)
  })
})
