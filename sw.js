// Service worker for Kids Games: keeps the pages on the device so a checked-out player
// can play offline. Without it, the browser cannot open the site with no internet.
//
// - Pages and scripts of this site: network first, so changes show at once when online.
//   If the network fails (or is slower than 4 s and a copy exists), the saved copy is used.
// - Firebase SDK files from www.gstatic.com: saved copy first (the version is in the URL).
// - Firebase data requests (firestore.googleapis.com and others) are not touched.
//
// NEW GAME: add its folder (and any extra files) to PRECACHE below.

const CACHE = "kidsgames-v15";
const SDK = "https://www.gstatic.com/firebasejs/13.0.0/";
const PRECACHE = [
  "./",
  "shared/session.js",
  "shared/gate.js",
  "shared/family.js",
  "minesweeper/",
  "word-guess/",
  "word-guess/words.js",
  "move-red-loco/",
  "move-red-loco/editor.js",
  "move-red-loco/solver.js",
  "move-red-loco/solver-worker.js",
  "move-red-loco/play-rules.js",
  "move-red-loco/puzzle-data.js",
  "move-red-loco/library-config.js",
  "move-red-loco/library-data.js",
  "move-red-loco/library-store.js",
  "move-red-loco/library-firestore.js",
  SDK + "firebase-app.js",
  SDK + "firebase-auth.js",
  SDK + "firebase-firestore.js"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => Promise.all(PRECACHE.map(url =>
    cache.add(new Request(url, { cache: "reload" })).catch(e => console.warn("[sw] not saved:", url, e))
  ))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith("kidsgames-") && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin && url.pathname.startsWith(new URL("./", self.location).pathname)) {
    event.respondWith(networkFirst(req));
  } else if (url.href.startsWith("https://www.gstatic.com/firebasejs/")) {
    event.respondWith(cacheFirst(req));
  }
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(req, { ignoreSearch: true });
  const net = fetch(req).then(res => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });
  if (!saved) return net;
  return Promise.race([
    net.catch(() => saved),
    new Promise(resolve => setTimeout(() => resolve(saved), 4000))
  ]);
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(req);
  if (saved) return saved;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

