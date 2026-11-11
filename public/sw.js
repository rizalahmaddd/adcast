const SHELL = 'adcast-shell-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// Keeps the app shell available so a TV that reboots without internet can still open the player.
self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone()
          caches.open(SHELL).then((cache) => cache.put('/index.html', copy))
          return res
        })
        .catch(() => caches.match('/index.html').then((hit) => hit ?? Response.error())),
    )
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(SHELL).then((cache) => cache.put(request, copy))
            }
            return res
          }),
      ),
    )
  }
})

// Pushes arrive without a payload; the newest alert is read from the API instead.
self.addEventListener('push', (event) => {
  event.waitUntil(
    fetch('/api/notifications', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : []))
      .catch(() => [])
      .then((list) => {
        const latest = list[0]
        return self.registration.showNotification(latest?.title ?? 'AdCast', {
          body: latest?.body ?? 'Ada pembaruan status layar.',
          icon: '/icon.svg',
          tag: 'adcast-alert',
        })
      }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(self.clients.openWindow('/'))
})
