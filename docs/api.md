# 接口文档 | API Reference

友邻对外提供三条业务路径，以及一个运维探针：

| 业务 | 端点 | 说明 |
| --- | --- | --- |
| 友链数据 | `GET /api/links` | 分组 + 友链 + 体检摘要 |
| 朋友圈 | `GET /api/circle` | 文章列表与统计 |
| 友链申请 | `GET /apply`、`POST /apply` | 申请页与提交 |
| 健康检查 | `GET /healthz` | 数据库可达性，供监控使用 |

机器可读的响应 Schema 在 [`schemas/`](../schemas/)；完整示例在 [`schemas/examples/`](../schemas/examples/)。管理 API（`/api/admin/*`）属于内部接口，不承诺对外兼容，本文不展开。

## 快速开始 | Quick Start

```bash
BASE=https://links.example.com

# 友链数据
curl -sS "$BASE/api/links" | jq

# 按分组过滤（分组名需 URL 编码）
curl -sS "$BASE/api/links?group=%E6%9C%8B%E5%8F%8B%E4%BB%AC" | jq

# 朋友圈（最多 20 篇）
curl -sS "$BASE/api/circle?limit=20" | jq

# 提交申请
curl -sS -X POST "$BASE/apply" \
  -H 'Content-Type: application/json' \
  -d '{"siteName":"我的博客","link":"https://example.com/"}' | jq

# 健康检查
curl -i "$BASE/healthz"
```

前端最小接入示例：

```js
const controller = new AbortController()
const timer = setTimeout(() => controller.abort(), 8000)
try {
  const res = await fetch('https://links.example.com/api/links', { signal: controller.signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const { groups } = await res.json()
  // groups[].links[] 里是 author / link / avatar / feed / health …
} catch (error) {
  // 保留上次渲染或显示空态，不要白屏
} finally {
  clearTimeout(timer)
}
```

## 通用约定 | Conventions

### 请求与响应

- 公开接口不需要认证。
- `POST /apply` 必须是 JSON；请求体上限 **64 KiB**，超出返回 `413 payload_too_large`。
- 成功响应：`application/json`（`/apply` 页面为 HTML）。
- 错误响应统一为：

```json
{ "error": { "code": "validation_failed", "message": "请检查表单填写", "details": { "link": "请填写站点链接" } } }
```

`/healthz` 例外：它直接返回 `{ "ok": boolean, "db": boolean }`，不使用错误信封。

### CORS

- 默认 `Access-Control-Allow-Origin: *`。
- `api.corsOrigin` 可收紧为单个来源；此时响应带 `Vary: Origin`，但**不支持**来源列表。
- 不发送 `Access-Control-Allow-Credentials`。
- `OPTIONS` 预检：

| 路径 | Allow-Methods | Allow-Headers |
| --- | --- | --- |
| `/api/links`、`/api/circle` | `GET, OPTIONS` | — |
| `/apply` | `GET, POST, OPTIONS` | `Content-Type` |

### 缓存

| 响应 | Cache-Control |
| --- | --- |
| `GET /api/links` | `public, max-age={api.cacheSeconds}`（默认 300） |
| `GET /api/circle` | 同上 |
| `GET /apply` | `no-store` |
| `GET /healthz` | `no-store` |
| 错误响应 | 不额外设置缓存头 |

这里的缓存是普通 HTTP 缓存（浏览器、反向代理、CDN），不是服务端缓存。管理台修改数据后，接口可能仍被下游缓存到 `api.cacheSeconds` 秒。

### 时间与字段

- 输出时间一律 ISO 8601 UTC（如 `2026-11-08T10:24:54Z`）。
- `since` 是日期 `YYYY-MM-DD`，不是时间戳。
- 字段 camelCase；可选字段无值即不输出（按可选处理）。
- 只有明确标注的字段会输出 `null`。

### 排序

- 分组按 `sort ASC, id ASC`；友链按 `sort ASC, id ASC`。
- 空分组照常输出，`links` 为 `[]`。

## 友链数据 | `GET /api/links`

### 参数

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `group` | 否 | 按分组名**精确、大小写敏感**过滤；需 URL 编码。未知名称返回 `{ "groups": [] }`。 |

- 不传 `group` 与传空字符串 `?group=` 不是同一种情况：后者按空名称过滤。
- 默认不输出 `status=hidden` 的友链；设置 `api.includeHidden=true` 后会输出。

### 响应字段

| 字段 | 类型 | 必有 | 说明 |
| --- | --- | --- | --- |
| `groups[].name` | string | ✓ | 分组名 |
| `groups[].desc` | string |  | 分组说明 |
| `groups[].links[]` | array | ✓ | 该分组下的友链 |
| `links[].author` | string | ✓ | 站长名，非空 |
| `links[].title` | string |  | 站点标题 |
| `links[].desc` | string |  | 站点简介 |
| `links[].link` | string | ✓ | 站点链接（http/https） |
| `links[].feed` | string |  | RSS/Atom 地址 |
| `links[].icon` | string |  | favicon |
| `links[].avatar` | string |  | 头像 |
| `links[].archs` | string[] |  | 技术栈标签；空数组不输出 |
| `links[].since` | string | ✓ | 订阅日期 `YYYY-MM-DD` |
| `links[].comment` | string |  | 备注 |
| `links[].health` | object |  | 体检摘要；未体检时缺省 |

### `health` 字段

`health` 是最近一次体检的**快照**，不是实时探测；只有该友链存在 `checkedAt` 时才输出。

| 字段 | 类型 | 必有 | 说明 |
| --- | --- | --- | --- |
| `backlink` | boolean \| null | ✓ | `true` 检测到；`false` 检测过但未找到；`null` 未检测或检测不确定 |
| `unreachableDays` | integer \| null | ✓ | 失联天数；正常为 `null`，`0` 也可能出现 |
| `checkedAt` | string | ✓ | 本次体检时间（ISO UTC） |
| `reachable` | boolean |  | 站点是否可达；未知时不输出 |
| `crawlable` | boolean |  | RSS 是否可解析；未知时不输出 |
| `latency` | number |  | 秒，四舍五入到 0.01；不可达为 `-1`；未知时不输出 |
| `lastPostAt` | string |  | 对方最近一篇文章的发布时间 |
| `staleDays` | integer |  | 对方最近一篇文章距今天数，`>= 0` |

`backlink=null` 的情况包括：未开启反链检测、未配置自家域名、对方页面不可达或返回非 2xx。检测关闭后，历史值不会自动清空。

### 示例

```jsonc
{
  "groups": [
    {
      "name": "朋友们",
      "desc": "常来往的博客",
      "links": [
        {
          "author": "Liang",
          "title": "Liang 的博客",
          "desc": "一位数码科技爱好者",
          "link": "https://blog.liang.one/",
          "feed": "https://blog.liang.one/atom.xml",
          "avatar": "https://bu.dusays.com/2026/07/12/6a532cc8ab04a.webp",
          "archs": ["Nuxt"],
          "since": "2024-08-25",
          "health": {
            "reachable": true,
            "crawlable": true,
            "backlink": true,
            "latency": 0.84,
            "lastPostAt": "2026-11-05T09:50:21Z",
            "staleDays": 3,
            "unreachableDays": null,
            "checkedAt": "2026-11-08T08:50:21Z"
          }
        }
      ]
    }
  ]
}
```

完整示例见 [`schemas/examples/api-links.example.json`](../schemas/examples/api-links.example.json)。

## 朋友圈 | `GET /api/circle`

### 参数

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `limit` | 否 | 截断文章条数。有效上限为 `min(crawl.outputMaxArticles, api.maxLimit)`（默认 `min(150, 500) = 150`）。 |

- `limit` 必须是正整数；空值、`0`、负数、非数字、非整数都会回退到上限，而不是返回 0 或 400。
- `stats` 不受 `limit` 影响，只有 `articles` 会被截断。

### 响应字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `stats.friends` | integer | 参与朋友圈的友链数：`status=active`、`in_circle=1`、`feed` 非空 |
| `stats.active` | integer | 库内仍有文章的友链数：`active + in_circle` 中在 `articles` 里去重后的数量 |
| `stats.failed` | integer | 上述参与朋友圈的源中，最近一次检查 `reachable=0` 或 `crawlable=0` 的数量 |
| `stats.articles` | integer | `active + in_circle` 的友链在库内的文章总数 |
| `stats.updatedAt` | string \| null | 最近一次文章入库时间（`fetched_at`），无文章为 `null` |
| `articles[].title` | string | 文章标题 |
| `articles[].link` | string | 文章链接 |
| `articles[].author` | string | 文章 feed 条目里的作者（可选） |
| `articles[].avatar` | string | 友链记录里配置的头像（可选；不是文章作者头像） |
| `articles[].publishedAt` | string | 发布时间（ISO 8601 UTC） |

> **口径说明**：`stats.friends` / `stats.failed` 使用「有 feed 的当前源」；`stats.active` / `stats.articles` / `stats.updatedAt` 与文章输出使用 `active + in_circle`，不要求 feed 仍然存在。因此某个源清空 feed 后，它库内的旧文章仍可能被输出，直到保留期清理。`stats.active` 理论上可能大于 `stats.friends`，这是当前实现的已知行为。

文章按发布时间倒序；同一时间按入库 `id` 倒序。`in_circle=0` 与 `status=hidden` 的源不会出现在文章列表里。

### 示例

```jsonc
{
  "stats": {
    "friends": 6,
    "active": 4,
    "failed": 2,
    "articles": 17,
    "updatedAt": "2026-11-08T10:24:54Z"
  },
  "articles": [
    {
      "title": "近期小记（1）",
      "link": "https://blog.liang.one/posts/6b4e8a1",
      "author": "Liang",
      "avatar": "https://bu.dusays.com/2026/07/12/6a532cc8ab04a.webp",
      "publishedAt": "2026-11-05T09:50:21Z"
    }
  ]
}
```

完整示例见 [`schemas/examples/api-circle.example.json`](../schemas/examples/api-circle.example.json)。

## 友链申请 | `/apply`

### `GET /apply`

返回服务端渲染的申请页 HTML。

- `Cache-Control: no-store`；`noindex`；带基础安全头，不能被 iframe 嵌入。
- 文案回退：`apply.intro` → `site.description` → 内置文案；`apply.successMessage` → 内置文案。
- `apply.enabled=false` 时只显示停用提示，不渲染表单。
- `apply.turnstile=true` 但未配置 `apply.turnstileSiteKey` 时只显示「人机验证未配置」，不渲染必然失败的表单。
- `link` 字段始终标记为必填，即使它不在 `apply.requiredFields` 里。
- `/apply/` 会以 `308` 重定向到 `/apply`。

### `POST /apply` 请求字段

请求体必须是 JSON 对象；字段名严格校验，未知字段返回 `400 validation_failed`。

| 字段 | 类型 / 上限 | 必填 | 说明 |
| --- | --- | --- | --- |
| `siteName` | string ≤ 100 | 默认必填 | 站点名称；未填写且未要求时回退为链接的 hostname |
| `link` | http(s) URL ≤ 2048 | **始终必填** | 站点链接 |
| `author` | string ≤ 100 | 否 | 站长昵称；入库时缺省用 `siteName` |
| `avatar` | http(s) URL ≤ 2048 | 否 | 头像 |
| `feed` | http(s) URL ≤ 2048 | 否 | RSS/Atom 地址；通过后参与朋友圈 |
| `desc` | string ≤ 2000 | 否 | 站点简介 |
| `contact` | string ≤ 200 | 否 | 联系方式；仅管理台可见 |
| `note` | string ≤ 2000 | 否 | 备注；审核通过后会成为公开友链的 `comment` |
| `turnstileToken` | string ≤ 4000 | 开启人机验证时必填 | Turnstile 返回的 token |

可选字段可以省略、传 `null` 或空串；空串按未填写处理。字符串会 trim 后入库。

### 处理顺序

1. 读取请求体：超过 64 KiB → `413 payload_too_large`；非 JSON → `400 invalid_json`。
2. `apply.enabled=false` → `403 apply_disabled`（请求体解析在开关检查之前）。
3. zod 严格校验 → `400 validation_failed`。
4. 配置的必填字段 + 始终必填的 `link` → `400 validation_failed`。
5. 按 IP / UTC 日原子预占限流名额 → `429 rate_limited`。
6. 去重：已在友链表 → `409 duplicate_link`；已有待审申请 → `409 already_pending`。
7. Turnstile：缺 token → `400 validation_failed`（`details.turnstileToken`）；缺服务端密钥 → `403 turnstile_unconfigured`；验证失败/超时 → `403 turnstile_failed`。
8. 反链检测：策略 `mark` 记录结果继续；`reject` 且 `ok !== true` → `403 backlink_missing`。
9. 落库；唯一约束竞态映射为 `409 duplicate_link` / `409 already_pending`。
10. 任一步失败会归还限流名额；只有成功提交计数。

### 成功响应（201）

```jsonc
{
  "id": 12,
  "status": "pending",
  "backlink": {
    "ok": true,
    "detail": "在 https://newfriend.example.com/ 发现指向 example.com 的链接"
  }
}
```

- `id` 是申请 ID（不是友链 ID）。
- `status` 为 `pending`；开启 `apply.autoApprove` 时为 `approved`。
- `backlink` 始终存在；`ok=null` 表示未检测或检测不确定，`detail` 为证据/原因，可能为 `null`。
- `autoApprove` 会在同一事务里把申请标记为已通过，并创建/复用「未分组」友链；不会自动触发重建。

### Turnstile

- 仅当 `apply.turnstile=true` 时校验；关闭时 token 即使传入也会被忽略。
- 服务端会请求 Cloudflare `siteverify`，超时 10 秒；网络失败或 `success !== true` 都按 `turnstile_failed` 处理。
- 缺少 token 是 `400`，不是 `403`；`turnstile_unconfigured` 只在「提供了 token 但服务端没有 `TURNSTILE_SECRET`」时出现。

### 反链策略

- 检测目标：`backlink.authorUrl || site.url`，归一化为 hostname（去掉前缀 `www.`）。
- `apply.backlinkPolicy=off` 不检测；`mark` 记录并继续；`reject` 要求 `ok=true`。
- `backlink.enabled=false`、两个地址都为空、对方站点不可达/非 2xx 时，结果可能是 `ok=null`；`reject` 策略下这些情况都会被拒绝。
- 只匹配 HTML `href` 中的 http://、https://、协议相对、可选 `www` 与子域；纯文本提及不算。
- 申请反链检测使用 `crawl.timeoutSeconds`，不是 `linkCheck.timeoutSeconds`。

### 限流

- 每个 IP、每个 UTC 日，默认 3 次（`apply.rateLimitPerDay`，1–100）。
- 只有成功提交计数；失败会归还名额。并发提交可能轻微超限。
- IP 解析受 `TRUST_PROXY` 影响；共享 NAT 出口会共享额度。响应不设置 `Retry-After`。

### 重复判定

- 只要链接已在友链表（包括隐藏友链）就返回 `duplicate_link`。
- 只有 `pending` 申请会阻止重复提交；已通过/已拒绝的历史申请不影响再次提交。
- 仅归一化尾斜杠（`x`、`x/`、`x///` 视为同一个）；`http/https`、`www`、端口、路径大小写不归一化。

### 错误码

| 状态 | `code` | 场景 |
| --- | --- | --- |
| 400 | `invalid_json` | 请求体为空、不可读或不是 JSON |
| 400 | `validation_failed` | 字段类型/长度/URL 不合法、未知字段、缺少必填字段或 Turnstile token |
| 403 | `apply_disabled` | 申请通道关闭 |
| 403 | `turnstile_unconfigured` | 提供了 token，但服务端缺少 `TURNSTILE_SECRET` |
| 403 | `turnstile_failed` | 人机验证失败、Cloudflare 非 2xx 或超时 |
| 403 | `backlink_missing` | `reject` 策略且未检测到反链（`details.backlink` 为说明字符串） |
| 409 | `duplicate_link` | 链接已在友链表中，或自动通过时的竞态 |
| 409 | `already_pending` | 已有待审申请，或插入竞态 |
| 413 | `payload_too_large` | 请求体超过 64 KiB |
| 429 | `rate_limited` | 当日成功提交次数已达上限 |
| 500 | `internal` | 未处理的服务端错误 |
| 503 | `database_not_migrated` | 数据库表/列缺失，通常是迁移失败 |
| 404 | `not_found` | 未知路径或方法 |

### 自建表单示例

```js
const res = await fetch('https://links.example.com/apply', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    siteName: '我的博客',
    link: 'https://example.com/',
    feed: 'https://example.com/atom.xml',
    turnstileToken: token,
  }),
})
const data = await res.json()
if (res.ok) {
  // data.id / data.status / data.backlink
} else {
  // data.error.code / data.error.message / data.error.details
}
```

## 健康检查 | `GET /healthz`

- 成功：`200 {"ok":true,"db":true}`。
- 数据库不可用：`503 {"ok":false,"db":false}`。
- `Cache-Control: no-store`；无 CORS；503 不使用错误信封。
- 只检查数据库连通性，不检查调度器、备份、磁盘或迁移状态。

## 接入建议 | Integration Guide

- **推荐运行时获取**：访客打开页面时 fetch，管理台改数据后无需重新构建。加超时与降级，接口失败时保留上次渲染或显示空态。
- **构建时 / SSR 获取**：同样可用；改数据后可在朋友圈页点「重建站点」触发接入方构建（需先开启 `rebuild.enabled`）。
- `health` 可能缺省，渲染前先判断；`health.backlink` / `unreachableDays` 可能为 `null`。
- 接口字段只做增量演进：新增可选字段可以，破坏性变更会开新路径。

## 契约与校验 | Contract & Validation

| 接口 | JSON Schema | 示例 |
| --- | --- | --- |
| 友链数据 | [`schemas/api-links.response.schema.json`](../schemas/api-links.response.schema.json) | [`schemas/examples/api-links.example.json`](../schemas/examples/api-links.example.json) |
| 朋友圈 | [`schemas/api-circle.response.schema.json`](../schemas/api-circle.response.schema.json) | [`schemas/examples/api-circle.example.json`](../schemas/examples/api-circle.example.json) |
| 申请 | [`schemas/api-apply.response.schema.json`](../schemas/api-apply.response.schema.json) | [`schemas/examples/api-apply.example.json`](../schemas/examples/api-apply.example.json) |

`pnpm test` 会校验真实接口响应与上述示例文件；本文中的 Markdown 片段不会被自动解析，改动时请同步对应的 Schema/示例。

## 影响公开接口的配置

| 键 | 影响 |
| --- | --- |
| `api.cacheSeconds` | `/api/links`、`/api/circle` 的 `Cache-Control: max-age` |
| `api.corsOrigin` | `Access-Control-Allow-Origin`；非 `*` 时带 `Vary: Origin` |
| `api.includeHidden` | 是否在 `/api/links` 输出隐藏友链 |
| `api.maxLimit` | `/api/circle?limit=` 的上限之一 |
| `crawl.outputMaxArticles` | `/api/circle` 默认/最大输出条数的另一上限 |
| `apply.*` / `backlink.*` | 申请页文案、开关、限流、反链与自动通过 |
