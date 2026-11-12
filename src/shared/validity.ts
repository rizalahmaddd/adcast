/** Local calendar date as `YYYY-MM-DD` for an Indonesian zone offset. */
export function calendarDay(now: number, offsetHours = 7): string {
  return new Date(now + offsetHours * 3_600_000).toISOString().slice(0, 10)
}

/** Both bounds are inclusive; a missing bound means no limit on that side. */
export function withinValidity(startDate: string | null, endDate: string | null, today: string): boolean {
  if (startDate && startDate > today) return false
  if (endDate && endDate < today) return false
  return true
}
