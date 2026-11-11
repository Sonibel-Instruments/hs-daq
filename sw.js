/* Offline loading. Only the app's own files are handled; no data passes through here.
   Online: fetch the newest file and keep a copy. No signal: use the copy. Weak signal (the request neither
   succeeds nor fails): after 2.5 s stop waiting and use the copy, and for the next 30 s use the copy straight away
   for the other files too (the fetch still runs in the background and refreshes the copy if it ever completes). */
var CACHE = 'hsdaq-shell-v1', FILES = ['./', 'index.html', 'core.js', 'manifest.webmanifest'], WAIT_MS = 2500, slowUntil = 0;
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(new Promise(function (resolve) {
    var done = false;
    function saved() { return caches.match(e.request, { ignoreSearch: true }); }
    var timer = setTimeout(function () {
      slowUntil = Date.now() + 30000;
      saved().then(function (c) { if (c && !done) { done = true; resolve(c); } });
    }, Date.now() < slowUntil ? 0 : WAIT_MS);
    fetch(e.request).then(function (r) {
      if (r && r.ok) { var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); }
      if (!done) { done = true; clearTimeout(timer); resolve(r); }
    }).catch(function () {
      saved().then(function (c) { if (!done) { done = true; clearTimeout(timer); resolve(c || Response.error()); } });
    });
  }));
});
