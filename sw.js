'use strict';
const CACHE = 'framecam-local-v1-pages-20260821-direct-photo-picker';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app-1.js',
  './app-2.js',
  './app-3.js',
  './app-4.js',
  './manifest.webmanifest'
];

self.addEventListener('install', event => {
  // Do not skipWaiting: never replace the running event camera mid-session.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE).map(key => caches.delete(key))
    ))
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Only serve the fixed application shell from cache. Captured images are
  // data/blob URLs and never enter this Service Worker.
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true })
      .then(cached => cached || fetch(event.request))
      .catch(() => caches.match('./index.html'))
  );
});
