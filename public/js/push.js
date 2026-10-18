/* ---- E9.T3: התראות דחיפה ---- */
function urlB64ToUint8(s){const p='='.repeat((4-s.length%4)%4);const b=atob((s+p).replace(/-/g,'+').replace(/_/g,'/'));const o=new Uint8Array(b.length);for(let i=0;i<b.length;i++)o[i]=b.charCodeAt(i);return o}
async function pushSubscribe(){
 try{
  if(!('serviceWorker' in navigator)||!('PushManager' in window))return toast('הדפדפן לא תומך בהתראות דחיפה');
  const perm=await Notification.requestPermission();
  if(perm!=='granted')return toast('לא אושרו התראות בדפדפן');
  const reg=await navigator.serviceWorker.ready;
  const {key}=await api('/push/vapid-public-key');
  let sub=await reg.pushManager.getSubscription();
  if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlB64ToUint8(key)});
  await api('/push/subscribe',{method:'POST',body:JSON.stringify({subscription:sub.toJSON()})});
  toast('התראות דחיפה הופעלו ✓');
  const b=document.getElementById('push-btn');if(b){b.textContent='🔔 התראות פעילות';b.classList.add('green')}
 }catch(e){toast('הפעלת התראות נכשלה: '+e.message)}
}

/* E13.T5: מצב אופליין בסיסי — באנר קבוע + רענון כשהחיבור חוזר */
function offlineBanner(){
 let b=document.getElementById('off-banner');
 if(navigator.onLine){if(b)b.remove();return}
 if(!b){b=document.createElement('div');b.id='off-banner';b.textContent='אין חיבור לאינטרנט — מוצג מידע שנשמר במכשיר';document.body.appendChild(b)}
}
window.addEventListener('online',()=>{offlineBanner();toast('החיבור חזר ✓');route()});
window.addEventListener('offline',offlineBanner);
offlineBanner();

/* T110: באנר הפעלת התראות דחיפה לבעלי/צוות מכבסה — מוזרק למסכי ניהול (#/manage) כשאין מנוי פעיל.
   עצמאי: MutationObserver כמו messages.js, בלי עריכת manage.js (קבצים משותפים).
   ניתן לסגירה — הבחירה נשמרת ולא מציקה שוב באותו מכשיר. */
async function ownerPushState(){
 try{
  if(!('serviceWorker' in navigator)||!('PushManager' in window))return null;
  const reg=await navigator.serviceWorker.getRegistration();
  return reg?await reg.pushManager.getSubscription():null;
 }catch(e){return null}
}
async function ownerPushBanner(){
 try{
  const old=document.getElementById('owner-push-banner');if(old)old.remove();
  if(!state.token||!state.memberships||!state.memberships.length)return; // בעלים/צוות בלבד
  if(!location.hash.startsWith('#/manage'))return;                        // רק במסכי ניהול
  if(localStorage.getItem('owner_push_dismissed'))return;                 // נסגר בעבר
  if(await ownerPushState())return;                                       // כבר יש מנוי
  const body=document.querySelector('.body');if(!body)return;
  const b=document.createElement('div');
  b.id='owner-push-banner';b.className='card';
  b.style.cssText='border:2px solid var(--acc,#0e7a8a);display:flex;gap:8px;align-items:center;flex-wrap:wrap';
  b.innerHTML='<span style="flex:1;min-width:200px">🔔 <b>הזמנה חדשה?</b> הפעילו התראות דחיפה — תקבלו הודעה על כל הזמנה חדשה, גם כשהאפליקציה סגורה</span>'
   +'<button class="btn2 green" id="owner-push-btn">הפעלת התראות</button>'
   +'<button class="btn2" id="owner-push-x" style="color:#888">לא עכשיו</button>';
  body.prepend(b);
  document.getElementById('owner-push-btn').onclick=async()=>{await pushSubscribe();const sub=await ownerPushState();if(sub)b.remove();};
  document.getElementById('owner-push-x').onclick=()=>{localStorage.setItem('owner_push_dismissed','1');b.remove();};
 }catch(e){}
}
(function(){
 let t=null;
 const mo=new MutationObserver(()=>{clearTimeout(t);t=setTimeout(ownerPushBanner,300);});
 mo.observe(document.documentElement,{childList:true,subtree:true});
 window.addEventListener('hashchange',()=>setTimeout(ownerPushBanner,300));
 setTimeout(ownerPushBanner,800);
})();
