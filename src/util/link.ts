/** link 的等价写法（尾斜杠差异不应绕过去重） */
export function linkVariants(link: string): string[] {
  const noSlash = link.replace(/\/+$/, '')
  return [...new Set([link, noSlash, noSlash + '/'])]
}
