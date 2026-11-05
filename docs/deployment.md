# 部署指南

友邻是单租户应用：**一个实例服务一个站点**。当前只支持 Docker + SQLite，一个容器、一块数据卷即可。

> Cloudflare Workers 支持已在 v0.3.0 归档，见 [归档说明](archive/workers.md)。

## 前置条件

- Docker 24+ 与 Docker Compose v2
- 一个域名（可选；直接用 `http://IP:8787` 也能跑）
- 反向代理可选，推荐 Caddy 或 Nginx 负责 HTTPS

## 1. 启动

```bash
git clone https://github.com/lmb666666/youlin.git && cd youlin
cp .env.example .env      # 填 ADMIN_TOKEN（openssl rand -hex 32）
docker compose up -d      # 默认拉取 ghcr.io/lmb666666/youlin:latest
```

打开 `http://127.0.0.1:8787/admin` 登录。数据在命名卷 `youlin_youlin-data`（容器内 `/data/youlin.db`），首次启动自动建表，重启和升级都不丢数据。

镜像同时提供 amd64 与 arm64，NAS、ARM 小主机也能跑。

想自己构建镜像：

```bash
docker compose up -d --build
# 或
docker build -t youlin:local .
```

Fork 项目后，自己的 Docker workflow 会把镜像推到 `ghcr.io/<你的用户名>/youlin`，把 compose 里的 `image` 改成对应地址即可。

## 2. 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `ADMIN_TOKEN` | 无（必填） | 管理台口令，同时是会话签名密钥 |
| `PORT` | `8787` | 容器内监听端口 |
| `HOST` | `0.0.0.0` | 容器内监听地址 |
| `DB_PATH` | `/data/youlin.db` | SQLite 文件路径（含 WAL） |
| `WEB_ROOT` | `web/dist` | 管理台静态资源目录 |
| `MIGRATIONS_DIR` | `migrations` | 迁移目录 |
| `CRON_ENABLED` | `true` | 是否在进程内跑抓取轮转与自动备份 |
| `CRON_INTERVAL_SECONDS` | `300` | 定时作业检查间隔，最小 30 秒 |
| `TURNSTILE_SECRET` | 空 | 申请页人机验证；开启 `apply.turnstile` 时才需要 |
| `WEBDAV_PASSWORD` | 空 | WebDAV 备份密码（地址与用户名在设置页） |
| `GITHUB_PAT` | 空 | 触发接入方重建（`github_dispatch` 模式） |
| `YOULIN_CONFIG_OVERRIDES` | 空 | JSON 配置覆盖，优先级高于设置页 |

**单实例部署**：SQLite 是单写者，不要同时起多个副本挂同一个数据卷。

## 3. HTTPS 与反向代理

容器只提供 HTTP。推荐 Caddy：

```caddyfile
links.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

compose 的端口默认只绑回环（`127.0.0.1:8787:8787`），只让反代访问。

Nginx 示例：

```nginx
server {
    listen 443 ssl;
    server_name links.example.com;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

- 会话 Cookie 根据 `X-Forwarded-Proto` 决定是否加 `Secure`。
- 限流按 `X-Forwarded-For` 最后一档识别真实来源 IP（由可信代理追加）；直连场景直接取 socket 地址。
- 不要在 Node 前面再套 Cloudflare 代理，代理回源会重新引入额外延迟。

## 4. 升级

```bash
docker compose pull && docker compose up -d
```

启动时自动应用增量迁移（`d1_migrations` 表跟踪已执行文件），配置新增项自带默认值。升级前建议在备份页下载一份完整备份。

## 5. 从 Workers 迁移

v0.3.0 是最后一个 Workers 版本：

1. 在旧实例「备份」页下载包含文章与体检状态的备份。
2. 按本文启动 Docker 实例并登录。
3. 在「备份」页选择文件恢复。
4. 核对分组、友链、申请与设置。

备份是跨运行时的 JSON 信封，不依赖 D1 或 SQLite 文件格式。Workers 代码保留在 [`archive/workers`](https://github.com/lmb666666/youlin/tree/archive/workers) 分支。

## 6. 迁移服务器

- 推荐：旧实例导出备份 → 新实例恢复。
- 也可以停容器后直接拷贝 `/data/youlin.db`（以及同目录 WAL 文件），但跨版本升级用应用内备份更稳妥。
- 数据库文件在命名卷 `youlin_youlin-data`，容器内路径 `/data/youlin.db`。

## 7. 大陆部署注意事项

- **备案**：服务器在中国大陆时，对外提供 Web 服务需要 ICP 备案。香港、新加坡等境外区域通常不需要备案。
- **Turnstile**：申请页的人机验证依赖 `challenges.cloudflare.com`，大陆访客可能加载不稳定。可在设置里关闭 `apply.turnstile`，或接受部分提交失败。
- **镜像拉取**：ghcr.io 在大陆可能较慢，可以配置镜像加速，或在服务器上 `git clone` 后本地构建。
- **抓取源**：朋友圈抓取从服务器所在网络发起，部分海外源可能超时；抓取器有超时与退避，不会卡住整轮。

## 8. 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| 登录报「数据库尚未初始化」 | 启动时迁移失败或 `/data` 不可写。看 `docker compose logs`；确认数据卷权限，或删除测试库后重启 |
| 登录 401 / 口令不对 | `.env` 里的 `ADMIN_TOKEN` 是否正确；修改后重启容器 |
| 申请页报 403 `turnstile_unconfigured` | 开启了 `apply.turnstile` 但没设置 `TURNSTILE_SECRET`；补设环境变量，或临时关闭人机验证 |
| 抓取没有产生数据 | 检查 `CRON_ENABLED`、`CRON_INTERVAL_SECONDS`；新启动后最多等一个周期；也可以在「朋友圈」页手动触发 |
| 朋友圈一直为空 | 友链需要填写 `feed` 地址才会参与朋友圈；在友链编辑里点「自动探测」补全 |
| 接口响应是旧数据 | 接口默认缓存 5 分钟（`api.cacheSeconds` 可调） |
| 容器起来了但打不开 | 先看 `docker compose ps` 与 `docker compose logs`；确认端口映射和外网防火墙。只绑 `127.0.0.1` 时需要通过反代访问 |
| 数据库无法写入（SQLITE_CANTOPEN） | bind mount 目录属主不是 uid 1000。`sudo chown -R 1000:1000 ./data`，或改用命名卷 |
| WebDAV 备份认证失败 | 密码只从 `WEBDAV_PASSWORD` 读取；确认环境变量、用户名与地址正确 |

## 9. 健康检查

`GET /healthz` 会查一次数据库：

- 正常：`200 {"ok":true,"db":true}`，`Cache-Control: no-store`
- 数据库不可用：`503`

镜像已内置 Docker healthcheck，也可直接接 UptimeRobot 一类的探针。
