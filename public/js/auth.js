/* ---- auth ---- */
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
  <label class="lb">טלפון או אימייל</label>
  <input class="inp" id="login-target" placeholder="05x-xxxxxxx או name@mail.com" inputmode="tel">
  <button class="btn" onclick="requestOtp()">שלחו לי קוד כניסה</button>
  <div id="otp-area"></div>
  ${gbtn}${demoNote}
 </div></div>`;
}
async function requestOtp(){
 try{
  const target=$('#login-target').value.trim();if(!target)return toast('הזינו טלפון או אימייל');
  const r=await api('/auth/otp/request',{method:'POST',body:JSON.stringify({target})});
  $('#otp-area').innerHTML=`
   ${r.demoCode?`<div class="warn" style="margin-top:12px">קוד הדגמה שלך: <b style="font-size:18px">${r.demoCode}</b></div>`:`<div class="note" style="margin-top:12px">קוד נשלח אליך ב${r.channel==='whatsapp'?'וואטסאפ':'אימייל'}</div>`}
   <label class="lb">קוד (6 ספרות)</label>
   <input class="inp" id="login-code" inputmode="numeric" maxlength="6" placeholder="הקוד שהתקבל" autocomplete="one-time-code">
   <label class="lb">שם (בהרשמה ראשונה)</label>
   <input class="inp" id="login-name" placeholder="השם שלך">
   <button class="btn" onclick="verifyOtp()">כניסה</button>`;
 }catch(e){toast(e.message)}
}
async function verifyOtp(){
 try{
  const r=await api('/auth/otp/verify',{method:'POST',body:JSON.stringify({target:$('#login-target').value.trim(),code:$('#login-code').value.trim(),name:$('#login-name').value.trim(),signup_source:state.brandSlug?'branded':undefined,signup_slug:state.brandSlug||undefined})});
  state.token=r.token;state.me=r.user;state.memberships=[];state.courier=null;save();
  if(r.is_new)toast('ברוכים הבאים למכבסה בקליק! ההרשמה הושלמה');
  try{const me=await api('/auth/me');state.memberships=me.memberships||[];state.courier=me.courier||null;save()}catch(e){}
  const rt=store.get('returnTo','#/');store.del('returnTo');go(rt);
 }catch(e){toast(e.message)}
}
function needLogin(){store.set('returnTo',location.hash||'#/');return vLogin()}
function initGoogle(){
 if(!state.cfg||!state.cfg.googleClientId||!window.google||!google.accounts)return;
 google.accounts.id.initialize({client_id:state.cfg.googleClientId,callback:async(resp)=>{
  try{
   const r=await api('/auth/google',{method:'POST',body:JSON.stringify({credential:resp.credential})});
   state.token=r.token;state.me=r.user;state.memberships=[];state.courier=null;save();
   if(r.is_new)toast('ברוכים הבאים למכבסה בקליק! ההרשמה הושלמה');
   try{const me=await api('/auth/me');state.memberships=me.memberships||[];state.courier=me.courier||null;save()}catch(e){}
   const rt=store.get('returnTo','#/');store.del('returnTo');go(rt);
  }catch(e){toast(e.message)}
 }});
 const el=document.getElementById('g-signin');
 if(el)google.accounts.id.renderButton(el,{theme:'outline',size:'large',width:320,text:'signin_with',locale:'he'});
}
function logout(){state.token=null;state.me=null;state.memberships=[];state.courier=null;store.del('token');store.del('me');store.del('memberships');store.del('courier');go('#/login')}

