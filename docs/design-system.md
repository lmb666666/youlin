# 设计系统 | Design System

友邻的管理台与申请页共用一套 **Claude 编辑风（暖纸）** 视觉语言：暖色纸面、衬线标题、陶土橙强调、扁平面板、低阴影。本文记录 token、组件与交互约定；改界面前先读这一页。

## 原则 | Principles

- **安静**：低饱和暖色、细边框、少阴影；信息靠排版与留白分层。
- **编辑感**：页面标题与卡片标题用衬线；正文与控件用无衬线。
- **可读**：正文对比度 ≥ 4.5:1；输入控件边界 ≥ 3:1；不靠颜色单独传达状态。
- **一致**：同一类页面使用同一页头、空态、错误态、确认框与表格。

## 颜色 | Color

所有颜色定义在 `web/src/index.css`，通过 Tailwind v4 的 `@theme inline` 暴露为 `bg-*` / `text-*` / `border-*`。页面不要写死色值。

| Token | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `--background` | `#faf9f5` | `#262624` | 页面底色 |
| `--foreground` | `#1f1e1d` | `#f5f4ef` | 正文 |
| `--card` | `#fffdf9` | `#30302e` | 卡片、弹窗、输入框 |
| `--secondary` | `#f6f3eb` | `#2a2a28` | 次级表面、表头、hover |
| `--muted-foreground` | `#5f5d58` | `#b9b6ac` | 次要文字 |
| `--subtle` | `#6f6b63` | `#a09d94` | 元数据、时间、提示 |
| `--border` | `#e8e3d8` | `#3d3d3a` | 卡片与分隔线 |
| `--input` | `#948b7a` | `#83837a` | 输入控件边界 |
| `--primary` | `#d97757` | `#d97757` | 主操作、选中态 |
| `--primary-hover` | `#c15f3c` | `#e08a6d` | 主操作 hover |
| `--primary-foreground` | `#1f1e1d` | `#1f1e1d` | 主操作文字（与陶土橙 ≥ 4.5:1） |
| `--success` | `#4a6f4f` | `#a8c9a8` | 正常、可达 |
| `--warning` | `#8a5a12` | `#e0b87a` | 待处理、RSS 异常 |
| `--danger` | `#a53f36` | `#e6a49b` | 删除、失败 |
| `--info` | `#4c5a70` | `#b8c2d4` | 中性提示 |

语义色配套 `--success-bg` / `--success-border` 等低饱和底色，统一通过 `StatusBadge` 使用。

### 强调色

`ui.accentColor` 只接受 `#rrggbb`。`applyAccentColor()` 会按对比度自动选择深/浅前景色，并派生 hover 与 focus ring；申请页使用同一规则。非法值回退默认陶土橙。

## 字体 | Typography

- 标题：`"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", serif`
- 正文与控件：`Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`
- 数字与 URL：`"SFMono-Regular", ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace`
- 不加载 webfont；中文衬线使用系统字体，避免自托管字体体积与不稳定性。

字号：11 / 12 / 13 / 14 / 15 / 20 / 26 / 30。页面标题 26–30px 衬线；卡片标题 16px 衬线；正文 14px；元数据 11–12px。字重只用 400 / 500 / 600。

## 形状与间距 | Shape & Spacing

- 圆角：卡片与弹窗 16px（`rounded-xl`）；侧栏导航 12px（`rounded-lg`）；按钮/输入框/下拉 10px（`rounded-md`）；标签胶囊 999px。
- 边框：1px；卡片与页面靠表面色分层，除弹窗/下拉外不加阴影。
- 间距：4px 基准；页面区块 20–24px，卡片内 16–20px，字段之间 6–8px。
- 动效：hover/按压约 150ms；弹窗/抽屉使用 `tw-animate-css` 的 200–300ms；只做透明度与位移，尊重 `prefers-reduced-motion`。

## 组件 | Components

```text
components/
  ui/        shadcn 原语：Button / Card / Dialog / Select / Switch / Tooltip …
  common/    业务无关的复合组件
  shell/     侧栏、顶栏、移动端抽屉、命令面板、任务状态
```

### common

| 组件 | 用途 |
| --- | --- |
| `PageHeader` | 页面标题、说明、右侧动作 |
| `EmptyState` / `ErrorState` | 空态与错误态，带动作/重试 |
| `ConfirmDialog` | 破坏性操作确认；异步时由父级关闭 |
| `DataTable` | 桌面表格 + 移动端卡片；可访问排序 |
| `Pagination` | 页码与上下页 |
| `SearchField` | 带清空按钮的搜索框 |
| `SegmentedControl` | 筛选/状态切换（`aria-pressed`） |
| `SaveBar` | 设置页粘性保存条 |
| `StatusBadge` | success / warning / danger / info / neutral |
| `Avatar` | 头像，加载失败保留首字母底色 |
| `FormField` | 标签、说明、错误、未保存标记 |
| `CopyButton` | 复制并反馈，带 `execCommand` 回退 |
| `StatCard` | 总览统计数字 |

### shell

| 组件 | 用途 |
| --- | --- |
| `AppShell` | 侧栏/顶栏/移动端抽屉/登录态/主题/强调色 |
| `CommandPalette` | `⌘K` / `Ctrl+K` 导航与快捷动作 |
| `JobStatus` | 全局抓取/体检任务进度与手动触发 |

## 交互 | Interaction

- **加载**：页面用与真实布局同形的 skeleton；按钮 pending 时禁用并保留宽度。
- **错误**：查询错误显示页内错误块并带重试；toast 只用于变更结果和后台任务完成。
- **空态**：图标 + 标题 + 说明 + 一个明确动作。
- **破坏性操作**：删除友链/分组/文章、清理申请、恢复备份、导入设置都要确认。
- **乐观更新**：排序、隐藏等操作先更新缓存，失败回滚。
- **轮询**：全局 `useJobStatus()`，只在 `running` 时 1.5s 轮询；完成时统一刷新体检、文章、统计、友链。
- **表单**：失焦校验；错误贴近字段并关联 `aria-describedby`；设置页有粘性保存条与离开提醒。
- **键盘**：`⌘K` / `Ctrl+K` 命令面板；`Esc` 关闭弹窗/抽屉；表格排序、标签、开关均可键盘操作。

### URL 状态

| 页面 | 参数 |
| --- | --- |
| 友链 | `q`、`group`、`import`、`new` |
| 申请 | `status`、`q`、`page` |
| 体检 | `filter`、`page`、`sort`、`dir` |
| 朋友圈 | `filter`、`page` |
| 设置 | `section` |

## 响应式 | Responsive

- **应用外壳**：`<1024px` 使用顶栏 + 抽屉导航；`>=1024px` 左侧固定侧栏（252px）。
- **数据表格**：`<768px` 转为卡片行；`>=768px` 使用表格。
- **页面头部**：窄屏动作按钮换行；设置页分组导航横向滚动。
- 列表页主操作放在页头或工具栏；不依赖 hover；触控目标尽量 ≥ 40px。
- 375 / 768 / 1024 / 1440 四档无横向滚动。

## 申请页 | Apply Page

`src/apply-page.ts` 服务端渲染，使用同一套暖纸色与陶土橙，但只跟随系统明暗（不读 localStorage）。强调色同样只接受 hex，并自动计算前景色。表单具备行内错误、`aria-live` 结果区与减少动效支持。

## 检查清单 | Review Checklist

- 浅色/深色都看一遍；正文对比度 ≥4.5:1，控件边界 ≥3:1。
- 375 / 768 / 1024 / 1440 四档无横向滚动。
- 键盘走一遍导航、表单、弹窗、表格排序。
- 破坏性操作有确认；查询错误不重复 toast；异步按钮有 pending。
- `pnpm lint && pnpm typecheck && pnpm test` 全绿。
