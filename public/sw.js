const A=['./manifest.webmanifest','./icon-192.png','./icon-512.png','./icon-maskable-512.png','./js/core.js','./js/tabs.js','./js/auth.js','./js/marketplace.js','./js/checkout.js','./js/orders.js','./js/club.js','./js/courier.js','./js/courier-day.js','./js/manage.js','./js/community.js','./js/admin.js','./js/join.js','./js/pay.js','./js/router.js','./js/issues.js','./js/push.js','./js/mode-banner.js','./js/tenant-checklist.js','./js/apply.js','./js/onboard-wizard.js','./js/analytics.js','./js/consent.js','./js/sw-register.js','./js/a11y.js','./js/search-suggest.js','./js/favorites-sync.js','./js/perf.js','./js/delegate.js','./js/track.js','./js/dark-mode.js','./js/keyboard-a11y.js'];
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
// E9.T3: קבלת התראת דחיפה והצגתה
self.addEventListener('push',e=>{
  let d={title:'מכבסה בקליק',body:'יש עדכון בהזמנה שלך'};
  try{if(e.data)d={...d,...e.data.json()}}catch(_){}
  e.waitUntil(self.registration.showNotification(d.title,{body:d.body,icon:'./icon-192.png',badge:'./icon-192.png',dir:'rtl',lang:'he',data:{url:d.url||'./#/orders'}}));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const url=(e.notification.data&&e.notification.data.url)||'./#/orders';
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(ws=>{
    for(const w of ws){if(w.url.includes(self.registration.scope))return w.focus()}
    return clients.openWindow(url);
  }));
});
