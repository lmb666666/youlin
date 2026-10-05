# 部署指南

友邻是单租户应用：**一个部署实例服务一个站点**。个人博客规模下，全部运行在 Cloudflare 免费额度内（**0 元/月**）。

## 前置条件

- 一个 GitHub 账号（一键部署会用它存放你的一份仓库）
- 一个 Cloudflare 账号（免费注册即可，无需绑卡）
- 自定义域名可选（`*.workers.dev` 免费子域开箱可用）

## 方式一：一键部署（推荐）

1. **点按钮**：在 [README](../README.md) 顶部点击 **Deploy to Cloudflare**。
2. **授权并创建仓库**：按提示授权 GitHub，Cloudflare 会在你的账号下创建一份仓库副本（是副本，不是 fork）。
3. **填写密钥**：部署流程会引导填写 `ADMIN_TOKEN`（管理台登录口令）。生成本地随机口令：

   ```bash
   openssl rand -hex 32
   ```

4. **完成部署**：Cloudflare 会自动创建 D1 数据库并绑定到 Worker（`wrangler.jsonc` 里的占位 `database_id` 会被自动回填）。
5. **启用自动迁移（重要）**：进入 Cloudflare 面板 → **Workers & Pages** → 选择刚创建的 Worker → **Settings → Builds & deployments** → 把 **Deploy command** 改为：

   ```
   npm run deploy
   ```

   然后点一次 **Retry deployment**。此后每次推送代码，部署命令都会自动执行数据库迁移（`wrangler d1 migrations apply DB --remote`），你不需要手工建表。

   > 说明：Cloudflare 默认的部署命令是 `npx wrangler deploy`，它**不会**执行 D1 迁移。`npm run deploy` 是本仓库 `package.json` 里预置的脚本，先构建管理台、再迁移数据库、最后部署 Worker。
   > 忘记这一步的表现：访问管理台登录时报「数据库尚未初始化」（接口返回 `database_not_migrated`），按上面改为 `npm run deploy` 重试即可恢复。

6. **登录管理台**：打开 `https://<你的实例>.workers.dev/admin`，输入第 3 步的 `ADMIN_TOKEN`。
7. **基础配置**：到「设置」页填写 `site.url`（你的主站地址，反链检测的默认目标）；到「导入」页可批量迁入现有友链数据。

约 10 分钟可完成以上全部步骤。

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

如果你把仓库放在自己的 Git 账号下（而不是让按钮创建副本）：

1. Cloudflare 面板 → Workers & Pages → Create → **Import a repository**，选择仓库。
2. **Build command** 填 `pnpm build`（或留空，`npm run deploy` 内已包含构建）。
3. **Deploy command** 填 `npm run deploy`（含数据库迁移）。
4. 在 Worker 的 Settings → Variables & Secrets 里添加 `ADMIN_TOKEN`（及可选的 `TURNSTILE_SECRET` / `GITHUB_PAT`）。
5. 保存并部署；以后 push 即自动构建/部署，PR 会有预览地址。

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
| 登录时报「数据库尚未初始化」（`database_not_migrated`） | D1 迁移未执行。把 Deploy command 设为 `npm run deploy` 并重新部署，或本地跑 `wrangler d1 migrations apply DB --remote` |
| `wrangler` 报 D1 绑定错误 | `wrangler.jsonc` 里的 `database_id` 还是占位符，用 `wrangler d1 list` 查到的真实 ID 替换 |
| 登录返回 401 / 口令不对 | Secret 名必须是 `ADMIN_TOKEN`；修改后重新部署一次 |
| 申请页提交报 403 `turnstile_unconfigured` | 开启了 `apply.turnstile` 但没设置 `TURNSTILE_SECRET`；补设 Secret，或临时在设置里关闭人机验证 |
| Cron 没有产生抓取 | 检查 Worker 的 Triggers 面板是否有 `*/5 * * * *`；新部署后第一轮抓取最多等 5 分钟；也可在「朋友圈」页手动触发 |
| 朋友圈一直为空 | 友链需要填写 `feed` 地址才会参与朋友圈；在友链编辑里点「自动探测」补全 |
| 接口响应是旧数据 | 接口默认缓存 5 分钟（`api.cacheSeconds` 可调）；这是设计行为 |
| 想撤销隐藏某条友链 | 管理台友链页点该行的「显示」按钮；`hidden` 记录不出现在接口一 |
