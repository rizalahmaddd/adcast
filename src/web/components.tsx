import { useState, type FormEvent } from 'react'
import { TICKER_SPEEDS, type Target } from '../shared/types'
import { api, useBranches, useDevices, useMedia, usePlaylists, type Device, type Media } from './lib/api'
import { formatAgo, screenState, STATE_COLOR, STATE_LABEL } from './lib/format'
import { Button, Check, cx, Input, Modal, Select, useAction } from './ui'

export function thumbUrl(m: Media): string | null {
  if (m.kind === 'youtube') return `https://i.ytimg.com/vi/${m.youtubeId}/mqdefault.jpg`
  return m.kind === 'file' && m.hasThumb ? `/media/${m.id}/thumb` : null
}

/** One TV drawn as a 16:9 screen. The tile is the unit the whole product is about. */
export function ScreenTile({ device, onClick }: { device: Device; onClick?: () => void }) {
  const state = screenState(device.live)
  const live = device.live
  const lit = state === 'playing' || state === 'paused'
  const title = live?.reported?.title ?? live?.desired?.name

  return (
    <button
      type="button"
      onClick={onClick}
      className="group grid gap-2 rounded-md text-left"
      aria-label={`${device.name}, ${STATE_LABEL[state]}`}
    >
      <div
        className={cx(
          'relative flex aspect-video items-end overflow-hidden rounded-md p-2.5 transition-shadow group-hover:ring-2 group-hover:ring-ink/40',
          lit ? 'bg-brand text-on-brand' : 'bg-screen text-white',
          state === 'error' && 'ring-2 ring-bad',
          (state === 'offline' || state === 'never') && 'opacity-60',
        )}
      >
        <p className="line-clamp-2 text-sm font-semibold leading-snug">
          {state === 'playing' || state === 'paused'
            ? (title ?? 'Tayangan')
            : state === 'error'
              ? (live?.reported?.error ?? 'Gagal memutar')
              : state === 'idle'
                ? 'Siap menerima tayangan'
                : state === 'offline' && live?.lastSeen
                  ? `Terakhir terlihat ${formatAgo(live.lastSeen)}`
                  : 'Menunggu TV dinyalakan'}
        </p>
      </div>
      <div className="min-w-0">
        <p className="truncate font-semibold">{device.name}</p>
        <p className={cx('text-sm font-semibold', STATE_COLOR[state])}>{STATE_LABEL[state]}</p>
      </div>
    </button>
  )
}

export function TargetPicker({ value, onChange }: { value: Target; onChange: (t: Target) => void }) {
  const branches = useBranches()
  const devices = useDevices()
  const toggle = (id: string) =>
    onChange({ ...value, ids: value.ids.includes(id) ? value.ids.filter((x) => x !== id) : [...value.ids, id] })

  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1.5 text-sm font-semibold">Kirim ke</legend>
      <div className="grid grid-cols-3 gap-1 rounded-md border border-line p-1">
        {(
          [
            ['all', 'Semua TV'],
            ['branch', 'Per cabang'],
            ['device', 'TV tertentu'],
          ] as const
        ).map(([type, label]) => (
          <label
            key={type}
            className={cx(
              'flex min-h-10 cursor-pointer items-center justify-center rounded px-2 text-center text-sm font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink',
              value.type === type ? 'bg-ink text-bg' : 'text-muted hover:bg-sunken',
            )}
          >
            <input
              type="radio"
              name="target-type"
              className="sr-only"
              checked={value.type === type}
              onChange={() => onChange({ type, ids: [] })}
            />
            {label}
          </label>
        ))}
      </div>
      {value.type === 'branch' && (
        <div className="max-h-56 overflow-y-auto">
          {branches.data?.map((b) => (
            <Check
              key={b.id}
              checked={value.ids.includes(b.id)}
              onChange={() => toggle(b.id)}
              label={`${b.name} (${devices.data?.filter((d) => d.branchId === b.id).length ?? 0} layar)`}
            />
          ))}
        </div>
      )}
      {value.type === 'device' && (
        <div className="max-h-56 overflow-y-auto">
          {devices.data?.length === 0 && <p className="px-2 py-3 text-sm text-muted">Belum ada layar yang terhubung.</p>}
          {devices.data?.map((d) => (
            <Check
              key={d.id}
              checked={value.ids.includes(d.id)}
              onChange={() => toggle(d.id)}
              label={
                <>
                  {d.name}{' '}
                  <span className="text-muted">
                    ({branches.data?.find((b) => b.id === d.branchId)?.name}, {STATE_LABEL[screenState(d.live)].toLowerCase()})
                  </span>
                </>
              }
            />
          ))}
        </div>
      )}
    </fieldset>
  )
}

export const targetReady = (t: Target) => t.type === 'all' || t.ids.length > 0

export function ContentSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const media = useMedia()
  const playlists = usePlaylists()
  const ready = media.data?.items.filter((m) => m.status === 'ready') ?? []
  return (
    <Select label="Tayangan" value={value} onChange={(e) => onChange(e.target.value)} required>
      <option value="">Pilih video atau playlist</option>
      {!!playlists.data?.length && (
        <optgroup label="Playlist">
          {playlists.data.map((p) => (
            <option key={p.id} value={`playlist:${p.id}`}>
              {p.name} ({p.mediaIds.length} video)
            </option>
          ))}
        </optgroup>
      )}
      {!!ready.length && (
        <optgroup label="Video">
          {ready.map((m) => (
            <option key={m.id} value={`media:${m.id}`}>
              {m.title}
            </option>
          ))}
        </optgroup>
      )}
    </Select>
  )
}

export const splitContent = (value: string) => {
  const [contentType, contentId] = value.split(':')
  return { contentType: contentType as 'media' | 'playlist', contentId }
}

export function SendDialog({
  preset,
  presetTarget,
  onClose,
}: {
  preset?: { value: string; name: string }
  presetTarget?: Target
  onClose: () => void
}) {
  const [content, setContent] = useState(preset?.value ?? '')
  const [target, setTarget] = useState<Target>(presetTarget ?? { type: 'all', ids: [] })
  const [tickerOn, setTickerOn] = useState(false)
  const [tickerText, setTickerText] = useState('')
  const [tickerSpeed, setTickerSpeed] = useState(120)
  const [tickerBg, setTickerBg] = useState('#000000')
  const { run, busy } = useAction()

  const tickerReady = !tickerOn || !!tickerText.trim()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const ticker = tickerOn ? { text: tickerText.trim(), speed: tickerSpeed, bg: tickerBg } : undefined
    const res = await run(
      () => api<{ screens: number }>('POST', '/api/broadcasts', { ...splitContent(content), target, ticker }),
      (r) => `Tayangan dikirim ke ${r.screens} layar`,
    )
    if (res) onClose()
  }

  return (
    <Modal title={preset ? `Kirim "${preset.name}"` : 'Kirim tayangan'} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-5">
        {!preset && <ContentSelect value={content} onChange={setContent} />}
        <TargetPicker value={target} onChange={setTarget} />

        <div className="grid gap-3 rounded-md border border-line p-3">
          <Check
            label="Teks berjalan khusus kiriman ini"
            checked={tickerOn}
            onChange={(e) => setTickerOn(e.target.checked)}
          />
          {tickerOn && (
            <>
              <Input
                label="Teks"
                value={tickerText}
                onChange={(e) => setTickerText(e.target.value)}
                maxLength={200}
                placeholder="Promo hari ini, jam buka, atau pengumuman"
                hint="Menggantikan teks berjalan cabang selama tayangan ini."
                required
              />
              <div className="grid grid-cols-2 gap-3">
                <Select label="Kecepatan" value={tickerSpeed} onChange={(e) => setTickerSpeed(Number(e.target.value))}>
                  {TICKER_SPEEDS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
                <div className="grid content-start gap-1.5">
                  <label htmlFor="send-ticker-bg" className="text-sm font-semibold">
                    Warna latar
                  </label>
                  <input
                    id="send-ticker-bg"
                    type="color"
                    value={tickerBg}
                    onChange={(e) => setTickerBg(e.target.value)}
                    className="h-11 w-16 cursor-pointer rounded-md border border-line bg-surface p-1"
                  />
                </div>
              </div>
            </>
          )}
        </div>

        <p className="text-sm text-muted">
          TV yang sedang online mulai memutar bersamaan dalam beberapa detik. TV yang offline memutarnya begitu tersambung lagi.
        </p>
        <Button type="submit" variant="primary" busy={busy} disabled={!content || !targetReady(target) || !tickerReady}>
          Kirim sekarang
        </Button>
      </form>
    </Modal>
  )
}
