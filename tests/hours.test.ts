import { describe, expect, it } from 'vitest'
import { closedNow, localMinutes } from '../src/shared/hours'

const day = (hour: number, minute = 0) => Date.UTC(2026, 0, 5, hour, minute)

describe('localMinutes', () => {
  it('converts to the branch timezone', () => {
    expect(localMinutes(day(1), 7)).toBe(8 * 60)
    expect(localMinutes(day(23, 30), 7)).toBe(6 * 60 + 30)
  })
})

describe('closedNow', () => {
  const hours = { enabled: true, open: '08:00', close: '21:00', text: null }

  it('is open from the opening minute until closing', () => {
    expect(closedNow(hours, day(8), 0)).toBeNull()
    expect(closedNow(hours, day(20, 59), 0)).toBeNull()
    expect(closedNow(hours, day(21), 0)).toEqual({ open: '08:00', text: null })
    expect(closedNow(hours, day(7, 59), 0)).toEqual({ open: '08:00', text: null })
  })

  it('handles a shop that closes after midnight', () => {
    const late = { enabled: true, open: '22:00', close: '02:00', text: 'Buka lagi besok' }
    expect(closedNow(late, day(23), 0)).toBeNull()
    expect(closedNow(late, day(1), 0)).toBeNull()
    expect(closedNow(late, day(12), 0)).toEqual({ open: '22:00', text: 'Buka lagi besok' })
  })

  it('uses the branch timezone rather than the server clock', () => {
    // 01:00 UTC is 08:00 WIB, so the Jakarta branch is already open.
    expect(closedNow(hours, day(1), 7)).toBeNull()
    // 15:00 UTC is 22:00 WIB, an hour past closing.
    expect(closedNow(hours, day(15), 7)).toEqual({ open: '08:00', text: null })
  })

  it('stays out of the way when the feature is off or incomplete', () => {
    expect(closedNow({ ...hours, enabled: false }, day(3), 0)).toBeNull()
    expect(closedNow({ ...hours, open: null }, day(3), 0)).toBeNull()
    expect(closedNow(null, day(3), 0)).toBeNull()
  })
})
