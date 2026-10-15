import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/app-layout'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider, useAuth } from '@/lib/auth'
import ConsentPage from '@/pages/consent'
import OptOutPage from '@/pages/optout'

// Dashboard code (charts, tables, Firebase sign-in UI) is split out so the
// public consent page stays light for people arriving from a QR code on mobile data.
// A tab left open across a deploy asks for chunks that no longer exist; reload once
// to pick up the new build instead of showing a blank page.
const page = (load: () => Promise<{ default: ComponentType }>) =>
  lazy(() =>
    load().then(
      (m) => {
        sessionStorage.removeItem('retrgtr_chunk_reload')
        return m
      },
      (err) => {
        if (sessionStorage.getItem('retrgtr_chunk_reload')) throw err
        sessionStorage.setItem('retrgtr_chunk_reload', '1')
        window.location.reload()
        return new Promise<never>(() => {})
      },
    ),
  )
const AttributionPage = page(() => import('@/pages/attribution'))
const FormsPage = page(() => import('@/pages/forms'))
const CampaignsPage = page(() => import('@/pages/campaigns'))
const CollectorPage = page(() => import('@/pages/collector'))
const CustomersPage = page(() => import('@/pages/customers'))
const ExportsPage = page(() => import('@/pages/exports'))
const LoginPage = page(() => import('@/pages/login'))
const OverviewPage = page(() => import('@/pages/overview'))
const PartnersPage = page(() => import('@/pages/partners'))
const SegmentsPage = page(() => import('@/pages/segments'))

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return null
  return user ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <AuthProvider>
      <TooltipProvider>
        <BrowserRouter>
          <Suspense>
          <Routes>
            {/* Public, consumer-facing pages reached from OOH QR codes */}
            <Route path="/c/:slug" element={<ConsentPage />} />
            <Route path="/optout" element={<OptOutPage />} />
            <Route path="/login" element={<LoginPage />} />

            <Route
              element={
                <RequireAuth>
                  <AppLayout />
                </RequireAuth>
              }
            >
              <Route index element={<OverviewPage />} />
              <Route path="campaigns" element={<CampaignsPage />} />
              <Route path="attribution" element={<AttributionPage />} />
              <Route path="forms" element={<FormsPage />} />
              <Route path="partners" element={<PartnersPage />} />
              <Route path="collector" element={<CollectorPage />} />
              <Route path="customers" element={<CustomersPage />} />
              <Route path="segments" element={<SegmentsPage />} />
              <Route path="exports" element={<ExportsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster richColors position="top-right" />
      </TooltipProvider>
    </AuthProvider>
  )
}
