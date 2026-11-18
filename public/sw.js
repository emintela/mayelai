// onSave service worker: makes the app installable and shows a friendly page
// when there's no connection. Pages and API calls always go to the network
// (money data must never be stale); only the offline page and icons are cached.
const CACHE = "onsave-v1";
const OFFLINE = "/offline.html";
const PRECACHE = [OFFLINE, "/onsave-assets/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});
