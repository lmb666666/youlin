# 导入与导出 | Import & Export

「导入」用于把已有友链迁入友邻，或批量补数据；「导出」用于备份、表格查看或给 RSS 阅读器使用。两者都在管理台，不涉及公开接口。

## 导入 | Import

入口：**友链页 → 导入**，或 `⌘K` → 导入数据。原来的 `/admin/import` 会重定向到 `/admin/links?import=1`。

### 支持的 JSON 形状

```jsonc
// 1. 条目数组
[
  { "author": "Liang", "link": "https://blog.liang.one/", "feed": "https://blog.liang.one/atom.xml" }
]

// 2. 带分组的对象
{
  "groups": [
    {
      "name": "朋友们",
      "links": [
        { "author": "Liang", "link": "https://blog.liang.one/" }
      ]
    }
  ]
}

// 3. 顶层数组键（四选一）
{ "friends": [ ... ] }
{ "links": [ ... ] }
{ "sites": [ ... ] }
{ "items": [ ... ] }
```

分组内的键可以是 `links` / `friends` / `sites` / `items`。没有分组的条目会进入「未分组」。

### 字段别名

导入会识别常见别名，从左到右取第一个非空值：

| 目标字段 | 可用别名 |
| --- | --- |
| `link` | `link` / `url` / `site` / `siteUrl` / `siteLink` / `homepage` / `home` |
| `author` | `author` / `name` / `owner` / `blogger` |
| `nickname` | `nickname` / `nickName` |
| `title` | `title` / `siteName` / `blogName` |
| `desc` | `desc` / `description` / `slogan` / `intro` / `bio` |
| `feed` | `feed` / `rss` / `rssUrl` / `feedUrl` / `atom` / `subscribeUrl` |
| `icon` | `icon` / `favicon` / `iconUrl` / `faviconUrl` |
| `avatar` | `avatar` / `img` / `image` / `photo` / `headUrl` / `headPic` |
| `archs` | `archs` / `arch` / `framework` / `frameworks` / `tech` |
| `comment` | `comment` / `note` / `remark` |
| `group` | `group` / `groupName` / `category` |
| `since` | `since` / `sinceDate` / `joinDate` / `startDate` / `date` |

- `link` 必须是合法的 http(s) URL；缺失或非法时该条跳过。
- `feed` / `icon` / `avatar` 给了但不是 http(s) URL 时会记录错误并丢弃该字段，其他字段仍导入。
- `archs` 可以是数组，或用逗号、顿号、竖线、斜杠分隔的字符串；最多 20 项，每项 100 字。
- `author` 缺省时依次回退 `nickname` → `title` → 链接 hostname。
- `since` 缺省时使用导入当天；冲突更新时不会用当天覆盖已有 `since`。
- `inCircle` 只有显式出现才更新；`"false"`、`"0"`、`0`、`false`、`null`、空串都视为关闭，缺省时新条目默认纳入、旧条目保留原值。
- `status` 只接受 `active` / `hidden`。

### 去重与更新语义

- 按 `link` 精确匹配，已存在则更新，不存在则新建。
- 缺省字段用旧值保留（COALESCE），不会把已有字段清空；只有显式给值才覆盖。
- 分组按名称查找，不存在时创建；同名分组不会重复创建。
- 重复执行同一份文件是安全的：新条目仍会新增，已存在条目会更新。

### 结果

响应包含：

```json
{
  "imported": 12,
  "updated": 3,
  "skipped": 1,
  "groupsCreated": 2,
  "errors": [{ "index": 7, "message": "缺少合法的站点链接（link/url/site…）" }]
}
```

`errors` 最多返回前 20 条；`index` 是原始条目序号（从 0 开始）。如果没有任何可识别条目，返回 `400 empty_input`。

### 限制

- 管理 API JSON 请求体上限 16 MB；前端导入弹窗也会拒绝超过 16 MB 的文件。
- 导入只处理分组与友链，不导入申请、文章、体检状态或设置；完整迁移请用[备份与恢复](backup.md)。

## 导出 | Export

友链页右上角「导出」提供三种格式；对应管理 API：

| 格式 | 端点 | 内容 |
| --- | --- | --- |
| JSON | `/api/admin/export?format=json` | 全量友链结构（含隐藏与全部管理字段），可再导入 |
| CSV | `/api/admin/export?format=csv` | Excel 友好表格，UTF-8 BOM，防止公式注入 |
| OPML | `/api/admin/export?format=opml` | RSS 阅读器订阅列表；只包含有 `feed` 的友链 |

- 导出范围是友链表；不含申请、设置、文章或体检状态。
- 需要完整数据（含申请、设置、文章）请用「备份」页的 `.json.gz`。
- CSV 的列与友链管理字段一致；OPML 的标题/说明来自友链记录。

## 与其他功能的关系

- 导入后接口数据会立即可见，但下游可能有最多 `api.cacheSeconds` 秒的 HTTP 缓存。
- 导入不会触发体检或抓取；需要时去朋友圈页手动抓取，或等调度器轮转。
- 导入不触发接入方重建；需要时在朋友圈页点「重建站点」（需启用 `rebuild.enabled`）。
