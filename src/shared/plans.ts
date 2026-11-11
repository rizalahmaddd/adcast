export type PlanRules = {
  label: string
  /** Rupiah per 30 days. */
  price: number
  maxDevices: number
  maxBranches: number
  maxUsers: number
  maxMedia: number
  maxPlaylists: number
  maxSchedules: number
  /** Bytes of uploaded video. 0 means the plan takes videos from links only. */
  maxStorage: number
  branding: boolean
  /** How many days back the statistics pages reach. */
  statsDays: number
}

export const UNLIMITED = 1_000_000_000
const GB = 1024 ** 3

export const PLANS = {
  free: {
    label: 'Gratis',
    price: 0,
    maxDevices: 2,
    maxBranches: 1,
    maxUsers: 2,
    maxMedia: 10,
    maxPlaylists: 2,
    maxSchedules: 1,
    maxStorage: 0,
    branding: false,
    statsDays: 7,
  },
  // What a new business gets for its first TRIAL_DAYS: Pro limits with a small upload allowance,
  // so trials that never convert leave little behind in storage.
  trial: {
    label: 'Masa coba',
    price: 0,
    maxDevices: 10,
    maxBranches: 5,
    maxUsers: 10,
    maxMedia: 200,
    maxPlaylists: UNLIMITED,
    maxSchedules: UNLIMITED,
    maxStorage: 1 * GB,
    branding: true,
    statsDays: 30,
  },
  pro: {
    label: 'Pro',
    price: 99_000,
    maxDevices: 10,
    maxBranches: 5,
    maxUsers: 10,
    maxMedia: 200,
    maxPlaylists: UNLIMITED,
    maxSchedules: UNLIMITED,
    maxStorage: 20 * GB,
    branding: true,
    statsDays: 30,
  },
  business: {
    label: 'Bisnis',
    price: 299_000,
    maxDevices: 50,
    maxBranches: 25,
    maxUsers: 50,
    maxMedia: 1000,
    maxPlaylists: UNLIMITED,
    maxSchedules: UNLIMITED,
    maxStorage: 100 * GB,
    branding: true,
    statsDays: 90,
  },
} as const satisfies Record<string, PlanRules>

export type Plan = keyof typeof PLANS
export type PaidPlan = Exclude<Plan, 'free' | 'trial'>
export const PAID_PLANS: PaidPlan[] = ['pro', 'business']

export const DAY = 86_400_000
export const TRIAL_DAYS = 7
/** Uploaded files are deleted this long after a trial or paid plan ends without renewal. */
export const PURGE_AFTER_DAYS = 30

/** `pay` is how many monthly prices the period costs, so a year is charged as ten months. */
export const PERIODS = [
  { months: 1, days: 30, pay: 1, label: '1 bulan' },
  { months: 12, days: 365, pay: 10, label: '12 bulan' },
] as const
export type Period = (typeof PERIODS)[number]

export const periodOf = (months: number): Period | undefined => PERIODS.find((p) => p.months === months)
export const priceOf = (plan: PaidPlan, period: Period) => PLANS[plan].price * period.pay

/** A paid plan or trial past its end date behaves as free. A paid plan without an end date never lapses. */
export function effectivePlan(plan: string, expiresAt: number | null, now: number): Plan {
  if (!(plan in PLANS)) return 'free'
  if (plan !== 'free' && expiresAt !== null && expiresAt <= now) return 'free'
  return plan as Plan
}

/**
 * End date after a confirmed payment. Renewing the same plan stacks on the time left.
 * Time left on a different plan is converted at its price, so switching tiers never burns paid days.
 */
export function extendedExpiry(
  current: { plan: Plan; expiresAt: number | null },
  bought: { plan: PaidPlan; days: number },
  now: number,
): number {
  // Trial days cost nothing, so they convert to nothing: a plan bought mid-trial starts today.
  const left = current.plan !== 'free' && current.expiresAt && current.expiresAt > now ? current.expiresAt - now : 0
  const carried = current.plan === bought.plan ? left : left * (PLANS[current.plan].price / PLANS[bought.plan].price)
  return now + Math.round(carried) + bought.days * DAY
}

export const ORDER_TTL = DAY
export type OrderStatus = 'pending' | 'paid' | 'rejected' | 'cancelled' | 'expired'

export type Order = {
  id: string
  plan: PaidPlan
  months: number
  price: number
  uniqueCode: number
  amount: number
  status: OrderStatus
  note: string | null
  createdAt: number
  expiresAt: number
  claimedAt: number | null
  decidedAt: number | null
}
