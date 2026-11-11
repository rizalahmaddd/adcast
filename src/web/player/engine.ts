import type { Cmd, CmdItem } from '../../shared/types'

const CACHE = 'adcast-media'
const cacheKey = (mediaId: string) => `/media/${mediaId}`

/** Where in a looping playlist the shared clock says we should be. */
export function locate(cmd: Cmd, serverNow: number): { index: number; offset: number } {
  const durations = cmd.items.map((i) => i.duration)
  const at = cmd.paused ? (cmd.pausedAt ?? serverNow) : serverNow
  const elapsed = Math.max(0, (at - cmd.startAt) / 1000)
  // Without every duration (YouTube items) there is no shared timeline; start from the top.
  if (durations.some((d) => !d)) return { index: 0, offset: 0 }
  const total = durations.reduce<number>((sum, d) => sum + d!, 0)
  let rest = elapsed % total
  for (let index = 0; index < durations.length; index++) {
    if (rest < durations[index]!) return { index, offset: rest }
    rest -= durations[index]!
  }
  return { index: 0, offset: 0 }
}

export const hasTimeline = (cmd: Cmd) => cmd.items.every((i) => !!i.duration)

const objectUrls = new Map<string, string>()

/**
 * Local copy if the video is already stored on this TV, otherwise the streaming URL.
 * Linked videos always stream from their own host: other sites rarely allow the download a local copy needs.
 */
export async function sourceFor(item: CmdItem, token: string): Promise<string> {
  if (item.url) return item.url
  const known = objectUrls.get(item.mediaId)
  if (known) return known
  try {
    const hit = await (await caches.open(CACHE)).match(cacheKey(item.mediaId))
    if (hit) {
      const url = URL.createObjectURL(await hit.blob())
      objectUrls.set(item.mediaId, url)
      return url
    }
  } catch {
    // Cache storage is unavailable on insecure origins; streaming still works.
  }
  return `/media/${item.mediaId}?t=${encodeURIComponent(token)}`
}

let syncing: Promise<void> = Promise.resolve()

/** Downloads the command's files for offline playback and drops files no longer needed. */
export function syncCache(cmd: Cmd | null, token: string, onChange: (count: number) => void) {
  syncing = syncing.then(async () => {
    let cache: Cache
    try {
      cache = await caches.open(CACHE)
    } catch {
      return
    }
    const wanted = new Set((cmd?.items ?? []).filter((i) => i.kind !== 'youtube' && !i.url).map((i) => i.mediaId))
    for (const request of await cache.keys()) {
      const id = new URL(request.url).pathname.split('/').pop()!
      if (!wanted.has(id)) {
        await cache.delete(request)
        const url = objectUrls.get(id)
        if (url) URL.revokeObjectURL(url)
        objectUrls.delete(id)
      }
    }
    for (const id of wanted) {
      if (await cache.match(cacheKey(id))) continue
      try {
        const res = await fetch(`/media/${id}?t=${encodeURIComponent(token)}`)
        if (res.ok && res.status === 200) await cache.put(cacheKey(id), res)
      } catch {
        // Offline or storage full: keep streaming and try again on the next command.
      }
      onChange((await cache.keys()).length)
    }
    onChange((await cache.keys()).length)
  })
}

type YTPlayer = {
  loadVideoById(id: string): void
  playVideo(): void
  pauseVideo(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  mute(): void
  unMute(): void
  getCurrentTime(): number
  destroy(): void
}

declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, options: unknown) => YTPlayer }
    onYouTubeIframeAPIReady?: () => void
  }
}

let ytApi: Promise<void> | null = null

export function loadYouTubeApi(): Promise<void> {
  ytApi ??= new Promise<void>((resolve, reject) => {
    if (window.YT?.Player) return resolve()
    window.onYouTubeIframeAPIReady = () => resolve()
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.onerror = () => {
      ytApi = null
      reject(new Error('YouTube tidak bisa dimuat, periksa internet TV'))
    }
    document.head.append(script)
  })
  return ytApi
}

export type { YTPlayer }
