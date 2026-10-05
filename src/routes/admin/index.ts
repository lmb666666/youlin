import { Hono, type Context } from 'hono'
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

export function adminRoutes() {
  const app = new Hono<AppEnv>()

  app.use('/api/admin/*', requireAdmin)
  app.route('/', loginRoutes())
  app.route('/', groupRoutes())
  app.route('/', friendRoutes())
  app.route('/', settingsRoutes())
  app.route('/', importRoutes())
  app.route('/', exportRoutes())
  app.route('/', crawlerRoutes())
  app.route('/', applicationRoutes())

  return app
}
