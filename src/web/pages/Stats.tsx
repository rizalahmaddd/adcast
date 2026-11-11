import { useState } from 'react'
import { Link } from 'react-router'
import { useBranches, useDevices, useStats } from '../lib/api'
import { CsvButton, formatHours, percent, RangePicker, summarize, Tile, TopList, topMedia } from '../stats'
import { Empty, Failed, Loading, PageHeader } from '../ui'

export default function Stats() {
  const [days, setDays] = useState(7)
  const stats = useStats(days)
  const devices = useDevices()
  const branches = useBranches()

  if (stats.isPending || devices.isPending || branches.isPending) return <Loading what="statistik" />
  if (stats.error || devices.error || branches.error) {
    return <Failed error={stats.error ?? devices.error ?? branches.error} retry={() => stats.refetch()} />
  }

  const report = stats.data
  const rows = devices.data.map((device) => ({ device, ...summarize(report, device) }))
  const online = rows.reduce((sum, r) => sum + r.online, 0)
  const expected = rows.reduce((sum, r) => sum + r.expected, 0)
  const played = rows.reduce((sum, r) => sum + r.played, 0)
  const top = topMedia(report, report.plays.filter((p) => devices.data.some((d) => d.id === p.deviceId)))
  const branchName = new Map(branches.data.map((b) => [b.id, b.name]))

  return (
    <>
      <PageHeader
        title="Statistik"
        lead={`Ringkasan ${report.days} hari terakhir untuk semua layar. TV mengirim catatan tayangnya tiap 10 menit.`}
        action={<RangePicker report={report} days={days} onChange={setDays} />}
      />
      {devices.data.length === 0 ? (
        <Empty title="Belum ada layar">Statistik muncul setelah ada TV yang terhubung dan menayangkan sesuatu.</Empty>
      ) : (
        <div className="grid gap-10">
          <div className="grid gap-3 sm:grid-cols-3">
            <Tile label="Rata-rata online" value={percent(online, expected)} note="dari waktu sejak tiap TV dihubungkan" />
            <Tile label="Total waktu tayang" value={formatHours(played)} note={`di ${rows.filter((r) => r.played > 0).length} layar`} />
            <Tile label="Konten yang tayang" value={String(top.length)} />
          </div>

          <section aria-labelledby="per-layar" className="min-w-0">
            <h2 id="per-layar" className="text-xl font-bold">
              Per layar
            </h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left">
                <thead className="border-b border-line text-sm text-muted">
                  <tr>
                    <th className="py-2 pr-4 font-semibold">Layar</th>
                    <th className="py-2 pr-4 font-semibold">Online</th>
                    <th className="py-2 pr-4 font-semibold">Waktu tayang</th>
                    <th className="py-2 font-semibold">Paling sering tayang</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows
                    .sort((a, b) => b.played - a.played)
                    .map(({ device, online, expected, played, plays }) => (
                      <tr key={device.id}>
                        <td className="py-3 pr-4">
                          <Link to={`/layar/${device.id}`} className="font-semibold underline">
                            {device.name}
                          </Link>
                          <span className="block text-sm text-muted">{branchName.get(device.branchId)}</span>
                        </td>
                        <td className="py-3 pr-4 tabular-nums">{percent(online, expected)}</td>
                        <td className="py-3 pr-4 tabular-nums">{formatHours(played)}</td>
                        <td className="max-w-56 truncate py-3">{topMedia(report, plays)[0]?.title ?? 'Belum ada tayangan'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="konten">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="konten" className="text-xl font-bold">
                Konten di semua layar
              </h2>
              <CsvButton report={report} devices={devices.data} name={`adcast-laporan-tayang-${report.days}-hari`} />
            </div>
            <div className="mt-3">
              {top.length ? (
                <TopList items={top.slice(0, 20)} total={played} />
              ) : (
                <p className="text-muted">Belum ada tayangan tercatat pada rentang ini.</p>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  )
}
