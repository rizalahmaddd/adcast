import qrcode from 'qrcode-generator'
import { useMemo, useState } from 'react'
import {
  PAID_PLANS,
  PERIODS,
  PLANS,
  priceOf,
  TRIAL_DAYS,
  UNLIMITED,
  type Order,
  type PaidPlan,
  type Plan,
  type PlanRules,
} from '../../shared/plans'
import { api, can, useBilling, useMe, type Billing, type Usage } from '../lib/api'
import { formatBytes, formatDate, formatDateTime, formatRupiah } from '../lib/format'
import { Button, cx, Failed, Loading, PageHeader, useAction } from '../ui'

const count = (n: number) => (n >= UNLIMITED ? 'Tanpa batas' : n.toLocaleString('id-ID'))

const ROWS: { key: keyof Usage; label: string; show: (r: PlanRules) => string }[] = [
  { key: 'maxDevices', label: 'Layar TV', show: (r) => count(r.maxDevices) },
  { key: 'maxBranches', label: 'Cabang', show: (r) => count(r.maxBranches) },
  { key: 'maxUsers', label: 'Pengguna', show: (r) => count(r.maxUsers) },
  { key: 'maxMedia', label: 'Video', show: (r) => count(r.maxMedia) },
  { key: 'maxPlaylists', label: 'Playlist', show: (r) => count(r.maxPlaylists) },
  { key: 'maxSchedules', label: 'Jadwal tayang', show: (r) => count(r.maxSchedules) },
  { key: 'maxStorage', label: 'Upload video', show: (r) => (r.maxStorage ? formatBytes(r.maxStorage) : 'Tidak ada') },
]

const STATUS: Record<Order['status'], string> = {
  pending: 'Belum dibayar',
  paid: 'Lunas',
  rejected: 'Ditolak',
  cancelled: 'Dibatalkan',
  expired: 'Kedaluwarsa',
}
export const orderStatus = (o: Order) => (o.status === 'pending' && o.claimedAt ? 'Menunggu konfirmasi' : STATUS[o.status])

export default function Plans() {
  const me = useMe()
  const billing = useBilling()
  const { run, busy } = useAction()
  const [months, setMonths] = useState<number>(PERIODS[0].months)

  if (billing.isPending || me.isPending) return <Loading what="paket" />
  if (billing.error || me.error) return <Failed error={billing.error ?? me.error} retry={() => billing.refetch()} />

  const data = billing.data
  const mayBuy = can(me.data, 'settings')
  const period = PERIODS.find((p) => p.months === months)!
  const waiting = !!data.open?.claimedAt

  const order = (plan: PaidPlan) => run(() => api('POST', '/api/billing/orders', { plan, months }))

  return (
    <>
      <PageHeader
        title="Paket"
        lead={
          data.plan === 'free'
            ? 'Usaha ini memakai paket Gratis.'
            : data.plan === 'trial' && data.expiresAt
              ? `Masa coba ${TRIAL_DAYS} hari berjalan sampai ${formatDate(data.expiresAt)}, dengan batas setara paket Pro dan upload ${formatBytes(PLANS.trial.maxStorage)}. Setelah itu usaha kembali ke paket Gratis.`
              : data.expiresAt
              ? `Paket ${PLANS[data.plan].label} aktif sampai ${formatDate(data.expiresAt)}. Setelah itu usaha kembali ke paket Gratis.`
              : `Paket ${PLANS[data.plan].label} aktif tanpa batas waktu.`
        }
      />

      <div className="grid gap-10">
        {data.open && <Payment order={data.open} merchant={data.merchant} mayBuy={mayBuy} />}

        <section aria-labelledby="pemakaian">
          <h2 id="pemakaian" className="text-xl font-bold">
            Pemakaian saat ini
          </h2>
          <UsageList plan={data.plan} usage={data.usage} />
        </section>

        <section aria-labelledby="pilihan">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="pilihan" className="text-xl font-bold">
                Pilihan paket
              </h2>
              <p className="mt-1 max-w-2xl text-muted">
                Paket Gratis menayangkan video dari tautan dan YouTube. Paket berbayar menambah upload video, yang juga
                tersimpan di TV sehingga tetap tayang saat internet putus.
              </p>
            </div>
            <fieldset className="flex rounded-md border border-line bg-surface p-1">
              <legend className="sr-only">Lama berlangganan</legend>
              {PERIODS.map((p) => (
                <label
                  key={p.months}
                  className={cx(
                    'flex min-h-9 cursor-pointer items-center rounded px-3 text-sm font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink',
                    months === p.months ? 'bg-ink text-bg' : 'text-muted hover:text-ink',
                  )}
                >
                  <input
                    type="radio"
                    name="lama"
                    className="sr-only"
                    checked={months === p.months}
                    onChange={() => setMonths(p.months)}
                  />
                  {p.label}
                </label>
              ))}
            </fieldset>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {(['free', ...PAID_PLANS] as Plan[]).map((id) => {
              const rules: PlanRules = PLANS[id]
              const paid = PAID_PLANS.find((p) => p === id)
              const current = data.plan === id
              return (
                <article
                  key={id}
                  className={cx('flex flex-col rounded-lg border bg-surface p-5', current ? 'border-ink' : 'border-line')}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-lg font-bold">{rules.label}</h3>
                    {current && <span className="text-sm font-semibold text-ok">Paket Anda</span>}
                  </div>
                  <p className="mt-2 text-2xl font-bold tabular-nums">
                    {paid ? formatRupiah(priceOf(paid, period)) : 'Rp 0'}
                    {paid && <span className="text-base font-normal text-muted"> / {period.label}</span>}
                  </p>
                  <p className="min-h-5 text-sm text-muted">
                    {paid && period.pay < period.months && `Harga ${period.pay} bulan, hemat ${formatRupiah(rules.price * (period.months - period.pay))}`}
                  </p>
                  <dl className="mt-4 grid gap-1.5 text-[0.95rem]">
                    {ROWS.map((row) => (
                      <div key={row.key} className="flex justify-between gap-4 border-b border-line/60 pb-1.5">
                        <dt className="text-muted">{row.label}</dt>
                        <dd className="font-semibold tabular-nums">{row.show(rules)}</dd>
                      </div>
                    ))}
                    <div className="flex justify-between gap-4 border-b border-line/60 pb-1.5">
                      <dt className="text-muted">Riwayat statistik</dt>
                      <dd className="font-semibold tabular-nums">{rules.statsDays} hari</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted">Logo dan warna sendiri</dt>
                      <dd className="font-semibold">{rules.branding ? 'Ya' : 'Tidak'}</dd>
                    </div>
                  </dl>
                  {paid && mayBuy && (
                    <Button
                      variant={current ? 'plain' : 'primary'}
                      className="mt-5"
                      busy={busy}
                      disabled={!me.data.billing || waiting}
                      onClick={() => order(paid)}
                    >
                      {current ? `Perpanjang ${period.label}` : `Pilih ${rules.label}`}
                    </Button>
                  )}
                </article>
              )
            })}
          </div>
          <p className="mt-4 max-w-2xl text-sm text-muted">
            {!mayBuy
              ? 'Hanya pengguna dengan hak mengubah pengaturan usaha yang bisa memesan paket.'
              : !me.data.billing
                ? 'Pembayaran belum disiapkan di server ini.'
                : waiting
                  ? 'Pesanan baru bisa dibuat setelah pembayaran yang sedang dicek selesai diproses.'
                  : data.plan === 'trial'
                    ? 'Paket yang dibeli saat masa coba mulai dihitung dari hari pembayaran dikonfirmasi.'
                    : 'Pindah paket di tengah masa aktif tidak menghanguskan sisa hari: sisanya dikonversi sesuai harga paket baru.'}
          </p>
        </section>

        {data.orders.length > 0 && <History orders={data.orders} />}
      </div>
    </>
  )
}

function UsageList({ plan, usage }: { plan: Plan; usage: Usage }) {
  const rules: PlanRules = PLANS[plan]
  const rows = ROWS.filter((row) => rules[row.key] < UNLIMITED && (row.key !== 'maxStorage' || rules.maxStorage > 0))
  return (
    <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row) => {
        const used = usage[row.key]
        const limit = rules[row.key]
        const full = used >= limit
        return (
          <div key={row.key}>
            <div className="flex justify-between gap-4 text-[0.95rem]">
              <dt className="font-semibold">{row.label}</dt>
              <dd className={cx('tabular-nums', full ? 'font-semibold text-warn' : 'text-muted')}>
                {row.key === 'maxStorage' ? `${formatBytes(used)} dari ${formatBytes(limit)}` : `${used} dari ${limit}`}
              </dd>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
              <div
                className={cx('h-full rounded-full', full ? 'bg-warn' : 'bg-ink')}
                style={{ width: `${Math.min(100, (used / limit) * 100)}%` }}
              />
            </div>
          </div>
        )
      })}
    </dl>
  )
}

function Payment({ order, merchant, mayBuy }: { order: NonNullable<Billing['open']>; merchant: string | null; mayBuy: boolean }) {
  const { run, busy } = useAction()
  const qr = useMemo(() => {
    if (!order.qris) return null
    const code = qrcode(0, 'M')
    code.addData(order.qris)
    code.make()
    return code.createDataURL(6, 12)
  }, [order.qris])

  const amount = order.amount.toLocaleString('id-ID')
  const title = `Paket ${PLANS[order.plan].label}, ${PERIODS.find((p) => p.months === order.months)?.label ?? `${order.months} bulan`}`

  if (order.claimedAt) {
    return (
      <section aria-labelledby="bayar" className="rounded-lg border border-line bg-surface p-5">
        <h2 id="bayar" className="text-xl font-bold">
          Pembayaran sedang dicek
        </h2>
        <p className="mt-1 max-w-2xl text-muted">
          {title}, {formatRupiah(order.amount)}. Anda menandainya sudah dibayar pada {formatDateTime(order.claimedAt)}. Tim
          AdCast mencocokkannya dengan mutasi secara manual. Paket aktif begitu dikonfirmasi, dan kabarnya muncul di
          halaman Pantau.
        </p>
      </section>
    )
  }

  return (
    <section aria-labelledby="bayar" className="rounded-lg border border-ink bg-surface p-5">
      <h2 id="bayar" className="text-xl font-bold">
        Selesaikan pembayaran
      </h2>
      <p className="mt-1 text-muted">{title}</p>
      <div className="mt-5 grid gap-6 sm:grid-cols-[auto_1fr] sm:items-start">
        {qr && (
          <figure className="justify-self-start rounded-md bg-white p-2">
            <img src={qr} alt={`Kode QRIS untuk ${formatRupiah(order.amount)}`} className="size-56" />
            <figcaption className="pb-1 text-center text-sm font-semibold text-black">{merchant}</figcaption>
          </figure>
        )}
        <div className="grid gap-4">
          <div>
            <p className="text-sm font-semibold">Total yang dibayar</p>
            <p className="text-3xl font-bold tabular-nums">
              Rp {amount.slice(0, -3)}
              <span className="rounded bg-ink px-1 text-bg">{amount.slice(-3)}</span>
            </p>
            <p className="mt-1 text-sm text-muted">
              Sudah termasuk kode unik {order.uniqueCode}. Tiga angka terakhir harus sama persis, karena dari situ kami
              mengenali pembayaran Anda.
            </p>
          </div>
          <ol className="grid list-decimal gap-1.5 pl-5">
            <li>Buka aplikasi bank atau dompet digital, pilih bayar dengan QRIS.</li>
            <li>Pindai kode di samping. Nominal terisi otomatis, pastikan sama dengan total di atas.</li>
            <li>Setelah berhasil, tekan tombol di bawah supaya pembayaran dicek.</li>
          </ol>
          <p className="text-sm text-muted">Pesanan ini berlaku sampai {formatDateTime(order.expiresAt)}.</p>
          {mayBuy && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                busy={busy}
                onClick={() => run(() => api('POST', `/api/billing/orders/${order.id}/claim`), 'Terima kasih, pembayaran Anda segera dicek')}
              >
                Saya sudah bayar
              </Button>
              <Button busy={busy} onClick={() => run(() => api('POST', `/api/billing/orders/${order.id}/cancel`), 'Pesanan dibatalkan')}>
                Batalkan pesanan
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function History({ orders }: { orders: Order[] }) {
  return (
    <section aria-labelledby="riwayat">
      <h2 id="riwayat" className="text-xl font-bold">
        Riwayat pesanan
      </h2>
      <ul className="mt-3 divide-y divide-line border-y border-line">
        {orders.map((o) => (
          <li key={o.id} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
            <div className="min-w-0">
              <p className="font-semibold">
                {PLANS[o.plan].label}, {o.months} bulan
              </p>
              <p className="text-sm text-muted">
                {formatDateTime(o.createdAt)}
                {o.status === 'rejected' && o.note ? `. ${o.note}` : ''}
              </p>
            </div>
            <p className="text-right">
              <span className="font-semibold tabular-nums">{formatRupiah(o.amount)}</span>
              <span
                className={cx(
                  'block text-sm font-semibold',
                  o.status === 'paid' ? 'text-ok' : o.status === 'rejected' ? 'text-bad' : 'text-muted',
                )}
              >
                {orderStatus(o)}
              </span>
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}
