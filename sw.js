// Service worker : l'appli fonctionne hors-ligne, et les mises à jour arrivent dès qu'on est en ligne.
// Stratégie "réseau d'abord" (toujours revalidée) avec repli sur le cache. Ne touche pas aux requêtes vers d'autres
// domaines (Firebase, Google) : celles-ci gèrent leur propre cache hors-ligne.
const CACHE = 'flashjap-v1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/levels.js', 'js/srs.js', 'js/csv.js', 'js/kanji.js',
  'js/store.js', 'js/audio.js', 'js/fx.js', 'js/app.js',
  'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(new Request(req, { cache: 'no-cache' }))
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html')))
  );
});
