export const PRAYERS = ['subuh', 'dzuhur', 'ashar', 'maghrib', 'isya'] as const
export type Prayer = (typeof PRAYERS)[number]
export const PRAYER_LABEL: Record<Prayer, string> = {
  subuh: 'Subuh',
  dzuhur: 'Dzuhur',
  ashar: 'Ashar',
  maghrib: 'Maghrib',
  isya: 'Isya',
}

/** What a TV needs to work out prayer times on its own, so the pause still happens while it is offline. */
export type PrayerConfig = {
  lat: number
  lng: number
  /** Hours ahead of UTC at the branch. */
  offset: number
  /** Minutes the broadcast stays paused from the start of each prayer time. */
  pause: number
  /** Same, for the Friday midday prayer. */
  jumat: number
}

const rad = (deg: number) => (deg * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI
const fix = (value: number, by: number) => ((value % by) + by) % by

// Kemenag convention: sun 20 degrees below the horizon for Subuh, 18 for Isya,
// and 2 minutes of safety margin (ihtiyat) added to every time.
const SUBUH_ANGLE = 20
const ISYA_ANGLE = 18
const HORIZON = 0.833
const IHTIYAT = 2

function julian(year: number, month: number, day: number) {
  if (month <= 2) {
    year -= 1
    month += 12
  }
  const a = Math.floor(year / 100)
  const b = 2 - a + Math.floor(a / 4)
  return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + b - 1524.5
}

function sun(jd: number) {
  const d = jd - 2451545
  const g = rad(fix(357.529 + 0.98560028 * d, 360))
  const q = fix(280.459 + 0.98564736 * d, 360)
  const l = rad(fix(q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g), 360))
  const e = rad(23.439 - 0.00000036 * d)
  const ra = deg(Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l))) / 15
  return { declination: Math.asin(Math.sin(e) * Math.sin(l)), equation: q / 15 - fix(ra, 24) }
}

/**
 * Prayer times as minutes after local midnight, for one calendar day at the given place.
 * `offset` is the local clock's distance from UTC in hours.
 */
export function prayerTimes(
  date: { year: number; month: number; day: number },
  lat: number,
  lng: number,
  offset: number,
): Record<Prayer, number> {
  const jd = julian(date.year, date.month, date.day) - lng / 360
  const noon = (hours: number) => fix(12 - sun(jd + hours / 24).equation, 24)
  const atAngle = (angle: number, guess: number, before: boolean) => {
    const { declination } = sun(jd + guess / 24)
    const cos =
      (-Math.sin(rad(angle)) - Math.sin(declination) * Math.sin(rad(lat))) / (Math.cos(declination) * Math.cos(rad(lat)))
    const span = deg(Math.acos(Math.max(-1, Math.min(1, cos)))) / 15
    return noon(guess) + (before ? -span : span)
  }
  // Ashar starts when a shadow is as long as its object plus the object's noon shadow.
  const ashar = (guess: number) => {
    const { declination } = sun(jd + guess / 24)
    return atAngle(-deg(Math.atan(1 / (1 + Math.tan(Math.abs(rad(lat) - declination))))), guess, false)
  }
  const local = (hours: number) => Math.ceil(fix(hours + offset - lng / 15, 24) * 60) + IHTIYAT
  return {
    subuh: local(atAngle(SUBUH_ANGLE, 5, true)),
    dzuhur: local(noon(12)),
    ashar: local(ashar(15)),
    maghrib: local(atAngle(HORIZON, 18, false)),
    isya: local(atAngle(ISYA_ANGLE, 19, false)),
  }
}

export const clockLabel = (minutes: number) =>
  `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}.${String(minutes % 60).padStart(2, '0')}`

/** The branch's wall clock at an instant, read through UTC getters so the device's own timezone never matters. */
function wallClock(config: PrayerConfig, at: number) {
  const d = new Date(at + config.offset * 3_600_000)
  return {
    date: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() },
    weekday: d.getUTCDay(),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60,
  }
}

export function todaysPrayers(config: PrayerConfig, at: number) {
  const { date, weekday } = wallClock(config, at)
  const times = prayerTimes(date, config.lat, config.lng, config.offset)
  return PRAYERS.map((prayer) => {
    const jumat = prayer === 'dzuhur' && weekday === 5
    return { prayer, label: jumat ? 'Jumat' : PRAYER_LABEL[prayer], minutes: times[prayer], pause: jumat ? config.jumat : config.pause }
  })
}

/** The prayer whose pause window covers this instant, if any. */
export function prayerNow(config: PrayerConfig, at: number): { label: string; until: string } | null {
  const { minutes } = wallClock(config, at)
  const hit = todaysPrayers(config, at).find((p) => p.pause > 0 && minutes >= p.minutes && minutes < p.minutes + p.pause)
  return hit ? { label: hit.label, until: clockLabel(hit.minutes + hit.pause) } : null
}
