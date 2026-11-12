import { Megaphone, Pause, Play, Send, Square } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import type { Target } from '../../shared/types'
import { nowPlaying, ScreenTile, SendDialog, TargetPicker, targetReady } from '../components'
import { api, can, useAnnouncement, useBranches, useDevices, useMe, useMedia, useNotices, type Device, type Media } from '../lib/api'
import { formatAgo, formatDateTime, screenState, STATE_COLOR, STATE_LABEL, type ScreenState } from '../lib/format'
import { Button, Empty, Failed, Field, Loading, Modal, PageHeader, useAction } from '../ui'

const ACTION_DONE = { pause: 'Tayangan dijeda', resume: 'Tayangan dilanjutkan', stop: 'Tayangan dihentikan' }

function useControl() {
  const { run, busy } = useAction()
  const control = (action: 'pause' | 'resume' | 'stop', target: Target) =>
    run(() => api('POST', '/api/broadcasts/control', { action, target }), ACTION_DONE[action])
  return { control, busy }
}

function Controls({ target, devices, small }: { target: Target; devices: Device[]; small?: boolean }) {
  const { control, busy } = useControl()
  const states = devices.map((d) => screenState(d.live))
  const active = devices.filter((d) => d.live?.desired)
  if (!active.length) return null
  const anyPaused = active.some((d) => d.live?.desired?.paused)
  const anyRunning = active.some((d) => !d.live?.desired?.paused)
  return (
    <div className="flex flex-wrap gap-2" aria-label={`Kontrol tayangan, ${states.length} layar`}>
      {anyRunning && (
        <Button small={small} disabled={busy} onClick={() => control('pause', target)}>
          <Pause className="size-4" aria-hidden /> Jeda
        </Button>
      )}
      {anyPaused && (
        <Button small={small} disabled={busy} onClick={() => control('resume', target)}>
          <Play className="size-4" aria-hidden /> Lanjutkan
        </Button>
      )}
      <Button small={small} disabled={busy} onClick={() => control('stop', target)}>
        <Square className="size-4" aria-hidden /> Hentikan
      </Button>
    </div>
  )
}

export default function Monitor() {
  const me = useMe()
  const devices = useDevices()
  const branches = useBranches()
  const media = useMedia()
  const notices = useNotices()
  const announcement = useAnnouncement()
  const { run } = useAction()
  const [sending, setSending] = useState<Target | null>(null)
  const [announcing, setAnnouncing] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const mayBroadcast = can(me.data, 'broadcast')
  const mayAnnounce = mayBroadcast && me.data?.tenant.plan !== 'free'

  const stopAnnouncement = () => {
    if (!confirm('Matikan pengumuman darurat dan kembalikan tayangan semula di layar?')) return
    run(() => api('DELETE', '/api/announcements'), 'Pengumuman darurat dimatikan')
  }

  if (devices.isPending || branches.isPending) return <Loading what="status layar" />
  if (devices.error || branches.error) {
    return <Failed error={devices.error ?? branches.error} retry={() => (devices.refetch(), branches.refetch())} />
  }

  const all = devices.data
  const count = (...states: ScreenState[]) => all.filter((d) => states.includes(screenState(d.live))).length
  const online = all.length - count('offline', 'never')
  const troubled = count('offline', 'error')
  const opened = all.find((d) => d.id === openId)
  const latestNotice = notices.data?.[0]

  return (
    <>
      <PageHeader
        title="Pantau"
        lead={
          all.length
            ? `${online} dari ${all.length} layar online, ${count('playing')} sedang memutar.` +
              (troubled ? ` ${troubled} layar perlu dicek.` : '')
            : undefined
        }
        action={
          mayBroadcast &&
          all.length > 0 && (
            <>
              <Controls target={{ type: 'all', ids: [] }} devices={all} />
              {announcement.data
                ? mayBroadcast && (
                    <Button variant="danger" onClick={stopAnnouncement}>
                      <Megaphone className="size-4" aria-hidden /> Matikan pengumuman
                    </Button>
                  )
                : mayAnnounce && (
                    <Button onClick={() => setAnnouncing(true)}>
                      <Megaphone className="size-4" aria-hidden /> Pengumuman darurat
                    </Button>
                  )}
              <Button variant="primary" onClick={() => setSending({ type: 'all', ids: [] })}>
                <Send className="size-4" aria-hidden /> Kirim tayangan
              </Button>
            </>
          )
        }
      />

      {announcement.data && (
        <div
          role="alert"
          className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-bad/50 bg-bad/10 px-4 py-3"
        >
          <p className="min-w-0">
            <span className="font-semibold">Pengumuman darurat aktif:</span> {announcement.data.text}
          </p>
          {mayBroadcast && (
            <Button small variant="danger" onClick={stopAnnouncement}>
              Matikan
            </Button>
          )}
        </div>
      )}

      {latestNotice && Date.now() - latestNotice.createdAt < 86_400_000 && (
        <p role="status" className="mb-6 rounded-md border border-warn/50 bg-warn/10 px-4 py-3">
          <span className="font-semibold">{latestNotice.title}</span> ({formatAgo(latestNotice.createdAt)}): {latestNotice.body}
        </p>
      )}

      {all.length === 0 ? (
        <Empty
          title="Belum ada layar yang terhubung"
          action={
            can(me.data, 'device') && (
              <Link
                to="/layar"
                className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 font-semibold text-on-brand"
              >
                Hubungkan TV pertama
              </Link>
            )
          }
        >
          Buka halaman pemutar di TV, lalu masukkan kode yang muncul di layarnya lewat menu Layar.
        </Empty>
      ) : (
        <div className="grid gap-9">
          {branches.data
            .map((branch) => ({ branch, list: all.filter((d) => d.branchId === branch.id) }))
            .filter((group) => group.list.length)
            .map(({ branch, list }) => {
              const down = list.filter((d) => ['offline', 'error'].includes(screenState(d.live))).length
              return (
                <section key={branch.id} aria-labelledby={`cabang-${branch.id}`}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-2">
                    <h2 id={`cabang-${branch.id}`} className="text-lg font-bold">
                      {branch.name}{' '}
                      <span className="text-base font-medium text-muted">
                        {list.length} layar{down ? `, ${down} bermasalah` : ''}
                      </span>
                    </h2>
                    {mayBroadcast && (
                      <div className="flex flex-wrap gap-2">
                        <Controls small target={{ type: 'branch', ids: [branch.id] }} devices={list} />
                        <Button small onClick={() => setSending({ type: 'branch', ids: [branch.id] })}>
                          Kirim ke cabang ini
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {list.map((d) => (
                      <ScreenTile key={d.id} device={d} media={media.data?.items} onClick={() => setOpenId(d.id)} />
                    ))}
                  </div>
                </section>
              )
            })}
        </div>
      )}

      {sending && <SendDialog presetTarget={sending} onClose={() => setSending(null)} />}
      {announcing && <AnnouncementDialog onClose={() => setAnnouncing(false)} />}

      {opened && (
        <Modal title={opened.name} onClose={() => setOpenId(null)}>
          <ScreenDetail
            device={opened}
            media={media.data?.items}
            branchName={branches.data.find((b) => b.id === opened.branchId)?.name ?? ''}
            mayBroadcast={mayBroadcast}
            onSend={() => {
              setOpenId(null)
              setSending({ type: 'device', ids: [opened.id] })
            }}
          />
        </Modal>
      )}
    </>
  )
}

function AnnouncementDialog({ onClose }: { onClose: () => void }) {
  const { run, busy } = useAction()
  const [text, setText] = useState('')
  const [bg, setBg] = useState('#b91c1c')
  const [target, setTarget] = useState<Target>({ type: 'all', ids: [] })

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const res = await run(
      () => api<{ screens: number }>('POST', '/api/announcements', { text: text.trim(), bg, target }),
      (r) => `Pengumuman tampil di ${r.screens} layar`,
    )
    if (res) onClose()
  }

  return (
    <Modal title="Pengumuman darurat" onClose={onClose}>
      <form onSubmit={submit} className="grid gap-5">
        <p className="rounded-md border border-warn/50 bg-warn/10 px-3 py-2 text-sm">
          Menimpa layar yang dipilih dengan pesan besar. Tayangan yang sedang berjalan tidak hilang dan lanjut lagi saat
          pengumuman dimatikan.
        </p>
        <Field label="Isi pengumuman">
          {(id) => (
            <textarea
              id={id}
              value={text}
              onChange={(e) => setText(e.target.value)}
              required
              maxLength={400}
              rows={3}
              placeholder="Contoh: Toko tutup lebih awal pukul 20.00"
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-[0.95rem] text-ink"
            />
          )}
        </Field>
        <div className="grid content-start gap-1.5">
          <label htmlFor="announcement-bg" className="text-sm font-semibold">
            Warna latar
          </label>
          <input
            id="announcement-bg"
            type="color"
            value={bg}
            onChange={(e) => setBg(e.target.value)}
            className="h-11 w-16 cursor-pointer rounded-md border border-line bg-surface p-1"
          />
        </div>
        <TargetPicker value={target} onChange={setTarget} />
        <Button type="submit" variant="primary" busy={busy} disabled={!text.trim() || !targetReady(target)}>
          Tampilkan sekarang
        </Button>
      </form>
    </Modal>
  )
}

function ScreenDetail({
  device,
  media,
  branchName,
  mayBroadcast,
  onSend,
}: {
  device: Device
  media: Media[] | undefined
  branchName: string
  mayBroadcast: boolean
  onSend: () => void
}) {
  const state = screenState(device.live)
  const live = device.live
  const now = nowPlaying(device, media)
  const rows: [string, string | undefined][] = [
    ['Cabang', branchName],
    ['Tayangan yang dikirim', live?.desired?.name ?? 'Tidak ada'],
    ['Sedang diputar', live?.online ? live.reported?.title : undefined],
    ['Laporan terakhir dari TV', live?.reported ? formatDateTime(live.reported.at) : undefined],
    ['Terakhir terlihat', live?.lastSeen && !live.online ? formatDateTime(live.lastSeen) : undefined],
    ['Video tersimpan di TV', live?.reported?.cached != null ? `${live.reported.cached} video` : undefined],
    ['Pesan error', state === 'error' ? live?.reported?.error : undefined],
  ]
  return (
    <div className="grid gap-5">
      <p className={`text-lg font-bold ${STATE_COLOR[state]}`}>{STATE_LABEL[state]}</p>
      {now?.src && (
        <figure className="grid gap-1.5">
          <div className="relative overflow-hidden rounded-md bg-screen">
            <img src={now.src} alt="" className="aspect-video w-full object-cover" />
            <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-3 pt-10 pb-2">
              <p className="text-sm font-semibold text-white">{now.title}</p>
              {now.progress != null && (
                <span aria-hidden className="mt-1 block h-1 rounded bg-white/25">
                  <span className="block h-full rounded bg-white" style={{ width: `${now.progress}%` }} />
                </span>
              )}
            </figcaption>
          </div>
          <p className="text-sm text-muted">
            Pratinjau konten yang sedang diputar, bukan tangkapan layar TV. Teks berjalan dan tampilan lain di TV tidak ikut terlihat.
          </p>
        </figure>
      )}
      <dl className="grid gap-3">
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label} className="grid gap-0.5 sm:grid-cols-[11rem_1fr]">
              <dt className="text-sm text-muted">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
      </dl>
      {state === 'never' && (
        <p className="text-sm text-muted">TV ini sudah didaftarkan tetapi belum pernah membuka halaman pemutar.</p>
      )}
      {mayBroadcast && (
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <Controls target={{ type: 'device', ids: [device.id] }} devices={[device]} />
          <Button variant="primary" onClick={onSend}>
            <Send className="size-4" aria-hidden /> Kirim tayangan ke TV ini
          </Button>
        </div>
      )}
    </div>
  )
}
