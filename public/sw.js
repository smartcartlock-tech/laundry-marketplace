const C='wlm-v1';
const A=['./','./index.html','./styles.css','./app.js','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(A)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(clients.claim())});
self.addEventListener('fetch',e=>{
  if(e.request.url.includes('/api/'))return; // נתונים חיים תמיד מהרשת
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});
