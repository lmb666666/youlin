# 架构说明 | Architecture

友邻是单租户、单实例的自托管应用：一个 Node 24 进程同时提供管理台静态资源、管理 API、公开接口和定时作业；数据存在本地 SQLite 文件里。

## 运行时

```text
浏览器 / 接入方
      │
      ▼
Caddy / Nginx（可选）
      │
      ▼
Node 24 容器
  ├─ Hono 应用（src/app.ts）
  │    ├─ /api/links、/api/circle       公开数据
  │    ├─ /apply                       申请页 + 提交
  │    ├─ /api/admin/*                 管理 API（HMAC Cookie）
  │    └─ /healthz                     数据库探针
  ├─ 静态资源（src/server/assets.ts）
  │    └─ /admin/* → web/dist SPA fallback
  └─ 调度器（src/server/main.ts）
       ├─ 抓取 / 体检轮转
       ├─ 每日文章清理
       └─ WebDAV 自动备份检查
      │
      ▼
/data/youlin.db（SQLite + WAL）
```

- 生产部署只支持 Docker；本地开发可以直接 `pnpm dev` 跑同一个 Node 服务。
- 静态 handler 把 `/api/*`、`/apply`、`/healthz` 交给 Hono，其余 GET 走 `web/dist`，未知页面回落 `index.html`。
- 单实例：SQLite 是单写者；不要多副本挂同一个数据卷。调度器用数据库锁避免同一轮被多个进程重复执行，但这不是多副本方案。

## 代码分层

| 目录 | 职责 |
| --- | --- |
| `src/routes/` | HTTP 适配：路径、参数、响应、文件下载 |
| `src/services/` | 业务用例：zod 校验、错误码、跨 repository 流程 |
| `src/repositories/` | Drizzle 查询与事务，唯一写库入口 |
| `src/crawler/` | RSS 解析、feed 发现、抓取、体检、出站 HTTP 防护 |
| `src/backup/` | 备份信封、gzip、恢复、WebDAV |
| `src/server/` | HTTP、SQLite 适配、静态资源、迁移、环境变量、调度 |
| `packages/contracts/` | 服务端与前端共用的 zod schema / 类型 |
| `web/` | 管理台 SPA（React + Vite + Tailwind + shadcn/ui） |
| `migrations/` | SQLite 迁移，只增不改 |
| `schemas/` | 对外接口 JSON Schema 与示例 |

依赖方向：`routes → services → repositories`；`crawler` / `backup` 是可被 service 调用的领域模块。路由不直接写 SQL。

## 请求流程

### 公开接口

1. `/api/*` 先经过配置中间件：代码默认值 ← SQLite `settings` ← `YOULIN_CONFIG_OVERRIDES`。
2. 路由读取配置与数据库，返回 JSON；`/api/links` 与 `/api/circle` 设置 `Cache-Control`，`/apply` 页面为 `no-store`。
3. 所有响应带基础安全头（`nosniff`、`X-Frame-Options: DENY`、`frame-ancestors 'none'`）。

### 管理台

1. `/admin/*` 返回 SPA；前端通过 `/api/admin/*` 读写。
2. 登录：`POST /api/admin/login` 校验 `ADMIN_TOKEN`，签发 HMAC Cookie（`HttpOnly`、`SameSite=Lax`）。
3. `requireAdmin` 中间件验证 Cookie；管理响应统一 `Cache-Control: no-store`。
4. 前端用 TanStack Query 管理服务端状态，mutation 后按领域失效缓存。

## 数据模型

| 表 | 内容 |
| --- | --- |
| `groups` | 分组名称、说明、排序 |
| `friends` | 友链全部字段：作者、站点、链接、feed、头像、分组、排序、显示状态、是否入圈 |
| `articles` | 抓取到的文章，唯一键 `(friend_id, guid)` |
| `source_state` | 每源最近一次抓取/体检状态：可达、RSS、反链、延迟、退避、下次检查 |
| `applications` | 友链申请与审核记录、反链证据 |
| `settings` | 应用配置（JSON 值）与 `internal.*` 运行时簿记 |
| `apply_rate_limit` | 申请限流的按 IP / UTC 日计数 |
| `login_attempts` | 管理台登录限流的一小时滑动窗口 |

`settings` 里的 `internal.*`（轮转进度、清理水位、备份防抖、恢复凭证）不属于应用配置，导出/恢复时会跳过。

## 抓取与体检

- 调度器每 `CRON_INTERVAL_SECONDS`（默认 300 秒）检查一次；首次启动延迟 5 秒。
- 每轮取 `crawl.batchSize` 个最久未检查的源，避免一次全量抓取。
- 有 feed：带 ETag / Last-Modified 条件请求；304 只更新状态，200 解析并增量入库。
- RSS 失败：落到完整体检（首页可达性、feed 发现、反链），区分「站点失联」与「feed 不可用」。
- 无 feed：走体检并尝试发现 feed；仅在 `friends.feed` 为空时自动写回，不覆盖人工配置。
- 失联源按 `linkCheck.backoffLadder` 拉长复查间隔。
- 文章按 `crawl.retentionDays` 每日清理，按 `crawl.maxPerFriend` / `crawl.outputMaxArticles` 截断输出。

## 备份

备份是版本化 JSON 信封（`youlin.backup` v1），用自然键关联：分组名、友链链接。恢复时重新映射自增 id，因此可以跨实例使用；清空与写入在同一事务里，失败整体回滚。WebDAV 自动备份与恢复前的自动存档复用同一套信封。

## 配置与版本

- 应用配置三层：代码默认值 → SQLite `settings` → `YOULIN_CONFIG_OVERRIDES`。部署级环境变量（`ADMIN_TOKEN`、`PORT` 等）是另一套系统，不参与这三层合并。
- 配置在进程内缓存 5 秒；设置写入会使缓存失效，环境变量变更需要重启/重建容器。
- `CONFIG_VERSION` 是设置 schema 版本；`APP_VERSION` 是应用版本；备份信封有自己的 `version`。三者独立。

## 运维边界

- 一个实例服务一个站点；没有多租户、HA、读写分离或多副本 SQLite。
- SQLite 数据卷应放在本地文件系统；不要放 NFS/SMB。
- 出站抓取有内网/环回地址防护、重定向逐跳校验与响应体上限；代理只用于抓取/体检/申请反链，不用于 Turnstile、WebDAV 或重建触发。
- 管理 API 不承诺对外兼容；公开接口只做增量演进。
