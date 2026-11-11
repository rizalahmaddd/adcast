import { Hono } from 'hono'
import { z } from 'zod'
import { directVideoLink, isYoutubeLink } from '../../shared/links'
import { IMAGE_SECONDS, UPLOAD_PART_SIZE } from '../../shared/types'
import { audit, fail, readBody, type AppEnv, type Bindings, type Ctx } from '../env'
import { newId } from '../lib/crypto'
import { assertRoom } from '../lib/plan'
import { requireAuth, requirePerm } from '../session'

const app = new Hono<AppEnv>()
app.use(requireAuth)

const title = z.string().trim().min(1).max(200)
const key = (tenantId: string, mediaId: string) => `t/${tenantId}/m/${mediaId}`
export const thumbKey = (tenantId: string, mediaId: string) => `t/${tenantId}/thumb/${mediaId}`

const COLUMNS = `id, kind, title, status, source, youtube_id AS youtubeId, url, mime, size, duration, width, height,
  has_thumb AS hasThumb, error, start_date AS startDate, end_date AS endDate, created_at AS createdAt`

app.get('/', async (c) => {
  const { tenantId } = c.get('auth')
  const [list, usage] = await Promise.all([
    c.env.DB.prepare(`SELECT ${COLUMNS} FROM media WHERE tenant_id = ? ORDER BY created_at DESC`).bind(tenantId).all(),
    storageUsed(c.env, tenantId),
  ])
  return c.json({ items: list.results, used: usage })
})

async function storageUsed(env: Bindings, tenantId: string) {
  const row = await env.DB.prepare('SELECT COALESCE(SUM(size), 0) AS used FROM media WHERE tenant_id = ?')
    .bind(tenantId)
    .first<{ used: number }>()
  return row?.used ?? 0
}

async function assertQuota(c: Ctx, size: number) {
  const { rules } = await assertRoom(c, 'maxMedia')
  if (!rules.maxStorage) {
    throw fail(403, `Paket ${rules.label} hanya menerima video dari tautan. Upgrade paket untuk upload video.`)
  }
  if ((await storageUsed(c.env, c.get('auth').tenantId)) + size > rules.maxStorage) {
    throw fail(413, 'Kuota penyimpanan paket Anda tidak cukup untuk video ini')
  }
}

const ALLOWED_MIME = ['video/mp4', 'video/webm']

app.post('/uploads', requirePerm('media'), async (c) => {
  const body = await readBody(
    c,
    z.object({
      title,
      size: z.number().int().positive(),
      mime: z.enum(ALLOWED_MIME),
      duration: z.number().positive().nullable(),
      width: z.number().int().positive().nullable(),
      height: z.number().int().positive().nullable(),
      source: z.enum(['upload', 'gdrive', 'dropbox', 'onedrive']).default('upload'),
    }),
  )
  await assertQuota(c, body.size)
  const a = c.get('auth')
  const id = newId()
  const upload = await c.env.MEDIA.createMultipartUpload(key(a.tenantId, id), {
    httpMetadata: { contentType: body.mime },
  })
  await c.env.DB.prepare(
    `INSERT INTO media (id, tenant_id, kind, title, status, source, r2_key, upload_id, mime, size, duration, width, height, created_by, created_at)
     VALUES (?, ?, 'file', ?, 'uploading', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      a.tenantId,
      body.title,
      body.source,
      upload.key,
      upload.uploadId,
      body.mime,
      body.size,
      body.duration,
      body.width,
      body.height,
      a.userId,
      Date.now(),
    )
    .run()
  return c.json({ id, partSize: UPLOAD_PART_SIZE })
})

type UploadRow = { r2_key: string; upload_id: string; size: number; title: string }

async function pendingUpload(c: Ctx): Promise<UploadRow> {
  const row = await c.env.DB.prepare(
    "SELECT r2_key, upload_id, size, title FROM media WHERE id = ? AND tenant_id = ? AND status = 'uploading'",
  )
    .bind(c.req.param('id'), c.get('auth').tenantId)
    .first<UploadRow>()
  if (!row) throw fail(404, 'Unggahan tidak ditemukan')
  return row
}

app.put('/uploads/:id/parts/:n', requirePerm('media'), async (c) => {
  const n = Number(c.req.param('n'))
  if (!Number.isInteger(n) || n < 1 || n > 10_000) throw fail(400, 'Bagian tidak valid')
  const row = await pendingUpload(c)
  const data = await c.req.arrayBuffer()
  if (!data.byteLength || data.byteLength > UPLOAD_PART_SIZE) throw fail(413, 'Ukuran bagian tidak valid')
  const upload = c.env.MEDIA.resumeMultipartUpload(row.r2_key, row.upload_id)
  const part = await upload.uploadPart(n, data)
  return c.json({ partNumber: part.partNumber, etag: part.etag })
})

function looksLikeVideo(head: Uint8Array): boolean {
  const ascii = (from: number, to: number) => String.fromCharCode(...head.slice(from, to))
  const isMp4 = ascii(4, 8) === 'ftyp'
  const isWebm = head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3
  return isMp4 || isWebm
}

app.post('/uploads/:id/complete', requirePerm('media'), async (c) => {
  const body = await readBody(
    c,
    z.object({ parts: z.array(z.object({ partNumber: z.number().int(), etag: z.string() })).min(1) }),
  )
  const row = await pendingUpload(c)
  const id = c.req.param('id')
  const upload = c.env.MEDIA.resumeMultipartUpload(row.r2_key, row.upload_id)

  const reject = async (reason: string) => {
    await c.env.MEDIA.delete(row.r2_key)
    await c.env.DB.prepare("UPDATE media SET status = 'failed', size = 0, error = ?, upload_id = NULL WHERE id = ?")
      .bind(reason, id)
      .run()
    throw fail(400, reason)
  }

  let object: R2Object
  try {
    object = await upload.complete(body.parts)
  } catch {
    await upload.abort().catch(() => {})
    return reject('Unggahan tidak lengkap, silakan ulangi')
  }
  if (object.size !== row.size) return reject('Ukuran file tidak sesuai, unggahan kemungkinan terpotong')

  const head = await c.env.MEDIA.get(row.r2_key, { range: { offset: 0, length: 16 } })
  if (!head || !looksLikeVideo(new Uint8Array(await head.arrayBuffer()))) {
    return reject('File bukan video MP4/WebM yang valid')
  }

  await c.env.DB.prepare("UPDATE media SET status = 'ready', upload_id = NULL WHERE id = ?").bind(id).run()
  audit(c, 'media.uploaded', { title: row.title })
  return c.json({ ok: true })
})

app.delete('/uploads/:id', requirePerm('media'), async (c) => {
  const row = await pendingUpload(c)
  await c.env.MEDIA.resumeMultipartUpload(row.r2_key, row.upload_id)
    .abort()
    .catch(() => {})
  await c.env.DB.prepare('DELETE FROM media WHERE id = ?').bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

function imageMime(head: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...head.slice(from, to))
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
  if (head[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  return null
}

const MAX_IMAGE = 8 * 1024 * 1024

// Photos are small enough to arrive in one request; the dashboard scales them to TV size first.
app.put('/images', requirePerm('media'), async (c) => {
  const meta = z
    .object({ title, width: z.coerce.number().int().positive(), height: z.coerce.number().int().positive() })
    .safeParse(c.req.query())
  if (!meta.success) throw fail(400, 'Data foto tidak lengkap')
  const data = await c.req.arrayBuffer()
  if (!data.byteLength || data.byteLength > MAX_IMAGE) throw fail(413, 'Ukuran foto maksimal 8 MB')
  const mime = imageMime(new Uint8Array(data.slice(0, 16)))
  if (!mime) throw fail(400, 'File bukan foto JPG, PNG, atau WebP yang valid')
  await assertQuota(c, data.byteLength)

  const a = c.get('auth')
  const id = newId()
  await c.env.MEDIA.put(key(a.tenantId, id), data, { httpMetadata: { contentType: mime } })
  await c.env.DB.prepare(
    `INSERT INTO media (id, tenant_id, kind, title, status, source, r2_key, mime, size, duration, width, height, created_by, created_at)
     VALUES (?, ?, 'file', ?, 'ready', 'upload', ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, a.tenantId, meta.data.title, key(a.tenantId, id), mime, data.byteLength, IMAGE_SECONDS, meta.data.width, meta.data.height, a.userId, Date.now())
    .run()
  audit(c, 'media.uploaded', { title: meta.data.title })
  return c.json({ id })
})

app.put('/:id/thumb', requirePerm('media'), async (c) => {
  const { tenantId } = c.get('auth')
  const id = c.req.param('id')
  const exists = await c.env.DB.prepare('SELECT 1 FROM media WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first()
  if (!exists) throw fail(404, 'Video tidak ditemukan')
  const data = await c.req.arrayBuffer()
  if (!data.byteLength || data.byteLength > 512 * 1024) throw fail(413, 'Thumbnail terlalu besar')
  await c.env.MEDIA.put(thumbKey(tenantId, id), data, { httpMetadata: { contentType: 'image/jpeg' } })
  await c.env.DB.prepare('UPDATE media SET has_thumb = 1 WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

function youtubeId(input: string): string | null {
  if (/^[\w-]{11}$/.test(input)) return input
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '')
  let id: string | null = null
  if (host === 'youtu.be') id = url.pathname.slice(1)
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v') ?? url.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})/)?.[1] ?? null
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null
}

app.post('/youtube', requirePerm('media'), async (c) => {
  const body = await readBody(c, z.object({ url: z.string().trim().max(500), title: title.optional() }))
  const id = youtubeId(body.url)
  if (!id) throw fail(400, 'Tautan YouTube tidak dikenali')
  await assertRoom(c, 'maxMedia')

  // oEmbed fails for private, removed, or embed-disabled videos, which could never play on a TV anyway.
  const res = await fetch(
    `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`,
  )
  if (!res.ok) throw fail(400, 'Video YouTube tidak ditemukan atau tidak mengizinkan pemutaran di luar YouTube')
  const meta = await res.json<{ title?: string }>()

  const a = c.get('auth')
  const mediaId = newId()
  const finalTitle = body.title ?? meta.title ?? 'Video YouTube'
  await c.env.DB.prepare(
    `INSERT INTO media (id, tenant_id, kind, title, status, source, youtube_id, created_by, created_at)
     VALUES (?, ?, 'youtube', ?, 'ready', 'youtube', ?, ?, ?)`,
  )
    .bind(mediaId, a.tenantId, finalTitle.slice(0, 200), id, a.userId, Date.now())
    .run()
  audit(c, 'media.youtube_added', { title: finalTitle })
  return c.json({ id: mediaId })
})

async function firstBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { headers: { range: 'bytes=0-63' }, signal: AbortSignal.timeout(10_000) })
    if (!res.ok || !res.body) return null
    const reader = res.body.getReader()
    const { value } = await reader.read()
    // Hosts that ignore Range would otherwise stream the whole file.
    await reader.cancel().catch(() => {})
    return value ?? null
  } catch {
    return null
  }
}

app.post('/link', requirePerm('media'), async (c) => {
  const body = await readBody(
    c,
    z.object({
      url: z.string().trim().max(1000),
      title,
      image: z.boolean().default(false),
      duration: z.number().positive().max(86_400).optional(),
      width: z.number().int().positive().nullable(),
      height: z.number().int().positive().nullable(),
    }),
  )
  if (!body.image && !body.duration) throw fail(400, 'Durasi video tidak terbaca')
  if (isYoutubeLink(body.url)) throw fail(400, 'Tautan YouTube ditambahkan lewat pemutar YouTube')
  const url = directVideoLink(body.url)
  if (!url) throw fail(400, 'Tautan harus berupa alamat https ke file video atau foto')
  await assertRoom(c, 'maxMedia')

  const head = await firstBytes(url)
  if (!head) throw fail(400, 'Tautan tidak bisa dibuka. Pastikan file dibagikan untuk siapa saja yang punya tautan.')
  const mime = body.image ? imageMime(head) : null
  if (body.image && !mime) throw fail(400, 'Tautan ini tidak mengarah langsung ke foto JPG, PNG, atau WebP')
  if (!body.image && (head.length < 12 || !looksLikeVideo(head))) {
    throw fail(400, 'Tautan ini tidak mengarah langsung ke file video MP4 atau WebM')
  }

  const a = c.get('auth')
  const id = newId()
  await c.env.DB.prepare(
    `INSERT INTO media (id, tenant_id, kind, title, status, source, url, mime, duration, width, height, created_by, created_at)
     VALUES (?, ?, 'link', ?, 'ready', 'link', ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, a.tenantId, body.title, url, mime, body.duration ?? IMAGE_SECONDS, body.width, body.height, a.userId, Date.now())
    .run()
  audit(c, 'media.link_added', { title: body.title })
  return c.json({ id })
})

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus berformat TTTT-BB-HH')

app.patch('/:id', requirePerm('media'), async (c) => {
  const body = await readBody(
    c,
    z.object({
      title,
      duration: z.number().int().min(3).max(3600).optional(),
      startDate: day.nullable().optional(),
      endDate: day.nullable().optional(),
    }),
  )
  if (body.startDate && body.endDate && body.startDate > body.endDate) {
    throw fail(400, 'Tanggal mulai harus sebelum tanggal selesai')
  }
  // Only a photo's time on screen is ours to set; a video's length is a fact about the file.
  await c.env.DB.prepare(
    `UPDATE media SET title = ?, duration = CASE WHEN ? IS NOT NULL AND mime LIKE 'image/%' THEN ? ELSE duration END,
       start_date = ?, end_date = ?
     WHERE id = ? AND tenant_id = ?`,
  )
    .bind(
      body.title,
      body.duration ?? null,
      body.duration ?? null,
      body.startDate ?? null,
      body.endDate ?? null,
      c.req.param('id'),
      c.get('auth').tenantId,
    )
    .run()
  return c.json({ ok: true })
})

app.delete('/:id', requirePerm('media'), async (c) => {
  const { tenantId } = c.get('auth')
  const id = c.req.param('id')
  const row = await c.env.DB.prepare('SELECT title, r2_key, upload_id FROM media WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId)
    .first<{ title: string; r2_key: string | null; upload_id: string | null }>()
  if (!row) throw fail(404, 'Video tidak ditemukan')
  const inSchedule = await c.env.DB.prepare(
    "SELECT name FROM schedules WHERE tenant_id = ? AND content_type = 'media' AND content_id = ? LIMIT 1",
  )
    .bind(tenantId, id)
    .first<{ name: string }>()
  if (inSchedule) throw fail(409, `Video masih dipakai jadwal "${inSchedule.name}"`)

  if (row.r2_key && row.upload_id) {
    await c.env.MEDIA.resumeMultipartUpload(row.r2_key, row.upload_id)
      .abort()
      .catch(() => {})
  }
  await c.env.MEDIA.delete([...(row.r2_key ? [row.r2_key] : []), thumbKey(tenantId, id)])
  await c.env.DB.prepare('DELETE FROM media WHERE id = ?').bind(id).run()
  audit(c, 'media.deleted', { title: row.title })
  return c.json({ ok: true })
})

export default app
