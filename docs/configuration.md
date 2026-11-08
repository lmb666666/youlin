# 配置参考 | Configuration Reference

友邻有两套独立的配置：

1. **部署级环境变量**：`ADMIN_TOKEN`、`PORT`、`DB_PATH`、`CRON_*`、`TRUST_PROXY` 等。它们在进程启动时读取，不属于应用配置对象；完整表格见[部署指南 § 环境变量](deployment.md#环境变量--environment)。
2. **应用级配置**：站点、抓取、体检、申请、接口、备份等业务参数。每个字段都有默认值，在管理台「设置」页编辑，存在 SQLite `settings` 表里。

本文重点说明第二套；部署级变量请直接看部署指南。

## 应用配置的三层 | Three Layers

优先级从低到高：

| 层 | 位置 | 说明 |
| --- | --- | --- |
| 代码默认值 | `src/config/definition.ts` | 每个字段都有默认值，开箱即用 |
| 应用设置 | SQLite `settings` 表 | 管理台「设置」页写入；`internal.*` / `settings.*` 是运行时簿记，不属于应用配置 |
| 部署覆盖 | 环境变量 `YOULIN_CONFIG_OVERRIDES` | 扁平点号键 JSON，优先级最高 |

覆盖示例：

```bash
YOULIN_CONFIG_OVERRIDES='{"site.url":"https://example.com","api.cacheSeconds":600}'
```

### 覆盖规则

- 只接受 `src/config/definition.ts` 中存在的键；未知键按个丢弃并记录 warning。
- 必须是**扁平点号键**对象；嵌套对象（`{"site":{"url":...}}`）不会被识别。
- 值会经过与设置页相同的 zod 校验；非法值按个丢弃，回退到下一层。
- 整段 JSON 非法时整段忽略，不会阻断启动。
- 覆盖值优先于设置页：在设置页修改被覆盖的键，保存后仍会被环境变量盖回去；这是预期行为。
- 覆盖值是「生效值」，会进入设置导出与备份；恢复备份不会删除环境变量，所以覆盖仍然生效。
- 环境变量变更需要重启/重建容器；应用配置写入会使进程内缓存立即失效（默认缓存 5 秒）。

## 应用级配置 | Application Settings

<!-- CONFIG_TABLE_START -->
<!-- 由 scripts/gen-config-docs.mjs 从 src/config/definition.ts 生成，请勿手改；改配置后运行：pnpm docs:config -->

当前配置版本：`1`

### 站点 | Site（`site.*`）

站点基础信息，用于管理台、申请页与抓取 UA。

| 键 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `site.name` | 文本 | `我的博客` | 站点名称。管理台与申请页标题。 |
| `site.url` | 文本 | 空 | 主站地址。反链检测的目标，如 https://example.com |
| `site.logo` | 文本 | 空 | 站点 Logo。申请页显示（可选）。 |
| `site.description` | 长文本 | 空 | 站点简介。申请页说明的默认值（apply.intro 留空时使用）。 |
| `site.timezone` | 文本 | `Asia/Shanghai` | 时区。管理台日期时间显示时区，如 Asia/Shanghai。 |
| `site.locale` | 文本 | `zh-CN` | 日期语言。日期时间格式化语言，如 zh-CN / en-US；界面文案当前仅中文。 |

### 朋友圈抓取 | Crawl（`crawl.*`）

分批轮转，降低单次抓取压力。

| 键 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `crawl.enabled` | 布尔 | `true` | 抓取总开关。关闭后停止抓取，已有数据照常输出。 |
| `crawl.batchSize` | 数字（1–50） | `3` | 每轮站点数。与 Cron 频率共同决定刷新周期。 |
| `crawl.maxPerFriend` | 数字（1–50） | `5` | 每站篇数上限。每个源只保留最新 N 篇。 |
| `crawl.outputMaxArticles` | 数字（1–1000） | `150` | 输出总量上限。朋友圈按发布时间保留最新 N 篇。 |
| `crawl.futureToleranceDays` | 数字（0–30） | `2` | 未来时间容差（天）。文章发布时间晚于当前时间超过该天数将被丢弃。 |
| `crawl.retentionDays` | 数字（7–3650） | `90` | 库内保留天数。超期文章每日自动清理。 |
| `crawl.timeoutSeconds` | 数字（1–60） | `15` | 单源超时（秒）。抓取单个源的超时时间。 |
| `crawl.userAgent` | 文本 | `Youlin/1.0 (+{site.url})` | 抓取 UA。{site.url} 会替换为主站地址。 |
| `crawl.concurrency` | 数字（1–20） | `5` | 手动全量并发。手动触发抓取一轮时的并发数。 |

### 体检 | Link Check（`linkCheck.*`）

友链可达性 / RSS 可用性 / 失联退避。

| 键 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `linkCheck.enabled` | 布尔 | `true` | 体检总开关。关闭后停止检测，已有结果照常显示。 |
| `linkCheck.maxAgeHours` | 数字（1–168） | `24` | 复查间隔（小时）。同一友链两次检测的最小间隔。 |
| `linkCheck.timeoutSeconds` | 数字（1–60） | `15` | 单次超时（秒）。体检单个源的超时时间。 |
| `linkCheck.concurrency` | 数字（1–50） | `10` | 全量检测并发。手动全量体检时的并发数。 |
| `linkCheck.statusApiUrl` | 文本 | 空 | 状态 API 兜底。第三方状态检测地址，{url} 占位符，留空关闭。 |
| `linkCheck.backoffLadder` | JSON | `[[10,120],[30,240],[60,360]]` | 失联退避阶梯。[失联天数, 复查间隔小时]，升序排列。 |

### 反链检测 | Backlink（`backlink.*`）

检测对方站点是否含有指向你站点的链接。

| 键 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `backlink.enabled` | 布尔 | `true` | 反链检测。体检与申请流程共用的开关。 |
| `backlink.authorUrl` | 文本 | 空 | 自家域名。默认取主站地址；可填 example.com 或完整 URL。 |

### 代理 | Proxy（`proxy.*`）

直连失败时的代理前缀（可选）。

| 键 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `proxy.url` | 文本 | 空 | 代理地址。实际请求为 该地址 + 目标 URL。 |
| `proxy.mode` | 枚举（off / fallback / always） | `fallback` | 代理模式。off 关闭 / fallback 直连失败再走代理 / always 始终走代理。 |

### 友链申请 | Apply（`apply.*`）

公开申请页的行为。

| 键 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `apply.enabled` | 布尔 | `true` | 申请通道。关闭后申请页显示停用。 |
| `apply.rateLimitPerDay` | 数字（1–100） | `3` | 每 IP 每天上限。按天限流，超出返回 429。 |
| `apply.turnstile` | 布尔 | `false` | 人机验证。开启后需配置 Site Key 与 TURNSTILE_SECRET。 |
| `apply.turnstileSiteKey` | 文本 | 空 | Turnstile Site Key。公开值，密钥放 TURNSTILE_SECRET。 |
| `apply.backlinkPolicy` | 枚举（mark / reject / off） | `mark` | 反链策略。mark 仅标记 / reject 未检测到反链即拒绝 / off 不检测。 |
| `apply.autoApprove` | 布尔 | `false` | 自动通过。提交即入库（不推荐，垃圾提交无人工拦截）。 |
| `apply.requiredFields` | 字符串列表 | `["siteName","link"]` | 必填字段。申请表单的必填字段（link 始终必填）。 |
| `apply.intro` | 长文本 | 空 | 申请页说明。留空依次回退到站点简介/内置文案。 |
| `apply.successMessage` | 长文本 | 空 | 提交成功提示。留空使用内置文案。 |

### 接口 | API（`api.*`）

对外接口的缓存与输出行为。

| 键 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `api.cacheSeconds` | 数字（0–86400） | `300` | HTTP 缓存（秒）。友链数据与朋友圈响应的 Cache-Control max-age。 |
| `api.corsOrigin` | 文本 | `*` | CORS 来源。允许的 Origin，* 或具体来源。 |
| `api.includeHidden` | 布尔 | `false` | 输出隐藏记录。开启后隐藏的友链也会出现在友链数据接口。 |
| `api.maxLimit` | 数字（1–5000） | `500` | limit 上限。?limit= 允许的最大值。 |

### 重建集成 | Rebuild（`rebuild.*`）

可选：数据变化后触发接入方重建。

| 键 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `rebuild.enabled` | 布尔 | `false` | 启用重建。运行时接入无需开启。 |
| `rebuild.provider` | 枚举（webhook / github_dispatch） | `webhook` | 触发方式。webhook 通用 POST；github_dispatch 仓库事件。 |
| `rebuild.webhookUrl` | 文本 | 空 | Webhook 地址。provider=webhook 时的目标 URL。 |
| `rebuild.githubRepo` | 文本 | 空 | GitHub 仓库。owner/name，仅 github_dispatch 需要。 |
| `rebuild.eventType` | 文本 | `friends-updated` | 事件类型。repository_dispatch 的事件名。 |
| `rebuild.auto` | 布尔 | `false` | 自动触发。数据变更后自动触发。 |
| `rebuild.debounceSeconds` | 数字（0–3600） | `60` | 防抖（秒）。两次触发之间的最小间隔。 |

### 界面 | UI（`ui.*`）

管理台与申请页的外观。

| 键 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `ui.theme` | 枚举（system / light / dark） | `system` | 主题。跟随系统 / 浅色 / 深色。 |
| `ui.accentColor` | 文本 | 空 | 强调色。管理台与申请页主色，留空用默认；支持 #rrggbb。 |
| `ui.pageSize` | 数字（5–200） | `20` | 分页大小。列表页每页条数。 |

### 备份 | Backup（`backup.*`）

完整备份与恢复；WebDAV 密码放 WEBDAV_PASSWORD。

| 键 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `backup.enabled` | 布尔 | `false` | 自动备份。按周期自动备份到 WebDAV。 |
| `backup.schedule` | 枚举（hourly / daily / weekly） | `daily` | 备份周期。自动备份的最小间隔。 |
| `backup.includeArticles` | 布尔 | `false` | 包含文章。文章可重新抓取，默认不备以减小体积。 |
| `backup.retain` | 数字（1–100） | `7` | 保留份数。最多保留几份，超出删最旧的。 |
| `backup.webdavUrl` | 文本 | 空 | WebDAV 地址。如 https://dav.example.com/remote.php/dav/files/你/ |
| `backup.webdavUsername` | 文本 | 空 | WebDAV 用户名。密码放 WEBDAV_PASSWORD。 |
| `backup.webdavPath` | 文本 | `youlin` | WebDAV 目录。相对于地址的子目录，留空即用地址本身。 |

### 安全 | Security（`security.*`）

会话与登录保护。

| 键 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `security.sessionDays` | 数字（1–365） | `30` | 会话有效期（天）。登录 Cookie 的有效期。 |
| `security.loginRateLimit` | 数字（1–100） | `5` | 登录限流（次/小时）。单 IP 一小时滑动窗口，记录在 SQLite，重启后仍生效。 |

### 通知（v1.1 预留） | Notify（`notify.*`）

事件通知接口已定义，发送逻辑随 v1.1 提供。

| 键 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `notify.webhookUrl` | 文本 | 空 | Webhook 地址。预留字段，当前不会发送通知。 |
| `notify.events` | 字符串列表 | `["application","linkDown"]` | 通知事件。预留字段；当前不会发送。 |
<!-- CONFIG_TABLE_END -->` 之间的内容；CI 会运行同一命令并检查 diff。不要手改生成块，改定义文件。
