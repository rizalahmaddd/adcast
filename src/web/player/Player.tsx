import { useCallback, useEffect, useRef, useState } from 'react'
import { clockLabel, prayerNow, todaysPrayers, type PrayerConfig } from '../../shared/prayer'
import type {
  Announcement,
  Cmd,
  CmdItem,
  PlayerStatus,
  PlayerToServer,
  ServerToPlayer,
  Ticker,
} from '../../shared/types'
import { formatClock, readableOn } from '../lib/format'
import { hasTimeline, loadYouTubeApi, locate, sourceFor, syncCache, type YTPlayer } from './engine'

const TOKEN_KEY = 'adcast_device_token'
const CMD_KEY = 'adcast_cmd'
const INFO_KEY = 'adcast_info'

type Info = {
  device: { id: string; name: string; offset?: number; rotation?: number }
  ticker?: Ticker | null
  prayer?: PrayerConfig | null
  tenant: { name: string; brandColor: string; logoUrl: string | null }
}

const STATS_EVERY = 10 * 60_000
const STATS_TICK = 5

const readJson = <T,>(key: string): T | null => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null
  } catch {
    return null
  }
}

export default function Player() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY))

  useEffect(() => {
    document.title = 'AdCast Player'
    document.documentElement.dataset.theme = 'dark'
  }, [])

  const forget = useCallback(() => {
    for (const key of [TOKEN_KEY, CMD_KEY, INFO_KEY]) localStorage.removeItem(key)
    setToken(null)
  }, [])

  return (
    <div className="fixed inset-0 cursor-none overflow-hidden bg-black text-white select-none">
      {token ? (
        <Screen token={token} onRevoked={forget} />
      ) : (
        <Pairing
          onPaired={(t) => {
            localStorage.setItem(TOKEN_KEY, t)
            setToken(t)
          }}
        />
      )}
    </div>
  )
}

function Pairing({ onPaired }: { onPaired: (token: string) => void }) {
  const [code, setCode] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    let secret: string | null = null

    const tick = async () => {
      try {
        if (!secret) {
          const res = await fetch('/api/player/pair', { method: 'POST' })
          if (!res.ok) throw new Error()
          const data = (await res.json()) as { code: string; secret: string }
          secret = data.secret
          if (!stopped) setCode(data.code)
        } else {
          const res = await fetch('/api/player/pair', { headers: { authorization: `Bearer ${secret}` } })
          if (!res.ok) throw new Error()
          const data = (await res.json()) as { status: string; token?: string }
          if (data.status === 'paired' && data.token) return onPaired(data.token)
          if (data.status === 'expired') {
            secret = null
            if (!stopped) setCode(null)
          }
        }
        if (!stopped) setOffline(false)
      } catch {
        if (!stopped) setOffline(true)
      }
      if (!stopped) timer = setTimeout(tick, 3000)
    }
    void tick()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [onPaired])

  return (
    <div className="grid h-full place-items-center p-[5vw] text-center">
      <div>
        <p className="text-[2.2vw] font-semibold text-white/75">Hubungkan TV ini ke AdCast</p>
        <p className="mt-[3vw] font-mono text-[11vw] leading-none font-bold tracking-[0.12em]" aria-live="polite">
          {code ?? '······'}
        </p>
        <p className="mx-auto mt-[3vw] max-w-[60vw] text-[1.9vw] text-white/75">
          Buka dashboard AdCast di HP atau komputer, pilih menu Layar, tekan Hubungkan TV, lalu ketik kode di atas.
        </p>
        {offline && <p className="mt-[2vw] text-[1.7vw] font-semibold text-amber-300">Tidak ada koneksi internet. Mencoba lagi.</p>}
      </div>
    </div>
  )
}

type View = { phase: 'idle' | 'waiting' | 'playing' | 'paused' | 'error'; item?: CmdItem; error?: string }

const STATUS: Record<View['phase'], PlayerStatus> = {
  idle: 'idle',
  waiting: 'loading',
  playing: 'playing',
  paused: 'paused',
  error: 'error',
}

function Screen({ token, onRevoked }: { token: string; onRevoked: () => void }) {
  const [info, setInfo] = useState<Info | null>(() => readJson<Info>(INFO_KEY))
  const [cmd, setCmd] = useState<Cmd | null>(() => readJson<Cmd>(CMD_KEY))
  const [view, setView] = useState<View>({ phase: 'idle' })
  const [connected, setConnected] = useState(false)
  const [cached, setCached] = useState(0)
  const [muted, setMuted] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [praying, setPraying] = useState<{ label: string; until: string } | null>(null)
  const [ann, setAnn] = useState<Announcement | null>(null)

  const video = useRef<HTMLVideoElement>(null)
  const ytHost = useRef<HTMLDivElement>(null)
  const yt = useRef<YTPlayer | null>(null)
  const ws = useRef<WebSocket | null>(null)
  const clockOffset = useRef(0)
  const handlers = useRef({ ended: () => {}, failed: (_message: string) => {} })
  const latest = useRef({ view, cmd, cached, connected, info })
  latest.current = { view, cmd, cached, connected, info }
  const stats = useRef({ up: 0, plays: new Map<string, number>() })
  const refresh = useRef(() => {})

  const send = useCallback((msg: PlayerToServer) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg))
  }, [])

  const report = useCallback(() => {
    const { view, cmd, cached } = latest.current
    send({
      t: 'state',
      state: {
        status: STATUS[view.phase],
        cmdId: cmd?.id,
        mediaId: view.item?.mediaId,
        title: view.item?.title,
        position: video.current?.currentTime,
        error: view.error,
        cached,
      },
    })
  }, [send])

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/api/player/me', { headers: { authorization: `Bearer ${token}` } })
        if (res.status === 401) return onRevoked()
        if (!res.ok) return
        const data = (await res.json()) as Info
        localStorage.setItem(INFO_KEY, JSON.stringify(data))
        setInfo(data)
      } catch {
        // Offline: keep showing the last known branding.
      }
    }

    refresh.current = () => void check()

    let stopped = false
    let retry: ReturnType<typeof setTimeout>
    let ping: ReturnType<typeof setInterval>
    let attempt = 0

    const apply = (next: Cmd | null) => {
      if (next) localStorage.setItem(CMD_KEY, JSON.stringify(next))
      else localStorage.removeItem(CMD_KEY)
      setCmd((current) =>
        current?.id === next?.id && current?.paused === next?.paused && current?.startAt === next?.startAt ? current : next,
      )
    }

    const connect = () => {
      void check()
      const socket = new WebSocket(
        `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/player/ws?t=${encodeURIComponent(token)}`,
      )
      ws.current = socket
      let lastPong = Date.now()
      let bestRtt = Infinity

      socket.onopen = () => {
        attempt = 0
        setConnected(true)
        socket.send(JSON.stringify({ t: 'hello' } satisfies PlayerToServer))
        for (const delay of [0, 400, 800]) {
          setTimeout(() => socket.readyState === 1 && socket.send(JSON.stringify({ t: 'time', c: Date.now() })), delay)
        }
        ping = setInterval(() => {
          // A dead connection can look open for minutes; a missed pong is the faster signal.
          if (Date.now() - lastPong > 60_000) return socket.close()
          socket.send('ping')
        }, 25_000)
      }
      socket.onmessage = (e) => {
        if (e.data === 'pong') {
          lastPong = Date.now()
          return
        }
        const msg = JSON.parse(e.data as string) as ServerToPlayer
        if (msg.t === 'welcome') {
          if (bestRtt === Infinity) clockOffset.current = msg.now - Date.now()
          apply(msg.cmd)
          setAnn(msg.ann ?? null)
          setTimeout(report, 500)
        } else if (msg.t === 'time') {
          const rtt = Date.now() - msg.c
          if (rtt < bestRtt) {
            bestRtt = rtt
            clockOffset.current = msg.s + rtt / 2 - Date.now()
          }
        } else if (msg.t === 'cmd') {
          apply(msg.cmd)
        } else if (msg.t === 'announcement') {
          setAnn(msg.a)
        } else if (msg.t === 'revoked') {
          onRevoked()
        } else if (msg.t === 'refresh') {
          refresh.current()
        }
      }
      socket.onclose = () => {
        clearInterval(ping)
        setConnected(false)
        if (!stopped) retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempt++))
      }
    }
    connect()

    return () => {
      stopped = true
      clearTimeout(retry)
      clearInterval(ping)
      ws.current?.close()
    }
  }, [token, onRevoked, report])

  const cmdKey = cmd ? `${cmd.id}:${cmd.paused}:${cmd.startAt}` : ''
  const prayerKey = praying?.label ?? ''
  const annKey = ann?.id ?? ''

  // Prayer times are worked out on the TV itself, so the pause still happens without internet.
  const prayer = info?.prayer ?? null
  useEffect(() => {
    if (!prayer) return setPraying(null)
    const check = () => {
      const hit = prayerNow(prayer, Date.now() + clockOffset.current)
      setPraying((current) => (current?.label === hit?.label && current?.until === hit?.until ? current : hit))
    }
    check()
    const interval = setInterval(check, 5000)
    return () => clearInterval(interval)
  }, [prayer])

  useEffect(() => {
    const tick = setInterval(() => {
      const { view, connected } = latest.current
      if (connected) stats.current.up += STATS_TICK
      if (view.phase === 'playing' && view.item) {
        const id = view.item.mediaId
        stats.current.plays.set(id, (stats.current.plays.get(id) ?? 0) + STATS_TICK)
      }
    }, STATS_TICK * 1000)
    const flush = setInterval(() => {
      if (ws.current?.readyState !== WebSocket.OPEN) return
      const { up, plays } = stats.current
      if (!up && !plays.size) return
      const offset = latest.current.info?.device.offset ?? 7
      const day = new Date(Date.now() + clockOffset.current + offset * 3_600_000).toISOString().slice(0, 10)
      send({ t: 'stats', day, up, plays: [...plays].map(([id, s]) => ({ id, s })) })
      stats.current = { up: 0, plays: new Map() }
    }, STATS_EVERY)
    return () => {
      clearInterval(tick)
      clearInterval(flush)
    }
  }, [send])

  useEffect(() => {
    const el = video.current!
    let cancelled = false
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const later = (fn: () => void, ms: number) => {
      const t = setTimeout(() => {
        timers.delete(t)
        if (!cancelled) fn()
      }, ms)
      timers.add(t)
    }
    const serverNow = () => Date.now() + clockOffset.current
    let index = 0
    let shown = 0

    syncCache(cmd, token, setCached)

    const stopYouTube = () => {
      try {
        yt.current?.pauseVideo()
      } catch {
        // The iframe may not be ready yet.
      }
    }

    if (!cmd || !cmd.items.length) {
      el.pause()
      el.removeAttribute('src')
      el.load()
      stopYouTube()
      setImageSrc(null)
      setView({ phase: 'idle' })
      return
    }

    if (prayerKey) {
      el.pause()
      stopYouTube()
      setImageSrc(null)
      setView({ phase: 'paused' })
      // When the pause ends this effect runs again and rejoins the shared timeline.
      return
    }

    if (annKey) {
      el.pause()
      stopYouTube()
      setImageSrc(null)
      setView({ phase: 'paused' })
      // The announcement covers the screen; clearing it runs this effect again and rejoins the timeline.
      return
    }

    const playImage = async (item: CmdItem, offset: number, paused: boolean) => {
      stopYouTube()
      el.pause()
      el.removeAttribute('src')
      delete el.dataset.mediaId
      const turn = shown
      const src = await sourceFor(item, token)
      if (cancelled || turn !== shown) return
      setImageSrc(src)
      // A later show() makes this timer stale; without the check it would skip an item.
      if (!paused) later(() => turn === shown && handlers.current.ended(), Math.max(1, (item.duration ?? 10) - offset) * 1000)
    }

    const playFile = async (item: CmdItem, offset: number, paused: boolean) => {
      stopYouTube()
      const src = await sourceFor(item, token)
      if (cancelled) return
      if (el.dataset.mediaId !== item.mediaId) {
        el.dataset.mediaId = item.mediaId
        el.src = src
      }
      el.loop = cmd.items.length === 1
      const seek = () => {
        if (Math.abs(el.currentTime - offset) > 0.7) el.currentTime = offset
      }
      if (el.readyState >= 1) seek()
      else el.addEventListener('loadedmetadata', seek, { once: true })
      if (paused) return el.pause()
      try {
        await el.play()
      } catch (err) {
        if ((err as DOMException).name !== 'NotAllowedError') return
        // Browsers block autoplay with sound until someone presses a key; start silent rather than not at all.
        el.muted = true
        setMuted(true)
        await el.play().catch(() => {})
      }
    }

    const playYouTube = async (item: CmdItem, offset: number, paused: boolean) => {
      el.pause()
      el.removeAttribute('src')
      delete el.dataset.mediaId
      await loadYouTubeApi()
      if (cancelled) return
      const begin = (player: YTPlayer) => {
        player.loadVideoById(item.youtubeId!)
        if (offset > 1) player.seekTo(offset, true)
        if (paused) later(() => player.pauseVideo(), 800)
      }
      if (yt.current) return begin(yt.current)
      let state = -1
      const player = new window.YT!.Player(ytHost.current!.appendChild(document.createElement('div')), {
        width: '100%',
        height: '100%',
        playerVars: { autoplay: 1, controls: 0, rel: 0, playsinline: 1, disablekb: 1, iv_load_policy: 3 },
        events: {
          onReady: () => {
            yt.current = player
            begin(player)
            later(() => {
              if (state === 1 || state === 3 || latest.current.cmd?.paused) return
              player.mute()
              player.playVideo()
              setMuted(true)
            }, 4000)
          },
          onStateChange: (e: { data: number }) => {
            state = e.data
            if (e.data === 0) handlers.current.ended()
          },
          onError: () => handlers.current.failed('Video YouTube tidak bisa diputar di TV ini'),
        },
      })
    }

    const show = (at: number, offset: number, paused: boolean) => {
      index = at
      shown++
      const item = cmd.items[at]
      setView({ phase: paused ? 'paused' : 'playing', item })
      if (item.kind !== 'image') setImageSrc(null)
      const play = item.kind === 'youtube' ? playYouTube : item.kind === 'image' ? playImage : playFile
      const run = play(item, offset, paused)
      run.catch((err: Error) => handlers.current.failed(err.message))
    }

    handlers.current = {
      ended: () => show((index + 1) % cmd.items.length, 0, false),
      failed: (message) => {
        if (cancelled) return
        setView({ phase: 'error', item: cmd.items[index], error: message })
        // Skip the broken item; a lone item gets retried in case the network comes back.
        later(() => show((index + 1) % cmd.items.length, 0, false), cmd.items.length > 1 ? 4000 : 15_000)
      },
    }

    if (cmd.paused) {
      const p = locate(cmd, serverNow())
      show(p.index, p.offset, true)
    } else {
      const wait = cmd.startAt - serverNow()
      if (wait > 150) {
        setView({ phase: 'waiting', item: cmd.items[0] })
        const first = cmd.items[0]
        if (first.kind === 'file') {
          void sourceFor(first, token).then((src) => {
            if (cancelled || el.dataset.mediaId === first.mediaId) return
            el.dataset.mediaId = first.mediaId
            el.src = src
            el.load()
          })
        }
        later(() => show(0, 0, false), wait)
      } else {
        const p = locate(cmd, serverNow())
        show(p.index, p.offset, false)
      }

      if (hasTimeline(cmd)) {
        const correct = setInterval(() => {
          if (cancelled || latest.current.view.phase !== 'playing') return
          const expected = locate(cmd, serverNow())
          const item = cmd.items[expected.index]
          const nearEdge = expected.offset < 2 || item.duration! - expected.offset < 2
          if (nearEdge) return
          if (expected.index !== index) show(expected.index, expected.offset, false)
          else if (item.kind === 'file' && Math.abs(el.currentTime - expected.offset) > 1.5) el.currentTime = expected.offset
        }, 20_000)
        timers.add(correct as unknown as ReturnType<typeof setTimeout>)
      }
    }

    return () => {
      cancelled = true
      for (const t of timers) clearTimeout(t)
    }
    // cmdKey captures every field of cmd that changes playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmdKey, token, prayerKey, annKey])

  useEffect(() => {
    report()
    const interval = setInterval(report, 20_000)
    return () => clearInterval(interval)
  }, [view, cached, connected, report])

  useEffect(() => {
    const unmute = () => {
      if (video.current) video.current.muted = false
      try {
        yt.current?.unMute()
      } catch {
        // Player not ready.
      }
      setMuted(false)
      document.documentElement.requestFullscreen?.().catch(() => {})
    }
    window.addEventListener('keydown', unmute)
    window.addEventListener('pointerdown', unmute)

    let lock: WakeLockSentinel | null = null
    const keepAwake = async () => {
      if (document.visibilityState === 'visible') lock = await navigator.wakeLock?.request('screen').catch(() => null)
    }
    void keepAwake()
    document.addEventListener('visibilitychange', keepAwake)

    const tick = setInterval(() => setNow(Date.now()), 30_000)
    return () => {
      window.removeEventListener('keydown', unmute)
      window.removeEventListener('pointerdown', unmute)
      document.removeEventListener('visibilitychange', keepAwake)
      clearInterval(tick)
      void lock?.release()
    }
  }, [])

  const brand = info?.tenant.brandColor ?? '#0f766e'
  const showVideo = view.item?.kind === 'file' && view.phase !== 'idle'
  const showYouTube = view.item?.kind === 'youtube' && view.phase !== 'idle'
  const rotation = info?.device.rotation ?? 0
  const ticker = cmd?.ticker ?? info?.ticker ?? null
  const showTicker =
    !!ticker?.text &&
    !praying &&
    !ann &&
    (view.phase === 'playing' || view.phase === 'waiting' || view.phase === 'paused')

  return (
    <div
      className="absolute overflow-hidden bg-black"
      style={
        rotation
          ? {
              top: '50%',
              left: '50%',
              width: '100vh',
              height: '100vw',
              transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
            }
          : { inset: 0 }
      }
    >
      <video
        ref={video}
        playsInline
        preload="auto"
        onEnded={() => handlers.current.ended()}
        onError={() => video.current?.src && handlers.current.failed('Video tidak bisa diputar')}
        className={`absolute inset-0 size-full bg-black object-contain ${showVideo ? '' : 'invisible'}`}
      />
      <div ref={ytHost} className={`pointer-events-none absolute inset-0 ${showYouTube ? '' : 'invisible'}`} />
      {imageSrc && view.item?.kind === 'image' && (
        <img
          src={imageSrc}
          alt=""
          onError={() => handlers.current.failed('Foto tidak bisa ditampilkan')}
          className="absolute inset-0 size-full bg-black object-contain"
        />
      )}

      {view.phase === 'idle' && (
        <div className="absolute inset-0 grid place-items-center p-[5vw] text-center" style={{ background: brand, color: readableOn(brand) }}>
          <div>
            {info?.tenant.logoUrl && <img src={info.tenant.logoUrl} alt="" className="mx-auto mb-[2.5vw] h-[14vw] object-contain" />}
            <p className="text-[5vw] leading-tight font-bold">{info?.tenant.name ?? 'AdCast'}</p>
            <p className="mt-[2vw] text-[3vw] font-semibold tabular-nums">{formatClock(now)}</p>
            <p className="mt-[1.5vw] text-[1.6vw]">
              {info?.device.name}
              {connected ? ', siap menerima tayangan' : ', menunggu koneksi internet'}
            </p>
            {prayer && <PrayerRow config={prayer} now={now + clockOffset.current} />}
          </div>
        </div>
      )}

      {view.phase === 'waiting' && <Note>Menyiapkan tayangan</Note>}
      {praying && cmd && cmd.items.length > 0 && (
        <div className="absolute inset-0 grid place-items-center p-[5vw] text-center" style={{ background: brand, color: readableOn(brand) }}>
          <div>
            <p className="text-[2.4vw] font-semibold">Waktu sholat</p>
            <p className="mt-[1vw] text-[9vw] leading-none font-bold">{praying.label}</p>
            <p className="mt-[3vw] text-[2.2vw]">Tayangan dilanjutkan pukul {praying.until}</p>
            {prayer && <PrayerRow config={prayer} now={now + clockOffset.current} />}
          </div>
        </div>
      )}
      {view.phase === 'paused' && !praying && <Note>Dijeda</Note>}
      {view.phase === 'error' && <Note>{view.error ?? 'Video tidak bisa diputar'}. Mencoba lagi.</Note>}
      {muted && view.phase === 'playing' && <Note>Tekan OK pada remote untuk menyalakan suara</Note>}

      {showTicker && ticker && <TickerBar ticker={ticker} />}

      {ann && (
        <div
          className="absolute inset-0 z-20 grid place-items-center overflow-hidden p-[6vw] text-center"
          style={{ background: ann.bg, color: readableOn(ann.bg) }}
        >
          <p className="text-[7vw] leading-tight font-extrabold whitespace-pre-wrap">{ann.text}</p>
        </div>
      )}
    </div>
  )
}

/** Draws the text itself and scrolls it right to left at the configured speed. */
function TickerBar({ ticker }: { ticker: Ticker }) {
  const bar = useRef<HTMLDivElement>(null)
  const text = useRef<HTMLSpanElement>(null)
  const [size, setSize] = useState({ bar: 0, font: 0 })

  useEffect(() => {
    const el = bar.current
    const span = text.current
    const stage = el?.parentElement
    if (!el || !span || !stage) return

    const measure = () => {
      const h = stage.clientHeight
      setSize({ bar: Math.round(h * 0.1), font: Math.round(h * 0.06) })
      // Older TV browsers without the Web Animations API just show the text at rest.
      if (typeof span.animate !== 'function') return
      for (const animation of span.getAnimations()) animation.cancel()
      const distance = span.offsetWidth + stage.clientWidth
      span.animate(
        [{ transform: `translateX(${stage.clientWidth}px)` }, { transform: 'translateX(-100%)' }],
        {
          duration: Math.max(4000, (distance / Math.max(20, ticker.speed)) * 1000),
          iterations: Infinity,
          easing: 'linear',
        },
      )
    }
    measure()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(stage)
    return () => {
      observer?.disconnect()
      for (const animation of span.getAnimations()) animation.cancel()
    }
  }, [ticker.text, ticker.speed])

  return (
    <div
      ref={bar}
      className="absolute inset-x-0 bottom-0 z-10 flex items-center overflow-hidden"
      style={{
        height: size.bar || '10%',
        background: ticker.bg,
        color: readableOn(ticker.bg),
      }}
    >
      <span ref={text} className="inline-block px-[1.5vw] font-semibold whitespace-nowrap" style={{ fontSize: size.font || '3.5vh' }}>
        {ticker.text}
      </span>
    </div>
  )
}

function PrayerRow({ config, now }: { config: PrayerConfig; now: number }) {
  return (
    <dl className="mt-[3vw] flex justify-center gap-[3vw] text-[1.7vw]">
      {todaysPrayers(config, now).map((p) => (
        <div key={p.prayer}>
          <dt>{p.label}</dt>
          <dd className="text-[2.3vw] font-bold tabular-nums">{clockLabel(p.minutes)}</dd>
        </div>
      ))}
    </dl>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="absolute bottom-[3vw] left-[3vw] rounded-md bg-black/75 px-[1.4vw] py-[0.8vw] text-[1.6vw] font-semibold">
      {children}
    </p>
  )
}
