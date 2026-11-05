import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router'
import { AdminLayout } from '@/components/admin-layout'

const LoginPage = lazy(() => import('@/pages/login'))
const LinksPage = lazy(() => import('@/pages/links'))
const CirclePage = lazy(() => import('@/pages/circle'))
const HealthPage = lazy(() => import('@/pages/health'))
const ApplicationsPage = lazy(() => import('@/pages/applications'))
const DashboardPage = lazy(() => import('@/pages/dashboard'))
const IntegrationPage = lazy(() => import('@/pages/integration'))
const ImportPage = lazy(() => import('@/pages/import'))
const BackupPage = lazy(() => import('@/pages/backup'))
const SettingsPage = lazy(() => import('@/pages/settings'))

function PageFallback() {
  return <div className="p-6 text-sm text-muted-foreground">加载中…</div>
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="/admin/login" element={<LoginPage />} />
        <Route element={<AdminLayout />}>
          <Route path="/admin/dashboard" element={<DashboardPage />} />
          <Route path="/admin/links" element={<LinksPage />} />
          <Route path="/admin/api" element={<IntegrationPage />} />
          <Route path="/admin/circle" element={<CirclePage />} />
          <Route path="/admin/health" element={<HealthPage />} />
          <Route path="/admin/applications" element={<ApplicationsPage />} />
          <Route path="/admin/import" element={<ImportPage />} />
          <Route path="/admin/backup" element={<BackupPage />} />
          <Route path="/admin/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
      </Routes>
    </Suspense>
  )
}
