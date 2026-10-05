# 友邻 Youlin

[![CI](https://github.com/lmb666666/youlin/actions/workflows/ci.yml/badge.svg)](https://github.com/lmb666666/youlin/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

友邻管两件事：你博客的友链，和朋友们的最近文章。

以前加友链要改数据文件、提交、等构建；朋友圈得另外跑脚本；友链申请埋在评论区里。现在都在一个网页里做。博客那边不用装任何东西，页面里 fetch 一下接口就行。

它跑在 Cloudflare Workers 上，个人站用免费额度就够，MIT 开源。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/admin-links-dark.png">
  <img src="docs/images/admin-links.png" alt="友链管理">
</picture>

## 特色 | Features

### 友链

- 在网页里加、改、删、换分组、拖顺序，博客那边刷新就能看到
- 填个站点地址，RSS、favicon、头像、站名就自动填好了
- 不想展示的可以先隐藏，接口里就不会出现
- 从别处搬过来也简单：粘一份 JSON 批量导入；要搬家能导出 JSON / CSV / OPML

### 体检

- 定期看每个站通不通、慢不慢、RSS 还能不能解析、有没有放你的链接、上次发文是什么时候
- 反链检测认得 https、http、// 和子域名这些写法，不容易漏
- 挂了的站会拉长复查间隔：10 天以上 5 天查一次，30 天以上 10 天，60 天以上 15 天
- 结果会出现在接口一的 health 字段里，体检页也能导出 CSV

### 朋友圈

- 每 5 分钟抓 3 个站，轮着来；带条件请求，内容没变就直接跳过
- 每个站留最新 5 篇，按时间排好、去重，合成一个列表
- 哪个站抓成功、哪个失败、下次什么时候抓，页面上都看得到，也能手动抓
- RSS 2.0、Atom 和 RDF 都能解析；没有 published 就用 updated，坏条目跳过

### 申请

- 自带一个申请页，链接往博客上一挂就行，文案可以自己改
- 带 Turnstile 人机验证，每个 IP 每天限制提交次数
- 提交时自动查对方有没有放你的链接，结果留作证据；不放心可以设成没链接就不收
- 待审的申请排成一个队列，点通过就入库，接口里马上就有

### 设置

- 配置全都有默认值，不动也能跑；设置页会自动生成表单
- 配置能导出、导入，也能用 `YOULIN_CONFIG_OVERRIDES` 环境变量覆盖

## 接口 | API

| 接口 | 端点 | 用途 |
| --- | --- | --- |
| 友链数据 | `GET /api/links` | 友链分组数据，每条带体检摘要；可选 `?group=` |
| 朋友圈 | `GET /api/circle` | 文章列表和统计；可选 `?limit=` |
| 申请 | `GET /apply`、`POST /apply` | 申请页可以直接外链；也可以自建表单提交 |

接口返回 JSON：时间是 ISO 8601 UTC，字段 camelCase，CORS 全开。

```js
const { groups } = await (await fetch('https://你的实例.workers.dev/api/links')).json()
// groups[].links[] 里有 author / link / avatar / feed / health，直接拿渲染
```

字段、错误码和请求示例见[接口文档](docs/api.md)。

## 预览 | Preview

<details>
<summary>点击展开截图</summary>

### 朋友圈

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/admin-circle-dark.png">
  <img src="docs/images/admin-circle.png" alt="朋友圈">
</picture>

### 申请页（访客侧）

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/apply-dark.png">
  <img src="docs/images/apply.png" alt="申请页">
</picture>

### 体检

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/admin-health-dark.png">
  <img src="docs/images/admin-health.png" alt="体检">
</picture>

### 设置

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/admin-settings-dark.png">
  <img src="docs/images/admin-settings.png" alt="设置">
</picture>

</details>

## 快速上手 | Quick Start

### 部署

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/lmb666666/youlin)

1. 点上方按钮，按提示填管理口令（用 `openssl rand -hex 32` 生成一个）
2. 部署后在 Workers Builds 里把 Deploy command 改成 `npm run deploy`，数据库迁移会跟着部署执行
3. 打开 `https://<你的实例>.workers.dev/admin` 登录，在设置里填上主站地址

第 2 步容易漏；漏了登录时会提示「数据库尚未初始化」，改完重新部署一次就好。
命令行部署、自定义域名和版本升级见[部署指南](docs/deployment.md)。

### 本地开发

```bash
pnpm install
cp .dev.vars.example .dev.vars   # 本地口令，随便填
pnpm seed                        # 可选：塞入示例数据
pnpm dev                         # http://127.0.0.1:8787/admin
```

不需要 Cloudflare 账号，D1 用本地模拟。

## 文档 | Documentation

- [部署指南](docs/deployment.md)：三种部署方式、自定义域名、升级、常见问题
- [接口文档](docs/api.md)：三个接口的字段、参数和错误码
- [配置参考](docs/configuration.md)：全部配置项和默认值
- [贡献指南](CONTRIBUTING.md)：开发环境、测试要求、提交约定

## 特别感谢 | Special Thanks

抓取和体检的做法参考了 [Friend-Circle-Lite](https://github.com/willow-god/Friend-Circle-Lite) 的经验。界面用的是 [shadcn/ui](https://ui.shadcn.com)，后端用的是 [Hono](https://hono.dev)。

## 许可 | License

[MIT](LICENSE)
