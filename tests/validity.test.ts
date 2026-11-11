import { describe, expect, it } from 'vitest'
import { calendarDay, withinValidity } from '../src/shared/validity'

describe('content validity', () => {
  it('uses the local calendar day of the branch', () => {
    expect(calendarDay(Date.parse('2026-11-11T16:30:00Z'), 7)).toBe('2026-11-11')
    expect(calendarDay(Date.parse('2026-11-11T17:30:00Z'), 7)).toBe('2026-11-12')
    expect(calendarDay(Date.parse('2026-11-11T17:30:00Z'), 9)).toBe('2026-11-12')
  })

  it('treats a missing bound as unlimited', () => {
    expect(withinValidity(null, null, '2026-11-11')).toBe(true)
    expect(withinValidity(null, '2026-11-10', '2026-11-11')).toBe(false)
    expect(withinValidity('2026-11-12', null, '2026-11-11')).toBe(false)
  })

  it('includes both dates', () => {
    expect(withinValidity('2026-11-01', '2026-11-30', '2026-11-01')).toBe(true)
    expect(withinValidity('2026-11-01', '2026-11-30', '2026-11-30')).toBe(true)
    expect(withinValidity('2026-11-01', '2026-11-30', '2026-12-01')).toBe(false)
    expect(withinValidity('2026-11-01', '2026-11-30', '2026-10-31')).toBe(false)
  })
})
