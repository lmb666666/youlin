# 友邻 Youlin

> Neighbors of your blog —— 一个跑在 Cloudflare 上的友链 + 朋友圈管理台

**管友链**（增删改、体检、自助申请）**+ 管朋友圈**（定时抓取、聚合展示），全部在一个网页里完成；对外只输出 HTTP 数据接口，**不改动你博客的任何代码**。一个实例服务一个站点，MIT 开源，Cloudflare 免费额度内 **0 元/月**。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/lmb666666/youlin)

## 它解决什么

独立博客维护友链的典型流程是：改数据文件 → 提交 → 等构建；朋友圈要单跑一个爬虫服务；朋友站点挂了无从察觉；友链申请埋在评论区。友邻把这些收敛成「网页里点几下」：

- **友链管理**：增删改查、分组、拖拽排序、隐藏；填一个站点地址就能**自动探测** RSS / favicon / 标题 / 头像
- **健康体检**：可达性、延迟、RSS 可用性、反链检测、对方最近发文；失联自动分档退避复查；结果可导出 CSV
- **朋友圈**：Cron 分批抓取朋友们的最新文章（条件请求省额度），聚合输出 + 抓取状态页
- **自助申请**：公开申请页 + Turnstile 人机验证 + 反链检测证据 + 待审队列，一键通过自动入库
- **三大对外接口**：友链数据 / 朋友圈 / 申请 —— 见下方「接口」
- **设置中心**：全部配置项都有默认值、可视化编辑、可导入导出

## 界面

管理台（浅色/深色跟随系统）：

| 友链 | 朋友圈 |
| --- | --- |
| ![友链](docs/images/admin-links.png) | ![朋友圈](docs/images/admin-circle.png) |

| 体检 | 设置 |
| --- | --- |
| ![体检](docs/images/admin-health.png) | ![设置](docs/images/admin-settings.png) |

访客侧的内置申请页（可直接外链，文案可配置）：

![申请页](docs/images/apply.png)

## 部署（推荐：一键部署）

1. 点上方 **Deploy to Cloudflare** 按钮 → 授权 GitHub（会在你的账号下创建一份仓库）
2. 按提示填写 `ADMIN_TOKEN`（管理台登录口令，建议 `openssl rand -hex 32` 生成）
3. 部署完成后，把该项目的 Workers Builds **部署命令设为 `npm run deploy`**（这一步让数据库迁移自动执行）
4. 打开 `https://<你的实例>.workers.dev/admin` 登录，到「设置」里填上你的主站地址

命令行部署、自定义域名、升级路径与常见问题见 **[部署指南](docs/deployment.md)**。

## 本地开发

```bash
pnpm install
cp .dev.vars.example .dev.vars   # 本地开发口令，随便填
pnpm seed                        # 可选：塞入示例数据
pnpm dev                         # http://127.0.0.1:8787/admin
```

本地开发不需要 Cloudflare 账号。管理台前端热更：`pnpm dev:web`。

## 接口

三个接口 = 三条路径，命名各自独立；时间一律 ISO 8601 UTC、字段 camelCase、CORS 全开、边缘缓存默认 5 分钟。契约冻结在仓库 [`schemas/`](schemas/)，只做增量演进。

| 接口 | 端点 | 用途 |
| --- | --- | --- |
| 一·友链数据 | `GET /api/links` | 友链分组数据，每条含体检摘要 `health`；可选 `?group=` |
| 二·朋友圈 | `GET /api/circle` | 文章聚合 + 统计；可选 `?limit=` |
| 三·友链申请 | `GET /apply`（申请页）· `POST /apply`（提交） | 访客自助申请 |

```js
// 渲染友链页的推荐方式：前端运行时拉取，改数据无需构建
const { groups } = await (await fetch('https://your-instance.workers.dev/api/links')).json()
for (const g of groups) {
  for (const link of g.links) {
    // link.author / link.link / link.avatar / link.health?  …直接渲染
  }
}
```

完整字段说明、错误码与更多示例见 **[接口文档](docs/api.md)**。

## 配置

所有业务配置都在管理台「设置」页可视化编辑，**每项都有默认值**，开箱即用；也支持 `YOULIN_CONFIG_OVERRIDES` 环境变量覆盖与 JSON 导入导出。完整清单见 **[配置参考](docs/configuration.md)**。

## 文档

| 文档 | 内容 |
| --- | --- |
| [部署指南](docs/deployment.md) | 一键部署 / CLI / Workers Builds、自定义域名、升级、成本、常见问题 |
| [接口文档](docs/api.md) | 三大接口的字段、参数、错误码与示例 |
| [配置参考](docs/configuration.md) | 三层配置机制与全部配置项（含默认值） |
| [贡献指南](CONTRIBUTING.md) | 开发环境、测试要求、提交约定 |

## 技术栈

Cloudflare Workers + Hono + D1 + Cron Triggers + Static Assets；管理台 React 19 + Vite + Tailwind CSS v4 + shadcn/ui。

## 许可

[MIT](LICENSE)
