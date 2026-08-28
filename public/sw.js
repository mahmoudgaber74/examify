const CACHE_NAME = 'examify-v3-public-static-only';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
];
const SENSITIVE_CACHE_NAMES = [
  'examify-v1',
  'examify-v2',
];

function isSupabaseRequest(url) {
  return url.hostname.includes('supabase.co') || url.pathname.includes('/functions/v1/');
}

function hasSensitiveHeaders(request) {
  return request.headers.has('authorization') || request.headers.has('apikey') || request.headers.has('cookie');
}

function isPublicStaticAsset(request, url) {
  if (url.origin !== self.location.origin) return false;
  if (request.method !== 'GET') return false;
  if (hasSensitiveHeaders(request)) return false;
  return (
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'font' ||
    request.destination === 'image' ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/favicon.svg' ||
    url.pathname === '/manifest.json'
  );
}

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME || SENSITIVE_CACHE_NAMES.includes(name))
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  // Never cache writes or credential-bearing requests.
  if (event.request.method !== 'GET') return;
  if (hasSensitiveHeaders(event.request)) return;

  const url = new URL(event.request.url);

  // Supabase REST/Auth/Storage/Functions must always be network-only.
  if (isSupabaseRequest(url)) {
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          return response;
        })
        .catch(() => caches.match(event.request).then((cachedResponse) => cachedResponse || caches.match('/')))
    );
    return;
  }

  if (!isPublicStaticAsset(event.request, url)) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Public static assets only - cache-first strategy.
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Return cached version and update in background
        fetch(event.request)
          .then((response) => {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, response);
            });
          })
          .catch(() => {});
        return cachedResponse;
      }

      return fetch(event.request)
        .then((response) => {
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Return offline fallback for navigation requests
          if (event.request.mode === 'navigate') {
            return caches.match('/');
          }
          return new Response('Offline', { status: 503 });
        });
    })
  );
});

// Push notification handler
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  const title = data.title || 'إكزاميفاي AI';
  const options = {
    body: data.body || 'إشعار جديد',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/',
      type: data.type || 'general',
    },
    actions: data.actions || [],
    dir: 'rtl',
    lang: 'ar',
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((windowClients) => {
      // Focus existing window if available
      for (const client of windowClients) {
        if (client.url === url && 'focus' in client) {
          return client.focus();
        }
      }
      // Open new window
      return clients.openWindow(url);
    })
  );
});

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-notifications') {
    event.waitUntil(syncNotifications());
  }
});

async function syncNotifications() {
  // Sync pending notifications when back online
  const pendingNotifications = await getPendingNotifications();
  for (const notif of pendingNotifications) {
    await fetch('/api/notifications/sync', {
      method: 'POST',
      body: JSON.stringify(notif),
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function getPendingNotifications() {
  // Get from IndexedDB
  return [];
}
