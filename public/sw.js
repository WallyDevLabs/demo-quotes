/* CodeQuote service worker.
 *
 * What it does: makes the app installable, and shows a friendly page when you are offline.
 * What it deliberately does NOT do: cache pages or data. Every page shows client names, amounts and
 * documents, so none is stored on the device by the service worker. Pages always come from the server
 * (behind sign-in), and when you are offline you see /offline instead.
 *
 * It caches only things that carry no personal data: the offline page, icons and Next's hashed assets.
 * Bump VERSION to drop old caches (v1 cached pages; v2 removes them).
 */
const VERSION = "v2";
const STATIC_CACHE = `static-${VERSION}`;
const PRECACHE = ["/offline", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Pages: always the network. Offline, show the offline page. Nothing personal is ever stored.
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(async () => (await caches.match("/offline")) || Response.error()));
    return;
  }

  // Static, non-personal assets: stale-while-revalidate.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
  }
  // Everything else (including /files, PDFs and any data) goes straight to the network, uncached.
});
