import { ArrowDown, ArrowUp, Plus, Send, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { SendDialog, thumbUrl } from '../components'
import { api, can, useMe, useMedia, usePlaylists, type Media, type Playlist } from '../lib/api'
import { formatDuration } from '../lib/format'
import { Button, Empty, Failed, Input, Loading, Modal, PageHeader, useAction } from '../ui'

export default function Playlists() {
  const me = useMe()
  const playlists = usePlaylists()
  const media = useMedia()
  const { run } = useAction()
  const [editing, setEditing] = useState<Playlist | 'new' | null>(null)
  const [sending, setSending] = useState<Playlist | null>(null)

  const mayManage = can(me.data, 'playlist')

  if (playlists.isPending || media.isPending) return <Loading what="playlist" />
  if (playlists.error || media.error) {
    return <Failed error={playlists.error ?? media.error} retry={() => (playlists.refetch(), media.refetch())} />
  }

  const byId = new Map(media.data.items.map((m) => [m.id, m]))
  const ready = media.data.items.filter((m) => m.status === 'ready')

  const remove = (p: Playlist) => {
    if (!confirm(`Hapus playlist "${p.name}"? Videonya tetap ada di menu Video.`)) return
    run(() => api('DELETE', `/api/playlists/${p.id}`), 'Playlist dihapus')
  }

  return (
    <>
      <PageHeader
        title="Playlist"
        lead="Urutan beberapa video yang diputar bergantian dan berulang."
        action={
          mayManage && (
            <Button variant="primary" onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden /> Buat playlist
            </Button>
          )
        }
      />

      {playlists.data.length === 0 ? (
        <Empty title="Belum ada playlist">
          {ready.length
            ? 'Gabungkan beberapa video menjadi satu tayangan, misalnya promo harian untuk semua cabang.'
            : 'Tambahkan video dulu di menu Video, lalu susun di sini.'}
        </Empty>
      ) : (
        <ul className="grid gap-3">
          {playlists.data.map((p) => {
            const items = p.mediaIds.map((id) => byId.get(id)).filter((m): m is Media => !!m)
            const total = items.reduce((sum, m) => sum + (m.duration ?? 0), 0)
            return (
              <li key={p.id} className="rounded-lg border border-line bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold">{p.name}</h2>
                    <p className="text-sm text-muted">
                      {items.length} video{total ? `, total ${formatDuration(total)}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {can(me.data, 'broadcast') && items.length > 0 && (
                      <Button small onClick={() => setSending(p)}>
                        <Send className="size-4" aria-hidden /> Kirim
                      </Button>
                    )}
                    {mayManage && (
                      <>
                        <Button small onClick={() => setEditing(p)}>
                          Ubah
                        </Button>
                        <Button small variant="danger" onClick={() => remove(p)}>
                          Hapus
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {items.length > 0 && (
                  <ol className="mt-3 flex gap-2 overflow-x-auto pb-1">
                    {items.map((m, i) => (
                      <li key={`${m.id}-${i}`} className="w-32 shrink-0">
                        <Thumb media={m} />
                        <p className="mt-1 truncate text-sm">{m.title}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {editing && (
        <PlaylistEditor playlist={editing === 'new' ? null : editing} library={ready} onClose={() => setEditing(null)} />
      )}
      {sending && (
        <SendDialog preset={{ value: `playlist:${sending.id}`, name: sending.name }} onClose={() => setSending(null)} />
      )}
    </>
  )
}

function Thumb({ media }: { media: Media }) {
  const src = thumbUrl(media)
  return (
    <div className="aspect-video overflow-hidden rounded bg-screen">
      {src && <img src={src} alt="" loading="lazy" className="size-full object-cover" />}
    </div>
  )
}

function PlaylistEditor({
  playlist,
  library,
  onClose,
}: {
  playlist: Playlist | null
  library: Media[]
  onClose: () => void
}) {
  const { run, busy } = useAction()
  const [name, setName] = useState(playlist?.name ?? '')
  const [ids, setIds] = useState<string[]>(playlist?.mediaIds.filter((id) => library.some((m) => m.id === id)) ?? [])

  const move = (index: number, by: number) =>
    setIds((list) => {
      const next = [...list]
      const [item] = next.splice(index, 1)
      next.splice(index + by, 0, item)
      return next
    })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const body = { name, mediaIds: ids }
    const ok = await run(
      () => (playlist ? api('PUT', `/api/playlists/${playlist.id}`, body) : api('POST', '/api/playlists', body)),
      'Playlist disimpan',
    )
    if (ok) onClose()
  }

  return (
    <Modal title={playlist ? 'Ubah playlist' : 'Buat playlist'} onClose={onClose} wide>
      <form onSubmit={submit} className="grid gap-5">
        <Input label="Nama playlist" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoFocus />

        <div>
          <p className="mb-2 text-sm font-semibold">Urutan tayang</p>
          {ids.length === 0 ? (
            <p className="rounded-md border border-dashed border-line px-3 py-4 text-sm text-muted">
              Belum ada video. Pilih dari daftar di bawah.
            </p>
          ) : (
            <ol className="grid gap-1.5">
              {ids.map((id, i) => {
                const m = library.find((x) => x.id === id)!
                return (
                  <li key={`${id}-${i}`} className="flex items-center gap-3 rounded-md border border-line p-1.5">
                    <span className="w-6 text-center text-sm font-semibold text-muted">{i + 1}</span>
                    <div className="w-16 shrink-0">
                      <Thumb media={m} />
                    </div>
                    <p className="min-w-0 flex-1 truncate font-medium">{m.title}</p>
                    <IconButton label={`Naikkan ${m.title}`} disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp className="size-4" aria-hidden />
                    </IconButton>
                    <IconButton label={`Turunkan ${m.title}`} disabled={i === ids.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown className="size-4" aria-hidden />
                    </IconButton>
                    <IconButton label={`Keluarkan ${m.title}`} onClick={() => setIds((list) => list.filter((_, x) => x !== i))}>
                      <X className="size-4" aria-hidden />
                    </IconButton>
                  </li>
                )
              })}
            </ol>
          )}
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold">Tambahkan video</p>
          {library.length === 0 ? (
            <p className="text-sm text-muted">Belum ada video siap tayang. Tambahkan lewat menu Video.</p>
          ) : (
            <ul className="grid max-h-56 gap-1 overflow-y-auto">
              {library.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => setIds((list) => [...list, m.id])}
                    className="flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-left hover:bg-sunken"
                  >
                    <Plus className="size-4 shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{m.title}</span>
                    <span className="text-sm text-muted">{formatDuration(m.duration)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Button type="submit" variant="primary" busy={busy} disabled={!name.trim()}>
          Simpan playlist
        </Button>
      </form>
    </Modal>
  )
}

function IconButton({
  label,
  children,
  ...rest
}: {
  label: string
  children: React.ReactNode
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      {...rest}
      className="grid size-11 shrink-0 place-items-center rounded-md hover:bg-sunken disabled:opacity-35 sm:size-9"
    >
      {children}
    </button>
  )
}
