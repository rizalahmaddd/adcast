import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useBranches, useDevices, useStats } from '../lib/api'
import { formatAgo, screenState, STATE_COLOR, STATE_LABEL } from '../lib/format'
import { CsvButton, DayBars, formatHours, percent, possible, RangePicker, summarize, Tile, TopList, topMedia } from '../stats'
import { Empty, Failed, Loading, PageHeader } from '../ui'

export default function ScreenStats() {
  const { id } = useParams()
  const [days, setDays] = useState(7)
  const stats = useStats(days)
  const devices = useDevices()
  const branches = useBranches()

  if (stats.isPending || devices.isPending || branches.isPending) return <Loading what="statistik layar" />
  if (stats.error || devices.error || branches.error) {
    return <Failed error={stats.error ?? devices.error ?? branches.error} retry={() => stats.refetch()} />
  }

  const device = devices.data.find((d) => d.id === id)
  if (!device) {
    return (
      <Empty title="Layar tidak ditemukan">
        Layar ini mungkin sudah dilepas. <Link to="/layar" className="font-semibold underline">Kembali ke daftar layar</Link>
      </Empty>
    )
  }

  const report = stats.data
  const { online, expected, played, plays } = summarize(report, device)
  const cap = possible(report, device)
  const up = report.up[device.id] ?? {}
  const playedByDay: Record<string, number> = {}
  for (const p of plays) playedByDay[p.day] = (playedByDay[p.day] ?? 0) + p.seconds
  const top = topMedia(report, plays)
  const state = screenState(device.live)
  const branch = branches.data.find((b) => b.id === device.branchId)
  const lastSeen = device.live?.lastSeen

  return (
    <>
      <Link to="/layar" className="mb-3 inline-flex min-h-11 items-center gap-2 font-semibold text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Semua layar
      </Link>
      <PageHeader
        title={device.name}
        lead={
          <>
            {branch?.name}. <span className={`font-semibold ${STATE_COLOR[state]}`}>{STATE_LABEL[state]}</span>
            {device.live?.reported?.title && state === 'playing' ? `: ${device.live.reported.title}` : ''}
            {!device.live?.online && lastSeen ? `, terakhir terlihat ${formatAgo(lastSeen)}` : ''}
          </>
        }
        action={<RangePicker report={report} days={days} onChange={setDays} />}
      />

      <div className="grid gap-8">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Online" value={percent(online, expected)} note={`${formatHours(online)} dari ${formatHours(expected)}`} />
          <Tile label="Waktu tayang" value={formatHours(played)} note={`${percent(played, online)} dari waktu online`} />
          <Tile label="Rata-rata per hari" value={formatHours(played / report.range.length)} note="waktu tayang" />
          <Tile label="Konten berbeda" value={String(top.length)} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <DayBars
            title="Online per hari"
            days={report.range}
            values={up}
            ceiling={86_400}
            ceilingLabel="24 jam"
            describe={(seconds, day) => `online ${formatHours(seconds)} (${percent(seconds, cap[day])})`}
          />
          <DayBars
            title="Waktu tayang per hari"
            days={report.range}
            values={playedByDay}
            ceiling={86_400}
            ceilingLabel="24 jam"
            describe={(seconds) => `tayang ${formatHours(seconds)}`}
          />
        </div>

        <section aria-labelledby="konten-layar">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="konten-layar" className="text-xl font-bold">
              Konten yang tayang di layar ini
            </h2>
            <CsvButton report={report} devices={[device]} name={`adcast-${device.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${report.days}-hari`} />
          </div>
          <div className="mt-3">
            {top.length ? (
              <TopList items={top} total={played} />
            ) : (
              <p className="text-muted">
                Belum ada tayangan tercatat pada rentang ini. Catatan baru masuk paling lambat 10 menit setelah TV mulai memutar.
              </p>
            )}
          </div>
        </section>
      </div>
    </>
  )
}
