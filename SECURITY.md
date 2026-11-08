# 安全说明 | Security

友邻是单管理员、单租户的自托管应用。它的安全边界主要依赖部署者：管理台口令、HTTPS、反向代理配置、数据卷与备份权限。

## 支持范围

- 当前支持 `v0.4.x`；更早版本请先升级。
- 只支持单实例 SQLite 部署；多副本、共享数据库、自行修改的鉴权或代理配置不在支持范围内。
- 管理 API（`/api/admin/*`）是内部接口，不承诺对外兼容。

## 报告漏洞

请优先通过 GitHub 仓库的 **Security → Report a vulnerability** 私下报告，附：

- 影响版本与部署方式；
- 复现步骤或最小 PoC；
- 影响范围（读数据、写数据、绕过登录、SSRF、RCE 等）；
- 你希望如何处理公开时间线。

如果 Security Advisories 不可用，可以开一个**不含敏感细节**的 Issue，说明「需要私下联系」，维护者会再约渠道。不要在公开 Issue 里贴 Token、数据库、备份或可被直接利用的 PoC。

这是一个个人维护的开源项目，不提供漏洞赏金或固定响应 SLA；会尽力确认与修复。

## 部署安全清单

### 口令与会话

- `ADMIN_TOKEN` 同时是登录口令和会话 HMAC 签名密钥；使用至少 32 字节随机值，例如 `openssl rand -hex 32`。
- 不要使用 `.env.example` 里的默认值，不要把 `.env` 提交到仓库。
- 轮换 `ADMIN_TOKEN` 会让所有已签发会话立即失效；修改后需要重建容器。
- 登录有一小时滑动窗口限流（`security.loginRateLimit`，默认 5 次/小时/IP）；共享 NAT 可能互相影响。

### HTTPS 与反向代理

- 管理台必须通过 HTTPS 暴露；直连明文 HTTP 只适合本机调试。
- 反代必须正确设置并覆盖 `X-Forwarded-Proto`；否则会话 Cookie 的 `Secure` 判断会出错。
- `TRUST_PROXY` 只应在**一个可信反向代理**后开启。`private` 会信任任何私网对端，直接暴露到局域网时允许伪造 `X-Forwarded-For`。
- 不要在应用前面再套不透明的 CDN/代理而不调整信任模型；否则登录/申请限流可能按 CDN IP 计数，或真实 IP 丢失。
- 限制 `/admin` 的访问范围（VPN、IP 白名单、Basic Auth 外层保护等）可以进一步降低暴露面。

### 密钥与出站请求

- `TURNSTILE_SECRET`、`GITHUB_PAT`、`WEBDAV_PASSWORD` 只放在环境变量里；不要写进设置、文档或备份。
- 抓取/体检/申请反链会访问用户提供的站点；服务端有内网/环回地址防护、DNS 绑定、重定向逐跳校验与响应体上限。不要为了“能抓内网”而移除这些限制。
- 代理（`proxy.*`）只用于抓取/体检/申请反链，不用于 Turnstile、WebDAV 或 GitHub 重建。
- WebDAV 建议使用 HTTPS；HTTP WebDAV 会让 Basic 凭据以明文传输。自签证书默认不信任，请使用正规证书或 `NODE_EXTRA_CA_CERTS`。

### 容器与数据

- Compose 默认启用非 root、只读根文件系统、`cap_drop: ALL`、`no-new-privileges`、`init` 与 `pids_limit`；自行 `docker run` 时保持同等限制。
- 数据卷只给必要权限；bind mount 的属主通常是 uid/gid 1000（容器内 `node`）。
- SQLite 数据文件、`.env`、备份文件都不要提交到 Git，也不要放在公开静态目录。
- 固定镜像版本或 digest，定期更新；关注 Release 与本文的变更。
- `docker compose down -v` 会删除数据卷，执行前确认已有备份。

### 备份与隐私

- 备份是**明文** gzip JSON，包含分组、友链、申请（联系方式、备注）、设置；可选包含文章与体检状态。
- 备份不包含 `ADMIN_TOKEN`、`TURNSTILE_SECRET`、`GITHUB_PAT`、`WEBDAV_PASSWORD`，但包含申请人的联系信息。
- 限制备份文件与 WebDAV 目录的访问权限；需要长期保留时考虑自行加密或放在受控存储。
- 公开接口会输出友链的作者、站点、头像、简介与体检摘要；不要把不希望公开的字段填进友链备注（`comment` 会公开）。

### 申请入口

- `apply.enabled=false` 可以随时关闭申请通道。
- 开启 `apply.turnstile` 时必须同时配置 Site Key 与 `TURNSTILE_SECRET`，否则申请页只显示提示、不渲染表单。
- 每 IP、每 UTC 日限流（默认 3 次）只统计成功提交；失败会归还名额。
- `apply.backlinkPolicy=reject` 在未检测到反链时拒绝；如果 `backlink.enabled=false` 或未配置 `site.url` / `backlink.authorUrl`，会拒绝所有申请——这是配置陷阱，不是漏洞。

### 日志与数据保留

- 日志默认是 JSON 到 stdout；不要把请求体、Token 或备份内容写进日志。
- 文章按 `crawl.retentionDays` 清理；申请记录会保留到手动清理；备份保留份数由 `backup.retain` 控制。
- 公开接口默认 CORS `*`；如果接入方固定，可用 `api.corsOrigin` 收紧为单个来源。

## 已知边界

- 单管理员模型：没有多用户、角色或审计日志。
- 管理台与公开接口共用同一个 Node 进程；没有 WAF、IP 封禁或验证码以外的反滥用能力。
- 备份没有内置加密；恢复是覆盖式操作，操作前必须留存当前数据。
- 项目不保证对恶意 RSS/HTML 的完全解析隔离；抓取有超时、响应体上限与内网防护，但解析仍在同一进程内进行。

## 相关文档

- [部署指南](docs/deployment.md)：环境变量、反向代理、安全加固与故障排查
- [备份与恢复](docs/backup.md)：备份内容、恢复语义与 WebDAV
- [接口文档](docs/api.md)：公开接口的限流、CORS 与错误码
