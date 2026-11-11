import { Hono } from 'hono'
import { z } from 'zod'
import type { Cmd } from '../../shared/types'
import { audit, fail, hub, readBody, type AppEnv, type Ctx } from '../env'
import { resolveContent, resolveTarget } from '../lib/content'
import { newId } from '../lib/crypto'
import { assertRoom } from '../lib/plan'
import { requireAuth, requirePerm } from '../session'

const app = new Hono<AppEnv>()
app.use(requireAuth)

const name = z.string().trim().min(1).max(120)
const target = z.object({ type: z.enum(['all', 'branch', 'device']), ids: z.array(z.string()).max(1000) })
const content = { contentType: z.enum(['media', 'playlist']), contentId: z.string() }

app.get('/playlists', async (c) => {
  const { tenantId } = c.get('auth')
  const [lists, items] = await Promise.all([
    c.env.DB.prepare('SELECT id, name FROM playlists WHERE tenant_id = ? ORDER BY created_at DESC').bind(tenantId).all<{
      id: string
      name: string
    }>(),
    c.env.DB.prepare(
      `SELECT i.playlist_id AS playlistId, i.media_id AS mediaId
       FROM playlist_items i JOIN playlists p ON p.id = i.playlist_id
       WHERE p.tenant_id = ? ORDER BY i.playlist_id, i.position`,
    )
      .bind(tenantId)
      .all<{ playlistId: string; mediaId: string }>(),
  ])
  return c.json(
    lists.results.map((p) => ({
      ...p,
      mediaIds: items.results.filter((i) => i.playlistId === p.id).map((i) => i.mediaId),
    })),
  )
})

const playlistBody = z.object({ name, mediaIds: z.array(z.string()).max(200) })

async function savePlaylist(c: Ctx, id: string, body: z.infer<typeof playlistBody>, isNew: boolean) {
  const { tenantId } = c.get('auth')
  const db = c.env.DB
  if (body.mediaIds.length) {
    const marks = body.mediaIds.map(() => '?').join(',')
    const { results } = await db
      .prepare(`SELECT id FROM media WHERE tenant_id = ? AND id IN (${marks})`)
      .bind(tenantId, ...body.mediaIds)
      .all<{ id: string }>()
    const known = new Set(results.map((r) => r.id))
    if (body.mediaIds.some((m) => !known.has(m))) throw fail(400, 'Ada video yang tidak ditemukan')
  }
  await db.batch([
    isNew
      ? db
          .prepare('INSERT INTO playlists (id, tenant_id, name, created_at) VALUES (?,?,?,?)')
          .bind(id, tenantId, body.name, Date.now())
      : db.prepare('UPDATE playlists SET name = ? WHERE id = ? AND tenant_id = ?').bind(body.name, id, tenantId),
    db.prepare('DELETE FROM playlist_items WHERE playlist_id = ?').bind(id),
    ...body.mediaIds.map((mediaId, position) =>
      db.prepare('INSERT INTO playlist_items (playlist_id, media_id, position) VALUES (?,?,?)').bind(id, mediaId, position),
    ),
  ])
}

app.post('/playlists', requirePerm('playlist'), async (c) => {
  const body = await readBody(c, playlistBody)
  await assertRoom(c, 'maxPlaylists')
  const id = newId()
  await savePlaylist(c, id, body, true)
  audit(c, 'playlist.created', { name: body.name })
  return c.json({ id })
})

app.put('/playlists/:id', requirePerm('playlist'), async (c) => {
  const body = await readBody(c, playlistBody)
  const id = c.req.param('id')
  const owned = await c.env.DB.prepare('SELECT 1 FROM playlists WHERE id = ? AND tenant_id = ?')
    .bind(id, c.get('auth').tenantId)
    .first()
  if (!owned) throw fail(404, 'Playlist tidak ditemukan')
  await savePlaylist(c, id, body, false)
  audit(c, 'playlist.updated', { name: body.name })
  return c.json({ ok: true })
})

app.delete('/playlists/:id', requirePerm('playlist'), async (c) => {
  const { tenantId } = c.get('auth')
  const id = c.req.param('id')
  const inSchedule = await c.env.DB.prepare(
    "SELECT name FROM schedules WHERE tenant_id = ? AND content_type = 'playlist' AND content_id = ? LIMIT 1",
  )
    .bind(tenantId, id)
    .first<{ name: string }>()
  if (inSchedule) throw fail(409, `Playlist masih dipakai jadwal "${inSchedule.name}"`)
  const row = await c.env.DB.prepare('DELETE FROM playlists WHERE id = ? AND tenant_id = ? RETURNING name')
    .bind(id, tenantId)
    .first<{ name: string }>()
  if (row) audit(c, 'playlist.deleted', { name: row.name })
  return c.json({ ok: true })
})

app.post('/broadcasts', requirePerm('broadcast'), async (c) => {
  const body = await readBody(c, z.object({ ...content, target }))
  const { tenantId } = c.get('auth')
  const [resolved, devices] = await Promise.all([
    resolveContent(c.env.DB, tenantId, body.contentType, body.contentId),
    resolveTarget(c.env.DB, tenantId, body.target, true),
  ])
  if (!resolved) throw fail(404, 'Tayangan tidak ditemukan')
  if (!resolved.items.length) {
    throw resolved.withheld
      ? fail(403, 'Video hasil upload hanya bisa ditayangkan di paket berbayar. Perpanjang paket untuk menayangkannya lagi.')
      : fail(400, 'Playlist ini belum berisi video yang siap diputar')
  }
  if (!devices.length) throw fail(400, 'Tidak ada layar pada tujuan yang dipilih yang tercakup paket Anda')

  const cmd: Cmd = {
    id: newId(),
    name: resolved.name,
    items: resolved.items,
    // A few seconds of lead time lets every TV buffer and start on the same tick.
    startAt: Date.now() + 4000,
    paused: false,
  }
  await hub(c.env, tenantId).dispatch(tenantId, devices.map((d) => d.id), cmd)
  audit(c, 'broadcast.sent', { name: resolved.name, target: body.target.type, screens: devices.length })
  return c.json({ screens: devices.length })
})

app.post('/broadcasts/control', requirePerm('broadcast'), async (c) => {
  const body = await readBody(c, z.object({ action: z.enum(['pause', 'resume', 'stop']), target }))
  const { tenantId } = c.get('auth')
  const devices = await resolveTarget(c.env.DB, tenantId, body.target)
  if (!devices.length) throw fail(400, 'Tidak ada layar pada tujuan yang dipilih')
  await hub(c.env, tenantId).control(devices.map((d) => d.id), body.action)
  audit(c, `broadcast.${body.action}`, { target: body.target.type, screens: devices.length })
  return c.json({ screens: devices.length })
})

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const scheduleBody = z.object({
  name,
  ...content,
  target,
  days: z.array(z.number().int().min(0).max(6)).min(1),
  startTime: time,
  endTime: time.nullable(),
  enabled: z.boolean(),
})

app.get('/schedules', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, content_type AS contentType, content_id AS contentId, target_type, target_ids, days,
            start_time AS startTime, end_time AS endTime, enabled
     FROM schedules WHERE tenant_id = ? ORDER BY start_time`,
  )
    .bind(c.get('auth').tenantId)
    .all<Record<string, string | number | null>>()
  return c.json(
    results.map(({ target_type, target_ids, days, enabled, ...rest }) => ({
      ...rest,
      target: { type: target_type, ids: JSON.parse(target_ids as string) },
      days: JSON.parse(days as string),
      enabled: enabled === 1,
    })),
  )
})

async function saveSchedule(c: Ctx, id: string | null) {
  const body = await readBody(c, scheduleBody)
  const { tenantId } = c.get('auth')
  if (body.endTime === body.startTime) throw fail(400, 'Jam selesai harus berbeda dari jam mulai')
  if (!(await resolveContent(c.env.DB, tenantId, body.contentType, body.contentId))) {
    throw fail(400, 'Tayangan tidak ditemukan')
  }
  const values = [
    body.name,
    body.contentType,
    body.contentId,
    body.target.type,
    JSON.stringify(body.target.ids),
    JSON.stringify([...new Set(body.days)].sort()),
    body.startTime,
    body.endTime,
    body.enabled ? 1 : 0,
  ]
  const newScheduleId = id ?? newId()
  if (!id) await assertRoom(c, 'maxSchedules')
  if (id) {
    const res = await c.env.DB.prepare(
      `UPDATE schedules SET name = ?, content_type = ?, content_id = ?, target_type = ?, target_ids = ?, days = ?,
       start_time = ?, end_time = ?, enabled = ? WHERE id = ? AND tenant_id = ?`,
    )
      .bind(...values, id, tenantId)
      .run()
    if (!res.meta.changes) throw fail(404, 'Jadwal tidak ditemukan')
  } else {
    await c.env.DB.prepare(
      `INSERT INTO schedules (name, content_type, content_id, target_type, target_ids, days, start_time, end_time, enabled, id, tenant_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
      .bind(...values, newScheduleId, tenantId, Date.now())
      .run()
  }
  await hub(c.env, tenantId).schedulesChanged(tenantId)
  audit(c, id ? 'schedule.updated' : 'schedule.created', { name: body.name })
  return c.json({ id: newScheduleId })
}

app.post('/schedules', requirePerm('schedule'), (c) => saveSchedule(c, null))
app.put('/schedules/:id', requirePerm('schedule'), (c) => saveSchedule(c, c.req.param('id')))

app.delete('/schedules/:id', requirePerm('schedule'), async (c) => {
  const { tenantId } = c.get('auth')
  const row = await c.env.DB.prepare('DELETE FROM schedules WHERE id = ? AND tenant_id = ? RETURNING name')
    .bind(c.req.param('id'), tenantId)
    .first<{ name: string }>()
  await hub(c.env, tenantId).schedulesChanged(tenantId)
  if (row) audit(c, 'schedule.deleted', { name: row.name })
  return c.json({ ok: true })
})

export default app
