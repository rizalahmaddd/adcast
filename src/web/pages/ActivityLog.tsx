import { useInfiniteQuery } from '@tanstack/react-query'
import { api, type AuditEntry } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { Button, Empty, Failed, Loading, PageHeader } from '../ui'

const ACTIONS: Record<string, string> = {
  'broadcast.sent': 'Mengirim tayangan',
  'broadcast.pause': 'Menjeda tayangan',
  'broadcast.resume': 'Melanjutkan tayangan',
  'broadcast.stop': 'Menghentikan tayangan',
  'media.uploaded': 'Mengunggah video',
  'media.youtube_added': 'Menambah video YouTube',
  'media.link_added': 'Menambah video dari tautan',
  'billing.order_created': 'Membuat pesanan paket',
  'billing.payment_claimed': 'Menandai pesanan sudah dibayar',
  'billing.paid': 'Mengonfirmasi pembayaran paket',
  'billing.rejected': 'Menolak pembayaran paket',
  'media.deleted': 'Menghapus video',
  'playlist.created': 'Membuat playlist',
  'playlist.updated': 'Mengubah playlist',
  'playlist.deleted': 'Menghapus playlist',
  'schedule.created': 'Membuat jadwal',
  'schedule.updated': 'Mengubah jadwal',
  'schedule.deleted': 'Menghapus jadwal',
  'device.paired': 'Menghubungkan TV',
  'device.updated': 'Mengubah layar',
  'device.deleted': 'Melepas layar',
  'branch.created': 'Menambah cabang',
  'branch.updated': 'Mengubah cabang',
  'branch.deleted': 'Menghapus cabang',
  'user.added': 'Menambah pengguna',
  'user.role_changed': 'Mengubah peran pengguna',
  'user.removed': 'Mengeluarkan pengguna',
  'role.created': 'Membuat peran',
  'role.updated': 'Mengubah hak akses peran',
  'role.deleted': 'Menghapus peran',
  'settings.updated': 'Mengubah pengaturan usaha',
  'settings.logo_updated': 'Mengganti logo',
  'auth.password_changed': 'Mengganti kata sandi',
  'auth.2fa_enabled': 'Mengaktifkan verifikasi dua langkah',
  'auth.2fa_disabled': 'Mematikan verifikasi dua langkah',
}

function subject(detail: string | null): string {
  if (!detail) return ''
  try {
    const d = JSON.parse(detail) as Record<string, unknown>
    const name = d.name ?? d.title ?? d.email
    const screens = typeof d.screens === 'number' ? ` ke ${d.screens} layar` : ''
    return `${typeof name === 'string' ? `"${name}"` : ''}${screens}`
  } catch {
    return ''
  }
}

export default function ActivityLog() {
  const log = useInfiniteQuery({
    queryKey: ['audit'],
    queryFn: ({ pageParam }) => api<AuditEntry[]>('GET', `/api/audit${pageParam ? `?before=${pageParam}` : ''}`),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.length === 50 ? last[last.length - 1].createdAt : undefined),
  })

  if (log.isPending) return <Loading what="log aktivitas" />
  if (log.error) return <Failed error={log.error} retry={() => log.refetch()} />

  const entries = log.data.pages.flat()

  return (
    <>
      <PageHeader title="Log aktivitas" lead="Catatan siapa melakukan apa, terbaru di atas." />
      {entries.length === 0 ? (
        <Empty title="Belum ada aktivitas">Tindakan seperti mengirim tayangan atau menambah pengguna akan tercatat di sini.</Empty>
      ) : (
        <>
          <ul className="divide-y divide-line border-y border-line">
            {entries.map((e) => (
              <li key={e.id} className="grid gap-x-6 gap-y-0.5 py-3 sm:grid-cols-[11rem_1fr]">
                <time className="text-sm text-muted tabular-nums" dateTime={new Date(e.createdAt).toISOString()}>
                  {formatDateTime(e.createdAt)}
                </time>
                <p>
                  <span className="font-semibold">{e.userName ?? 'Sistem'}</span>: {ACTIONS[e.action] ?? e.action}{' '}
                  {subject(e.detail)}
                </p>
              </li>
            ))}
          </ul>
          {log.hasNextPage && (
            <Button className="mt-4" busy={log.isFetchingNextPage} onClick={() => log.fetchNextPage()}>
              Muat yang lebih lama
            </Button>
          )}
        </>
      )}
    </>
  )
}
