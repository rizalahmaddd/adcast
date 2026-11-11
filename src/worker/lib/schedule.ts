const DAY = 86_400_000
const HOUR = 3_600_000

export type ScheduleTimes = {
  days: number[]
  start: string
  end: string | null
}

const toMs = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * HOUR + m * 60_000
}

// Indonesian zones have no DST, so a fixed hour offset is enough.
function occurrences(s: ScheduleTimes, offsetHours: number, around: number, daysBack: number, daysAhead: number) {
  const offset = offsetHours * HOUR
  const localMidnight = Math.floor((around + offset) / DAY) * DAY
  const startMs = toMs(s.start)
  const endMs = s.end ? toMs(s.end) + (toMs(s.end) <= startMs ? DAY : 0) : null
  const out: { start: number; end: number | null }[] = []
  for (let d = -daysBack; d <= daysAhead; d++) {
    const midnight = localMidnight + d * DAY
    const weekday = new Date(midnight).getUTCDay()
    if (!s.days.includes(weekday)) continue
    out.push({
      start: midnight + startMs - offset,
      end: endMs === null ? null : midnight + endMs - offset,
    })
  }
  return out
}

/** Start/end events that fall inside (after, upTo]. */
export function eventsBetween(s: ScheduleTimes, offsetHours: number, after: number, upTo: number) {
  const events: { type: 'start' | 'end'; at: number }[] = []
  for (const o of occurrences(s, offsetHours, upTo, 2, 0)) {
    if (o.start > after && o.start <= upTo) events.push({ type: 'start', at: o.start })
    if (o.end !== null && o.end > after && o.end <= upTo) events.push({ type: 'end', at: o.end })
  }
  return events.sort((a, b) => a.at - b.at)
}

export function nextEventAfter(s: ScheduleTimes, offsetHours: number, now: number): number | null {
  let next: number | null = null
  for (const o of occurrences(s, offsetHours, now, 1, 8)) {
    for (const at of [o.start, o.end]) {
      if (at !== null && at > now && (next === null || at < next)) next = at
    }
  }
  return next
}
