# 配置参考

友邻的配置分三层，优先级从低到高：

| 层 | 位置 | 谁改 | 说明 |
| --- | --- | --- | --- |
| 部署级 | `wrangler.jsonc` + Secrets | 部署者（一次性） | D1 绑定、Cron 表达式、`ADMIN_TOKEN`、`TURNSTILE_SECRET`、`GITHUB_PAT` |
| 应用级 | D1 `settings` 表（管理台「设置」页可视化编辑） | 管理员（随时） | 下方全部业务配置 |
| 覆盖级 | 环境变量 `YOULIN_CONFIG_OVERRIDES`（JSON 文本） | 自动化部署 | 可覆盖任意应用级配置 |

- **每个配置项都有默认值**，部署后开箱即用；管理台「设置」页由配置 schema 自动渲染，支持导出/导入。
- 覆盖级示例（把主站地址与缓存时间固定，不受管理台误改影响）：

  ```bash
  wrangler secret put YOULIN_CONFIG_OVERRIDES
  # 粘贴：{"site.url":"https://example.com","api.cacheSeconds":600}
  ```

## 部署级（Secrets）

| 名称 | 必填 | 说明 |
| --- | --- | --- |
| `ADMIN_TOKEN` | 是 | 管理台登录口令。建议 `openssl rand -hex 32` 生成；登录时使用。 |
| `TURNSTILE_SECRET` | 否 | Cloudflare Turnstile 的 Secret Key。启用申请页人机验证（`apply.turnstile`）时需要，与 `apply.turnstileSiteKey` 配对。 |
| `GITHUB_PAT` | 否 | GitHub fine-grained PAT（仅单仓库、只给 dispatch 权限）。仅在 `rebuild.provider = github_dispatch` 时需要。 |

## 应用级配置

<!-- CONFIG_TABLE_START -->
<!-- 由 scripts/gen-config-docs.mjs 从 src/config/definition.ts 生成，请勿手改；改配置后运行：pnpm docs:config -->

当前配置版本：`1`

### 站点（`site.*`）

站点基础信息，用于管理台、申请页与抓取 UA。

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `site.name` | `我的博客` | 站点名称。管理台与申请页标题。 |
| `site.url` | 空 | 主站地址。反链检测的默认目标，如 https://example.com |
| `site.logo` | 空 | 站点 Logo。申请页显示（可选）。 |
| `site.description` | 空 | 站点简介。申请页副标题（可选）。 |
| `site.timezone` | `Asia/Shanghai` | 时区。管理台与申请页的时间显示。 |
| `site.locale` | `zh-CN` | 界面语言。当前仅 zh-CN（英文计划 v1.1）。 |

### 朋友圈抓取（`crawl.*`）

按分批轮转设计执行，避免超出 Workers 免费版单次 10ms CPU。

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `crawl.enabled` | `true` | 抓取总开关。关闭后 Cron 不再抓取，接口二仍输出库内数据。 |
| `crawl.batchSize` | `3` | 每轮站点数。与 Cron 频率共同决定刷新周期：每 5 分钟 3 站，60 源约 100 分钟一圈。 |
| `crawl.maxPerFriend` | `5` | 每站篇数上限。每个源只保留最新 N 篇。 |
| `crawl.outputMaxArticles` | `150` | 输出总量上限。接口二按发布时间保留最新 N 篇。 |
| `crawl.futureToleranceDays` | `2` | 未来时间容差（天）。文章发布时间晚于当前时间超过该天数将被丢弃。 |
| `crawl.retentionDays` | `90` | 库内保留天数。超期文章由每日清理任务删除。 |
| `crawl.timeoutSeconds` | `15` | 单源超时（秒）。抓取单个源的超时时间。 |
| `crawl.userAgent` | `Youlin/1.0 (+{site.url})` | 抓取 UA。{site.url} 会替换为 site.url 实际值。 |
| `crawl.concurrency` | `5` | 手动全量并发。手动触发抓取一轮时的并发数。 |

### 体检（`linkCheck.*`）

友链可达性 / RSS 可用性 / 失联退避。

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `linkCheck.enabled` | `true` | 体检总开关。关闭后不再检测，已有结果仍会输出。 |
| `linkCheck.maxAgeHours` | `24` | 复查间隔（小时）。同一友链两次检测的最小间隔。 |
| `linkCheck.timeoutSeconds` | `15` | 单次超时（秒）。体检单个源的超时时间。 |
| `linkCheck.concurrency` | `10` | 全量检测并发。手动全量体检时的并发数。 |
| `linkCheck.statusApiUrl` | 空 | 状态 API 兜底。第三方状态检测地址，{url} 占位符，留空关闭。 |
| `linkCheck.backoffLadder` | `[[10,120],[30,240],[60,360]]` | 失联退避阶梯。[[失联天数, 复查间隔小时]，…] 升序；默认 10 天→120h、30 天→240h、60 天→360h。 |

### 反链检测（`backlink.*`）

检测对方站点是否含有指向你站点的链接。

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `backlink.enabled` | `true` | 反链检测。体检与申请流程共用的开关。 |
| `backlink.authorUrl` | 空 | 自家域名。默认取 site.url；填写后以此为准，如 example.com 或 https://example.com。 |

### 代理（`proxy.*`）

直连失败时的代理前缀（可选）。

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `proxy.url` | 空 | 代理地址。形如 https://proxy.example.com/ ，实际请求为 代理地址 + 目标 URL。 |
| `proxy.mode` | `fallback` | 代理模式（off / fallback / always）。off 关闭 / fallback 直连失败再走代理 / always 始终走代理。 |

### 友链申请（`apply.*`）

公开申请页（接口三）的行为。

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `apply.enabled` | `true` | 申请通道。关闭后 /apply 显示停用提示，POST /apply 返回 403。 |
| `apply.rateLimitPerDay` | `3` | 每 IP 每天上限。按天限流，超出返回 429。 |
| `apply.turnstile` | `true` | 人机验证。Cloudflare Turnstile；关闭需自担垃圾提交风险。 |
| `apply.turnstileSiteKey` | 空 | Turnstile Site Key。公开值；Secret（TURNSTILE_SECRET）在部署级配置。 |
| `apply.backlinkPolicy` | `mark` | 反链策略（mark / reject / off）。mark 仅标记 / reject 未检测到反链即拒绝 / off 不检测。 |
| `apply.autoApprove` | `false` | 自动通过。提交即入库（不推荐，垃圾提交无人工拦截）。 |
| `apply.requiredFields` | `["siteName","link"]` | 必填字段。申请表单必填字段集（siteName / link / author / avatar / feed / desc / contact / note）。 |
| `apply.intro` | 空 | 申请页说明。留空使用内置文案。 |
| `apply.successMessage` | 空 | 提交成功提示。留空使用内置文案。 |

### 接口（`api.*`）

对外接口（一/二）的缓存与输出行为。

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `api.cacheSeconds` | `300` | 边缘缓存（秒）。接口一/二的 Cache-Control。 |
| `api.corsOrigin` | `*` | CORS 来源。允许的 Origin，* 或具体来源。 |
| `api.includeHidden` | `false` | 输出隐藏记录。开启后 hidden 友链也会出现在接口一。 |
| `api.maxLimit` | `500` | limit 上限。?limit= 允许的最大值。 |

### 重建集成（`rebuild.*`）

可选：数据变化后触发接入方站点重建（仅构建时接入需要）。

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `rebuild.enabled` | `false` | 启用重建。运行时接入无需重建，保持关闭。 |
| `rebuild.provider` | `webhook` | 触发方式（webhook / github_dispatch）。webhook 通用 POST / github_dispatch 仓库事件。 |
| `rebuild.webhookUrl` | 空 | Webhook 地址。provider=webhook 时的目标 URL（兼容 Pages / Vercel Deploy Hook）。 |
| `rebuild.githubRepo` | 空 | GitHub 仓库。provider=github_dispatch 时，owner/name。 |
| `rebuild.eventType` | `friends-updated` | 事件类型。repository_dispatch 的事件名。 |
| `rebuild.auto` | `false` | 自动触发。保存友链 / 通过申请后自动触发重建。 |
| `rebuild.debounceSeconds` | `60` | 防抖（秒）。两次触发之间的最小间隔。 |

### 界面（`ui.*`）

管理台与申请页的外观。

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `ui.theme` | `system` | 主题（system / light / dark）。跟随系统 / 浅色 / 深色。 |
| `ui.accentColor` | 空 | 强调色。shadcn CSS 变量的主色，留空使用默认主题色。 |
| `ui.pageSize` | `20` | 分页大小。列表页每页条数。 |

### 安全（`security.*`）

会话与登录保护（部署级密钥在 wrangler secrets，不在此处）。

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `security.sessionDays` | `30` | 会话有效期（天）。登录 Cookie 的有效期。 |
| `security.loginRateLimit` | `5` | 登录限流（次/小时）。单 IP 每小时登录尝试上限，超出返回 429。 |

### 通知（v1.1 预留）（`notify.*`）

事件通知接口已定义，发送逻辑随 v1.1 提供。

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `notify.webhookUrl` | 空 | Webhook 地址。新申请 / 友链失联时 POST 通知。 |
| `notify.events` | `["application","linkDown"]` | 通知事件。application 新申请 / linkDown 友链失联。 |
<!-- CONFIG_TABLE_END -->
