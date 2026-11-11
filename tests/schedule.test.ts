import { describe, expect, it } from 'vitest'
import { eventsBetween, nextEventAfter } from '../src/worker/lib/schedule'
import { totpAt, verifyTotp } from '../src/worker/lib/crypto'

const utc = (iso: string) => Date.parse(iso)

describe('schedule events', () => {
  // 2026-11-11 is a Wednesday.
  const lunch = { days: [1, 2, 3, 4, 5], start: '11:30', end: '13:00' }

  it('fires at local time for each Indonesian zone', () => {
    expect(nextEventAfter(lunch, 7, utc('2026-11-11T00:00:00Z'))).toBe(utc('2026-11-11T04:30:00Z'))
    expect(nextEventAfter(lunch, 8, utc('2026-11-11T00:00:00Z'))).toBe(utc('2026-11-11T03:30:00Z'))
    expect(nextEventAfter(lunch, 9, utc('2026-11-11T00:00:00Z'))).toBe(utc('2026-11-11T02:30:00Z'))
  })

  it('reports the end as the next event while a slot is running', () => {
    expect(nextEventAfter(lunch, 7, utc('2026-11-11T05:00:00Z'))).toBe(utc('2026-11-11T06:00:00Z'))
  })

  it('skips days that are not selected', () => {
    // Friday 13:00 WIB has passed; the next start is Monday.
    expect(nextEventAfter(lunch, 7, utc('2026-11-13T07:00:00Z'))).toBe(utc('2026-11-16T04:30:00Z'))
  })

  it('finds start and end inside a window, exclusive of the lower bound', () => {
    const start = utc('2026-11-11T04:30:00Z')
    expect(eventsBetween(lunch, 7, start - 1000, start)).toEqual([{ type: 'start', at: start }])
    expect(eventsBetween(lunch, 7, start, start + 1000)).toEqual([])
    expect(eventsBetween(lunch, 7, utc('2026-11-11T05:59:00Z'), utc('2026-11-11T06:00:30Z'))).toEqual([
      { type: 'end', at: utc('2026-11-11T06:00:00Z') },
    ])
  })

  it('ends on the following day when the slot crosses midnight', () => {
    const night = { days: [3], start: '22:00', end: '02:00' }
    // Wed 22:00 WIB = 15:00Z, ends Thu 02:00 WIB = Wed 19:00Z.
    expect(eventsBetween(night, 7, utc('2026-11-11T18:59:00Z'), utc('2026-11-11T19:00:00Z'))).toEqual([
      { type: 'end', at: utc('2026-11-11T19:00:00Z') },
    ])
  })

  it('uses the local weekday, not the UTC one', () => {
    // Monday 06:00 WIT is still Sunday 21:00 UTC.
    const early = { days: [1], start: '06:00', end: null }
    expect(nextEventAfter(early, 9, utc('2026-11-15T12:00:00Z'))).toBe(utc('2026-11-15T21:00:00Z'))
  })
})

describe('totp', () => {
  it('matches the RFC 6238 SHA-1 test vector', async () => {
    // Secret "12345678901234567890" in base32, T = 59s.
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
    expect(await totpAt(secret, Math.floor(59 / 30))).toBe('287082')
    expect(await verifyTotp(secret, '287082', 59_000)).toBe(true)
    expect(await verifyTotp(secret, '287083', 59_000)).toBe(false)
  })
})
