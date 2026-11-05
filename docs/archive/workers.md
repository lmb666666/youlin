# Cloudflare Workers 支持归档

Workers 支持在 **v0.3.0** 冻结。主分支已转为 Docker-only，不再包含 Workers 运行时、D1 适配和 workerd 测试。

## 归档位置

- 分支：https://github.com/lmb666666/youlin/tree/archive/workers
- 版本：`v0.3.0`
- 额外标记：`workers-final`

`archive/workers` 分支保留 Workers 入口、`wrangler.jsonc`、D1 适配层、workerd 测试和 Cloudflare 部署文档，可继续浏览或自行 fork 维护。

## 为什么归档

- 项目定位为单实例自托管，Docker + SQLite 已覆盖目标场景；
- 双运行时导致 `Env`、IP 判定、数据库类型和测试体系长期存在分支；
- 移除后可以简化数据库层、测试和 CI，并专注于 SQLite/Docker 的可靠性。

## Workers 实例如何迁移到 Docker

1. 在 v0.3.0 Workers 实例中打开「备份」页，下载包含文章与体检状态的备份。
2. 按当前 Docker 部署文档启动新实例并登录。
3. 在「备份」页选择该文件恢复。
4. 核对分组、友链、申请与设置；如果备份包含文章与体检状态，会一并恢复。

备份格式是跨运行时的 JSON 信封，不依赖 D1 或 SQLite 文件格式。

## 支持策略

- `v0.3.0` 之后不再为 Workers 运行时提供功能或安全更新；
- 主分支只接受 Docker/Node 相关变更；
- Workers 专属问题请在归档分支或自行 fork 中处理。
