import { Hono } from 'hono'
import { requireAdmin } from '../../auth'
import type { AppEnv } from '../../types'
import { loginRoutes } from './login'
import { groupRoutes } from './groups'
import { friendRoutes } from './friends'
import { settingsRoutes } from './settings'
import { importRoutes } from './import'
import { exportRoutes } from './export'
import { crawlerRoutes } from './crawler'
import { applicationRoutes } from './applications'
import { statsRoutes } from './stats'
import { backupRoutes } from './backup'

export function adminRoutes() {
  const app = new Hono<AppEnv>()

  app.use('/api/admin/*', requireAdmin)
  // 管理数据（申请联系方式、设置、备份）不应被浏览器/代理缓存
  app.use('/api/admin/*', async (c, next) => {
    await next()
    c.res.headers.set('Cache-Control', 'no-store')
  })
  app.route('/', loginRoutes())
  app.route('/', groupRoutes())
  app.route('/', friendRoutes())
  app.route('/', settingsRoutes())
  app.route('/', importRoutes())
  app.route('/', exportRoutes())
  app.route('/', crawlerRoutes())
  app.route('/', applicationRoutes())
  app.route('/', statsRoutes())
  app.route('/', backupRoutes())

  return app
}
