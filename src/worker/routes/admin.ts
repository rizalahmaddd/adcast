import { Hono } from 'hono'
import { z } from 'zod'
import { ALL_PERMISSIONS } from '../../shared/types'
import { audit, fail, readBody, type AppEnv } from '../env'
import { hashPassword, newId } from '../lib/crypto'
import { assertRoom, tenantPlan } from '../lib/plan'
import { requireAuth, requirePerm } from '../session'

const app = new Hono<AppEnv>()
app.use(requireAuth)

const name = z.string().trim().min(1).max(80)
const permissions = z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]]))

app.get('/roles', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, permissions, is_owner FROM roles WHERE tenant_id = ? ORDER BY created_at, name',
  )
    .bind(c.get('auth').tenantId)
    .all<{ id: string; name: string; permissions: string; is_owner: number }>()
  return c.json(
    results.map((r) => ({
      id: r.id,
      name: r.name,
      isOwner: r.is_owner === 1,
      permissions: r.is_owner ? ALL_PERMISSIONS : JSON.parse(r.permissions),
    })),
  )
})

app.post('/roles', requirePerm('user'), async (c) => {
  const body = await readBody(c, z.object({ name, permissions }))
  const id = newId()
  await c.env.DB.prepare('INSERT INTO roles (id, tenant_id, name, permissions, created_at) VALUES (?,?,?,?,?)')
    .bind(id, c.get('auth').tenantId, body.name, JSON.stringify(body.permissions), Date.now())
    .run()
  audit(c, 'role.created', { name: body.name })
  return c.json({ id })
})

app.put('/roles/:id', requirePerm('user'), async (c) => {
  const body = await readBody(c, z.object({ name, permissions }))
  const res = await c.env.DB.prepare(
    'UPDATE roles SET name = ?, permissions = ? WHERE id = ? AND tenant_id = ? AND is_owner = 0',
  )
    .bind(body.name, JSON.stringify(body.permissions), c.req.param('id'), c.get('auth').tenantId)
    .run()
  if (!res.meta.changes) throw fail(400, 'Peran Pemilik tidak bisa diubah')
  audit(c, 'role.updated', { name: body.name, permissions: body.permissions })
  return c.json({ ok: true })
})

app.delete('/roles/:id', requirePerm('user'), async (c) => {
  const { tenantId } = c.get('auth')
  const id = c.req.param('id')
  const used = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM memberships WHERE role_id = ? AND tenant_id = ?')
    .bind(id, tenantId)
    .first<{ n: number }>()
  if (used?.n) throw fail(409, 'Peran masih dipakai pengguna')
  const res = await c.env.DB.prepare('DELETE FROM roles WHERE id = ? AND tenant_id = ? AND is_owner = 0')
    .bind(id, tenantId)
    .run()
  if (!res.meta.changes) throw fail(400, 'Peran Pemilik tidak bisa dihapus')
  audit(c, 'role.deleted', { id })
  return c.json({ ok: true })
})

app.get('/users', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.totp_enabled AS totpEnabled, m.role_id AS roleId
     FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.tenant_id = ? ORDER BY m.created_at`,
  )
    .bind(c.get('auth').tenantId)
    .all()
  return c.json(results)
})

async function assignableRole(db: D1Database, tenantId: string, roleId: string, actorIsOwner: boolean) {
  const role = await db
    .prepare('SELECT is_owner FROM roles WHERE id = ? AND tenant_id = ?')
    .bind(roleId, tenantId)
    .first<{ is_owner: number }>()
  if (!role) throw fail(400, 'Peran tidak ditemukan')
  if (role.is_owner && !actorIsOwner) throw fail(403, 'Hanya Pemilik yang bisa memberikan peran Pemilik')
}

app.post('/users', requirePerm('user'), async (c) => {
  const body = await readBody(
    c,
    z.object({
      name,
      email: z.email().max(200),
      // Optional: without one the person signs in with Google using this email.
      password: z.string().min(8).max(200).optional(),
      roleId: z.string(),
    }),
  )
  const a = c.get('auth')
  const db = c.env.DB
  const email = body.email.toLowerCase()
  await assignableRole(db, a.tenantId, body.roleId, a.isOwner)

  const now = Date.now()
  let user = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>()
  if (user) {
    const member = await db
      .prepare('SELECT 1 FROM memberships WHERE tenant_id = ? AND user_id = ?')
      .bind(a.tenantId, user.id)
      .first()
    if (member) throw fail(409, 'Pengguna ini sudah terdaftar di usaha Anda')
  }
  await assertRoom(c, 'maxUsers')
  if (!user) {
    if (!body.password && !(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET)) {
      throw fail(400, 'Kata sandi awal wajib diisi')
    }
    user = { id: newId() }
    await db
      .prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?,?,?,?,?)')
      .bind(user.id, email, body.name, body.password ? await hashPassword(body.password) : '', now)
      .run()
  }
  await db
    .prepare('INSERT INTO memberships (tenant_id, user_id, role_id, created_at) VALUES (?,?,?,?)')
    .bind(a.tenantId, user.id, body.roleId, now)
    .run()
  audit(c, 'user.added', { email })
  return c.json({ id: user.id })
})

async function guardOwner(db: D1Database, tenantId: string, userId: string, actorIsOwner: boolean) {
  const current = await db
    .prepare(
      'SELECT r.is_owner FROM memberships m JOIN roles r ON r.id = m.role_id WHERE m.tenant_id = ? AND m.user_id = ?',
    )
    .bind(tenantId, userId)
    .first<{ is_owner: number }>()
  if (!current) throw fail(404, 'Pengguna tidak ditemukan')
  if (!current.is_owner) return
  if (!actorIsOwner) throw fail(403, 'Hanya Pemilik yang bisa mengubah Pemilik lain')
  const owners = await db
    .prepare(
      'SELECT COUNT(*) AS n FROM memberships m JOIN roles r ON r.id = m.role_id WHERE m.tenant_id = ? AND r.is_owner = 1',
    )
    .bind(tenantId)
    .first<{ n: number }>()
  if ((owners?.n ?? 0) <= 1) throw fail(409, 'Usaha harus punya minimal satu Pemilik')
}

app.patch('/users/:id', requirePerm('user'), async (c) => {
  const body = await readBody(c, z.object({ roleId: z.string() }))
  const a = c.get('auth')
  const userId = c.req.param('id')
  await assignableRole(c.env.DB, a.tenantId, body.roleId, a.isOwner)
  await guardOwner(c.env.DB, a.tenantId, userId, a.isOwner)
  await c.env.DB.prepare('UPDATE memberships SET role_id = ? WHERE tenant_id = ? AND user_id = ?')
    .bind(body.roleId, a.tenantId, userId)
    .run()
  audit(c, 'user.role_changed', { userId })
  return c.json({ ok: true })
})

app.delete('/users/:id', requirePerm('user'), async (c) => {
  const a = c.get('auth')
  const userId = c.req.param('id')
  if (userId === a.userId) throw fail(400, 'Anda tidak bisa menghapus akun sendiri')
  await guardOwner(c.env.DB, a.tenantId, userId, a.isOwner)
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM memberships WHERE tenant_id = ? AND user_id = ?').bind(a.tenantId, userId),
    c.env.DB.prepare('DELETE FROM sessions WHERE tenant_id = ? AND user_id = ?').bind(a.tenantId, userId),
    c.env.DB.prepare('DELETE FROM push_subscriptions WHERE tenant_id = ? AND user_id = ?').bind(a.tenantId, userId),
  ])
  audit(c, 'user.removed', { userId })
  return c.json({ ok: true })
})

const BRANDING_LOCKED = 'Logo dan warna usaha sendiri tersedia di paket berbayar'

app.patch('/tenant', requirePerm('settings'), async (c) => {
  const body = await readBody(
    c,
    z.object({
      name: z.string().trim().min(2).max(80),
      brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      alertThreshold: z.number().int().min(1).max(1000),
    }),
  )
  const { tenantId } = c.get('auth')
  const brandColor = body.brandColor.toLowerCase()
  const [plan, current] = await Promise.all([
    tenantPlan(c.env.DB, tenantId),
    c.env.DB.prepare('SELECT brand_color FROM tenants WHERE id = ?').bind(tenantId).first<{ brand_color: string }>(),
  ])
  if (!plan.rules.branding && brandColor !== current?.brand_color) throw fail(403, BRANDING_LOCKED)
  await c.env.DB.prepare('UPDATE tenants SET name = ?, brand_color = ?, alert_threshold = ? WHERE id = ?')
    .bind(body.name, brandColor, body.alertThreshold, tenantId)
    .run()
  audit(c, 'settings.updated', body)
  return c.json({ ok: true })
})

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp']

app.put('/tenant/logo', requirePerm('settings'), async (c) => {
  const type = c.req.header('content-type') ?? ''
  // SVG is left out on purpose: it can carry script and the logo is served from our origin.
  if (!LOGO_TYPES.includes(type)) throw fail(400, 'Logo harus berupa PNG, JPG, atau WebP')
  const data = await c.req.arrayBuffer()
  if (!data.byteLength || data.byteLength > 512 * 1024) throw fail(413, 'Ukuran logo maksimal 512 KB')
  const { tenantId } = c.get('auth')
  if (!(await tenantPlan(c.env.DB, tenantId)).rules.branding) throw fail(403, BRANDING_LOCKED)
  await c.env.MEDIA.put(`t/${tenantId}/logo`, data, { httpMetadata: { contentType: type } })
  await c.env.DB.prepare('UPDATE tenants SET logo_version = ? WHERE id = ?').bind(Date.now(), tenantId).run()
  audit(c, 'settings.logo_updated')
  return c.json({ ok: true })
})

app.delete('/tenant/logo', requirePerm('settings'), async (c) => {
  const { tenantId } = c.get('auth')
  await c.env.MEDIA.delete(`t/${tenantId}/logo`)
  await c.env.DB.prepare('UPDATE tenants SET logo_version = 0 WHERE id = ?').bind(tenantId).run()
  return c.json({ ok: true })
})

app.get('/audit', requirePerm('audit'), async (c) => {
  const before = Number(c.req.query('before')) || Date.now() + 1
  const { results } = await c.env.DB.prepare(
    `SELECT id, user_name AS userName, action, detail, created_at AS createdAt
     FROM audit_logs WHERE tenant_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT 50`,
  )
    .bind(c.get('auth').tenantId, before)
    .all()
  return c.json(results)
})

app.get('/notifications', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, title, body, created_at AS createdAt FROM notifications WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 20',
  )
    .bind(c.get('auth').tenantId)
    .all()
  return c.json(results)
})

app.post('/push/subscribe', async (c) => {
  const { endpoint } = await readBody(c, z.object({ endpoint: z.url().startsWith('https://').max(1000) }))
  const a = c.get('auth')
  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (endpoint, tenant_id, user_id, created_at) VALUES (?,?,?,?)
     ON CONFLICT(endpoint) DO UPDATE SET tenant_id = excluded.tenant_id, user_id = excluded.user_id`,
  )
    .bind(endpoint, a.tenantId, a.userId, Date.now())
    .run()
  return c.json({ ok: true })
})

app.post('/push/unsubscribe', async (c) => {
  const { endpoint } = await readBody(c, z.object({ endpoint: z.string().max(1000) }))
  await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?')
    .bind(endpoint, c.get('auth').userId)
    .run()
  return c.json({ ok: true })
})

export default app
