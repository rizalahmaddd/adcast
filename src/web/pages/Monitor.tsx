import { Pause, Play, Send, Square } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import type { Target } from '../../shared/types'
import { ScreenTile, SendDialog } from '../components'
import { api, can, useBranches, useDevices, useMe, useNotices, type Device } from '../lib/api'
import { formatAgo, formatDateTime, screenState, STATE_COLOR, STATE_LABEL, type ScreenState } from '../lib/format'
import { Button, Empty, Failed, Loading, Modal, PageHeader, useAction } from '../ui'

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
  const notices = useNotices()
  const [sending, setSending] = useState<Target | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const mayBroadcast = can(me.data, 'broadcast')

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
              <Button variant="primary" onClick={() => setSending({ type: 'all', ids: [] })}>
                <Send className="size-4" aria-hidden /> Kirim tayangan
              </Button>
            </>
          )
        }
      />

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
                      <ScreenTile key={d.id} device={d} onClick={() => setOpenId(d.id)} />
                    ))}
                  </div>
                </section>
              )
            })}
        </div>
      )}

      {sending && <SendDialog presetTarget={sending} onClose={() => setSending(null)} />}

      {opened && (
        <Modal title={opened.name} onClose={() => setOpenId(null)}>
          <ScreenDetail
            device={opened}
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

function ScreenDetail({
  device,
  branchName,
  mayBroadcast,
  onSend,
}: {
  device: Device
  branchName: string
  mayBroadcast: boolean
  onSend: () => void
}) {
  const state = screenState(device.live)
  const live = device.live
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
