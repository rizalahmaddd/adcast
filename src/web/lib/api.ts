import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { Order, Plan, PlanRules } from '../../shared/plans'
import type { DeviceLive, Permission, ServerToDashboard, StatsReport, Target, Timezone } from '../../shared/types'

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const raw = body instanceof Blob || body instanceof ArrayBuffer
  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': raw ? (body as Blob).type || 'application/octet-stream' : 'application/json' },
      body: body === undefined ? undefined : raw ? (body as Blob) : JSON.stringify(body),
    })
  } catch {
    throw new ApiError('Tidak bisa terhubung ke server. Periksa koneksi internet Anda.', 0)
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError((data as { error?: string } | null)?.error ?? `Permintaan gagal (${res.status})`, res.status)
  return data as T
}

export type Me = {
  user: { id: string; name: string; email: string; totpEnabled: boolean; hasPassword: boolean }
  tenant: {
    id: string
    name: string
    plan: Plan
    planExpiresAt: number | null
    purgeAt: number | null
    limits: PlanRules
    brandColor: string
    logoUrl: string | null
    alertThreshold: number
  }
  role: string
  permissions: Permission[]
  tenants: { id: string; name: string }[]
  platformAdmin: boolean
  billing: boolean
  push: { publicKey: string | null }
  integrations: {
    googleClientId: string | null
    googleApiKey: string | null
    dropboxAppKey: string | null
    onedriveClientId: string | null
  }
}

export type BranchPrayer = {
  enabled: boolean
  city: string | null
  lat: number | null
  lng: number | null
  pause: number
  jumat: number
}
export type Branch = { id: string; name: string; timezone: Timezone; prayer: BranchPrayer }
export type Device = { id: string; name: string; branchId: string; createdAt: number; covered: boolean; live?: DeviceLive }
export type Media = {
  id: string
  kind: 'file' | 'youtube' | 'link'
  title: string
  status: 'uploading' | 'ready' | 'failed'
  source: string
  youtubeId: string | null
  url: string | null
  mime: string | null
  size: number
  duration: number | null
  width: number | null
  height: number | null
  hasThumb: number
  error: string | null
  createdAt: number
}
export type Playlist = { id: string; name: string; mediaIds: string[] }
export type Schedule = {
  id: string
  name: string
  contentType: 'media' | 'playlist'
  contentId: string
  target: Target
  days: number[]
  startTime: string
  endTime: string | null
  enabled: boolean
}
export type Role = { id: string; name: string; isOwner: boolean; permissions: Permission[] }
export type User = { id: string; name: string; email: string; totpEnabled: number; roleId: string }
export type AuditEntry = { id: string; userName: string | null; action: string; detail: string | null; createdAt: number }
export type Notice = { id: string; title: string; body: string; createdAt: number }
export type Usage = Record<
  'maxDevices' | 'maxBranches' | 'maxUsers' | 'maxMedia' | 'maxPlaylists' | 'maxSchedules' | 'maxStorage',
  number
>
export type Billing = {
  merchant: string | null
  plan: Plan
  expiresAt: number | null
  usage: Usage
  open: (Order & { qris: string | null }) | null
  orders: Order[]
}
export type AdminOrder = Order & { tenantName: string; createdByName: string | null }

const get = <T,>(path: string) => () => api<T>('GET', path)

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: get<Me>('/api/auth/me'), retry: false, staleTime: 60_000 })
export const useAuthConfig = () =>
  useQuery({ queryKey: ['auth-config'], queryFn: get<{ google: boolean }>('/api/auth/config'), staleTime: 60_000 })
export const useBranches = () => useQuery({ queryKey: ['branches'], queryFn: get<Branch[]>('/api/branches') })
export const useMedia = () =>
  useQuery({ queryKey: ['media'], queryFn: get<{ items: Media[]; used: number }>('/api/media') })
export const usePlaylists = () => useQuery({ queryKey: ['playlists'], queryFn: get<Playlist[]>('/api/playlists') })
export const useSchedules = () => useQuery({ queryKey: ['schedules'], queryFn: get<Schedule[]>('/api/schedules') })
export const useRoles = () => useQuery({ queryKey: ['roles'], queryFn: get<Role[]>('/api/roles') })
export const useUsers = () => useQuery({ queryKey: ['users'], queryFn: get<User[]>('/api/users') })
export const useBilling = () => useQuery({ queryKey: ['billing'], queryFn: get<Billing>('/api/billing') })
export const useAdminOrders = () =>
  useQuery({ queryKey: ['admin-orders'], queryFn: get<AdminOrder[]>('/api/billing/admin/orders'), refetchInterval: 60_000 })
export const useStats = (days: number) =>
  useQuery({
    queryKey: ['stats', days],
    queryFn: get<StatsReport>(`/api/stats?days=${days}`),
    staleTime: 60_000,
    // Keeps the page in place while another range loads.
    placeholderData: keepPreviousData,
  })
export const useNotices = () => useQuery({ queryKey: ['notices'], queryFn: get<Notice[]>('/api/notifications') })

/** Device list kept fresh by the hub's WebSocket, with a slow poll as a safety net. */
export function useDevices() {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: ['devices'], queryFn: get<Device[]>('/api/devices'), refetchInterval: 30_000 })

  useEffect(() => {
    let ws: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout>
    let attempt = 0
    let closed = false

    const connect = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws`)
      ws.onopen = () => {
        attempt = 0
        qc.invalidateQueries({ queryKey: ['devices'] })
      }
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string) as ServerToDashboard
        if (msg.t !== 'device') return
        qc.setQueryData<Device[]>(['devices'], (list) =>
          list?.map((d) => (d.id === msg.id ? { ...d, live: msg.live } : d)),
        )
      }
      ws.onclose = () => {
        if (closed) return
        timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempt++))
      }
    }
    connect()
    return () => {
      closed = true
      clearTimeout(timer)
      ws?.close()
    }
  }, [qc])

  return query
}

export const can = (me: Me | undefined, perm: Permission) => !!me?.permissions.includes(perm)
