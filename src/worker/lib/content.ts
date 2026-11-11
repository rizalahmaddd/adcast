import { IMAGE_SECONDS, isImageMime, TIMEZONES, type CmdItem, type Target, type Timezone } from '../../shared/types'
import { coveredDevices, tenantPlan } from './plan'

type MediaRow = {
  id: string
  kind: 'file' | 'youtube' | 'link'
  title: string
  youtube_id: string | null
  url: string | null
  mime: string | null
  duration: number | null
}

const toItem = (m: MediaRow): CmdItem => ({
  mediaId: m.id,
  kind: m.kind === 'youtube' ? 'youtube' : isImageMime(m.mime) ? 'image' : 'file',
  title: m.title,
  youtubeId: m.youtube_id ?? undefined,
  url: m.url ?? undefined,
  duration: isImageMime(m.mime) ? (m.duration ?? IMAGE_SECONDS) : m.duration,
})

export type Content = {
  name: string
  items: CmdItem[]
  /** Uploaded videos left out because the tenant's plan no longer includes stored video. */
  withheld: number
}

async function playable(db: D1Database, tenantId: string, name: string, rows: MediaRow[]): Promise<Content> {
  const stored = rows.some((m) => m.kind === 'file')
  const allowed = !stored || (await tenantPlan(db, tenantId)).rules.maxStorage > 0
  const kept = allowed ? rows : rows.filter((m) => m.kind !== 'file')
  return { name, items: kept.map(toItem), withheld: rows.length - kept.length }
}

export async function resolveContent(
  db: D1Database,
  tenantId: string,
  type: 'media' | 'playlist',
  id: string,
): Promise<Content | null> {
  if (type === 'media') {
    const m = await db
      .prepare(
        "SELECT id, kind, title, youtube_id, url, mime, duration FROM media WHERE id = ? AND tenant_id = ? AND status = 'ready'",
      )
      .bind(id, tenantId)
      .first<MediaRow>()
    return m ? playable(db, tenantId, m.title, [m]) : null
  }
  const p = await db
    .prepare('SELECT name FROM playlists WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId)
    .first<{ name: string }>()
  if (!p) return null
  const { results } = await db
    .prepare(
      `SELECT m.id, m.kind, m.title, m.youtube_id, m.url, m.mime, m.duration
       FROM playlist_items i JOIN media m ON m.id = i.media_id
       WHERE i.playlist_id = ? AND m.status = 'ready' ORDER BY i.position`,
    )
    .bind(id)
    .all<MediaRow>()
  return playable(db, tenantId, p.name, results)
}

export type TargetDevice = { id: string; branch_id: string; offset: number }

/** `forPlayback` leaves out screens beyond the plan's limit; controls like stop still reach every screen. */
export async function resolveTarget(
  db: D1Database,
  tenantId: string,
  target: Target,
  forPlayback = false,
): Promise<TargetDevice[]> {
  const covered = forPlayback ? await coveredDevices(db, tenantId) : null
  const { results } = await db
    .prepare(
      'SELECT d.id, d.branch_id, b.timezone FROM devices d JOIN branches b ON b.id = d.branch_id WHERE d.tenant_id = ?',
    )
    .bind(tenantId)
    .all<{ id: string; branch_id: string; timezone: string }>()
  const ids = new Set(target.ids)
  return results
    .filter((d) => !covered || covered.has(d.id))
    .filter(
      (d) =>
        target.type === 'all' ||
        (target.type === 'branch' && ids.has(d.branch_id)) ||
        (target.type === 'device' && ids.has(d.id)),
    )
    .map((d) => ({
      id: d.id,
      branch_id: d.branch_id,
      offset: TIMEZONES[d.timezone as Timezone]?.offset ?? 7,
    }))
}
