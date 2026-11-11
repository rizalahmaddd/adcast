import { effectivePlan, PLANS, type Plan, type PlanRules } from '../../shared/plans'
import { fail, type Ctx } from '../env'

export type TenantPlan = { id: Plan; rules: PlanRules; expiresAt: number | null }

export async function tenantPlan(db: D1Database, tenantId: string, now = Date.now()): Promise<TenantPlan> {
  const row = await db
    .prepare('SELECT plan, plan_expires_at FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first<{ plan: string; plan_expires_at: number | null }>()
  const id = effectivePlan(row?.plan ?? 'free', row?.plan_expires_at ?? null, now)
  return { id, rules: PLANS[id], expiresAt: id === 'free' ? null : (row?.plan_expires_at ?? null) }
}

const COUNTED = {
  maxDevices: { sql: 'SELECT COUNT(*) AS n FROM devices WHERE tenant_id = ?', noun: 'layar' },
  maxBranches: { sql: 'SELECT COUNT(*) AS n FROM branches WHERE tenant_id = ?', noun: 'cabang' },
  maxUsers: { sql: 'SELECT COUNT(*) AS n FROM memberships WHERE tenant_id = ?', noun: 'pengguna' },
  maxMedia: { sql: "SELECT COUNT(*) AS n FROM media WHERE tenant_id = ? AND status != 'failed'", noun: 'video' },
  maxPlaylists: { sql: 'SELECT COUNT(*) AS n FROM playlists WHERE tenant_id = ?', noun: 'playlist' },
  maxSchedules: { sql: 'SELECT COUNT(*) AS n FROM schedules WHERE tenant_id = ?', noun: 'jadwal' },
} as const
export type Counted = keyof typeof COUNTED

/** Rejects the request when the tenant already holds as many of something as its plan allows. */
export async function assertRoom(c: Ctx, what: Counted): Promise<TenantPlan> {
  const { tenantId } = c.get('auth')
  const [plan, row] = await Promise.all([
    tenantPlan(c.env.DB, tenantId),
    c.env.DB.prepare(COUNTED[what].sql).bind(tenantId).first<{ n: number }>(),
  ])
  const limit = plan.rules[what]
  if ((row?.n ?? 0) >= limit) {
    throw fail(403, `Paket ${plan.rules.label} dibatasi ${limit} ${COUNTED[what].noun}. Upgrade paket untuk menambah.`)
  }
  return plan
}

/**
 * The screens a plan covers, oldest first. A business that drops to a smaller plan keeps its
 * extra screens connected, but they stop receiving new broadcasts until it upgrades again.
 */
export async function coveredDevices(db: D1Database, tenantId: string): Promise<Set<string>> {
  const [plan, { results }] = await Promise.all([
    tenantPlan(db, tenantId),
    db.prepare('SELECT id FROM devices WHERE tenant_id = ? ORDER BY created_at, id').bind(tenantId).all<{ id: string }>(),
  ])
  return new Set(results.slice(0, plan.rules.maxDevices).map((d) => d.id))
}

export async function usage(db: D1Database, tenantId: string) {
  const keys = Object.keys(COUNTED) as Counted[]
  const [storage, ...counts] = await db.batch<{ n: number }>([
    db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM media WHERE tenant_id = ?').bind(tenantId),
    ...keys.map((k) => db.prepare(COUNTED[k].sql).bind(tenantId)),
  ])
  return {
    maxStorage: storage.results[0]?.n ?? 0,
    ...(Object.fromEntries(keys.map((k, i) => [k, counts[i].results[0]?.n ?? 0])) as Record<Counted, number>),
  }
}
