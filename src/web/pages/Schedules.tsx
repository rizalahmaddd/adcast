import { Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { Target } from '../../shared/types'
import { ContentSelect, splitContent, TargetPicker, targetReady } from '../components'
import { api, can, useBranches, useDevices, useMe, useMedia, usePlaylists, useSchedules, type Schedule } from '../lib/api'
import { DAY_NAMES } from '../lib/format'
import { Button, Check, cx, Empty, Failed, Input, Loading, Modal, PageHeader, useAction } from '../ui'

export default function Schedules() {
  const me = useMe()
  const schedules = useSchedules()
  const media = useMedia()
  const playlists = usePlaylists()
  const branches = useBranches()
  const devices = useDevices()
  const { run } = useAction()
  const [editing, setEditing] = useState<Schedule | 'new' | null>(null)

  const mayManage = can(me.data, 'schedule')

  if (schedules.isPending) return <Loading what="jadwal" />
  if (schedules.error) return <Failed error={schedules.error} retry={() => schedules.refetch()} />

  const contentName = (s: Schedule) =>
    s.contentType === 'playlist'
      ? (playlists.data?.find((p) => p.id === s.contentId)?.name ?? 'Playlist terhapus')
      : (media.data?.items.find((m) => m.id === s.contentId)?.title ?? 'Video terhapus')

  const targetName = (t: Target) => {
    if (t.type === 'all') return 'Semua TV'
    const pool = t.type === 'branch' ? branches.data : devices.data
    const names = t.ids.map((id) => pool?.find((x) => x.id === id)?.name).filter(Boolean)
    return names.length ? names.join(', ') : 'Tujuan terhapus'
  }

  const dayText = (days: number[]) =>
    days.length === 7 ? 'Setiap hari' : [1, 2, 3, 4, 5, 6, 0].filter((d) => days.includes(d)).map((d) => DAY_NAMES[d]).join(', ')

  const toggle = (s: Schedule) =>
    run(
      () => api('PUT', `/api/schedules/${s.id}`, { ...s, enabled: !s.enabled }),
      s.enabled ? 'Jadwal dimatikan' : 'Jadwal dinyalakan',
    )

  const remove = (s: Schedule) => {
    if (!confirm(`Hapus jadwal "${s.name}"?`)) return
    run(() => api('DELETE', `/api/schedules/${s.id}`), 'Jadwal dihapus')
  }

  return (
    <>
      <PageHeader
        title="Jadwal"
        lead="Tayangan mulai otomatis pada jam yang ditentukan, mengikuti waktu setempat tiap cabang (WIB, WITA, atau WIT)."
        action={
          mayManage && (
            <Button variant="primary" onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden /> Buat jadwal
            </Button>
          )
        }
      />

      {schedules.data.length === 0 ? (
        <Empty title="Belum ada jadwal">
          Contoh pemakaian: promo makan siang yang tayang pukul 11.00 sampai 13.00 setiap hari kerja.
        </Empty>
      ) : (
        <ul className="grid gap-3">
          {schedules.data.map((s) => (
            <li
              key={s.id}
              className={cx(
                'grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-[8.5rem_1fr_auto] sm:items-center',
                !s.enabled && 'opacity-70',
              )}
            >
              <p className="text-2xl font-bold tabular-nums">
                {s.startTime}
                {s.endTime && <span className="block text-base font-medium text-muted">sampai {s.endTime}</span>}
              </p>
              <div className="min-w-0">
                <h2 className="font-bold">
                  {s.name} {!s.enabled && <span className="font-medium text-muted">(dimatikan)</span>}
                </h2>
                <p className="text-sm text-muted">
                  {dayText(s.days)}. Memutar {contentName(s)} di {targetName(s.target)}.
                </p>
              </div>
              {mayManage && (
                <div className="flex flex-wrap gap-2">
                  <Button small onClick={() => toggle(s)}>
                    {s.enabled ? 'Matikan' : 'Nyalakan'}
                  </Button>
                  <Button small onClick={() => setEditing(s)}>
                    Ubah
                  </Button>
                  <Button small variant="danger" onClick={() => remove(s)}>
                    Hapus
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && <ScheduleEditor schedule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function ScheduleEditor({ schedule, onClose }: { schedule: Schedule | null; onClose: () => void }) {
  const { run, busy } = useAction()
  const [name, setName] = useState(schedule?.name ?? '')
  const [content, setContent] = useState(schedule ? `${schedule.contentType}:${schedule.contentId}` : '')
  const [target, setTarget] = useState<Target>(schedule?.target ?? { type: 'all', ids: [] })
  const [days, setDays] = useState<number[]>(schedule?.days ?? [1, 2, 3, 4, 5])
  const [startTime, setStartTime] = useState(schedule?.startTime ?? '11:00')
  const [endTime, setEndTime] = useState(schedule?.endTime ?? '')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const body = {
      name,
      ...splitContent(content),
      target,
      days,
      startTime,
      endTime: endTime || null,
      enabled: schedule?.enabled ?? true,
    }
    const ok = await run(
      () => (schedule ? api('PUT', `/api/schedules/${schedule.id}`, body) : api('POST', '/api/schedules', body)),
      'Jadwal disimpan',
    )
    if (ok) onClose()
  }

  return (
    <Modal title={schedule ? 'Ubah jadwal' : 'Buat jadwal'} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-5">
        <Input
          label="Nama jadwal"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={120}
          placeholder="Promo makan siang"
          autoFocus
        />
        <ContentSelect value={content} onChange={setContent} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Jam mulai" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
          <Input label="Jam selesai (opsional)" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </div>
        <p className="-mt-3 text-sm text-muted">
          Tanpa jam selesai, tayangan terus diputar sampai diganti atau dihentikan.
        </p>
        <fieldset>
          <legend className="mb-1 text-sm font-semibold">Hari tayang</legend>
          <div className="grid grid-cols-4 gap-x-1 sm:grid-cols-7">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <Check
                key={d}
                label={DAY_NAMES[d]}
                checked={days.includes(d)}
                onChange={() => setDays((list) => (list.includes(d) ? list.filter((x) => x !== d) : [...list, d]))}
              />
            ))}
          </div>
        </fieldset>
        <TargetPicker value={target} onChange={setTarget} />
        <Button
          type="submit"
          variant="primary"
          busy={busy}
          disabled={!content || !days.length || !targetReady(target) || !name.trim()}
        >
          Simpan jadwal
        </Button>
      </form>
    </Modal>
  )
}
