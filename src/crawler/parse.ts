import { XMLParser } from 'fast-xml-parser'

/**
 * RSS 2.0 / Atom 1.0（兼容 RSS 1.0 RDF）解析（DESIGN §6 语义）：
 *  - published 优先、回退 updated，都缺失丢弃该条
 *  - 坏条目跳过（无 title/link）
 *  - guid 缺失时用 link 的 sha1
 *  - 时间一律归一 ISO 8601 UTC
 */

export interface ParsedEntry {
  guid: string
  title: string
  link: string
  author: string | null
  publishedAt: string
}

export interface ParsedFeed {
  title: string | null
  entries: ParsedEntry[]
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: true,
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
})

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o['#text'] === 'string') return text(o['#text'])
    if (typeof o['@_href'] === 'string') return o['@_href']
  }
  return null
}

function toIso(v: unknown): string | null {
  const s = text(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

async function sha1Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Atom <link>：优先 rel=alternate / 无 rel，取其 href */
function atomLink(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const list = Array.isArray(v) ? v : [v]
  const rels = list
    .map((l) => (typeof l === 'object' && l !== null ? (l as Record<string, unknown>) : null))
    .filter((l): l is Record<string, unknown> => l !== null)
  const pick = rels.find((l) => l['@_rel'] === 'alternate') ?? rels.find((l) => !l['@_rel'])
  return pick ? text(pick['@_href'] ?? pick['#text']) : null
}

function entryAuthor(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    if (o.name !== undefined) return text(o.name)
  }
  return text(v)
}

/** 解析失败抛错（调用方决定记为不可抓取）；单条坏数据跳过不抛 */
export async function parseFeed(xml: string): Promise<ParsedFeed> {
  let doc: Record<string, unknown>
  try {
    doc = parser.parse(xml) as Record<string, unknown>
  } catch {
    throw new Error('xml_parse_failed')
  }

  // Atom：feed/entry
  const atom = doc.feed as Record<string, unknown> | undefined
  if (atom && typeof atom === 'object') {
    const rawEntries = toArray(atom.entry)
    const entries: ParsedEntry[] = []
    for (const raw of rawEntries) {
      const e = normalizeAtomEntry(raw)
      if (e) entries.push(e)
    }
    return { title: text(atom.title), entries }
  }

  // RSS 2.0：rss/channel/item；RSS 1.0 RDF：rdf:RDF/item
  const rss = doc.rss as Record<string, unknown> | undefined
  const rdf = doc['rdf:RDF'] as Record<string, unknown> | undefined
  const channel = (rss?.channel ?? rdf) as Record<string, unknown> | undefined
  if (channel && typeof channel === 'object') {
    const rawItems = toArray(channel.item)
    const entries: ParsedEntry[] = []
    for (const raw of rawItems) {
      const e = normalizeRssItem(raw)
      if (e) entries.push(e)
    }
    return { title: text(channel.title), entries }
  }

  throw new Error('unknown_feed_format')
}

function toArray(v: unknown): Record<string, unknown>[] {
  if (v === undefined || v === null) return []
  const list = Array.isArray(v) ? v : [v]
  return list.filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object')
}

function normalizeAtomEntry(raw: unknown): ParsedEntry | null {
  const e = raw as Record<string, unknown>
  const title = text(e.title)
  const link = atomLink(e.link)
  if (!title || !link) return null
  const publishedAt = toIso(e.published) ?? toIso(e.updated) ?? toIso(e.issued)
  if (!publishedAt) return null
  const id = text(e.id)
  return {
    guid: id ?? '', // 由调用方用 sha1(link) 兜底
    title,
    link,
    author: entryAuthor(e.author),
    publishedAt,
  }
}

function normalizeRssItem(raw: unknown): ParsedEntry | null {
  const e = raw as Record<string, unknown>
  const title = text(e.title)
  const link = text(e.link) ?? atomLink(e['atom:link']) ?? text(e.guid)
  if (!title || !link) return null
  // RSS 时间字段各家写法不一：pubDate / dc:date / published / updated
  const publishedAt =
    toIso(e.pubDate) ?? toIso(e['dc:date']) ?? toIso(e.published) ?? toIso(e.updated) ?? toIso(e['atom:updated'])
  if (!publishedAt) return null
  const guid = text(e.guid)
  const author = entryAuthor(e['dc:creator']) ?? entryAuthor(e.author)
  return { guid: guid ?? '', title, link, author, publishedAt }
}

/** guid 缺失时用 link 的 sha1 兜底（DESIGN §3 去重键规则） */
export async function withResolvedGuids(feed: ParsedFeed): Promise<ParsedEntry[]> {
  const out: ParsedEntry[] = []
  for (const e of feed.entries) {
    out.push({ ...e, guid: e.guid || (await sha1Hex(e.link)) })
  }
  return out
}
