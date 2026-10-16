/* מכבסה בקליק — PWA מחובר ל-API אמיתי */
const $=s=>document.querySelector(s);
const store={
 get(k,d){try{const v=localStorage.getItem('wlm_'+k);return v?JSON.parse(v):d}catch(e){return d}},
 set(k,v){localStorage.setItem('wlm_'+k,JSON.stringify(v))},
 del(k){localStorage.removeItem('wlm_'+k)}
};
/* בתוך אפליקציית האנדרויד (Capacitor): כפתור חזרה מקורי — חזרה בהיסטוריית ה-SPA, ובדף הבית מזעור */
if(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform()){
 const _capApp=window.Capacitor.Plugins&&window.Capacitor.Plugins.App;
 if(_capApp)_capApp.addListener('backButton',()=>{
  const h=location.hash||'#/';
  if(h!=='#/'&&h!=='#'){history.back()}else{_capApp.minimizeApp()}
 });
}
let state={token:store.get('token',null),me:store.get('me',null),cfg:null,cart:store.get('cart',[]),memberships:store.get('memberships',[]),courier:store.get('courier',null)};
/* E3: מצב מותג לבן — כניסה דרך /b/:slug מציגה רק את המכבסה הזאת, במיתוג שלה */
const __bm=location.pathname.match(/^\/b\/([^\/]+)/);
state.brandSlug=__bm?decodeURIComponent(__bm[1]):null;state.brand=null;
function shade(hex,f){const n=parseInt(hex.slice(1),16);const r=Math.round(((n>>16)&255)*f),g=Math.round(((n>>8)&255)*f),b=Math.round((n&255)*f);return '#'+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1)}
async function applyBrandTheme(slug){
 try{
  if(!state.brand||state.brand.slug!==slug){const d=await api('/laundries/'+slug);state.brand=d.laundry}
  const l=state.brand,c=l.color||'#0e7a8a',dark=shade(c,.6);
  let st=document.getElementById('brand-css');
  if(!st){st=document.createElement('style');st.id='brand-css';document.head.appendChild(st)}
  st.textContent=`.hdr{background:linear-gradient(120deg,${dark},${c})!important}.btn{background:linear-gradient(120deg,${dark},${c})!important}.btn2{background:${c}1a!important;color:${c}!important;border-color:${c}55!important}.btn2.on,.chip.on,.searchbar .go{background:${c}!important;color:#fff!important;border-color:${c}!important}.chip{background:${c}14!important;color:${c}!important;border-color:${c}55!important}`;
  document.title=l.name;
  const tm=document.querySelector('meta[name=theme-color]');if(tm)tm.content=c;
  const mf=document.querySelector('link[rel=manifest]');if(mf)mf.href='/api/laundries/'+slug+'/manifest.webmanifest';
 }catch(e){}
}
function save(){store.set('token',state.token);store.set('me',state.me);store.set('cart',state.cart);store.set('memberships',state.memberships);store.set('courier',state.courier)}
function esc(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
/* פתוח כעת: is_open ידני + שעות פעילות (אזור זמן ישראל). בלי שעות מוגדרות — לפי is_open בלבד */
function openNow(l){
 if(!l.is_open)return false;
 const h=l.hours||{};if(!Object.keys(h).length)return true;
 const now=new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Jerusalem'}));
 const rs=h[now.getDay()];if(!rs||!rs.length)return false;
 const hm=now.getHours()*60+now.getMinutes();
 return rs.some(r=>{const m=String(r[0]).match(/(\d+):(\d+)/),n=String(r[1]).match(/(\d+):(\d+)/);if(!m||!n)return false;return hm>=m[1]*60+ +m[2]&&hm<=n[1]*60+ +n[2]});
}
let toastTimer=null;
function toast(m){let t=$('.toast');if(!t){t=document.createElement('div');t.className='toast';document.body.appendChild(t)}t.textContent=m;t.classList.add('show');if(toastTimer)clearTimeout(toastTimer);toastTimer=setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),400)},4000)}
/* חלון אישור/קלט פנימי (מחליף confirm/prompt של הדפדפן) */
function xmodal({title,body,okText='אישור',cancelText='ביטול',fields}){
 return new Promise(resolve=>{
  const ov=document.createElement('div');ov.className='modal-ov';
  ov.innerHTML=`<div class="modal" role="dialog" aria-modal="true"><b>${esc(title)}</b>${body?`<div class="mut" style="margin:8px 0">${body}</div>`:''}
   ${(fields||[]).map(f=>`<label class="lb">${esc(f.label)}</label><input class="inp" id="xm-${f.id}" value="${esc(f.value||'')}" ${f.type?`type="${f.type}"`:''}>`).join('')}
   <div style="display:flex;gap:8px;margin-top:14px"><button class="btn" id="xm-ok" style="flex:1">${esc(okText)}</button><button class="btn2" id="xm-cancel" style="flex:1">${esc(cancelText)}</button></div></div>`;
  document.body.appendChild(ov);
  const done=v=>{ov.remove();resolve(v)};
  ov.querySelector('#xm-ok').onclick=()=>{const vals={};(fields||[]).forEach(f=>vals[f.id]=ov.querySelector('#xm-'+f.id).value);done(fields?vals:true)};
  ov.querySelector('#xm-cancel').onclick=()=>done(null);
  ov.onclick=e=>{if(e.target===ov)done(null)};
 });
}
function xconfirm(msg,opts={}){return xmodal({title:opts.title||'אישור פעולה',body:msg,okText:opts.okText||'אישור'})}
async function api(path,opts={}){
 let r;
 try{r=await fetch('/api'+path,{...opts,headers:{'Content-Type':'application/json',...(state.token?{Authorization:'Bearer '+state.token}:{})}})}
 catch(e){const err=new Error('אין חיבור לרשת — בדקו את החיבור ונסו שוב');err.status=0;throw err}
 const data=await r.json().catch(()=>({}));
 if(!r.ok){const err=new Error(data.error||('שגיאה '+r.status));err.status=r.status;throw err}
 return data;
}
let routeSeq=0;
function go(h){if(location.hash===h)route();else location.hash=h}
async function openPdf(path){
 try{
  const r=await fetch('/api'+path,{headers:state.token?{Authorization:'Bearer '+state.token}:{}});
  if(!r.ok){const d=await r.json().catch(()=>({}));toast(d.error||'שגיאה בפתיחת PDF');return}
  const b=await r.blob();window.open(URL.createObjectURL(b),'_blank');
 }catch(e){toast('שגיאה בפתיחת PDF')}
}
async function downloadCsv(path,filename){
 try{
  const r=await fetch('/api'+path,{headers:{Authorization:'Bearer '+state.token}});
  if(!r.ok){const d=await r.json().catch(()=>({}));toast(d.error||'שגיאה בייצוא');return}
  const b=await r.blob();const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),4000);
 }catch(e){toast('שגיאה בייצוא')}
}
function fmtQ(q){const n=Number(q);return (n%1)?String(n):String(Math.round(n))}
function unitLbl(u,qty){if(u==='kg')return 'ק״ג';if(u==='bag')return Number(qty)>1?'שקים':'שק';return 'יח׳'}
const HE={new:'התקבלה',confirmed:'אושרה',picked_up:'נאספה',in_work:'בעבודה',ready:'מוכנה',out_for_delivery:'בדרך',delivered:'הוחזרה',cancelled:'בוטלה'};
const FLOW=['new','confirmed','picked_up','in_work','ready','out_for_delivery','delivered'];
const WD=['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
function fmtDT(s){if(!s)return '—';const d=new Date(s);return d.toLocaleDateString('he-IL',{weekday:'short',day:'numeric',month:'numeric',timeZone:'Asia/Jerusalem'})+' '+d.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Jerusalem'})}
function fmtDate(s){if(!s)return '—';const d=new Date(s);return d.toLocaleDateString('he-IL',{weekday:'short',day:'numeric',month:'numeric',timeZone:'Asia/Jerusalem'})}
function nextWindowDate(weekday,timeStr){
 const d=new Date();const[hh,mm]=timeStr.split(':').map(Number);
 d.setHours(hh,mm,0,0);
 while(d.getDay()!==weekday||d<new Date())d.setDate(d.getDate()+1);
 return d.toISOString();
}

/* ---- tabs ---- */
function renderTabs(route){
 const T=[['#/','⌂','בית']];
 if(state.token)T.push(['#/orders','▤','הזמנות'],['#/club','★','מועדון']);
 if(state.courier)T.push(['#/courier','▸','שליח']);
 if(state.memberships&&state.memberships.length)T.push(['#/community','✦','קהילה'],['#/manage','⚙','ניהול']);
 if(state.me&&state.me.role==='admin')T.push(['#/admin','▣','אדמין']);
 $('#tabs').innerHTML='<div class="in">'+T.map(t=>`<a href="${t[0]}" class="${route===t[0]||(t[0]!=='#/'&&route.startsWith(t[0]))?'on':''}"><span class="ic">${t[1]}</span>${t[2]}</a>`).join('')+'</div>';
}

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

/* ---- marketplace ---- */
/* E13: חיפוש וסינון מתקדם — שירותים, דירוג, זמינות, מחיר לק״ג, שליחות חינם, מרחק ומיון */
function haversine(lat1,lng1,lat2,lng2){
 const R=6371,dLa=(lat2-lat1)*Math.PI/180,dLo=(lng2-lng1)*Math.PI/180;
 const a=Math.sin(dLa/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLo/2)**2;
 return 2*R*Math.asin(Math.sqrt(a));
}
function fmtDist(d){return d<1?Math.round(d*1000)+' מ׳':d.toFixed(1)+' ק״מ'}
function homeGeo(){
 if(!navigator.geolocation)return toast('הדפדפן לא תומך במיקום');
 toast('מאתר מיקום…');
 navigator.geolocation.getCurrentPosition(p=>{
  const geo={lat:p.coords.latitude,lng:p.coords.longitude};store.set('geo',geo);
  document.querySelectorAll('#home-grid .lcard').forEach(c=>{
   const lat=Number(c.dataset.lat),lng=Number(c.dataset.lng);
   if(c.dataset.lat&&!isNaN(lat)&&!isNaN(lng)){
    const d=haversine(geo.lat,geo.lng,lat,lng);c.dataset.dist=d;
    const sp=c.querySelector('.dist');if(sp)sp.textContent=' · '+fmtDist(d);
   }
  });
  const sel=document.getElementById('home-sort');
  if(sel){const op=sel.querySelector('option[value=dist]');if(op)op.disabled=false;sel.value='dist'}
  homeFilter();toast('המיקום עודכן — התוצאות ממוינות לפי קרבה');
 },()=>toast('לא הצלחנו לקבל מיקום — אשרו גישה למיקום בדפדפן'),{timeout:10000});
}
function homeFilterReset(){
 document.querySelectorAll('.home-side input[type=checkbox]:checked').forEach(x=>x.checked=false);
 const k=document.getElementById('hf-kg');if(k)k.value='';
 const s=document.getElementById('home-sort');if(s)s.value='rec';
 homeFilter();
}
async function vHome(q){
 /* E13.T8: היסטוריית חיפושים מקומית (עד 5) */
 if(q){let hs=store.get('searches',[]).filter(x=>x!==q);hs.unshift(q);store.set('searches',hs.slice(0,5))}
 let laundries=[],offlineData=false;
 try{const r=await api('/laundries'+(q?'?q='+encodeURIComponent(q):''));laundries=r.laundries;if(!q)store.set('homeCache',{laundries:laundries,ts:Date.now()})}
 catch(e){const c=store.get('homeCache',null);if(c&&c.laundries&&c.laundries.length){laundries=c.laundries;offlineData=true}else toast(e.message)}
 const geo=store.get('geo',null);
 const svcSet=[...new Set(laundries.flatMap(l=>l.services||[]))].sort();
 const distOf=l=>geo&&l.lat!=null&&l.lng!=null?haversine(geo.lat,geo.lng,l.lat,l.lng):null;
 return `<div class="hdr" style="text-align:center;padding-top:26px">
  <h1 class="big" style="margin:0">מכבסה בקליק</h1>
  <p style="font-size:13px">כל המכבסות באזורך — במקום אחד</p>
  <div class="searchbar" style="margin-top:14px"><input id="q" placeholder="מכבסה, עיר, שירות…" value="${esc(q||'')}" onkeydown="if(event.key==='Enter')go('#/?q='+encodeURIComponent(this.value))"><button class="go" onclick="go('#/?q='+encodeURIComponent($('#q').value))">חיפוש</button></div>
 </div>
 <div class="body">
  ${offlineData?'<div class="card warn" style="text-align:center">אין חיבור לרשת — מוצגת רשימת המכבסות שנשמרה במכשיר, וחלק מהפרטים עשויים להשתנות</div>':''}
  <div style="margin:4px 2px 10px">
   <a class="chip ${!q?'on':''}" href="#/">הכל</a><a class="chip" href="#/?q=${encodeURIComponent('כביסה')}">כביסה</a><a class="chip" href="#/?q=${encodeURIComponent('ניקוי יבש')}">ניקוי יבש</a><a class="chip" href="#/?q=${encodeURIComponent('גיהוץ')}">גיהוץ</a><a class="chip" href="#/?q=${encodeURIComponent('שטיח')}">שטיחים</a>
  </div>
  ${!q&&store.get('searches',[]).length?`<div style="margin:0 2px 10px"><span class="mut">חיפושים אחרונים: </span>${store.get('searches',[]).map(h=>`<a class="chip" href="#/?q=${encodeURIComponent(h)}">${esc(h)}</a>`).join('')}<a href="#/" onclick="store.set('searches',[]);return true" class="chip" style="color:#8a99a3">ניקוי ✕</a></div>`:''}
  ${laundries.length?`<div style="display:flex;gap:8px;align-items:center;margin:0 2px 10px">
   <button class="btn2 hf-mob" type="button" onclick="const s=document.querySelector('.home-side');if(s)s.classList.toggle('open')">☰ סינון</button>
   <select id="home-sort" class="inp" style="margin:0;flex:1;padding:8px 10px;font-size:13px" onchange="homeFilter()">
    <option value="rec">מיון: מומלץ</option>
    <option value="price">מחיר — מהזול ליקר</option>
    <option value="rating">דירוג — מהגבוה לנמוך</option>
    <option value="open">פתוח עכשיו קודם</option>
    <option value="dist" ${geo?'':'disabled'}>מרחק — מהקרוב לרחוק</option>
   </select>
   <button class="btn2" type="button" onclick="homeGeo()" title="חישוב מרחק מהמיקום שלי">📍 קרוב אליי</button>
  </div>`:''}
  <div class="home-wrap">
  <aside class="home-side"><h3>סינון <a href="#/" onclick="homeFilterReset();return false" style="font-weight:400;font-size:11px;color:#0e7a8a">ניקוי</a></h3>
   ${svcSet.length?`<div class="sec">שירות</div>
   ${svcSet.map(sv=>`<label style="display:block;margin:4px 0;font-size:13px"><input type="checkbox" class="hf-svc" value="${esc(sv)}" onchange="homeFilter()"> ${esc(sv)}</label>`).join('')}`:''}
   <div class="sec">דירוג</div>
   <label style="display:block;margin:4px 0;font-size:13px"><input type="checkbox" class="hf-rate" value="3" onchange="homeFilter()"> 3★ ומעלה</label>
   <label style="display:block;margin:4px 0;font-size:13px"><input type="checkbox" class="hf-rate" value="4" onchange="homeFilter()"> 4★ ומעלה</label>
   <label style="display:block;margin:4px 0;font-size:13px"><input type="checkbox" class="hf-rate" value="4.5" onchange="homeFilter()"> 4.5★ ומעלה</label>
   <div class="sec">מחיר לק״ג</div>
   <select class="inp" id="hf-kg" style="margin:4px 0;font-size:13px;padding:8px 10px" onchange="homeFilter()">
    <option value="">הכל</option><option value="15">עד ₪15</option><option value="20">עד ₪20</option><option value="25">עד ₪25</option><option value="30">עד ₪30</option>
   </select>
   <div class="sec">זמינות ועלויות</div>
   ${store.get('favs',[]).length?`<label style="display:block;margin:4px 0;font-size:13px"><input type="checkbox" id="hf-fav" onchange="homeFilter()"> ★ המועדפים שלי</label>`:''}
   <label style="display:block;margin:4px 0;font-size:13px"><input type="checkbox" id="hf-open" onchange="homeFilter()"> פתוח עכשיו</label>
   <label style="display:block;margin:4px 0;font-size:13px"><input type="checkbox" id="hf-free" onchange="homeFilter()"> איסוף ומשלוח חינם</label>
  </aside>
  <div>
  <div class="mut" id="hf-count" style="margin:0 2px 8px"></div>
  <div class="home-grid" id="home-grid">
  ${laundries.map((l,i)=>{const dd=distOf(l);return `<a class="card lcard" data-idx="${i}" data-rating="${l.rating||0}" data-rc="${l.rating_count||0}" data-open="${openNow(l)?1:0}" data-services="${esc((l.services||[]).join('|'))}" data-fee="${Number(l.delivery_fee||0)}" data-kg="${l.from_kg!=null?Number(l.from_kg):''}" data-price="${l.from_price!=null?Number(l.from_price):''}" data-lat="${l.lat!=null?l.lat:''}" data-lng="${l.lng!=null?l.lng:''}" data-dist="${dd!=null?dd:''}" data-fav="${isFav(l.slug)?1:0}" href="#/laundry/${l.slug}" style="cursor:pointer;text-decoration:none;color:inherit">
    ${l.has_logo?`<img class="logo" loading="lazy" src="/api/laundries/${l.slug}/logo" style="object-fit:contain;background:#fff" alt="${esc(l.name)}">`:`<span class="logo" style="background:${l.color||'#0e7a8a'}">${esc(l.letter||l.name[0])}</span>`}
    <div style="flex:1">
     <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><b>${esc(l.name)}</b>${openNow(l)?'<span class="tag tg">פתוח</span>':'<span class="tag to">סגור</span>'}</div>
     <div class="mut" style="margin-top:3px">${l.rating_count>=3?`<span class="stars">★</span> ${l.rating} (${l.rating_count}) · `:`<span class="tag tb">חדש</span> · `}${esc(l.city||'')}${l.from_price?' · החל מ־₪'+l.from_price:''}<span class="dist">${dd!=null?' · '+fmtDist(dd):''}</span></div>
     <div class="mut">שליחות ₪${l.delivery_fee||0}${Number(l.min_order)>0?' · מינימום ₪'+l.min_order:''}</div>
    </div><span style="color:#8a99a3">‹</span></a>`}).join('')||`<div class="card mut">לא נמצאו מכבסות מתאימות${q?` — <a href="#/" style="color:#0e7a8a">נקה חיפוש</a>`:''}</div>`}
  </div>
  ${laundries.length?`<div class="card mut" id="hf-empty" style="display:none">אין מכבסות שמתאימות לסינון — <a href="#/" onclick="homeFilterReset();return false" style="color:#0e7a8a">ניקוי סינון</a></div>`:''}
  </div></div>
  <div class="card" style="cursor:pointer;background:#e6f4f6;text-align:center" onclick="go('#/join')"><b style="color:#0e7a8a">＋ יש לך מכבסה? הצטרפו לפלטפורמה — גם בצילום מחירון בלבד</b></div>
  ${state.me?`<div class="card mut" style="text-align:center">מחובר כ${esc(state.me.name||state.me.phone||state.me.email)} · <a href="#/" onclick="logout();return false" style="color:#0e7a8a">התנתקות</a></div>`:''}
 </div>`;
}

/* E13: סינון + מיון משולבים (עובד גם בסרגל הדסקטופ וגם בפאנל המובייל) */
function homeFilter(){
 const grid=document.getElementById('home-grid');if(!grid)return;
 const svc=[...document.querySelectorAll('.hf-svc:checked')].map(x=>x.value);
 const rates=[...document.querySelectorAll('.hf-rate:checked')].map(x=>Number(x.value));
 const minRate=rates.length?Math.min(...rates):0;
 const openEl=document.getElementById('hf-open'),freeEl=document.getElementById('hf-free');
 const openOnly=openEl&&openEl.checked,freeDel=freeEl&&freeEl.checked;
 const kgEl=document.getElementById('hf-kg');
 const maxKg=kgEl&&kgEl.value?Number(kgEl.value):0;
 const sortEl=document.getElementById('home-sort');
 const sort=sortEl?sortEl.value:'rec';
 const cards=[...grid.querySelectorAll('.lcard')];
 let shown=0;
 cards.forEach(c=>{
  const r=Number(c.dataset.rating||0),o=c.dataset.open==='1',svcs=(c.dataset.services||'').split('|');
  const fee=Number(c.dataset.fee||0),kg=c.dataset.kg!==''?Number(c.dataset.kg):null;
  let ok=true;
  if(svc.length&&!svc.some(x=>svcs.includes(x)))ok=false;
  if(minRate&&r<minRate)ok=false;
  if(openOnly&&!o)ok=false;
  if(freeDel&&fee>0)ok=false;
  if(maxKg&&(kg===null||kg>maxKg))ok=false;
  const favEl=document.getElementById('hf-fav');
  if(favEl&&favEl.checked&&c.dataset.fav!=='1')ok=false;
  c.style.display=ok?'':'none';
  if(ok)shown++;
 });
 const key={rec:c=>Number(c.dataset.idx),
  price:c=>c.dataset.price!==''?Number(c.dataset.price):1e9,
  rating:c=>-(Number(c.dataset.rating||0)*10000+Number(c.dataset.rc||0)),
  open:c=>c.dataset.open==='1'?0:1,
  dist:c=>c.dataset.dist!==''?Number(c.dataset.dist):1e9}[sort];
 if(key)[...cards].sort((a,b)=>key(a)-key(b)).forEach(c=>grid.appendChild(c));
 const cnt=document.getElementById('hf-count');
 if(cnt)cnt.textContent=shown?shown+' מכבסות':'';
 const emp=document.getElementById('hf-empty');
 if(emp)emp.style.display=shown?'none':'block';
}

async function vLaundry(slug){
 let d;
 try{d=await api('/laundries/'+slug)}catch(e){return `<div class="body"><div class="card">${esc(e.message)}</div></div>`}
 const l=d.laundry;
 let mySub=null;
 if(state.token){try{const sm=await api('/subscriptions/mine');mySub=sm.subscriptions.find(x=>x.slug===slug&&x.status!=='cancelled')}catch(e){}}
 const cartItems=state.cart.filter(c=>c.slug===slug);
 const cartTotal=cartItems.reduce((s,c)=>s+c.price*c.qty,0);
 /* E13.T4: מחירון מקובץ לקטגוריות עם קפיצה וחיפוש */
 const cats=[];const byCat={};
 d.items.forEach(it=>{const c=it.category||'כללי';if(!byCat[c]){byCat[c]=[];cats.push(c)}byCat[c].push(it)});
 const winTxt=kind=>{
  const m={};(d.windows||[]).filter(w=>w.kind===kind&&w.weekday!==6).forEach(w=>{(m[w.weekday]=m[w.weekday]||[]).push(w.start_time.slice(0,5)+'–'+w.end_time.slice(0,5))});
  const out=Object.keys(m).sort().map(k=>WD[k]+': <span dir="ltr">'+m[k].join(', ')+'</span>').join(' · ');
  return out||'—';
 };
 return `<div class="hdr">
  <div style="display:flex;gap:12px;align-items:center">
   <a href="#/" style="color:#fff;font-size:20px;text-decoration:none" aria-label="חזרה">→</a>
   ${l.has_logo?`<img class="logo" src="/api/laundries/${slug}/logo" style="object-fit:contain;background:#fff" alt="${esc(l.name)}">`:`<span class="logo" style="background:${l.color||'#0e7a8a'}">${esc(l.letter||l.name[0])}</span>`}
   <div style="flex:1"><h2>${esc(l.name)}</h2><p>${l.rating_count>=3?`<span class="stars">★</span> ${l.rating} (${l.rating_count} ביקורות) · `:`<span class="tag tb">מכבסה חדשה</span> · `}${esc(l.city||'')} · ${openNow(l)?'פתוח':'סגור'}</p></div>
   <button id="fav-btn" onclick="toggleFav('${slug}','${esc(l.name)}','${l.color||'#0e7a8a'}','${esc(l.letter||l.name[0])}')" style="background:rgba(255,255,255,.18);border:none;color:#ffd34d;border-radius:9px;padding:8px 11px;cursor:pointer;font-family:inherit;font-size:14px;flex-shrink:0" title="שמירה למועדפים">${isFav(slug)?'★':'☆'}</button>
   <button onclick="shareLaundry('${esc(l.name)}')" style="background:rgba(255,255,255,.18);border:none;color:#fff;border-radius:9px;padding:8px 11px;cursor:pointer;font-family:inherit;font-size:14px;flex-shrink:0" title="שיתוף המכבסה">⤴</button>
  </div>
 </div>
 <div class="body">
  ${!l.is_open?`<div class="card warn" style="text-align:center"><b>המכבסה סגורה כרגע</b><div style="margin-top:2px">אפשר לעיין במחירון — הזמנה תהיה אפשרית כשהמכבסה תיפתח</div></div>`:!openNow(l)?`<div class="card warn" style="text-align:center"><b>מחוץ לשעות הפעילות כרגע</b><div style="margin-top:2px">אפשר להזמין — האיסוף יתואם לשעות הפעילות הקרובות</div></div>`:''}
  ${(l.services&&l.services.length)?`<div style="margin:0 2px 8px">${l.services.map(sv=>`<span class="tag tb" style="margin-left:4px;padding:3px 10px">${esc(sv)}</span>`).join('')}</div>`:''}
  <div class="subtabs"><button class="chip on" type="button">מחירון</button><button class="chip" type="button" onclick="document.getElementById('info').scrollIntoView({behavior:'smooth'})">מידע</button><button class="chip" type="button" onclick="document.getElementById('revs').scrollIntoView({behavior:'smooth'})">ביקורות</button></div>
  <div class="mut" style="margin:0 2px 8px">שליחות ₪${l.delivery_fee||0}${Number(l.min_order)>0?' · מינימום הזמנה ₪'+l.min_order:''}</div>
  ${d.items.length>6?`<input class="inp" id="pl-search" placeholder="חיפוש במחירון…" oninput="plFilter(this.value)">`:''}
  ${cats.length>1?`<div style="margin:0 0 6px">${cats.map((c,i)=>`<a class="chip" style="cursor:pointer" onclick="document.getElementById('pcat-${i}').scrollIntoView({behavior:'smooth'})">${esc(c)}</a>`).join('')}</div>`:''}
  ${cats.map((c,ci)=>`${cats.length>1?`<div class="sec" id="pcat-${ci}">${esc(c)}</div>`:''}
  <div class="card">
   ${byCat[c].map(it=>{const cr=state.cart.find(x=>x.item_id===it.id);return `<div class="row pl-row" data-name="${esc(it.name)}">
     <div><b>${esc(it.name)}</b><div class="mut">₪${it.price}${it.unit==='item'?'':' ל'+unitLbl(it.unit)}</div></div>
     ${cr?`<span class="stepper"><button onclick="setQty('${slug}','${it.id}',-1)">−</button><b>${cr.qty}</b><button onclick="setQty('${slug}','${it.id}',1)">+</button></span>`
        :`<button class="btn2" onclick="setQty('${slug}','${it.id}',1)">הוספה</button>`}
    </div>`}).join('')}
  </div>`).join('')||'<div class="card mut">המחירון טרם הוזן</div>'}
  <div class="card mut" id="pl-empty" style="display:none;text-align:center">אין פריטים שמתאימים לחיפוש במחירון</div>
  ${cartItems.length?(cartTotal>=Number(l.min_order||0)?`<button class="btn" onclick="go('#/checkout/${slug}')">להזמנה · סל ₪${cartTotal}</button>`:`<button class="btn" disabled style="opacity:.6;cursor:not-allowed">חסרים ₪${Number(l.min_order)-cartTotal} למינימום הזמנה (₪${l.min_order}) · סל ₪${cartTotal}</button>`):''}
  ${(d.plans&&d.plans.length)||mySub?`<div class="sec">מנוי כביסה חודשי</div>
  <div class="card">
   ${mySub?`<div class="row"><div><b>יש לך ${esc(mySub.plan_name)}</b> ${mySub.status==='paused'?'(מושהה)':''}<div class="mut">נותרו ${fmtQ(mySub.bags_remaining)} שקים החודש · מתחדש ${fmtDate(mySub.period_end)}</div></div><a class="btn2" href="#/club" style="text-decoration:none">ניהול המנוי</a></div>`
    :(d.plans||[]).map(p=>`<div class="row"><div><b>${esc(p.name)}</b><div class="mut">${p.bags_per_month} שקים בחודש (עד ${fmtQ(p.kg_per_bag)} ק״ג לשק) · איסוף והחזרה חינם${p.extra_bag_price?' · שק חורג ₪'+p.extra_bag_price:''}${p.perks?' · '+esc(p.perks):''}</div></div><div style="text-align:center"><b>₪${p.price}</b><div class="mut">לחודש</div></div><button class="btn2 on" onclick="joinPlan('${slug}','${p.id}')">הצטרפות</button></div>`).join('')}
  </div>`:''}
  <div class="sec" id="info">מידע</div>
  <div class="card mut" style="line-height:1.8">
   שעות פעילות:<br>${Object.entries(l.hours||{}).map(([k,v])=>v&&v.length?`${WD[k]}: ${v.map(r=>'<span dir="ltr">'+r.join('–')+'</span>').join(', ')}`:null).filter(Boolean).join('<br>')||'—'}<br>
   <span style="color:#17303a;font-weight:700">חלונות איסוף:</span> ${winTxt('pickup')}<br>
   <span style="color:#17303a;font-weight:700">חלונות החזרה:</span> ${winTxt('delivery')}<br>
   ${l.address?`כתובת: ${esc(l.address)}${l.city?', '+esc(l.city):''}<br>`:''}
   ${l.phone?`טלפון: <a href="tel:${esc(l.phone)}" style="color:#0e7a8a" dir="ltr">${esc(l.phone)}</a><br>`:''}
   ${l.terms?`תקנון: ${esc(l.terms)}`:''}
  </div>
  <div class="sec" id="revs">ביקורות</div>
  <div class="card">${d.reviews.map(rv=>`<div class="row"><div><b>${esc(rv.author||'לקוח')}</b> <span class="stars">${'★'.repeat(rv.rating)}</span><div class="mut">${esc(rv.text||'')}</div>${(rv.tags&&rv.tags.length)?`<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:3px">${rv.tags.map(t=>`<span class="tag tg">${esc(t)}</span>`).join('')}</div>`:''}</div></div>`).join('')||'<div class="mut">עוד אין ביקורות</div>'}</div>
  ${state.brandSlug===slug?`<div style="text-align:center;font-size:11px;color:#8a99a3;padding:2px 0 10px">מופעל ע״י מכבסה בקליק</div>`:''}
 </div>`;
}
/* E13.T4: חיפוש חי במחירון */
function plFilter(txt){
 const t=(txt||'').trim();
 let shown=0;
 document.querySelectorAll('.pl-row').forEach(r=>{const ok=!t||r.dataset.name.includes(t);r.style.display=ok?'':'none';if(ok)shown++});
 const emp=document.getElementById('pl-empty');
 if(emp)emp.style.display=shown?'none':'block';
}
/* E13.T6: מועדפים — שמירה מקומית, סימון בדף מכבסה וסינון בבית */
function isFav(slug){return store.get('favs',[]).some(f=>f.slug===slug)}
function toggleFav(slug,name,color,letter){
 let f=store.get('favs',[]);
 if(f.some(x=>x.slug===slug)){f=f.filter(x=>x.slug!==slug);toast('הוסר מהמועדפים')}
 else{f.push({slug:slug,name:name,color:color,letter:letter});toast('נשמר במועדפים ★')}
 store.set('favs',f);
 const b=document.getElementById('fav-btn');if(b)b.textContent=isFav(slug)?'★':'☆';
}
/* E13.T4: שיתוף דף מכבסה */
async function shareLaundry(name){
 const url=location.href;
 try{
  if(navigator.share){await navigator.share({title:name,text:name+' — הזמנת כביסה במכבסה בקליק',url:url});return}
  await navigator.clipboard.writeText(url);toast('הקישור הועתק — אפשר לשלוח לחברים');
 }catch(e){if(e&&e.name!=='AbortError')toast('לא ניתן לשתף כרגע')}
}
function setQty(slug,itemId,delta){
 api('/laundries/'+slug).then(d=>{
  const it=d.items.find(x=>x.id===itemId);if(!it)return;
  let c=state.cart.find(x=>x.item_id===itemId);
  if(!c){c={slug,item_id:itemId,name:it.name,price:Number(it.price),unit:it.unit,qty:0};state.cart.push(c)}
  c.qty+=delta;if(c.qty<=0)state.cart=state.cart.filter(x=>x!==c);
  save();route();
 });
}

/* ---- checkout ---- */
async function vCheckout(slug){
 if(!state.token)return needLogin();
 window.__coCoupon=null;
 const d=await api('/laundries/'+slug);
 const l=d.laundry;
 const items=state.cart.filter(c=>c.slug===slug);
 if(!items.length){go('#/laundry/'+slug);return ''}
 const subtotal=items.reduce((s,c)=>s+c.price*c.qty,0);
 let mySub=null;
 // E13.T2: כתובות שמורות
 try{const ar=await api('/addresses');__coAddrs=ar.addresses||[]}catch(e){__coAddrs=[]}
 try{const sm=await api('/subscriptions/mine');mySub=sm.subscriptions.find(x=>x.slug===slug&&x.status==='active'&&Number(x.bags_remaining)>0)}catch(e){}
 const eligQty=items.filter(c=>{const it=d.items.find(i=>i.id===c.item_id);return it&&it.subscription_eligible}).reduce((s2,c)=>s2+c.qty,0);
 let points=0;
 try{const cl=await api('/orders/club/summary');const b=cl.balances.find(x=>x.slug===slug);points=b?b.balance:0}catch(e){}
 const maxRedeem=Math.min(points,Math.floor(subtotal*(l.points_redeem_max_pct??0.2)));
 const winOpts=kind=>d.windows.filter(w=>w.kind===kind&&w.weekday!==6).map(w=>{const dt=new Date(nextWindowDate(w.weekday,w.start_time));const dstr=dt.toLocaleDateString('he-IL',{day:'numeric',month:'numeric'});return `<option value="${w.weekday}|${w.start_time}">${WD[w.weekday]} ${dstr} · \u2066${w.start_time.slice(0,5)}–${w.end_time.slice(0,5)}\u2069</option>`}).join('');
 return `<div class="hdr"><h2><a href="#/laundry/${slug}" style="color:#fff;text-decoration:none" aria-label="חזרה">→</a> הזמנה — ${esc(l.name)}</h2></div>
 <div class="body">
  <div class="card">
   ${items.map(c=>`<div class="row"><div>${esc(c.name)}</div><div>${fmtQ(c.qty)} ${unitLbl(c.unit,c.qty)} × ₪${c.price}</div></div>`).join('')}
   <div class="row"><div class="mut">סכום ביניים</div><div>₪${subtotal}</div></div>
   <div class="row"><div class="mut">שליחות</div><div>₪${l.delivery_fee||0}</div></div>
   <div class="row" id="co-coupon-row" style="display:none"><div class="mut">הנחת קופון <b id="co-coupon-code"></b></div><div id="co-coupon-disc" style="color:#0a7">−₪0</div></div>
   <div class="row" id="co-discount-row" style="display:none"><div class="mut">הנחת נקודות</div><div id="co-discount">−₪0</div></div>
   <div class="row" style="border-top:2px solid #d3e8ec"><b>סה״כ לתשלום</b><b id="co-total" style="font-size:17px" data-subtotal="${subtotal}" data-fee="${Number(l.delivery_fee||0)}" data-points="${points}" data-pct="${l.points_redeem_max_pct??0.2}" data-base="${subtotal+Number(l.delivery_fee||0)}" data-redeem="${maxRedeem}" data-noneligible="${items.filter(c=>{const it=d.items.find(i=>i.id===c.item_id);return !it||!it.subscription_eligible}).reduce((s2,c)=>s2+c.price*c.qty,0)}" data-subremaining="${mySub?mySub.bags_remaining:0}" data-extrabag="${mySub&&mySub.extra_bag_price!==null&&mySub.extra_bag_price!==undefined?mySub.extra_bag_price:''}">₪${subtotal+Number(l.delivery_fee||0)}</b></div>
   <div class="row"><div class="mut">יש קופון?</div><div style="display:flex;gap:6px"><input class="inp" id="co-coupon" placeholder="קוד קופון" style="margin:0;flex:1"><button class="btn2 on" onclick="applyCoupon('${slug}')">החלה</button></div></div>
   <div id="co-coupon-msg" class="mut" style="display:none;margin-top:4px"></div>
   ${mySub&&eligQty>0?`<div class="row" id="co-sub-row"><div class="mut">מנוי: ${esc(mySub.plan_name)} · נותרו ${fmtQ(mySub.bags_remaining)} שקים</div><label style="font-size:13px"><input type="checkbox" id="co-sub" onchange="updTotal()"> שלם עם המנוי — פריטים מכוסים ב־₪0, איסוף חינם</label></div>`:''}
   <div class="row"><div class="mut">נקודות במכבסה זו: ${points}</div><div>${maxRedeem>0?`<label style="font-size:12px"><input type="checkbox" id="redeem" onchange="updTotal()"><span id="co-redeem-lbl"> מימוש ${maxRedeem} נקודות (−₪${maxRedeem})</span></label>`:'<span class="mut">אין נקודות למימוש כאן</span>'}</div></div>
  </div>
  <div class="card">
   ${__coAddrs.length?`<label class="lb">כתובות שמורות</label>
   <div style="display:flex;gap:6px">
    <select class="inp" id="co-saved-addr" style="margin-bottom:6px;flex:1" onchange="pickAddr(this)">
     <option value="">כתובת חדשה…</option>
     ${__coAddrs.map(a=>`<option value="${a.id}">${esc(a.label)} — ${esc(a.address)}</option>`).join('')}
    </select>
    <button class="btn2" id="co-del-addr" style="display:none;margin-bottom:6px" onclick="delAddr()">מחיקה</button>
   </div>`:''}
   <label class="lb">כתובת לאיסוף והחזרה</label>
   <input class="inp" id="co-address" placeholder="רחוב, מספר, עיר" oninput="this.style.borderColor='';const e=document.getElementById('co-address-err');if(e)e.remove()">
   <div id="co-save-wrap">
    <label style="font-size:12.5px"><input type="checkbox" id="co-save-addr"> שמירת הכתובת לפעם הבאה</label>
    <input class="inp" id="co-addr-label" placeholder="תווית לכתובת (בית, עבודה…)" style="margin-top:6px">
   </div>
   <label class="lb">חלון איסוף</label>
   <select class="inp" id="co-pickup"><option value="">ללא העדפה</option>${winOpts('pickup')}</select>
   <label class="lb">חלון החזרה (אופציונלי)</label>
   <select class="inp" id="co-delivery"><option value="">ללא העדפה</option>${winOpts('delivery')}</select>
   <label class="lb">אמצעי תשלום</label>
   <select class="inp" id="co-pay"><option value="cash">מזומן לשליח</option><option value="demo_online">תשלום מקוון (דמו — ללא סליקה אמיתית)</option></select>
   <label class="lb">הערות</label>
   <input class="inp" id="co-notes" placeholder="כתם עקשן, קומה, קוד שער…">
  </div>
  <button class="btn" id="co-submit" onclick="submitOrder('${slug}')">אישור הזמנה</button>
 </div>`;
}
function updTotal(){
 const t=$('#co-total');if(!t)return;
 const subtotal=Number(t.dataset.subtotal),fee=Number(t.dataset.fee),points=Number(t.dataset.points),pct=Number(t.dataset.pct);
 const coupon=window.__coCoupon?Number(window.__coCoupon.discount):0;
 const remaining=Math.max(0,subtotal-coupon);
 const maxRedeem=Math.min(points,Math.floor(remaining*pct));
 const lbl=$('#co-redeem-lbl');if(lbl)lbl.textContent=' מימוש '+maxRedeem+' נקודות (−₪'+maxRedeem+')';
 const on=$('#redeem')&&$('#redeem').checked;
 const subOn=$('#co-sub')&&$('#co-sub').checked;
 const pdisc=on&&!subOn?maxRedeem:0;
 $('#co-discount').textContent='−₪'+pdisc;$('#co-discount-row').style.display=pdisc?'flex':'none';
 $('#co-coupon-disc').textContent='−₪'+coupon;$('#co-coupon-row').style.display=coupon?'flex':'none';
 if(subOn){
  const nonElig=Number(t.dataset.noneligible),rem=Number(t.dataset.subremaining);
  const elig=Math.max(0,subtotal-Number(t.dataset.noneligible)); // הערכה בלבד — החישוב המחייב בשרת
  t.textContent='~₪'+Math.max(0,nonElig-coupon)+' (במנוי)';
 }else t.textContent='₪'+Math.max(0,subtotal+fee-coupon-pdisc);
}
async function applyCoupon(slug){
 const inp=$('#co-coupon'),msg=$('#co-coupon-msg');const code=inp.value.trim();if(!code)return;
 const t=$('#co-total');
 try{
  const r=await api('/orders/validate-coupon',{method:'POST',body:JSON.stringify({slug,code,subtotal:Number(t.dataset.subtotal)})});
  window.__coCoupon={code,discount:r.discount};
  $('#co-coupon-code').textContent=code.toUpperCase();
  msg.style.display='block';msg.style.color='#0a7';msg.textContent='הקופון הוחל: הנחה של ₪'+r.discount;
  updTotal();
 }catch(e){
  window.__coCoupon=null;
  msg.style.display='block';msg.style.color='#c22';msg.textContent=e.message||'קופון לא תקף';
  updTotal();
 }
}
let __coAddrs=[];
function pickAddr(sel){
 const a=__coAddrs.find(x=>x.id===sel.value);
 const inp=$('#co-address'),wrap=$('#co-save-wrap'),del=$('#co-del-addr');
 if(a){if(inp)inp.value=a.address;if(wrap)wrap.style.display='none';if(del)del.style.display=''}
 else{if(wrap)wrap.style.display='block';if(del)del.style.display='none'}
}
async function delAddr(){
 const sel=$('#co-saved-addr');if(!sel||!sel.value)return;
 if(!await xconfirm('למחוק את הכתובת השמורה?',{okText:'מחיקה'}))return;
 try{
  await api('/addresses/'+sel.value,{method:'DELETE'});
  __coAddrs=__coAddrs.filter(x=>x.id!==sel.value);
  const op=sel.querySelector('option[value="'+sel.value+'"]');if(op)op.remove();
  sel.value='';pickAddr(sel);toast('הכתובת נמחקה');
 }catch(e){toast(e.message)}
}
let __submitting=false;
async function submitOrder(slug){
 if(!state.token)return needLogin();
 if(__submitting)return; // נעילה נגד דאבל-קליק
 __submitting=true;
 const btn=$('#co-submit');const orig=btn&&btn.textContent;
 if(btn){btn.disabled=true;btn.style.opacity='.6';btn.textContent='שולח…'}
 const kill=setTimeout(()=>{__submitting=false;if(btn){btn.disabled=false;btn.style.opacity='';btn.textContent=orig};toast('השליחה לוקחת זמן רק מהרגיל — אם ההזמנה לא אושרה, נסו שוב')},30000);
 try{
  const items=state.cart.filter(c=>c.slug===slug).map(c=>({item_id:c.item_id,qty:c.qty}));
  const addrEl=$('#co-address');const address=addrEl.value.trim();
  if(!address){addrEl.style.borderColor='#c22';let ie=$('#co-address-err');if(!ie){ie=document.createElement('div');ie.id='co-address-err';ie.className='mut';ie.style.color='#c22';ie.textContent='חסרה כתובת לאיסוף והחזרה';addrEl.after(ie)}addrEl.focus();return}
  addrEl.style.borderColor='';const ie=$('#co-address-err');if(ie)ie.remove();
  const w=($('#co-pickup').value||'').split('|');
  const pickup_at=w.length===2?nextWindowDate(Number(w[0]),w[1]):null;
  const w2=($('#co-delivery')&&$('#co-delivery').value||'').split('|');
  const delivery_at=w2.length===2?nextWindowDate(Number(w2[0]),w2[1]):null;
  const body={slug,items,address,pickup_at,delivery_at,payment_method:$('#co-pay').value,redeem_points:!!($('#redeem')&&$('#redeem').checked),coupon_code:window.__coCoupon?window.__coCoupon.code:undefined,notes:$('#co-notes').value.trim(),use_subscription:!!($('#co-sub')&&$('#co-sub').checked),source:state.brandSlug===slug?'branded':undefined};
  const r=await Promise.race([api('/orders',{method:'POST',body:JSON.stringify(body)}),new Promise((_,rej)=>setTimeout(()=>rej(new Error('פג הזמן — בדקו חיבור ונסו שוב')),25000))]);
  try{const sv=$('#co-save-addr');
   if(sv&&sv.checked)await api('/addresses',{method:'POST',body:JSON.stringify({address,label:($('#co-addr-label')?$('#co-addr-label').value.trim():'')||'בית'})});
  }catch(e){/* שמירת כתובת לא מפילה הזמנה שכבר נקלטה */}
  state.cart=state.cart.filter(c=>c.slug!==slug);save();
  toast('ההזמנה נקלטה!');go('#/orders/'+r.order.id);
 }catch(e){toast(e.message)}
 finally{clearTimeout(kill);__submitting=false;if(btn){btn.disabled=false;btn.style.opacity='';btn.textContent=orig}}
}

/* ---- orders ---- */
async function vOrders(){
 if(!state.token)return needLogin();
 const r=await api('/orders/mine');
 return `<div class="hdr"><h2>ההזמנות שלי</h2></div>
 <div class="body">
  ${r.orders.map(o=>`<div class="card lcard" style="cursor:pointer" onclick="go('#/orders/${o.id}')">
    <span class="logo sm" style="background:${o.color||'#0e7a8a'}">${esc(o.letter||'מ')}</span>
    <div style="flex:1"><b>${esc(o.tenant_name)}</b> <span class="st-pill st-${o.status}">${HE[o.status]}</span>
    <div class="mut">${fmtDT(o.created_at)} · ₪${o.total}${o.items&&o.items.length?' · '+o.items.slice(0,2).map(i=>esc(i.name)+' ×'+fmtQ(i.qty)).join(', ')+(o.items.length>2?' +'+(o.items.length-2):''):''}</div></div>
    ${o.status==='delivered'?`<button class="btn2" style="flex-shrink:0" onclick="event.stopPropagation();reorder('${o.id}','${o.slug}')" title="הוספת אותם פריטים לסל">↻ שוב</button>`:''}
    <span style="color:#8a99a3">‹</span></div>`).join('')||'<div class="card mut">עוד אין הזמנות. <a href="#/" style="color:#0e7a8a">להתחיל</a></div>'}
 </div>`;
}
async function vOrder(id){
 if(!state.token)return needLogin();
 const d=await api('/orders/'+id);
 const o=d.order;
 const idx=FLOW.indexOf(o.status);
 const isMine=o.customer_id===(state.me&&state.me.id);
 // E13.T3: ציר זמן עם חותמות זמן מדויקות מאירועי ההזמנה + רענון חי כל 20 שניות עד לסיום
 const evByStatus={};
 (d.events||[]).forEach(ev=>{if(!evByStatus[ev.status])evByStatus[ev.status]=ev});
 if(!['delivered','cancelled'].includes(o.status)){
  orderPoll=setInterval(async()=>{
   if(!location.hash.startsWith('#/orders/'+id)){clearInterval(orderPoll);orderPoll=null;return}
   try{const d2=await api('/orders/'+id);if(d2.order.status!==o.status||d2.order.updated_at!==o.updated_at)route()}catch(e){}
  },20000);
 }
 let docs=[];
 if(isMine){try{const dd=await api('/documents/mine');docs=dd.documents.filter(x=>x.order_id===id||(x.covered_order_ids||[]).includes(id))}catch(e){}}
 let myReports=[];
 if(isMine){try{const rr=await api('/orders/'+id+'/reports');myReports=rr.reports||[]}catch(e){}}
 return `<div class="hdr"><h2><a href="#/orders" style="color:#fff;text-decoration:none" aria-label="חזרה">→</a> הזמנה <span dir="ltr">#${o.id.slice(0,8)}</span></h2><p>${esc(o.tenant_name)} · ${fmtDT(o.created_at)}</p></div>
 <div class="body">
  ${o.status==='cancelled'?`<div class="card" style="text-align:center"><b style="color:#c22;font-size:17px">ההזמנה בוטלה</b><div class="mut" style="margin-top:4px">${fmtDT(evByStatus.cancelled?evByStatus.cancelled.created_at:o.updated_at)}</div></div>`:`<div class="card">
   <div class="tl">
    ${FLOW.map((s,i)=>{const ev=evByStatus[s];return `<div class="stop ${i<idx?'done':i===idx?'now':''}"><b style="font-size:13px">${HE[s]}</b>${ev?`<div class="mut">${fmtDT(ev.created_at)}</div>`:i===idx?`<div class="mut">${fmtDT(o.updated_at)}</div>`:''}${i===idx&&ev&&ev.note&&ev.note!=='הזמנה נוצרה'?`<div class="mut">${esc(ev.note)}</div>`:''}</div>`}).join('')}
   </div>
   <div class="mut" style="text-align:center;margin-top:2px">המעקב מתעדכן אוטומטית · <a href="#/orders/${id}" onclick="route();return false" style="color:#0e7a8a">רענון עכשיו</a></div>
  </div>
  ${isMine?`<div class="card" style="display:flex;align-items:center;gap:10px"><div style="flex:1"><b>עדכוני סטטוס בזמן אמת</b><div class="mut">התראה בכל שינוי סטטוס — גם כשהאפליקציה סגורה</div></div><button class="btn2 on" id="push-btn" onclick="pushSubscribe()">🔔 הפעלה</button></div>`:''}`}
  ${isMine&&(o.status==='delivered'||o.status==='cancelled')?`<button class="btn" style="margin-bottom:12px" onclick="reorder('${o.id}','${o.slug}')">↻ הזמנה חוזרת — אותם פריטים שוב</button>`:''}
  <div class="card">
   ${d.items.map(it=>`<div class="row"><div>${esc(it.name)}</div><div>${it.qty} × ₪${it.price}</div></div>`).join('')}
   <div class="row"><div class="mut">שליחות</div><div>₪${o.delivery_fee}</div></div>
   ${Number(o.discount)>0?`<div class="row"><div class="mut">הנחת נקודות</div><div>−₪${o.discount}</div></div>`:''}
   <div class="row"><b>סה״כ</b><b>₪${o.total}</b></div>
   <div class="mut" style="margin-top:6px">תשלום: ${o.payment_method==='cash'?'מזומן לשליח':'מקוון (דמו)'} · ${o.payment_status==='pending'?'טרם שולם':'שולם'}${o.points_earned?` · תצברו ${o.points_earned} נקודות`:''}</div>
   <div class="mut">כתובת: ${esc(o.address)}</div>
   <div class="mut">${o.pickup_at?'איסוף: '+fmtDT(o.pickup_at):'איסוף: ללא העדפה — המכבסה תתאם'}${o.delivery_at?' · החזרה: '+fmtDT(o.delivery_at):''}</div>
  </div>
  ${isMine?`<div class="card"><b>מסמכים</b>
   <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
    <button class="btn2" onclick="openPdf('/orders/${o.id}/receipt.pdf')">קבלה-סיכום (PDF)</button>
    ${docs.map(dc=>`<button class="btn2" onclick="openPdf('/documents/${dc.id}/pdf')">${dc.kind_he} ${dc.doc_number}/${dc.doc_year}</button>
     <button class="btn2" style="opacity:.75" onclick="openPdf('/documents/${dc.id}/pdf?copy=1')">העתק</button>`).join('')}
   </div>
   ${docs.length?'<div class="mut" style="margin-top:4px">מסמכים חשבונאיים מסומנים ״מסמך דמו״ עד לרישום התוכנה ברשות המסים.</div>':''}
  </div>`:''}
  ${isMine&&['new','confirmed'].includes(o.status)?`<button class="btn2" style="border-color:#f3c2c2;color:#c22;background:#fdeaea" onclick="cancelOrder('${o.id}')">ביטול הזמנה</button>`:''}
  ${isMine?`<div class="card"><b>דיווח תקלה</b>
   ${myReports.map(rp=>`<div class="row"><div><span class="tag tb">${({damage:'נזק',missing:'חסר',late:'איחור',other:'אחר'})[rp.kind]||rp.kind}</span> ${esc(rp.text)}
    <div class="mut">${fmtDT(rp.created_at)} · סטטוס: ${{open:'פתוח',in_progress:'בטיפול',resolved:'טופל'}[rp.status]||rp.status}${rp.mediation?' · בגישור אדמין':''}${rp.resolution_note?' · '+esc(rp.resolution_note):''}${rp.photos?' · '+(rp.photos===1?'תמונה אחת':rp.photos+' תמונות'):''}</div>
    ${(rp.photo_ids||[]).length?`<div style="display:flex;gap:6px;margin-top:6px">${rp.photo_ids.map(pid=>`<button class="btn2" style="padding:4px 10px;font-size:12px" onclick="openIssuePhoto('${pid}')">צפייה בתמונה</button>`).join('')}</div>`:''}</div></div>`).join('')}
   ${myReports.length?'':'<div class="mut" style="margin:6px 0">משהו לא בסדר עם ההזמנה? דווחו ונפתח פנייה מול המכבסה</div>'}
   <button class="btn2" onclick="openReportModal('${o.id}')">📷 דיווח על תקלה</button>
  </div>`:''}
  ${isMine&&o.status==='delivered'&&!d.reviewed?`<div class="card"><label class="lb">דרגו את ההזמנה</label>
    <select class="inp" id="rv-rating"><option>5</option><option>4</option><option>3</option><option>2</option><option>1</option></select>
    <input class="inp" id="rv-text" placeholder="איך היה?">
    ${o.courier_id?`<label class="lb" style="margin-top:8px">דרגו את השליח</label>
    <div style="display:flex;gap:6px;align-items:center"><select class="inp" id="rv-courier" style="width:90px"><option value="">—</option><option>5</option><option>4</option><option>3</option><option>2</option><option>1</option></select>
    <div style="display:flex;gap:4px;flex-wrap:wrap">${['בזמן','אדיב','זהיר עם הכביסה','איחור','לא עדכן'].map(t=>`<label class="chip" style="cursor:pointer"><input type="checkbox" class="rv-ctag" value="${t}" style="margin-left:3px">${t}</label>`).join('')}</div></div>`:''}
    <label class="lb" style="margin-top:8px">מה היה טוב? (תגיות למכבסה)</label>
    <div style="display:flex;gap:4px;flex-wrap:wrap">${['נקי','בזמן','מחיר הוגן','שירות','אריזה'].map(t=>`<label class="chip" style="cursor:pointer"><input type="checkbox" class="rv-ltag" value="${t}" style="margin-left:3px">${t}</label>`).join('')}</div>
    <div class="mut" style="margin:4px 0">ביקורת מזכה ב־20 נקודות מועדון</div>
    <button class="btn2 on" onclick="sendReview('${o.id}')">שליחת דירוג</button></div>`:''}
 </div>`;
}
let orderPoll=null;
/* E13.T3: הזמנה חוזרת בלחיצה — ממפה פריטי ההזמנה למחירון הנוכחי (לפי שם) ומובילה לצ׳ק-אאוט */
async function reorder(orderId,slug){
 try{
  const [lod,od]=await Promise.all([api('/laundries/'+slug),api('/orders/'+orderId)]);
  const cur=lod.items||[];
  let added=0,skipped=0;
  state.cart=state.cart.filter(c=>c.slug!==slug);
  for(const oi of (od.items||[])){
   const it=cur.find(x=>x.name===oi.name);
   if(!it){skipped++;continue}
   state.cart.push({slug,item_id:it.id,name:it.name,price:Number(it.price),unit:it.unit,qty:Number(oi.qty)});
   added++;
  }
  save();
  if(!added)return toast('אף פריט מההזמנה לא זמין כרגע במחירון');
  if(skipped)toast(skipped===1?'פריט אחד כבר לא במחירון ולא נוסף':skipped+' פריטים כבר לא במחירון ולא נוספו');
  go('#/checkout/'+slug);
 }catch(e){toast(e.message)}
}
async function cancelOrder(id){if(!await xconfirm('לא ניתן לשחזר הזמנה לאחר הביטול.',{title:'ביטול הזמנה',okText:'כן, לבטל את ההזמנה'}))return;try{await api('/orders/'+id+'/cancel',{method:'POST',body:'{}'});toast('ההזמנה בוטלה');route()}catch(e){toast(e.message)}}
async function sendReview(id){try{const ctags=[...document.querySelectorAll('.rv-ctag:checked')].map(x=>x.value);const ltags=[...document.querySelectorAll('.rv-ltag:checked')].map(x=>x.value);const cr=$('#rv-courier')?$('#rv-courier').value:'';const r=await api('/orders/'+id+'/review',{method:'POST',body:JSON.stringify({rating:$('#rv-rating').value,text:$('#rv-text').value,courier_rating:cr||undefined,courier_tags:ctags.length?ctags:undefined,tags:ltags.length?ltags:undefined})});toast(r&&r.points_bonus?`תודה על הדירוג! צברת ${r.points_bonus} נקודות`:'תודה על הדירוג!');route()}catch(e){toast(e.message)}}

/* ---- club ---- */
async function vClub(){
 if(!state.token)return needLogin();
 const d=await api('/orders/club/summary');
 let subs={subscriptions:[]};try{subs=await api('/subscriptions/mine')}catch(e){}
 return `<div class="hdr"><h2>מועדון לקוחות</h2> <p>הנקודות נצברות וניתנות למימוש בכל מכבסה בנפרד — ושוות כסף בהזמנה הבאה</p></div>
 <div class="body">
  ${subs.subscriptions.length?`<div class="sec">המנויים שלי</div>`+subs.subscriptions.map(sb=>`
  <div class="card">
   <div style="display:flex;gap:10px;align-items:center">
    <span class="logo sm" style="background:${sb.color||'#0e7a8a'}">${esc(sb.letter||'מ')}</span>
    <div style="flex:1"><b>${esc(sb.tenant_name)}</b> · ${esc(sb.plan_name)} ${sb.status==='paused'?'<span class="tag tb">מושהה</span>':''}
     <div class="mut">₪${sb.plan_price}/חודש · מתחדש ${fmtDate(sb.period_end)}</div>
     ${sb.perks?`<div class="mut">${esc(sb.perks)}</div>`:''}
    </div>
    <div style="text-align:center;min-width:64px"><b style="font-size:22px;color:#0e7a8a">${fmtQ(sb.bags_remaining)}</b><div class="mut">שקים נותרו</div></div>
   </div>
   <div class="mut" style="margin:8px 0 2px">נוצלו ${fmtQ(sb.bags_used)} מתוך ${sb.bags_per_month} שקים החודש</div>
   <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
    <button class="btn2" onclick="subUsage('${sb.id}')">היסטוריית ניצול</button>
    ${sb.status==='active'?`<button class="btn2" onclick="subUpgrade('${sb.id}','${sb.slug}')">שינוי תוכנית</button><button class="btn2" onclick="subAct('${sb.id}','pause')">השהיה</button>`:''}
    ${sb.status==='paused'?`<button class="btn2 on" onclick="subAct('${sb.id}','resume')">חידוש מנוי</button>`:''}
    <button class="btn2" style="border-color:#f3c2c2;color:#c22" onclick="subCancel('${sb.id}')">ביטול מנוי</button>
   </div>
  </div>`).join(''):''}
  <div class="card"><b>התראות דחיפה</b><div class="mut" style="margin:4px 0">עדכון מיידי בכל שינוי סטטוס בהזמנה — גם כשהאפליקציה סגורה</div>
   <button class="btn2 on" id="push-btn" onclick="pushSubscribe()">🔔 הפעלת התראות</button></div>
  <div class="sec">נקודות</div>
  ${d.balances.map(b=>`<div class="card lcard"><span class="logo sm" style="background:${b.color||'#0e7a8a'}">${esc(b.letter||'מ')}</span>
   <div style="flex:1"><b>${esc(b.name)}</b><div class="mut">יתרה: <b style="color:#0e7a8a">${b.balance}</b> נקודות (שוות ₪${b.balance})</div></div></div>`).join('')||'<div class="card mut">עוד אין נקודות — כל הזמנה צוברת</div>'}
  <div class="sec">תנועות אחרונות</div>
  <div class="card">${d.recent.map(p=>`<div class="row"><div>${esc(p.name)}<div class="mut">${esc(({review_bonus:'בונוס על ביקורת'})[p.reason]||p.reason||'')}</div></div><div style="color:${p.delta>0?'#178a4c':'#c22'};font-weight:700">${p.delta>0?'+':''}${p.delta}</div></div>`).join('')||'<div class="mut">אין תנועות</div>'}</div>
 </div>`;
}

/* ---- courier ---- */
async function vCourier(sub){
 if(!state.token)return needLogin();
 let me;try{me=await api('/auth/me')}catch(e){return needLogin()}
 if(!me.courier||me.courier.rejected_reason)return vCourierRegister(me.user,me.courier);
 if(!me.courier.approved)return `<div class="hdr"><h2>אפליקציית שליח</h2></div><div class="body"><div class="card" style="text-align:center"><div style="font-size:34px">⏳</div><b>הבקשה שלך ממתינה לאישור</b><div class="mut" style="margin-top:6px">מנהל הפלטפורמה סוקר את הפרטים והמסמכים. נעדכן אותך כשהבקשה תאושר.</div></div></div>`;
 if(sub==='earnings')return vCourierEarnings(me);
 const [offers,route,profile]=await Promise.all([api('/courier/offers'),api('/courier/route'),api('/courier/profile')]);
 return `<div class="hdr"><h2>שלום ${esc(me.user.name||'')}</h2><p>${me.courier.model==='platform'?'שליח פלטפורמה':me.courier.model==='shared'?'שליח משותף':'שליח מכבסה'} · ${profile.stats.delivered} מסירות בוצעו</p></div>
 <div class="body">
 <div class="subtabs"><a class="chip on" href="#/courier">משימות</a><a class="chip" href="#/courier/earnings">רווחים</a></div>
 ${route.combined?`<div class="warn">🧭 מסלול משולב — איסופים/החזרות מכמה מכבסות ברצף אחד, בסדר הנקודות המומלץ</div>`:''}
  ${offers.offers.length?`<div class="sec">הצעות שיבוץ חדשות</div>${offers.offers.map(o=>`
   <div class="card"><b>${esc(o.tenant_name)}</b> — הזמנה <span dir="ltr">#${o.order_id.slice(0,8)}</span>
    <div class="mut">${esc(o.address)} · ${o.kind==='pickup'?'איסוף':'החזרה'} · ₪${o.total}</div>
    ${o.pickup_at?`<div class="mut">איסוף: ${fmtDT(o.pickup_at)}</div>`:''}${o.delivery_at?`<div class="mut">החזרה: ${fmtDT(o.delivery_at)}</div>`:''}
    <div class="mut">איסוף מ: ${esc(o.tenant_address||'')}${o.tenant_city?', '+esc(o.tenant_city):''}</div>
    ${o.items&&o.items.length?`<div class="mut">פריטים: ${o.items.map(x=>esc(x.name)+' ×'+x.qty).join(', ')}</div>`:''}
    <div style="display:flex;gap:8px;margin-top:8px">
     <button class="btn2 green" onclick="offerAction('${o.offer_id}','accept')">אישור</button>
     <button class="btn2" onclick="offerAction('${o.offer_id}','decline')">דחייה</button>
    </div></div>`).join('')}`:''}
  <div class="sec">מסלול פעיל</div>
  ${route.route.map(o=>`<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center">
     <div>${o.route_seq?`<span class="tag tb">${o.route_seq}</span> `:''}<b>${esc(o.customer_name||'לקוח')}</b>${o.customer_phone?` · <a href="tel:${o.customer_phone}" style="color:#0e7a8a">${o.customer_phone}</a>`:''} <span class="st-pill st-${o.status}">${HE[o.status]}</span>
      <div class="mut">${esc(o.address)}</div>
      <div class="mut">${esc(o.tenant_name)} · ${esc(o.tenant_address||'')}</div>
      ${o.items&&o.items.length?`<div class="mut">פריטים: ${o.items.map(x=>esc(x.name)+' ×'+x.qty).join(', ')}</div>`:''}
      <div class="mut">${o.payment_method==='cash'&&o.payment_status!=='paid_cash'?'💵 לגבות ₪'+o.total+' במזומן':'שולם/דמו'}</div>
     </div>
     <a class="btn2" href="https://waze.com/ul?q=${encodeURIComponent(o.address)}" target="_blank">ניווט</a>
    </div>
    <div style="display:flex;gap:8px;margin-top:8px">
     ${o.status==='confirmed'?`<button class="btn2 on" onclick="markOrder('${o.id}','picked_up')">סימון נאסף מהמכבסה</button>`:''}
     ${o.status==='ready'?`<button class="btn2 on" onclick="markOrder('${o.id}','out_for_delivery')">יצאתי לדרך אל הלקוח</button>`:''}
     ${o.status==='picked_up'||o.status==='in_work'?`<div class="mut">הכביסה אצל המכבסה — החזרה תתאפשר כשההזמנה תסומנה ״מוכנה״</div>`:''}
     ${o.status==='out_for_delivery'?`<button class="btn2 green" onclick="markOrder('${o.id}','delivered')">מסרתי ללקוח</button>`:''}
    </div>
   </div>`).join('')||'<div class="card mut">אין משימות פעילות כרגע. משימות חדשות מגיעות כהצעות שיבוץ — <a href="javascript:route()" style="color:#0e7a8a">רענון</a></div>'}
 </div>`;
}
/* E5.T4: דוח רווחים שבועי לשליח — פירוט לפי מכבסה, ברוטו/עמלה/נטו, תשלום דמו */
async function vCourierEarnings(me){
 const d=await api('/courier/earnings');
 const t=d.totals;
 return `<div class="hdr"><h2>הרווחים שלי</h2><p>תעריף ₪${d.rate_per_stop} לנקודה · עמלת פלטפורמה ${d.commission_pct}%</p></div>
 <div class="body">
 <div class="subtabs"><a class="chip" href="#/courier">משימות</a><a class="chip on" href="#/courier/earnings">רווחים</a></div>
 <div class="kpis">
  <div class="kpi"><b>${t.stops}</b>נקודות</div>
  <div class="kpi"><b>₪${t.gross}</b>ברוטו</div>
  <div class="kpi"><b>₪${t.commission}</b>עמלה</div>
  <div class="kpi"><b>₪${t.net}</b>נטו</div>
 </div>
 <div class="card">
  <div class="sec">פירוט לפי מכבסה</div>
  ${d.by_tenant.length?`<table class="tbl"><tr><th>מכבסה</th><th>נקודות</th><th>ברוטו</th><th>עמלה</th><th>נטו</th></tr>
   ${d.by_tenant.map(x=>`<tr><td>${esc(x.tenant_name)}</td><td>${x.stops}</td><td>₪${x.gross}</td><td>₪${x.commission}</td><td>₪${x.net}</td></tr>`).join('')}</table>`:'<div class="mut">עוד אין רווחים השבוע — נקודות נצברות על כל איסוף ומסירה</div>'}
 </div>
 ${Number(t.accrued_net)>0?`<button class="btn" onclick="courierPayout()">משיכת ₪${t.accrued_net} (תשלום דמו)</button>`:Number(t.paid_net)>0?`<div class="card mut">✓ שולם (דמו): ₪${t.paid_net}</div>`:''}
 <div class="card">
  <div class="sec">רשומות אחרונות</div>
  ${d.rows.slice(0,20).map(x=>`<div class="row"><div>${x.kind==='pickup'?'איסוף':x.kind==='delivery'?'מסירה':'התאמה'} · ${esc(x.tenant_name||'—')}
    <div class="mut">${fmtDate(x.created_at)} · ₪${x.net} נטו</div></div>
    <div style="display:flex;gap:4px">${x.kind==='delivery'&&x.order_id?`<button class="btn2" onclick="courierRateTenant('${x.order_id}','${esc(x.tenant_name||'')}')">דירוג</button>`:''}${x.status==='paid_demo'?'<span class="tag tg">שולם</span>':x.status==='disputed'?'<span class="tag ta">במחלוקת</span>':`<button class="btn2" onclick="courierDispute('${x.id}')">מחלוקת</button>`}</div></div>`).join('')||'<div class="mut">אין רשומות</div>'}
 </div>
 </div>`;
}
async function courierRateTenant(orderId,tenantName){
 const v=await xmodal({title:'דירוג '+tenantName,body:'הדירוג פנימי לפלטפורמה ועוזר לשיבוץ טוב יותר.',okText:'שליחת דירוג',fields:[{id:'rating',label:'דירוג 1-5',value:'5',type:'number'},{id:'text',label:'הערה (הכנת שקים, דיוק נקודות...)'}]});
 if(!v)return;
 try{await api('/courier/rate-tenant',{method:'POST',body:JSON.stringify({order_id:orderId,rating:Number(v.rating),text:v.text||undefined})});toast('תודה על הדירוג!')}catch(e){toast(e.message)}
}
async function courierPayout(){try{const r=await api('/courier/earnings/payout',{method:'POST',body:'{}'});toast('שולמו '+r.paid+' רשומות (דמו)');route()}catch(e){toast(e.message)}}
async function courierDispute(id){if(!await xconfirm('הרשומה תסומן כמחלוקת ותטופל מול מנהל הפלטפורמה.',{title:'פתיחת מחלוקת',okText:'פתיחת מחלוקת'}))return;try{await api('/courier/earnings/'+id+'/dispute',{method:'POST',body:'{}'});toast('המחלוקת נפתחה');route()}catch(e){toast(e.message)}}
async function offerAction(id,a){try{await api(`/courier/offers/${id}/${a}`,{method:'POST',body:'{}'});toast(a==='accept'?'שובצת!':'נדחה');route()}catch(e){toast(e.message)}}
async function markOrder(id,a){try{const r=await api(`/courier/orders/${id}/mark`,{method:'POST',body:JSON.stringify({action:a})});toast(a==='picked_up'?'סומן כנאסף':'סומן כהוחזר');if(r.window_violation)setTimeout(()=>toast('שים לב: הסימון בוצע מחוץ לחלון האיסוף ונרשם כחריגה'),600);route()}catch(e){toast(e.message)}}

/* ---- manage (owner) ---- */
async function tenantCluster(slug,clid,action){try{await api(`/t/${slug}/clusters/${clid}/${action}`,{method:'POST',body:'{}'});toast(action==='join'?'הצטרפת לקלאסטר':'עזבת את הקלאסטר');route()}catch(e){toast(e.message)}}
async function tenantRateCourier(slug,cid,name){
 const v=await xmodal({title:'דירוג '+name,body:'איך השליח עבד איתכם לאחרונה?',okText:'שליחת דירוג',fields:[{id:'rating',label:'דירוג 1-5',value:'5',type:'number'}]});
 if(!v)return;
 try{await api(`/t/${slug}/couriers/${cid}/rate`,{method:'POST',body:JSON.stringify({rating:Number(v.rating)})});toast('הדירוג נשמר');route()}catch(e){toast(e.message)}
}
/* E5.T1: טופס הרשמה לשליח עצמאי (מוקאפ 19) */
function vCourierRegister(user,courier){
 const days=WD.map((d,i)=>`<label style="display:flex;align-items:center;gap:6px"><input type="checkbox" class="cr-day" value="${i}">${d}</label>`).join('');
 return `<div class="hdr"><h2>הצטרפות כשליח</h2><p>${courier&&courier.rejected_reason?'הבקשה הקודמת נדחתה — ניתן להגיש מחדש':'הרשמה לשליח עצמאי של הפלטפורמה'}</p></div>
 <div class="body">
 ${courier&&courier.rejected_reason?`<div class="card warn"><b>הבקשה נדחתה:</b> ${esc(courier.rejected_reason)}</div>`:''}
 <div class="card">
  <label class="lb">שם מלא</label><input class="inp" id="cr-name" value="${esc(user.name||'')}">
  <label class="lb">טלפון</label><input class="inp" value="${esc(user.phone||'')}" disabled>
  <label class="lb">סוג רכב</label><select class="inp" id="cr-vehicle"><option value="">— בחר —</option><option>אופנוע</option><option>קטנוע</option><option>רכב</option><option>אופניים חשמליים</option></select>
  <label class="lb">אזורי פעילות (מופרדים בפסיק)</label><input class="inp" id="cr-areas" placeholder="תל אביב, רמת גן, גבעתיים">
  <label class="lb">זמינות שבועית</label><div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">${days}</div>
  <label class="lb">מודל עבודה</label><select class="inp" id="cr-model"><option value="platform">שליח פלטפורמה — משימות מכל המכבסות</option><option value="shared">שליח משותף — משימות משולבות של מכבסות שכנות</option></select>
 </div>
 <div class="card">
  <div class="sec">מסמכים</div>
  <label class="lb">רישיון נהיגה (חובה)</label><input class="inp" id="cr-license" type="file" accept="image/*,application/pdf">
  <label class="lb">ביטוח (רשות)</label><input class="inp" id="cr-insurance" type="file" accept="image/*,application/pdf">
  <label class="lb">תמונה אישית (רשות)</label><input class="inp" id="cr-photo" type="file" accept="image/*">
 </div>
 <button class="btn" onclick="courierRegister()">שליחת בקשה לאישור</button>
 </div>`;
}
async function courierRegister(){
 try{
  const vehicle=$('#cr-vehicle').value;
  if(!vehicle)return toast('יש לבחור סוג רכב');
  if(!$('#cr-license').files[0])return toast('יש לצרף רישיון נהיגה');
  const fd=new FormData();
  fd.append('name',$('#cr-name').value);
  fd.append('vehicle',vehicle);
  fd.append('model',$('#cr-model').value);
  fd.append('areas',JSON.stringify($('#cr-areas').value.split(',').map(x=>x.trim()).filter(Boolean)));
  const avail={};document.querySelectorAll('.cr-day:checked').forEach(c=>avail[c.value]=[['08:00','20:00']]);
  fd.append('availability',JSON.stringify(avail));
  for(const k of ['license','insurance','photo']){const f=$('#cr-'+k).files[0];if(f)fd.append(k,f);}
  const r=await fetch('/api/courier/register',{method:'POST',headers:{Authorization:'Bearer '+state.token},body:fd});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||'שגיאה '+r.status);
  state.courier={id:d.courier.id,model:d.courier.model,approved:false};save();
  toast('הבקשה נשלחה לאישור');route();
 }catch(e){toast(e.message)}
}
/* ---- E6: קהילת מכבסות (B2B) ---- */
const FORUM_CATS=[['operations','תפעול'],['suppliers','ספקים'],['group_purchase','רכש משותף'],['pricing','תמחור']];
const CONTENT_CATS={article:'מאמר',guide:'מדריך',standard:'תקן',news:'חדשות'};
async function vCommunity(sub,id){
 if(!state.token)return needLogin();
 sub=sub||'forum';
 const tabs=[['forum','פורום'],['tenders','מכרזים'],['groups','רכש משותף'],['capacity','קיבולת'],['content','תוכן']];
 let body='';
 try{
 if(sub==='forum'){
  const cat=new URLSearchParams(location.hash.split('?')[1]||'').get('cat')||'';
  const d=await api('/community/forum/posts'+(cat?'?category='+cat:''));
  body=`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px"><a class="chip ${!cat?'on':''}" href="#/community/forum">הכל</a>${FORUM_CATS.map(c=>`<a class="chip ${cat===c[0]?'on':''}" href="#/community/forum?cat=${c[0]}">${c[1]}</a>`).join('')}
   <button class="btn2 on" style="margin-right:auto" onclick="forumNewPost()">+ פוסט חדש</button></div>
  ${d.posts.map(p=>`<a href="#/community/post/${p.id}" style="text-decoration:none;color:inherit"><div class="card">
    <b>${esc(p.title)}</b> <span class="tag tb">${(FORUM_CATS.find(c=>c[0]===p.category)||['',''])[1]}</span>
    <div class="mut">${esc(p.excerpt)}${p.excerpt&&p.excerpt.length>=200?'…':''}</div>
    <div class="mut">${esc(p.author_name||'')} · <b>${esc(p.tenant_name)}</b> ✓ · ${fmtDate(p.created_at)} · 👍 ${p.useful} · 💬 ${p.comments}</div></div></a>`).join('')||'<div class="card mut">אין פוסטים עדיין — היו הראשונים לשתף</div>'}`;
 } else if(sub==='post'){
  const d=await api('/community/forum/posts/'+id);
  const p=d.post;
  body=`<a href="#/community/forum" style="color:#0e7a8a">← חזרה לפורום</a>
  <div class="card"><b style="font-size:17px">${esc(p.title)}</b> <span class="tag tb">${(FORUM_CATS.find(c=>c[0]===p.category)||['',''])[1]}</span>
   <div class="mut">${esc(p.author_name||'')} · <b>${esc(p.tenant_name)}</b> ✓ · ${fmtDT(p.created_at)}</div>
   <div style="margin:10px 0;white-space:pre-wrap">${esc(p.body)}</div>
   <button class="btn2" onclick="forumUseful('${p.id}')">👍 שימושי (${p.useful})${p.voted?' ✓':''}</button></div>
  <div class="sec">תגובות (${d.comments.length})</div>
  ${d.comments.map(c=>`<div class="card"><div class="mut"><b>${esc(c.author_name||'')}</b> · ${esc(c.tenant_name)} ✓ · ${fmtDT(c.created_at)}</div><div style="white-space:pre-wrap">${esc(c.body)}</div></div>`).join('')}
  <div class="card"><input class="inp" id="fc-body" placeholder="כתבו תגובה…"><button class="btn2 on" onclick="forumComment('${p.id}')">פרסום תגובה</button></div>`;
 } else if(sub==='tenders'){
  const d=await api('/community/tenders');
  body=`<button class="btn2 on" onclick="tenderNew()">+ פרסום מכרז</button>
  ${d.tenders.map(t=>`<a href="#/community/tender/${t.id}" style="text-decoration:none;color:inherit"><div class="card">
    <b>${esc(t.title)}</b> <span class="tag ${t.status==='open'?'tg':t.status==='awarded'?'tb':'ta'}">${t.status==='open'?'פתוח':t.status==='awarded'?'נבחר זוכה':'סגור'}</span>
    <div class="mut">${esc(t.poster_name)}${t.volume_kg?' · '+t.volume_kg+' ק"ג':''}${t.frequency?' · '+esc(t.frequency):''}${t.budget?' · תקציב ₪'+t.budget:''} · הגשה עד ${fmtDT(t.deadline)} · ${t.bids} הצעות</div></div></a>`).join('')||'<div class="card mut">אין מכרזים</div>'}`;
 } else if(sub==='tender'){
  const d=await api('/community/tender/'+id);
  const t=d.tender;
  body=`<a href="#/community/tenders" style="color:#0e7a8a">← חזרה למכרזים</a>
  <div class="card"><b style="font-size:17px">${esc(t.title)}</b> <span class="tag ${t.status==='open'?'tg':'ta'}">${t.status==='open'?'פתוח':t.status==='awarded'?'נבחר זוכה':'סגור'}</span>
   <div class="mut">${esc(t.poster_name)} · הגשה עד ${fmtDT(t.deadline)}</div>
   ${t.description?`<div style="margin:8px 0;white-space:pre-wrap">${esc(t.description)}</div>`:''}
   <div class="mut">${[t.volume_kg&&'נפח '+t.volume_kg+' ק"ג',t.frequency,t.sla_text&&'SLA: '+t.sla_text,t.budget&&'תקציב ₪'+t.budget].filter(Boolean).map(esc).join(' · ')}</div></div>
  <div class="sec">הצעות (${d.bids_count})</div>
  ${d.bids.map(b=>`<div class="card"><div class="row"><div><b>₪${b.price_per_kg}</b> לק"ג ${b.is_winner?'<span class="tag tg">זוכה ✓</span>':''}
    <div class="mut">${esc(b.bidder_name)} · ${fmtDT(b.created_at)}${b.notes?' · '+esc(b.notes):''}</div></div>
    ${d.is_poster&&t.status==='open'?`<button class="btn2 green" onclick="tenderAward('${t.id}','${b.id}')">בחירה כזוכה</button>`:''}</div></div>`).join('')||'<div class="card mut">אין הצעות עדיין</div>'}
  ${!d.is_poster&&t.status==='open'?`<div class="card"><label class="lb">הגשת הצעה — מחיר לק"ג</label>
   <div style="display:flex;gap:6px"><input class="inp" id="tb-price" type="number" step="0.1" placeholder="₪" style="flex:1"><input class="inp" id="tb-notes" placeholder="הערות" style="flex:2"></div>
   <button class="btn2 on" onclick="tenderBid('${t.id}')">הגשת הצעה</button></div>`:''}`;
 } else if(sub==='groups'){
  const d=await api('/community/groups');
  body=`<button class="btn2 on" onclick="groupNew()">+ קבוצת רכש חדשה</button>
  ${d.groups.map(g=>`<div class="card"><b>${esc(g.product)}</b> ${g.status!=='open'?'<span class="tag ta">נסגר</span>':g.participants>=g.target_participants?'<span class="tag tg">היעד הושג!</span>':''}
   <div class="mut">${esc(g.creator_name)}${g.supplier?' · ספק: '+esc(g.supplier):''} · מחיר רגיל ₪${g.unit_price} → <b>מחיר קבוצה ₪${g.group_price}</b></div>
   <div class="mut">${g.participants}/${g.target_participants} משתתפים · ${g.total_qty} יח' · חיסכון משוער: <b>₪${Math.round(g.est_savings)}</b> · סגירה ${fmtDate(g.deadline)}</div>
   <div style="display:flex;gap:6px;margin-top:6px">${g.status==='open'?(g.joined?`<button class="btn2" onclick="groupLeave('${g.id}')">עזיבה</button>`:`<input class="inp" id="gq-${g.id}" type="number" value="10" style="width:80px"><button class="btn2 green" onclick="groupJoin('${g.id}')">הצטרפות</button>`):''}</div></div>`).join('')||'<div class="card mut">אין קבוצות רכש</div>'}`;
 } else if(sub==='capacity'){
  const d=await api('/community/capacity');
  body=`<button class="btn2 on" onclick="capacityNew()">+ מודעת קיבולת</button>
  ${d.posts.map(p=>`<div class="card"><b>${p.kind==='request'?'מבוקש':'מוצע'}: ${esc(p.equipment)}</b> <span class="tag ${p.status==='open'?'tg':p.status==='engaged'?'tb':'ta'}">${p.status==='open'?'פתוח':p.status==='engaged'?'בהתקשרות':'נסגר'}</span>
   <div class="mut">${esc(p.tenant_name)} (${esc(p.tenant_city||'')})${p.kg_per_day?' · '+p.kg_per_day+' ק"ג/יום':''}${p.days?' · '+p.days+' ימים':''}${p.area?' · '+esc(p.area):''}${p.price?' · ₪'+p.price:''}</div>
   ${p.notes?`<div class="mut">${esc(p.notes)}</div>`:''}
   ${(p.engagements||[]).map(e=>`<div class="mut">התקשרות עם ${esc(e.tenant)} — ${e.status==='done'?`הושלם ✓${e.payment_demo?' · תשלום דמו ₪'+e.payment_demo:''}`:'פעילה'} ${e.status==='active'?`<button class="btn2" onclick="capacityDone('${e.id}')">סימון הושלם + תשלום דמו</button>`:''}</div>`).join('')}
   ${p.status==='open'?`<button class="btn2 green" style="margin-top:6px" onclick="capacityEngage('${p.id}','${p.kind}')">${p.kind==='request'?'הצעת קיבולת':'בקשת קיבולת'}</button>`:''}</div>`).join('')||'<div class="card mut">אין מודעות קיבולת</div>'}`;
 } else if(sub==='content'){
  const d=await api('/community/content');
  body=(state.me&&state.me.role==='admin'?`<button class="btn2 on" onclick="contentNew()">+ פרסום תוכן</button>`:'')+
  `${d.articles.map(a=>`<a href="#/community/article/${a.id}" style="text-decoration:none;color:inherit"><div class="card">
    <b>${esc(a.title)}</b> <span class="tag tb">${CONTENT_CATS[a.category]||a.category}</span>
    <div class="mut">${esc(a.excerpt)}${a.excerpt&&a.excerpt.length>=200?'…':''}</div>
    <div class="mut">${esc(a.author_name||'')} · ${fmtDate(a.created_at)} · 👁 ${a.views}</div></div></a>`).join('')||'<div class="card mut">אין תוכן עדיין</div>'}`;
 } else if(sub==='article'){
  const d=await api('/community/article/'+id);
  body=`<a href="#/community/content" style="color:#0e7a8a">← חזרה לתוכן</a>
  <div class="card"><b style="font-size:17px">${esc(d.article.title)}</b> <span class="tag tb">${CONTENT_CATS[d.article.category]}</span>
   <div class="mut">${esc(d.article.author_name||'')} · ${fmtDate(d.article.created_at)} · 👁 ${d.article.views}</div>
   <div style="margin-top:10px;white-space:pre-wrap">${esc(d.article.body)}</div></div>`;
 }
 }catch(e){
  if(e.status===403)body=`<div class="card mut">הקהילה פתוחה לבעלי מכבסות מאומתים בלבד. <a href="#/join" style="color:#0e7a8a">להצטרפות כמכבסה</a></div>`;
  else throw e;
 }
 return `<div class="hdr"><h2>קהילת המכבסות</h2></div>
 <div class="body">${!['post','tender','article'].includes(sub)?`<div class="subtabs">${tabs.map(t=>`<a class="chip ${sub===t[0]?'on':''}" href="#/community/${t[0]}">${t[1]}</a>`).join('')}</div>`:''}${body}</div>`;
}
async function forumNewPost(){
 const v=await xmodal({title:'פוסט חדש',okText:'פרסום',fields:[{id:'title',label:'כותרת'},{id:'body',label:'תוכן'}]});
 if(!v)return;
 const cat=await xmodal({title:'קטגוריה',body:'כתבו: operations / suppliers / group_purchase / pricing',okText:'פרסום',fields:[{id:'cat',label:'קטגוריה',value:'suppliers'}]});
 if(!cat)return;
 try{const r=await api('/community/forum/posts',{method:'POST',body:JSON.stringify({category:cat.cat,title:v.title,body:v.body})});toast('הפוסט פורסם');go('#/community/post/'+r.post.id);route()}catch(e){toast(e.message)}
}
async function forumComment(id){try{await api('/community/forum/posts/'+id+'/comments',{method:'POST',body:JSON.stringify({body:$('#fc-body').value})});route()}catch(e){toast(e.message)}}
async function forumUseful(id){try{await api('/community/forum/posts/'+id+'/useful',{method:'POST',body:'{}'});route()}catch(e){toast(e.message)}}
async function tenderNew(){
 const v=await xmodal({title:'פרסום מכרז',okText:'פרסום',fields:[{id:'title',label:'כותרת'},{id:'volume_kg',label:'נפח ק"ג',type:'number'},{id:'frequency',label:'תדירות (שבועי/חודשי)'},{id:'budget',label:'תקציב ₪',type:'number'},{id:'days',label:'ימים להגשה',value:'7',type:'number'}]});
 if(!v)return;
 try{await api('/community/tenders',{method:'POST',body:JSON.stringify({title:v.title,volume_kg:v.volume_kg||undefined,frequency:v.frequency||undefined,budget:v.budget||undefined,deadline:new Date(Date.now()+(Number(v.days)||7)*86400e3).toISOString()})});toast('המכרז פורסם');route()}catch(e){toast(e.message)}
}
async function tenderBid(id){try{await api('/community/tenders/'+id+'/bids',{method:'POST',body:JSON.stringify({price_per_kg:$('#tb-price').value,notes:$('#tb-notes').value||undefined})});toast('ההצעה הוגשה');route()}catch(e){toast(e.message)}}
async function tenderAward(tid,bid){if(!await xconfirm('בחירת הזוכה תסגור את המכרז.',{title:'בחירת זוכה',okText:'בחירה'}))return;try{await api('/community/tenders/'+tid+'/award',{method:'POST',body:JSON.stringify({bid_id:bid})});toast('הזוכה נבחר');route()}catch(e){toast(e.message)}}
async function groupNew(){
 const v=await xmodal({title:'קבוצת רכש חדשה',okText:'פתיחה',fields:[{id:'product',label:'מוצר'},{id:'supplier',label:'ספק'},{id:'unit_price',label:'מחיר רגיל ₪',type:'number'},{id:'group_price',label:'מחיר קבוצה ₪',type:'number'},{id:'target',label:'יעד משתתפים',value:'3',type:'number'},{id:'days',label:'ימים לסגירה',value:'7',type:'number'}]});
 if(!v)return;
 try{await api('/community/groups',{method:'POST',body:JSON.stringify({product:v.product,supplier:v.supplier||undefined,unit_price:v.unit_price,group_price:v.group_price,target_participants:v.target||undefined,deadline:new Date(Date.now()+(Number(v.days)||7)*86400e3).toISOString()})});toast('הקבוצה נפתחה');route()}catch(e){toast(e.message)}
}
async function groupJoin(id){try{await api('/community/groups/'+id+'/join',{method:'POST',body:JSON.stringify({qty:$('#gq-'+id).value})});toast('הצטרפת לקבוצה');route()}catch(e){toast(e.message)}}
async function groupLeave(id){try{await api('/community/groups/'+id+'/leave',{method:'POST',body:'{}'});route()}catch(e){toast(e.message)}}
async function capacityNew(){
 const v=await xmodal({title:'מודעת קיבולת',body:'kind: request (מבוקש) / offer (מוצע)',okText:'פרסום',fields:[{id:'kind',label:'סוג',value:'request'},{id:'equipment',label:'ציוד (מכונה 18 ק"ג...)'},{id:'kg_per_day',label:'ק"ג ליום',type:'number'},{id:'days',label:'ימים',type:'number'},{id:'area',label:'אזור'},{id:'price',label:'מחיר ₪',type:'number'}]});
 if(!v)return;
 try{await api('/community/capacity',{method:'POST',body:JSON.stringify({kind:v.kind,equipment:v.equipment,kg_per_day:v.kg_per_day||undefined,days:v.days||undefined,area:v.area||undefined,price:v.price||undefined})});toast('המודעה פורסמה');route()}catch(e){toast(e.message)}
}
async function capacityEngage(id,kind){
 const v=await xmodal({title:kind==='request'?'הצעת קיבולת':'בקשת קיבולת',okText:'התקשרות',fields:[{id:'price',label:'מחיר מוסכם ₪',type:'number'}]});
 if(!v)return;
 try{await api('/community/capacity/'+id+'/engage',{method:'POST',body:JSON.stringify({agreed_price:v.price||undefined})});toast('נוצרה התקשרות');route()}catch(e){toast(e.message)}
}
async function capacityDone(eid){
 const v=await xmodal({title:'סיום התקשרות',body:'התשלום מתועד כדמו בלבד.',okText:'סיום',fields:[{id:'payment',label:'תשלום דמו ₪',type:'number'}]});
 if(!v)return;
 try{await api('/community/capacity/engagements/'+eid+'/done',{method:'POST',body:JSON.stringify({payment_demo:v.payment||undefined})});toast('ההתקשרות הושלמה');route()}catch(e){toast(e.message)}
}
async function contentNew(){
 const v=await xmodal({title:'פרסום תוכן',body:'קטגוריה: article / guide / standard / news',okText:'פרסום',fields:[{id:'category',label:'קטגוריה',value:'article'},{id:'title',label:'כותרת'},{id:'body',label:'תוכן'}]});
 if(!v)return;
 try{await api('/community/content',{method:'POST',body:JSON.stringify({category:v.category,title:v.title,body:v.body})});toast('התוכן פורסם');route()}catch(e){toast(e.message)}
}
async function vManage(sub){
 if(!state.token)return needLogin();
 const me=await api('/auth/me');
 state.memberships=me.memberships||[];save();
 const mems=me.memberships||[];
 const m=mems.find(x=>x.slug===store.get('lastTenant',''))||mems[0];
 const slug=m&&m.slug;
 if(!slug)return `<div class="hdr"><h2>לוח ניהול מכבסה</h2></div><div class="body"><div class="card mut">${me.courier?'החשבון שלך רשום כשליח — לוח הניהול מיועד לבעלי מכבסות. המשימות שלך בלשונית ״שליח״.':`החשבון אינו מקושר למכבסה. <a href="#/join" style="color:#0e7a8a">להצטרפות כמכבסה</a>`}</div></div>`;
 sub=sub||'orders';
 const tabs=[['orders','הזמנות'],['items','מחירון'],['windows','חלונות'],['coupons','קופונים'],['subs','מנויים'],['biz','עסקיים'],['documents','מסמכים'],['issues','תקלות'],['couriers','שליחים'],['customers','לקוחות'],['stats','דוחות'],['settings','הגדרות']];
 let body='';
 if(sub==='orders'){
  const d=await api(`/t/${slug}/orders`);
  const NEXT={new:'confirmed',confirmed:'picked_up',picked_up:'in_work',in_work:'ready',ready:'out_for_delivery',out_for_delivery:'delivered'};
  body=d.orders.map(o=>`<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
     <div><b dir="ltr">#${o.id.slice(0,8)}</b> ${esc(o.customer_name||'')} <span class="st-pill st-${o.status}">${HE[o.status]}</span>
      <div class="mut">${fmtDT(o.created_at)} · ₪${o.total} · ${esc(o.address)}${o.source==='bot'?' · מהבוט':''}</div>
      ${o.items&&o.items.length?`<div class="mut">${o.items.slice(0,3).map(i=>esc(i.name)+' ×'+fmtQ(i.qty)).join(', ')}${o.items.length>3?' +'+(o.items.length-3):''}</div>`:''}
      ${o.pickup_at?`<div class="mut">איסוף: ${fmtDT(o.pickup_at)}</div>`:''}${o.delivery_at?`<div class="mut">החזרה: ${fmtDT(o.delivery_at)}</div>`:''}
      ${o.payment_method==='cash'&&o.payment_status==='pending'?'<div class="mut">💵 גבייה במזומן</div>':''}
     </div>
     <div style="display:flex;gap:6px">
      ${NEXT[o.status]?`<button class="btn2 on" onclick="setStatus('${slug}','${o.id}','${NEXT[o.status]}')">העבר ל״${HE[NEXT[o.status]]}״</button>`:''}
      ${!['delivered','cancelled'].includes(o.status)?`<button class="btn2" onclick="setStatus('${slug}','${o.id}','cancelled')">ביטול</button>`:''}
      ${['new','confirmed','ready'].includes(o.status)?(o.courier_id?'<span class="tag tg">שובץ שליח</span>':o.has_open_offer?'<span class="tag tb">ממתין לאישור שליח</span>':`<button class="btn2" onclick="assignCourier('${slug}','${o.id}',this)">שיבוץ שליח</button>`):''}
     </div>
    </div></div>`).join('')||'<div class="card mut">אין הזמנות</div>';
 } else if(sub==='issues'){
  // E9.T1: פניות תקלות מלקוחות — טיפול מול המכבסה + הסלמה לגישור אדמין
  const d=await api(`/t/${slug}/issues`);
  const KIND={damage:'נזק',missing:'חסר',late:'איחור',other:'אחר'};
  const STI={open:'פתוח',in_progress:'בטיפול',resolved:'טופל'};
  body=d.issues.map(i=>`<div class="card">
   <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:6px">
    <div><b>${KIND[i.kind]||i.kind}</b> <span class="st-pill ${i.status==='resolved'?'st-delivered':'st-new'}">${STI[i.status]||i.status}</span>${i.mediation?' <span class="tag ta">בגישור אדמין</span>':''}
     <div>${esc(i.text)}</div>
     <div class="mut">${esc(i.customer_name||'')} · הזמנה <span dir="ltr">#${(i.order_id||'').slice(0,8)}</span> · ${esc(i.order_address||'')} · ${fmtDT(i.created_at)}</div>
     ${i.resolution_note?`<div class="mut">תיעוד: ${esc(i.resolution_note)}</div>`:''}
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
     ${(i.photo_ids||[]).map(pid=>`<button class="btn2" onclick="openIssuePhoto('${pid}')">📷</button>`).join('')}
     ${i.status!=='resolved'?`<button class="btn2 on" onclick="tenantIssueHandle('${slug}','${i.id}')">עדכון טיפול</button>`:''}
    </div>
   </div></div>`).join('')||'<div class="card mut">אין פניות תקלות ✓</div>';
 } else if(sub==='items'){
  const d=await api(`/t/${slug}/items`);
  body=`<div class="card">
    <label class="lb">פריט חדש</label>
    <input class="inp" id="it-name" placeholder="שם הפריט">
    <div style="display:flex;gap:8px"><input class="inp" id="it-price" type="number" placeholder="מחיר ₪" style="flex:1">
    <select class="inp" id="it-unit" style="flex:1"><option value="item">ליחידה</option><option value="kg">לק״ג</option><option value="bag">לשק</option></select>
    <select class="inp" id="it-cat" style="flex:1"><option>כביסה</option><option>ניקוי יבש</option><option>גיהוץ</option><option>שטיחים</option><option>אחר</option></select></div>
    <button class="btn2 on" onclick="addItem('${slug}')">הוספה</button></div>
   <div class="card">${d.items.map(i=>`<div class="row"><div style="${i.active?'':'opacity:.4'}">${esc(i.name)}<div class="mut">${esc(i.category)} · ${i.unit==='item'?'ליחידה':'ל'+unitLbl(i.unit)}</div></div>
    <div>₪${i.price} <button class="btn2" ${i.subscription_eligible?'style="border-color:#0e7a8a;color:#0e7a8a"':''} title="פריט מכוסה במנוי" onclick="toggleItemSub('${slug}','${i.id}',${!i.subscription_eligible})">${i.subscription_eligible?'✓ במנוי':'למנוי'}</button> <button class="btn2" onclick="editItem('${slug}','${i.id}',this)" data-name="${esc(i.name)}" data-price="${i.price}">עריכה</button> <button class="btn2" onclick="delItem('${slug}','${i.id}')">${i.active?'הסתרה':'החזרה'}</button></div></div>`).join('')}</div>`;
 } else if(sub==='windows'){
  const d=await api(`/t/${slug}/windows`);
  body=`<div class="card">
    <label class="lb">חלון חדש</label>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
     <select class="inp" id="w-day" style="flex:1">${WD.map((d,i)=>`<option value="${i}">${d}</option>`).join('')}</select>
     <input class="inp" id="w-start" type="time" style="flex:1"><input class="inp" id="w-end" type="time" style="flex:1">
     <select class="inp" id="w-kind" style="flex:1"><option value="pickup">איסוף</option><option value="delivery">החזרה</option></select>
    </div>
    <button class="btn2 on" onclick="addWindow('${slug}')">הוספה</button></div>
   <div class="card">${d.windows.map(w=>`<div class="row"><div>${WD[w.weekday]} ${w.start_time.slice(0,5)}–${w.end_time.slice(0,5)}<div class="mut">${w.kind==='pickup'?'איסוף':'החזרה'} · קיבולת ${w.capacity}</div></div><button class="btn2" onclick="delWindow('${slug}','${w.id}')">מחיקה</button></div>`).join('')}</div>`;
 } else if(sub==='coupons'){
  const d=await api(`/t/${slug}/coupons`);
  body=`<div class="card">
    <label class="lb">קופון חדש</label>
    <div style="display:flex;gap:8px"><input class="inp" id="cp-code" placeholder="קוד (למשל SAVE10)" style="flex:2">
    <select class="inp" id="cp-kind" style="flex:1"><option value="percent">אחוז %</option><option value="amount">סכום ₪</option></select>
    <input class="inp" id="cp-value" type="number" placeholder="ערך" style="flex:1"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
     <input class="inp" id="cp-min" type="number" placeholder="מינימום הזמנה ₪" style="flex:1">
     <input class="inp" id="cp-usage" type="number" placeholder="מגבלת שימושים" style="flex:1">
     <input class="inp" id="cp-peruser" type="number" placeholder="מגבלה ללקוח" style="flex:1">
     <input class="inp" id="cp-exp" type="date" style="flex:1">
    </div>
    <button class="btn2 on" onclick="addCoupon('${slug}')">יצירת קופון</button></div>
   <div class="card">${d.coupons.map(c=>`<div class="row"><div style="${c.active?'':'opacity:.4'}"><b dir="ltr">${esc(c.code)}</b> — ${c.kind==='percent'?c.value+'%':'₪'+c.value}
    <div class="mut">${c.min_order>0?'מינימום ₪'+c.min_order+' · ':''}${c.usage_limit?'עד '+c.usage_limit+' שימושים · ':''}${c.per_user_limit?c.per_user_limit+' ללקוח · ':''}${c.expires_at?'בתוקף עד '+new Date(c.expires_at).toLocaleDateString('he-IL')+' · ':''}מומש ${c.used_count||0}</div></div>
    <button class="btn2" onclick="toggleCoupon('${slug}','${c.id}',${!c.active})">${c.active?'השבתה':'הפעלה'}</button></div>`).join('')||'<div class="mut">אין קופונים עדיין</div>'}</div>`;
 } else if(sub==='subs'){
  const d=await api(`/t/${slug}/plans`);
  const sb=await api(`/t/${slug}/subscriptions`);
  const act=sb.subscriptions.filter(x=>x.status==='active');
  const mrr=act.reduce((sm,x)=>sm+Number(x.plan_price),0);
  body=`<div class="kpis"><div class="kpi"><b>${act.length}</b>מנויים פעילים</div><div class="kpi"><b>₪${mrr}</b>הכנסה חוזרת חודשית</div></div>
  <div class="card"><label class="lb">תוכנית מנוי חדשה</label>
   <input class="inp" id="pl-name" placeholder="שם התוכנית (למשל מנוי משפחתי)">
   <div style="display:flex;gap:8px;flex-wrap:wrap">
    <input class="inp" id="pl-bags" type="number" placeholder="שקים בחודש" style="flex:1" min="1">
    <input class="inp" id="pl-kg" type="number" placeholder="ק״ג לשק" style="flex:1" min="1">
    <input class="inp" id="pl-price" type="number" placeholder="מחיר ₪/חודש" style="flex:1" min="0">
    <input class="inp" id="pl-extra" type="number" placeholder="שק חורג ₪ (רשות)" style="flex:1" min="0">
   </div>
   <input class="inp" id="pl-perks" placeholder="הטבות (טקסט חופשי, רשות)">
   <button class="btn2 on" onclick="addPlan('${slug}')">יצירת תוכנית</button></div>
  <div class="sec">תוכניות (${d.plans.length})</div>
  <div class="card">${d.plans.map(p=>`<div class="row"><div style="${p.active?'':'opacity:.4'}"><b>${esc(p.name)}</b> — ₪${p.price}/חודש
    <div class="mut">${p.bags_per_month} שקים · ${fmtQ(p.kg_per_bag)} ק״ג לשק${p.extra_bag_price?' · שק חורג ₪'+p.extra_bag_price:''}${p.perks?' · '+esc(p.perks):''} · ${p.active_subs} מנויים פעילים</div></div>
    <button class="btn2" onclick="togglePlan('${slug}','${p.id}',${!p.active})">${p.active?'השבתה':'הפעלה'}</button></div>`).join('')||'<div class="mut">אין תוכניות מנוי עדיין</div>'}</div>
  <div class="sec">מנויים (${sb.subscriptions.length})</div>
  <div class="card">${sb.subscriptions.map(x=>`<div class="row"><div><b>${esc(x.customer_name||'')}</b> · ${esc(x.plan_name)} ${x.status==='paused'?'<span class="tag tb">מושהה</span>':''}
    <div class="mut">${esc(x.customer_phone||'')} · נוצלו ${fmtQ(x.bags_used)}/${x.bags_per_month} שקים החודש · מתחדש ${fmtDate(x.period_end)}</div></div><div>₪${x.plan_price}</div></div>`).join('')||'<div class="mut">אין מנויים עדיין — שתפו עם הלקוחות את דף המכבסה</div>'}</div>`;
 } else if(sub==='biz'){
  body=await vManageBiz(slug);
 } else if(sub==='documents'){
  const d=await api(`/t/${slug}/documents`);
  const ST_HE={issued:'הופק',partially_credited:'זוכה חלקית',credited:'זוכה'};
  const consBtn=`<button class="btn2 on" style="margin-bottom:10px" onclick="consolidatedModal('${slug}')">🧾 הפק חשבונית מרכזת</button>`;
  body=consBtn+(d.documents.length?`<div class="card docs-list">${d.documents.map(dc=>`<div class="row"><div>
    <b>${dc.kind_he} ${dc.doc_number}/${dc.doc_year}</b> <span class="st-pill ${dc.status==='credited'?'st-cancelled':'st-delivered'}">${ST_HE[dc.status]||dc.status}</span>
    <div class="mut">${fmtDT(dc.issued_at)} · ${esc(dc.customer_name||'לקוח')} · ₪${dc.total}${dc.orders_count?' · מכסה '+dc.orders_count+' הזמנות':''}${Number(dc.credited_amount)>0?' · זוכה ₪'+dc.credited_amount:''}${dc.allocation_number?' · הקצאה '+dc.allocation_number:''}</div></div>
    <div class="docs-actions">
     <button class="btn2" onclick="openPdf('/t/${slug}/documents/${dc.id}/pdf')">מקור</button>
     <button class="btn2" onclick="openPdf('/t/${slug}/documents/${dc.id}/pdf?copy=1')">העתק</button>
     ${dc.kind!=='credit'&&dc.status!=='credited'?`<button class="btn2" style="border-color:#f3c2c2;color:#c22" onclick="creditDoc('${slug}','${dc.id}',${dc.total},${dc.credited_amount})">זיכוי</button>`:''}
    </div></div>`).join('')}</div>`
   :'<div class="card mut">אין מסמכים עדיין — בהתאם להגדרות, מסמכים מונפקים אוטומטית בסיום הזמנה או מרוכזים ידנית בחשבונית מרכזת.</div>');
 } else if(sub==='couriers'){
  const d=await api(`/t/${slug}/couriers/overview`);
  const est=d.estimate;
  body=`<div class="card"><b>עלות משוערת לשיבוץ</b><div class="mut">₪${est.rate_per_stop} לנקודה × ${est.stops_per_order} נקודות (איסוף+מסירה) = <b>₪${est.per_order}</b> להזמנה · עמלת הפלטפורמה ${est.platform_commission_pct}% מחושבת לשליח, לא למכבסה</div></div>
  ${d.today.length?`<div class="sec">שיבוץ פעיל (${d.today.length})</div>`+d.today.map(o=>`<div class="card"><b>${esc(o.courier_name)}</b> ← הזמנה <span dir="ltr">#${o.id.slice(0,8)}</span> <span class="st-pill st-${o.status}">${HE[o.status]}</span>
    <div class="mut">${esc(o.customer_name||'')} · ${esc(o.address)}${o.pickup_at?' · איסוף '+fmtDT(o.pickup_at):''}</div></div>`).join(''):''}
  <div class="sec">שליחים (${d.couriers.length})</div>
  ${d.couriers.map(c=>{const onPct=c.pickups_30d?Math.round(100*c.ontime_30d/c.pickups_30d):null;return `<div class="card"><div class="row"><div><b>${esc(c.name)}</b> <span class="tag tb">${c.model==='platform'?'פלטפורמה':c.model==='shared'?'משותף':'פרטי'}</span>
    <div class="mut">${esc(c.phone||'')} · ${esc(c.vehicle||'')}${c.areas&&c.areas.length?' · '+(c.areas||[]).map(esc).join(', '):''}</div>
    <div class="mut">30 יום: ${c.delivered_30d} מסירות${onPct!==null?` · ${onPct}% איסוף בזמן (${c.ontime_30d}/${c.pickups_30d})`:''} · ★${c.rating||'—'}${c.rating_count?' ('+c.rating_count+')':''} · ${c.active_orders} פעילות</div></div>
    <button class="btn2" onclick="tenantRateCourier('${slug}','${c.id}','${esc(c.name)}')">דירוג</button></div></div>`}).join('')||'<div class="card mut">אין שליחים זמינים</div>'}
  ${d.clusters&&d.clusters.length?`<div class="card"><div class="sec">קלאסטרים אזוריים (מסלולים משותפים קבועים)</div>
   ${d.clusters.map(cl=>`<div class="row"><div><b>${esc(cl.name)}</b> · ${esc(cl.area)}<div class="mut">${cl.members} מכבסות · דמי ניהול חודשיים (דמו): ₪${cl.mgmt_fee_monthly}${cl.fixed_routes&&cl.fixed_routes.length?' · מסלול קבוע: '+cl.fixed_routes.map(f=>WD[f.weekday]+' — '+esc(f.courier)).join(', '):''}</div></div>
    <button class="btn2 ${cl.joined?'':'green'}" onclick="tenantCluster('${slug}','${cl.id}','${cl.joined?'leave':'join'}')">${cl.joined?'עזיבה':'הצטרפות'}</button></div>`).join('')}</div>`:''}
  ${d.payments.length?`<div class="card"><div class="sec">היסטוריית תשלומים לשליחים (דרך הפלטפורמה)</div><table class="tbl"><tr><th>שבוע</th><th>נקודות</th><th>ברוטו</th><th>עמלת פלטפורמה</th><th>סטטוס</th></tr>
   ${d.payments.map(x=>`<tr><td>${fmtDate(x.week_start)}</td><td>${x.stops}</td><td>₪${x.gross}</td><td>₪${x.commission}</td><td>${x.statuses.includes('paid_demo')?'שולם (דמו)':x.statuses.includes('disputed')?'במחלוקת':'נצבר'}</td></tr>`).join('')}</table></div>`:''}`;
 } else if(sub==='customers'){
  const d=await api(`/t/${slug}/customers`);
  body=`<div class="card"><table class="tbl"><tr><th>לקוח</th><th>הזמנות</th><th>₪</th><th>נקודות</th></tr>
   ${d.customers.map(c=>`<tr><td>${esc(c.name||'') }<div class="mut">${esc(c.phone||'')}</div></td><td>${c.orders}</td><td>${c.spent}</td><td>${c.points}</td></tr>`).join('')}</table></div>`;
 } else if(sub==='stats'){
  const d=await api(`/t/${slug}/reports`);
  const maxRev=Math.max(1,...d.weekly.map(w=>Number(w.revenue)));
  const CH={app:'אפליקציה',bot:'בוט וואטסאפ'};
  body=`<div class="kpis">
    <div class="kpi"><b>₪${d.totals.revenue}</b>מחזור</div>
    <div class="kpi"><b>${d.totals.orders}</b>הזמנות</div>
    <div class="kpi"><b>₪${d.totals.avg_order}</b>ממוצע</div>
    <div class="kpi"><b>${d.customers.returning}/${d.customers.customers}</b>חוזרים</div>
    ${d.subscriptions?`<div class="kpi"><b>${d.subscriptions.active}</b>מנויים פעילים</div>
    <div class="kpi"><b>₪${d.subscriptions.mrr}</b>הכנסה חוזרת</div>`:''}</div>
   <div class="card"><b>הכנסות שבועיות (8 שבועות)</b>
    ${d.weekly.length?`<div style="display:flex;align-items:flex-end;gap:6px;height:110px;margin-top:12px;direction:ltr">${d.weekly.map(w=>`<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%"><div class="mut" style="font-size:10px">₪${Math.round(w.revenue)}</div><div style="width:70%;background:linear-gradient(180deg,#12869b,#0a4f5c);border-radius:6px 6px 0 0;height:${Math.max(4,Math.round(Number(w.revenue)/maxRev*82))}%"></div><div class="mut" style="font-size:10px;margin-top:3px">${new Date(w.week).toLocaleDateString('he-IL',{day:'numeric',month:'numeric',timeZone:'Asia/Jerusalem'})}</div></div>`).join('')}</div>`:'<div class="mut" style="margin-top:8px">אין עדיין נתונים לגרף</div>'}
   </div>
   <div class="card"><b>פילוח ערוצים</b>
    ${d.channels.map(c=>{const pct=d.totals.orders?Math.round(c.orders/d.totals.orders*100):0;return `<div style="margin-top:8px"><div class="row" style="border:none;padding:0"><div>${CH[c.source]||c.source}</div><div class="mut">${c.orders} הזמנות · ₪${c.revenue} · ${pct}%</div></div><div class="bar-wrap"><div class="bar-fill" style="width:${pct}%"></div></div></div>`}).join('')||'<div class="mut">אין נתונים</div>'}
   </div>
   ${d.commission?`<div class="card"><b>עמלה משוערת לפי מקור לקוח</b>
    <div class="row"><div>לקוחות שלך (מהדף הממותג)</div><div>${d.commission.own.orders} הזמנות · ₪${d.commission.own.revenue} · עמלה ${d.commission.own.commission_pct}% ≈ ₪${d.commission.own.commission_est}</div></div>
    <div class="row"><div>לקוחות מרקטפלייס</div><div>${d.commission.marketplace.orders} הזמנות · ₪${d.commission.marketplace.revenue} · עמלה ${d.commission.marketplace.commission_pct}% ≈ ₪${d.commission.marketplace.commission_est}</div></div></div>`:''}
   <div class="card"><b>פריטים מובילים</b>${d.topItems.map(t=>`<div class="row"><div>${esc(t.name)}</div><div>${t.qty} · ₪${t.revenue}</div></div>`).join('')||'<div class="mut">אין נתונים</div>'}</div>
   <div class="card"><b>ייצוא (Excel)</b>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
     <button class="btn2" onclick="downloadCsv('/t/${slug}/export/orders.csv','orders.csv')">הזמנות CSV</button>
     <button class="btn2" onclick="downloadCsv('/t/${slug}/export/customers.csv','customers.csv')">לקוחות CSV</button>
     <button class="btn2" onclick="downloadCsv('/t/${slug}/export/courier-payments.csv','courier-payments.csv')">תשלומי שליחים CSV</button>
    </div></div>`;
 } else if(sub==='settings'){
  const d=await api('/laundries/'+slug);
  const l=d.laundry;
  try{const td=await api(`/t/${slug}/settings`);if(td.tenant){l.dealer_type=td.tenant.dealer_type;l.dealer_id=td.tenant.dealer_id;l.invoice_mode=td.tenant.invoice_mode||'per_order'}}catch(e){}
  body=`<div class="card">
   <label class="lb">שם</label><input class="inp" id="s-name" value="${esc(l.name)}">
   <label class="lb">טלפון</label><input class="inp" id="s-phone" value="${esc(l.phone||'')}">
   <label class="lb">כתובת</label><input class="inp" id="s-address" value="${esc(l.address||'')}">
   <label class="lb">עיר</label><input class="inp" id="s-city" value="${esc(l.city||'')}">
   <label class="lb">דמי שליחות ₪</label><input class="inp" id="s-fee" type="number" value="${l.delivery_fee||0}">
   <label class="lb">מינימום הזמנה ₪</label><input class="inp" id="s-min" type="number" value="${l.min_order||0}">
   <label style="font-size:13px;display:block;margin:8px 0"><input type="checkbox" id="s-open" ${l.is_open?'checked':''}> המכבסה פתוחה להזמנות</label>
   <div style="border-top:1px solid #e3edf0;margin-top:10px;padding-top:8px"><b>חשבוניות (דמו)</b>
   <div class="mut" style="margin:4px 0">המסמכים מסומנים ״מסמך דמו״ עד לרישום התוכנה ברשות המסים. בלי סוג עוסק לא יונפקו מסמכים.</div>
   <label class="lb">סוג עוסק</label><select class="inp" id="s-dealer-type"><option value="">לא הוגדר — לא יונפקו מסמכים</option><option value="patur" ${l.dealer_type==='patur'?'selected':''}>עוסק פטור — מונפקת קבלה</option><option value="morasha" ${l.dealer_type==='morasha'?'selected':''}>עוסק מורשה — חשבונית עסקה + קבלה</option></select>
   <label class="lb">אופן הפקת מסמכים</label><select class="inp" id="s-invoice-mode"><option value="per_order" ${l.invoice_mode!=='consolidated'?'selected':''}>מסמך לכל הזמנה — אוטומטי בסיום הזמנה</option><option value="consolidated" ${l.invoice_mode==='consolidated'?'selected':''}>חשבונית מרכזת — הפקה ידנית מרוכזת בלשונית מסמכים</option></select>
   <label class="lb">ח.פ/ע.מ (9 ספרות)</label><input class="inp" id="s-dealer-id" value="${esc(l.dealer_id||'')}" maxlength="9" inputmode="numeric" placeholder="למשל 512345678">
   </div>
   <div style="border-top:1px solid #e3edf0;margin-top:10px;padding-top:8px"><b>מיתוג הדף העסקי (White Label)</b>
   <div class="mut" style="margin:4px 0">הדף הממותג: <a href="/b/${slug}" target="_blank" style="color:#0e7a8a" dir="ltr">/b/${slug}</a> · <a href="/api/laundries/${slug}/card" target="_blank" style="color:#0e7a8a">כרטיס QR להדפסה</a></div>
   <label class="lb">צבע מותג</label><input class="inp" id="s-color" type="color" value="${l.color||'#0e7a8a'}" style="height:44px;padding:4px">
   <label class="lb">סלוגן</label><input class="inp" id="s-slogan" value="${esc(l.slogan||'')}">
   <label class="lb">וואטסאפ עסקי</label><input class="inp" id="s-wa" value="${esc(l.whatsapp||'')}" dir="ltr">
   <label class="lb">לוגו (PNG/JPG/WebP עד 2MB)</label>
   ${l.has_logo?`<div style="margin-bottom:6px"><img src="/api/laundries/${slug}/logo" style="height:48px;border:1px solid #e2eaee;border-radius:8px;padding:4px;background:#fff"> <button class="btn2" onclick="delLogo('${slug}')">הסרת לוגו</button></div>`:''}
   <input class="inp" id="s-logo" type="file" accept="image/png,image/jpeg,image/webp">
   <button class="btn2 on" onclick="uploadLogo('${slug}')">העלאת לוגו</button></div>
   <label class="lb">תקנון</label><textarea class="inp" id="s-terms" rows="3">${esc(l.terms||'')}</textarea>
   <button class="btn" onclick="saveSettings('${slug}')">שמירה</button></div>`;
 }
 store.set('lastTenant',slug);
 const switcher=mems.length>1?`<select class="sel" style="margin-top:8px" onchange="store.set('lastTenant',this.value);route()">${mems.map(x=>`<option value="${x.slug}" ${x.slug===slug?'selected':''}>${esc(x.name)}</option>`).join('')}</select>`:'';
 return `<div class="hdr"><h2>לוח ניהול — ${esc(m.name)}</h2>${switcher}<a href="javascript:logout()" style="color:#fff;font-size:12px;opacity:.85">התנתקות</a></div>
 <div class="body"><div class="subtabs">${tabs.map(t=>`<a class="chip ${sub===t[0]?'on':''}" href="#/manage/${t[0]}">${t[1]}</a>`).join('')}</div>${body}</div>`;
}
async function joinPlan(slug,planId){
 if(!state.token)return go('#/login');
 if(!await xconfirm('ההצטרפות כוללת תשלום דמו (ללא סליקה אמיתית). המנוי מתחדש אוטומטית כל חודש עד לביטול.',{title:'הצטרפות למנוי חודשי',okText:'מאשר, הצטרפו'}))return;
 try{await api('/subscriptions/join',{method:'POST',body:JSON.stringify({slug,plan_id:planId})});toast('ברוך הבא! המנוי פעיל');route()}catch(e){toast(e.message)}
}
async function subAct(id,a){try{await api('/subscriptions/'+id+'/'+a,{method:'POST',body:'{}'});toast(a==='pause'?'המנוי הושהה':'המנוי חודש');route()}catch(e){toast(e.message)}}
async function subCancel(id){if(!await xconfirm('המנוי יבוטל והחידוש האוטומטי יופסק. שקים שלא נוצלו לא יועברו.',{title:'ביטול מנוי',okText:'כן, לבטל את המנוי'}))return;try{await api('/subscriptions/'+id+'/cancel',{method:'POST',body:'{}'});toast('המנוי בוטל');route()}catch(e){toast(e.message)}}
async function subUpgrade(id,slug){
 try{
  const d=await api('/subscriptions/plans/'+slug);
  if(!d.plans.length)return toast('אין תוכניות זמינות');
  const p=await new Promise(resolve=>{
   const ov=document.createElement('div');ov.className='modal-ov';
   ov.innerHTML=`<div class="modal" role="dialog" aria-modal="true"><b>שינוי תוכנית</b><div class="mut" style="margin:8px 0">בחרו תוכנית חדשה:</div>${d.plans.map((p,i)=>`<button class="btn2" style="display:block;width:100%;margin:6px 0;text-align:right" data-i="${i}"><b>${esc(p.name)}</b> · ${p.bags_per_month} שקים · ₪${p.price}/חודש</button>`).join('')}<button class="btn2" id="pl-cancel" style="width:100%;margin-top:8px">ביטול</button></div>`;
   document.body.appendChild(ov);
   const done=v=>{ov.remove();resolve(v)};
   ov.querySelectorAll('[data-i]').forEach(b=>b.onclick=()=>done(d.plans[Number(b.dataset.i)]));
   ov.querySelector('#pl-cancel').onclick=()=>done(null);
   ov.onclick=e=>{if(e.target===ov)done(null)};
  });
  if(!p)return;
  await api('/subscriptions/'+id+'/upgrade',{method:'POST',body:JSON.stringify({plan_id:p.id})});
  toast('התוכנית עודכנה');route();
 }catch(e){toast(e.message)}
}
async function subUsage(id){
 try{
  const d=await api('/subscriptions/'+id+'/usage');
  await xmodal({title:'היסטוריית ניצול',okText:'סגור',cancelText:'סגור',body:d.usage.map(u=>`${fmtDT(u.created_at)} — ${Number(u.bags)>0?'ניצול '+fmtQ(u.bags)+' שקים':Number(u.bags)<0?'החזר '+fmtQ(-Number(u.bags))+' שקים':esc(u.note||'')}`).join('<br>')||'אין תנועות'});
 }catch(e){toast(e.message)}
}
async function uploadLogo(slug){
 const f=$('#s-logo').files[0];if(!f)return toast('בחרו קובץ תמונה');
 const fd=new FormData();fd.append('logo',f);
 try{
  const r=await fetch('/api/t/'+slug+'/logo',{method:'POST',headers:{authorization:'Bearer '+state.token},body:fd});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)return toast(j.error||'ההעלאה נכשלה');
  toast('הלוגו עודכן');route();
 }catch(e){toast(e.message)}
}
async function delLogo(slug){try{await api(`/t/${slug}/logo`,{method:'DELETE'});toast('הלוגו הוסר');route()}catch(e){toast(e.message)}}
async function addPlan(slug){try{await api(`/t/${slug}/plans`,{method:'POST',body:JSON.stringify({name:$('#pl-name').value,bags_per_month:$('#pl-bags').value,kg_per_bag:$('#pl-kg').value||8,price:$('#pl-price').value,extra_bag_price:$('#pl-extra').value,perks:$('#pl-perks').value})});toast('התוכנית נוצרה');route()}catch(e){toast(e.message)}}
async function togglePlan(slug,id,active){try{await api(`/t/${slug}/plans/${id}`,{method:'PATCH',body:JSON.stringify({active})});route()}catch(e){toast(e.message)}}
async function toggleItemSub(slug,id,on){try{await api(`/t/${slug}/items/${id}`,{method:'PATCH',body:JSON.stringify({subscription_eligible:on})});route()}catch(e){toast(e.message)}}
async function setStatus(slug,id,st){if(st==='cancelled'&&!await xconfirm('הלקוח יקבל עדכון על הביטול.',{title:'ביטול הזמנה',okText:'כן, לבטל'}))return;try{await api(`/t/${slug}/orders/${id}/status`,{method:'POST',body:JSON.stringify({status:st})});route()}catch(e){toast(e.message)}}
async function assignCourier(slug,oid,el){
 try{
  const d=await api(`/t/${slug}/couriers/overview`);
  if(!d.couriers.length)return toast('אין שליחים זמינים');
  const card=el.closest('.card');
  const old=card.querySelector('.assignbox');if(old)old.remove();
  const box=document.createElement('div');box.className='assignbox';box.style.cssText='margin-top:8px;display:flex;gap:6px';
  box.innerHTML=`<div class="mut" style="margin-bottom:4px">עלות משוערת: ₪${(d.estimate&&d.estimate.per_order)||''} (${(d.estimate&&d.estimate.stops_per_order)||2} נקודות × ₪${(d.estimate&&d.estimate.rate_per_stop)||''})</div>
   <select class="inp" id="as-${oid}" style="flex:1">${d.couriers.map(c=>`<option value="${c.id}">${esc(c.name)} · ${c.model==='platform'?'פלטפורמה':c.model==='shared'?'משותף':'פרטי'} · ${c.active_orders} פעילות</option>`).join('')}</select>
   <button class="btn2 on" onclick="doAssign('${slug}','${oid}',this)">שליחת הצעה</button>`;
  card.appendChild(box);
 }catch(e){toast(e.message)}
}
async function doAssign(slug,oid,btn){
 btn.disabled=true;btn.textContent='שולח…';
 try{
  const cid=document.getElementById('as-'+oid).value;
  const r=await api(`/t/${slug}/orders/${oid}/assign`,{method:'POST',body:JSON.stringify({courier_id:cid})});
  toast(r.mode==='assigned'?'שובץ שליח מכבסה':'הצעה נשלחה לשליח');route();
 }catch(e){btn.disabled=false;btn.textContent='שליחת הצעה';toast(e.message)}
}
/* E4.T4: מסך חשבון עסקי (מוקאפ 7) — מצטבר חודשי, הזמנה חוזרת, מחירון הסכמי, חשבונית מרוכזת, הזמנה חדשה */
let bizSel=null;
async function vManageBiz(slug){
 const d=await api(`/t/${slug}/business-accounts`);
 const items=(await api(`/t/${slug}/items`)).items.filter(i=>i.active);
 const acc=d.accounts.find(a=>a.id===bizSel)||d.accounts[0];
 bizSel=acc?acc.id:null;
 let html=`<div class="card"><label class="lb">חשבון עסקי חדש</label>
  <input class="inp" id="bz-name" placeholder="שם החברה">
  <div style="display:flex;gap:8px;flex-wrap:wrap">
   <input class="inp" id="bz-comp" placeholder="ח״פ" style="flex:1;min-width:100px">
   <input class="inp" id="bz-contact" placeholder="איש קשר" style="flex:1;min-width:100px">
   <input class="inp" id="bz-phone" placeholder="טלפון איש קשר" style="flex:1;min-width:110px">
  </div>
  <button class="btn2 on" onclick="bizCreate('${slug}')">יצירת חשבון</button></div>`;
 html+=`<div class="card">${d.accounts.map(a=>`<div class="row"><div style="${a.active?'':'opacity:.4'}"><b>${esc(a.name)}</b>${a.active?'':' (מושבת)'}
   <div class="mut">${a.company_id?'ח״פ '+esc(a.company_id)+' · ':''}${a.users_count} משתמשים · ${a.prices_count} מחירים הסכמיים · ${a.payment_terms==='net30'?'שוטף+30':esc(a.payment_terms)}</div></div>
   <button class="btn2 ${bizSel===a.id?'on':''}" onclick="bizPick('${a.id}')">${bizSel===a.id?'נבחר':'ניהול'}</button></div>`).join('')||'<div class="mut">אין חשבונות עסקיים עדיין</div>'}</div>`;
 if(!acc)return html;
 const det=await api(`/t/${slug}/business-accounts/${acc.id}`);
 const sum=(await api(`/t/${slug}/business-accounts/${acc.id}/summary`)).summary;
 const rec=(await api(`/t/${slug}/business-accounts/${acc.id}/recurring`)).templates;
 const inv=(await api(`/t/${slug}/business-accounts/${acc.id}/invoices`)).invoices;
 html+=`<div class="kpis"><div class="kpi"><b>${sum.orders_count}</b>הזמנות החודש</div><div class="kpi"><b>₪${sum.month_total}</b>מצטבר חודשי</div></div>`;
 // הזמנה חדשה מהמחירון ההסכמי
 html+=`<div class="card"><label class="lb">הזמנה חדשה מהמחירון ההסכמי</label>
  <div style="display:flex;gap:8px;flex-wrap:wrap">
   <select class="inp" id="bz-ouser" style="flex:1;min-width:130px">${det.users.map(u=>`<option value="${u.id}">${esc(u.name||u.phone)}</option>`).join('')||'<option value="">— שייכו משתמש קודם —</option>'}</select>
   <select class="inp" id="bz-oitem" style="flex:1;min-width:130px">${items.map(i=>{const o=det.prices.find(p=>p.item_id===i.id);return `<option value="${i.id}">${esc(i.name)} · ₪${o?o.price:i.price}</option>`}).join('')}</select>
   <input class="inp" id="bz-oqty" type="number" value="1" min="1" style="width:70px">
  </div>
  <input class="inp" id="bz-oaddr" placeholder="כתובת איסוף">
  <button class="btn2 on" onclick="bizOrder('${slug}','${acc.id}')">יצירת הזמנה</button></div>`;
 // הזמנה חוזרת
 const DAYS=['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'];
 html+=`<div class="card"><label class="lb">הזמנה חוזרת</label>
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${DAYS.map((d,i)=>`<label class="chip" style="cursor:pointer"><input type="checkbox" id="bz-d${i}" style="accent-color:#0e7a8a"> ${d}</label>`).join('')}</div>
  <div style="display:flex;gap:8px;flex-wrap:wrap">
   <select class="inp" id="bz-ruser" style="flex:1;min-width:120px">${det.users.map(u=>`<option value="${u.id}">${esc(u.name||u.phone)}</option>`).join('')||'<option value="">— שייכו משתמש קודם —</option>'}</select>
   <select class="inp" id="bz-ritem" style="flex:1;min-width:120px">${items.map(i=>`<option value="${i.id}">${esc(i.name)}</option>`).join('')}</select>
   <input class="inp" id="bz-rqty" type="number" value="1" min="1" style="width:60px">
   <input class="inp" id="bz-rtime" type="time" value="09:00" style="width:100px">
  </div>
  <input class="inp" id="bz-raddr" placeholder="כתובת קבועה לאיסוף">
  <button class="btn2 on" onclick="bizRecCreate('${slug}','${acc.id}')">יצירת תבנית</button>
  ${rec.map(t=>`<div class="row" style="margin-top:8px"><div style="${t.active?'':'opacity:.4'}"><b>${esc(t.user_name||'')}</b> · ימים ${(t.days||[]).map(d=>DAYS[d]).join(' ')}${t.pickup_time?' · '+t.pickup_time.slice(0,5):''}
    <div class="mut">${(t.items||[]).map(i=>{const it=items.find(x=>x.id===i.item_id);return (it?esc(it.name):'פריט')+' ×'+fmtQ(i.qty)}).join(', ')} · ${esc(t.address)}${t.last_run_on?' · הופק לאחרונה '+fmtDate(t.last_run_on):''}</div></div>
    <button class="btn2" onclick="bizRecToggle('${slug}','${acc.id}','${t.id}',${!t.active})">${t.active?'השהיה':'הפעלה'}</button></div>`).join('')}</div>`;
 // מחירון הסכמי
 html+=`<div class="card"><label class="lb">מחירון הסכמי</label>
  <div style="display:flex;gap:8px;flex-wrap:wrap">
   <select class="inp" id="bz-pitem" style="flex:2;min-width:140px">${items.map(i=>`<option value="${i.id}">${esc(i.name)} (רגיל ₪${i.price})</option>`).join('')}</select>
   <input class="inp" id="bz-pprice" type="number" placeholder="מחיר הסכמי ₪" style="flex:1;min-width:110px">
   <button class="btn2 on" onclick="bizSetPrice('${slug}','${acc.id}')">קביעה</button>
  </div>
  ${det.prices.map(p=>`<div class="row" style="margin-top:6px"><div>${esc(p.name)} <div class="mut">רגיל ₪${p.regular_price}</div></div>
   <div><b>₪${p.price}</b> <button class="btn2" onclick="bizDelPrice('${slug}','${acc.id}','${p.item_id}')">הסרה</button></div></div>`).join('')||'<div class="mut" style="margin-top:6px">אין דריסות מחיר — ההזמנות במחירון הרגיל</div>'}</div>`;
 // משתמשים
 html+=`<div class="card"><label class="lb">משתמשים משויכים</label>
  <div style="display:flex;gap:8px"><input class="inp" id="bz-uphone" placeholder="טלפון משתמש רשום" style="flex:1"><button class="btn2 on" onclick="bizAddUser('${slug}','${acc.id}')">שיוך</button></div>
  ${det.users.map(u=>`<div class="row" style="margin-top:6px"><div>${esc(u.name||'')} <span class="mut" dir="ltr">${esc(u.phone)}</span></div><button class="btn2" onclick="bizDelUser('${slug}','${acc.id}','${u.id}')">הסרה</button></div>`).join('')||'<div class="mut" style="margin-top:6px">אין משתמשים משויכים</div>'}</div>`;
 // חשבונית מרוכזת
 const now=new Date();
 html+=`<div class="card"><label class="lb">חשבונית מרוכזת חודשית</label>
  <div class="mut">הפקה אוטומטית ב-1 לחודש · מסמך דמו — לא חשבונית מס · ברירת מחדל מופעלת לחשבון עסקי</div>
  <label style="display:flex;gap:8px;align-items:center;margin:6px 0;cursor:pointer"><input type="checkbox" id="bz-cons" ${acc.consolidated_billing!==false?'checked':''} onchange="bizConsToggle('${slug}','${acc.id}',this.checked)"> חשבונית מרכזת חודשית מופעלת</label>
  <button class="btn2 on" onclick="bizInvGen('${slug}','${acc.id}')">הפקה לחודש ${now.getMonth()+1}/${now.getFullYear()}</button>
  ${inv.map(i=>`<div class="row" style="margin-top:6px"><div><b>${i.month}/${i.year}</b> <div class="mut">${i.orders_count} הזמנות · הופק ${fmtDate(i.issued_at)}</div></div>
   <div><b>₪${i.total}</b> <button class="btn2" onclick="bizDoc('${slug}','${acc.id}','${i.id}','pdf')">PDF</button> <button class="btn2" onclick="bizDoc('${slug}','${acc.id}','${i.id}','csv')">CSV</button></div></div>`).join('')||'<div class="mut" style="margin-top:6px">אין חשבוניות עדיין</div>'}</div>`;
 return html;
}
function bizPick(id){bizSel=id;route()}
async function bizConsToggle(slug,bid,on){try{await api(`/t/${slug}/business-accounts/${bid}`,{method:'PATCH',body:JSON.stringify({consolidated_billing:on})});toast(on?'חשבונית מרכזת הופעלה':'חשבונית מרכזת כובתה')}catch(e){toast(e.message);route()}}
async function bizCreate(slug){try{await api(`/t/${slug}/business-accounts`,{method:'POST',body:JSON.stringify({name:$('#bz-name').value,company_id:$('#bz-comp').value,contact_name:$('#bz-contact').value,contact_phone:$('#bz-phone').value})});route()}catch(e){toast(e.message)}}
async function bizAddUser(slug,bid){try{await api(`/t/${slug}/business-accounts/${bid}/users`,{method:'POST',body:JSON.stringify({phone:$('#bz-uphone').value})});route()}catch(e){toast(e.message)}}
async function bizDelUser(slug,bid,uid){try{await api(`/t/${slug}/business-accounts/${bid}/users/${uid}`,{method:'DELETE'});route()}catch(e){toast(e.message)}}
async function bizSetPrice(slug,bid){try{await api(`/t/${slug}/business-accounts/${bid}/prices`,{method:'PUT',body:JSON.stringify({prices:[{item_id:$('#bz-pitem').value,price:Number($('#bz-pprice').value)}]})});route()}catch(e){toast(e.message)}}
async function bizDelPrice(slug,bid,itemId){try{await api(`/t/${slug}/business-accounts/${bid}/prices`,{method:'PUT',body:JSON.stringify({prices:[{item_id:itemId,price:null}]})});route()}catch(e){toast(e.message)}}
async function bizRecCreate(slug,bid){try{
 const days=[0,1,2,3,4,5,6].filter(i=>$('#bz-d'+i)&&$('#bz-d'+i).checked);
 await api(`/t/${slug}/business-accounts/${bid}/recurring`,{method:'POST',body:JSON.stringify({user_id:$('#bz-ruser').value,days,items:[{item_id:$('#bz-ritem').value,qty:Number($('#bz-rqty').value)||1}],pickup_time:$('#bz-rtime').value,address:$('#bz-raddr').value})});route()}catch(e){toast(e.message)}}
async function bizRecToggle(slug,bid,rid,active){try{await api(`/t/${slug}/business-accounts/${bid}/recurring/${rid}`,{method:'PATCH',body:JSON.stringify({active})});route()}catch(e){toast(e.message)}}
async function bizInvGen(slug,bid){try{const now=new Date();await api(`/t/${slug}/business-accounts/${bid}/invoices/generate`,{method:'POST',body:JSON.stringify({year:now.getFullYear(),month:now.getMonth()+1})});toast('החשבונית הופקה');route()}catch(e){toast(e.message)}}
async function bizOrder(slug,bid){try{
 const r=await api(`/t/${slug}/business-accounts/${bid}/orders`,{method:'POST',body:JSON.stringify({user_id:$('#bz-ouser').value,items:[{item_id:$('#bz-oitem').value,qty:Number($('#bz-oqty').value)||1}],address:$('#bz-oaddr').value})});
 toast('הזמנה נוצרה בסך ₪'+r.order.total);route()}catch(e){toast(e.message)}}
async function bizDoc(slug,bid,iid,kind){try{
 const r=await fetch(`/api/t/${slug}/business-accounts/${bid}/invoices/${iid}/${kind}`,{headers:{authorization:'Bearer '+state.token}});
 if(!r.ok)throw new Error('שגיאה בטעינת המסמך');
 const b=await r.blob();window.open(URL.createObjectURL(b),'_blank')}catch(e){toast(e.message)}}
async function addItem(slug){try{await api(`/t/${slug}/items`,{method:'POST',body:JSON.stringify({name:$('#it-name').value,price:$('#it-price').value,unit:$('#it-unit').value,category:$('#it-cat').value})});route()}catch(e){toast(e.message)}}
async function editItem(slug,id,btn){
 const vals=await xmodal({title:'עריכת פריט',okText:'שמירה',fields:[{id:'name',label:'שם הפריט',value:btn.dataset.name},{id:'price',label:'מחיר בש״ח',value:btn.dataset.price,type:'number'}]});
 if(!vals)return;
 try{await api(`/t/${slug}/items/${id}`,{method:'PATCH',body:JSON.stringify({name:vals.name.trim()||undefined,price:vals.price?Number(vals.price):undefined})});toast('הפריט עודכן');route()}catch(e){toast(e.message)}
}
async function delItem(slug,id){try{await api(`/t/${slug}/items/${id}`,{method:'DELETE'});route()}catch(e){toast(e.message)}}

async function consolidatedModal(slug){
 let d; try{d=await api(`/t/${slug}/documents/consolidated/eligible`)}catch(e){return toast(e.message)}
 if(!d.customers.length)return toast('אין הזמנות מוכנות לחשבונית מרכזת — נדרשות הזמנות שהושלמו ועדיין לא הונפק להן מסמך');
 const ov=document.createElement('div');ov.className='modal-ov';
 ov.innerHTML=`<div class="modal"><b>הפקת חשבונית מרכזת</b>
  <div class="mut" style="margin:6px 0">מסמך A4 מעוצב המרכז מספר הזמנות של לקוח אחד — כולל QR וברקוד לאימות. הזמנות שייכוסו כאן לא יקבלו מסמך נפרד.</div>
  <label class="lb">לקוח</label>
  <select class="inp" id="cm-cust">${d.customers.map((c,i)=>`<option value="${i}">${esc(c.customer.name||'לקוח')} · ${c.orders.length} הזמנות זכאיות</option>`).join('')}</select>
  <div id="cm-orders" style="max-height:220px;overflow:auto;margin-top:8px"></div>
  <div style="display:flex;gap:8px;margin-top:14px"><button class="btn" id="cm-ok" style="flex:1">הפק חשבונית מרכזת</button><button class="btn2" id="cm-cancel" style="flex:1">ביטול</button></div></div>`;
 document.body.appendChild(ov);
 const renderOrders=()=>{const c=d.customers[+ov.querySelector('#cm-cust').value];
  ov.querySelector('#cm-orders').innerHTML=c.orders.map(o=>`<label style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid #eef3f5;cursor:pointer"><input type="checkbox" class="cm-o" value="${o.id}" checked> הזמנה #${o.id.slice(0,8)} · ${new Date(o.created_at).toLocaleDateString('he-IL')} · ₪${o.total}</label>`).join('')};
 renderOrders();
 ov.querySelector('#cm-cust').onchange=renderOrders;
 ov.querySelector('#cm-cancel').onclick=()=>ov.remove();
 ov.onclick=e=>{if(e.target===ov)ov.remove()};
 ov.querySelector('#cm-ok').onclick=async()=>{
  const c=d.customers[+ov.querySelector('#cm-cust').value];
  const ids=[...ov.querySelectorAll('.cm-o:checked')].map(x=>x.value);
  if(!ids.length)return toast('בחרו לפחות הזמנה אחת');
  try{const r=await api(`/t/${slug}/documents/consolidated`,{method:'POST',body:JSON.stringify({customer_id:c.customer.id,order_ids:ids})});
   ov.remove();toast(`חשבונית מרכזת ${r.document.doc_number}/${r.document.doc_year} הונפקה`);route()}catch(e){toast(e.message)}
 };
}

async function creditDoc(slug,id,total,credited){
 const rem=Math.round((Number(total)-Number(credited))*100)/100;
 const vals=await xmodal({title:'הנפקת זיכוי',body:`יתרה לזיכוי במסמך: ₪${rem}. השאר את השדה ריק לזיכוי מלא.`,okText:'הנפק זיכוי',fields:[{id:'amt',label:'סכום חלקי (אופציונלי)',type:'number'}]});
 if(!vals)return;
 try{await api(`/t/${slug}/documents/${id}/credit`,{method:'POST',body:JSON.stringify(vals.amt&&vals.amt.trim()?{amount:Number(vals.amt)}:{})});toast('הזיכוי הונפק');route()}catch(e){toast(e.message)}
}
async function addCoupon(slug){try{const b={code:$('#cp-code').value,kind:$('#cp-kind').value,value:$('#cp-value').value,min_order:$('#cp-min').value||undefined,usage_limit:$('#cp-usage').value||undefined,per_user_limit:$('#cp-peruser').value||undefined,expires_at:$('#cp-exp').value||undefined};await api(`/t/${slug}/coupons`,{method:'POST',body:JSON.stringify(b)});toast('הקופון נוצר');route()}catch(e){toast(e.message)}}
async function toggleCoupon(slug,id,active){try{await api(`/t/${slug}/coupons/${id}`,{method:'PATCH',body:JSON.stringify({active})});route()}catch(e){toast(e.message)}}
async function addWindow(slug){try{await api(`/t/${slug}/windows`,{method:'POST',body:JSON.stringify({weekday:$('#w-day').value,start_time:$('#w-start').value,end_time:$('#w-end').value,kind:$('#w-kind').value})});route()}catch(e){toast(e.message)}}
async function delWindow(slug,id){try{await api(`/t/${slug}/windows/${id}`,{method:'DELETE'});route()}catch(e){toast(e.message)}}
async function saveSettings(slug){try{await api(`/t/${slug}/settings`,{method:'PATCH',body:JSON.stringify({name:$('#s-name').value,phone:$('#s-phone').value,address:$('#s-address').value,city:$('#s-city').value,delivery_fee:$('#s-fee').value,min_order:$('#s-min').value,is_open:$('#s-open').checked,terms:$('#s-terms').value,dealer_type:$('#s-dealer-type').value||null,dealer_id:$('#s-dealer-id').value||null,invoice_mode:$('#s-invoice-mode').value})});toast('נשמר')}catch(e){toast(e.message)}}

/* ---- admin ---- */
async function vAdmin(sub){
 if(!state.token)return needLogin();
 sub=sub||'overview';
 const tabs=[['overview','תמונת מצב'],['dash','דשבורד מרכזי'],['onboarding','צינור קליטה'],['sla','התראות SLA'],['tenants','מכבסות'],['couriers','שליחים'],['routes','מסלולים'],['register','רישום שליח'],['orders','הזמנות'],['weekly','דוח שבועי']];
 let body='';
 if(sub==='dash'){
  // E7.T1: דשבורד מנהל מרכזי (מוקאפ 30)
  const d=await api('/admin/dashboard');
  body=`<div class="kpis">
   <div class="kpi"><b>₪${d.month.gmv}</b>מחזור (GMV) החודש</div>
   <div class="kpi"><b>${d.month.orders}</b>הזמנות החודש</div>
   <div class="kpi"><b>₪${d.month.courier_commission}</b>עמלות שליחים</div>
   <div class="kpi"><b>${d.sla.on_time_pct===null?'—':d.sla.on_time_pct+'%'}</b>איסוף בזמן (30 יום)</div>
   <div class="kpi"><b>${d.laundries.active_30d}</b>מכבסות פעילות</div>
   <div class="kpi"><b>${d.alerts.open}</b>התראות פתוחות</div>
  </div>
  <div class="card"><div class="sec">פעילות B2B שבועית</div><div style="display:flex;gap:8px;flex-wrap:wrap">
   <span class="tag tb">פוסטים: ${d.b2b_weekly.posts}</span><span class="tag tb">מכרזים: ${d.b2b_weekly.tenders}</span>
   <span class="tag tb">הצעות: ${d.b2b_weekly.bids}</span><span class="tag tb">קבוצות רכש: ${d.b2b_weekly.purchase_groups}</span>
   <span class="tag tb">קיבולת: ${d.b2b_weekly.capacity_posts}</span></div></div>
  ${d.alerts.open?`<a href="#/admin/sla" style="text-decoration:none"><div class="warn">⚠ ${d.alerts.open} התראות ממתינות לטיפול (${d.alerts.late} איחורים, ${d.alerts.issues} דיווחי לקוחות) — לחצו לתור הטיפול</div></a>`:'<div class="card mut">אין התראות פתוחות ✓</div>'}
  <div class="card mut">מכבסות מאושרות: ${d.laundries.approved} · ברוטו שליחים החודש: ₪${d.month.courier_gross}</div>`;
 } else if(sub==='onboarding'){
  // E7.T2: צינור אונבורדינג מכבסות
  const d=await api('/admin/onboarding');
  const ST={agreement:'הסכם',pricing:'מחירון',bot:'בוט',training:'הדרכה',active:'פעיל'};
  body=`<div class="kpis">${d.stages.map(s=>`<div class="kpi"><b>${d.pipeline[s]}</b>${ST[s]}</div>`).join('')}</div>
  ${d.tenants.map(t=>`<div class="card"><b>${esc(t.name)}</b> <span class="mut">${esc(t.city||'')}</span>${t.approved?'':' <span class="tag ta">ממתינה לאישור</span>'}
   <div class="mut">נפתחה ${fmtDate(t.created_at)} · פריטי מחירון: ${t.price_items}${t.notes?' · '+esc(t.notes):''}</div>
   <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${d.stages.map(st=>`<button class="btn2 ${t.stage===st?'green':''}" onclick="adminOnboardStage('${t.id}','${st}')">${ST[st]}</button>`).join('')}</div></div>`).join('')}`;
 } else if(sub==='sla'){
  // E7.T3: תור התראות SLA ומחלוקות
  await api('/admin/sla/sync',{method:'POST',body:'{}'});
  const d=await api('/admin/sla?status=all');
  const KIND={late_pickup:'איחור איסוף',late_delivery:'איחור משלוח',customer_issue:'דיווח לקוח',courier_dispute:'מחלוקת שליח'};
  const open=d.alerts.filter(a=>a.status==='open'), done=d.alerts.filter(a=>a.status==='handled');
  body=(open.length?`<div class="sec">פתוחות (${open.length})</div>`+open.map(a=>`<div class="card"><b>${KIND[a.kind]||a.kind}</b> — ${esc(a.tenant_name||'—')}
    <div class="mut">${esc(a.details||'')}</div>
    ${a.order_address?`<div class="mut">${esc(a.order_address)} · סטטוס הזמנה: ${({new:'חדשה',confirmed:'אושרה',picked_up:'נאספה',out_for_delivery:'בדרך ללקוח',delivered:'נמסרה',cancelled:'בוטלה'})[a.order_status]||esc(a.order_status||'')} · לקוח: ${esc(a.customer_name||'')} <span dir="ltr">${esc(a.customer_phone||'')}</span></div>`:''}
    <div class="mut">נוצרה ${fmtDT(a.created_at)}</div>
    <div style="margin-top:6px"><button class="btn2 green" onclick="adminSlaHandle('${a.id}')">סימון כטופלה</button></div></div>`).join(''):'<div class="card mut">אין התראות פתוחות ✓</div>')
   +(done.length?`<div class="sec">טופלו (${done.length})</div>`+done.map(a=>`<div class="card" style="opacity:.7"><b>${KIND[a.kind]||a.kind}</b> — ${esc(a.tenant_name||'—')}
    <div class="mut">${esc(a.details||'')}</div><div class="mut">טופלה ע"י ${esc(a.handled_by_name||'')} · ${fmtDT(a.handled_at)}${a.handle_note?' · '+esc(a.handle_note):''}</div>
    <div style="margin-top:6px"><button class="btn2" onclick="adminSlaReopen('${a.id}')">פתיחה מחדש</button></div></div>`).join(''):'');
  // E9.T1: דיווחי תקלות שהוסלמו לגישור אדמין
  const med=await api('/admin/issues?mediation=1').catch(()=>({issues:[]}));
  if(med.issues&&med.issues.length){
   const KIND2={damage:'נזק',missing:'חסר',late:'איחור',other:'אחר'};
   body+=`<div class="sec">גישור תקלות (${med.issues.length})</div>`+med.issues.map(i=>`<div class="card">
    <b>${KIND2[i.kind]||i.kind}</b> — ${esc(i.tenant_name||'—')} <span class="st-pill ${i.status==='resolved'?'st-delivered':'st-new'}">${{open:'פתוח',in_progress:'בטיפול',resolved:'טופל'}[i.status]||i.status}</span>
    <div>${esc(i.text)}</div>
    <div class="mut">לקוח: ${esc(i.customer_name||'')} <span dir="ltr">${esc(i.customer_phone||'')}</span> · ${fmtDT(i.created_at)}${i.resolution_note?' · תיעוד מכבסה: '+esc(i.resolution_note):''}</div>
    <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
     ${(i.photo_ids||[]).map(pid=>`<button class="btn2" onclick="openIssuePhoto('${pid}')">📷</button>`).join('')}
     ${i.status!=='resolved'?`<button class="btn2 green" onclick="adminIssueHandle('${i.id}')">סיום גישור</button>`:''}
    </div></div>`).join('');
  }
 } else if(sub==='overview'){
  const d=await api('/admin/overview');
  body=`<div class="kpis"><div class="kpi"><b>${d.tenants.approved}</b>מכבסות</div><div class="kpi"><b>${d.orders.total}</b>הזמנות</div><div class="kpi"><b>₪${d.orders.gmv}</b>מחזור</div><div class="kpi"><b>${d.users.total}</b>משתמשים</div></div>
   ${d.tenants.pending?`<a href="#/admin/tenants" style="text-decoration:none"><div class="warn">${d.tenants.pending} מכבסות ממתינות לאישור — לחצו לסקירה</div></a>`:''}
   ${d.couriers.pending?`<div class="warn">${d.couriers.pending} שליחים ממתינים לאישור</div>`:''}`;
 } else if(sub==='tenants'){
  const d=await api('/admin/tenants');
  body=`<div class="card"><table class="tbl"><tr><th>מכבסה</th><th>הזמנות</th><th>מחזור</th><th></th></tr>
   ${d.tenants.map(t=>`<tr><td><a href="#/admin/tenant/${t.id}" style="color:#0e7a8a;font-weight:600">${esc(t.name)}</a>${t.approved?'':' <span class="tag ta">ממתינה</span>'}<div class="mut">${esc(t.city||'')}</div></td><td>${t.orders}</td><td>₪${t.gmv}</td>
    <td>${t.approved?`<button class="btn2" onclick="adminTenant('${t.id}','suspend')">השעיה</button>`:`<button class="btn2 green" onclick="adminTenant('${t.id}','approve')">אישור</button>`}</td></tr>`).join('')}</table></div>`;
 } else if(sub==='coupons'){
  const d=await api(`/t/${slug}/coupons`);
  body=`<div class="card">
    <label class="lb">קופון חדש</label>
    <div style="display:flex;gap:8px"><input class="inp" id="cp-code" placeholder="קוד (למשל SAVE10)" style="flex:2">
    <select class="inp" id="cp-kind" style="flex:1"><option value="percent">אחוז %</option><option value="amount">סכום ₪</option></select>
    <input class="inp" id="cp-value" type="number" placeholder="ערך" style="flex:1"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
     <input class="inp" id="cp-min" type="number" placeholder="מינימום הזמנה ₪" style="flex:1">
     <input class="inp" id="cp-usage" type="number" placeholder="מגבלת שימושים" style="flex:1">
     <input class="inp" id="cp-peruser" type="number" placeholder="מגבלה ללקוח" style="flex:1">
     <input class="inp" id="cp-exp" type="date" style="flex:1">
    </div>
    <button class="btn2 on" onclick="addCoupon('${slug}')">יצירת קופון</button></div>
   <div class="card">${d.coupons.map(c=>`<div class="row"><div style="${c.active?'':'opacity:.4'}"><b dir="ltr">${esc(c.code)}</b> — ${c.kind==='percent'?c.value+'%':'₪'+c.value}
    <div class="mut">${c.min_order>0?'מינימום ₪'+c.min_order+' · ':''}${c.usage_limit?'עד '+c.usage_limit+' שימושים · ':''}${c.per_user_limit?c.per_user_limit+' ללקוח · ':''}${c.expires_at?'בתוקף עד '+new Date(c.expires_at).toLocaleDateString('he-IL')+' · ':''}מומש ${c.used_count||0}</div></div>
    <button class="btn2" onclick="toggleCoupon('${slug}','${c.id}',${!c.active})">${c.active?'השבתה':'הפעלה'}</button></div>`).join('')||'<div class="mut">אין קופונים עדיין</div>'}</div>`;
 } else if(sub==='documents'){
  const d=await api(`/t/${slug}/documents`);
  const ST_HE={issued:'הופק',partially_credited:'זוכה חלקית',credited:'זוכה'};
  const consBtn=`<button class="btn2 on" style="margin-bottom:10px" onclick="consolidatedModal('${slug}')">🧾 הפק חשבונית מרכזת</button>`;
  body=consBtn+(d.documents.length?`<div class="card docs-list">${d.documents.map(dc=>`<div class="row"><div>
    <b>${dc.kind_he} ${dc.doc_number}/${dc.doc_year}</b> <span class="st-pill ${dc.status==='credited'?'st-cancelled':'st-delivered'}">${ST_HE[dc.status]||dc.status}</span>
    <div class="mut">${fmtDT(dc.issued_at)} · ${esc(dc.customer_name||'לקוח')} · ₪${dc.total}${dc.orders_count?' · מכסה '+dc.orders_count+' הזמנות':''}${Number(dc.credited_amount)>0?' · זוכה ₪'+dc.credited_amount:''}${dc.allocation_number?' · הקצאה '+dc.allocation_number:''}</div></div>
    <div class="docs-actions">
     <button class="btn2" onclick="openPdf('/t/${slug}/documents/${dc.id}/pdf')">מקור</button>
     <button class="btn2" onclick="openPdf('/t/${slug}/documents/${dc.id}/pdf?copy=1')">העתק</button>
     ${dc.kind!=='credit'&&dc.status!=='credited'?`<button class="btn2" style="border-color:#f3c2c2;color:#c22" onclick="creditDoc('${slug}','${dc.id}',${dc.total},${dc.credited_amount})">זיכוי</button>`:''}
    </div></div>`).join('')}</div>`
   :'<div class="card mut">אין מסמכים עדיין — בהתאם להגדרות, מסמכים מונפקים אוטומטית בסיום הזמנה או מרוכזים ידנית בחשבונית מרכזת.</div>');
 } else if(sub==='couriers'){
  const d=await api('/admin/couriers');
  const pd=await api('/admin/couriers/pending');
  const net=await api('/admin/couriers/network');
  body=`<div class="kpis">
   <div class="kpi"><b>${net.counts.active}</b>שליחים פעילים</div>
   <div class="kpi"><b>${net.sla.on_time_pct===null?'—':net.sla.on_time_pct+'%'}</b>איסוף בזמן (30 יום)</div>
   <div class="kpi"><b>${net.routes_30d.combined_pct}%</b>מסלולים משולבים</div>
   <div class="kpi"><b>${net.disputes.length}</b>מחלוקות פתוחות</div>
  </div>
  ${net.coverage.length?`<div class="card"><div class="sec">כיסוי אזורי</div><div style="display:flex;gap:6px;flex-wrap:wrap">${net.coverage.map(x=>`<span class="tag tb">${esc(x.area)}: ${x.couriers}</span>`).join('')}</div></div>`:''}
  ${net.late_alerts.length?`<div class="warn">⚠ ${net.late_alerts.length} הזמנות באיחור חריג (מעל שעתיים מחלון האיסוף):</div>`+net.late_alerts.map(x=>`<div class="card"><b dir="ltr">#${x.id.slice(0,8)}</b> ${esc(x.tenant_name)}<div class="mut">${esc(x.address)} · איסוף תוכנן ${fmtDT(x.pickup_at)}</div></div>`).join(''):''}
  ${net.disputes.length?`<div class="sec">מחלוקות תשלום</div>`+net.disputes.map(x=>`<div class="card"><b>${esc(x.courier_name)}</b> מול ${esc(x.tenant_name||'—')}<div class="mut">שבוע ${fmtDate(x.week_start)} · ברוטו ₪${x.gross} · נטו ₪${x.net}</div>
   <div style="display:flex;gap:6px;margin-top:6px"><button class="btn2 green" onclick="adminResolveDispute('${x.id}','approve')">אישור התשלום</button><button class="btn2" onclick="adminResolveDispute('${x.id}','reject')">דחיית החיוב</button></div></div>`).join(''):''}
  ${pd.pending.length?`<div class="sec">ממתינים לאישור (${pd.pending.length})</div>`+pd.pending.map(c=>`<div class="card">
    <b>${esc(c.name||'')}</b> · <span dir="ltr">${esc(c.phone||'')}</span>
    <div class="mut">${c.model==='shared'?'שליח משותף':'שליח פלטפורמה'} · ${esc(c.vehicle||'')} · אזורים: ${(c.areas||[]).map(esc).join(', ')}</div>
    <div class="mut">זמינות: ${Object.keys(c.availability||{}).length?Object.keys(c.availability||{}).map(d=>WD[+d]).join(', '):'לא צוינה'} · נרשם ${fmtDate(c.created_at)}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">${(c.documents||[]).map(doc=>`<button class="btn2" onclick="viewCourierDoc('${doc.id}')">${doc.kind==='license'?'רישיון':doc.kind==='insurance'?'ביטוח':'תמונה'}</button>`).join('')||'<span class="mut">אין מסמכים</span>'}</div>
    <div style="display:flex;gap:8px"><button class="btn2 green" style="flex:1" onclick="adminCourier('${c.id}','approve')">אישור</button><button class="btn2" style="flex:1" onclick="adminRejectCourier('${c.id}')">דחייה</button></div>
   </div>`).join(''):''}
  <div class="card"><table class="tbl"><tr><th>שליח</th><th>סוג</th><th>מכבסה</th><th></th></tr>
   ${d.couriers.map(c=>`<tr><td>${esc(c.name)}<div class="mut">${esc(c.phone||'')}</div></td><td>${c.model==='platform'?'פלטפורמה':c.model==='shared'?'משותף':'פרטי'}</td><td>${esc(c.tenant_name||'—')}</td>
    <td>${c.approved?`<button class="btn2" onclick="adminCourier('${c.id}','suspend')">השעיה</button>`:`<button class="btn2 green" onclick="adminCourier('${c.id}','approve')">אישור</button>`}</td></tr>`).join('')}</table></div>`;
 } else if(sub==='routes'){
  const d=await api('/admin/routes');
  const cl=await api('/admin/clusters');
  const cr=await api('/admin/couriers');
  body=`<div class="sec">קלאסטרים ומסלולים קבועים</div>
  <div class="card"><div style="display:flex;gap:6px"><input class="inp" id="cl-name" placeholder="שם קלאסטר" style="flex:2"><input class="inp" id="cl-area" placeholder="אזור" style="flex:1"><input class="inp" id="cl-fee" type="number" placeholder="דמי ניהול ₪/חודש" style="flex:1"></div>
   <button class="btn2 on" onclick="adminAddCluster()">יצירת קלאסטר</button></div>
  ${cl.clusters.map(c=>`<div class="card"><div class="row"><div><b>${esc(c.name)}</b> · ${esc(c.area)} ${c.active?'':'<span class="tag ta">מושבת</span>'}
    <div class="mut">${c.members}/5 מכבסות${c.member_names?': '+c.member_names.map(m=>esc(m.name)).join(', '):''} · דמי ניהול (דמו): ₪${c.mgmt_fee_monthly}/חודש</div>
    ${(c.fixed_routes||[]).map(f=>`<div class="mut">מסלול קבוע: ${WD[f.weekday]} — ${esc(f.courier)}</div>`).join('')}</div>
    <button class="btn2" onclick="adminToggleCluster('${c.id}')">${c.active?'השבתה':'הפעלה'}</button></div>
   <div style="display:flex;gap:6px;margin-top:6px"><select class="inp" id="fr-c-${c.id}" style="flex:2">${cr.couriers.filter(x=>x.approved).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>
    <select class="inp" id="fr-w-${c.id}" style="flex:1">${WD.map((w,i)=>`<option value="${i}">${w}</option>`).join('')}</select>
    <button class="btn2" onclick="adminAddFixedRoute('${c.id}')">+ מסלול קבוע</button></div></div>`).join('')||'<div class="card mut">אין קלאסטרים</div>'}`;
  body+=`<button class="btn" onclick="adminAutoBuild()">בניית מסלולים אוטומטית להיום</button>
  <div class="note">המנוע מאחד הזמנות לא משובצות לפי אזור, משבץ שליח פלטפורמה/משותף ומסדר נקודות (nearest neighbor).</div>
  ${d.routes.length?d.routes.map(r=>`<div class="card"><b>${esc(r.courier_name)}</b> ${r.combined?'<span class="tag tb">מסלול משולב</span>':'<span class="tag">רגיל</span>'}
   <div class="mut">${r.stops} נקודות · ${r.tenants} מכבסות</div>
   <table class="tbl"><tr><th>#</th><th>מכבסה</th><th>כתובת</th><th>סטטוס</th></tr>
   ${(r.stop_list||[]).map(x=>`<tr><td>${x.seq}</td><td>${esc(x.tenant||'')}</td><td>${esc(x.address||'')}</td><td>${HE[x.status]||x.status||''}</td></tr>`).join('')}</table></div>`).join(''):'<div class="card mut">אין מסלולים להיום — לחצו על בנייה אוטומטית</div>'}`;
 } else if(sub==='register'){
  const d=await api('/admin/tenants');
  body=`<div class="card">
   <label class="lb">שם שליח</label><input class="inp" id="rc-name">
   <label class="lb">טלפון</label><input class="inp" id="rc-phone" placeholder="05x-xxxxxxx">
   <label class="lb">כלי רכב</label><input class="inp" id="rc-vehicle" placeholder="אופנוע / רכב">
   <label class="lb">מודל</label><select class="inp" id="rc-model"><option value="platform">שליח פלטפורמה</option><option value="private">שליח מכבסה פרטי</option><option value="shared">שליח משותף</option></select>
   <label class="lb">מכבסה (לשליח פרטי/משותף)</label><select class="inp" id="rc-tenant"><option value="">—</option>${d.tenants.map(t=>`<option value="${t.slug}">${esc(t.name)}</option>`).join('')}</select>
   <button class="btn" onclick="adminRegisterCourier()">רישום</button></div>`;
 } else if(sub==='weekly'){
  const d=(await api('/admin/weekly-report')).report;
  body=`<div class="kpis"><div class="kpi"><b>₪${d.gmv}</b>מחזור שבועי</div><div class="kpi"><b>${d.orders}</b>הזמנות</div><div class="kpi"><b>${d.delivered}</b>הושלמו</div><div class="kpi"><b>${d.cancelled}</b>בוטלו</div></div>
   <div class="kpis"><div class="kpi"><b>${d.new_users}</b>משתמשים חדשים</div><div class="kpi"><b>${d.new_tenants}</b>מכבסות חדשות</div><div class="kpi"><b>${d.active_tenants}</b>מכבסות פעילות</div><div class="kpi"><b>${d.active_couriers}</b>שליחים פעילים</div></div>
   <div class="card"><b>לפי מכבסה (7 ימים)</b><table class="tbl"><tr><th>מכבסה</th><th>הזמנות</th><th>מחזור</th></tr>
    ${d.by_tenant.map(t=>`<tr><td>${esc(t.name)}</td><td>${t.orders}</td><td>₪${t.gmv}</td></tr>`).join('')||'<tr><td colspan="3" class="mut">אין הזמנות השבוע</td></tr>'}</table></div>
   <button class="btn2" onclick="downloadCsv('/admin/weekly-report.csv','weekly-report.csv')">ייצוא הדוח ל-CSV</button>`;
 } else if(sub==='orders'){
  const d=await api('/admin/orders');
  body=`<div class="card"><table class="tbl"><tr><th>הזמנה</th><th>מכבסה</th><th>סטטוס</th><th>₪</th></tr>
   ${d.orders.map(o=>`<tr><td><span dir="ltr">#${o.id.slice(0,8)}</span><div class="mut">${esc(o.customer_name||'')}</div></td><td>${esc(o.tenant_name)}</td><td><span class="st-pill st-${o.status}">${HE[o.status]}</span></td><td>${o.total}</td></tr>`).join('')}</table></div>`;
 }
 return `<div class="hdr"><h2>ניהול פלטפורמה</h2></div>
 <div class="body"><div class="subtabs">${tabs.map(t=>`<a class="chip ${sub===t[0]?'on':''}" href="#/admin/${t[0]}">${t[1]}</a>`).join('')}</div>${body}</div>`;
}
async function adminTenant(id,a){
 if(a==='suspend'&&!await xconfirm('המכבסה תוסתר מהמרקטפלייס עד לאישור מחדש. הזמנות פעילות לא יימחקו.',{title:'השעיית מכבסה',okText:'כן, להשעות'}))return;
 if(a==='reject'&&!await xconfirm('פעולה זו תמחק את המכבסה לצמיתות. אפשרי רק למכבסה ללא הזמנות.',{title:'דחייה ומחיקה',okText:'כן, למחוק'}))return;
 try{await api(`/admin/tenants/${id}/${a}`,{method:'POST',body:'{}'});toast(a==='approve'?'המכבסה אושרה':a==='suspend'?'המכבסה הושעתה':'המכבסה נמחקה');go('#/admin/tenants')}catch(e){toast(e.message)}
}
/* מסך פרטי מכבסה לאדמין — סקירה לפני אישור */
async function vAdminTenant(id){
 if(!state.token)return needLogin();
 const d=await api('/admin/tenants/'+id);
 const t=d.tenant;
 const hoursTxt=Object.entries(t.hours||{}).map(([k,v])=>v&&v.length?`${WD[k]}: ${v.map(r=>'<span dir="ltr">'+r.join('–')+'</span>').join(', ')}`:null).filter(Boolean).join('<br>');
 const winTxt=(d.windows||[]).map(w=>`${WD[w.weekday]} <span dir="ltr">${w.start_time.slice(0,5)}–${w.end_time.slice(0,5)}</span> (${w.kind==='pickup'?'איסוף':'החזרה'})`).join('<br>');
 const actions=t.approved
  ?`<button class="btn2" onclick="adminTenant('${t.id}','suspend')">השעיית המכבסה</button>`
  :`<button class="btn green" onclick="adminTenant('${t.id}','approve')">אישור המכבסה</button> <button class="btn2" style="color:#c00" onclick="adminTenant('${t.id}','reject')">דחייה ומחיקה</button>`;
 return `<div class="hdr"><h2>${esc(t.name)}</h2><p><a href="#/admin/tenants" style="color:#fff">← חזרה לרשימת המכבסות</a></p></div>
 <div class="body">
  <div class="card"><b>פרטים</b>
   <div class="mut">סטטוס: ${t.approved?'מאושרת':'ממתינה לאישור'} · נרשמה ${fmtDate(t.created_at)}</div>
   <div class="mut">טלפון: ${esc(t.phone||'—')} · ${esc(t.address||'—')}, ${esc(t.city||'—')}</div>
   <div class="mut">דמי שליחות: ₪${t.delivery_fee||0} · מינימום: ₪${t.min_order||0}</div>
   ${(t.services||[]).length?`<div class="mut">שירותים: ${t.services.map(esc).join(', ')}</div>`:''}
  </div>
  <div class="card"><b>מחירון (${d.items.length})</b>
   ${d.items.map(i=>`<div class="row"><div>${esc(i.name)}<div class="mut">${esc(i.category||'')}</div></div><div>₪${i.price}${i.unit==='item'?'':'/'+unitLbl(i.unit)}${i.active?'':' · מוסתר'}</div></div>`).join('')||'<div class="mut">אין פריטים</div>'}
  </div>
  ${hoursTxt?`<div class="card"><b>שעות פעילות</b><div class="mut">${hoursTxt}</div></div>`:''}
  ${winTxt?`<div class="card"><b>חלונות איסוף/החזרה</b><div class="mut">${winTxt}</div></div>`:''}
  ${t.terms?`<div class="card"><b>תקנון</b><div class="mut">${esc(t.terms)}</div></div>`:''}
  <div class="card"><b>צוות והזמנות</b>
   ${d.members.map(mm=>`<div class="mut">${esc(mm.name||'')} · ${esc(mm.phone||'')} (${mm.role==='owner'?'בעלים':'צוות'})</div>`).join('')||'<div class="mut">אין חברי צוות</div>'}
   <div class="mut">${d.orders} הזמנות</div>
  </div>
  <div style="display:flex;gap:8px;margin:6px 0 20px">${actions}</div>
 </div>`;
}
async function adminAddCluster(){try{await api('/admin/clusters',{method:'POST',body:JSON.stringify({name:$('#cl-name').value,area:$('#cl-area').value,mgmt_fee_monthly:$('#cl-fee').value||undefined})});toast('הקלאסטר נוצר');route()}catch(e){toast(e.message)}}
async function adminToggleCluster(id){try{await api(`/admin/clusters/${id}/toggle`,{method:'POST',body:'{}'});route()}catch(e){toast(e.message)}}
async function adminAddFixedRoute(clid){try{await api(`/admin/clusters/${clid}/fixed-routes`,{method:'POST',body:JSON.stringify({courier_id:$('#fr-c-'+clid).value,weekday:$('#fr-w-'+clid).value})});toast('המסלול הקבוע נוסף');route()}catch(e){toast(e.message)}}
async function adminResolveDispute(id,action){try{await api(`/admin/earnings/${id}/resolve`,{method:'POST',body:JSON.stringify({action})});toast(action==='approve'?'התשלום אושר':'החיוב נדחה ונמחק');route()}catch(e){toast(e.message)}}
async function adminAutoBuild(){try{const r=await api('/admin/routes/auto-build',{method:'POST',body:'{}'});toast(r.routes.length?`נבנו ${r.routes.length} מסלולים`:'אין הזמנות לשיבוץ');route()}catch(e){toast(e.message)}}
async function adminCourier(id,a){try{await api(`/admin/couriers/${id}/${a}`,{method:'POST',body:'{}'});route()}catch(e){toast(e.message)}}
async function adminRejectCourier(id){
 const v=await xmodal({title:'דחיית שליח',body:'הסיבה תוצג לשליח ותאפשר לו להגיש בקשה מתוקנת.',okText:'דחייה',fields:[{id:'reason',label:'סיבת דחייה'}]});
 if(!v)return;
 if(!v.reason||!v.reason.trim())return toast('יש לציין סיבת דחייה');
 try{await api(`/admin/couriers/${id}/reject`,{method:'POST',body:JSON.stringify({reason:v.reason.trim()})});toast('השליח נדחה');route()}catch(e){toast(e.message)}
}
async function viewCourierDoc(id){
 try{
  const r=await fetch('/api/admin/courier-documents/'+id,{headers:{Authorization:'Bearer '+state.token}});
  if(!r.ok)throw new Error('שגיאה '+r.status);
  const b=await r.blob();window.open(URL.createObjectURL(b),'_blank');
 }catch(e){toast(e.message)}
}

async function adminOnboardStage(tid,stage){try{await api(`/admin/onboarding/${tid}/stage`,{method:'POST',body:JSON.stringify({stage})});toast('השלב עודכן');route()}catch(e){toast(e.message)}}
async function adminSlaHandle(id){const note=await xmodal({title:'טיפול בהתראה',body:'תיעוד הטיפול (רשות):',okText:'סימון כטופלה',fields:[{id:'note',label:'הערת טיפול'}]});if(!note)return;try{await api(`/admin/sla/${id}/handle`,{method:'POST',body:JSON.stringify({note:note.note||''})});toast('ההתראה טופלה');route()}catch(e){toast(e.message)}}
async function adminSlaReopen(id){try{await api(`/admin/sla/${id}/reopen`,{method:'POST',body:'{}'});toast('ההתראה נפתחה מחדש');route()}catch(e){toast(e.message)}}
async function adminRegisterCourier(){try{await api('/admin/couriers/register',{method:'POST',body:JSON.stringify({name:$('#rc-name').value,phone:$('#rc-phone').value,vehicle:$('#rc-vehicle').value,model:$('#rc-model').value,tenant_slug:$('#rc-tenant').value||undefined})});toast('השליח נרשם');go('#/admin/couriers')}catch(e){toast(e.message)}}

/* ---- join: onboarding מכבסה עם AI ---- */
let joinDraft=null;
async function vJoin(){
 if(!state.token)return needLogin();
 return `<div class="hdr"><h2>הצטרפות מכבסה לפלטפורמה</h2><p>צלמו מחירון, שעות פעילות ותקנון — וה-AI יבנה את הפרופיל</p></div>
 <div class="body">
  <div class="card">
   <div class="subtabs"><button class="chip on" type="button" id="tab-ai" onclick="joinMode('ai')">העלאת תמונות (AI)</button><button class="chip" type="button" id="tab-manual" onclick="joinMode('manual')">הזנה ידנית</button></div>
   <div id="join-ai">
    <label class="upload" for="join-files">📷 לחצו להעלאת תמונות מחירון / שעות / תקנון<input id="join-files" type="file" accept="image/*,application/pdf" multiple></label>
    <div id="join-extract"></div>
   </div>
   <div id="join-manual" style="display:none">
    <label class="lb">שם המכבסה</label><input class="inp" id="j-name">
    <label class="lb">טלפון</label><input class="inp" id="j-phone">
    <label class="lb">כתובת</label><input class="inp" id="j-address">
    <label class="lb">עיר</label><input class="inp" id="j-city">
    <button class="btn" onclick="joinManual()">המשך</button>
   </div>
  </div>
  <div id="join-review"></div>
 </div>`;
}
function joinMode(m){
 $('#tab-ai').className='chip'+(m==='ai'?' on':'');$('#tab-manual').className='chip'+(m==='manual'?' on':'');
 $('#join-ai').style.display=m==='ai'?'':'none';$('#join-manual').style.display=m==='manual'?'':'none';
}
async function joinManual(){
 joinDraft={name:$('#j-name').value,phone:$('#j-phone').value,address:$('#j-address').value,city:$('#j-city').value,items:[],windows:[],services:['כביסה']};
 renderJoinReview();
}
async function joinExtract(files){
 const fd=new FormData();for(const f of files)fd.append('files',f);
 $('#join-extract').innerHTML='<div class="mut" style="margin-top:10px">🤖 מנתח את המסמכים…</div>';
 try{
  const r=await fetch('/api/onboard/extract',{method:'POST',headers:{Authorization:'Bearer '+state.token},body:fd});
  const d=await r.json();if(!r.ok)throw new Error(d.error||'שגיאה');
  joinDraft=d.draft;
  $('#join-extract').innerHTML='';
  renderJoinReview();
 }catch(e){$('#join-extract').innerHTML=`<div class="warn" style="margin-top:10px">${esc(e.message)}</div>`}
}
function renderJoinReview(){
 const d=joinDraft;if(!d)return;
 const lowItems=(d.items||[]).filter(it=>it.confidence==='low').length;
 const hoursRows=Object.entries(d.hours||{}).map(([k,v])=>v&&v.length?`<div class="row"><div>${WD[k]}</div><div><input class="inp" dir="ltr" style="width:170px;padding:6px" value="${v.map(r=>r.join('–')).join(', ')}" onchange="joinSetHours('${k}',this.value)" placeholder="08:00–20:00"></div></div>`:null).filter(Boolean).join('');
 $('#join-review').innerHTML=`<div class="sec">סקירה לפני שליחה לאישור</div>
  <div class="warn">בדקו את הפרטים שזוהו מהמסמכים ותקנו כל טעות לפני השליחה — המחירון יופיע ללקוחות כפי שמופיע כאן.</div>
  <div class="card">
   <label class="lb">שם</label><input class="inp" id="jr-name" value="${esc(d.name||'')}">
   <label class="lb">טלפון</label><input class="inp" id="jr-phone" value="${esc(d.phone||'')}">
   <label class="lb">כתובת</label><input class="inp" id="jr-address" value="${esc(d.address||'')}">
   <label class="lb">עיר</label><input class="inp" id="jr-city" value="${esc(d.city||'')}">
   <label class="lb">דמי שליחות ₪</label><input class="inp" id="jr-fee" type="number" value="${d.delivery_fee||0}">
  </div>
  <div class="card"><b>מחירון (${(d.items||[]).length} פריטים)</b>
   ${lowItems?`<div class="warn">${lowItems} פריטים מסומנים בענבר — הזיהוי לא בטוח, יש לוודא את המחיר.</div>`:''}
   ${(d.items||[]).map((it,i)=>`<div class="row" style="${it.confidence==='low'?'background:#fff7e6;border-radius:8px':''}"><div style="flex:2"><input class="inp" value="${esc(it.name)}" onchange="joinDraft.items[${i}].name=this.value"><div class="mut">${esc(it.category||'')}${it.unit==='item'?' · ליחידה':' · ל'+unitLbl(it.unit)}</div></div><div style="display:flex;align-items:center;gap:4px;flex:1">₪<input class="inp" type="number" style="width:80px" value="${it.price}" onchange="joinDraft.items[${i}].price=Number(this.value)"> <button class="btn2" onclick="joinDraft.items.splice(${i},1);renderJoinReview()">✕</button></div></div>`).join('')||'<div class="mut">לא זוהו פריטים — הוסיפו ידנית בלוח הניהול אחרי ההצטרפות</div>'}
  </div>
  ${hoursRows?`<div class="card"><b>שעות פעילות</b>${d.hours_confidence==='low'?'<div class="warn">השעות שזוהו לא בטוחות — יש לוודא.</div>':''}${hoursRows}</div>`:''}
  ${d.terms?`<div class="card"><b>תקנון</b><div class="mut">${esc(d.terms)}</div></div>`:''}
  ${d.notes?`<div class="warn">שימו לב: ${esc(d.notes)}</div>`:''}
  <div id="jr-err"></div>
  <button class="btn" onclick="joinSubmit()">שליחה לאישור הפלטפורמה</button>`;
}
function joinSetHours(day,val){
 const rows=val.split(',').map(x=>x.trim()).filter(Boolean).map(x=>{
  const m=x.replace(/\s/g,'').match(/^(\d{1,2}:\d{2})[-–—](\d{1,2}:\d{2})$/);
  if(!m)throw new Error('פורמט שעות לא תקין: '+x+' (צפוי 08:00–20:00)');
  return [m[1],m[2]];
 });
 joinDraft.hours=joinDraft.hours||{};joinDraft.hours[day]=rows;
}
async function joinSubmit(){
 try{
  const d=joinDraft;
  const miss=[];
  if(!$('#jr-name').value.trim())miss.push('שם');
  if(!$('#jr-phone').value.trim())miss.push('טלפון');
  if(!$('#jr-address').value.trim())miss.push('כתובת');
  if(!$('#jr-city').value.trim())miss.push('עיר');
  const zero=(d.items||[]).filter(it=>!(Number(it.price)>0));
  if(miss.length){$('#jr-err').innerHTML=`<div class="warn">חסרים שדות חובה: ${miss.join(', ')}</div>`;window.scrollTo(0,0);return}
  if(zero.length){$('#jr-err').innerHTML=`<div class="warn">${zero.length} פריטים ללא מחיר תקין — תקנו או מחקו אותם לפני השליחה.</div>`;return}
  const body={name:$('#jr-name').value,phone:$('#jr-phone').value,address:$('#jr-address').value,city:$('#jr-city').value,
   delivery_fee:$('#jr-fee').value,items:d.items||[],windows:d.windows||[],services:d.services||['כביסה'],hours:d.hours||{},terms:d.terms||''};
  const r=await api('/onboard/tenants',{method:'POST',body:JSON.stringify(body)});
  joinDraft=null;
  $('#join-review').innerHTML=`<div class="note">✅ המכבסה <b>${esc(r.tenant.name)}</b> נוצרה וממתינה לאישור מנהל הפלטפורמה. אחרי האישור תופיע במרקטפלייס, ולוח הניהול כבר פתוח לך בלשונית ״ניהול״.</div>`;
 }catch(e){toast(e.message)}
}

/* ---- E10.T2: דף תשלום דמו (pay link) ---- */
async function vPay(orderId){
 let d;
 try{d=await api('/pay/'+orderId)}catch(e){return `<div class="hdr"><h2>תשלום</h2></div><div class="body"><div class="card warn">${esc(e.message)}</div></div>`}
 const o=d.order;
 if(o.payment_status!=='pending')return `<div class="hdr" style="text-align:center"><div class="big">מכבסה בקליק</div></div>
  <div class="body"><div class="card" style="text-align:center"><div style="font-size:40px">✅</div>
   <b>ההזמנה #${o.short} כבר שולמה</b><div class="mut" style="margin:6px 0">${esc(o.tenant_name)} · ₪${o.total}</div>
   <button class="btn2" onclick="openPdfPublic('/pay/${o.id}/receipt.pdf')">הורדת קבלה (PDF)</button></div></div>`;
 if(!d.payable)return `<div class="hdr" style="text-align:center"><div class="big">מכבסה בקליק</div></div>
  <div class="body"><div class="card mut" style="text-align:center">לא ניתן לשלם על הזמנה זו (סטטוס: ${HE[o.status]||o.status})</div></div>`;
 return `<div class="hdr" style="text-align:center"><div class="big">תשלום מאובטח</div><p>הזמנה #${o.short} · ${esc(o.tenant_name)}</p></div>
 <div class="body">
  <div class="card">
   ${d.items.map(it=>`<div class="row"><div>${esc(it.name)}</div><div>${fmtQ(it.qty)} × ₪${it.price}</div></div>`).join('')}
   <div class="row"><div class="mut">שליחות</div><div>₪${o.delivery_fee}</div></div>
   ${Number(o.discount)>0?`<div class="row"><div class="mut">הנחה</div><div>−₪${o.discount}</div></div>`:''}
   <div class="row" style="border-top:2px solid #d3e8ec"><b>סה״כ לתשלום</b><b style="font-size:17px">₪${o.total}</b></div>
  </div>
  <div class="card">
   <label class="lb">מספר כרטיס</label><input class="inp" id="pay-card" dir="ltr" inputmode="numeric" value="4242 4242 4242 4242">
   <div style="display:flex;gap:8px"><div style="flex:1"><label class="lb">תוקף</label><input class="inp" id="pay-exp" dir="ltr" value="12/28"></div>
   <div style="flex:1"><label class="lb">CVV</label><input class="inp" id="pay-cvv" dir="ltr" inputmode="numeric" value="123"></div></div>
   <div class="note">סביבת הדגמה: לא תתבצע סליקה אמיתית — הכרטיס לצורך הדגמה בלבד.</div>
  </div>
  <button class="btn" onclick="confirmPay('${o.id}')">אישור תשלום ₪${o.total}</button>
 </div>`;
}
async function confirmPay(orderId){
 try{
  const r=await api('/pay/'+orderId+'/confirm',{method:'POST',body:JSON.stringify({card_last4:($('#pay-card')||{}).value||''})});
  toast('התשלום התקבל (דמו)');route();
 }catch(e){toast(e.message)}
}
async function openPdfPublic(path){
 try{
  const r=await fetch('/api'+path);
  if(!r.ok)throw new Error('שגיאה בפתיחת PDF');
  const b=await r.blob();window.open(URL.createObjectURL(b),'_blank');
 }catch(e){toast(e.message)}
}

/* ---- router ---- */

async function vVerify(code){
 const ICON={authentic:'✅',partial:'⚠️',credited:'⛔',altered:'❌'};
 const PILL={authentic:'st-delivered',partial:'st-out_for_delivery',credited:'st-cancelled',altered:'st-cancelled'};
 let d=null,notFound=false;
 try{d=await api(`/verify/${encodeURIComponent(code||'')}`)}catch(e){if(e.status===404)notFound=true;else throw e}
 return `<div class="hdr"><h2>אימות מסמך</h2></div><div class="body">
  <div class="card" style="text-align:center">
   <div style="font-size:44px">${notFound?'❓':ICON[d.result]||'❓'}</div>
   ${notFound?`<b>המסמך לא נמצא</b><div class="mut" style="margin-top:6px">בדקו שהקוד הוזן כראוי או סרקו שוב את ה-QR.</div>`
   :`<b>${d.kind_he} ${d.doc_number}/${d.doc_year}</b>
    <div style="margin:6px 0"><span class="st-pill ${PILL[d.result]||''}">${d.result_he}</span></div>
    <div class="mut">המפיק: ${esc(d.tenant_name)}</div>
    <div style="font-size:22px;font-weight:700;margin:6px 0">₪${d.total}</div>
    <div class="mut">הופק ב-${new Date(d.issued_at).toLocaleDateString('he-IL')}${d.orders_count?` · מכסה ${d.orders_count} הזמנות`:''}</div>
    <div class="mut" style="margin-top:6px">${d.signature_valid?'חתימה דיגיטלית תקינה (HMAC-SHA256)':'⚠️ החתימה הדיגיטלית אינה תואמת'}${d.sha256?' · גיבוב מסמך נשמר':''}</div>
    <div class="mut" style="margin-top:10px;color:#b00">מסמך דמו — לא לצורכי מע"מ (טרם רישום תוכנה ברשות המסים)</div>`}
   <div style="margin-top:12px"><button class="btn2" onclick="go('#/');route()">לדף הבית</button></div>
  </div></div>`;
}

async function route(){
 const seq=++routeSeq;
 if(orderPoll){clearInterval(orderPoll);orderPoll=null}
 document.querySelectorAll('.modal-ov').forEach(m=>m.remove());
 const h=location.hash||'#/';
 const [,path]=h.split('#');
 const [p,qstr]=path.split('?');
 const q=new URLSearchParams(qstr||'');
 const parts=p.split('/').filter(Boolean);
 let html='';
 $('#app').innerHTML='<div class="body"><div class="card mut" style="text-align:center;padding:40px 0">טוען…</div></div>';
 const tst=$('.toast');if(tst)tst.classList.remove('show');
 try{
  if(parts.length===0)html=state.brandSlug?await vLaundry(state.brandSlug):await vHome(q.get('q'));
  else if(parts[0]==='login')html=vLogin();
  else if(parts[0]==='laundry')html=await vLaundry(parts[1]);
  else if(parts[0]==='checkout')html=await vCheckout(parts[1]);
  else if(parts[0]==='orders'&&parts[1])html=await vOrder(parts[1]);
  else if(parts[0]==='orders')html=await vOrders();
  else if(parts[0]==='club')html=await vClub();
  else if(parts[0]==='courier')html=await vCourier(parts[1]);
  else if(parts[0]==='community')html=await vCommunity(parts[1],parts[2]);
 else if(parts[0]==='manage')html=await vManage(parts[1]);
  else if(parts[0]==='admin'&&parts[1]==='tenant')html=await vAdminTenant(parts[2]);
  else if(parts[0]==='admin')html=await vAdmin(parts[1]);
  else if(parts[0]==='join')html=await vJoin();
  else if(parts[0]==='pay')html=await vPay(parts[1]);
  else if(parts[0]==='verify')html=await vVerify(parts[1]);
  else html=`<div class="hdr"><h2>הדף לא נמצא</h2></div><div class="body"><div class="card" style="text-align:center"><div style="font-size:40px">🧺</div><b>404 — לא מצאנו את הדף הזה</b><div class="mut" style="margin:6px 0">הקישור אולי השתנה או שהוזן בטעות.</div><button class="btn" onclick="go('#/')">חזרה לדף הבית</button></div></div>`;
 }catch(e){
  if(e.status===401){state.token=null;state.me=null;state.memberships=[];state.courier=null;save();html=vLogin()}
  else html=`<div class="body"><div class="card warn">${esc(e.message)}</div></div>`;
 }
 if(seq!==routeSeq)return; // ניווט חדש יותר דורס רינדור ישן — נחיתה עקבית תמיד
 renderTabs(h.split('?')[0]);
 $('#app').innerHTML=html;
 if(parts[0]==='login')initGoogle();
 if(state.brandSlug)applyBrandTheme(state.brandSlug);
 const jf=$('#join-files');if(jf)jf.onchange=()=>joinExtract(jf.files);
 if(parts[0]==='checkout'&&__coAddrs.length===1){const sa=$('#co-saved-addr');if(sa){sa.value=__coAddrs[0].id;pickAddr(sa)}} // E13.T2: כתובת שמורה יחידה נבחרת אוטומטית
 window.scrollTo(0,0);
}
window.addEventListener('hashchange',route);
window.addEventListener('storage',e=>{
 if(e.key&&e.key.startsWith('wlm_')){
  state.token=store.get('token',null);state.me=store.get('me',null);state.memberships=store.get('memberships',[]);state.courier=store.get('courier',null);
  route();
 }
});
(async()=>{
 try{state.cfg=await api('/config')}catch(e){state.cfg={}}
 if(state.token){try{const me=await api('/auth/me');state.me=me.user;state.memberships=me.memberships||[];state.courier=me.courier||null;save()}catch(e){state.token=null;state.me=null;save()}}
 route();
})();

/* ---- E9.T1: דיווח תקלה עם תמונות ---- */
function openReportModal(orderId){
 const ov=document.createElement('div');ov.className='modal-ov';
 ov.innerHTML=`<div class="modal" role="dialog" aria-modal="true"><b>דיווח על תקלה</b>
  <label class="lb">סוג התקלה</label>
  <select class="inp" id="rp-kind"><option value="damage">נזק לכביסה</option><option value="missing">פריט חסר</option><option value="late">איחור</option><option value="other">אחר</option></select>
  <label class="lb">תיאור</label>
  <input class="inp" id="rp-text" placeholder="מה קרה?">
  <label class="lb">תמונות (עד 3)</label>
  <input class="inp" id="rp-photos" type="file" accept="image/jpeg,image/png,image/webp" multiple>
  <div class="mut" id="rp-pmsg" style="margin:4px 0"></div>
  <div style="display:flex;gap:8px;margin-top:14px"><button class="btn" id="rp-ok" style="flex:1">שליחת דיווח</button><button class="btn2" id="rp-cancel" style="flex:1">ביטול</button></div></div>`;
 document.body.appendChild(ov);
 ov.querySelector('#rp-cancel').onclick=()=>ov.remove();
 ov.onclick=e=>{if(e.target===ov)ov.remove()};
 ov.querySelector('#rp-ok').onclick=async()=>{
  const btn=ov.querySelector('#rp-ok');btn.disabled=true;
  try{
   const files=[...ov.querySelector('#rp-photos').files].slice(0,3);
   const photos=[];
   for(const f of files)photos.push(await fileToB64(f));
   await api('/orders/'+orderId+'/report',{method:'POST',body:JSON.stringify({kind:ov.querySelector('#rp-kind').value,text:ov.querySelector('#rp-text').value,photos:photos.length?photos:undefined})});
   ov.remove();toast('הדיווח נשלח — המכבסה תטפל');route();
  }catch(e){btn.disabled=false;ov.querySelector('#rp-pmsg').textContent=e.message}
 };
}
function fileToB64(f){
 return new Promise((res,rej)=>{
  if(!/^image\/(jpeg|png|webp)$/.test(f.type))return rej(new Error('סוג קובץ לא נתמך'));
  const img=new Image();
  img.onload=()=>{
   const MAX=1024,sc=Math.min(1,MAX/Math.max(img.width,img.height));
   const cv=document.createElement('canvas');cv.width=Math.round(img.width*sc);cv.height=Math.round(img.height*sc);
   cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);
   const url=cv.toDataURL('image/jpeg',0.8);
   URL.revokeObjectURL(img.src);
   res({content_type:'image/jpeg',data_b64:url.split(',')[1]});
  };
  img.onerror=()=>rej(new Error('לא ניתן לקרוא את התמונה'));
  img.src=URL.createObjectURL(f);
 });
}
async function openIssuePhoto(pid){
 try{
  const r=await fetch('/api/issue-photos/'+pid,{headers:state.token?{Authorization:'Bearer '+state.token}:{}});
  if(!r.ok)throw new Error('אין הרשאה לתמונה');
  const b=await r.blob();
  const w=window.open(URL.createObjectURL(b),'_blank');
  if(!w)toast('אפשרו חלונות קופצים לצפייה בתמונה');
 }catch(e){toast(e.message)}
}
async function tenantIssueHandle(slug,id){
 const v=await new Promise(resolve=>{
  const ov=document.createElement('div');ov.className='modal-ov';
  ov.innerHTML=`<div class="modal" role="dialog" aria-modal="true"><b>עדכון טיפול בתקלה</b>
   <div class="mut" style="margin:8px 0">בחרו סטטוס:</div>
   <div style="display:flex;gap:6px" id="ih-status">
    <button class="btn2 ih-st" data-v="open" style="flex:1">פתוח</button>
    <button class="btn2 ih-st on" data-v="in_progress" style="flex:1">בטיפול</button>
    <button class="btn2 ih-st" data-v="resolved" style="flex:1">טופל</button>
   </div>
   <label class="lb" style="margin-top:10px">תיעוד הטיפול</label><input class="inp" id="ih-note">
   <div style="display:flex;gap:8px;margin-top:14px"><button class="btn" id="ih-ok" style="flex:1">שמירה</button><button class="btn2" id="ih-cancel" style="flex:1">ביטול</button></div></div>`;
  document.body.appendChild(ov);
  ov.querySelectorAll('.ih-st').forEach(b=>b.onclick=()=>{ov.querySelectorAll('.ih-st').forEach(x=>x.classList.remove('on'));b.classList.add('on')});
  const done=v=>{ov.remove();resolve(v)};
  ov.querySelector('#ih-ok').onclick=()=>done({status:ov.querySelector('.ih-st.on').dataset.v,note:ov.querySelector('#ih-note').value});
  ov.querySelector('#ih-cancel').onclick=()=>done(null);
  ov.onclick=e=>{if(e.target===ov)done(null)};
 });
 if(!v)return;
 const med=await xconfirm('להסלים את התקלה לגישור אדמין הפלטפורמה?',{title:'הסלמה לגישור',okText:'כן, להסלים'});
 try{await api(`/t/${slug}/issues/${id}/handle`,{method:'POST',body:JSON.stringify({status:v.status,note:v.note||undefined,mediation:!!med})});toast('הטיפול עודכן');route()}catch(e){toast(e.message)}
}
async function adminIssueHandle(id){
 const v=await xmodal({title:'סיום גישור אדמין',okText:'סגירת תקלה',fields:[{id:'note',label:'תיעוד הגישור'}]});
 if(!v)return;
 try{await api(`/admin/issues/${id}/handle`,{method:'POST',body:JSON.stringify({status:'resolved',note:v.note||''})});toast('התקלה נסגרה בגישור');route()}catch(e){toast(e.message)}
}
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
