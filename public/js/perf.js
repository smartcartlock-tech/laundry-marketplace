/* ביצועי טעינה בצד לקוח — בלי עריכת קבצים משותפים:
   1. רמזי משאבים (preconnect/dns-prefetch) לספקים חיצוניים שנטענים מהעמוד.
   2. prefetch של דף מכבסה בריחוף/מגע על כרטיס (מתחמם במטמון ה-HTTP; ל-vLaundry יש ETag).
   3. prefetch של רשימת הבית בזמן פנוי — חזרה לדף הבית מידית. */
(function(){
 'use strict';

 /* 1. רמזי משאבים */
 function hint(rel,href,cors){
  if(document.querySelector('link[rel="'+rel+'"][href="'+href+'"]'))return;
  const l=document.createElement('link');
  l.rel=rel;l.href=href;if(cors)l.crossOrigin='anonymous';
  document.head.appendChild(l);
 }
 hint('preconnect','https://accounts.google.com',true);
 hint('dns-prefetch','https://accounts.google.com');

 /* 2+3. prefetch חכם */
 const warmed={};
 function warm(path){
  if(warmed[path])return;warmed[path]=true;
  try{fetch(path,{priority:'low',credentials:'same-origin'}).catch(()=>{})}catch(e){}
 }
 function slugOf(a){
  const m=(a.getAttribute('href')||'').match(/^#\/laundry\/([^/?#]+)/);
  return m?m[1]:null;
 }
 ['pointerover','touchstart','focusin'].forEach(ev=>{
  document.addEventListener(ev,e=>{
   const a=e.target.closest&&e.target.closest('a.card.lcard');
   if(!a)return;
   const s=slugOf(a);
   if(s)warm('/api/laundries/'+s);
  },{passive:true});
 });
 const idle=window.requestIdleCallback||function(cb){setTimeout(cb,1500)};
 idle(()=>{if(!state.brandSlug)warm('/api/laundries')});
})();
