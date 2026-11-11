import type { Bindings } from '../env'
import { b64url, fromB64url, newId } from './crypto'

const enc = new TextEncoder()

async function vapidHeader(env: Bindings, endpoint: string): Promise<string | null> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null
  const pub = fromB64url(env.VAPID_PUBLIC_KEY)
  const key = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: b64url(pub.slice(1, 33)),
      y: b64url(pub.slice(33, 65)),
      d: env.VAPID_PRIVATE_KEY,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64url(
    enc.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: env.VAPID_SUBJECT ?? 'mailto:admin@example.com',
      }),
    ),
  )
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`))
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${env.VAPID_PUBLIC_KEY}`
}

/**
 * Stores an in-app notification and wakes subscribed browsers.
 * The push carries no payload; the service worker fetches the latest
 * notification itself, which avoids message encryption entirely.
 */
export async function notifyTenant(env: Bindings, tenantId: string, title: string, body: string) {
  await env.DB.prepare('INSERT INTO notifications (id, tenant_id, title, body, created_at) VALUES (?,?,?,?,?)')
    .bind(newId(), tenantId, title, body, Date.now())
    .run()

  const { results } = await env.DB.prepare('SELECT endpoint FROM push_subscriptions WHERE tenant_id = ?')
    .bind(tenantId)
    .all<{ endpoint: string }>()

  await Promise.all(
    results.map(async ({ endpoint }) => {
      const authorization = await vapidHeader(env, endpoint)
      if (!authorization) return
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: authorization, TTL: '3600', Urgency: 'high', 'Content-Length': '0' },
      }).catch(() => null)
      if (res && (res.status === 404 || res.status === 410)) {
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run()
      }
    }),
  )
}
