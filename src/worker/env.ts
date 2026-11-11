import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { z } from 'zod'
import type { Permission } from '../shared/types'
import type { TenantHub } from './hub'
import { newId } from './lib/crypto'

export type Bindings = {
  DB: D1Database
  MEDIA: R2Bucket
  HUB: DurableObjectNamespace<TenantHub>
  ASSETS: Fetcher
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  VAPID_SUBJECT?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  GOOGLE_API_KEY?: string
  DROPBOX_APP_KEY?: string
  ONEDRIVE_CLIENT_ID?: string
  QRIS_PAYLOAD?: string
  ADMIN_EMAILS?: string
}

export type Auth = {
  sessionId: string
  userId: string
  userName: string
  tenantId: string
  roleId: string
  isOwner: boolean
  perms: Set<Permission>
}

export type AppEnv = { Bindings: Bindings; Variables: { auth: Auth } }
export type Ctx = Context<AppEnv>

export const fail = (status: 400 | 401 | 403 | 404 | 409 | 413 | 429, message: string) =>
  new HTTPException(status, { message })

export async function readBody<S extends z.ZodType>(c: Ctx, schema: S): Promise<z.infer<S>> {
  const raw = await c.req.json().catch(() => null)
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw fail(400, issue ? `${issue.path.join('.')}: ${issue.message}` : 'Data tidak valid')
  }
  return parsed.data
}

export const hub = (env: Bindings, tenantId: string) => env.HUB.get(env.HUB.idFromName(tenantId))

export function audit(c: Ctx, action: string, detail?: Record<string, unknown>) {
  const a = c.get('auth')
  c.executionCtx.waitUntil(
    c.env.DB.prepare(
      'INSERT INTO audit_logs (id, tenant_id, user_id, user_name, action, detail, ip, created_at) VALUES (?,?,?,?,?,?,?,?)',
    )
      .bind(
        newId(),
        a.tenantId,
        a.userId,
        a.userName,
        action,
        detail ? JSON.stringify(detail) : null,
        c.req.header('cf-connecting-ip') ?? null,
        Date.now(),
      )
      .run(),
  )
}
