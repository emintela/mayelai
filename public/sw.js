// onSave service worker: makes the app installable and shows a friendly page
// when there's no connection. Pages and API calls always go to the network
// (money data must never be stale); only the offline page and icons are cached.
const CACHE = "onsave-v2";
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

// Push alerts (requests, answers…). The server sends {title, body, url, tag}.
self.addEventListener("push", (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(msg.title || "onSave", {
      body: msg.body || "",
      tag: msg.tag || undefined,
      renotify: Boolean(msg.tag),
      icon: "/onsave-assets/icon-192.png",
      badge: "/onsave-assets/icon-192.png",
      data: { url: msg.url || "/onsave" },
    })
  );
});

// Tapping an alert focuses an open onSave window (or opens one) on the right page.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/onsave", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && "navigate" in w) {
          return w.navigate(url).then((c) => (c || w).focus());
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
