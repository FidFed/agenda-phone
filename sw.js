// Service worker della web app del telefono: rende l'app disponibile offline.
// Mette in cache SOLO i file dell'app (elenco fisso scritto da mobile/build.mjs), mai il pacchetto né altri dati:
// il pacchetto non passa mai dalla rete (arriva dal selettore di file e resta cifrato in IndexedDB).
// Strategia: cache-first per i file dell'elenco; tutto il resto non viene toccato.

const VERSIONE = "7a56cb479038";
const CACHE = `agenda-app-${VERSIONE}`;
const FILE = [
  "./",
  "app.css",
  "favicon.png",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "index.html",
  "js/autolock.js",
  "js/birthday.js",
  "js/db.js",
  "js/fatti.js",
  "js/html.js",
  "js/main.js",
  "js/pacchetto.js",
  "js/pc/domain.js",
  "js/pc/format.js",
  "js/pc/icons.js",
  "js/pc/search.js",
  "js/photos.js",
  "js/router.js",
  "js/screens/avvio.js",
  "js/screens/eventi.js",
  "js/screens/gruppi.js",
  "js/screens/impostazioni.js",
  "js/screens/persona.js",
  "js/screens/persone.js",
  "js/screens/ripasso.js",
  "js/screens/tag.js",
  "js/store.js",
  "js/tagroute.js",
  "js/ui.js",
  "js/versione.js",
  "manifest.webmanifest",
  "vendor/argon2.umd.min.js",
  "vendor/hooks.module.js",
  "vendor/htm.module.js",
  "vendor/preact.module.js"
];

const scope = new URL(self.registration.scope);
const inElenco = new Set(FILE.map((f) => new URL(f, scope).href));
const INDEX = new URL('./', scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: 'reload' → sempre la versione del server, non quella della cache HTTP del browser
    await cache.addAll(FILE.map((f) => new Request(new URL(f, scope).href, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('agenda-app-') && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== scope.origin) return;
  url.hash = '';
  url.search = '';
  let key = url.href;
  if (req.mode === 'navigate' && (key === INDEX || key === new URL('index.html', scope).href)) key = INDEX;
  if (!inElenco.has(key)) return; // non è un file dell'app: niente cache
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(key);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') await cache.put(key, res.clone());
    return res;
  })());
});
