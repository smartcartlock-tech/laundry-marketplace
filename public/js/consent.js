/* ---- C4: הסכמה לתנאי שימוש ומדיניות פרטיות בצ'ק-אאוט ראשון ----
   מזריק צ'קבוקס מעל כפתור האישור כשהמשתמש טרם אישר, וחוסם שליחה בלעדיו.
   (הקישורים לדפי המדיניות יתווספו כשהדפים יפורסמו — כרגע טיוטה, רק טקסט.) */
(function(){
 let need=null; // null = עוד לא נבדק
 async function refresh(){
  if(typeof state==='undefined'||!state.token){need=false;return}
  try{const m=await api('/auth/me');need=!(m.user&&m.user.consent_at)}catch(e){need=false}
 }
 function inject(){
  const btn=document.getElementById('co-submit');
  if(!btn||document.getElementById('co-consent-wrap'))return;
  if(need===null){refresh().then(inject);return}
  if(!need)return;
  const w=document.createElement('div');
  w.id='co-consent-wrap';w.className='card';
  w.innerHTML='<label style="font-size:13px;display:flex;gap:8px;align-items:flex-start;cursor:pointer">'
   +'<input type="checkbox" id="co-consent" style="margin-top:3px">'
   +'<span>קראתי ואני מסכים/ה לתנאי השימוש ולמדיניות הפרטיות של השירות</span></label>';
  btn.before(w);
 }
 function wrap(){
  if(typeof window.submitOrder!=='function'||window.submitOrder.__consentWrapped)return;
  const orig=window.submitOrder;
  const wrapped=async function(slug){
   const cb=document.getElementById('co-consent');
   if(cb){
    if(!cb.checked){toast('יש לאשר את תנאי השימוש ומדיניות הפרטיות');cb.focus();return}
    try{await api('/auth/consent',{method:'POST'});need=false;const w=document.getElementById('co-consent-wrap');if(w)w.remove()}
    catch(e){toast(e.message);return}
   }
   return orig(slug);
  };
  wrapped.__consentWrapped=true;
  window.submitOrder=wrapped;
 }
 wrap();
 new MutationObserver(function(){wrap();inject()}).observe(document.body,{childList:true,subtree:true});
 document.addEventListener('DOMContentLoaded',inject);
})();
