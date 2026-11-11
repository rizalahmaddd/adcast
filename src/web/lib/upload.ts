import { api } from './api'

export type Probe = { duration: number; width: number; height: number; thumb: Blob | null }

/**
 * Loads the file into a <video> element. If the browser can decode a frame,
 * a TV running the same engine can play it; otherwise the file is rejected or converted.
 */
export function probeVideo(file: Blob): Promise<Probe> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    video.playsInline = true

    const cleanup = () => {
      clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
    }
    const fail = (message: string) => {
      cleanup()
      reject(new Error(message))
    }
    const timer = setTimeout(() => fail('Video terlalu lama dibaca, kemungkinan file rusak'), 20_000)

    video.onerror = () => fail('Format atau codec video tidak didukung browser')
    video.onloadedmetadata = () => {
      if (!video.videoWidth || !Number.isFinite(video.duration) || video.duration <= 0) {
        return fail('File tidak berisi gambar video yang bisa diputar')
      }
      video.currentTime = Math.min(1, video.duration / 2)
    }
    video.onseeked = () => {
      const { duration, videoWidth: width, videoHeight: height } = video
      const canvas = document.createElement('canvas')
      canvas.width = 480
      canvas.height = Math.round((480 * height) / width)
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        cleanup()
        return resolve({ duration, width, height, thumb: null })
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(
        (thumb) => {
          cleanup()
          resolve({ duration, width, height, thumb })
        },
        'image/jpeg',
        0.75,
      )
    }
    video.src = url
  })
}

/** Reads length and size of a video at another address by letting the browser open it, as a TV would. */
export function probeLink(url: string): Promise<Omit<Probe, 'thumb'>> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'metadata'
    const done = (fn: () => void) => {
      clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      fn()
    }
    const timer = setTimeout(
      () => done(() => reject(new Error('Tautan terlalu lama dibuka. Periksa alamatnya atau coba lagi.'))),
      25_000,
    )
    video.onerror = () =>
      done(() =>
        reject(new Error('Tautan ini tidak bisa diputar. Pastikan alamatnya langsung ke file MP4 atau WebM dan bisa dibuka siapa saja.')),
      )
    video.onloadedmetadata = () => {
      const { duration, videoWidth: width, videoHeight: height } = video
      if (!width || !Number.isFinite(duration) || duration <= 0) {
        return done(() => reject(new Error('Tautan ini bukan video yang punya durasi tetap. Siaran langsung tidak didukung.')))
      }
      done(() => resolve({ duration, width, height }))
    }
    video.src = url
  })
}

export function probeImageLink(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('Tautan ini bukan foto yang bisa ditampilkan'))
    img.src = url
  })
}

const scaled = (source: ImageBitmap, longest: number): Promise<{ blob: Blob; width: number; height: number }> => {
  const ratio = Math.min(1, longest / Math.max(source.width, source.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(source.width * ratio)
  canvas.height = Math.round(source.height * ratio)
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve({ blob, width: canvas.width, height: canvas.height }) : reject(new Error('Foto tidak bisa diproses'))),
      'image/jpeg',
      0.86,
    ),
  )
}

export const isImageFile = (file: Blob, name: string) => file.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(name)

/** Photos are scaled down to TV resolution in the browser, which keeps them light for storage and for the TV. */
export async function uploadImage(file: Blob, title: string): Promise<void> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('Foto ini tidak bisa dibaca. Gunakan JPG, PNG, atau WebP.')
  })
  const full = await scaled(bitmap, 1920)
  const thumb = await scaled(bitmap, 480)
  bitmap.close()
  const query = new URLSearchParams({ title, width: String(full.width), height: String(full.height) })
  const { id } = await api<{ id: string }>('PUT', `/api/media/images?${query}`, full.blob)
  await api('PUT', `/api/media/${id}/thumb`, thumb.blob).catch(() => {})
}

async function containerMime(file: Blob): Promise<'video/mp4' | 'video/webm' | null> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'video/webm'
  if (String.fromCharCode(...head.slice(4, 8)) === 'ftyp') return 'video/mp4'
  return null
}

export type UploadStage = { stage: 'checking' | 'converting' | 'uploading'; progress: number }

export async function uploadVideo(
  file: Blob,
  title: string,
  source: 'upload' | 'gdrive' | 'dropbox' | 'onedrive',
  onStage: (s: UploadStage) => void,
): Promise<void> {
  onStage({ stage: 'checking', progress: 0 })
  let data = file
  let probe: Probe | null = null
  let mime = await containerMime(file)

  // Matroska with WebM codecs plays as-is; anything else in an EBML container needs converting.
  if (mime) probe = await probeVideo(file).catch(() => null)
  if (!probe) {
    const { convertToMp4 } = await import('./convert')
    data = await convertToMp4(file, (progress) => onStage({ stage: 'converting', progress }))
    mime = 'video/mp4'
    probe = await probeVideo(data).catch(() => {
      throw new Error('Video ini tidak bisa dibaca maupun dikonversi. File kemungkinan rusak.')
    })
  }

  onStage({ stage: 'uploading', progress: 0 })
  const { id, partSize } = await api<{ id: string; partSize: number }>('POST', '/api/media/uploads', {
    title,
    size: data.size,
    mime,
    duration: probe.duration,
    width: probe.width,
    height: probe.height,
    source,
  })

  try {
    const parts: { partNumber: number; etag: string }[] = []
    for (let offset = 0, n = 1; offset < data.size; offset += partSize, n++) {
      const chunk = data.slice(offset, offset + partSize, 'application/octet-stream')
      parts.push(await withRetry(() => api('PUT', `/api/media/uploads/${id}/parts/${n}`, chunk)))
      onStage({ stage: 'uploading', progress: Math.min(1, (offset + partSize) / data.size) })
    }
    await api('POST', `/api/media/uploads/${id}/complete`, { parts })
  } catch (err) {
    await api('DELETE', `/api/media/uploads/${id}`).catch(() => {})
    throw err
  }
  if (probe.thumb) await api('PUT', `/api/media/${id}/thumb`, probe.thumb).catch(() => {})
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn()
    } catch (err) {
      if (i >= attempts) throw err
      await new Promise((r) => setTimeout(r, 1000 * i))
    }
  }
}
