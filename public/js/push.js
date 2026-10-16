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
