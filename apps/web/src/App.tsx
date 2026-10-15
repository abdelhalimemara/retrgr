import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/app-layout'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider, useAuth } from '@/lib/auth'
import ConsentPage from '@/pages/consent'
import OptOutPage from '@/pages/optout'

// Dashboard code (charts, tables, Firebase sign-in UI) is split out so the
// public consent page stays light for people arriving from a QR code on mobile data.
const AttributionPage = lazy(() => import('@/pages/attribution'))
const CampaignsPage = lazy(() => import('@/pages/campaigns'))
const CollectorPage = lazy(() => import('@/pages/collector'))
const CustomersPage = lazy(() => import('@/pages/customers'))
const ExportsPage = lazy(() => import('@/pages/exports'))
const LoginPage = lazy(() => import('@/pages/login'))
const OverviewPage = lazy(() => import('@/pages/overview'))
const PartnersPage = lazy(() => import('@/pages/partners'))
const SegmentsPage = lazy(() => import('@/pages/segments'))

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
