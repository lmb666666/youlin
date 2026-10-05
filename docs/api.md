# 接口文档

友邻对外只提供三个接口（**三个接口 = 三条路径**，命名各自独立）。本文是完整契约；机器可读的 JSON Schema 在仓库 [`schemas/`](../schemas/) 目录，CI 会用它校验接口响应与文档示例。

## 通用约定

- **CORS 全开**：`Access-Control-Allow-Origin: *`（可在设置中收紧，见配置参考 `api.corsOrigin`）
- **边缘缓存**：接口一/二默认 `Cache-Control: public, max-age=300`（`api.cacheSeconds` 可调）
- **时间**：一律 ISO 8601 UTC（如 `2026-10-05T13:55:00Z`）
- **字段**：camelCase；**可选字段无值即不输出**（按可选处理）
- **演进策略**：契约冻结，只做增量演进（新增可选字段）；破坏性变更会开新路径
- **错误响应**统一为：`{ "error": { "code": "...", "message": "...", "details": { ... } } }`

## 接口一：友链数据 `GET /api/links`

渲染友链页的数据源。分组结构输出；`status=hidden` 的记录不输出；站点自身信息不在本接口。

**参数**

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `group` | 否 | 按分组名精确过滤（URL 编码）；未命中时返回 `{ "groups": [] }` |

**响应字段**

| 字段 | 类型 | 必有 | 说明 |
| --- | --- | --- | --- |
| `groups[].name` | string | ✓ | 分组名 |
| `groups[].desc` | string |  | 分组说明 |
| `groups[].links[]` | array | ✓ | 该分组下的友链 |
| `links[].author` | string | ✓ | 站长名 |
| `links[].title` | string |  | 站点标题 |
| `links[].desc` | string |  | 站点简介 |
| `links[].link` | string | ✓ | 站点链接 |
| `links[].feed` | string |  | RSS/Atom 订阅地址 |
| `links[].icon` | string |  | favicon |
| `links[].avatar` | string |  | 头像 |
| `links[].archs` | string[] |  | 技术栈标签 |
| `links[].since` | string | ✓ | 订阅日期（`YYYY-MM-DD`） |
| `links[].comment` | string |  | 备注 |
| `links[].health` | object |  | 体检摘要（未体检时缺省） |

**`health` 字段**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `reachable` | boolean | 站点是否可达 |
| `crawlable` | boolean | RSS 是否可解析（可抓取） |
| `backlink` | boolean \| null | 是否检测到反链；`null` = 未检测 |
| `latency` | number | 响应耗时（秒，两位小数）；不可达为 `-1` |
| `lastPostAt` | string | 对方最近一篇文章发布时间 |
| `staleDays` | integer | 对方最近一篇文章距今天数 |
| `unreachableDays` | integer \| null | 失联天数；正常为 `null` |
| `checkedAt` | string | 本次体检时间 |

**示例**

```jsonc
{
  "groups": [
    {
      "name": "朋友们",
      "desc": "在这里添加你关注的博客。",
      "links": [
        {
          "author": "Liang",
          "title": "Liang 的博客",
          "link": "https://blog.liang.one/",
          "feed": "https://blog.liang.one/atom.xml",
          "avatar": "https://bu.dusays.com/2026/07/12/6a532cc8ab04a.webp",
          "archs": ["Nuxt"],
          "since": "2024-08-25",
          "health": { "reachable": true, "latency": 0.84, "staleDays": 10 }
        }
      ]
    }
  ]
}
```

完整示例（会被 CI 校验）见 [`schemas/examples/api-links.example.json`](../schemas/examples/api-links.example.json)。

## 接口二：朋友圈 `GET /api/circle`

朋友们最新文章的聚合。按 `publishedAt` 倒序；`stats` 基于「参与朋友圈」的友链全集（开启朋友圈且配了 feed），不受截断影响。

**参数**

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `limit` | 否 | 截断返回的文章条数（上限为 `api.maxLimit`，默认输出上限 `crawl.outputMaxArticles`） |

**响应字段**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `stats.friends` | integer | 参与朋友圈的友链数（feed 可用） |
| `stats.active` | integer | 其中当前有文章的 |
| `stats.failed` | integer | 其中最近一次抓取失败的 |
| `stats.articles` | integer | 库内文章总数 |
| `stats.updatedAt` | string \| null | 最近一次文章入库时间；无文章为 `null` |
| `articles[].title` | string | 文章标题 |
| `articles[].link` | string | 文章链接 |
| `articles[].author` | string | 作者（可选） |
| `articles[].avatar` | string | 作者头像（可选） |
| `articles[].publishedAt` | string | 发布时间（ISO 8601 UTC） |

**示例**

```jsonc
{
  "stats": { "friends": 6, "active": 4, "failed": 2, "articles": 17, "updatedAt": "2026-10-05T13:55:00Z" },
  "articles": [
    {
      "title": "近期小记（1）",
      "link": "https://blog.liang.one/posts/6b4e8a1",
      "author": "Liang",
      "avatar": "https://bu.dusays.com/2026/07/12/6a532cc8ab04a.webp",
      "publishedAt": "2025-11-22T13:36:25Z"
    }
  ]
}
```

## 接口三：友链申请 `/apply`

| 方法 | 说明 |
| --- | --- |
| `GET /apply` | 内置申请页（HTML，可直接外链给访客；文案由 `apply.intro` / `apply.successMessage` 配置） |
| `POST /apply` | JSON 提交申请 |

**`POST /apply` 请求字段**

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `siteName` | ✓* | 站点名称 |
| `link` | ✓* | 站点链接（http/https） |
| `author` |  | 站长昵称 |
| `avatar` |  | 头像链接 |
| `feed` |  | RSS 订阅地址（填写后可参与朋友圈抓取） |
| `desc` |  | 站点简介 |
| `contact` |  | 联系方式（仅站长可见） |
| `note` |  | 备注 |
| `turnstileToken` | ✓** | Turnstile 人机验证 token |

\* 必填字段集由配置 `apply.requiredFields` 决定，默认 `["siteName","link"]`。
\*\* 仅当开启 `apply.turnstile` 时必填。Turnstile 的 site key 是公开值（可见于申请页与设置页），自建表单时从申请页获取。

**成功响应（`201`）**

```jsonc
{
  "id": 12,
  "status": "pending",              // autoApprove 开启时为 "approved"
  "backlink": { "ok": true, "detail": "在 https://newfriend.example.com/links 发现指向 example.com 的链接" }
}
```

`backlink.ok` 为 `null` 表示未检测（策略关闭或对方站点无法访问），`detail` 为证据说明。

**错误码**

| 状态 | `code` | 场景 |
| --- | --- | --- |
| 400 | `invalid_json` / `validation_failed` | 请求体非 JSON / 字段校验失败（`details` 为字段级消息） |
| 403 | `apply_disabled` | 申请通道已关闭（`apply.enabled=0`） |
| 403 | `turnstile_failed` / `turnstile_unconfigured` | 人机验证未通过 / 服务端未配置 Secret |
| 403 | `backlink_missing` | `apply.backlinkPolicy=reject` 且未检测到反链（`details.backlink` 附证据） |
| 409 | `duplicate_link` / `already_pending` | 链接已在友链中 / 该链接已有待审申请 |
| 429 | `rate_limited` | 超过每 IP 每天 `apply.rateLimitPerDay` 次 |

**自建表单示例**

```js
const res = await fetch('https://your-instance.workers.dev/apply', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    siteName: '我的博客',
    link: 'https://example.com/',
    feed: 'https://example.com/atom.xml',
    turnstileToken: token, // 从 Turnstile 挂件获取
  }),
})
const data = await res.json()
if (res.ok) {
  // data.backlink.ok / data.backlink.detail 可直接展示给访客
} else {
  // data.error.message 与 data.error.details 可展示到表单
}
```

## 接入建议

- **推荐：前端运行时获取**（访客打开页面时 fetch，管理台改数据无需重新构建）。注意加超时与降级：接口失败时保留上次渲染或显示空态，不要白屏。
- 构建时/服务端获取（SSR / 静态生成）同样可用；改数据后可用管理台「重建站点」按钮触发你的构建（`rebuild.*` 配置）。

## 契约与校验

| 接口 | JSON Schema | 示例 |
| --- | --- | --- |
| 一 | [`schemas/api-links.response.schema.json`](../schemas/api-links.response.schema.json) | [`schemas/examples/api-links.example.json`](../schemas/examples/api-links.example.json) |
| 二 | [`schemas/api-circle.response.schema.json`](../schemas/api-circle.response.schema.json) | [`schemas/examples/api-circle.example.json`](../schemas/examples/api-circle.example.json) |
| 三 | [`schemas/api-apply.response.schema.json`](../schemas/api-apply.response.schema.json) | [`schemas/examples/api-apply.example.json`](../schemas/examples/api-apply.example.json) |

测试会在本地运行时对真实响应执行 schema 校验（`pnpm test`），保证实现、示例与文档一致。
