import { useState, type FormEvent } from 'react'
import { PLANS } from '../../shared/plans'
import { api, useAdminOrders, useMe, type AdminOrder } from '../lib/api'
import { formatDateTime, formatRupiah } from '../lib/format'
import { Button, cx, Empty, Failed, Input, Loading, Modal, PageHeader, useAction } from '../ui'
import { orderStatus } from './Plans'

const decidable = (o: AdminOrder) => o.status === 'pending' || o.status === 'expired'

export default function Payments() {
  const me = useMe()
  const orders = useAdminOrders()
  const { run, busy } = useAction()
  const [rejecting, setRejecting] = useState<AdminOrder | null>(null)

  if (orders.isPending) return <Loading what="pembayaran" />
  if (orders.error) return <Failed error={orders.error} retry={() => orders.refetch()} />

  const confirmPaid = (o: AdminOrder) => {
    if (!confirm(`Konfirmasi ${formatRupiah(o.amount)} dari "${o.tenantName}" sudah masuk? Paket langsung aktif.`)) return
    run(() => api('POST', `/api/billing/admin/orders/${o.id}/confirm`), `Paket ${PLANS[o.plan].label} untuk ${o.tenantName} aktif`)
  }

  const claimed = orders.data.filter((o) => o.status === 'pending' && o.claimedAt).length

  return (
    <>
      <PageHeader
        title="Pembayaran"
        lead={`${claimed} pesanan menunggu konfirmasi. Cocokkan nominal persis dengan mutasi QRIS, lalu konfirmasi. Halaman ini hanya terlihat oleh ${me.data?.user.email}.`}
      />
      {orders.data.length === 0 ? (
        <Empty title="Belum ada pesanan">Pesanan paket dari semua usaha akan muncul di sini.</Empty>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {orders.data.map((o) => {
            const amount = o.amount.toLocaleString('id-ID')
            const urgent = o.status === 'pending' && !!o.claimedAt
            return (
              <li key={o.id} className="grid gap-3 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="text-xl font-bold tabular-nums">
                    Rp {amount.slice(0, -3)}
                    <span className={cx('rounded px-1', decidable(o) && 'bg-ink text-bg')}>{amount.slice(-3)}</span>
                  </p>
                  <p className="font-semibold">
                    {o.tenantName}
                    <span className="font-normal text-muted">
                      , {PLANS[o.plan].label} {o.months} bulan
                    </span>
                  </p>
                  <p className="text-sm text-muted">
                    Dipesan {formatDateTime(o.createdAt)}
                    {o.createdByName ? ` oleh ${o.createdByName}` : ''}
                    {o.claimedAt ? `, ditandai dibayar ${formatDateTime(o.claimedAt)}` : ''}
                    {o.note ? `. ${o.note}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <span
                    className={cx(
                      'mr-2 text-sm font-semibold',
                      urgent ? 'text-warn' : o.status === 'paid' ? 'text-ok' : o.status === 'rejected' ? 'text-bad' : 'text-muted',
                    )}
                  >
                    {orderStatus(o)}
                  </span>
                  {decidable(o) && (
                    <>
                      <Button small variant="primary" busy={busy} onClick={() => confirmPaid(o)}>
                        Konfirmasi lunas
                      </Button>
                      <Button small variant="danger" busy={busy} onClick={() => setRejecting(o)}>
                        Tolak
                      </Button>
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {rejecting && <RejectDialog order={rejecting} onClose={() => setRejecting(null)} />}
    </>
  )
}

function RejectDialog({ order, onClose }: { order: AdminOrder; onClose: () => void }) {
  const { run, busy } = useAction()
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const note = new FormData(e.currentTarget).get('note')
    if (await run(() => api('POST', `/api/billing/admin/orders/${order.id}/reject`, { note }), 'Pesanan ditolak')) onClose()
  }
  return (
    <Modal title={`Tolak ${formatRupiah(order.amount)}`} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <Input
          label="Alasan"
          name="note"
          maxLength={200}
          autoFocus
          placeholder="Pembayaran tidak ditemukan"
          hint={`Dikirim ke ${order.tenantName} sebagai pemberitahuan.`}
        />
        <Button type="submit" variant="danger" busy={busy}>
          Tolak pesanan
        </Button>
      </form>
    </Modal>
  )
}
