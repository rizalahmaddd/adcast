import { useQueryClient } from '@tanstack/react-query'
import {
  BadgeCheck,
  CalendarClock,
  ChartNoAxesColumn,
  Film,
  LayoutGrid,
  ListVideo,
  Package,
  LogOut,
  Menu,
  Moon,
  ScrollText,
  Settings,
  Sun,
  Tv,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Suspense, useEffect, useState } from 'react'
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router'
import type { Permission } from '../shared/types'
import { api, ApiError, useMe, type Me } from './lib/api'
import { DAY } from '../shared/plans'
import { formatDate, readableOn } from './lib/format'
import { cx, Failed, Loading } from './ui'

const NAV: { to: string; label: string; icon: LucideIcon; needs?: Permission; platform?: boolean }[] = [
  { to: '/', label: 'Pantau', icon: LayoutGrid },
  { to: '/video', label: 'Media', icon: Film },
  { to: '/playlist', label: 'Playlist', icon: ListVideo },
  { to: '/jadwal', label: 'Jadwal', icon: CalendarClock },
  { to: '/layar', label: 'Layar', icon: Tv },
  { to: '/statistik', label: 'Statistik', icon: ChartNoAxesColumn },
  { to: '/pengguna', label: 'Pengguna', icon: Users, needs: 'user' },
  { to: '/log', label: 'Log aktivitas', icon: ScrollText, needs: 'audit' },
  { to: '/paket', label: 'Paket', icon: Package },
  { to: '/pengaturan', label: 'Pengaturan', icon: Settings },
  { to: '/pembayaran', label: 'Pembayaran', icon: BadgeCheck, platform: true },
]

export function Shell() {
  const me = useMe()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => setMenuOpen(false), [location.pathname])

  useEffect(() => {
    if (!me.data) return
    const root = document.documentElement.style
    root.setProperty('--brand', me.data.tenant.brandColor)
    root.setProperty('--on-brand', readableOn(me.data.tenant.brandColor))
    document.title = `${me.data.tenant.name} · AdCast`
  }, [me.data])

  if (me.isPending) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Loading what="akun Anda" />
      </div>
    )
  }
  if (me.error instanceof ApiError && me.error.status === 401) return <Navigate to="/masuk" replace />
  if (me.error) {
    return (
      <div className="mx-auto max-w-md p-6 pt-24">
        <Failed error={me.error} retry={() => me.refetch()} />
      </div>
    )
  }

  const items = NAV.filter(
    (item) => (!item.needs || me.data.permissions.includes(item.needs)) && (!item.platform || me.data.platformAdmin),
  )
  const { planExpiresAt, limits } = me.data.tenant
  const endsSoon = planExpiresAt !== null && planExpiresAt - Date.now() < 7 * DAY && location.pathname !== '/paket'

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-bg px-4 py-2 lg:hidden">
        <Brand me={me.data} />
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-controls="menu-utama"
          aria-label={menuOpen ? 'Tutup menu' : 'Buka menu'}
          className="grid size-11 place-items-center rounded-md hover:bg-sunken"
        >
          {menuOpen ? <X className="size-6" aria-hidden /> : <Menu className="size-6" aria-hidden />}
        </button>
      </header>

      <aside
        id="menu-utama"
        className={cx(
          'border-line bg-bg lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:border-r lg:px-3 lg:py-5',
          menuOpen ? 'fixed inset-x-0 top-[3.75rem] bottom-0 z-20 flex flex-col overflow-y-auto px-3 py-4' : 'hidden',
        )}
      >
        <div className="mb-6 hidden px-2 lg:block">
          <Brand me={me.data} />
        </div>
        <nav aria-label="Menu utama" className="grid gap-1">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cx(
                  'flex min-h-11 items-center gap-3 rounded-md px-3 font-semibold',
                  isActive ? 'bg-brand text-on-brand' : 'text-muted hover:bg-sunken hover:text-ink',
                )
              }
            >
              <Icon className="size-5 shrink-0" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <Account me={me.data} />
      </aside>

      <main className="min-w-0 px-4 py-6 sm:px-8 lg:py-8">
        <div className="mx-auto max-w-6xl">
          {endsSoon && (
            <p role="status" className="mb-6 rounded-md border border-warn/50 bg-surface px-4 py-3">
              {me.data.tenant.plan === 'trial' ? 'Masa coba' : `Paket ${limits.label}`} berakhir {formatDate(planExpiresAt)}.
              Setelah itu batas paket Gratis berlaku dan file hasil upload berhenti tayang.{' '}
              <Link to="/paket" className="font-semibold underline">
                {me.data.tenant.plan === 'trial' ? 'Pilih paket' : 'Perpanjang paket'}
              </Link>
            </p>
          )}
          <Suspense fallback={<Loading what="halaman" />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
    </div>
  )
}

function Brand({ me }: { me: Me }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {me.tenant.logoUrl ? (
        <img src={me.tenant.logoUrl} alt="" className="size-9 shrink-0 rounded-md object-contain" />
      ) : (
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-md bg-brand text-lg font-bold text-on-brand"
        >
          {me.tenant.name.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="truncate font-bold">{me.tenant.name}</span>
    </div>
  )
}

function Account({ me }: { me: Me }) {
  const qc = useQueryClient()
  const [theme, setTheme] = useState(document.documentElement.dataset.theme ?? 'light')

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    localStorage.setItem('adcast_theme', next)
    setTheme(next)
  }

  const switchTenant = async (tenantId: string) => {
    await api('POST', '/api/auth/switch', { tenantId })
    await qc.invalidateQueries()
  }

  const logout = async () => {
    await api('POST', '/api/auth/logout').catch(() => {})
    qc.clear()
    location.href = '/masuk'
  }

  return (
    <div className="mt-auto grid gap-1 border-t border-line pt-4">
      {me.tenants.length > 1 && (
        <label className="mb-2 grid gap-1 px-2 text-sm font-semibold">
          Usaha aktif
          <select
            value={me.tenant.id}
            onChange={(e) => switchTenant(e.target.value)}
            className="min-h-11 rounded-md border border-line bg-surface px-2 font-normal"
          >
            {me.tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="px-3 pb-1">
        <p className="truncate font-semibold">{me.user.name}</p>
        <p className="truncate text-sm text-muted">{me.role}</p>
      </div>
      <button
        type="button"
        onClick={toggleTheme}
        className="flex min-h-11 items-center gap-3 rounded-md px-3 font-semibold text-muted hover:bg-sunken hover:text-ink"
      >
        {theme === 'dark' ? <Sun className="size-5" aria-hidden /> : <Moon className="size-5" aria-hidden />}
        {theme === 'dark' ? 'Mode terang' : 'Mode gelap'}
      </button>
      <button
        type="button"
        onClick={logout}
        className="flex min-h-11 items-center gap-3 rounded-md px-3 font-semibold text-muted hover:bg-sunken hover:text-ink"
      >
        <LogOut className="size-5" aria-hidden />
        Keluar
      </button>
    </div>
  )
}
