// End-to-end check against a running dev server: node scripts/smoke.mjs [baseUrl]
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

const base = process.argv[2] ?? 'http://localhost:5173'
const wsBase = base.replace(/^http/, 'ws')

function client() {
  let cookie = ''
  return async (method, path, body, headers = {}) => {
    const isJson = body !== undefined && !(body instanceof Uint8Array)
    const res = await fetch(base + path, {
      method,
      headers: { ...(isJson ? { 'content-type': 'application/json' } : {}), cookie, origin: base, ...headers },
      body: isJson ? JSON.stringify(body) : body,
    })
    const set = res.headers.getSetCookie?.()[0]
    if (set) cookie = set.split(';')[0]
    const text = await res.text()
    let data
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
    return { status: res.status, data, headers: res.headers, cookie }
  }
}

const ok = (res, label) => {
  assert.ok(res.status < 300, `${label}: ${res.status} ${JSON.stringify(res.data)}`)
  return res.data
}

function socket(url, headers) {
  const ws = new WebSocket(url, headers ? { headers } : undefined)
  const queue = []
  const waiters = []
  ws.addEventListener('message', (e) => {
    if (e.data === 'pong') return
    const msg = JSON.parse(e.data)
    const i = waiters.findIndex((w) => w.match(msg))
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg)
    else queue.push(msg)
  })
  return {
    ws,
    open: new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve)
      ws.addEventListener('error', () => reject(new Error(`ws failed: ${url}`)))
    }),
    send: (msg) => ws.send(JSON.stringify(msg)),
    next(match, label) {
      const i = queue.findIndex(match)
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0])
      return new Promise((resolve, reject) => {
        waiters.push({ match, resolve })
        setTimeout(() => reject(new Error(`timeout waiting for ${label}`)), 5000)
      })
    },
  }
}

const stamp = Date.now()
const owner = client()
const email = `owner${stamp}@example.com`

ok(await owner('POST', '/api/auth/register', { businessName: 'Toko Uji', name: 'Pemilik', email, password: 'rahasia123' }), 'register')
const me = ok(await owner('GET', '/api/auth/me'), 'me')
assert.equal(me.tenant.name, 'Toko Uji')
assert.equal(me.permissions.length, 8)

assert.equal((await client()('GET', '/api/devices')).status, 401, 'unauthenticated request is rejected')
assert.equal((await client()('POST', '/api/auth/login', { email, password: 'salah' })).status, 401)

const [branch] = ok(await owner('GET', '/api/branches'), 'branches')

// New businesses start on a 7-day trial: Pro limits, 1 GB of uploads
assert.equal(me.tenant.plan, 'trial')
assert.ok(Math.abs(me.tenant.planExpiresAt - Date.now() - 7 * 86_400_000) < 60_000)
assert.equal(me.tenant.limits.maxDevices, 10)
const tooBig = { title: 'Besar', size: 2 * 1024 ** 3, mime: 'video/mp4', duration: 5, width: 1280, height: 720 }
assert.equal((await owner('POST', '/api/media/uploads', tooBig)).status, 413, 'trial upload allowance')

// Pair three TVs during the trial; the free plan that follows covers only two
const extras = []
for (const name of ['TV Satu', 'TV Dua', 'TV Tiga']) {
  const p = ok(await client()('POST', '/api/player/pair'), 'extra pair start')
  const [b] = ok(await owner('GET', '/api/branches'), 'branches')
  extras.push(ok(await owner('POST', '/api/devices/pair', { code: p.code, name, branchId: b.id }), 'extra pair'))
}

// End the trial the only way a local run can: by moving its end date into the past
execFileSync('npx', ['wrangler', 'd1', 'execute', 'adcast', '--local', '--command', `UPDATE tenants SET plan_expires_at = 1 WHERE id = '${me.tenant.id}'`], { stdio: 'ignore' })
const lapsed = ok(await owner('GET', '/api/auth/me'), 'me after trial')
assert.equal(lapsed.tenant.plan, 'free')
assert.deepEqual(ok(await owner('GET', '/api/devices'), 'devices after trial').map((d) => d.covered).sort(), [false, true, true], 'free plan covers two screens')
for (const d of extras) ok(await owner('DELETE', `/api/devices/${d.id}`), 'extra delete')

// Free plan: links only, one branch
assert.equal((await owner('POST', '/api/branches', { name: 'Jayapura', timezone: 'Asia/Jayapura' })).status, 403, 'free plan has one branch')
assert.equal((await owner('POST', '/api/media/uploads', { title: 'Promo', size: 1024, mime: 'video/mp4', duration: 5, width: 1280, height: 720 })).status, 403, 'free plan takes no uploads')
const linkBody = { title: 'Promo', duration: 5, width: 1280, height: 720 }
assert.equal((await owner('POST', '/api/media/link', { ...linkBody, url: 'http://example.com/a.mp4' })).status, 400, 'plain http link')
assert.equal((await owner('POST', '/api/media/link', { ...linkBody, url: 'https://youtu.be/dQw4w9WgXcQ' })).status, 400, 'youtube as link')
assert.equal((await owner('PATCH', '/api/tenant', { name: 'Toko Uji', brandColor: '#123456', alertThreshold: 1 })).status, 403, 'free plan keeps default colour')

// Upgrade: order, pay by QRIS, operator confirms by hand (needs ADMIN_EMAILS=admin@adcast.test in .dev.vars)
assert.equal((await owner('POST', '/api/billing/orders', { plan: 'pro', months: 3 })).status, 400, 'unknown period')
ok(await owner('POST', '/api/billing/orders', { plan: 'business', months: 1 }), 'first order')
const { id: orderId } = ok(await owner('POST', '/api/billing/orders', { plan: 'pro', months: 1 }), 'order')
let billing = ok(await owner('GET', '/api/billing'), 'billing')
assert.equal(billing.orders.filter((o) => o.status === 'pending').length, 1, 'a new order replaces the unpaid one')
assert.equal(billing.open.id, orderId)
assert.equal(billing.open.amount, 99_000 + billing.open.uniqueCode)
assert.ok(billing.open.uniqueCode >= 1 && billing.open.uniqueCode <= 999)
assert.ok(billing.open.qris.includes(`54${String(billing.open.amount).length.toString().padStart(2, '0')}${billing.open.amount}`))
assert.equal((await owner('GET', '/api/billing/admin/orders')).status, 404, 'tenants cannot see the operator queue')
assert.equal((await owner('POST', `/api/billing/admin/orders/${orderId}/confirm`)).status, 404)
ok(await owner('POST', `/api/billing/orders/${orderId}/claim`), 'claim')
assert.equal((await owner('POST', `/api/billing/orders/${orderId}/cancel`)).status, 409, 'claimed order cannot be cancelled')
assert.equal((await owner('POST', '/api/billing/orders', { plan: 'pro', months: 1 })).status, 409, 'one claimed order at a time')

const operator = client()
const opLogin = { email: 'admin@adcast.test', password: 'rahasia123' }
if ((await operator('POST', '/api/auth/login', opLogin)).status !== 200) {
  ok(await operator('POST', '/api/auth/register', { businessName: 'AdCast', name: 'Operator', ...opLogin }), 'operator register')
}
const queue = ok(await operator('GET', '/api/billing/admin/orders'), 'operator queue')
assert.equal(queue.find((o) => o.id === orderId).tenantName, 'Toko Uji')
const confirmed = ok(await operator('POST', `/api/billing/admin/orders/${orderId}/confirm`), 'confirm')
assert.equal((await operator('POST', `/api/billing/admin/orders/${orderId}/confirm`)).status, 409, 'confirming twice does nothing')
billing = ok(await owner('GET', '/api/billing'), 'billing after')
assert.equal(billing.plan, 'pro')
assert.equal(billing.expiresAt, confirmed.expiresAt)
assert.ok(Math.abs(billing.expiresAt - Date.now() - 30 * 86_400_000) < 60_000)
assert.equal(ok(await owner('GET', '/api/auth/me'), 'me pro').tenant.limits.maxDevices, 10)

const timur = ok(await owner('POST', '/api/branches', { name: 'Jayapura', timezone: 'Asia/Jayapura' }), 'branch create')

// TV pairing
const tv = client()
const pairing = ok(await tv('POST', '/api/player/pair'), 'pair start')
const auth = { authorization: `Bearer ${pairing.secret}` }
assert.equal(ok(await tv('GET', '/api/player/pair', undefined, auth), 'pair poll').status, 'pending')
const device = ok(await owner('POST', '/api/devices/pair', { code: pairing.code.toLowerCase(), name: 'TV Lobi', branchId: branch.id }), 'pair confirm')
const paired = ok(await tv('GET', '/api/player/pair', undefined, auth), 'pair poll 2')
assert.equal(paired.status, 'paired')
assert.equal(ok(await tv('GET', '/api/player/pair', undefined, auth), 'pair poll 3').status, 'expired', 'token is handed out once')
const token = paired.token
assert.equal(ok(await tv('GET', '/api/player/me', undefined, { authorization: `Bearer ${token}` }), 'player me').device.name, 'TV Lobi')

// Upload: 9 MB fake MP4 so it spans two parts
const size = 9 * 1024 * 1024
const file = new Uint8Array(size)
file.set([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])
file[size - 1] = 0x7f
const up = ok(await owner('POST', '/api/media/uploads', { title: 'Promo Siang', size, mime: 'video/mp4', duration: 12.5, width: 1920, height: 1080 }), 'upload init')
const parts = []
for (let n = 1, off = 0; off < size; n++, off += up.partSize) {
  parts.push(ok(await owner('PUT', `/api/media/uploads/${up.id}/parts/${n}`, file.subarray(off, off + up.partSize), { 'content-type': 'application/octet-stream' }), `part ${n}`))
}
assert.equal(parts.length, 2)
ok(await owner('POST', `/api/media/uploads/${up.id}/complete`, { parts }), 'upload complete')

// A file that isn't a video must be rejected and never become playable
const junk = new Uint8Array(1024).fill(65)
const bad = ok(await owner('POST', '/api/media/uploads', { title: 'Rusak', size: junk.length, mime: 'video/mp4', duration: null, width: null, height: null }), 'bad init')
const badPart = ok(await owner('PUT', `/api/media/uploads/${bad.id}/parts/1`, junk, { 'content-type': 'application/octet-stream' }), 'bad part')
assert.equal((await owner('POST', `/api/media/uploads/${bad.id}/complete`, { parts: [badPart] })).status, 400)

const library = ok(await owner('GET', '/api/media'), 'media list')
assert.equal(library.items.find((m) => m.id === up.id).status, 'ready')
assert.equal(library.items.find((m) => m.id === bad.id).status, 'failed')
assert.equal(library.used, size)

// Range request with the device token
const range = await fetch(`${base}/media/${up.id}?t=${token}`, { headers: { range: `bytes=${size - 4}-` } })
assert.equal(range.status, 206)
assert.equal(range.headers.get('content-range'), `bytes ${size - 4}-${size - 1}/${size}`)
assert.equal(new Uint8Array(await range.arrayBuffer())[3], 0x7f)
assert.equal((await fetch(`${base}/media/${up.id}`)).status, 401, 'media needs auth')
assert.equal((await fetch(`${base}/media/${up.id}?t=wrong`)).status, 401)

// Live sockets
const dash = socket(`${wsBase}/api/ws`, { cookie: (await owner('GET', '/api/auth/me')).cookie, origin: base })
await dash.open
const player = socket(`${wsBase}/api/player/ws?t=${token}`)
await player.open
player.send({ t: 'hello' })
const welcome = await player.next((m) => m.t === 'welcome', 'welcome')
assert.equal(welcome.cmd, null)
assert.ok(Math.abs(welcome.now - Date.now()) < 5000)
await dash.next((m) => m.t === 'device' && m.id === device.id && m.live.online, 'dashboard sees TV online')

const playlist = ok(await owner('POST', '/api/playlists', { name: 'Promo Harian', mediaIds: [up.id, up.id] }), 'playlist')

// Photos: stored as-is, shown for a set number of seconds
const jpeg = new Uint8Array(2048)
jpeg.set([0xff, 0xd8, 0xff, 0xe0])
assert.equal((await owner('PUT', '/api/media/images?title=Bukan&width=10&height=10', new Uint8Array(64), { 'content-type': 'image/jpeg' })).status, 400, 'not an image')
const photo = ok(await owner('PUT', '/api/media/images?title=Menu%20Baru&width=1920&height=1080', jpeg, { 'content-type': 'image/jpeg' }), 'photo upload')
ok(await owner('PATCH', `/api/media/${photo.id}`, { title: 'Menu Baru', duration: 15 }), 'photo duration')
ok(await owner('PATCH', `/api/media/${up.id}`, { title: 'Promo Siang', duration: 99 }), 'video rename')
const mediaNow = ok(await owner('GET', '/api/media'), 'media list').items
assert.equal(mediaNow.find((m) => m.id === photo.id).duration, 15)
assert.equal(mediaNow.find((m) => m.id === up.id).duration, 12.5, 'a video keeps its real length')
assert.equal((await owner('GET', `/media/${photo.id}`)).headers.get('content-type'), 'image/jpeg')
ok(await owner('POST', '/api/broadcasts', { contentType: 'media', contentId: photo.id, target: { type: 'all', ids: [] } }), 'photo broadcast')
const photoCmd = (await player.next((m) => m.t === 'cmd' && m.cmd?.items[0]?.mediaId === photo.id, 'photo cmd')).cmd
assert.deepEqual([photoCmd.items[0].kind, photoCmd.items[0].duration], ['image', 15])

// Prayer pause: saved per branch and handed to the TV, which also gets told to reload its settings
ok(await owner('PATCH', `/api/branches/${branch.id}`, { name: 'Pusat', timezone: 'Asia/Jakarta', prayer: { enabled: true, city: 'Malang', lat: -7.9666, lng: 112.6326, pause: 12, jumat: 40 } }), 'prayer on')
assert.equal((await player.next((m) => m.t === 'refresh', 'refresh')).t, 'refresh')
const tvInfo = ok(await tv('GET', '/api/player/me', undefined, { authorization: `Bearer ${token}` }), 'player me prayer')
assert.deepEqual(tvInfo.prayer, { lat: -7.9666, lng: 112.6326, offset: 7, pause: 12, jumat: 40 })
assert.equal((await owner('PATCH', `/api/branches/${branch.id}`, { name: 'Pusat', timezone: 'Asia/Jakarta', prayer: { enabled: true, city: null, lat: null, lng: null, pause: 10, jumat: 45 } })).status, 400, 'prayer needs a place')

// Statistics: the TV reports totals, the dashboard reads them back per screen
const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10)
player.send({ t: 'stats', day: today, up: 600, plays: [{ id: up.id, s: 500 }, { id: photo.id, s: 90 }] })
player.send({ t: 'stats', day: today, up: 600, plays: [{ id: up.id, s: 100 }] })
player.send({ t: 'stats', day: 'bukan-tanggal', up: 600, plays: [] })
await new Promise((r) => setTimeout(r, 300))
const stats = ok(await owner('GET', '/api/stats?days=90'), 'stats')
assert.equal(stats.days, 30, 'Pro reaches 30 days back')
assert.equal(stats.up[device.id][today], 1200)
assert.equal(stats.plays.find((p) => p.mediaId === up.id).seconds, 600)
assert.equal(stats.media[photo.id].kind, 'image')
const sent = ok(await owner('POST', '/api/broadcasts', { contentType: 'playlist', contentId: playlist.id, target: { type: 'branch', ids: [branch.id] } }), 'broadcast')
assert.equal(sent.screens, 1)
const { cmd } = await player.next((m) => m.t === 'cmd', 'cmd')
assert.equal(cmd.items.length, 2)
assert.equal(cmd.items[0].duration, 12.5)
assert.ok(cmd.startAt > Date.now())

player.send({ t: 'state', state: { status: 'playing', cmdId: cmd.id, mediaId: up.id, title: 'Promo Siang', position: 1 } })
const seen = await dash.next((m) => m.t === 'device' && m.live.reported?.status === 'playing', 'dashboard sees playing')
assert.equal(seen.live.desired.name, 'Promo Harian')

ok(await owner('POST', '/api/broadcasts/control', { action: 'pause', target: { type: 'all', ids: [] } }), 'pause')
const paused = await player.next((m) => m.t === 'cmd', 'pause cmd')
assert.equal(paused.cmd.paused, true)
await new Promise((r) => setTimeout(r, 300))
ok(await owner('POST', '/api/broadcasts/control', { action: 'resume', target: { type: 'device', ids: [device.id] } }), 'resume')
const resumed = await player.next((m) => m.t === 'cmd', 'resume cmd')
assert.equal(resumed.cmd.paused, false)
assert.ok(resumed.cmd.startAt - cmd.startAt >= 250, 'timeline shifts by the pause length')

assert.equal((await owner('POST', '/api/broadcasts', { contentType: 'media', contentId: up.id, target: { type: 'branch', ids: [timur.id] } })).status, 400, 'empty branch')

let devices = ok(await owner('GET', '/api/devices'), 'devices')
assert.equal(devices[0].live.online, true)
assert.equal(devices[0].live.reported.status, 'playing')

// Reconnect picks the current command back up
player.ws.close()
await dash.next((m) => m.t === 'device' && !m.live.online, 'dashboard sees TV offline')
const again = socket(`${wsBase}/api/player/ws?t=${token}`)
await again.open
again.send({ t: 'hello' })
assert.equal((await again.next((m) => m.t === 'welcome', 'welcome 2')).cmd.id, cmd.id)

ok(await owner('POST', '/api/broadcasts/control', { action: 'stop', target: { type: 'all', ids: [] } }), 'stop')
assert.equal((await again.next((m) => m.t === 'cmd', 'stop cmd')).cmd, null)

// Running text: a branch default, overridable per broadcast
ok(
  await owner('PATCH', `/api/branches/${branch.id}`, {
    name: 'Pusat',
    timezone: 'Asia/Jakarta',
    ticker: { enabled: true, text: 'Promo hari ini', speed: 120, bg: '#000000' },
  }),
  'branch ticker',
)
const tickerInfo = ok(await tv('GET', '/api/player/me', undefined, { authorization: `Bearer ${token}` }), 'player me ticker')
assert.deepEqual(tickerInfo.ticker, { text: 'Promo hari ini', speed: 120, bg: '#000000' })
ok(
  await owner('POST', '/api/broadcasts', {
    contentType: 'media',
    contentId: up.id,
    target: { type: 'all', ids: [] },
    ticker: { text: 'Khusus kiriman ini', speed: 60, bg: '#112233' },
  }),
  'ticker broadcast',
)
const tickerCmd = (await again.next((m) => m.t === 'cmd' && !!m.cmd?.ticker, 'ticker cmd')).cmd
assert.deepEqual(tickerCmd.ticker, { text: 'Khusus kiriman ini', speed: 60, bg: '#112233' })

// Portrait screen: rotation is a per-screen setting handed to the TV
ok(await owner('PATCH', `/api/devices/${device.id}`, { name: 'TV Lobi', branchId: branch.id, rotation: 90 }), 'rotation')
assert.equal(
  ok(await tv('GET', '/api/player/me', undefined, { authorization: `Bearer ${token}` }), 'player me rotation').device.rotation,
  90,
)

// Content validity: an expired playlist is skipped entirely
ok(
  await owner('PATCH', `/api/media/${up.id}`, { title: 'Promo Siang', duration: 99, startDate: null, endDate: '2020-01-01' }),
  'expire media',
)
assert.equal(
  (await owner('POST', '/api/broadcasts', { contentType: 'playlist', contentId: playlist.id, target: { type: 'all', ids: [] } })).status,
  400,
  'expired playlist is not broadcast',
)
ok(
  await owner('PATCH', `/api/media/${up.id}`, { title: 'Promo Siang', duration: 99, startDate: null, endDate: null }),
  'restore media',
)

// Emergency announcement: shown on top, then cleared back to the running broadcast
ok(
  await owner('POST', '/api/announcements', { text: 'Toko tutup lebih awal', bg: '#b91c1c', target: { type: 'all', ids: [] } }),
  'announcement',
)
assert.equal((await again.next((m) => m.t === 'announcement' && !!m.a, 'announcement shown')).a.text, 'Toko tutup lebih awal')
assert.equal(ok(await owner('GET', '/api/announcements'), 'announcement state').text, 'Toko tutup lebih awal')
ok(await owner('DELETE', '/api/announcements'), 'announcement clear')
assert.equal((await again.next((m) => m.t === 'announcement' && !m.a, 'announcement cleared')).a, null)

// Schedules
const schedule = ok(await owner('POST', '/api/schedules', { name: 'Makan siang', contentType: 'playlist', contentId: playlist.id, target: { type: 'all', ids: [] }, days: [1, 2, 3, 4, 5], startTime: '11:30', endTime: '13:00', enabled: true }), 'schedule')
assert.equal(ok(await owner('GET', '/api/schedules'), 'schedules')[0].days.length, 5)
assert.equal((await owner('DELETE', `/api/playlists/${playlist.id}`)).status, 409, 'playlist in use by a schedule')
ok(await owner('DELETE', `/api/schedules/${schedule.id}`), 'schedule delete')

// Roles and tenant isolation
const roles = ok(await owner('GET', '/api/roles'), 'roles')
const viewer = roles.find((r) => r.name === 'Pemantau')
const staffEmail = `staff${stamp}@example.com`
ok(await owner('POST', '/api/users', { name: 'Staf', email: staffEmail, password: 'rahasia123', roleId: viewer.id }), 'user add')
const staff = client()
ok(await staff('POST', '/api/auth/login', { email: staffEmail, password: 'rahasia123' }), 'staff login')
assert.equal(ok(await staff('GET', '/api/devices'), 'staff devices').length, 1)
assert.equal((await staff('POST', '/api/broadcasts', { contentType: 'media', contentId: up.id, target: { type: 'all', ids: [] } })).status, 403)
assert.equal((await staff('GET', '/api/audit')).status, 403)
ok(await owner('PUT', `/api/roles/${viewer.id}`, { name: 'Pemantau', permissions: ['broadcast'] }), 'role update')
ok(await staff('POST', '/api/broadcasts', { contentType: 'media', contentId: up.id, target: { type: 'all', ids: [] } }), 'staff broadcast after grant')
const owners = roles.find((r) => r.isOwner)
assert.equal((await staff('PATCH', `/api/users/${me.user.id}`, { roleId: viewer.id })).status, 403)
assert.equal((await owner('PATCH', `/api/users/${me.user.id}`, { roleId: viewer.id })).status, 409, 'last owner is protected')
assert.ok(owners)

const other = client()
ok(await other('POST', '/api/auth/register', { businessName: 'Usaha Lain', name: 'Orang Lain', email: `other${stamp}@example.com`, password: 'rahasia123' }), 'register 2')
assert.equal(ok(await other('GET', '/api/devices'), 'other devices').length, 0)
assert.equal(ok(await other('GET', '/api/media'), 'other media').items.length, 0)
assert.equal((await other('GET', `/media/${up.id}`)).status, 404)
assert.equal((await other('POST', '/api/broadcasts', { contentType: 'media', contentId: up.id, target: { type: 'all', ids: [] } })).status, 404)
assert.equal((await other('DELETE', `/api/devices/${device.id}`)).status, 404)

const log = ok(await owner('GET', '/api/audit'), 'audit')
assert.ok(log.some((l) => l.action === 'broadcast.sent'))

// Removing the screen revokes its token
ok(await owner('DELETE', `/api/devices/${device.id}`), 'device delete')
assert.equal((await again.next((m) => m.t === 'revoked', 'revoked')).t, 'revoked')
assert.equal((await tv('GET', '/api/player/me', undefined, { authorization: `Bearer ${token}` })).status, 401)

dash.ws.close()
again.ws.close()
console.log('smoke test passed')
process.exit(0)
