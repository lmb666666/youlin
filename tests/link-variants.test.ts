import { describe, it, expect } from 'vitest'
import { linkVariants } from '../src/util/link'

describe('linkVariants 等价写法', () => {
  it('尾斜杠差异互为变体', () => {
    expect(linkVariants('https://blog.example.com/')).toContain('https://blog.example.com')
    expect(linkVariants('https://blog.example.com')).toContain('https://blog.example.com/')
  })

  it('主机名大小写不绕过去重', () => {
    expect(linkVariants('https://Blog.example.com/x')).toContain('https://blog.example.com/x')
    expect(linkVariants('https://BLOG.example.com/x')).toContain('https://blog.example.com/x')
  })

  it('http/https 默认端口不绕过去重', () => {
    expect(linkVariants('https://blog.example.com:443/x')).toContain('https://blog.example.com/x')
    expect(linkVariants('http://blog.example.com:80/x')).toContain('http://blog.example.com/x')
  })

  it('非默认端口保留（不同端口算不同站点）', () => {
    expect(linkVariants('https://blog.example.com:8443/x')).not.toContain('https://blog.example.com/x')
  })

  it('路径大小写保留（只有主机名归一）', () => {
    expect(linkVariants('https://blog.example.com/About')).not.toContain('https://blog.example.com/about')
  })

  it('非法 URL 退回尾斜杠口径，不抛异常', () => {
    const variants = linkVariants('not-a-url')
    expect(variants).toContain('not-a-url')
    expect(variants).toContain('not-a-url/')
  })
})
