import { describe, expect, it } from 'vitest'
import { directVideoLink, isYoutubeLink } from '../src/shared/links'
import { DAY, effectivePlan, extendedExpiry, PERIODS, PLANS, priceOf, TRIAL_DAYS } from '../src/shared/plans'
import { clockLabel, prayerNow, prayerTimes, todaysPrayers } from '../src/shared/prayer'
import { qrisMerchant, qrisWithAmount } from '../src/shared/qris'

// Synthetic payload (fake merchant and merchant ids) with a valid CRC16, so the test never
// carries a real merchant's static QRIS.
const STATIC_QRIS =
  '00020101021126690014ID.CO.QRIS.WWW011893600915000000000102189360091500000000010303UMI51440014ID.CO.QRIS.WWW0215ID10000000000000303UMI5204411153033605802ID5913Warung Contoh6011Kota Contoh610512345630485E8'

describe('plans', () => {
  const now = Date.UTC(2026, 10, 11)

  it('treats a lapsed paid plan as free', () => {
    expect(effectivePlan('pro', now - 1, now)).toBe('free')
    expect(effectivePlan('pro', now + 1, now)).toBe('pro')
    expect(effectivePlan('business', null, now)).toBe('business')
    expect(effectivePlan('gone', null, now)).toBe('free')
  })

  it('gives a trial Pro limits with a small upload allowance, then free', () => {
    expect(PLANS.trial.maxDevices).toBe(PLANS.pro.maxDevices)
    expect(PLANS.trial.maxStorage).toBeLessThan(PLANS.pro.maxStorage)
    expect(effectivePlan('trial', now + TRIAL_DAYS * DAY, now)).toBe('trial')
    expect(effectivePlan('trial', now - 1, now)).toBe('free')
  })

  it('starts a plan bought mid-trial from today', () => {
    const until = extendedExpiry({ plan: 'trial', expiresAt: now + 5 * DAY }, { plan: 'pro', days: 30 }, now)
    expect(until).toBe(now + 30 * DAY)
  })

  it('keeps the free plan off storage', () => {
    expect(PLANS.free.maxStorage).toBe(0)
    expect(PLANS.pro.maxStorage).toBeGreaterThan(0)
  })

  it('charges ten months for a year', () => {
    const year = PERIODS.find((p) => p.months === 12)!
    expect(priceOf('pro', year)).toBe(PLANS.pro.price * 10)
  })

  it('stacks a renewal on the time left', () => {
    const until = extendedExpiry({ plan: 'pro', expiresAt: now + 5 * DAY }, { plan: 'pro', days: 30 }, now)
    expect(until).toBe(now + 35 * DAY)
  })

  it('starts from today when the old plan already ended', () => {
    const until = extendedExpiry({ plan: 'free', expiresAt: now - DAY }, { plan: 'pro', days: 30 }, now)
    expect(until).toBe(now + 30 * DAY)
  })

  it('converts leftover days by price when switching tier', () => {
    const up = extendedExpiry({ plan: 'pro', expiresAt: now + 30 * DAY }, { plan: 'business', days: 30 }, now)
    expect(up - now).toBe(Math.round(30 * DAY * (PLANS.pro.price / PLANS.business.price)) + 30 * DAY)
  })
})

describe('qris', () => {
  it('reads the merchant name', () => {
    expect(qrisMerchant(STATIC_QRIS)).toBe('Warung Contoh')
  })

  it('rejects a payload with a broken checksum', () => {
    expect(qrisMerchant(STATIC_QRIS.slice(0, -1) + '0')).toBeNull()
    expect(qrisWithAmount('not a qris', 1000)).toBeNull()
  })

  it('embeds the amount and stays a valid code', () => {
    const dynamic = qrisWithAmount(STATIC_QRIS, 99_417)!
    expect(dynamic).toContain('010212')
    expect(dynamic).toContain('540599417')
    expect(dynamic.indexOf('5303360')).toBeLessThan(dynamic.indexOf('540599417'))
    expect(dynamic.indexOf('540599417')).toBeLessThan(dynamic.indexOf('5802ID'))
    // Parsing again checks the new checksum.
    expect(qrisMerchant(dynamic)).toBe('Warung Contoh')
  })

  it('refuses amounts that are not whole rupiah', () => {
    expect(qrisWithAmount(STATIC_QRIS, 0)).toBeNull()
    expect(qrisWithAmount(STATIC_QRIS, 10.5)).toBeNull()
  })
})

describe('links', () => {
  it('accepts https file links only', () => {
    expect(directVideoLink('https://cdn.example.com/a.mp4')).toBe('https://cdn.example.com/a.mp4')
    expect(directVideoLink('http://cdn.example.com/a.mp4')).toBeNull()
    expect(directVideoLink('https://user:pw@example.com/a.mp4')).toBeNull()
    expect(directVideoLink('https://192.168.1.10/a.mp4')).toBeNull()
    expect(directVideoLink('https://localhost/a.mp4')).toBeNull()
    expect(directVideoLink('promo.mp4')).toBeNull()
  })

  it('rewrites Dropbox share links to the file itself', () => {
    expect(directVideoLink('https://www.dropbox.com/scl/fi/abc/promo.mp4?rlkey=k&dl=0')).toBe(
      'https://www.dropbox.com/scl/fi/abc/promo.mp4?rlkey=k&raw=1',
    )
  })

  it('recognises YouTube links', () => {
    expect(isYoutubeLink('https://youtu.be/dQw4w9WgXcQ')).toBe(true)
    expect(isYoutubeLink('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true)
    expect(isYoutubeLink('https://cdn.example.com/a.mp4')).toBe(false)
  })
})

describe('prayer times', () => {
  // Reference: Kemenag method without the safety margin, so ours land 2 to 3 minutes later.
  const cases = [
    { place: 'Malang', date: { year: 2026, month: 11, day: 11 }, lat: -7.9666, lng: 112.6326, ref: ['03:38', '11:13', '14:34', '17:27', '18:41'] },
    { place: 'Banda Aceh', date: { year: 2026, month: 6, day: 21 }, lat: 5.5483, lng: 95.3238, ref: ['05:02', '12:40', '16:08', '18:54', '20:10'] },
  ]
  for (const c of cases) {
    it(`matches the published times for ${c.place}`, () => {
      const ours = Object.values(prayerTimes(c.date, c.lat, c.lng, 7))
      c.ref.forEach((time, i) => {
        const [h, m] = time.split(':').map(Number)
        expect(ours[i] - (h * 60 + m)).toBeGreaterThanOrEqual(1)
        expect(ours[i] - (h * 60 + m)).toBeLessThanOrEqual(3)
      })
    })
  }

  const malang = { lat: -7.9666, lng: 112.6326, offset: 7, pause: 10, jumat: 45 }
  const at = (day: number, clock: string) => Date.parse(`2026-11-${day}T${clock}:00+07:00`)

  it('pauses only inside the window after a prayer starts', () => {
    expect(prayerNow(malang, at(11, '11:15'))).toBeNull()
    expect(prayerNow(malang, at(11, '11:17'))).toEqual({ label: 'Dzuhur', until: '11.26' })
    expect(prayerNow(malang, at(11, '11:27'))).toBeNull()
  })

  it('uses the longer Friday pause at midday', () => {
    const friday = todaysPrayers(malang, at(13, '09:00')).find((p) => p.prayer === 'dzuhur')!
    expect([friday.label, friday.pause]).toEqual(['Jumat', 45])
    expect(prayerNow(malang, at(13, '11:50'))?.label).toBe('Jumat')
  })

  it('formats minutes as a clock', () => {
    expect(clockLabel(5 * 60 + 7)).toBe('05.07')
  })
})
