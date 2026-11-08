# 部署指南 | Deployment

友邻是单租户应用：**一个实例服务一个站点**。生产部署只支持 Docker + SQLite：一个容器、一块可写数据卷。本地开发可以直接用 Node 运行同一个服务，见[贡献指南](../CONTRIBUTING.md)。

> Cloudflare Workers 支持已在 v0.3.0 归档，见[归档说明](archive/workers.md)。

## 支持范围 | Scope

- 单实例、单写者 SQLite；不支持多副本、读写分离、HA 或把数据库放在 NFS/SMB。
- 镜像提供 amd64 / arm64；支持 Docker 24+ 与 Docker Compose v2。
- 容器内以非 root 用户 `node` 运行；根文件系统只读，`/data` 卷可写。
- 应用版本 `0.4.0`，Node 24，SQLite（WAL）。

## 前置条件 | Requirements

- Docker 24+、Docker Compose v2。
- 一块本地磁盘作为 `/data`；建议至少 1 GB 可用（文章与备份会增长）。
- 入站：反向代理或直连端口；出站：访问朋友站点、Cloudflare Turnstile（如启用）、GitHub（如启用重建）、WebDAV（如启用备份）。
- 如果使用反向代理：域名、DNS 与 TLS 证书。
- 如果直连：把 Compose 端口改成 `8787:8787`（或 `80:8787`），并设置 `TRUST_PROXY=off`。

## 快速开始 | Quick Start

```bash
git clone https://github.com/lmb666666/youlin.git
cd youlin
cp .env.example .env
# 编辑 .env，至少填写 ADMIN_TOKEN：
#   openssl rand -hex 32
chmod 600 .env

docker compose config      # 校验 Compose 配置
docker compose up -d
docker compose ps
docker compose logs -f --tail=100
```

验证：

```bash
curl -fsS http://127.0.0.1:8787/healthz
# {"ok":true,"db":true}
```

浏览器打开 `http://127.0.0.1:8787/admin`，用 `ADMIN_TOKEN` 登录。Compose 默认只绑定 `127.0.0.1`，远程访问请先配置反向代理。

首次登录后建议：

1. 「设置 → 站点」填写站点名称、主站地址、时区。
2. 「设置 → 友链申请」检查申请开关、Turnstile 与反链策略。
3. 「友链」添加第一条友链，或从「导入」弹窗批量导入。
4. 「备份」下载一份初始备份；需要自动备份时再配置 WebDAV。

> 生产环境建议把 Compose 的 `ghcr.io/lmb666666/youlin:latest` 换成具体版本（如 `:0.4.0`）或 digest。`latest` 会随上游移动，不利于回滚。

## 环境变量 | Environment

应用业务配置的完整说明见[配置参考](configuration.md)；下表是部署级变量，应用业务配置在管理台设置页，不在环境变量里。

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `ADMIN_TOKEN` | 无（必填） | 管理台登录口令，同时是会话 HMAC 签名密钥；轮换后所有会话失效 |
| `PORT` | `8787` | 容器内监听端口 |
| `HOST` | `0.0.0.0` | 容器内监听地址；不要改成 `127.0.0.1`，否则端口发布不可达 |
| `DB_PATH` | 应用 `data/youlin.db`；镜像 `/data/youlin.db` | SQLite 文件路径（含 WAL/SHM） |
| `WEB_ROOT` | 应用 `web/dist`；镜像 `/app/web/dist` | 管理台静态资源目录 |
| `MIGRATIONS_DIR` | 应用 `migrations`；镜像 `/app/migrations` | 迁移目录 |
| `CRON_ENABLED` | `true` | 是否在进程内跑抓取/体检轮转与自动备份检查；只有精确的 `false` 会关闭 |
| `CRON_INTERVAL_SECONDS` | `300` | 调度检查间隔（秒）；小于 30 按 30 处理，非法值回退 300 |
| `LOG_LEVEL` | `info` | `silent` / `debug` / `info` / `warn` / `error` / `fatal` / `trace`；不区分大小写，非法值回退 `info` |
| `TRUST_PROXY` | 应用 `off`；Compose `private` | `off` / `loopback` / `private`；仅在可信反代后开启 |
| `TZ` | Compose 固定 `Asia/Shanghai` | 容器时区；Compose 的 `environment` 优先于 `.env`，需要改时直接改 Compose |
| `TURNSTILE_SECRET` | 空 | 申请页人机验证的服务端密钥；开启 `apply.turnstile` 时需要 |
| `WEBDAV_PASSWORD` | 空 | WebDAV 备份密码；地址与用户名在设置页 |
| `GITHUB_PAT` | 空 | 触发接入方重建（`github_dispatch` 模式）时需要 |
| `YOULIN_CONFIG_OVERRIDES` | 空 | 扁平点号键 JSON，优先级高于设置页；非法 JSON 整段忽略 |
| `NODE_EXTRA_CA_CERTS` | 空 | 可选；给私有 CA/自签 WebDAV 追加信任链 |
| `NODE_ENV` | `production`（镜像内） | 一般不需要改 |

说明：

- `.env` 由 Node 启动时读取；已存在的环境变量优先。Compose 的 `environment` 也会覆盖 `env_file` 中的同名变量。
- 修改 `ADMIN_TOKEN`、`WEBDAV_PASSWORD`、`TURNSTILE_SECRET` 等环境变量后，需要 `docker compose up -d` 重建容器，不是只 `docker restart`。
- 容器以非 root 运行，不能监听 80/443 等特权端口；对外端口由宿主机映射完成。

## 反向代理与 HTTPS | Reverse Proxy & TLS

Compose 默认端口映射是 `127.0.0.1:${PORT:-8787}:${PORT:-8787}`，只让本机反代访问；可以用 `PORT` 同时改宿主与容器端口，或直接改成 `80:8787`。

### Caddy（宿主机）

```caddyfile
links.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

### Nginx

```nginx
server {
    listen 443 ssl;
    server_name links.example.com;
    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    # 备份恢复上传上限 16 MB，给代理留余量
    client_max_body_size 20m;
    # 备份导出/恢复可能较慢，避免代理提前断开
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

建议同时配置 HTTP → HTTPS 跳转与 HSTS。

### 代理信任

| `TRUST_PROXY` | 行为 |
| --- | --- |
| `off` | 不信任 `X-Forwarded-For`；直连时使用 socket 地址 |
| `loopback` | 仅当对端是回环地址时采信 XFF |
| `private` | 当对端是私网地址时采信 XFF；Compose 默认值，适合同机/内网反代 |

- 只应部署在**一个**可信反代之后；`private` 会信任任何私网对端，直接暴露到局域网时可能被伪造 XFF。
- 会话 Cookie 是否加 `Secure` 取决于请求协议或 `X-Forwarded-Proto`；反代必须正确设置并覆盖该头。
- 前面再套 Cloudflare 等 CDN 时，源站看到的对端是 CDN 公网地址，`TRUST_PROXY=private` 不会采信 CDN 的 XFF，登录/申请限流会退化成按 CDN IP 计数；需要自行评估或不要在前面再套一层代理。

## 数据卷与持久化 | Volumes

- Compose 声明卷 `youlin-data`；实际 Docker 卷名是 `<Compose 项目名>_youlin-data`，默认目录名是 `youlin` 时才是 `youlin_youlin-data`。用 `docker compose config --volumes` 或 `docker volume ls` 确认。
- 容器内路径是 `/data/youlin.db`；WAL 模式会同时产生 `youlin.db-wal` 与 `youlin.db-shm`。
- 使用 bind mount 时目录属主需要是容器内的 `node`（通常 uid/gid 1000）：`sudo chown -R 1000:1000 ./data`。
- 升级、迁移或直接拷贝数据库前先停止容器，确保 WAL 已落盘。

## 升级与回滚 | Upgrade & Rollback

升级前先在「备份」页下载一份完整备份。

### 使用发布镜像

```bash
docker compose pull
docker compose up -d
docker compose ps
docker compose logs --tail=100
```

### 本地构建镜像

```bash
docker compose build --pull
docker compose up -d
```

- 启动时自动应用增量迁移（`d1_migrations` 是沿用自 Workers 的历史表名，当前与 D1 无关）。
- 迁移失败会阻止服务启动；没有 down migration。
- 回滚：把 Compose 的镜像标签换回旧版本（或旧 digest）后 `docker compose up -d`；如果新版本已经改过数据结构，优先用升级前的备份恢复。
- 建议固定版本标签或 digest，不要长期依赖 `latest`。

## 迁移 | Migration

### Docker → Docker

1. 旧实例「备份」页下载完整备份（建议包含文章与体检状态）。
2. 新实例启动并登录。
3. 「备份」页选择文件恢复。
4. 核对分组、友链、申请与设置；`site.url`、`site.name` 等实例配置会被备份中的值覆盖，按需改回。

### 从 Workers 迁移

v0.3.0 是最后一个 Workers 版本：

1. 在旧 Workers 实例备份（建议包含文章与体检状态）。
2. 按本文启动 Docker 实例并登录。
3. 在「备份」页恢复。
4. 核对数据；备份信封的 `version` 必须为 `1`。

### 直接拷贝数据库

只在确认版本兼容、且容器已停止时使用：

```bash
docker compose stop
# 确认卷名
docker volume inspect <project>_youlin-data
# 用临时容器复制整个数据目录（包含 db/wal/shm）
docker run --rm -v <project>_youlin-data:/from -v "$PWD":/to alpine \
  sh -c 'cp -a /from/. /to/youlin-data-backup/'
docker compose up -d
```

恢复时把文件放回卷内，保持 uid/gid 1000 属主。跨版本升级优先使用应用内备份，而不是直接拷贝 SQLite 文件。

## 健康检查与监控 | Health & Monitoring

`GET /healthz` 会执行一次 `SELECT 1`：

- 正常：`200 {"ok":true,"db":true}`，`Cache-Control: no-store`。
- 数据库不可用：`503 {"ok":false,"db":false}`。

镜像内置 Docker healthcheck（`interval=30s`、`timeout=5s`、`start-period=20s`、`retries=3`）。Docker 不会因为 unhealthy 自动重启容器，建议接入 UptimeRobot、Grafana 或自己的告警。

`/healthz` 只检查数据库，不检查调度器是否在跑、备份是否成功或磁盘是否将满；这些需要看管理台「备份」页、抓取状态与容器日志。日志默认是 JSON 到 stdout，可用 Compose 的日志轮转限制体积。

## 安全加固 | Security Hardening

- 使用足够长的随机 `ADMIN_TOKEN`（建议 32 字节以上）；不要把默认 `change-me-please` 带到生产。
- 通过 HTTPS 暴露管理台；不要把管理台直接暴露在公网明文 HTTP。
- 只让可信反代访问容器端口；按实际拓扑设置 `TRUST_PROXY`，不要盲目设为 `private`。
- Compose 默认启用只读根文件系统、`cap_drop: ALL`、`no-new-privileges`、`init`、`pids_limit`；自行 `docker run` 时建议保持同样参数，只把 `/data` 挂成可写卷，并给 `/tmp` 一个 tmpfs。
- WebDAV 使用 HTTPS；HTTP WebDAV 会让 Basic 凭据以明文传输。自签证书默认不被信任，可通过 `NODE_EXTRA_CA_CERTS` 提供 CA。
- 备份包含申请人的联系方式与备注，默认不加密；请限制备份文件与 WebDAV 目录的访问权限。
- 固定镜像版本或 digest，定期更新；关注 [Release](https://github.com/lmb666666/youlin/releases) 与 [SECURITY.md](../SECURITY.md)。

## 日常运维 | Maintenance

- 关注磁盘：文章保留期由 `crawl.retentionDays` 控制，备份保留份数由 `backup.retain` 控制。
- SQLite 使用 WAL；正常停容器即可，不需要手工 checkpoint。不要用 `kill -9` 代替 `docker compose stop`。
- 日志由 Compose 的 `json-file` 轮转（默认 10 MB × 3）；需要长期保留请接日志系统。
- 单写者：升级、直接拷贝数据库或做磁盘维护时安排停机窗口，不要多副本并发写。

## 故障排查 | Troubleshooting

| 现象 | 原因与处理 |
| --- | --- |
| 启动即退出 / 日志有迁移错误 | 查看 `docker compose logs`；确认 `/data` 可写、迁移文件完整；迁移失败不会启动 HTTP |
| 登录 401 / 口令不对 | 检查 `.env` 的 `ADMIN_TOKEN`；修改后 `docker compose up -d` 重建容器 |
| 修改环境变量没生效 | Compose 的 `environment` 优先于 `env_file`；环境变量变更需要重建容器 |
| 登录后立刻退出 / Cookie 不保存 | 反代没有正确设置 `X-Forwarded-Proto`，或直连 HTTP 下设置了 `Secure`；检查反代与 `TRUST_PROXY` |
| 申请页 403 `turnstile_unconfigured` | 开启了 `apply.turnstile` 但缺少 `TURNSTILE_SECRET`；补密钥或关闭开关 |
| 申请页 403 `backlink_missing` | `apply.backlinkPolicy=reject` 且未检测到反链；检查 `site.url` / `backlink.authorUrl`，或改为 `mark` |
| 登录/申请 429 | 登录按 IP 一小时限流；申请按 IP/UTC 日限流。检查反代是否把真实 IP 传进来 |
| 接口还是旧数据 | HTTP 缓存默认 5 分钟；调整 `api.cacheSeconds` 或刷新 CDN/反代缓存 |
| 备份恢复报 `prebackup_required` | 未完整配置 WebDAV，且 1 小时内没有下载过当前备份；先下载备份再恢复 |
| 备份恢复报 `prebackup_failed` | 恢复前自动存档到 WebDAV 失败；检查 WebDAV 连接/空间，或先下载备份并清空 WebDAV 地址 |
| WebDAV 401/403/404/409 | 检查用户名与 `WEBDAV_PASSWORD`、地址与目录权限；父目录不存在时只创建最后一级会返回 409 |
| WebDAV 超时 / 自签证书错误 | 单请求 30 秒超时；自签证书默认不信任，改用正规证书或 `NODE_EXTRA_CA_CERTS` |
| 反代 502 / TLS 错误 | 检查反代指向 `127.0.0.1:8787`、容器是否 healthy、证书与 SNI 配置 |
| 上传备份 413 | 反向代理的 `client_max_body_size` 太小；备份上限 16 MB，给代理留到 20 MB |
| 容器 unhealthy | 看 `docker inspect --format '{{json .State.Health}}' youlin` 与日志；Docker 不会自动重启 unhealthy 容器 |
| 磁盘满 / SQLITE_BUSY | 清理旧备份/文章、扩容；不要多副本共享 SQLite；检查是否有长事务 |
| `docker compose down -v` 后数据没了 | `-v` 会删除命名卷；这是不可逆操作，执行前必须确认已有备份 |

更多配置项与默认值见[配置参考](configuration.md)。

## 卸载与数据删除 | Uninstall

```bash
docker compose down          # 停止并删除容器，保留数据卷
docker compose down -v       # 连同命名卷一起删除，数据不可恢复
```

删除前先下载备份；如果只是换机器，优先用备份恢复，而不是直接删卷。

## 版本与兼容 | Version & Support

- 应用版本见 `package.json` / Release；配置文件里的 `CONFIG_VERSION` 是设置 schema 版本，备份信封有自己的 `version`，三者独立。
- 只支持从当前主分支可识别格式升级；没有 down migration。跨大版本升级前先备份。
- 安全报告与支持范围见 [SECURITY.md](../SECURITY.md)。
