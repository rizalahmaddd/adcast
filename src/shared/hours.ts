import type { OpeningHours } from './types'

export const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Minutes since midnight in the branch's timezone. */
export function localMinutes(now: number, offset: number) {
  const date = new Date(now + offset * 3_600_000)
  return date.getUTCHours() * 60 + date.getUTCMinutes()
}

/**
 * Null while the branch is open, otherwise what the TV should show instead.
 * A close time earlier than the open time means the shop is open past midnight.
 */
export function closedNow(hours: OpeningHours | null | undefined, now: number, offset: number) {
  if (!hours?.enabled || !hours.open || !hours.close) return null
  const open = minutesOf(hours.open)
  const close = minutesOf(hours.close)
  const at = localMinutes(now, offset)
  const openNow = open === close || (close > open ? at >= open && at < close : at >= open || at < close)
  return openNow ? null : { open: hours.open, text: hours.text }
}
