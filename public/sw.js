const C='mbk-v2';
const A=['./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(A)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(
  caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>clients.claim()))});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  if(e.request.url.includes('/api/'))return; // נתונים חיים תמיד מהרשת
  // network-first: עדכוני גרסה מגיעים מיד; במצב אופליין נופל ל-cache
  e.respondWith(
    fetch(e.request).then(r=>{
      if(r.ok){const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp))}
      return r;
    }).catch(()=>caches.match(e.request).then(r=>r||caches.match('./')))
  );
});
