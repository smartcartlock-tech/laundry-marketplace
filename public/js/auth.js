/* ---- auth ---- */
/* T88: (1) ניווט מיידי אחרי 200 — בלי להמתין ל-/auth/me (תליית "טוקן בלי ניווט");
   (2) מצב טעינה על הכפתורים; (3) 429 עם Retry-After מוצג מילולית + ספירה לאחור; (4) אין כשל שקט. */
function vLogin(){
 const gbtn=state.cfg&&state.cfg.googleClientId?`<div id="g-signin" style="margin-top:10px"></div>`:'';
 const demoNote=state.cfg&&state.cfg.demoOtp?`<div class="note" style="margin-top:10px">מצב הדגמה: הקוד יוצג על המסך (בפרודקשן נשלח בוואטסאפ${state.cfg.whatsappOtp?' — פעיל':' — לא מוגדר'}).</div>`:'';
 const rt=store.get('returnTo','');
 let ctx='';
 const m=rt.match(/^#\/checkout\/(\S+)/);
 if(m){
  const items=state.cart.filter(c=>c.slug===m[1]);
  if(items.length){
   const sum=items.reduce((a,c)=>a+c.price*c.qty,0);
   ctx=`<div class="note" style="margin-bottom:10px">הסל שלך שמור: ${items.map(c=>esc(c.name)+' ×'+fmtQ(c.qty)).join(', ')} (₪${sum}). אחרי הכניסה נחזור ישר לסיכום ההזמנה. <a href="#/laundry/${m[1]}" style="color:#0e7a8a">חזרה לדף המכבסה</a></div>`;
  }
 }
 return `<div class="hdr" style="text-align:center;padding-top:34px">
  <h1 class="big" style="margin:0">מכבסה בקליק</h1><p>כל המכבסות באזורך — במקום אחד</p></div>
 ${ctx?`<div class="body">${ctx}</div>`:''}
 <div class="body"><div class="card">
  <label class="lb" for="login-target">טלפון או אימייל</label>
  <input class="inp" id="login-target" dir="ltr" style="text-align:right" placeholder="050-1234567" inputmode="tel" autocomplete="username">
  <button class="btn" data-act="requestOtp">שלחו לי קוד כניסה</button>
  <div id="login-err" aria-live="polite"></div>
  <div id="otp-area"></div>
  ${gbtn}${demoNote}
 </div></div>`;
}
/* fetch מקומי ל-auth בלבד: api() הגנרי מסתיר את כותרת Retry-After שצריך לספירת ה-429 (T88) */
async function authPost(path,body){
 const ctl=new AbortController();const to=setTimeout(()=>ctl.abort(),20000);
 let r;
 try{r=await fetch('/api/auth'+path,{method:'POST',signal:ctl.signal,headers:{'Content-Type':'application/json',...(state.token?{Authorization:'Bearer '+state.token}:{})},body:JSON.stringify(body)})}
 catch(e){clearTimeout(to);const err=new Error(e&&e.name==='AbortError'?'השרת לא מגיב — נסו שוב בעוד רגע':'אין חיבור לרשת — בדקו את החיבור ונסו שוב');err.status=0;throw err}
 clearTimeout(to);
 const data=await r.json().catch(()=>({}));
 if(!r.ok){const err=new Error(data.error||('שגיאה '+r.status));err.status=r.status;err.retryAfter=Number(r.headers.get('Retry-After'))||0;throw err}
 return data;
}
function loginErr(msg){const b=$('#login-err');if(b)b.innerHTML=msg?`<div class="warn" style="margin-top:12px" role="alert">${esc(msg)}</div>`:''}
function setBusy(btn,busy,label){if(!btn)return;btn.disabled=!!busy;if(label!==undefined)btn.textContent=label}
let rlTimer=null;
/* ספירה לאחור חיה אחרי 429, עם נעילת הכפתור עד סיום (T88) */
function showRetryCountdown(sec,btn){
 clearInterval(rlTimer);
 const tick=()=>{
  if(sec<=0){clearInterval(rlTimer);loginErr('');setBusy(btn,false);return}
  const m=Math.floor(sec/60),s=String(sec%60).padStart(2,'0');
  loginErr('יותר מדי ניסיונות — נסו שוב בעוד '+m+':'+s);
  sec--;
 };
 setBusy(btn,true);tick();rlTimer=setInterval(tick,1000);
}
function handleAuthErr(e,btn){
 if(e&&e.status===429&&e.retryAfter>0){showRetryCountdown(e.retryAfter,btn)}
 else{setBusy(btn,false);loginErr((e&&e.message)||'שגיאה לא צפויה — נסו שוב');toast((e&&e.message)||'שגיאה לא צפויה — נסו שוב')}
}
async function requestOtp(){
 const btn=document.querySelector('[data-act=requestOtp]');
 try{
  const target=$('#login-target').value.trim();if(!target)return toast('הזינו טלפון או אימייל');
  loginErr('');setBusy(btn,true,'שולח…');
  const r=await authPost('/otp/request',{target});
  setBusy(btn,false,'שלחו לי קוד כניסה');
  if(r.token)return finishLogin(r); // כניסה ישירה (מספרי דמו בלבד — בלי קוד)
  $('#otp-area').innerHTML=`
   ${r.demoCode?`<div class="warn" style="margin-top:12px">קוד הדגמה שלך: <b style="font-size:18px">${r.demoCode}</b></div>`:`<div class="note" style="margin-top:12px">${r.channel==='static'?'הזינו את קוד המנהל הקבוע':'קוד נשלח אליך ב'+(r.channel==='whatsapp'?'וואטסאפ':r.channel==='sms'?'SMS':'אימייל')}</div>`}
   <label class="lb" for="login-code">קוד (6 ספרות)</label>
   <input class="inp" id="login-code" dir="ltr" style="text-align:right" inputmode="numeric" maxlength="6" placeholder="123456" autocomplete="one-time-code">
   <label class="lb" for="login-name">שם (בהרשמה ראשונה)</label>
   <input class="inp" id="login-name" placeholder="השם שלך">
   <button class="btn" data-act="verifyOtp">כניסה</button>`;
  const c=$('#login-code');if(c)c.focus();
 }catch(e){handleAuthErr(e,btn)}
}
async function finishLogin(r){
 state.token=r.token;state.me=r.user;state.memberships=[];state.courier=null;save();
 if(r.is_new)toast('ברוכים הבאים למכבסה בקליק! ההרשמה הושלמה');
 let rt=store.get('returnTo','#/');store.del('returnTo');
 if(!rt||rt.indexOf('#/login')===0)rt='#/'; // לא מנווטים חזרה למסך הכניסה
 go(rt); // T88: ניווט מיידי אחרי שהטוקן התקבל — /auth/me מתרענן ברקע ולא תוקע את המסך
 try{const me=await api('/auth/me');state.memberships=me.memberships||[];state.courier=me.courier||null;save();route()}catch(e){/* כשל זמני: הניווט כבר קרה, הפרטים יתמלאו בכניסה הבאה */}
}
async function verifyOtp(){
 const btn=document.querySelector('[data-act=verifyOtp]');
 try{
  const code=$('#login-code').value.trim();if(!code)return toast('הזינו את הקוד שהתקבל');
  loginErr('');setBusy(btn,true,'מאמת…');
  const r=await authPost('/otp/verify',{target:$('#login-target').value.trim(),code,name:$('#login-name').value.trim(),signup_source:state.brandSlug?'branded':undefined,signup_slug:state.brandSlug||undefined});
  setBusy(btn,false,'כניסה');
  await finishLogin(r);
 }catch(e){handleAuthErr(e,btn)}
}
function needLogin(){store.set('returnTo',location.hash||'#/');return vLogin()}
function initGoogle(){
 if(!state.cfg||!state.cfg.googleClientId||!window.google||!google.accounts)return;
 google.accounts.id.initialize({client_id:state.cfg.googleClientId,callback:async(resp)=>{
  try{
   const r=await authPost('/google',{credential:resp.credential});
   await finishLogin(r); // T88: אותה זרימה — ניווט מיידי + רענון רקע
  }catch(e){toast(e.message)}
 }});
 const el=document.getElementById('g-signin');
 if(el)google.accounts.id.renderButton(el,{theme:'outline',size:'large',width:320,text:'signin_with',locale:'he'});
}
/* T89: מעבר חשבון בטוח — ניקוי מלא של זהות ומטמון משתמש (הזמנה לא תירשם על חשבון קודם) */
const SESSION_KEEP=new Set(['wlm_theme']); // קוסמטי בלבד — לא זהות
function cleanupSessionState(){
 Object.keys(localStorage).forEach(k=>{if(k.indexOf('wlm_')===0&&!SESSION_KEEP.has(k))localStorage.removeItem(k)});
 localStorage.removeItem('token'); // מפתח מורשת
 state.token=null;state.me=null;state.memberships=[];state.courier=null;state.cart=[];
}
async function logout(){
 try{const t=state.token;if(t)await fetch('/api/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+t}})}catch(e){}
 cleanupSessionState();
 toast('התנתקתם');
 go('#/');
}
/* T89: באנר 'מחובר כ-' קבוע בראש המסך + התנתקות זמינה לכל תפקיד (לקוח/שליח/בעלים) */
function roleLabel(){if(state.courier)return 'שליח';if(state.memberships&&state.memberships.length)return 'בעל מכבסה';return 'לקוח'}
function ensureIdBanner(){
 const app=document.getElementById('app');if(!app)return;
 let b=document.getElementById('id-banner');
 if(!state.me){if(b)b.remove();document.body.classList.remove('has-idbanner');document.body.style.removeProperty('--idbanner-h');return}
 const html='<span>מחובר כ-<b>'+esc(state.me.name||state.me.phone||state.me.email||'')+'</b> · '+roleLabel()+'</span><a href="#/" data-act="acctLogout" style="color:#0e7a8a;white-space:nowrap">התנתקות</a>';
 if(!b){
  b=document.createElement('div');b.id='id-banner';
  b.style.cssText='display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 14px;font-size:12px;background:#f0f7f8;border-bottom:1px solid #d8e6e8;color:#335';
  app.prepend(b);
 }
 if(b.__html!==html){b.innerHTML=html;b.__html=html}
 if(!document.body.classList.contains('has-idbanner')){
  document.body.classList.add('has-idbanner');
  const h=b.offsetHeight;if(h)document.body.style.setProperty('--idbanner-h',h+'px'); /* T115: הבאנר הקבוע דורס את כפתור הנושא — דוחפים אותו מתחת לבאנר */
 }
}
new MutationObserver(()=>{try{ensureIdBanner()}catch(e){}}).observe(document.documentElement,{childList:true,subtree:true});
/* B7: רישום פעולות להאזנה המרכזת (ללא inline handlers) */
onAct({
 requestOtp:()=>requestOtp(), verifyOtp:()=>verifyOtp(), acctLogout:(t,e)=>{if(e)e.preventDefault();logout()}
});
