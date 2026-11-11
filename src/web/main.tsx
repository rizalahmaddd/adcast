import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router'
import './app.css'
import { ApiError } from './lib/api'
import { AuthPage } from './pages/Auth'
import { Shell } from './Shell'
import { ToastProvider } from './ui'

const Player = lazy(() => import('./player/Player'))
const Monitor = lazy(() => import('./pages/Monitor'))
const Videos = lazy(() => import('./pages/Videos'))
const Playlists = lazy(() => import('./pages/Playlists'))
const Schedules = lazy(() => import('./pages/Schedules'))
const Screens = lazy(() => import('./pages/Screens'))
const People = lazy(() => import('./pages/People'))
const ActivityLog = lazy(() => import('./pages/ActivityLog'))
const Settings = lazy(() => import('./pages/Settings'))
const Stats = lazy(() => import('./pages/Stats'))
const ScreenStats = lazy(() => import('./pages/ScreenStats'))
const Plans = lazy(() => import('./pages/Plans'))
const Payments = lazy(() => import('./pages/Payments'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
      refetchOnWindowFocus: true,
      staleTime: 10_000,
    },
  },
})

const stored = localStorage.getItem('adcast_theme')
document.documentElement.dataset.theme =
  stored ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <Suspense fallback={null}>
            <Routes>
              <Route path="/player" element={<Player />} />
              <Route path="/masuk" element={<AuthPage mode="login" />} />
              <Route path="/daftar" element={<AuthPage mode="register" />} />
              <Route element={<Shell />}>
                <Route index element={<Monitor />} />
                <Route path="video" element={<Videos />} />
                <Route path="playlist" element={<Playlists />} />
                <Route path="jadwal" element={<Schedules />} />
                <Route path="layar" element={<Screens />} />
                <Route path="layar/:id" element={<ScreenStats />} />
                <Route path="statistik" element={<Stats />} />
                <Route path="pengguna" element={<People />} />
                <Route path="log" element={<ActivityLog />} />
                <Route path="pengaturan" element={<Settings />} />
                <Route path="paket" element={<Plans />} />
                <Route path="pembayaran" element={<Payments />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
)

function NotFound() {
  return (
    <div className="py-16">
      <h1 className="text-2xl font-bold">Halaman tidak ditemukan</h1>
      <p className="mt-2 text-muted">
        Alamat ini tidak ada di AdCast. <a className="font-semibold underline" href="/">Kembali ke halaman Pantau</a>.
      </p>
    </div>
  )
}
