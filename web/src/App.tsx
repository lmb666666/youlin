import { Routes, Route, Navigate } from 'react-router'
import { AdminLayout } from '@/components/admin-layout'
import LoginPage from '@/pages/login'
import LinksPage from '@/pages/links'
import CirclePage from '@/pages/circle'
import HealthPage from '@/pages/health'
import ApplicationsPage from '@/pages/applications'
import DashboardPage from '@/pages/dashboard'
import IntegrationPage from '@/pages/integration'
import ImportPage from '@/pages/import'
import SettingsPage from '@/pages/settings'

export default function App() {
  return (
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
        <Route path="/admin/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
    </Routes>
  )
}
