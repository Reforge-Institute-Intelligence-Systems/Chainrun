const CACHE_NAME = 'pw-v27';
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
  );
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

  // Stale-while-revalidate: serve cached immediately, fetch fresh in background
  e.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(e.request).then(cached => {
        const fetchPromise = fetch(e.request).then(response => {
          if (response.status === 200) {
            cache.put(e.request, response.clone());
          }
          return response;
        }).catch(() => null);

        // Return cached version instantly, update cache in background
        // If no cache, wait for network
        return cached || fetchPromise;
      })
    )
  );
});
