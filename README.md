# 友邻 Youlin

[![CI](https://github.com/lmb666666/youlin/actions/workflows/ci.yml/badge.svg)](https://github.com/lmb666666/youlin/actions/workflows/ci.yml)

> Neighbors of your blog

给自己的博客配的友链管理台，顺手把朋友圈也管了。

加一个友链要改数据文件、提交、等构建；朋友圈得单独跑脚本或者部署一个爬虫服务；朋友的站挂了没人提醒；收到的申请埋在评论区里。这些事现在都收在一个页面里：加友链、体检、审核申请、看抓取状态。你的博客不需要装任何东西——它对外只有几个 HTTP 接口，前端 fetch 一下就渲染出来。

它跑在 Cloudflare Workers 上，不依赖博客系统，Hexo、Hugo、Nuxt、WordPress 都一样；一个实例服务一个站点，MIT 开源，个人站免费额度足够。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/lmb666666/youlin)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/admin-links-dark.png">
  <img src="docs/images/admin-links.png" alt="友链管理">
</picture>

## 有什么

- 加友链时填个站点地址就行，RSS、favicon、头像、站点标题会自己探测补全；分组、拖拽排序、隐藏都是行内操作
- 体检会定期跑：站点通不通、RSS 还能不能解析、对方有没有放你的链接、最近一次更新是什么时候。失联的站不会一直白跑——10 天以上 5 天查一次，30 天以上 10 天，60 天以上 15 天
- 朋友圈按「每 5 分钟抓 3 个站」的节奏轮流抓，每个站留最新 5 篇；抓取情况随时可看，也能手动触发
- 申请页可以直接外链给访客：带人机验证，自动检测对方有没有先加上你的链接，通过与否在待审队列里点
- 50 多项配置都有默认值，想改就在设置页改，也能导出、导入

<table>
<tr>
<td width="50%">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/admin-circle-dark.png">
  <img src="docs/images/admin-circle.png" alt="朋友圈">
</picture>

</td>
<td width="50%">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/apply-dark.png">
  <img src="docs/images/apply.png" alt="申请页">
</picture>

</td>
</tr>
</table>

<details>
<summary>体检页与设置页截图</summary>

<table>
<tr>
<td width="50%">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/admin-health-dark.png">
  <img src="docs/images/admin-health.png" alt="体检">
</picture>

</td>
<td width="50%">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/admin-settings-dark.png">
  <img src="docs/images/admin-settings.png" alt="设置">
</picture>

</td>
</tr>
</table>

</details>

## 三个接口

| 接口 | 端点 | 用途 |
| --- | --- | --- |
| 友链数据 | `GET /api/links` | 友链分组数据，每条带体检摘要；可选 `?group=` |
| 朋友圈 | `GET /api/circle` | 文章聚合与统计；可选 `?limit=` |
| 申请 | `GET /apply`、`POST /apply` | 申请页可直接外链给访客 |

返回统一是 JSON，ISO 8601 时间、camelCase 字段、CORS 全开：

```js
const { groups } = await (await fetch('https://你的实例.workers.dev/api/links')).json()
// groups[].links[] 里是 author / link / avatar / feed / health……直接渲染
```

字段明细、错误码、自建申请表单的示例都在[接口文档](docs/api.md)。

## 部署

点上面的 Deploy 按钮，按提示填一个管理口令（用 `openssl rand -hex 32` 生成一个），其余交给 Cloudflare：建数据库、绑定、部署到 `*.workers.dev`，都在免费额度内。

有一个容易漏的步骤：部署后在 Workers Builds 里把 Deploy command 改成 `npm run deploy`，让数据库迁移跟着部署走。漏掉的表现是登录时报「数据库尚未初始化」，改完重新部署一次就好。

命令行部署、自定义域名、版本升级见[部署指南](docs/deployment.md)。

## 本地开发

```bash
pnpm install
cp .dev.vars.example .dev.vars   # 本地口令，随便填
pnpm seed                        # 可选：塞点示例数据
pnpm dev                         # http://127.0.0.1:8787/admin
```

不需要 Cloudflare 账号，D1 用本地模拟。提交前跑一遍 `pnpm lint && pnpm typecheck && pnpm test`，和 CI 一致。

## 说清边界

只做「管理台 + 对外接口」这一件事：不做评论、不做多租户、不做全文搜索、不做邮件订阅。

抓取与体检的思路参考了 [Friend-Circle-Lite](https://github.com/willow-god/Friend-Circle-Lite)，它做得很好但只有数据没有后台；原版 hexo-circle-of-friends 又已停止维护。这里的做法是在同样的抓取经验上包一层管理台，并且按 Workers 免费额度重新设计了节奏：分批轮转 + 条件请求，绝大多数轮次 304 短路，不做一次性全量抓取。

## 文档

- [部署指南](docs/deployment.md)：三种部署方式、自定义域名、升级、常见问题
- [接口文档](docs/api.md)：三个接口的字段、参数与错误码
- [配置参考](docs/configuration.md)：全部配置项与默认值
- [贡献指南](CONTRIBUTING.md)

## 许可

[MIT](LICENSE)
