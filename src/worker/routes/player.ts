import { Hono } from 'hono'
import type { PrayerConfig } from '../../shared/prayer'
import { TIMEZONES, type Timezone } from '../../shared/types'
import { fail, hub, type AppEnv, type Bindings, type Ctx } from '../env'
import { newPairingCode, newToken, sha256 } from '../lib/crypto'
import { loadSession } from '../session'
import { thumbKey } from './media'

type Device = { id: string; tenant_id: string; name: string }

export async function deviceFromToken(env: Bindings, token: string | undefined | null): Promise<Device | null> {
  if (!token) return null
  return env.DB.prepare('SELECT id, tenant_id, name FROM devices WHERE token_hash = ?')
    .bind(await sha256(token))
    .first<Device>()
}

const bearer = (c: Ctx) => c.req.header('authorization')?.replace(/^Bearer /, '') ?? c.req.query('t')

export const playerApi = new Hono<AppEnv>()

const PAIRING_TTL = 15 * 60_000

playerApi.post('/pair', async (c) => {
  const db = c.env.DB
  const now = Date.now()
  const secret = newToken()
  await db.prepare('DELETE FROM pairings WHERE expires_at < ?').bind(now).run()
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newPairingCode()
    const res = await db
      .prepare('INSERT OR IGNORE INTO pairings (code, secret_hash, expires_at) VALUES (?,?,?)')
      .bind(code, await sha256(secret), now + PAIRING_TTL)
      .run()
    if (res.meta.changes) return c.json({ code, secret, expiresAt: now + PAIRING_TTL })
  }
  throw fail(409, 'Gagal membuat kode, coba lagi')
})

playerApi.get('/pair', async (c) => {
  const secret = bearer(c)
  if (!secret) throw fail(401, 'Tidak sah')
  const row = await c.env.DB.prepare('SELECT code, device_token, expires_at FROM pairings WHERE secret_hash = ?')
    .bind(await sha256(secret))
    .first<{ code: string; device_token: string | null; expires_at: number }>()
  if (!row || row.expires_at < Date.now()) return c.json({ status: 'expired' })
  if (!row.device_token) return c.json({ status: 'pending' })
  await c.env.DB.prepare('DELETE FROM pairings WHERE code = ?').bind(row.code).run()
  return c.json({ status: 'paired', token: row.device_token })
})

playerApi.get('/me', async (c) => {
  const device = await deviceFromToken(c.env, bearer(c))
  if (!device) throw fail(401, 'Layar tidak terdaftar')
  const [tenant, branch] = await Promise.all([
    c.env.DB.prepare('SELECT name, brand_color, logo_version FROM tenants WHERE id = ?')
      .bind(device.tenant_id)
      .first<{ name: string; brand_color: string; logo_version: number }>(),
    c.env.DB.prepare(
      `SELECT b.timezone, b.prayer_enabled, b.prayer_lat, b.prayer_lng, b.prayer_pause, b.prayer_jumat
       FROM devices d JOIN branches b ON b.id = d.branch_id WHERE d.id = ?`,
    )
      .bind(device.id)
      .first<{
        timezone: string
        prayer_enabled: number
        prayer_lat: number | null
        prayer_lng: number | null
        prayer_pause: number
        prayer_jumat: number
      }>(),
  ])
  const offset = TIMEZONES[branch?.timezone as Timezone]?.offset ?? 7
  const prayer: PrayerConfig | null =
    branch?.prayer_enabled && branch.prayer_lat !== null && branch.prayer_lng !== null
      ? { lat: branch.prayer_lat, lng: branch.prayer_lng, offset, pause: branch.prayer_pause, jumat: branch.prayer_jumat }
      : null
  return c.json({
    device: { id: device.id, name: device.name, offset },
    prayer,
    tenant: {
      name: tenant?.name ?? '',
      brandColor: tenant?.brand_color ?? '#0f766e',
      logoUrl: tenant?.logo_version ? `/media/logo/${device.tenant_id}?v=${tenant.logo_version}` : null,
    },
  })
})

function upgrade(c: Ctx, tenantId: string, deviceId?: string) {
  if (c.req.header('upgrade') !== 'websocket') throw fail(400, 'Butuh koneksi WebSocket')
  const headers = new Headers(c.req.raw.headers)
  headers.set('x-tenant-id', tenantId)
  if (deviceId) headers.set('x-device-id', deviceId)
  else headers.delete('x-device-id')
  return hub(c.env, tenantId).fetch(new Request(c.req.url, { headers }))
}

playerApi.get('/ws', async (c) => {
  const device = await deviceFromToken(c.env, c.req.query('t'))
  if (!device) throw fail(401, 'Layar tidak terdaftar')
  return upgrade(c, device.tenant_id, device.id)
})

export const dashboardWs = new Hono<AppEnv>()

dashboardWs.get('/', async (c) => {
  const session = await loadSession(c)
  if (!session || session.pending2fa) throw fail(401, 'Silakan masuk terlebih dahulu')
  // Browsers don't apply CORS to WebSocket handshakes, so the origin has to be checked by hand.
  const origin = c.req.header('origin')
  if (origin && new URL(origin).host !== new URL(c.req.url).host) throw fail(403, 'Asal permintaan ditolak')
  return upgrade(c, session.tenantId)
})

export const mediaFiles = new Hono<AppEnv>()

async function tenantOf(c: Ctx): Promise<string> {
  const device = await deviceFromToken(c.env, c.req.query('t'))
  if (device) return device.tenant_id
  const session = await loadSession(c)
  if (session && !session.pending2fa) return session.tenantId
  throw fail(401, 'Tidak sah')
}

async function serve(c: Ctx, key: string, cacheControl: string) {
  const hasRange = !!c.req.header('range')
  const object = await c.env.MEDIA.get(key, { range: c.req.raw.headers, onlyIf: c.req.raw.headers })
  if (!object) throw fail(404, 'File tidak ditemukan')

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  headers.set('accept-ranges', 'bytes')
  headers.set('cache-control', cacheControl)
  headers.set('x-content-type-options', 'nosniff')
  if (!('body' in object)) return new Response(null, { status: 304, headers })

  const range = object.range as { offset?: number; length?: number } | undefined
  if (hasRange && range) {
    const offset = range.offset ?? 0
    const length = range.length ?? object.size - offset
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${object.size}`)
    headers.set('content-length', String(length))
    return new Response(object.body, { status: 206, headers })
  }
  headers.set('content-length', String(object.size))
  return new Response(object.body, { headers })
}

mediaFiles.get('/logo/:tenantId', (c) =>
  serve(c, `t/${c.req.param('tenantId')}/logo`, 'public, max-age=31536000, immutable'),
)

mediaFiles.get('/:id/thumb', async (c) =>
  serve(c, thumbKey(await tenantOf(c), c.req.param('id')), 'private, max-age=86400'),
)

mediaFiles.get('/:id', async (c) => {
  const tenantId = await tenantOf(c)
  const row = await c.env.DB.prepare(
    "SELECT r2_key FROM media WHERE id = ? AND tenant_id = ? AND status = 'ready' AND kind = 'file'",
  )
    .bind(c.req.param('id'), tenantId)
    .first<{ r2_key: string }>()
  if (!row) throw fail(404, 'Video tidak ditemukan')
  return serve(c, row.r2_key, 'private, max-age=31536000, immutable')
})
