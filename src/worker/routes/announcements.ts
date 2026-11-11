import { Hono } from 'hono'
import { z } from 'zod'
import { audit, fail, hub, readBody, type AppEnv, type Ctx } from '../env'
import { resolveTarget } from '../lib/content'
import { newId } from '../lib/crypto'
import { tenantPlan } from '../lib/plan'
import { requireAuth, requirePerm } from '../session'

const app = new Hono<AppEnv>()
app.use(requireAuth)

const target = z.object({ type: z.enum(['all', 'branch', 'device']), ids: z.array(z.string()).max(1000) })
const body = z.object({
  text: z.string().trim().min(1).max(400),
  bg: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  target,
})

type Row = {
  id: string
  text: string
  bg: string
  target_type: 'all' | 'branch' | 'device'
  target_ids: string
  created_at: number
  created_by_name: string | null
}

app.get('/', async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT id, text, bg, target_type, target_ids, created_at, created_by_name
     FROM announcements WHERE tenant_id = ?`,
  )
    .bind(c.get('auth').tenantId)
    .first<Row>()
  if (!row) return c.json(null)
  return c.json({
    id: row.id,
    text: row.text,
    bg: row.bg,
    target: { type: row.target_type, ids: JSON.parse(row.target_ids) as string[] },
    createdAt: row.created_at,
    createdByName: row.created_by_name,
  })
})

app.post('/', requirePerm('broadcast'), async (c) => {
  const input = await readBody(c, body)
  const a = c.get('auth')
  await assertAnnouncementPlan(c)
  if (input.target.type !== 'all' && !input.target.ids.length) throw fail(400, 'Pilih layar atau cabang tujuan')

  const devices = await resolveTarget(c.env.DB, a.tenantId, input.target)
  if (!devices.length) throw fail(400, 'Tidak ada layar pada tujuan yang dipilih')

  const id = newId()
  const bg = input.bg.toLowerCase()
  await c.env.DB.prepare(
    `INSERT INTO announcements (tenant_id, id, text, bg, target_type, target_ids, created_at, created_by, created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(tenant_id) DO UPDATE SET
       id = excluded.id, text = excluded.text, bg = excluded.bg, target_type = excluded.target_type,
       target_ids = excluded.target_ids, created_at = excluded.created_at,
       created_by = excluded.created_by, created_by_name = excluded.created_by_name`,
  )
    .bind(
      a.tenantId,
      id,
      input.text,
      bg,
      input.target.type,
      JSON.stringify(input.target.ids),
      Date.now(),
      a.userId,
      a.userName,
    )
    .run()
  await hub(c.env, a.tenantId).announcementsChanged(a.tenantId)
  audit(c, 'announcement.sent', { screens: devices.length, target: input.target.type })
  return c.json({ screens: devices.length })
})

// Clearing is always allowed: a plan that lapses while an announcement is up must not leave TVs stuck on it.
app.delete('/', requirePerm('broadcast'), async (c) => {
  const a = c.get('auth')
  const row = await c.env.DB.prepare('DELETE FROM announcements WHERE tenant_id = ? RETURNING id')
    .bind(a.tenantId)
    .first<{ id: string }>()
  await hub(c.env, a.tenantId).announcementsChanged(a.tenantId)
  if (row) audit(c, 'announcement.cleared')
  return c.json({ ok: true })
})

async function assertAnnouncementPlan(c: Ctx) {
  const plan = await tenantPlan(c.env.DB, c.get('auth').tenantId)
  if (plan.id === 'free') throw fail(403, 'Pengumuman darurat tersedia mulai paket Pro')
}

export default app
