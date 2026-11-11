import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import {
  effectivePlan,
  extendedExpiry,
  ORDER_TTL,
  PAID_PLANS,
  periodOf,
  PLANS,
  priceOf,
  type Order,
  type PaidPlan,
} from '../../shared/plans'
import { qrisMerchant, qrisWithAmount } from '../../shared/qris'
import { audit, fail, readBody, type AppEnv, type Bindings } from '../env'
import { newId } from '../lib/crypto'
import { tenantPlan, usage } from '../lib/plan'
import { notifyTenant } from '../lib/push'
import { requireAuth, requirePerm } from '../session'

const app = new Hono<AppEnv>()
app.use(requireAuth)

const ORDER_COLUMNS = `o.id, o.plan, o.months, o.price, o.unique_code AS uniqueCode, o.amount, o.status, o.note,
  o.created_at AS createdAt, o.expires_at AS expiresAt, o.claimed_at AS claimedAt, o.decided_at AS decidedAt`

export const isPlatformAdmin = (env: Bindings, email: string) =>
  (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase())

// An order the payer hasn't marked as paid frees its amount after a day. Marked ones wait for a decision.
const expireStale = (db: D1Database, now: number) =>
  db
    .prepare("UPDATE orders SET status = 'expired' WHERE status = 'pending' AND claimed_at IS NULL AND expires_at < ?")
    .bind(now)
    .run()

const rupiah = (n: number) => `Rp ${n.toLocaleString('id-ID')}`

app.get('/', async (c) => {
  const { tenantId } = c.get('auth')
  const db = c.env.DB
  const now = Date.now()
  await expireStale(db, now)
  const [plan, used, orders] = await Promise.all([
    tenantPlan(db, tenantId, now),
    usage(db, tenantId),
    db
      .prepare(`SELECT ${ORDER_COLUMNS} FROM orders o WHERE o.tenant_id = ? ORDER BY o.created_at DESC LIMIT 20`)
      .bind(tenantId)
      .all<Order>(),
  ])
  const payload = c.env.QRIS_PAYLOAD ?? ''
  const open = orders.results.find((o) => o.status === 'pending')
  return c.json({
    merchant: qrisMerchant(payload),
    plan: plan.id,
    expiresAt: plan.expiresAt,
    usage: used,
    open: open ? { ...open, qris: qrisWithAmount(payload, open.amount) } : null,
    orders: orders.results,
  })
})

app.post('/orders', requirePerm('settings'), async (c) => {
  const body = await readBody(c, z.object({ plan: z.enum(PAID_PLANS as [PaidPlan, ...PaidPlan[]]), months: z.number().int() }))
  const period = periodOf(body.months)
  if (!period) throw fail(400, 'Durasi tidak tersedia')
  if (!qrisMerchant(c.env.QRIS_PAYLOAD ?? '')) throw fail(400, 'Pembayaran belum disiapkan di server ini')

  const a = c.get('auth')
  const db = c.env.DB
  const now = Date.now()
  await expireStale(db, now)
  const waiting = await db
    .prepare("SELECT 1 FROM orders WHERE tenant_id = ? AND status = 'pending' AND claimed_at IS NOT NULL")
    .bind(a.tenantId)
    .first()
  if (waiting) throw fail(409, 'Masih ada pembayaran yang menunggu konfirmasi. Tunggu hasilnya sebelum membuat pesanan baru.')
  await db
    .prepare("UPDATE orders SET status = 'cancelled', decided_at = ? WHERE tenant_id = ? AND status = 'pending'")
    .bind(now, a.tenantId)
    .run()

  const price = priceOf(body.plan, period)
  for (let attempt = 0; attempt < 8; attempt++) {
    const uniqueCode = 1 + (crypto.getRandomValues(new Uint16Array(1))[0] % 999)
    const id = newId()
    const res = await db
      .prepare(
        `INSERT OR IGNORE INTO orders (id, tenant_id, plan, months, days, price, unique_code, amount, created_by, created_by_name, created_at, expires_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(id, a.tenantId, body.plan, period.months, period.days, price, uniqueCode, price + uniqueCode, a.userId, a.userName, now, now + ORDER_TTL)
      .run()
    if (res.meta.changes) {
      audit(c, 'billing.order_created', { plan: body.plan, months: period.months, amount: price + uniqueCode })
      return c.json({ id })
    }
  }
  throw fail(409, 'Gagal membuat kode unik, coba lagi')
})

app.post('/orders/:id/claim', requirePerm('settings'), async (c) => {
  const now = Date.now()
  await expireStale(c.env.DB, now)
  const res = await c.env.DB.prepare(
    "UPDATE orders SET claimed_at = ? WHERE id = ? AND tenant_id = ? AND status = 'pending' AND claimed_at IS NULL",
  )
    .bind(now, c.req.param('id'), c.get('auth').tenantId)
    .run()
  if (!res.meta.changes) throw fail(409, 'Pesanan sudah kedaluwarsa atau sudah diproses. Buat pesanan baru.')
  audit(c, 'billing.payment_claimed')
  return c.json({ ok: true })
})

app.post('/orders/:id/cancel', requirePerm('settings'), async (c) => {
  const res = await c.env.DB.prepare(
    "UPDATE orders SET status = 'cancelled', decided_at = ? WHERE id = ? AND tenant_id = ? AND status = 'pending' AND claimed_at IS NULL",
  )
    .bind(Date.now(), c.req.param('id'), c.get('auth').tenantId)
    .run()
  if (!res.meta.changes) throw fail(409, 'Pesanan yang sudah ditandai dibayar tidak bisa dibatalkan')
  return c.json({ ok: true })
})

const requirePlatformAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const user = await c.env.DB.prepare('SELECT email FROM users WHERE id = ?')
    .bind(c.get('auth').userId)
    .first<{ email: string }>()
  if (!user || !isPlatformAdmin(c.env, user.email)) throw fail(404, 'Tidak ditemukan')
  await next()
})

app.get('/admin/orders', requirePlatformAdmin, async (c) => {
  await expireStale(c.env.DB, Date.now())
  const { results } = await c.env.DB.prepare(
    `SELECT ${ORDER_COLUMNS}, t.name AS tenantName, o.created_by_name AS createdByName
     FROM orders o JOIN tenants t ON t.id = o.tenant_id
     WHERE o.status != 'cancelled'
     ORDER BY o.status = 'pending' DESC, o.claimed_at IS NULL, o.created_at DESC LIMIT 100`,
  ).all()
  return c.json(results)
})

type OrderRow = { tenant_id: string; plan: PaidPlan; months: number; days: number; amount: number; status: string }

const openOrder = async (db: D1Database, id: string) => {
  const order = await db
    .prepare('SELECT tenant_id, plan, months, days, amount, status FROM orders WHERE id = ?')
    .bind(id)
    .first<OrderRow>()
  // A transfer can land after the order lapsed, so expired orders stay decidable.
  if (!order || !['pending', 'expired'].includes(order.status)) throw fail(409, 'Pesanan ini sudah diproses')
  return order
}

const tenantAudit = (db: D1Database, tenantId: string, action: string, detail: Record<string, unknown>, now: number) =>
  db
    .prepare('INSERT INTO audit_logs (id, tenant_id, user_name, action, detail, created_at) VALUES (?,?,?,?,?,?)')
    .bind(newId(), tenantId, 'AdCast', action, JSON.stringify(detail), now)

app.post('/admin/orders/:id/confirm', requirePlatformAdmin, async (c) => {
  const db = c.env.DB
  const id = c.req.param('id')
  const now = Date.now()
  const order = await openOrder(db, id)
  const tenant = await db
    .prepare('SELECT plan, plan_expires_at FROM tenants WHERE id = ?')
    .bind(order.tenant_id)
    .first<{ plan: string; plan_expires_at: number | null }>()
  if (!tenant) throw fail(404, 'Usaha tidak ditemukan')

  const current = { plan: effectivePlan(tenant.plan, tenant.plan_expires_at, now), expiresAt: tenant.plan_expires_at }
  const until = extendedExpiry(current, order, now)
  const [marked] = await db.batch([
    db
      .prepare("UPDATE orders SET status = 'paid', decided_at = ?, decided_by = ? WHERE id = ? AND status IN ('pending', 'expired')")
      .bind(now, c.get('auth').userId, id),
    // Guarded on the row above so a double click can't extend the plan twice.
    db
      .prepare(
        `UPDATE tenants SET plan = ?, plan_expires_at = ? WHERE id = ?
         AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = 'paid' AND decided_at = ?)`,
      )
      .bind(order.plan, until, order.tenant_id, id, now),
    tenantAudit(db, order.tenant_id, 'billing.paid', { plan: order.plan, months: order.months, amount: order.amount }, now),
  ])
  if (!marked.meta.changes) throw fail(409, 'Pesanan ini sudah diproses')

  const date = new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'Asia/Jakarta' }).format(until)
  c.executionCtx.waitUntil(
    notifyTenant(
      c.env,
      order.tenant_id,
      `Paket ${PLANS[order.plan].label} aktif`,
      `Pembayaran ${rupiah(order.amount)} sudah diterima. Paket berlaku sampai ${date}.`,
    ),
  )
  return c.json({ ok: true, expiresAt: until })
})

app.post('/admin/orders/:id/reject', requirePlatformAdmin, async (c) => {
  const { note } = await readBody(c, z.object({ note: z.string().trim().max(200).default('') }))
  const db = c.env.DB
  const id = c.req.param('id')
  const now = Date.now()
  const order = await openOrder(db, id)
  const reason = note || 'Pembayaran tidak ditemukan'
  const [marked] = await db.batch([
    db
      .prepare(
        "UPDATE orders SET status = 'rejected', note = ?, decided_at = ?, decided_by = ? WHERE id = ? AND status IN ('pending', 'expired')",
      )
      .bind(reason, now, c.get('auth').userId, id),
    tenantAudit(db, order.tenant_id, 'billing.rejected', { amount: order.amount, note: reason }, now),
  ])
  if (!marked.meta.changes) throw fail(409, 'Pesanan ini sudah diproses')
  c.executionCtx.waitUntil(
    notifyTenant(c.env, order.tenant_id, 'Pembayaran belum bisa dikonfirmasi', `${rupiah(order.amount)}: ${reason}.`),
  )
  return c.json({ ok: true })
})

export default app
