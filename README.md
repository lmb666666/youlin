# 友邻 Youlin

[![CI](https://github.com/lmb666666/youlin/actions/workflows/ci.yml/badge.svg)](https://github.com/lmb666666/youlin/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

一个跑在 Cloudflare 上的友链与朋友圈管理台，给自己的博客用。

以前加友链要改数据文件、提交、等构建，朋友圈得另外跑脚本，友链申请埋在评论区里。现在这些都在一个网页里完成。博客那侧不需要装任何东西：友邻只提供 HTTP 接口，页面里 fetch 一下就能渲染。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/admin-links-dark.png">
  <img src="docs/images/admin-links.png" alt="友链管理">
</picture>

## 特色 | Features

### 友链

- 在网页里增删改、换分组、拖拽排序，博客端刷新即生效
- 填站点地址自动探测 RSS、favicon、头像、站点标题，补充到表单里
- 可隐藏：隐藏的友链不出现在接口输出中
- 导入任意来源的 JSON（字段别名自动识别），也可导出 JSON / CSV / OPML

### 体检

- 检查站点可达性、延迟、RSS 可用性、反链、对方最近一次发文时间
- 反链支持 https、http、协议相对、子域等多形态匹配
- 失联的站点按 10 / 30 / 60 天分档拉长复查间隔
- 结果进入接口一的 health 字段，体检页可导出 CSV

### 朋友圈

- 按「每 5 分钟 3 个站」分批轮转抓取，带 ETag / Last-Modified 条件请求
- 每个站保留最新 5 篇，按发布时间倒序去重聚合
- 抓取状态页显示每站成功、失败与下次检查时间，可手动抓单站或全部
- 解析 RSS 2.0 / Atom / RDF；published 缺失时回退 updated，坏条目跳过

### 申请

- 内置申请页，可直接外链给访客，文案可自定义
- Turnstile 人机验证；每 IP 每天提交次数限制
- 提交时自动做反链检测并留下证据，可配置为「未检测到反链即拒绝」
- 待审队列里通过后自动入库（可选分组、可改字段），立即出现在接口输出中

### 设置

- 50 多项配置都有默认值，设置页按 schema 自动生成
- 支持 JSON 导入导出，也支持 `YOULIN_CONFIG_OVERRIDES` 环境变量覆盖

## 接口 | API

| 接口 | 端点 | 用途 |
| --- | --- | --- |
| 友链数据 | `GET /api/links` | 友链分组数据，每条带体检摘要；可选 `?group=` |
| 朋友圈 | `GET /api/circle` | 文章聚合与统计；可选 `?limit=` |
| 申请 | `GET /apply`、`POST /apply` | 申请页可直接外链；也可自建表单提交 |

返回 JSON，时间是 ISO 8601 UTC，字段 camelCase，CORS 全开：

```js
const { groups } = await (await fetch('https://你的实例.workers.dev/api/links')).json()
// groups[].links[] 里有 author / link / avatar / feed / health，直接拿渲染
```

字段、错误码与请求示例见[接口文档](docs/api.md)。

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

第 2 步容易漏。漏掉的话登录时会提示「数据库尚未初始化」，改完重新部署一次即可。
命令行部署、自定义域名与版本升级见[部署指南](docs/deployment.md)。

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
- [接口文档](docs/api.md)：三个接口的字段、参数与错误码
- [配置参考](docs/configuration.md)：全部配置项与默认值
- [贡献指南](CONTRIBUTING.md)：开发环境、测试要求、提交约定

## 特别感谢 | Special Thanks

抓取与体检的实现参考了 [Friend-Circle-Lite](https://github.com/willow-god/Friend-Circle-Lite) 积累的经验；管理台基于 [shadcn/ui](https://ui.shadcn.com)，后端基于 [Hono](https://hono.dev)。

## 许可 | License

[MIT](LICENSE)
