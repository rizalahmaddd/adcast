import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv, Bindings } from './env'
import { purgeLapsedUploads } from './lib/purge'
import admin from './routes/admin'
import announcements from './routes/announcements'
import auth from './routes/auth'
import billing from './routes/billing'
import content from './routes/content'
import devices from './routes/devices'
import media from './routes/media'
import { dashboardWs, mediaFiles, playerApi } from './routes/player'

export { TenantHub } from './hub'

const app = new Hono<AppEnv>()

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
  console.error(err)
  return c.json({ error: 'Terjadi kesalahan di server' }, 500)
})

// Player endpoints authenticate with a bearer token, not cookies, so they sit outside CSRF.
app.route('/api/player', playerApi)
app.route('/media', mediaFiles)

app.use('/api/*', csrf())
app.route('/api/ws', dashboardWs)
app.route('/api/auth', auth)
app.route('/api/media', media)
app.route('/api/billing', billing)
app.route('/api', devices)
app.route('/api', content)
app.route('/api/announcements', announcements)
app.route('/api', admin)

app.all('/api/*', (c) => c.json({ error: 'Tidak ditemukan' }, 404))

export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(purgeLapsedUploads(env))
  },
} satisfies ExportedHandler<Bindings>
