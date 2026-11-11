import { Download } from 'lucide-react'
import { Link } from 'react-router'
import type { StatsReport } from '../shared/types'
import type { Device } from './lib/api'
import { Button, cx } from './ui'

const RANGES = [7, 30, 90]
const KIND_LABEL = { file: 'Video', youtube: 'YouTube', image: 'Foto' }
const shortDay = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const longDay = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

export const dayLabel = (day: string, long = false) => (long ? longDay : shortDay).format(new Date(`${day}T00:00:00Z`))

export function formatHours(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)} menit`
  return `${(seconds / 3600).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jam`
}

export const percent = (part: number, whole: number) => (whole > 0 ? `${Math.min(100, Math.round((part / whole) * 100))}%` : '0%')

/** Seconds each day could have been online at most: a full day, less for today and for the day the TV was paired. */
export function possible(report: StatsReport, device: Device, now = Date.now()): Record<string, number> {
  const out: Record<string, number> = {}
  for (const day of report.range) {
    const start = Date.parse(`${day}T00:00:00+07:00`)
    const from = Math.max(start, device.createdAt)
    const to = Math.min(start + 86_400_000, now)
    out[day] = Math.max(0, Math.round((to - from) / 1000))
  }
  return out
}

export function summarize(report: StatsReport, device: Device) {
  const cap = possible(report, device)
  const up = report.up[device.id] ?? {}
  const online = report.range.reduce((sum, day) => sum + Math.min(up[day] ?? 0, cap[day]), 0)
  const expected = report.range.reduce((sum, day) => sum + cap[day], 0)
  const plays = report.plays.filter((p) => p.deviceId === device.id)
  const played = plays.reduce((sum, p) => sum + p.seconds, 0)
  return { online, expected, played, plays }
}

export type TopItem = { mediaId: string; title: string; kind: string; seconds: number; times: number | null }

export function topMedia(report: StatsReport, plays: StatsReport['plays']): TopItem[] {
  const total = new Map<string, number>()
  for (const p of plays) total.set(p.mediaId, (total.get(p.mediaId) ?? 0) + p.seconds)
  return [...total]
    .map(([mediaId, seconds]) => {
      const media = report.media[mediaId]
      return {
        mediaId,
        title: media?.title ?? 'Konten yang sudah dihapus',
        kind: media ? KIND_LABEL[media.kind] : '',
        seconds,
        times: media?.duration ? Math.round(seconds / media.duration) : null,
      }
    })
    .sort((a, b) => b.seconds - a.seconds)
}

export function RangePicker({ report, days, onChange }: { report: StatsReport | undefined; days: number; onChange: (d: number) => void }) {
  const max = report?.maxDays ?? 7
  return (
    <div>
      <fieldset className="flex rounded-md border border-line bg-surface p-1">
        <legend className="sr-only">Rentang waktu</legend>
        {RANGES.map((d) => (
          <label
            key={d}
            className={cx(
              'flex min-h-9 items-center rounded px-3 text-sm font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink',
              d > max ? 'cursor-not-allowed text-muted/60' : 'cursor-pointer',
              days === d ? 'bg-ink text-bg' : d <= max && 'text-muted hover:text-ink',
            )}
          >
            <input type="radio" name="rentang" className="sr-only" checked={days === d} disabled={d > max} onChange={() => onChange(d)} />
            {d} hari
          </label>
        ))}
      </fieldset>
      {max < 90 && (
        <p className="mt-1 text-right text-sm text-muted">
          Riwayat lebih panjang ada di{' '}
          <Link to="/paket" className="font-semibold underline">
            paket lain
          </Link>
        </p>
      )}
    </div>
  )
}

export function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <p className="text-sm font-semibold text-muted">{label}</p>
      <p className="mt-0.5 text-2xl font-bold tabular-nums">{value}</p>
      {note && <p className="text-sm text-muted">{note}</p>}
    </div>
  )
}

/** One bar per day against a fixed ceiling. Each bar is focusable and shows its exact value on hover or focus. */
export function DayBars({
  title,
  days,
  values,
  ceiling,
  ceilingLabel,
  describe,
}: {
  title: string
  days: string[]
  values: Record<string, number>
  ceiling: number
  ceilingLabel: string
  describe: (seconds: number, day: string) => string
}) {
  return (
    <figure className="rounded-lg border border-line bg-surface p-4">
      <figcaption className="flex items-baseline justify-between gap-4">
        <span className="font-semibold">{title}</span>
        <span className="text-sm text-muted tabular-nums">skala sampai {ceilingLabel}</span>
      </figcaption>
      <ul className="mt-4 flex h-36 items-end gap-0.5 border-b border-line" aria-label={title}>
        {days.map((day, i) => {
          const value = values[day] ?? 0
          const edge = i < days.length / 3 ? 'left-0' : i > (days.length * 2) / 3 ? 'right-0' : 'left-1/2 -translate-x-1/2'
          return (
            <li key={day} tabIndex={0} className="group relative flex h-full min-w-0 flex-1 items-end outline-offset-0">
              <span
                className="w-full rounded-t bg-ink/80 group-hover:bg-brand group-focus-visible:bg-brand"
                style={{ height: `${Math.min(100, (value / ceiling) * 100)}%`, minHeight: value > 0 ? 2 : 0 }}
              />
              <span
                role="tooltip"
                className={cx(
                  'pointer-events-none absolute bottom-full z-10 mb-1 hidden rounded-md bg-ink px-2 py-1 text-xs font-semibold whitespace-nowrap text-bg group-hover:block group-focus-visible:block',
                  edge,
                )}
              >
                {dayLabel(day, true)}: {describe(value, day)}
              </span>
            </li>
          )
        })}
      </ul>
      <div className="mt-1 flex justify-between text-xs text-muted">
        <span>{dayLabel(days[0])}</span>
        <span>{dayLabel(days[days.length - 1])}</span>
      </div>
    </figure>
  )
}

export function TopList({ items, total }: { items: TopItem[]; total: number }) {
  const longest = items[0]?.seconds ?? 1
  return (
    <ol className="divide-y divide-line border-y border-line">
      {items.map((item) => (
        <li key={item.mediaId} className="grid gap-1 py-3 sm:grid-cols-[1fr_12rem] sm:items-center sm:gap-6">
          <div className="min-w-0">
            <p className="truncate font-semibold">{item.title}</p>
            <p className="text-sm text-muted">
              {[item.kind, item.times !== null && `sekitar ${item.times.toLocaleString('id-ID')} kali tayang`].filter(Boolean).join(', ')}
            </p>
          </div>
          <div>
            <p className="flex justify-between text-sm tabular-nums">
              <span className="font-semibold">{formatHours(item.seconds)}</span>
              <span className="text-muted">{percent(item.seconds, total)}</span>
            </p>
            <div className="mt-1 h-1.5 rounded-full bg-sunken" aria-hidden>
              <div className="h-full rounded-full bg-ink/80" style={{ width: `${(item.seconds / longest) * 100}%` }} />
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}

const csvCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`

export function CsvButton({ report, devices, name }: { report: StatsReport; devices: Device[]; name: string }) {
  const download = () => {
    const names = new Map(devices.map((d) => [d.id, d.name]))
    const rows = report.plays
      .filter((p) => names.has(p.deviceId))
      .sort((a, b) => a.day.localeCompare(b.day) || b.seconds - a.seconds)
      .map((p) => {
        const media = report.media[p.mediaId]
        return [p.day, names.get(p.deviceId)!, media?.title ?? 'Konten yang sudah dihapus', media ? KIND_LABEL[media.kind] : '', p.seconds, (p.seconds / 60).toFixed(1)]
      })
    const text = [['Tanggal', 'Layar', 'Konten', 'Jenis', 'Detik tayang', 'Menit tayang'], ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')
    // The BOM makes Excel read the file as UTF-8.
    const url = URL.createObjectURL(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${name}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <Button onClick={download} disabled={!report.plays.length}>
      <Download className="size-4" aria-hidden /> Unduh laporan tayang (CSV)
    </Button>
  )
}
