'use strict';
const CACHE = 'framecam-local-v1-pages-20260821-transparent-window-zoom-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './camera-enhancements.css',
  './frame-window-zoom.css',
  './app-1.js',
  './app-2.js',
  './app-3.js',
  './app-4.js',
  './app-5.js',
  './app-6.js',
  './app-7.js',
  './app-8.js',
  './manifest.webmanifest'
];

self.addEventListener('install', event => {
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
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true })
      .then(cached => cached || fetch(event.request))
      .catch(() => caches.match('./index.html'))
  );
});
