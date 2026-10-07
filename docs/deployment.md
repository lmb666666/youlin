# 部署指南

友邻是单租户应用：**一个部署实例服务一个站点**。个人博客规模下，全部运行在 Cloudflare 免费额度内（**0 元/月**）。

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
