// Service worker for the Family Dinner Planner (PWA).
// Network-first for GET requests, with a cache fallback so the app shell loads offline.
// Firebase reads/writes (POST/websocket) always go to the network.
const CACHE = "fdp-v2";

self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return; // let Firebase + API calls pass through
  e.respondWith(
    fetch(req)
      .then((res) => {
        try {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        } catch (err) {}
        return res;
      })
      .catch(() => caches.match(req))
  );
});
