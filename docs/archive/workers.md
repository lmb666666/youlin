# Cloudflare Workers 支持归档 | Workers Archive

Workers 支持在 **v0.3.0** 冻结。主分支已转为 Docker-only，不再包含 Workers 运行时、D1 适配和 workerd 测试。

## 归档位置

- 分支：https://github.com/lmb666666/youlin/tree/archive/workers
- 版本：`v0.3.0`
- 额外标记：`workers-final`

归档分支保留 Workers 入口、`wrangler.jsonc`、D1 适配层、workerd 测试和 Cloudflare 部署文档，可继续浏览或自行 fork 维护。

## 为什么归档

- 项目定位是单实例自托管，Docker + SQLite 已覆盖目标场景；
- 双运行时让 `Env`、IP 判定、数据库类型与测试体系长期分叉；
- 移除后可以简化数据库层、测试和 CI，并专注 SQLite/Docker 的可靠性。

## 迁移到 Docker

1. 在 v0.3.0 Workers 实例打开「备份」页，下载包含文章与体检状态的备份。
2. 按[部署指南](../deployment.md)启动 Docker 实例并登录。
3. 在「备份」页选择该文件恢复；备份信封 `version` 必须为 `1`。
4. 核对分组、友链、申请与设置；包含文章与体检状态时会一并恢复。

备份是跨运行时的 JSON 信封，不依赖 D1 或 SQLite 文件格式。备份与恢复的完整语义见[备份与恢复](../backup.md)。

## 支持策略

- `v0.3.0` 之后不再为 Workers 运行时提供功能或安全更新；
- 主分支只接受 Docker/Node 相关变更；
- Workers 专属问题请在归档分支或自行 fork 中处理。
