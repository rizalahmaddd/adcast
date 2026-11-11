import { FFmpeg } from '@ffmpeg/ffmpeg'

// The wasm core is ~30 MB, above the per-file limit for Workers static assets, so it loads from a CDN.
const CORE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm'
const MAX_CONVERT_SIZE = 600 * 1024 * 1024

async function blobUrl(url: string, type: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error('Gagal memuat alat konversi video. Periksa koneksi internet lalu coba lagi.')
  return URL.createObjectURL(new Blob([await res.arrayBuffer()], { type }))
}

let loading: Promise<FFmpeg> | null = null

function getFfmpeg(): Promise<FFmpeg> {
  loading ??= (async () => {
    const ffmpeg = new FFmpeg()
    await ffmpeg.load({
      coreURL: await blobUrl(`${CORE}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await blobUrl(`${CORE}/ffmpeg-core.wasm`, 'application/wasm'),
    })
    return ffmpeg
  })().catch((err) => {
    loading = null
    throw err
  })
  return loading
}

/** Converts any container ffmpeg understands (MKV, AVI, MOV, ...) to H.264/AAC MP4 inside the browser. */
export async function convertToMp4(file: Blob, onProgress: (ratio: number) => void): Promise<Blob> {
  if (file.size > MAX_CONVERT_SIZE) {
    throw new Error(
      'Video ini perlu dikonversi, tetapi ukurannya di atas 600 MB. Ubah dulu ke MP4 (H.264) di komputer, lalu upload ulang.',
    )
  }
  const ffmpeg = await getFfmpeg()
  const report = ({ progress }: { progress: number }) => onProgress(Math.max(0, Math.min(1, progress)))
  ffmpeg.on('progress', report)
  try {
    await ffmpeg.writeFile('input', new Uint8Array(await file.arrayBuffer()))

    // Try a lossless remux first: MKV/MOV files usually already hold H.264 and finish in seconds.
    let code = await ffmpeg.exec(['-i', 'input', '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'copy', '-c:a', 'aac', '-movflags', '+faststart', 'out.mp4'])
    const remuxed = code === 0 ? await readOutput(ffmpeg) : null
    if (remuxed && (await browserCanPlay(remuxed))) return remuxed

    code = await ffmpeg.exec([
      '-i', 'input',
      '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p',
      // Caps at 1080p without ever upscaling smaller sources.
      '-vf', "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
      '-c:a', 'aac', '-b:a', '160k',
      '-movflags', '+faststart', '-y', 'out.mp4',
    ])
    if (code !== 0) throw new Error('Video tidak bisa dikonversi. File kemungkinan rusak atau bukan video.')
    const out = await readOutput(ffmpeg)
    if (!out) throw new Error('Video tidak bisa dikonversi. File kemungkinan rusak atau bukan video.')
    return out
  } finally {
    ffmpeg.off('progress', report)
    await ffmpeg.deleteFile('input').catch(() => {})
    await ffmpeg.deleteFile('out.mp4').catch(() => {})
  }
}

async function readOutput(ffmpeg: FFmpeg): Promise<Blob | null> {
  const data = await ffmpeg.readFile('out.mp4').catch(() => null)
  if (!data || typeof data === 'string' || data.byteLength < 1024) return null
  return new Blob([data as Uint8Array<ArrayBuffer>], { type: 'video/mp4' })
}

function browserCanPlay(blob: Blob): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const video = document.createElement('video')
    const done = (ok: boolean) => {
      URL.revokeObjectURL(url)
      resolve(ok)
    }
    video.muted = true
    video.onloadeddata = () => done(video.videoWidth > 0)
    video.onerror = () => done(false)
    setTimeout(() => done(false), 10_000)
    video.src = url
  })
}
