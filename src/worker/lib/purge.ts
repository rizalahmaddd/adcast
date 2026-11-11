import { DAY, PURGE_AFTER_DAYS } from '../../shared/plans'
import type { Bindings } from '../env'
import { notifyTenant } from './push'

export const PURGED_NOTE = `File dihapus otomatis ${PURGE_AFTER_DAYS} hari setelah paket berakhir`

/**
 * Deletes uploaded files of businesses whose trial or paid plan ended long ago, so storage
 * nobody pays for doesn't pile up. The library entry stays, marked as removed.
 */
export async function purgeLapsedUploads(env: Bindings, now = Date.now()): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.tenant_id, m.r2_key FROM media m JOIN tenants t ON t.id = m.tenant_id
     WHERE m.kind = 'file' AND m.r2_key IS NOT NULL AND m.status != 'failed'
       AND t.plan != 'free' AND t.plan_expires_at IS NOT NULL AND t.plan_expires_at < ?
     LIMIT 400`,
  )
    .bind(now - PURGE_AFTER_DAYS * DAY)
    .all<{ id: string; tenant_id: string; r2_key: string }>()
  if (!results.length) return 0

  await env.MEDIA.delete(results.flatMap((m) => [m.r2_key, `t/${m.tenant_id}/thumb/${m.id}`]))
  const mark = env.DB.prepare(
    "UPDATE media SET status = 'failed', size = 0, r2_key = NULL, upload_id = NULL, has_thumb = 0, error = ? WHERE id = ?",
  )
  await env.DB.batch(results.map((m) => mark.bind(PURGED_NOTE, m.id)))

  const perTenant = new Map<string, number>()
  for (const m of results) perTenant.set(m.tenant_id, (perTenant.get(m.tenant_id) ?? 0) + 1)
  await Promise.all(
    [...perTenant].map(([tenantId, count]) =>
      notifyTenant(env, tenantId, 'File upload dihapus', `${count} file hasil upload dihapus karena paket sudah berakhir lebih dari ${PURGE_AFTER_DAYS} hari.`),
    ),
  )
  return results.length
}
