# 部署指南

友邻是单租户应用：**一个部署实例服务一个站点**。部署有两条路——Cloudflare Workers（方式一至三，个人规模在免费额度内，**0 元/月**）或自己的服务器（[Docker](#docker自建服务器)，只需要一个容器和一块数据卷）。

## 前置条件

- 一个 Cloudflare 账号（免费注册即可，无需绑卡）
- 一个 GitHub 或 GitLab 账号（只支持 github.com / gitlab.com）
- 自定义域名可选（`*.workers.dev` 免费子域开箱可用）

一键部署全程在浏览器里完成，本地不需要安装 Node、pnpm 或 wrangler。

## 方式一：一键部署（推荐）

1. **点按钮**：在 [README](../README.md) 顶部点击 **Deploy to Cloudflare**。如果还没登录 Cloudflare，会先引导登录或注册。
2. **连接 Git 账号**：在设置页的「Git 帐户」里点「新建 GitHub 连接」（或 GitLab），跳转授权后返回。Cloudflare 会把本仓库克隆一份到你的账号下（是副本，不是 fork）——这份副本就是你的仓库，之后的升级、部署自动触发都在它上面进行；按页面提示确认仓库名（默认 `youlin`，可改）。
3. **填写配置**：`ADMIN_TOKEN` 是管理台登录口令（部署表单里那个必填项），用下面的命令生成一个随机值；D1 数据库名保持默认即可。

   ```bash
   openssl rand -hex 32
   ```

4. **确认命令并开始部署**：构建命令 `pnpm run build` 与部署命令 `pnpm run deploy` 会按仓库内容自动填好，保持默认即可。部署命令里包含数据库迁移（`wrangler d1 migrations apply DB --remote`），建表会随首次部署自动完成，不需要手工执行。点击页面底部的创建按钮开始部署。

   随后 Cloudflare 会自动完成：创建仓库副本 → 创建并绑定 D1 数据库 → 写入密钥 → 构建 → 部署（首次约 1–2 分钟）。
5. **登录管理台**：打开 `https://<项目名>.<你的子域>.workers.dev/admin`，输入第 3 步的 `ADMIN_TOKEN`。全新 Cloudflare 账号首次使用 Workers 时，可能需要先确认一个 `*.workers.dev` 子域（就是地址里的那段）。
6. **基础配置**：到「设置」页填写 `site.url`（你的主站地址，反链检测的默认目标）；到「导入」页可批量迁入现有友链数据。

约 10 分钟可完成以上全部步骤。需要你自己决定的只有三件事：仓库名、管理口令、D1 名称（后两个保持默认也可以，口令建议随机）。

> 部署表单里的「使用 Cloudflare Access 保护」保持关闭：它会连同对外的三个公开接口一起挡掉。想给管理台单独加一层保护的话，在 Cloudflare Zero Trust 里建一个限定 `/admin` 与 `/api/admin` 路径的 Access 应用即可。

## 方式二：wrangler CLI

完全本地控制，适合开发者：

```bash
git clone https://github.com/lmb666666/youlin.git && cd youlin
pnpm install

npx wrangler login                 # 登录 Cloudflare 账号
npx wrangler d1 create youlin      # 建库，把返回的 database_id 填入 wrangler.jsonc
npx wrangler d1 migrations apply DB --remote   # 建表（DB 是 wrangler.jsonc 里的绑定名）
npx wrangler secret put ADMIN_TOKEN            # 设置管理口令
pnpm deploy                        # 构建 + 迁移 + 部署（等价于手动执行上面几步）
```

`pnpm deploy` 等价于 `pnpm build && wrangler d1 migrations apply DB --remote && wrangler deploy`，重复执行是安全的（迁移只会应用未执行过的部分）。

## 方式三：Workers Builds（连接你自己的仓库）

适合已经有一份仓库的场景——比如自己维护这个项目、fork 过、或者想让部署从你正在开发的仓库出发。Deploy 按钮只会把源仓库**再克隆一份**到你账号里，不会复用已有仓库（账号里已有同名仓库时直接失败），这时走本方式：

1. **先建 D1 并填入真实 ID**（导入流程不会替你建库）：

   ```bash
   npx wrangler login
   npx wrangler d1 create youlin     # 复制返回的 database_id
   ```

   把返回的 ID 填进 `wrangler.jsonc` 的 `database_id`（替换掉占位符）并提交推送。用面板建库也可以：在 D1 详情页复制 Database ID，同样填进配置文件。

2. Cloudflare 面板 → Workers & Pages → Create → **Import a repository**，选择你的仓库。Worker 名称需要与 `wrangler.jsonc` 里的 `name` 一致（这里是 `youlin`），否则构建会失败。
3. **Build command** 填 `pnpm run build`；**Deploy command** 填 `pnpm run deploy`（含数据库迁移）。
4. 添加密钥 `ADMIN_TOKEN`（及可选的 `TURNSTILE_SECRET` / `GITHUB_PAT`）。创建向导里没有填密钥的位置时，部署完成后到 Worker 的 **Settings → Variables and Secrets** 添加，再 Retry deployment 一次。
5. 首次构建会完成建表与部署；以后 push 即自动构建/部署，PR 会有预览地址。

## Docker（自建服务器）

适合希望大陆访问更快、或不想依赖 Cloudflare 的场景。镜像里是 Node 运行时 + SQLite，与 Workers 版本跑同一份代码：接口、管理台、备份功能完全一致。

### 1. 启动

```bash
git clone https://github.com/lmb666666/youlin.git && cd youlin
cp .env.example .env      # 填 ADMIN_TOKEN（openssl rand -hex 32）
docker compose up -d      # 默认拉取 ghcr.io/lmb666666/youlin:latest
```

打开 `http://<服务器>:8787/admin` 登录。数据在命名卷 `youlin_youlin-data`（容器内 `/data/youlin.db`），首次启动自动建表，重启和升级都不丢数据。镜像同时提供 amd64 与 arm64，NAS、ARM 小主机也能跑。

想自己构建镜像：把 `compose.yaml` 里的 `image:` 换成 `build: .`，然后 `docker compose up -d --build`。

### 2. 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `ADMIN_TOKEN` | 无（必填） | 管理台口令，同时是会话签名密钥 |
| `PORT` | `8787` | 容器内监听端口 |
| `DB_PATH` | `/data/youlin.db` | SQLite 文件路径（含 WAL） |
| `CRON_ENABLED` | `true` | 是否在进程内跑抓取轮转与自动备份 |
| `CRON_INTERVAL_SECONDS` | `300` | 定时作业的检查间隔，最小 30 秒 |
| `TURNSTILE_SECRET` | 空 | 申请页人机验证；开启 `apply.turnstile` 时才需要 |
| `WEBDAV_PASSWORD` | 空 | WebDAV 备份密码（地址与用户名在设置页） |
| `GITHUB_PAT` | 空 | 触发接入方重建（`github_dispatch` 模式） |
| `YOULIN_CONFIG_OVERRIDES` | 空 | JSON 配置覆盖，优先级高于设置页 |

单实例部署：SQLite 是单写者，不要同时起多个副本挂同一个数据卷。

### 3. HTTPS 与反向代理

容器只提供 HTTP。推荐用 Caddy 在前面终止 TLS 并做 brotli 压缩：

```caddyfile
links.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

同时把 compose 的端口改成只绑本机：`ports: ["127.0.0.1:8787:8787"]`，只让反代访问。

用 Nginx 的话，转发到 `127.0.0.1:8787` 并开启 gzip；注意 `proxy_set_header Host $host`，Cookie 的 `Secure` 属性按请求协议判断，反代终止 TLS 时不需要额外配置。

### 4. 升级

```bash
docker compose pull && docker compose up -d
```

启动时自动应用增量迁移（`d1_migrations` 表跟踪已执行的文件），配置新增项自带默认值。

### 5. 在 Cloudflare 与 Docker 之间迁移

两边都用同一份备份格式：

1. 旧实例「备份」页下载备份（建议勾选「包含文章与体检状态」）。
2. 新实例「备份」页选择文件恢复，核对分组、友链、申请与设置。

详见[备份与恢复](backup.md)。

### 6. 大陆部署注意事项

- **备案**：服务器在中国大陆时，对外提供 Web 服务需要 ICP 备案。放香港、新加坡等境外区域通常不需要备案，从大陆访问也比 `workers.dev` 明显更快。
- **Turnstile**：申请页的人机验证依赖 `challenges.cloudflare.com`，大陆访客可能加载不稳定。建议在设置里关闭 `apply.turnstile`，或接受部分提交失败。
- **镜像拉取**：ghcr.io 在大陆可能较慢，可以给 Docker 配镜像加速，或在服务器上 `git clone` 后用 `build: .` 本地构建。
- **抓取源**：朋友圈抓取从服务器所在网络发起，部分海外源可能超时；抓取器有超时与退避，不会卡住整轮。
- **别在前面再套 Cloudflare 代理**：代理回源会重新引入原来的慢路径。

## 自定义域名

部署完成后在面板绑定即可（无需改代码）：

Workers & Pages → 选择你的 Worker → **Settings → Domains & Routes → Add → Custom domain**，输入 `friends.example.com` 之类的域名并按提示完成 DNS 配置（域名需托管在 Cloudflare）。

绑定后建议在「设置」里同步 `site.url`，并在接入方站点的代码里使用新地址。

## 升级到新版本

```bash
git pull
pnpm install
pnpm deploy        # 自动执行增量迁移（迁移文件只增不改）
```

使用一键部署/Workers Builds 的话：在面板点 **Retry deployment**（或 push 一次），同样的自动迁移会执行。配置新增项自带默认值，升级不需要手工改配置。

## 成本

个人站规模下无需付费：

| 资源 | 免费额度 | 友邻的用量（个人站） |
| --- | --- | --- |
| Workers 请求 | 10 万次/天 | 接口访问 + 每 5 分钟一次 Cron |
| Workers CPU | 10ms/次调用 | 分批轮转设计：每次只处理 3 个源，绝大多数轮次是 304 短路 |
| D1 | 5GB 存储 | 友链 + 文章（默认保留 90 天） |
| Cron Triggers / Turnstile / Static Assets | 免费 | — |
| `*.workers.dev` 域名 | 免费 | 可用；自定义域仅需自有域名 |

唯一可选的付费项：Workers Paid（$5/月）可以把「每 5 分钟 3 站的轮转」放大为更激进的抓取节奏——默认设计不需要。

走 Docker 的话成本只取决于服务器本身：512MB 内存、一块 1GB 数据盘足够个人使用。

## 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| 登录时报「数据库尚未初始化」（`database_not_migrated`） | 部署命令没有执行迁移。到 Workers Builds 把 Deploy command 设为 `pnpm run deploy` 并重新部署，或本地跑 `wrangler d1 migrations apply DB --remote` |
| `wrangler` 报 D1 绑定错误 | `wrangler.jsonc` 里的 `database_id` 还是占位符，用 `wrangler d1 list` 查到的真实 ID 替换 |
| 登录返回 401 / 口令不对 | Secret 名必须是 `ADMIN_TOKEN`；修改后重新部署一次 |
| 申请页提交报 403 `turnstile_unconfigured` | 开启了 `apply.turnstile` 但没设置 `TURNSTILE_SECRET`；补设 Secret，或临时在设置里关闭人机验证 |
| Cron 没有产生抓取 | 检查 Worker 的 Triggers 面板是否有 `*/5 * * * *`；新部署后第一轮抓取最多等 5 分钟；也可在「朋友圈」页手动触发 |
| 朋友圈一直为空 | 友链需要填写 `feed` 地址才会参与朋友圈；在友链编辑里点「自动探测」补全 |
| 接口响应是旧数据 | 接口默认缓存 5 分钟（`api.cacheSeconds` 可调）；这是设计行为 |
| 想撤销隐藏某条友链 | 管理台友链页点该行的「显示」按钮；`hidden` 记录不出现在友链数据接口 |
| 想接可用性监控 | 用 `GET /healthz`：查一次 D1，返回 `{"ok":true,"db":true}`，正常 200、数据库不可用 503，响应禁用缓存，适合 UptimeRobot 一类探针 |
| Docker 容器起来了但浏览器打不开 | 先看 `docker compose ps` 与 `docker compose logs`；确认端口映射与外网防火墙。只绑了 `127.0.0.1` 时需要通过反代访问 |
| Docker 报数据库无法写入（SQLITE_CANTOPEN） | 用了 bind mount 且目录属主不是 uid 1000。执行 `sudo chown -R 1000:1000 ./data`，或改用默认的命名卷 |
| WebDAV 备份报认证失败 | 密码只从 `WEBDAV_PASSWORD` 读取；确认 Secret 已设置且用户名与地址正确 |
