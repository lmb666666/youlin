# 贡献指南

感谢你考虑为友邻做出贡献！本文说明开发环境、常用命令与提交约定。

## 开发环境

- Node.js ≥ 24（Docker 镜像同版本）
- pnpm（版本由 `packageManager` 字段锁定，`corepack enable` 即可）
- 本地开发不需要 Docker，数据库是本地 SQLite 文件

```bash
git clone https://github.com/lmb666666/youlin.git
cd youlin
pnpm install
cp .env.example .env      # 本地开发口令，ADMIN_TOKEN 可随便填
pnpm seed                 # 可选：应用迁移并写入示例数据
pnpm dev                  # http://127.0.0.1:8787 → /admin 进入管理台
```

管理台前端（React SPA）改动想热更新时，另开终端跑 `pnpm dev:web`（Vite 会代理 `/api` 到 `127.0.0.1:8787`）。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 启动 Node 服务 + 本地 SQLite（含管理台静态资源） |
| `pnpm dev:web` | 管理台前端 Vite 开发服务器（热更） |
| `pnpm build` | 构建管理台（产物在 `web/dist`） |
| `pnpm build:server` | 构建 Node 服务端单文件（`server/dist/main.mjs`） |
| `pnpm start` | 运行已构建的服务端单文件 |
| `pnpm test` | 运行全部测试（Node + 内存 SQLite） |
| `pnpm lint` | ESLint 检查 |
| `pnpm typecheck` | 服务端与管理台两端类型检查 |
| `pnpm docs:config` | 重新生成 `docs/configuration.md` 的配置表格 |
| `pnpm seed` | 应用迁移并写入示例数据（幂等） |

## 测试要求

- 所有改动必须保证 `pnpm lint && pnpm typecheck && pnpm test` 全绿（CI 会跑同样的检查）。
- 涉及以下区域的改动请补充测试：
  - **接口契约**（`schemas/` 下的 JSON Schema 必须与实现、文档示例同步）；
  - **抓取/解析**（新增对 RSS/Atom 变体的处理时，附坏样例）；
  - **配置项**（新增/变更配置必须同步 `src/config/definition.ts` 并运行 `pnpm docs:config`）。
- 测试使用 Node + better-sqlite3 内存库，不依赖 workerd 或任何外部服务。

## 代码风格

- 标识符与注释：英文标识符；注释少而精，只在必要处解释「为什么」。
- 界面文案：中文（i18n 为后续计划，新增文案请集中书写便于将来抽取）。
- 时间：入库与对外输出一律 ISO 8601 UTC；字段 camelCase。
- 接口契约只做增量演进：新增可选字段可以，破坏性变更必须开新路径。

## 提交与 PR

1. Fork 仓库并从 `main` 切出分支（如 `feat/xxx`、`fix/xxx`）。
2. 保持提交聚焦：一个提交做一件事，提交信息说明「做了什么、为什么」。
3. PR 描述里请附：改动目的、验证方式（命令输出/截图）、是否涉及契约或配置变更。
4. 涉及接口契约、数据模型或配置项的较大变更，请先在 Issue 里讨论。

## 项目结构

```
src/            Node 服务（路由 / 业务 / 抓取 / 体检 / 配置 / 鉴权）
  routes/       公开接口与管理 API（HTTP 适配：参数解析、响应与文件下载）
  services/     业务用例（zod 校验、错误码、跨 repository 流程）
  repositories/ Drizzle 查询与事务（唯一写库入口）
  crawler/      RSS 解析、feed 发现、轮转抓取、体检
  backup/       导出、恢复、WebDAV
  server/       HTTP、SQLite、静态资源、调度
web/            管理台 SPA（React + Vite + Tailwind + shadcn/ui）
schemas/        对外接口的 JSON Schema 与示例（契约冻结在此）
migrations/     SQLite 迁移（只增不改）
tests/          Vitest（Node + better-sqlite3）
docs/           对外文档（部署 / 接口 / 配置 / 备份）
```

## 行为准则

保持友善、就事论事；对事不对人。欢迎各种背景的贡献者。
