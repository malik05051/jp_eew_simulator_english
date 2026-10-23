/* PWA service worker for JapanEewSimulator
 * Strategy:
 *  - Precached shell (HTML/CSS/fonts/icon) so the app opens offline.
 *  - quake-sim-data.bin is ~4MB, so it is cached on first successful load only.
 *  - Never cache anything that is not a 200 basic response.
 */
const CACHE = 'eewsim-v2-en';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './images/logo.jpg',
  './fonts/ZenMaruGothic-Regular-subset.ttf',
  './fonts/ZenMaruGothic-Medium-subset.ttf',
  './fonts/ZenMaruGothic-Bold-subset.ttf'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(
        SHELL.map((url) => cache.add(url).catch(() => null))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});