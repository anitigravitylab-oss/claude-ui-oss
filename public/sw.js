// Claude UI service worker.
//
// Scope: app-shell caching only. `/api/*` and `/ws/*` are always network-only —
// they carry auth-token-guarded, session-specific data and must never be cached.
//
// Update model: bump CACHE_VERSION on any app-shell file change. `activate`
// deletes every cache that doesn't match the current name, so old shells never
// linger. No build-time timestamps are used — this is a manually bumped
// constant so a deploy without a bump intentionally keeps serving the old
// cached shell (conservative default).
const CACHE_VERSION = 'v3';
const CACHE_NAME = `claude-ui-shell-${CACHE_VERSION}`;

// Precached app shell. Keep this conservative: static, non-auth assets only.
const APP_SHELL = [
  './',
  './index.html',
  './theme-init.js',
  './app.js',
  './app.css',
  './manifest.webmanifest',
  './vendor/xterm.css',
  './vendor/xterm.js',
  './vendor/addon-fit.js',
  './vendor/addon-web-links.js',
  './vendor/marked.min.js',
  './vendor/purify.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // addAll is all-or-nothing; a single missing/renamed asset must not
      // block installation of the rest of the shell.
      await Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch((err) => console.warn('[sw] precache skip', url, err && err.message))
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('claude-ui-shell-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

function isNetworkOnly(url) {
  return url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never intercept writes

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // same-origin only
  if (isNetworkOnly(url)) return; // let the browser handle /api and /ws untouched

  // Navigations: cache-first shell, offline falls back to the cached shell too.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match('./index.html');
        try {
          const fresh = await fetch(req);
          return fresh;
        } catch (err) {
          if (cached) return cached;
          throw err;
        }
      })()
    );
    return;
  }

  // Other same-origin GETs: cache-first against the precached shell only.
  // Anything not in the precache list falls through to a normal network
  // fetch (no dynamic runtime caching — keep this conservative).
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        return await fetch(req);
      } catch (err) {
        if (cached) return cached;
        throw err;
      }
    })()
  );
});

// ---- Web Push ----

self.addEventListener('push', (event) => {
  let payload = { title: 'Claude UI', body: '' };
  try {
    if (event.data) payload = Object.assign(payload, event.data.json());
  } catch (err) {
    if (event.data) payload.body = event.data.text();
  }

  event.waitUntil(
    (async () => {
      // Don't interrupt with a notification if a focused window already shows it.
      const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const hasFocused = clientsList.some((c) => c.focused);
      if (hasFocused) return;

      await self.registration.showNotification(payload.title || 'Claude UI', {
        body: payload.body || '',
        tag: payload.tag || 'claude-ui',
        icon: './icons/icon-192.png',
        badge: './icons/icon-192.png',
        data: { url: payload.url || './' },
      });
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  let targetUrl = new URL('./', self.location.href);
  try {
    const requested = new URL((event.notification.data && event.notification.data.url) || './', self.location.href);
    if (requested.origin === self.location.origin) targetUrl = requested;
  } catch {
    // Keep the safe same-origin fallback.
  }

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of clientsList) {
        try {
          const cUrl = new URL(c.url);
          if (cUrl.origin === targetUrl.origin) {
            await c.focus();
            return;
          }
        } catch (err) {
          /* ignore malformed URL, keep looking */
        }
      }
      await self.clients.openWindow(targetUrl.href);
    })()
  );
});
