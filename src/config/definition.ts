/**
 * 配置项定义 —— 单一事实源（DESIGN §9）。
 *
 * 管理台设置表单由本定义渲染；zod 校验与 /api/admin/settings/schema 的 JSON Schema
 * 都从这里派生（config/schema.ts）。新增或变更配置项后，须同步 internal/DESIGN.md §9。
 */

export type FieldType = 'string' | 'text' | 'number' | 'boolean' | 'enum' | 'stringList' | 'json'

export interface ConfigField {
  /** 扁平 camelCase 点号键，如 site.name */
  key: string
  type: FieldType
  default: unknown
  label: string
  description: string
  /** type=enum 时的取值 */
  options?: string[]
  /** type=number 时的范围 */
  min?: number
  max?: number
  /** 表单占位提示 */
  placeholder?: string
  /** 表单整行宽度（长文本） */
  full?: boolean
}

export interface ConfigGroup {
  key: string
  label: string
  description: string
  fields: ConfigField[]
}

export const CONFIG_VERSION = 1

export const CONFIG_GROUPS: ConfigGroup[] = [
  {
    key: 'site',
    label: '站点',
    description: '站点基础信息，用于管理台、申请页与抓取 UA。',
    fields: [
      { key: 'site.name', type: 'string', default: '我的博客', label: '站点名称', description: '管理台与申请页标题。' },
      { key: 'site.url', type: 'string', default: '', label: '主站地址', description: '反链检测的默认目标，如 https://example.com', placeholder: 'https://example.com' },
      { key: 'site.logo', type: 'string', default: '', label: '站点 Logo', description: '申请页显示（可选）。', placeholder: 'https://…/logo.png' },
      { key: 'site.description', type: 'text', default: '', label: '站点简介', description: '申请页副标题（可选）。', full: true },
      { key: 'site.timezone', type: 'string', default: 'Asia/Shanghai', label: '时区', description: '管理台与申请页的时间显示。' },
      { key: 'site.locale', type: 'string', default: 'zh-CN', label: '界面语言', description: '当前仅 zh-CN（英文计划 v1.1）。' },
    ],
  },
  {
    key: 'crawl',
    label: '朋友圈抓取',
    description: '按分批轮转设计执行，避免超出 Workers 免费版单次 10ms CPU。',
    fields: [
      { key: 'crawl.enabled', type: 'boolean', default: true, label: '抓取总开关', description: '关闭后停止抓取，已有数据照常输出。' },
      { key: 'crawl.batchSize', type: 'number', default: 3, min: 1, max: 50, label: '每轮站点数', description: '与 Cron 频率共同决定刷新周期。' },
      { key: 'crawl.maxPerFriend', type: 'number', default: 5, min: 1, max: 50, label: '每站篇数上限', description: '每个源只保留最新 N 篇。' },
      { key: 'crawl.outputMaxArticles', type: 'number', default: 150, min: 1, max: 1000, label: '输出总量上限', description: '接口二按发布时间保留最新 N 篇。' },
      { key: 'crawl.futureToleranceDays', type: 'number', default: 2, min: 0, max: 30, label: '未来时间容差（天）', description: '文章发布时间晚于当前时间超过该天数将被丢弃。' },
      { key: 'crawl.retentionDays', type: 'number', default: 90, min: 7, max: 3650, label: '库内保留天数', description: '超期文章每日自动清理。' },
      { key: 'crawl.timeoutSeconds', type: 'number', default: 15, min: 1, max: 60, label: '单源超时（秒）', description: '抓取单个源的超时时间。' },
      { key: 'crawl.userAgent', type: 'string', default: 'Youlin/1.0 (+{site.url})', label: '抓取 UA', description: '{site.url} 会替换为主站地址。' },
      { key: 'crawl.concurrency', type: 'number', default: 5, min: 1, max: 20, label: '手动全量并发', description: '手动触发抓取一轮时的并发数。' },
    ],
  },
  {
    key: 'linkCheck',
    label: '体检',
    description: '友链可达性 / RSS 可用性 / 失联退避。',
    fields: [
      { key: 'linkCheck.enabled', type: 'boolean', default: true, label: '体检总开关', description: '关闭后停止检测，已有结果照常显示。' },
      { key: 'linkCheck.maxAgeHours', type: 'number', default: 24, min: 1, max: 168, label: '复查间隔（小时）', description: '同一友链两次检测的最小间隔。' },
      { key: 'linkCheck.timeoutSeconds', type: 'number', default: 15, min: 1, max: 60, label: '单次超时（秒）' , description: '体检单个源的超时时间。' },
      { key: 'linkCheck.concurrency', type: 'number', default: 10, min: 1, max: 50, label: '全量检测并发', description: '手动全量体检时的并发数。' },
      { key: 'linkCheck.statusApiUrl', type: 'string', default: '', label: '状态 API 兜底', description: '第三方状态检测地址，{url} 占位符，留空关闭。', placeholder: 'https://uptime.example.com/api/{url}' },
      {
        key: 'linkCheck.backoffLadder', type: 'json',
        default: [[10, 120], [30, 240], [60, 360]],
        label: '失联退避阶梯',
        description: '[失联天数, 复查间隔小时]，升序排列。',
        full: true,
      },
    ],
  },
  {
    key: 'backlink',
    label: '反链检测',
    description: '检测对方站点是否含有指向你站点的链接。',
    fields: [
      { key: 'backlink.enabled', type: 'boolean', default: true, label: '反链检测', description: '体检与申请流程共用的开关。' },
      { key: 'backlink.authorUrl', type: 'string', default: '', label: '自家域名', description: '默认取 site.url；填写后以此为准，如 example.com 或 https://example.com。', placeholder: 'example.com' },
    ],
  },
  {
    key: 'proxy',
    label: '代理',
    description: '直连失败时的代理前缀（可选）。',
    fields: [
      { key: 'proxy.url', type: 'string', default: '', label: '代理地址', description: '实际请求为 该地址 + 目标 URL。', placeholder: 'https://proxy.example.com/' },
      { key: 'proxy.mode', type: 'enum', options: ['off', 'fallback', 'always'], default: 'fallback', label: '代理模式', description: 'off 关闭 / fallback 直连失败再走代理 / always 始终走代理。' },
    ],
  },
  {
    key: 'apply',
    label: '友链申请',
    description: '公开申请页（接口三）的行为。',
    fields: [
      { key: 'apply.enabled', type: 'boolean', default: true, label: '申请通道', description: '关闭后 /apply 显示停用提示，POST /apply 返回 403。' },
      { key: 'apply.rateLimitPerDay', type: 'number', default: 3, min: 1, max: 100, label: '每 IP 每天上限', description: '按天限流，超出返回 429。' },
      { key: 'apply.turnstile', type: 'boolean', default: true, label: '人机验证', description: '关闭后提交不再验证人机。' },
      { key: 'apply.turnstileSiteKey', type: 'string', default: '', label: 'Turnstile Site Key', description: '公开值；Secret（TURNSTILE_SECRET）在部署级配置。' },
      { key: 'apply.backlinkPolicy', type: 'enum', options: ['mark', 'reject', 'off'], default: 'mark', label: '反链策略', description: 'mark 仅标记 / reject 未检测到反链即拒绝 / off 不检测。' },
      { key: 'apply.autoApprove', type: 'boolean', default: false, label: '自动通过', description: '提交即入库（不推荐，垃圾提交无人工拦截）。' },
      { key: 'apply.requiredFields', type: 'stringList', default: ['siteName', 'link'], label: '必填字段', description: '申请表单的必填字段。' },
      { key: 'apply.intro', type: 'text', default: '', label: '申请页说明', description: '留空使用内置文案。', full: true },
      { key: 'apply.successMessage', type: 'text', default: '', label: '提交成功提示', description: '留空使用内置文案。', full: true },
    ],
  },
  {
    key: 'api',
    label: '接口',
    description: '对外接口（一/二）的缓存与输出行为。',
    fields: [
      { key: 'api.cacheSeconds', type: 'number', default: 300, min: 0, max: 86400, label: '边缘缓存（秒）', description: '接口一/二的 Cache-Control。' },
      { key: 'api.corsOrigin', type: 'string', default: '*', label: 'CORS 来源', description: '允许的 Origin，* 或具体来源。' },
      { key: 'api.includeHidden', type: 'boolean', default: false, label: '输出隐藏记录', description: '开启后 hidden 友链也会出现在接口一。' },
      { key: 'api.maxLimit', type: 'number', default: 500, min: 1, max: 5000, label: 'limit 上限', description: '?limit= 允许的最大值。' },
    ],
  },
  {
    key: 'rebuild',
    label: '重建集成',
    description: '可选：数据变化后触发接入方站点重建（仅构建时接入需要）。',
    fields: [
      { key: 'rebuild.enabled', type: 'boolean', default: false, label: '启用重建', description: '运行时接入无需开启。' },
      { key: 'rebuild.provider', type: 'enum', options: ['webhook', 'github_dispatch'], default: 'webhook', label: '触发方式', description: 'webhook 通用 POST / github_dispatch 仓库事件。' },
      { key: 'rebuild.webhookUrl', type: 'string', default: '', label: 'Webhook 地址', description: 'provider=webhook 时的目标 URL。', placeholder: 'https://api.cloudflare.com/pages/webhooks/deploy_hooks/…' },
      { key: 'rebuild.githubRepo', type: 'string', default: '', label: 'GitHub 仓库', description: 'provider=github_dispatch 时，owner/name。', placeholder: 'owner/name' },
      { key: 'rebuild.eventType', type: 'string', default: 'friends-updated', label: '事件类型', description: 'repository_dispatch 的事件名。' },
      { key: 'rebuild.auto', type: 'boolean', default: false, label: '自动触发', description: '数据变更后自动触发。' },
      { key: 'rebuild.debounceSeconds', type: 'number', default: 60, min: 0, max: 3600, label: '防抖（秒）', description: '两次触发之间的最小间隔。' },
    ],
  },
  {
    key: 'ui',
    label: '界面',
    description: '管理台与申请页的外观。',
    fields: [
      { key: 'ui.theme', type: 'enum', options: ['system', 'light', 'dark'], default: 'system', label: '主题', description: '跟随系统 / 浅色 / 深色。' },
      { key: 'ui.accentColor', type: 'string', default: '', label: '强调色', description: '管理台主色，留空用默认。', placeholder: 'oklch(0.6 0.2 260)' },
      { key: 'ui.pageSize', type: 'number', default: 20, min: 5, max: 200, label: '分页大小', description: '列表页每页条数。' },
    ],
  },
  {
    key: 'security',
    label: '安全',
    description: '会话与登录保护（部署级密钥在 wrangler secrets，不在此处）。',
    fields: [
      { key: 'security.sessionDays', type: 'number', default: 30, min: 1, max: 365, label: '会话有效期（天）', description: '登录 Cookie 的有效期。' },
      { key: 'security.loginRateLimit', type: 'number', default: 5, min: 1, max: 100, label: '登录限流（次/小时）', description: '单 IP 每小时登录尝试上限，超出返回 429。' },
    ],
  },
  {
    key: 'notify',
    label: '通知（v1.1 预留）',
    description: '事件通知接口已定义，发送逻辑随 v1.1 提供。',
    fields: [
      { key: 'notify.webhookUrl', type: 'string', default: '', label: 'Webhook 地址', description: '新申请 / 友链失联时 POST 通知。' },
      { key: 'notify.events', type: 'stringList', default: ['application', 'linkDown'], label: '通知事件', description: 'application 新申请 / linkDown 友链失联。' },
    ],
  },
]

export const CONFIG_FIELDS: ConfigField[] = CONFIG_GROUPS.flatMap((g) => g.fields)

export const CONFIG_KEYS: readonly string[] = CONFIG_FIELDS.map((f) => f.key)

/** 嵌套分组键（顶层，如 site / crawl），用于嵌套视图 */
export const CONFIG_TOP_KEYS: readonly string[] = CONFIG_GROUPS.map((g) => g.key)
