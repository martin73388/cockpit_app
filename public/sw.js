/* Cockpit service worker — hand-rolled, no build plugin.
 * - App-shell: network-first for navigations, falling back to cached index.
 * - Same-origin static assets (hashed by Vite): stale-while-revalidate.
 * - Cross-origin (GitHub API, Drive gateway): never intercepted -> always live.
 * Bump CACHE_VERSION to invalidate old caches on the next activation.
 */
const CACHE_VERSION = 'cockpit-v1'
const SCOPE_URL = new URL(self.registration.scope)
const SHELL_URL = new URL('./index.html', SCOPE_URL).toString()

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.add(SHELL_URL)).catch(() => {}),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))),
    ),
  )
  self.clients.claim()
})

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  // Only handle our own origin+scope. Everything else (APIs) stays live.
  if (url.origin !== SCOPE_URL.origin) return

  // Navigations -> network-first, fall back to cached shell (offline support).
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE_VERSION).then((c) => c.put(SHELL_URL, copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match(SHELL_URL).then((r) => r || Response.error())),
    )
    return
  }

  // Static assets -> stale-while-revalidate.
  event.respondWith(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200 && res.type === 'basic') cache.put(req, res.clone())
            return res
          })
          .catch(() => cached)
        return cached || network
      }),
    ),
  )
})
