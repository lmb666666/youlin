# 贡献指南 | Contributing

感谢你考虑为友邻贡献代码。友邻是单租户、自托管的友链 + 朋友圈管理台，生产部署只支持 Docker + SQLite；本地开发可以直接用 Node 24 运行同一个服务。

## 开发环境 | Getting Started

- Node.js ≥ 24（Docker 镜像同版本）
- pnpm（版本由 `package.json` 的 `packageManager` 字段锁定，`corepack enable` 即可）
- 可选：Docker 24+ 与 Docker Compose v2（验证镜像或容器行为时使用）

```bash
git clone https://github.com/lmb666666/youlin.git
cd youlin
pnpm install --frozen-lockfile
cp .env.example .env      # 本地开发口令，ADMIN_TOKEN 可随便填
pnpm build                # 生成 web/dist；不构建则 /admin 会提示前端产物缺失
pnpm seed                 # 可选：应用迁移并写入示例数据
pnpm dev                  # http://127.0.0.1:8787/admin
```

前端热更新时另开终端：

```bash
pnpm dev:web              # Vite 开发服务器，只代理 /api 到 127.0.0.1:8787
```

> 不要把本地 `.env` 或任何真实口令提交到仓库；生产环境不要复用本地口令。

## 常用命令 | Commands

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 启动 Node 服务 + 本地 SQLite（需先 `pnpm build`） |
| `pnpm dev:web` | 管理台 Vite 开发服务器（热更新） |
| `pnpm build` | 构建管理台（`web/dist`） |
| `pnpm build:server` | 构建服务端单文件（`server/dist/main.mjs`） |
| `pnpm start` | 运行已构建的服务端单文件（需先完成两个 build） |
| `pnpm test` | 跑 Node 服务端测试 + 前端测试 |
| `pnpm test:web` | 只跑前端测试 |
| `pnpm test:watch` | Node 测试 watch 模式 |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | 根、服务端、前端三套类型检查 |
| `pnpm docs:config` | 从配置定义重新生成 `docs/configuration.md` |
| `pnpm seed` | 应用迁移并写入示例数据（幂等） |
| `node scripts/check-version.mjs` | 校验四处版本号一致 |

## 项目结构 | Project Layout

```text
src/            Node 服务
  routes/       公开接口与管理 API（HTTP 适配）
  services/     业务用例（zod 校验、错误码、跨 repository 流程）
  repositories/ Drizzle 查询与事务（唯一写库入口）
  crawler/      RSS 解析、feed 发现、抓取、体检、出站 HTTP 防护
  backup/       备份信封、gzip、恢复、WebDAV
  server/       HTTP、SQLite、静态资源、迁移、调度
packages/contracts/  服务端与前端共享的 zod schema / 类型
web/          管理台 SPA
  src/components/ui/      shadcn 原语
  src/components/common/  页头、状态、表格、表单等共享组件
  src/components/shell/   侧栏、顶栏、命令面板、任务状态
  src/lib/                查询、变更、任务轮询、URL 状态、主题
schemas/       对外接口 JSON Schema 与示例（契约冻结在此）
migrations/    SQLite 迁移（只增不改）
tests/         Node 服务端测试（Vitest + better-sqlite3 内存库）
docs/          对外文档（架构 / 部署 / 接口 / 配置 / 备份 / 导入导出 / 设计系统）
scripts/       配置文档生成、版本校验、seed、mock 源
internal/      内部资料，永久不提交
```

## 测试 | Testing

- **Node 服务端**：`tests/**/*.test.ts`，Vitest + Node + better-sqlite3 内存库；不依赖外部服务。
- **前端**：`web/src/**/*.test.{ts,tsx}`，Vitest + happy-dom + Testing Library。
- 所有改动必须保证 `pnpm lint && pnpm typecheck && pnpm test` 全绿；提交前建议再跑 `pnpm build` 与 `pnpm build:server`。
- 涉及以下区域的改动请补测试：
  - **接口契约**（`schemas/` 必须与实现、示例同步）；
  - **抓取/解析**（新增 RSS/Atom 变体时附坏样例）；
  - **配置项**（新增/变更配置必须改 `src/config/definition.ts` 并跑 `pnpm docs:config`）；
  - **前端交互**（表单校验、脏数据、任务轮询、URL 状态等优先补组件/hook 测试）。

单跑一个文件：

```bash
pnpm vitest run tests/crawler.test.ts
pnpm --filter youlin-web exec vitest run src/lib/accent.test.ts
```

## CI | Continuous Integration

`.github/workflows/ci.yml` 会依次运行：

1. `pnpm install --frozen-lockfile`
2. `node scripts/check-version.mjs`
3. `pnpm lint`
4. `pnpm typecheck`
5. `pnpm test`（Node + web）
6. `pnpm build` + `pnpm build:server`
7. `pnpm audit --prod --audit-level=high`
8. `pnpm docs:config` + `git diff --exit-code docs/configuration.md`
9. Docker 构建与容器烟测（`/healthz`、登录）

`docker.yml` 在 main / `v*` 标签上构建并推送多架构镜像；`release.yml` 在 `v*` 标签上创建 GitHub Release。

## 配置变更 | Configuration Changes

`src/config/definition.ts` 是配置的单一事实源。新增或修改配置项时：

1. 改 `CONFIG_GROUPS` / `CONFIG_FIELDS`，补默认值、标签、说明、范围/选项。
2. 如需要，更新 `src/config/schema.ts` 的特殊校验。
3. 运行 `pnpm docs:config`，提交生成的 `docs/configuration.md`。
4. 如有接口/UI 行为变化，更新 `docs/api.md`、`docs/configuration.md` 或 `docs/design-system.md`。

只修改 `docs/configuration.md` 中标记块的内容会被 CI 覆盖。

## 数据库迁移 | Migrations

- `migrations/` 下的文件**只增不改**；已有部署按文件名顺序执行，记录在 `d1_migrations` 表（沿用历史表名，与 D1 无关）。
- 新迁移用递增前缀，如 `0007_add_xxx.sql`。
- 迁移应尽量幂等/可重入；破坏性结构变更需要单独评估。
- 启动时迁移在 HTTP 监听前执行，失败会阻止服务启动；没有 down migration。

## 接口契约 | API Contracts

- 对外接口只有 `/api/links`、`/api/circle`、`/apply` 与 `/healthz`；不要新增别名路径或近形命名。
- 字段 camelCase，时间 ISO 8601 UTC，只做增量演进；破坏性变更必须开新路径。
- 响应 Schema 在 `schemas/`，示例在 `schemas/examples/`；测试会校验真实响应与示例文件。
- 管理 API `/api/admin/*` 是内部接口，不承诺外部兼容。

## 代码风格 | Code Style

- 标识符英文；注释少而精，优先解释「为什么」；界面文案中文。
- 库内时间统一存 UTC `YYYY-MM-DD HH:MM:SS`（SQLite `datetime('now')`）；对外输出 ISO 8601 UTC。
- 前端复用 `components/common` 与 `lib/`，不要在页面里重复实现页头、空态、确认框、查询封装。
- 不引入新的组件库或状态管理库；新增依赖请说明理由与替代方案。
- 不要提交构建产物（`web/dist`、`server/dist`）、`.env`、SQLite 文件或临时脚本。

## 提交与 PR | Commits & PRs

- 使用英文 conventional commits：`feat(web): ...`、`fix(api): ...`、`docs: ...`、`chore(release): ...`。
- 一个提交只做一件事；提交信息写清「做了什么、为什么」。
- PR 描述附：改动目的、验证命令/输出、是否涉及接口契约/配置/迁移。
- 涉及接口契约、数据模型或配置项的较大变更，请先开 Issue 讨论。
- 默认不推送、不合并；由维护者确认后发布。

## 版本与发布 | Versioning & Release

发版前需要四处版本号一致：

- `package.json`
- `web/package.json`
- `packages/contracts/package.json`
- `src/version.ts`

`node scripts/check-version.mjs` 会校验；打 `v*` 标签会触发镜像语义化标签与 GitHub Release。备份格式、配置 schema、抓取 UA 的版本号与应用版本独立，不要混用。

## 安全 | Security

- 不要提交密钥、Token、数据库或备份文件。
- 漏洞请按 [SECURITY.md](SECURITY.md) 的方式私下报告，不要在公开 Issue 里贴敏感细节。
- 改动出站请求、鉴权、备份、文件上传或反向代理相关代码时，请在 PR 里说明安全影响。

## 行为准则 | Code of Conduct

保持友善、就事论事；对事不对人。欢迎不同背景的贡献者。
