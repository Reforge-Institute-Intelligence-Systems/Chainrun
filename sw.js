const CACHE_NAME = 'pw-v105';
const SHELL_FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './engine.js',
  './api.js',
  './profiles.js',
  './paygate.js',
  './manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
    .then(() => {
      self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'SW_UPDATED', version: CACHE_NAME });
        });
      });
    })
  );
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', e => {
  // Never cache API calls or external services
  if (e.request.url.includes('api.openai.com') ||
      e.request.url.includes('api.anthropic.com') ||
      e.request.url.includes('api.perplexity.ai') ||
      e.request.url.includes('generativelanguage.googleapis.com') ||
      e.request.url.includes('api.x.ai') ||
      e.request.url.includes('chainrun-proxy') ||
      e.request.url.includes('buy.stripe.com') ||
      e.request.url.includes('fontshare.com')) {
    return;
  }

  // Network-first for EVERYTHING — HTML, CSS, JS, all of it.
  // Cache is only a fallback for offline/failure.
  e.respondWith(
    fetch(e.request)
      .then(response => {
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});
