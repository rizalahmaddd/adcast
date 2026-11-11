import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { ALL_PERMISSIONS, type Permission } from '../shared/types'
import { fail, type AppEnv, type Auth, type Ctx } from './env'
import { newToken, sha256 } from './lib/crypto'

const COOKIE = 'adcast_session'
const SESSION_TTL = 30 * 86_400_000

export async function createSession(c: Ctx, userId: string, tenantId: string, pending2fa: boolean) {
  const token = newToken()
  const now = Date.now()
  await c.env.DB.prepare(
    'INSERT INTO sessions (id, user_id, tenant_id, pending_2fa, created_at, expires_at) VALUES (?,?,?,?,?,?)',
  )
    .bind(await sha256(token), userId, tenantId, pending2fa ? 1 : 0, now, now + SESSION_TTL)
    .run()
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: new URL(c.req.url).protocol === 'https:',
    path: '/',
    maxAge: SESSION_TTL / 1000,
  })
}

export async function destroySession(c: Ctx) {
  const token = getCookie(c, COOKIE)
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256(token)).run()
  deleteCookie(c, COOKIE, { path: '/' })
}

type SessionRow = {
  id: string
  user_id: string
  tenant_id: string
  pending_2fa: number
  name: string
  role_id: string | null
  permissions: string | null
  is_owner: number | null
}

export async function loadSession(c: Ctx): Promise<(Auth & { pending2fa: boolean }) | null> {
  const token = getCookie(c, COOKIE)
  if (!token) return null
  const row = await c.env.DB.prepare(
    `SELECT s.id, s.user_id, s.tenant_id, s.pending_2fa, u.name, r.id AS role_id, r.permissions, r.is_owner
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN memberships m ON m.user_id = s.user_id AND m.tenant_id = s.tenant_id
     LEFT JOIN roles r ON r.id = m.role_id
     WHERE s.id = ? AND s.expires_at > ?`,
  )
    .bind(await sha256(token), Date.now())
    .first<SessionRow>()
  if (!row || !row.role_id) return null
  const isOwner = row.is_owner === 1
  return {
    sessionId: row.id,
    userId: row.user_id,
    userName: row.name,
    tenantId: row.tenant_id,
    roleId: row.role_id,
    isOwner,
    perms: new Set(isOwner ? ALL_PERMISSIONS : (JSON.parse(row.permissions ?? '[]') as Permission[])),
    pending2fa: row.pending_2fa === 1,
  }
}

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const session = await loadSession(c)
  if (!session || session.pending2fa) throw fail(401, 'Silakan masuk terlebih dahulu')
  c.set('auth', session)
  await next()
})

export const requirePerm = (perm: Permission) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!c.get('auth').perms.has(perm)) throw fail(403, 'Peran Anda tidak punya akses untuk tindakan ini')
    await next()
  })
