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

/** One line of text scrolling along the bottom of the screen. */
export type Ticker = {
  text: string
  /** Pixels per second. */
  speed: number
  bg: string
}

export const TICKER_SPEEDS = [
  { value: 60, label: 'Lambat' },
  { value: 120, label: 'Sedang' },
  { value: 200, label: 'Cepat' },
] as const

export type DeviceRotation = 0 | 90 | 180 | 270

export type Announcement = {
  id: string
  text: string
  bg: string
}

/** Second panel beside the main video, used by the split layout. */
export type SidePanel =
  | { kind: 'text'; title: string | null; text: string; bg: string; color: string }
  | { kind: 'image'; mediaId: string; title: string | null }

export type Cmd = {
  id: string
  name: string
  items: CmdItem[]
  // Server-clock epoch ms; players derive their position from it so they stay in step.
  startAt: number
  paused: boolean
  pausedAt?: number
  scheduleId?: string
  // Overrides the branch's running text for this broadcast.
  ticker?: Ticker
  /** `split` gives the right third of the screen to `side`; omitted means full screen. */
  layout?: 'full' | 'split'
  side?: SidePanel
}

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error' | 'closed'

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

export type Target = { type: 'all' | 'branch' | 'group' | 'device'; ids: string[] }

/** Branch opening hours in its own timezone. Outside them TVs show a closed screen instead of the schedule. */
export type OpeningHours = {
  enabled: boolean
  /** `HH:MM`. `close` may be earlier than `open` for a shop that closes after midnight. */
  open: string | null
  close: string | null
  /** Replaces the default "Buka lagi pukul ..." line. */
  text: string | null
}

export type ServerToPlayer =
  | { t: 'welcome'; now: number; cmd: Cmd | null; ann?: Announcement | null }
  | { t: 'time'; c: number; s: number }
  | { t: 'cmd'; cmd: Cmd | null }
  | { t: 'announcement'; a: Announcement | null }
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
