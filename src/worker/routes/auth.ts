import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import { DAY, effectivePlan, PLANS, PURGE_AFTER_DAYS, TRIAL_DAYS } from '../../shared/plans'
import { qrisMerchant } from '../../shared/qris'
import { ALL_PERMISSIONS, type Permission } from '../../shared/types'
import { audit, fail, readBody, type AppEnv, type Ctx } from '../env'
import { fromB64url, hashPassword, newId, newToken, newTotpSecret, verifyPassword, verifyTotp } from '../lib/crypto'
import { createSession, destroySession, loadSession, requireAuth } from '../session'
import { isPlatformAdmin } from './billing'

const app = new Hono<AppEnv>()

const password = z.string().min(8, 'Kata sandi minimal 8 karakter').max(200)

const DEFAULT_ROLES: { name: string; permissions: Permission[]; owner?: boolean }[] = [
  { name: 'Pemilik', permissions: ALL_PERMISSIONS, owner: true },
  { name: 'Admin', permissions: ALL_PERMISSIONS },
  { name: 'Operator', permissions: ['broadcast', 'media', 'playlist', 'schedule'] },
  { name: 'Pemantau', permissions: [] },
]

app.post('/register', async (c) => {
  const body = await readBody(
    c,
    z.object({
      businessName: z.string().trim().min(2).max(80),
      name: z.string().trim().min(2).max(80),
      email: z.email().max(200),
      password,
    }),
  )
  const email = body.email.toLowerCase()
  const db = c.env.DB
  if (await db.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first()) {
    throw fail(409, 'Email sudah terdaftar')
  }

  const userId = newId()
  const tenantId = newId()
  await db.batch([
    db
      .prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?,?,?,?,?)')
      .bind(userId, email, body.name, await hashPassword(body.password), Date.now()),
    ...newTenant(db, tenantId, userId, body.businessName),
  ])
  await createSession(c, userId, tenantId, false)
  return c.json({ ok: true })
})

function newTenant(db: D1Database, tenantId: string, ownerId: string, businessName: string) {
  const now = Date.now()
  const roles = DEFAULT_ROLES.map((r) => ({ ...r, id: newId() }))
  return [
    db
      .prepare("INSERT INTO tenants (id, name, plan, plan_expires_at, created_at) VALUES (?,?,'trial',?,?)")
      .bind(tenantId, businessName, now + TRIAL_DAYS * DAY, now),
    ...roles.map((r) =>
      db
        .prepare('INSERT INTO roles (id, tenant_id, name, permissions, is_owner, created_at) VALUES (?,?,?,?,?,?)')
        .bind(r.id, tenantId, r.name, JSON.stringify(r.permissions), r.owner ? 1 : 0, now),
    ),
    db
      .prepare('INSERT INTO memberships (tenant_id, user_id, role_id, created_at) VALUES (?,?,?,?)')
      .bind(tenantId, ownerId, roles[0].id, now),
    db
      .prepare('INSERT INTO branches (id, tenant_id, name, timezone, created_at) VALUES (?,?,?,?,?)')
      .bind(newId(), tenantId, 'Pusat', 'Asia/Jakarta', now),
  ]
}

app.get('/config', (c) => c.json({ google: !!(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET) }))

const STATE_COOKIE = 'adcast_oauth'
const callbackUrl = (c: Ctx) => `${new URL(c.req.url).origin}/api/auth/google/callback`

app.get('/google', (c) => {
  if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) throw fail(404, 'Masuk dengan Google belum diaktifkan')
  const state = newToken()
  setCookie(c, STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: new URL(c.req.url).protocol === 'https:',
    path: '/api/auth/google',
    maxAge: 600,
  })
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: callbackUrl(c),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  }).toString()
  return c.redirect(url.toString())
})

type GoogleClaims = { sub: string; aud: string; email?: string; email_verified?: boolean; name?: string }

app.get('/google/callback', async (c) => {
  const back = (error: string) => c.redirect(`/masuk?error=${error}`)
  const state = getCookie(c, STATE_COOKIE)
  deleteCookie(c, STATE_COOKIE, { path: '/api/auth/google' })
  const code = c.req.query('code')
  if (!state || state !== c.req.query('state') || !code) return back('google_dibatalkan')

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: c.env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: callbackUrl(c),
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) return back('google_gagal')
  const { id_token } = await res.json<{ id_token?: string }>()

  // The token comes straight from Google over TLS in exchange for our client secret,
  // so its signature doesn't need a second check here.
  let claims: GoogleClaims
  try {
    claims = JSON.parse(new TextDecoder().decode(fromB64url(id_token!.split('.')[1])))
  } catch {
    return back('google_gagal')
  }
  if (claims.aud !== c.env.GOOGLE_CLIENT_ID || !claims.email || !claims.email_verified) return back('google_gagal')

  const db = c.env.DB
  const email = claims.email.toLowerCase()
  const user = await db
    .prepare(
      'SELECT id, google_sub, totp_enabled FROM users WHERE google_sub = ?1 OR email = ?2 ORDER BY google_sub IS ?1 DESC LIMIT 1',
    )
    .bind(claims.sub, email)
    .first<{ id: string; google_sub: string | null; totp_enabled: number }>()

  if (!user) {
    const userId = newId()
    const tenantId = newId()
    const name = (claims.name ?? email.split('@')[0]).slice(0, 80)
    await db.batch([
      db
        .prepare("INSERT INTO users (id, email, name, password_hash, google_sub, created_at) VALUES (?,?,?,'',?,?)")
        .bind(userId, email, name, claims.sub, Date.now()),
      ...newTenant(db, tenantId, userId, `Usaha ${name}`.slice(0, 80)),
    ])
    await createSession(c, userId, tenantId, false)
    return c.redirect('/pengaturan?baru=1')
  }

  if (user.google_sub && user.google_sub !== claims.sub) return back('google_gagal')
  if (!user.google_sub) await db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').bind(claims.sub, user.id).run()

  const membership = await db
    .prepare('SELECT tenant_id FROM memberships WHERE user_id = ? ORDER BY created_at LIMIT 1')
    .bind(user.id)
    .first<{ tenant_id: string }>()
  if (!membership) return back('tanpa_usaha')
  const needs2fa = user.totp_enabled === 1
  await createSession(c, user.id, membership.tenant_id, needs2fa)
  return c.redirect(needs2fa ? '/masuk?langkah=2fa' : '/')
})

const MAX_ATTEMPTS = 8
const ATTEMPT_WINDOW = 15 * 60_000

app.post('/login', async (c) => {
  const body = await readBody(c, z.object({ email: z.string().max(200), password: z.string().max(200) }))
  const email = body.email.trim().toLowerCase()
  const db = c.env.DB
  const now = Date.now()

  const recent = await db
    .prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE email = ? AND at > ?')
    .bind(email, now - ATTEMPT_WINDOW)
    .first<{ n: number }>()
  if ((recent?.n ?? 0) >= MAX_ATTEMPTS) throw fail(429, 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.')

  const user = await db
    .prepare('SELECT id, password_hash, totp_enabled FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string; password_hash: string; totp_enabled: number }>()
  if (!user || !(await verifyPassword(body.password, user.password_hash))) {
    await db.batch([
      db.prepare('INSERT INTO login_attempts (email, at) VALUES (?, ?)').bind(email, now),
      db.prepare('DELETE FROM login_attempts WHERE at < ?').bind(now - ATTEMPT_WINDOW),
    ])
    throw fail(401, 'Email atau kata sandi salah')
  }

  const membership = await db
    .prepare('SELECT tenant_id FROM memberships WHERE user_id = ? ORDER BY created_at LIMIT 1')
    .bind(user.id)
    .first<{ tenant_id: string }>()
  if (!membership) throw fail(403, 'Akun ini tidak terhubung ke usaha mana pun')

  const needs2fa = user.totp_enabled === 1
  await createSession(c, user.id, membership.tenant_id, needs2fa)
  return c.json({ twofa: needs2fa })
})

app.post('/2fa/verify', async (c) => {
  const { code } = await readBody(c, z.object({ code: z.string().max(10) }))
  const session = await loadSession(c)
  if (!session?.pending2fa) throw fail(401, 'Sesi tidak ditemukan, silakan masuk ulang')
  const db = c.env.DB
  const now = Date.now()
  const key = `2fa:${session.userId}`

  const recent = await db
    .prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE email = ? AND at > ?')
    .bind(key, now - ATTEMPT_WINDOW)
    .first<{ n: number }>()
  if ((recent?.n ?? 0) >= MAX_ATTEMPTS) throw fail(429, 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.')

  const user = await db
    .prepare('SELECT totp_secret FROM users WHERE id = ?')
    .bind(session.userId)
    .first<{ totp_secret: string | null }>()
  if (!user?.totp_secret || !(await verifyTotp(user.totp_secret, code))) {
    await db.prepare('INSERT INTO login_attempts (email, at) VALUES (?, ?)').bind(key, now).run()
    throw fail(401, 'Kode tidak cocok')
  }
  await db.prepare('UPDATE sessions SET pending_2fa = 0 WHERE id = ?').bind(session.sessionId).run()
  return c.json({ ok: true })
})

app.post('/logout', async (c) => {
  await destroySession(c)
  return c.json({ ok: true })
})

async function me(c: Ctx) {
  const a = c.get('auth')
  const db = c.env.DB
  const [user, tenant, role, tenants] = await Promise.all([
    db
      .prepare("SELECT id, name, email, totp_enabled, password_hash != '' AS has_password FROM users WHERE id = ?")
      .bind(a.userId)
      .first<{ id: string; name: string; email: string; totp_enabled: number; has_password: number }>(),
    db
      .prepare('SELECT id, name, plan, plan_expires_at, brand_color, logo_version, alert_threshold FROM tenants WHERE id = ?')
      .bind(a.tenantId)
      .first<{
        id: string
        name: string
        plan: string
        plan_expires_at: number | null
        brand_color: string
        logo_version: number
        alert_threshold: number
      }>(),
    db.prepare('SELECT name FROM roles WHERE id = ?').bind(a.roleId).first<{ name: string }>(),
    db
      .prepare(
        'SELECT t.id, t.name FROM memberships m JOIN tenants t ON t.id = m.tenant_id WHERE m.user_id = ? ORDER BY m.created_at',
      )
      .bind(a.userId)
      .all<{ id: string; name: string }>(),
  ])
  if (!user || !tenant) throw fail(401, 'Sesi tidak valid')
  const plan = effectivePlan(tenant.plan, tenant.plan_expires_at, Date.now())
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      totpEnabled: user.totp_enabled === 1,
      hasPassword: user.has_password === 1,
    },
    tenant: {
      id: tenant.id,
      name: tenant.name,
      plan,
      planExpiresAt: plan === 'free' ? null : tenant.plan_expires_at,
      // Set once a trial or paid plan has lapsed: when its uploaded files get deleted.
      purgeAt:
        plan === 'free' && tenant.plan !== 'free' && tenant.plan_expires_at
          ? tenant.plan_expires_at + PURGE_AFTER_DAYS * DAY
          : null,
      limits: PLANS[plan],
      brandColor: tenant.brand_color,
      logoUrl: tenant.logo_version ? `/media/logo/${tenant.id}?v=${tenant.logo_version}` : null,
      alertThreshold: tenant.alert_threshold,
    },
    role: role?.name ?? '',
    permissions: [...a.perms],
    tenants: tenants.results,
    platformAdmin: isPlatformAdmin(c.env, user.email),
    billing: !!qrisMerchant(c.env.QRIS_PAYLOAD ?? ''),
    push: { publicKey: c.env.VAPID_PUBLIC_KEY ?? null },
    integrations: {
      googleClientId: c.env.GOOGLE_CLIENT_ID ?? null,
      googleApiKey: c.env.GOOGLE_API_KEY ?? null,
      dropboxAppKey: c.env.DROPBOX_APP_KEY ?? null,
      onedriveClientId: c.env.ONEDRIVE_CLIENT_ID ?? null,
    },
  }
}

export type Me = Awaited<ReturnType<typeof me>>

app.get('/me', requireAuth, async (c) => c.json(await me(c)))

app.post('/switch', requireAuth, async (c) => {
  const { tenantId } = await readBody(c, z.object({ tenantId: z.string() }))
  const a = c.get('auth')
  const member = await c.env.DB.prepare('SELECT 1 FROM memberships WHERE user_id = ? AND tenant_id = ?')
    .bind(a.userId, tenantId)
    .first()
  if (!member) throw fail(403, 'Anda bukan anggota usaha tersebut')
  await c.env.DB.prepare('UPDATE sessions SET tenant_id = ? WHERE id = ?').bind(tenantId, a.sessionId).run()
  return c.json({ ok: true })
})

app.post('/password', requireAuth, async (c) => {
  const body = await readBody(c, z.object({ current: z.string().default(''), next: password }))
  const a = c.get('auth')
  const user = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(a.userId)
    .first<{ password_hash: string }>()
  if (!user) throw fail(401, 'Sesi tidak valid')
  // Google-only accounts may set a first password without knowing an old one.
  if (user.password_hash && !(await verifyPassword(body.current, user.password_hash))) {
    throw fail(400, 'Kata sandi saat ini salah')
  }
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(body.next), a.userId),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').bind(a.userId, a.sessionId),
  ])
  audit(c, 'auth.password_changed')
  return c.json({ ok: true })
})

app.post('/2fa/setup', requireAuth, async (c) => {
  const a = c.get('auth')
  const user = await c.env.DB.prepare('SELECT email, totp_enabled FROM users WHERE id = ?')
    .bind(a.userId)
    .first<{ email: string; totp_enabled: number }>()
  if (!user) throw fail(401, 'Sesi tidak valid')
  if (user.totp_enabled) throw fail(409, 'Verifikasi dua langkah sudah aktif')
  const secret = newTotpSecret()
  await c.env.DB.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').bind(secret, a.userId).run()
  const label = encodeURIComponent(`AdCast:${user.email}`)
  return c.json({ secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=AdCast` })
})

app.post('/2fa/enable', requireAuth, async (c) => {
  const { code } = await readBody(c, z.object({ code: z.string().max(10) }))
  const a = c.get('auth')
  const user = await c.env.DB.prepare('SELECT totp_secret FROM users WHERE id = ?')
    .bind(a.userId)
    .first<{ totp_secret: string | null }>()
  if (!user?.totp_secret || !(await verifyTotp(user.totp_secret, code))) throw fail(400, 'Kode tidak cocok')
  await c.env.DB.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').bind(a.userId).run()
  audit(c, 'auth.2fa_enabled')
  return c.json({ ok: true })
})

app.post('/2fa/disable', requireAuth, async (c) => {
  const { code } = await readBody(c, z.object({ code: z.string().max(10) }))
  const a = c.get('auth')
  const user = await c.env.DB.prepare('SELECT totp_secret FROM users WHERE id = ?')
    .bind(a.userId)
    .first<{ totp_secret: string | null }>()
  if (!user?.totp_secret || !(await verifyTotp(user.totp_secret, code))) throw fail(400, 'Kode tidak cocok')
  await c.env.DB.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').bind(a.userId).run()
  audit(c, 'auth.2fa_disabled')
  return c.json({ ok: true })
})

export default app
