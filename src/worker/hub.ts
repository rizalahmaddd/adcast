import { DurableObject } from 'cloudflare:workers'
import type {
  Announcement,
  Cmd,
  DeviceLive,
  PlayerToServer,
  Reported,
  ServerToDashboard,
  ServerToPlayer,
  Target,
} from '../shared/types'
import type { Bindings } from './env'
import { resolveContent, resolveTarget } from './lib/content'
import { coveredDevices, tenantPlan } from './lib/plan'
import { newId } from './lib/crypto'
import { notifyTenant } from './lib/push'
import { eventsBetween, nextEventAfter } from './lib/schedule'

type Attachment = { kind: 'dash' } | { kind: 'player'; deviceId: string; since: number }

type StateRow = { device_id: string; desired: string | null; reported: string | null; last_seen: number | null }

type ScheduleRow = {
  id: string
  name: string
  content_type: 'media' | 'playlist'
  content_id: string
  target_type: Target['type']
  target_ids: string
  days: string
  start_time: string
  end_time: string | null
}

// Players send "ping" every 25s; two missed pings means the TV is gone even if TCP hasn't noticed.
const STALE_AFTER = 70_000
const SWEEP_EVERY = 5 * 60_000
const PERSIST_EVERY = 5 * 60_000
const START_LEAD = 4_000
const MAX_CATCHUP = 10 * 60_000
const STATS_KEPT_DAYS = 95
const DAY_FORMAT = /^\d{4}-\d{2}-\d{2}$/

const sameReport = (a: Reported, b: Reported) =>
  JSON.stringify({ ...a, position: 0, at: 0 }) === JSON.stringify({ ...b, position: 0, at: 0 })

export class TenantHub extends DurableObject<Bindings> {
  private sql: SqlStorage

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS device_state (device_id TEXT PRIMARY KEY, desired TEXT, reported TEXT, last_seen INTEGER)',
    )
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)')
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS stat_up (day TEXT, device_id TEXT, seconds INTEGER NOT NULL, PRIMARY KEY (day, device_id))',
    )
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS stat_play (day TEXT, device_id TEXT, media_id TEXT, seconds INTEGER NOT NULL, PRIMARY KEY (day, device_id, media_id))',
    )
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  private meta(k: string): string | null {
    const row = this.sql.exec<{ v: string }>('SELECT v FROM meta WHERE k = ?', k).toArray()[0]
    return row?.v ?? null
  }

  private setMeta(k: string, v: string) {
    this.sql.exec('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, v)
  }

  private row(deviceId: string): StateRow | undefined {
    return this.sql.exec<StateRow>('SELECT * FROM device_state WHERE device_id = ?', deviceId).toArray()[0]
  }

  private desired(deviceId: string): Cmd | null {
    const raw = this.row(deviceId)?.desired
    return raw ? (JSON.parse(raw) as Cmd) : null
  }

  private setDesired(deviceId: string, cmd: Cmd | null) {
    this.sql.exec(
      'INSERT INTO device_state (device_id, desired) VALUES (?, ?) ON CONFLICT(device_id) DO UPDATE SET desired = excluded.desired',
      deviceId,
      cmd ? JSON.stringify(cmd) : null,
    )
  }

  private isOnline(deviceId: string, now = Date.now()): boolean {
    return this.ctx.getWebSockets(`dev:${deviceId}`).some((ws) => {
      const att = ws.deserializeAttachment() as Attachment
      const lastPing = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0
      const since = att.kind === 'player' ? att.since : 0
      return now - Math.max(lastPing, since) < STALE_AFTER
    })
  }

  private live(deviceId: string, row = this.row(deviceId)): DeviceLive {
    const desired = row?.desired ? (JSON.parse(row.desired) as Cmd) : null
    return {
      online: this.isOnline(deviceId),
      lastSeen: row?.last_seen ?? null,
      reported: row?.reported ? (JSON.parse(row.reported) as Reported) : null,
      desired: desired && {
        id: desired.id,
        name: desired.name,
        paused: desired.paused,
        scheduleId: desired.scheduleId,
      },
    }
  }

  private toDashboards(deviceId: string, reported?: Reported) {
    const live = this.live(deviceId)
    const msg: ServerToDashboard = { t: 'device', id: deviceId, live: reported ? { ...live, reported } : live }
    const text = JSON.stringify(msg)
    for (const ws of this.ctx.getWebSockets('dash')) ws.send(text)
  }

  private toDevice(deviceId: string, msg: ServerToPlayer) {
    const text = JSON.stringify(msg)
    for (const ws of this.ctx.getWebSockets(`dev:${deviceId}`)) ws.send(text)
  }

  async fetch(request: Request): Promise<Response> {
    const tenantId = request.headers.get('x-tenant-id')
    const deviceId = request.headers.get('x-device-id')
    if (!tenantId) return new Response('missing tenant', { status: 400 })
    this.setMeta('tenantId', tenantId)

    const pair = new WebSocketPair()
    if (deviceId) {
      for (const old of this.ctx.getWebSockets(`dev:${deviceId}`)) old.close(4000, 'replaced')
      this.ctx.acceptWebSocket(pair[1], [`dev:${deviceId}`])
      const now = Date.now()
      pair[1].serializeAttachment({ kind: 'player', deviceId, since: now } satisfies Attachment)
      this.sql.exec(
        'INSERT INTO device_state (device_id, last_seen) VALUES (?, ?) ON CONFLICT(device_id) DO UPDATE SET last_seen = excluded.last_seen',
        deviceId,
        now,
      )
      this.toDashboards(deviceId)
      await this.scheduleAlarm()
    } else {
      this.ctx.acceptWebSocket(pair[1], ['dash'])
      pair[1].serializeAttachment({ kind: 'dash' } satisfies Attachment)
    }
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const att = ws.deserializeAttachment() as Attachment
    if (att.kind !== 'player' || typeof raw !== 'string') return
    let msg: PlayerToServer
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    const now = Date.now()
    if (msg.t === 'hello') {
      const active = await this.activeAnnouncement()
      const out: ServerToPlayer = {
        t: 'welcome',
        now,
        cmd: this.desired(att.deviceId),
        ann: active?.deviceIds.has(att.deviceId) ? active.ann : null,
      }
      ws.send(JSON.stringify(out))
    } else if (msg.t === 'time') {
      const out: ServerToPlayer = { t: 'time', c: msg.c, s: now }
      ws.send(JSON.stringify(out))
    } else if (msg.t === 'state') {
      const reported: Reported = { ...msg.state, at: now }
      const row = this.row(att.deviceId)
      // Storage writes are billed per row and a playing TV reports every 20s with only its position moved,
      // so those go straight to open dashboards and are saved just often enough to survive a restart.
      const changed = !row?.reported || !sameReport(JSON.parse(row.reported) as Reported, reported)
      if (changed || now - (row?.last_seen ?? 0) > PERSIST_EVERY) {
        this.sql.exec(
          'UPDATE device_state SET reported = ?, last_seen = ? WHERE device_id = ?',
          JSON.stringify(reported),
          now,
          att.deviceId,
        )
      }
      this.toDashboards(att.deviceId, reported)
    } else if (msg.t === 'stats') {
      this.addStats(att.deviceId, msg)
    }
  }

  // Sent by a TV every ten minutes, so the totals cost a handful of row writes per TV per hour.
  private addStats(deviceId: string, msg: Extract<PlayerToServer, { t: 'stats' }>) {
    if (typeof msg.day !== 'string' || !DAY_FORMAT.test(msg.day)) return
    // A TV that was offline can send hours of playback at once, but never more than a day's worth.
    const seconds = (n: unknown) => Math.max(0, Math.min(86_400, Math.round(Number(n) || 0)))
    const up = Math.min(seconds(msg.up), 3600)
    if (up) {
      this.sql.exec(
        'INSERT INTO stat_up (day, device_id, seconds) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET seconds = MIN(86400, seconds + excluded.seconds)',
        msg.day,
        deviceId,
        up,
      )
    }
    for (const play of Array.isArray(msg.plays) ? msg.plays.slice(0, 40) : []) {
      const s = seconds(play?.s)
      if (!s || typeof play.id !== 'string' || play.id.length > 64) continue
      this.sql.exec(
        'INSERT INTO stat_play (day, device_id, media_id, seconds) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET seconds = MIN(86400, seconds + excluded.seconds)',
        msg.day,
        deviceId,
        play.id,
        s,
      )
    }
  }

  async stats(fromDay: string) {
    type Up = { day: string; device_id: string; seconds: number }
    type Play = Up & { media_id: string }
    return {
      up: this.sql.exec<Up>('SELECT day, device_id, seconds FROM stat_up WHERE day >= ?', fromDay).toArray(),
      plays: this.sql
        .exec<Play>('SELECT day, device_id, media_id, seconds FROM stat_play WHERE day >= ? ORDER BY seconds DESC LIMIT 5000', fromDay)
        .toArray(),
    }
  }

  async refreshPlayers() {
    const text = JSON.stringify({ t: 'refresh' } satisfies ServerToPlayer)
    for (const ws of this.ctx.getWebSockets()) {
      if ((ws.deserializeAttachment() as Attachment).kind === 'player') ws.send(text)
    }
  }

  private async activeAnnouncement(): Promise<{ ann: Announcement; deviceIds: Set<string> } | null> {
    const tenantId = this.meta('tenantId')
    if (!tenantId) return null
    const row = await this.env.DB.prepare(
      'SELECT id, text, bg, target_type, target_ids FROM announcements WHERE tenant_id = ?',
    )
      .bind(tenantId)
      .first<{ id: string; text: string; bg: string; target_type: Target['type']; target_ids: string }>()
    if (!row) return null
    const devices = await resolveTarget(this.env.DB, tenantId, {
      type: row.target_type,
      ids: JSON.parse(row.target_ids) as string[],
    })
    return {
      ann: { id: row.id, text: row.text, bg: row.bg },
      deviceIds: new Set(devices.map((d) => d.id)),
    }
  }

  /** Pushes the current announcement to every connected TV; screens outside the target get it cleared. */
  async announcementsChanged(tenantId: string) {
    this.setMeta('tenantId', tenantId)
    const active = await this.activeAnnouncement()
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment
      if (att.kind !== 'player') continue
      const a = active?.deviceIds.has(att.deviceId) ? active.ann : null
      ws.send(JSON.stringify({ t: 'announcement', a } satisfies ServerToPlayer))
    }
  }

  /** Stops broadcasts the current plan no longer covers: screens over the limit, and uploads on a plan without storage. */
  private async enforcePlan(tenantId: string) {
    const playing = this.sql
      .exec<{ device_id: string; desired: string }>('SELECT device_id, desired FROM device_state WHERE desired IS NOT NULL')
      .toArray()
    if (!playing.length) return
    const [plan, covered] = await Promise.all([tenantPlan(this.env.DB, tenantId), coveredDevices(this.env.DB, tenantId)])
    const stop = playing
      .filter(({ device_id, desired }) => {
        if (!covered.has(device_id)) return true
        const stored = (JSON.parse(desired) as Cmd).items.some((i) => i.kind !== 'youtube' && !i.url)
        return stored && plan.rules.maxStorage === 0
      })
      .map((row) => row.device_id)
    if (stop.length) await this.control(stop, 'stop')
  }

  private pruneStats(now: number) {
    const today = new Date(now).toISOString().slice(0, 10)
    if (this.meta('pruned') === today) return
    this.setMeta('pruned', today)
    const oldest = new Date(now - STATS_KEPT_DAYS * 86_400_000).toISOString().slice(0, 10)
    this.sql.exec('DELETE FROM stat_up WHERE day < ?', oldest)
    this.sql.exec('DELETE FROM stat_play WHERE day < ?', oldest)
  }

  async webSocketClose(ws: WebSocket) {
    await this.onGone(ws)
  }

  async webSocketError(ws: WebSocket) {
    await this.onGone(ws)
  }

  private async onGone(ws: WebSocket) {
    const att = ws.deserializeAttachment() as Attachment | null
    if (att?.kind !== 'player') return
    this.sql.exec('UPDATE device_state SET last_seen = ? WHERE device_id = ?', Date.now(), att.deviceId)
    this.toDashboards(att.deviceId)
    await this.scheduleAlarm(Date.now() + 2 * 60_000)
  }

  async dispatch(tenantId: string, deviceIds: string[], cmd: Cmd | null) {
    this.setMeta('tenantId', tenantId)
    for (const id of deviceIds) {
      this.setDesired(id, cmd)
      this.toDevice(id, { t: 'cmd', cmd })
      this.toDashboards(id)
    }
  }

  async control(deviceIds: string[], action: 'pause' | 'resume' | 'stop') {
    const now = Date.now()
    for (const id of deviceIds) {
      let cmd = this.desired(id)
      if (action === 'stop') {
        cmd = null
      } else if (!cmd) {
        continue
      } else if (action === 'pause' && !cmd.paused) {
        cmd = { ...cmd, paused: true, pausedAt: now }
      } else if (action === 'resume' && cmd.paused) {
        // Shift the timeline by the pause length so every TV resumes at the same spot.
        cmd = { ...cmd, paused: false, pausedAt: undefined, startAt: cmd.startAt + (now - (cmd.pausedAt ?? now)) }
      }
      this.setDesired(id, cmd)
      this.toDevice(id, { t: 'cmd', cmd })
      this.toDashboards(id)
    }
  }

  async snapshot(deviceIds: string[]): Promise<Record<string, DeviceLive>> {
    const rows = new Map(
      this.sql
        .exec<StateRow>('SELECT * FROM device_state')
        .toArray()
        .map((r) => [r.device_id, r]),
    )
    return Object.fromEntries(deviceIds.map((id) => [id, this.live(id, rows.get(id))]))
  }

  async forget(deviceId: string) {
    this.toDevice(deviceId, { t: 'revoked' })
    for (const ws of this.ctx.getWebSockets(`dev:${deviceId}`)) ws.close(4001, 'revoked')
    this.sql.exec('DELETE FROM device_state WHERE device_id = ?', deviceId)
    this.sql.exec('DELETE FROM stat_up WHERE device_id = ?', deviceId)
    this.sql.exec('DELETE FROM stat_play WHERE device_id = ?', deviceId)
  }

  async schedulesChanged(tenantId: string) {
    this.setMeta('tenantId', tenantId)
    await this.scheduleAlarm()
  }

  private async loadSchedules(tenantId: string): Promise<ScheduleRow[]> {
    const { results } = await this.env.DB.prepare(
      'SELECT id, name, content_type, content_id, target_type, target_ids, days, start_time, end_time FROM schedules WHERE tenant_id = ? AND enabled = 1',
    )
      .bind(tenantId)
      .all<ScheduleRow>()
    return results
  }

  private async scheduleAlarm(atLatest?: number) {
    const tenantId = this.meta('tenantId')
    if (!tenantId) return
    const now = Date.now()
    let next: number | null = atLatest ?? null
    const consider = (t: number | null) => {
      if (t !== null && (next === null || t < next)) next = t
    }
    for (const s of await this.loadSchedules(tenantId)) {
      const times = { days: JSON.parse(s.days) as number[], start: s.start_time, end: s.end_time }
      for (const offset of [7, 8, 9]) consider(nextEventAfter(times, offset, now))
    }
    if (this.ctx.getWebSockets().some((ws) => (ws.deserializeAttachment() as Attachment).kind === 'player')) {
      consider(now + SWEEP_EVERY)
    }
    if (this.meta('lastCheck') === null) this.setMeta('lastCheck', String(now))
    if (next === null) await this.ctx.storage.deleteAlarm()
    else await this.ctx.storage.setAlarm(next)
  }

  async alarm() {
    const tenantId = this.meta('tenantId')
    if (!tenantId) return
    const now = Date.now()
    const lastCheck = Math.max(Number(this.meta('lastCheck') ?? now - 60_000), now - MAX_CATCHUP)
    this.setMeta('lastCheck', String(now))

    await this.runSchedules(tenantId, lastCheck, now)
    await this.enforcePlan(tenantId)
    await this.checkOffline(tenantId, now)
    this.pruneStats(now)
    await this.scheduleAlarm()
  }

  private async runSchedules(tenantId: string, after: number, now: number) {
    for (const s of await this.loadSchedules(tenantId)) {
      const times = { days: JSON.parse(s.days) as number[], start: s.start_time, end: s.end_time }
      const target: Target = { type: s.target_type, ids: JSON.parse(s.target_ids) }
      const devices = await resolveTarget(this.env.DB, tenantId, target, true)

      for (const offset of [7, 8, 9]) {
        const ids = devices.filter((d) => d.offset === offset).map((d) => d.id)
        if (!ids.length) continue
        // Only the most recent event matters if several were missed.
        const last = eventsBetween(times, offset, after, now).at(-1)
        if (!last) continue

        if (last.type === 'start') {
          const content = await resolveContent(this.env.DB, tenantId, s.content_type, s.content_id, offset)
          if (!content?.items.length) {
            // Everything is outside its validity dates: leave the screens idle rather than replaying an old promo.
            if (content) {
              const mine = ids.filter((id) => this.desired(id)?.scheduleId === s.id)
              if (mine.length) await this.control(mine, 'stop')
            }
            continue
          }
          await this.dispatch(tenantId, ids, {
            id: newId(),
            name: content.name,
            items: content.items,
            startAt: now + START_LEAD,
            paused: false,
            scheduleId: s.id,
          })
        } else {
          const mine = ids.filter((id) => this.desired(id)?.scheduleId === s.id)
          if (mine.length) await this.control(mine, 'stop')
        }
      }
    }
  }

  private async checkOffline(tenantId: string, now: number) {
    const tenant = await this.env.DB.prepare('SELECT alert_threshold FROM tenants WHERE id = ?')
      .bind(tenantId)
      .first<{ alert_threshold: number }>()
    if (!tenant) return
    const { results } = await this.env.DB.prepare('SELECT id, name FROM devices WHERE tenant_id = ?')
      .bind(tenantId)
      .all<{ id: string; name: string }>()

    // A TV that never connected isn't "down", it just hasn't been set up yet.
    const offline = results.filter((d) => this.row(d.id)?.last_seen && !this.isOnline(d.id, now))
    const alerted = this.meta('alerted') === '1'

    if (offline.length >= tenant.alert_threshold && !alerted) {
      this.setMeta('alerted', '1')
      const names = offline.slice(0, 5).map((d) => d.name).join(', ')
      await notifyTenant(
        this.env,
        tenantId,
        `${offline.length} layar offline`,
        offline.length > 5 ? `${names}, dan ${offline.length - 5} lainnya` : names,
      )
    } else if (offline.length < tenant.alert_threshold && alerted) {
      this.setMeta('alerted', '0')
    }
    for (const d of offline) this.toDashboards(d.id)
  }
}
