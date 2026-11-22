import { lazy, Suspense } from 'react'
import { Navigate, Outlet, createBrowserRouter } from 'react-router'
import { AdminLayout } from '@/components/admin-layout'

const LoginPage = lazy(() => import('@/pages/login'))
const LinksPage = lazy(() => import('@/pages/links'))
const CirclePage = lazy(() => import('@/pages/circle'))
const HealthPage = lazy(() => import('@/pages/health'))
const ApplicationsPage = lazy(() => import('@/pages/applications'))
const DashboardPage = lazy(() => import('@/pages/dashboard'))
const IntegrationPage = lazy(() => import('@/pages/integration'))
const BackupPage = lazy(() => import('@/pages/backup'))
const SettingsPage = lazy(() => import('@/pages/settings'))

function PageFallback() {
  return <div className="p-6 text-sm text-subtle">加载中…</div>
}

/** 根元素只负责懒加载降级与 Outlet 分发，布局分流交给 pathless layout 路由 */
function RootShell() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Outlet />
    </Suspense>
  )
}

/** 数据路由：useBlocker（离开守卫）等特性只在 data router 下可用 */
export const router = createBrowserRouter([
  {
    element: <RootShell />,
    children: [
      { path: '/', element: <Navigate to="/admin/dashboard" replace /> },
      { path: '/admin', element: <Navigate to="/admin/dashboard" replace /> },
      { path: '/admin/login', element: <LoginPage /> },
      {
        element: <AdminLayout />,
        children: [
          { path: '/admin/dashboard', element: <DashboardPage /> },
          { path: '/admin/links', element: <LinksPage /> },
          { path: '/admin/api', element: <IntegrationPage /> },
          { path: '/admin/circle', element: <CirclePage /> },
          { path: '/admin/health', element: <HealthPage /> },
          { path: '/admin/applications', element: <ApplicationsPage /> },
          { path: '/admin/import', element: <Navigate to="/admin/links?import=1" replace /> },
          { path: '/admin/backup', element: <BackupPage /> },
          { path: '/admin/settings', element: <SettingsPage /> },
        ],
      },
      { path: '*', element: <Navigate to="/admin/dashboard" replace /> },
    ],
  },
])
