/* נגישות (a11y) — שכבת שיפור עצמאית, בלי עריכת קבצי צוותים אחרים.
   מכסה ממצאי ביקורת UI (16.10): תוויות בלי for, toast בלי role/aria-live,
   שדות שגיאה בלי aria-invalid, מטרות מגע מתחת ל-44px (CSS בסוף styles.css). */
(function(){
 'use strict';

 /* toast נגיש: role=status + aria-live (עטיפה — core.js לא נערך) */
 if(typeof window.toast==='function'){
  const origToast=window.toast;
  window.toast=function(m){
   origToast(m);
   const t=document.querySelector('.toast');
   if(t){t.setAttribute('role','status');t.setAttribute('aria-live','polite')}
  };
 }

 const ARIA_LABELS={
  'q':'חיפוש מכבסה, עיר או שירות',
  'home-sort':'מיון רשימת המכבסות',
  'hf-kg':'סינון לפי מחיר מקסימלי לקילוגרם',
  'pl-search':'חיפוש במחירון',
  'login-target':'טלפון או אימייל',
  'login-code':'קוד כניסה, שש ספרות',
  'login-name':'שם מלא',
  'ap-name':'שם המכבסה',
  'ap-city':'עיר',
  'ap-phone':'טלפון',
  'ap-est':'הזמנות משוערות בחודש'
 };
 function enhanceA11y(){
  /* label.lb ללא for — שיוך לשדה הראשון שאחריו עם id */
  document.querySelectorAll('label.lb:not([for])').forEach(lb=>{
   let el=lb.nextElementSibling;
   while(el&&!/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName))el=el.nextElementSibling;
   if(el&&el.id)lb.setAttribute('for',el.id);
  });
  Object.keys(ARIA_LABELS).forEach(id=>{
   const el=document.getElementById(id);
   if(el&&!el.getAttribute('aria-label'))el.setAttribute('aria-label',ARIA_LABELS[id]);
  });
  /* כפתורי אייקון עם title בלבד */
  document.querySelectorAll('button[title]:not([aria-label])').forEach(b=>b.setAttribute('aria-label',b.getAttribute('title')));
  const sb=document.querySelector('.searchbar');if(sb&&!sb.getAttribute('role'))sb.setAttribute('role','search');
  const tabs=document.getElementById('tabs');
  if(tabs){
   if(!tabs.getAttribute('role'))tabs.setAttribute('role','navigation');
   if(!tabs.getAttribute('aria-label'))tabs.setAttribute('aria-label','ניווט ראשי');
   tabs.querySelectorAll('a').forEach(a=>{
    if(a.classList.contains('on'))a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
   });
  }
 }

 /* aria-invalid + ולידציית חובה לפני שליחה (עטיפה של הפונקציות הקיימות) */
 const FORMS={
  submitApplication:[['ap-name','שם המכבסה'],['ap-city','עיר'],['ap-phone','טלפון']],
  requestOtp:[['login-target','טלפון או אימייל']],
  verifyOtp:[['login-target','טלפון או אימייל'],['login-code','קוד כניסה']]
 };
 function wrapForm(fnName){
  const orig=window[fnName];
  if(typeof orig!=='function')return;
  window[fnName]=function(){
   let firstBad=null;
   (FORMS[fnName]||[]).forEach(pair=>{
    const el=document.getElementById(pair[0]);if(!el)return;
    if(!el.value.trim()){
     el.setAttribute('aria-invalid','true');
     el.addEventListener('input',()=>el.removeAttribute('aria-invalid'),{once:true});
     if(!firstBad)firstBad={el:el,label:pair[1]};
    }else el.removeAttribute('aria-invalid');
   });
   if(firstBad){firstBad.el.focus();window.toast('חסר שדה חובה: '+firstBad.label);return}
   return orig.apply(this,arguments);
  };
 }
 Object.keys(FORMS).forEach(wrapForm);

 /* Esc סוגר את המודאל הפנימי */
 document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
   const ov=document.querySelector('.modal-ov');
   if(ov){const c=ov.querySelector('#xm-cancel');if(c)c.click()}
  }
 });

 /* קישור דילוג לתוכן */
 if(!document.querySelector('.skip-link')){
  const sk=document.createElement('a');
  sk.className='skip-link';sk.href='#app';sk.textContent='דילוג לתוכן המרכזי';
  document.body.insertBefore(sk,document.body.firstChild);
 }

 /* הרצה חוזרת אחרי כל רינדור של ה-SPA */
 let t=null;
 const mo=new MutationObserver(()=>{clearTimeout(t);t=setTimeout(enhanceA11y,30)});
 const app=document.getElementById('app'),tabs=document.getElementById('tabs');
 if(app)mo.observe(app,{childList:true,subtree:true});
 if(tabs)mo.observe(tabs,{childList:true,subtree:true});
 enhanceA11y();
})();
