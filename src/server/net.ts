import { Agent } from 'undici'
import { lookup } from 'node:dns/promises'
import type { LookupAddress, LookupOptions } from 'node:dns'
import { isPrivateIp } from '../util/ip'

/**
 * Node 侧出站防护：把 DNS 解析结果与 TCP 连接绑定在同一个 dispatcher 上。
 *
 * 只检查 URL 主机名会漏掉「域名解析到 127.0.0.1 / 172.16.x.x」的 SSRF；
 * 先 lookup 再 fetch 又有 DNS rebinding 的竞态窗口。undici 的 connect.lookup
 * 在建立连接前调用，这里拒绝任何解析到内网/环回地址的结果，并让连接直接使用
 * 已校验的地址。
 *
 * Workers 不使用该 dispatcher，私网出站由平台拦截。
 */

function blockedMessage(address: string): string {
  return `目标地址解析到内网/环回地址（${address}）`
}

function normalizeFamily(family: LookupOptions['family']): 0 | 4 | 6 {
  if (family === 4 || family === 'IPv4') return 4
  if (family === 6 || family === 'IPv6') return 6
  return 0
}

/** 供 Agent 使用的 lookup：解析全部地址，任一地址为私网即拒绝 */
function guardedLookup(
  hostname: string,
  options: LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
): void {
  lookup(hostname, { all: true, verbatim: true, family: normalizeFamily(options.family) })
    .then((addresses) => {
      const bad = addresses.find((a) => isPrivateIp(a.address))
      if (bad) {
        const error = new Error(blockedMessage(bad.address))
        error.name = 'BlockedPrivateAddress'
        callback(error as NodeJS.ErrnoException, '', 0)
        return
      }
      const first = addresses[0]
      if (!first) {
        const error = new Error(`无法解析目标地址：${hostname}`)
        error.name = 'DnsNoAddress'
        callback(error as NodeJS.ErrnoException, '', 0)
        return
      }
      if (options.all) {
        callback(null, addresses.map((a) => ({ address: a.address, family: a.family })))
        return
      }
      callback(null, first.address, first.family)
    })
    .catch((err: NodeJS.ErrnoException) => callback(err, '', 0))
}

export const guardedDispatcher = new Agent({
  connect: { lookup: guardedLookup },
})
