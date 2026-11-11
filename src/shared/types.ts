export const PERMISSIONS = {
  broadcast: 'Mengirim dan mengontrol tayangan',
  media: 'Mengelola video',
  playlist: 'Mengelola playlist',
  schedule: 'Mengelola jadwal tayang',
  device: 'Mengelola layar dan cabang',
  user: 'Mengelola pengguna dan peran',
  settings: 'Mengubah pengaturan usaha',
  audit: 'Melihat log aktivitas',
} as const

export type Permission = keyof typeof PERMISSIONS
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[]

export const TIMEZONES = {
  'Asia/Jakarta': { label: 'WIB', offset: 7 },
  'Asia/Makassar': { label: 'WITA', offset: 8 },
  'Asia/Jayapura': { label: 'WIT', offset: 9 },
} as const
export type Timezone = keyof typeof TIMEZONES

export { PLANS, type Plan } from './plans'

export const UPLOAD_PART_SIZE = 8 * 1024 * 1024

export type CmdItem = {
  mediaId: string
  kind: 'file' | 'youtube' | 'image'
  title: string
  youtubeId?: string
  // Set for media played from an external address; `kind` is unchanged so players treat it like a stored one.
  url?: string
  // Seconds. For an image this is how long it stays on screen.
  duration: number | null
}

export type Cmd = {
  id: string
  name: string
  items: CmdItem[]
  // Server-clock epoch ms; players derive their position from it so they stay in step.
  startAt: number
  paused: boolean
  pausedAt?: number
  scheduleId?: string
}

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error'

export type Reported = {
  status: PlayerStatus
  cmdId?: string
  mediaId?: string
  title?: string
  position?: number
  error?: string
  cached?: number
  at: number
}

export type DeviceLive = {
  online: boolean
  lastSeen: number | null
  reported: Reported | null
  desired: { id: string; name: string; paused: boolean; scheduleId?: string } | null
}

export type Target = { type: 'all' | 'branch' | 'device'; ids: string[] }

export type ServerToPlayer =
  | { t: 'welcome'; now: number; cmd: Cmd | null }
  | { t: 'time'; c: number; s: number }
  | { t: 'cmd'; cmd: Cmd | null }
  | { t: 'revoked' }
  // Branch or tenant settings changed; the player fetches its info again.
  | { t: 'refresh' }

export type PlayerToServer =
  | { t: 'hello' }
  | { t: 'time'; c: number }
  | { t: 'state'; state: Omit<Reported, 'at'> }
  | { t: 'stats'; day: string; up: number; plays: { id: string; s: number }[] }

export type ServerToDashboard = { t: 'device'; id: string; live: DeviceLive }

export const IMAGE_SECONDS = 10
export const isImageMime = (mime: string | null | undefined) => !!mime?.startsWith('image/')

export type StatsReport = {
  days: number
  maxDays: number
  /** Local calendar days covered, oldest first. */
  range: string[]
  /** Seconds per day, keyed by device then day. */
  up: Record<string, Record<string, number>>
  plays: { deviceId: string; day: string; mediaId: string; seconds: number }[]
  media: Record<string, { title: string; kind: CmdItem['kind']; duration: number | null }>
}
