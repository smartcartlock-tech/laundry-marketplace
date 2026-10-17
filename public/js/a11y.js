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
  'ap-est':'הזמנות משוערות בחודש',
  'of-status':'סינון הזמנות לפי סטטוס',
  'of-from':'הזמנות מתאריך',
  'of-to':'הזמנות עד תאריך',
  'of-text':'חיפוש בהזמנות — פריט, מכבסה או סכום'
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
  /* שגיאת כתובת בצ'ק-אאוט (נוצרת ומוסרת ע"י checkout.js) — סנכרון ARIA */
  const ca=document.getElementById('co-address');
  if(ca){
   const ce=document.getElementById('co-address-err');
   if(ce){ce.setAttribute('role','alert');ca.setAttribute('aria-invalid','true');ca.setAttribute('aria-describedby','co-address-err')}
   else{ca.removeAttribute('aria-invalid');ca.removeAttribute('aria-describedby')}
  }
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
  verifyOtp:[['login-target','טלפון או אימייל'],['login-code','קוד כניסה']],
  /* טפסי ניהול (community.js — עטיפה בלבד, הקובץ לא נערך): פריט, חלון, קופון */
  addItem:[['it-name','שם הפריט'],['it-price','מחיר הפריט']],
  addWindow:[['w-start','שעת התחלה'],['w-end','שעת סיום']],
  addCoupon:[['cp-code','קוד הקופון'],['cp-value','ערך הקופון']]
 };
 /* הודעת שגיאה מקושרת: div.field-err עם role=alert לצד השדה + aria-describedby */
 function setFieldError(el,msg){
  el.setAttribute('aria-invalid','true');
  let err=document.getElementById(el.id+'-err');
  if(!err){
   err=document.createElement('div');
   err.id=el.id+'-err';err.className='field-err';err.setAttribute('role','alert');
   el.insertAdjacentElement('afterend',err);
  }
  err.textContent=msg;
  el.setAttribute('aria-describedby',err.id);
 }
 function clearFieldError(el){
  el.removeAttribute('aria-invalid');
  el.removeAttribute('aria-describedby');
  const err=document.getElementById(el.id+'-err');if(err)err.remove();
 }
 function wrapForm(fnName){
  const orig=window[fnName];
  if(typeof orig!=='function')return;
  window[fnName]=function(){
   let firstBad=null;
   (FORMS[fnName]||[]).forEach(pair=>{
    const el=document.getElementById(pair[0]);if(!el)return;
    if(!el.value.trim()){
     setFieldError(el,'שדה חובה: '+pair[1]);
     el.addEventListener('input',()=>clearFieldError(el),{once:true});
     el.addEventListener('change',()=>clearFieldError(el),{once:true});
     if(!firstBad)firstBad={el:el,label:pair[1]};
    }else clearFieldError(el);
   });
   if(firstBad){firstBad.el.focus();window.toast('חסר שדה חובה: '+firstBad.label);return}
   return orig.apply(this,arguments);
  };
 }
 Object.keys(FORMS).forEach(wrapForm);

 /* הזרקת CSS של שכבת הנגישות (styles.css לא נערך) */
 function ensureStyle(css,mark){
  let st=document.getElementById('a11y-style');
  if(!st){st=document.createElement('style');st.id='a11y-style';document.head.appendChild(st)}
  if(st.textContent.indexOf(mark)===-1)st.textContent+=css;
 }

 /* קישור דילוג לתוכן */
 if(!document.querySelector('.skip-link')){
  const sk=document.createElement('a');
  sk.className='skip-link';sk.href='#app';sk.textContent='דילוג לתוכן המרכזי';
  document.body.insertBefore(sk,document.body.firstChild);
 }
 /* T21: יעד הדילוג חייב להיות focusable כדי שהפוקוס יעבור לתוכן */
 const appT=document.getElementById('app');
 if(appT&&!appT.hasAttribute('tabindex'))appT.setAttribute('tabindex','-1');
 ensureStyle('#app:focus{outline:none}/*app-focus*/','app-focus');

 /* הרצה חוזרת אחרי כל רינדור של ה-SPA */
 let t=null;
 const mo=new MutationObserver(()=>{clearTimeout(t);t=setTimeout(enhanceA11y,30)});
 const app=document.getElementById('app'),tabs=document.getElementById('tabs');
 if(app)mo.observe(app,{childList:true,subtree:true});
 if(tabs)mo.observe(tabs,{childList:true,subtree:true});
 enhanceA11y();
})();
