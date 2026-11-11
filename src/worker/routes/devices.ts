import { Hono } from 'hono'
import { z } from 'zod'
import { DAY } from '../../shared/plans'
import { TIMEZONES, type DeviceLive, type StatsReport } from '../../shared/types'
import { audit, fail, hub, readBody, type AppEnv } from '../env'
import { newId, newToken, sha256 } from '../lib/crypto'
import { assertRoom, coveredDevices, tenantPlan } from '../lib/plan'
import { requireAuth, requirePerm } from '../session'

const app = new Hono<AppEnv>()
app.use(requireAuth)

const timezone = z.enum(Object.keys(TIMEZONES) as [keyof typeof TIMEZONES, ...(keyof typeof TIMEZONES)[]])
const name = z.string().trim().min(1).max(80)

const prayer = z
  .object({
    enabled: z.boolean(),
    city: z.string().trim().max(60).nullable(),
    lat: z.number().min(-90).max(90).nullable(),
    lng: z.number().min(-180).max(180).nullable(),
    pause: z.number().int().min(1).max(60),
    jumat: z.number().int().min(1).max(120),
  })
  .refine((p) => !p.enabled || (p.lat !== null && p.lng !== null), 'Pilih kota untuk jadwal sholat')
const NO_PRAYER = { enabled: false, city: null, lat: null, lng: null, pause: 10, jumat: 45 }
const prayerValues = (p: z.infer<typeof prayer>) => [p.enabled ? 1 : 0, p.city, p.lat, p.lng, p.pause, p.jumat]

const ticker = z
  .object({
    enabled: z.boolean(),
    text: z.string().trim().max(200).nullable(),
    speed: z.number().int().min(20).max(600),
    bg: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  })
  .refine((t) => !t.enabled || !!t.text, 'Isi teks berjalan atau matikan pilihannya')
const NO_TICKER = { enabled: false, text: null, speed: 120, bg: '#000000' }
const tickerValues = (t: z.infer<typeof ticker>) => [t.enabled ? 1 : 0, t.text, t.speed, t.bg.toLowerCase()]

const rotation = z.union([z.literal(0), z.literal(90), z.literal(270)])

type BranchRow = {
  id: string
  name: string
  timezone: string
  prayer_enabled: number
  prayer_city: string | null
  prayer_lat: number | null
  prayer_lng: number | null
  prayer_pause: number
  prayer_jumat: number
  ticker_enabled: number
  ticker_text: string | null
  ticker_speed: number
  ticker_bg: string
}

app.get('/branches', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, timezone, prayer_enabled, prayer_city, prayer_lat, prayer_lng, prayer_pause, prayer_jumat,
            ticker_enabled, ticker_text, ticker_speed, ticker_bg
     FROM branches WHERE tenant_id = ? ORDER BY created_at`,
  )
    .bind(c.get('auth').tenantId)
    .all<BranchRow>()
  return c.json(
    results.map((b) => ({
      id: b.id,
      name: b.name,
      timezone: b.timezone,
      prayer: {
        enabled: b.prayer_enabled === 1,
        city: b.prayer_city,
        lat: b.prayer_lat,
        lng: b.prayer_lng,
        pause: b.prayer_pause,
        jumat: b.prayer_jumat,
      },
      ticker: {
        enabled: b.ticker_enabled === 1,
        text: b.ticker_text,
        speed: b.ticker_speed,
        bg: b.ticker_bg,
      },
    })),
  )
})

app.post('/branches', requirePerm('device'), async (c) => {
  const body = await readBody(
    c,
    z.object({ name, timezone, prayer: prayer.default(NO_PRAYER), ticker: ticker.default(NO_TICKER) }),
  )
  await assertRoom(c, 'maxBranches')
  const id = newId()
  await c.env.DB.prepare(
    `INSERT INTO branches (id, tenant_id, name, timezone, created_at, prayer_enabled, prayer_city, prayer_lat, prayer_lng, prayer_pause, prayer_jumat,
                           ticker_enabled, ticker_text, ticker_speed, ticker_bg)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      id,
      c.get('auth').tenantId,
      body.name,
      body.timezone,
      Date.now(),
      ...prayerValues(body.prayer),
      ...tickerValues(body.ticker),
    )
    .run()
  audit(c, 'branch.created', { name: body.name })
  return c.json({ id })
})

app.patch('/branches/:id', requirePerm('device'), async (c) => {
  const body = await readBody(
    c,
    z.object({ name, timezone, prayer: prayer.optional(), ticker: ticker.optional() }),
  )
  const { tenantId } = c.get('auth')
  await c.env.DB.prepare('UPDATE branches SET name = ?, timezone = ? WHERE id = ? AND tenant_id = ?')
    .bind(body.name, body.timezone, c.req.param('id'), tenantId)
    .run()
  if (body.prayer) {
    await c.env.DB.prepare(
      `UPDATE branches SET prayer_enabled = ?, prayer_city = ?, prayer_lat = ?, prayer_lng = ?, prayer_pause = ?, prayer_jumat = ?
       WHERE id = ? AND tenant_id = ?`,
    )
      .bind(...prayerValues(body.prayer), c.req.param('id'), tenantId)
      .run()
  }
  if (body.ticker) {
    await c.env.DB.prepare(
      'UPDATE branches SET ticker_enabled = ?, ticker_text = ?, ticker_speed = ?, ticker_bg = ? WHERE id = ? AND tenant_id = ?',
    )
      .bind(...tickerValues(body.ticker), c.req.param('id'), tenantId)
      .run()
  }
  // Timezone changes move schedule fire times, and TVs keep their own copy of the prayer settings.
  await hub(c.env, tenantId).schedulesChanged(tenantId)
  await hub(c.env, tenantId).refreshPlayers()
  audit(c, 'branch.updated', { name: body.name })
  return c.json({ ok: true })
})

app.delete('/branches/:id', requirePerm('device'), async (c) => {
  const { tenantId } = c.get('auth')
  const id = c.req.param('id')
  const used = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM devices WHERE branch_id = ? AND tenant_id = ?')
    .bind(id, tenantId)
    .first<{ n: number }>()
  if (used?.n) throw fail(409, 'Pindahkan dulu layar di cabang ini sebelum menghapusnya')
  const left = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM branches WHERE tenant_id = ?')
    .bind(tenantId)
    .first<{ n: number }>()
  if ((left?.n ?? 0) <= 1) throw fail(409, 'Minimal harus ada satu cabang')
  await c.env.DB.prepare('DELETE FROM branches WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run()
  audit(c, 'branch.deleted', { id })
  return c.json({ ok: true })
})

app.get('/devices', async (c) => {
  const { tenantId } = c.get('auth')
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, branch_id AS branchId, rotation, created_at AS createdAt
     FROM devices WHERE tenant_id = ? ORDER BY name`,
  )
    .bind(tenantId)
    .all<{ id: string; name: string; branchId: string; rotation: number; createdAt: number }>()
  const [live, covered] = await Promise.all([
    results.length ? hub(c.env, tenantId).snapshot(results.map((d) => d.id)) : ({} as Record<string, DeviceLive>),
    coveredDevices(c.env.DB, tenantId),
  ])
  return c.json(results.map((d) => ({ ...d, covered: covered.has(d.id), live: live[d.id] })))
})

app.post('/devices/pair', requirePerm('device'), async (c) => {
  const body = await readBody(c, z.object({ code: z.string().trim().toUpperCase().length(6), name, branchId: z.string() }))
  const { tenantId } = c.get('auth')
  const db = c.env.DB

  const pairing = await db
    .prepare('SELECT code FROM pairings WHERE code = ? AND device_id IS NULL AND expires_at > ?')
    .bind(body.code, Date.now())
    .first()
  if (!pairing) throw fail(404, 'Kode tidak ditemukan atau sudah kedaluwarsa. Cek kode di layar TV.')

  const branch = await db.prepare('SELECT 1 FROM branches WHERE id = ? AND tenant_id = ?').bind(body.branchId, tenantId).first()
  if (!branch) throw fail(400, 'Cabang tidak ditemukan')
  await assertRoom(c, 'maxDevices')

  const id = newId()
  const token = newToken()
  await db.batch([
    db
      .prepare('INSERT INTO devices (id, tenant_id, branch_id, name, token_hash, created_at) VALUES (?,?,?,?,?,?)')
      .bind(id, tenantId, body.branchId, body.name, await sha256(token), Date.now()),
    // The TV picks the token up once on its next poll, then the row is deleted.
    db.prepare('UPDATE pairings SET device_id = ?, device_token = ? WHERE code = ?').bind(id, token, body.code),
  ])
  audit(c, 'device.paired', { name: body.name })
  return c.json({ id })
})

app.patch('/devices/:id', requirePerm('device'), async (c) => {
  const body = await readBody(c, z.object({ name, branchId: z.string(), rotation: rotation.optional() }))
  const { tenantId } = c.get('auth')
  const branch = await c.env.DB.prepare('SELECT 1 FROM branches WHERE id = ? AND tenant_id = ?')
    .bind(body.branchId, tenantId)
    .first()
  if (!branch) throw fail(400, 'Cabang tidak ditemukan')
  await c.env.DB.prepare(
    'UPDATE devices SET name = ?, branch_id = ?, rotation = COALESCE(?, rotation) WHERE id = ? AND tenant_id = ?',
  )
    .bind(body.name, body.branchId, body.rotation ?? null, c.req.param('id'), tenantId)
    .run()
  await hub(c.env, tenantId).refreshPlayers()
  audit(c, 'device.updated', { name: body.name })
  return c.json({ ok: true })
})

app.delete('/devices/:id', requirePerm('device'), async (c) => {
  const { tenantId } = c.get('auth')
  const id = c.req.param('id')
  const res = await c.env.DB.prepare('DELETE FROM devices WHERE id = ? AND tenant_id = ? RETURNING name')
    .bind(id, tenantId)
    .first<{ name: string }>()
  if (!res) throw fail(404, 'Layar tidak ditemukan')
  await hub(c.env, tenantId).forget(id)
  audit(c, 'device.deleted', { name: res.name })
  return c.json({ ok: true })
})

const dayOf = (ms: number, offset: number) => new Date(ms + offset * 3_600_000).toISOString().slice(0, 10)

app.get('/stats', async (c) => {
  const { tenantId } = c.get('auth')
  const plan = await tenantPlan(c.env.DB, tenantId)
  const maxDays = plan.rules.statsDays
  const days = Math.max(1, Math.min(maxDays, Number(c.req.query('days')) || 7))
  const now = Date.now()
  // Days are counted on the WIB calendar; a WIT screen can already be a day ahead, hence the +2 hours.
  const range = Array.from({ length: days }, (_, i) => dayOf(now - (days - 1 - i) * DAY, 7))
  const ahead = dayOf(now, 9)
  if (ahead !== range.at(-1)) range.push(ahead)

  const raw = await hub(c.env, tenantId).stats(range[0])
  const ids = [...new Set(raw.plays.map((p) => p.media_id))].slice(0, 500)
  const media: StatsReport['media'] = {}
  // D1 caps bound parameters per statement, so titles are looked up in slices.
  for (let i = 0; i < ids.length; i += 80) {
    const slice = ids.slice(i, i + 80)
    const { results } = await c.env.DB.prepare(
      `SELECT id, title, kind, mime, duration FROM media WHERE tenant_id = ? AND id IN (${slice.map(() => '?').join(',')})`,
    )
      .bind(tenantId, ...slice)
      .all<{ id: string; title: string; kind: string; mime: string | null; duration: number | null }>()
    for (const m of results) {
      media[m.id] = {
        title: m.title,
        kind: m.kind === 'youtube' ? 'youtube' : m.mime?.startsWith('image/') ? 'image' : 'file',
        duration: m.duration,
      }
    }
  }

  const up: StatsReport['up'] = {}
  for (const row of raw.up) (up[row.device_id] ??= {})[row.day] = row.seconds
  const report: StatsReport = {
    days,
    maxDays,
    range,
    up,
    plays: raw.plays.map((p) => ({ deviceId: p.device_id, day: p.day, mediaId: p.media_id, seconds: p.seconds })),
    media,
  }
  return c.json(report)
})

export default app
