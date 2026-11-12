import { useState, type FormEvent } from 'react'
import { isImageMime, TICKER_SPEEDS, type Target } from '../shared/types'
import { api, useBranches, useDevices, useGroups, useMedia, usePlaylists, type Device, type Media } from './lib/api'
import { formatAgo, screenState, STATE_COLOR, STATE_LABEL } from './lib/format'
import { Button, Check, cx, Field, Input, Modal, Select, useAction } from './ui'

export function thumbUrl(m: Media): string | null {
  if (m.kind === 'youtube') return `https://i.ytimg.com/vi/${m.youtubeId}/mqdefault.jpg`
  return m.kind === 'file' && m.hasThumb ? `/media/${m.id}/thumb` : null
}

export function previewUrl(m: Media): string | null {
  const thumb = thumbUrl(m)
  if (thumb) return thumb
  // Images have no poster of their own, so the file itself is the preview.
  return m.kind === 'file' && isImageMime(m.mime) ? `/media/${m.id}` : null
}

/** What the TV says it is showing right now, matched against the media library for a picture. */
export function nowPlaying(device: Device, media: Media[] | undefined) {
  const report = device.live?.reported
  if (!report?.mediaId || (report.status !== 'playing' && report.status !== 'paused')) return null
  const item = media?.find((m) => m.id === report.mediaId)
  let progress: number | null = null
  if (item && item.kind === 'file' && !isImageMime(item.mime) && item.duration && report.position != null) {
    progress = Math.min(100, Math.max(0, (report.position / item.duration) * 100))
  }
  return { title: report.title ?? item?.title ?? 'Tayangan', src: item ? previewUrl(item) : null, progress }
}

/** One TV drawn as a 16:9 screen. The tile is the unit the whole product is about. */
export function ScreenTile({ device, media, onClick }: { device: Device; media?: Media[]; onClick?: () => void }) {
  const state = screenState(device.live)
  const live = device.live
  const lit = state === 'playing' || state === 'paused'
  const title = live?.reported?.title ?? live?.desired?.name
  const now = nowPlaying(device, media)

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
        {now?.src && (
          <>
            <img src={now.src} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
            <span
              aria-hidden
              className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent"
            />
          </>
        )}
        <p className={cx('relative line-clamp-2 text-sm font-semibold leading-snug', now?.src && 'text-white')}>
          {state === 'playing' || state === 'paused'
            ? (title ?? 'Tayangan')
            : state === 'error'
              ? (live?.reported?.error ?? 'Gagal memutar')
              : state === 'closed'
                ? 'Tutup di luar jam operasional'
                : state === 'idle'
                  ? 'Siap menerima tayangan'
                  : state === 'offline' && live?.lastSeen
                    ? `Terakhir terlihat ${formatAgo(live.lastSeen)}`
                    : 'Menunggu TV dinyalakan'}
        </p>
        {now?.progress != null && (
          <span aria-hidden className="absolute inset-x-0 bottom-0 h-1 bg-white/25">
            <span className="block h-full bg-white" style={{ width: `${now.progress}%` }} />
          </span>
        )}
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
  const groups = useGroups()
  const toggle = (id: string) =>
    onChange({ ...value, ids: value.ids.includes(id) ? value.ids.filter((x) => x !== id) : [...value.ids, id] })

  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1.5 text-sm font-semibold">Kirim ke</legend>
      <div className="grid grid-cols-2 gap-1 rounded-md border border-line p-1 sm:grid-cols-4">
        {(
          [
            ['all', 'Semua TV'],
            ['branch', 'Per cabang'],
            ['group', 'Per grup'],
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
      {value.type === 'group' && (
        <div className="max-h-56 overflow-y-auto">
          {groups.data?.length === 0 && (
            <p className="px-2 py-3 text-sm text-muted">
              Belum ada grup layar. Buat grup lewat tombol Grup layar di halaman Layar.
            </p>
          )}
          {groups.data?.map((g) => (
            <Check
              key={g.id}
              checked={value.ids.includes(g.id)}
              onChange={() => toggle(g.id)}
              label={`${g.name} (${g.devices} layar)`}
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
  const [split, setSplit] = useState(false)
  const [sideKind, setSideKind] = useState<'text' | 'image'>('text')
  const [sideTitle, setSideTitle] = useState('')
  const [sideText, setSideText] = useState('')
  const [sideBg, setSideBg] = useState('#0f766e')
  const [sideColor, setSideColor] = useState('#ffffff')
  const [sideMediaId, setSideMediaId] = useState('')
  const media = useMedia()
  const { run, busy } = useAction()

  const tickerReady = !tickerOn || !!tickerText.trim()
  const images = (media.data?.items ?? []).filter((m) => m.status === 'ready' && m.kind === 'file' && isImageMime(m.mime))
  const sideReady = !split || (sideKind === 'image' ? !!sideMediaId : !!sideText.trim())

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const ticker = tickerOn ? { text: tickerText.trim(), speed: tickerSpeed, bg: tickerBg } : undefined
    const side = split
      ? sideKind === 'image'
        ? { kind: 'image' as const, mediaId: sideMediaId, title: sideTitle.trim() || null }
        : {
            kind: 'text' as const,
            title: sideTitle.trim() || null,
            text: sideText.trim(),
            bg: sideBg,
            color: sideColor,
          }
      : undefined
    const res = await run(
      () =>
        api<{ screens: number }>('POST', '/api/broadcasts', {
          ...splitContent(content),
          target,
          ticker,
          layout: split ? 'split' : 'full',
          side,
        }),
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
          <Select
            label="Tata letak layar"
            value={split ? 'split' : 'full'}
            onChange={(e) => setSplit(e.target.value === 'split')}
            hint="Bagi layar memakai dua pertiga kiri untuk tayangan utama dan sepertiga kanan untuk panel pendamping."
          >
            <option value="full">Penuh (satu tayangan)</option>
            <option value="split">Bagi layar (tayangan + panel)</option>
          </Select>

          {split && (
            <>
              <Select
                label="Isi panel kanan"
                value={sideKind}
                onChange={(e) => setSideKind(e.target.value as 'text' | 'image')}
              >
                <option value="text">Teks</option>
                <option value="image">Foto</option>
              </Select>

              {sideKind === 'image' ? (
                <>
                  <Select label="Foto" value={sideMediaId} onChange={(e) => setSideMediaId(e.target.value)} required>
                    <option value="">Pilih foto</option>
                    {images.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.title}
                      </option>
                    ))}
                  </Select>
                  {images.length === 0 && (
                    <p className="text-sm text-muted">Belum ada foto di Media. Unggah foto dulu untuk dipakai di panel.</p>
                  )}
                </>
              ) : (
                <>
                  <Input
                    label="Judul panel (opsional)"
                    value={sideTitle}
                    onChange={(e) => setSideTitle(e.target.value)}
                    maxLength={80}
                    placeholder="Menu hari ini"
                  />
                  <Field label="Teks panel">
                    {(id) => (
                      <textarea
                        id={id}
                        value={sideText}
                        onChange={(e) => setSideText(e.target.value)}
                        rows={3}
                        maxLength={300}
                        required
                        placeholder={'Nasi goreng spesial\nEs teh manis'}
                        className="w-full rounded-md border border-line bg-surface px-3 py-2 text-[0.95rem] text-ink"
                      />
                    )}
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid content-start gap-1.5">
                      <label htmlFor="send-side-bg" className="text-sm font-semibold">
                        Warna latar
                      </label>
                      <input
                        id="send-side-bg"
                        type="color"
                        value={sideBg}
                        onChange={(e) => setSideBg(e.target.value)}
                        className="h-11 w-16 cursor-pointer rounded-md border border-line bg-surface p-1"
                      />
                    </div>
                    <div className="grid content-start gap-1.5">
                      <label htmlFor="send-side-fg" className="text-sm font-semibold">
                        Warna teks
                      </label>
                      <input
                        id="send-side-fg"
                        type="color"
                        value={sideColor}
                        onChange={(e) => setSideColor(e.target.value)}
                        className="h-11 w-16 cursor-pointer rounded-md border border-line bg-surface p-1"
                      />
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>

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
        <Button
          type="submit"
          variant="primary"
          busy={busy}
          disabled={!content || !targetReady(target) || !tickerReady || !sideReady}
        >
          Kirim sekarang
        </Button>
      </form>
    </Modal>
  )
}
