import type { DeviceLive } from '../../shared/types'

// Formatters use the viewing device's own timezone, so the label reads WIB, WITA, or WIT automatically.
const dateTime = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short',
})
const clock = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })

const date = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })

export const formatDate = (ms: number) => date.format(ms)
/** Formats a `YYYY-MM-DD` calendar day (validity dates) the same way as timestamps. */
export const formatDay = (day: string) => date.format(new Date(`${day}T00:00:00`))
export const formatRupiah = (amount: number) => `Rp ${amount.toLocaleString('id-ID')}`
export const formatDateTime = (ms: number) => dateTime.format(ms)
export const formatClock = (ms: number) => clock.format(ms)

export function formatAgo(ms: number, now = Date.now()): string {
  const minutes = Math.round((now - ms) / 60_000)
  if (minutes < 1) return 'baru saja'
  if (minutes < 60) return `${minutes} menit lalu`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} jam lalu`
  return formatDateTime(ms)
}

export function formatDuration(seconds: number | null): string {
  if (!seconds) return ''
  const s = Math.round(seconds)
  const m = Math.floor(s / 60)
  return m >= 60
    ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
    : `${m}:${String(s % 60).padStart(2, '0')}`
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${bytes > 0 ? Math.max(1, Math.round(bytes / 1024)) : 0} KB`
}

export type ScreenState = 'never' | 'offline' | 'error' | 'playing' | 'paused' | 'closed' | 'idle'

export function screenState(live: DeviceLive | undefined): ScreenState {
  if (!live || (!live.online && !live.lastSeen)) return 'never'
  if (!live.online) return 'offline'
  const status = live.reported?.status
  if (status === 'error') return 'error'
  if (status === 'playing' || status === 'loading') return 'playing'
  if (status === 'paused') return 'paused'
  if (status === 'closed') return 'closed'
  return 'idle'
}

export const STATE_LABEL: Record<ScreenState, string> = {
  never: 'Belum pernah terhubung',
  offline: 'Offline',
  error: 'Error',
  playing: 'Memutar',
  paused: 'Dijeda',
  closed: 'Tutup (luar jam operasional)',
  idle: 'Online, tidak memutar',
}

export const STATE_COLOR: Record<ScreenState, string> = {
  never: 'text-off',
  offline: 'text-off',
  error: 'text-bad',
  playing: 'text-ok',
  paused: 'text-warn',
  closed: 'text-muted',
  idle: 'text-ink',
}

export function readableOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  // Whichever of black or white gives the higher contrast ratio.
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05 ? '#ffffff' : '#111111'
}

export const DAY_NAMES = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']
