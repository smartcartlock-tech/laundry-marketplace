/* מכבסה בקליק — PWA מחובר ל-API אמיתי */
const $=s=>document.querySelector(s);
const store={
 get(k,d){try{const v=localStorage.getItem('wlm_'+k);return v?JSON.parse(v):d}catch(e){return d}},
 set(k,v){localStorage.setItem('wlm_'+k,JSON.stringify(v))},
 del(k){localStorage.removeItem('wlm_'+k)}
};
let state={token:store.get('token',null),me:store.get('me',null),cfg:null,cart:store.get('cart',[]),memberships:store.get('memberships',[]),courier:store.get('courier',null)};
function save(){store.set('token',state.token);store.set('me',state.me);store.set('cart',state.cart);store.set('memberships',state.memberships);store.set('courier',state.courier)}
function esc(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
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
 const r=await fetch('/api'+path,{...opts,headers:{'Content-Type':'application/json',...(state.token?{Authorization:'Bearer '+state.token}:{})}});
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
 if(state.memberships&&state.memberships.length)T.push(['#/manage','⚙','ניהול']);
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
  <div class="big">מכבסה בקליק</div><p>כל המכבסות באזורך — במקום אחד</p></div>
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
  const r=await api('/auth/otp/verify',{method:'POST',body:JSON.stringify({target:$('#login-target').value.trim(),code:$('#login-code').value.trim(),name:$('#login-name').value.trim()})});
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
async function vHome(q){
 let laundries=[];
 try{const r=await api('/laundries'+(q?'?q='+encodeURIComponent(q):''));laundries=r.laundries}catch(e){toast(e.message)}
 return `<div class="hdr" style="text-align:center;padding-top:26px">
  <div class="big">מכבסה בקליק</div>
  <p style="font-size:13px">כל המכבסות באזורך — במקום אחד</p>
  <div class="searchbar" style="margin-top:14px"><input id="q" placeholder="מכבסה, עיר, שירות…" value="${esc(q||'')}" onkeydown="if(event.key==='Enter')go('#/?q='+encodeURIComponent(this.value))"><button class="go" onclick="go('#/?q='+encodeURIComponent($('#q').value))">חיפוש</button></div>
 </div>
 <div class="body">
  <div style="margin:4px 2px 10px">
   <a class="chip ${!q?'on':''}" href="#/">הכל</a><a class="chip" href="#/?q=${encodeURIComponent('כביסה')}">כביסה</a><a class="chip" href="#/?q=${encodeURIComponent('ניקוי יבש')}">ניקוי יבש</a><a class="chip" href="#/?q=${encodeURIComponent('גיהוץ')}">גיהוץ</a><a class="chip" href="#/?q=${encodeURIComponent('שטיח')}">שטיחים</a>
  </div>
  ${laundries.map(l=>`<a class="card lcard" href="#/laundry/${l.slug}" style="cursor:pointer;text-decoration:none;color:inherit">
    <span class="logo" style="background:${l.color||'#0e7a8a'}">${esc(l.letter||l.name[0])}</span>
    <div style="flex:1">
     <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><b>${esc(l.name)}</b>${l.is_open?'<span class="tag tg">פתוח</span>':'<span class="tag to">סגור</span>'}</div>
     <div class="mut" style="margin-top:3px">${l.rating_count>=3?`<span class="stars">★</span> ${l.rating} (${l.rating_count}) · `:`<span class="tag tb">חדש</span> · `}${esc(l.city||'')}${l.from_price?' · החל מ־₪'+l.from_price:''}</div>
     <div class="mut">שליחות ₪${l.delivery_fee||0}${Number(l.min_order)>0?' · מינימום ₪'+l.min_order:''}</div>
    </div><span style="color:#8a99a3">‹</span></a>`).join('')||`<div class="card mut">לא נמצאו מכבסות מתאימות${q?` — <a href="#/" style="color:#0e7a8a">נקה חיפוש</a>`:''}</div>`}
  <div class="card" style="cursor:pointer;background:#e6f4f6;text-align:center" onclick="go('#/join')"><b style="color:#0e7a8a">＋ יש לך מכבסה? הצטרפו לפלטפורמה — גם בצילום מחירון בלבד</b></div>
  ${state.me?`<div class="card mut" style="text-align:center">מחובר כ${esc(state.me.name||state.me.phone||state.me.email)} · <a href="#/" onclick="logout();return false" style="color:#0e7a8a">התנתקות</a></div>`:''}
 </div>`;
}

async function vLaundry(slug){
 let d;
 try{d=await api('/laundries/'+slug)}catch(e){return `<div class="body"><div class="card">${esc(e.message)}</div></div>`}
 const l=d.laundry;
 let mySub=null;
 if(state.token){try{const sm=await api('/subscriptions/mine');mySub=sm.subscriptions.find(x=>x.slug===slug&&x.status!=='cancelled')}catch(e){}}
 const cartItems=state.cart.filter(c=>c.slug===slug);
 const cartTotal=cartItems.reduce((s,c)=>s+c.price*c.qty,0);
 const hoursTxt=Object.entries(l.hours||{}).map(([k,v])=>v&&v.length?`${WD[k]}: ${v.map(r=>'<span dir="ltr">'+r.join('–')+'</span>').join(', ')}`:null).filter(Boolean).join(' · ')||'—';
 return `<div class="hdr">
  <div style="display:flex;gap:12px;align-items:center">
   <a href="#/" style="color:#fff;font-size:20px;text-decoration:none" aria-label="חזרה">→</a>
   <span class="logo" style="background:${l.color||'#0e7a8a'}">${esc(l.letter||l.name[0])}</span>
   <div><h2>${esc(l.name)}</h2><p>${l.rating_count>=3?`<span class="stars">★</span> ${l.rating} (${l.rating_count} ביקורות) · `:`<span class="tag tb">מכבסה חדשה</span> · `}${esc(l.city||'')} · ${l.is_open?'פתוח':'סגור'}</p></div>
  </div>
 </div>
 <div class="body">
  <div class="subtabs"><button class="chip on" type="button">מחירון</button><button class="chip" type="button" onclick="document.getElementById('info').scrollIntoView({behavior:'smooth'})">מידע</button><button class="chip" type="button" onclick="document.getElementById('revs').scrollIntoView({behavior:'smooth'})">ביקורות</button></div>
  <div class="card">
   ${d.items.map(it=>{const c=state.cart.find(x=>x.item_id===it.id);return `<div class="row">
     <div><b>${esc(it.name)}</b><div class="mut">${esc(it.category)} · ₪${it.price}${it.unit==='item'?'':' ל'+unitLbl(it.unit)}</div></div>
     ${c?`<span class="stepper"><button onclick="setQty('${slug}','${it.id}',-1)">−</button><b>${c.qty}</b><button onclick="setQty('${slug}','${it.id}',1)">+</button></span>`
        :`<button class="btn2" onclick="setQty('${slug}','${it.id}',1)">הוספה</button>`}
    </div>`}).join('')||'<div class="mut">המחירון טרם הוזן</div>'}
  </div>
  ${cartItems.length?(cartTotal>=Number(l.min_order||0)?`<button class="btn" onclick="go('#/checkout/${slug}')">להזמנה · סל ₪${cartTotal}</button>`:`<button class="btn" disabled style="opacity:.6;cursor:not-allowed">חסרים ₪${Number(l.min_order)-cartTotal} למינימום הזמנה (₪${l.min_order}) · סל ₪${cartTotal}</button>`):''}
  ${(d.plans&&d.plans.length)||mySub?`<div class="sec">מנוי כביסה חודשי</div>
  <div class="card">
   ${mySub?`<div class="row"><div><b>יש לך ${esc(mySub.plan_name)}</b> ${mySub.status==='paused'?'(מושהה)':''}<div class="mut">נותרו ${fmtQ(mySub.bags_remaining)} שקים החודש · מתחדש ${fmtDate(mySub.period_end)}</div></div><a class="btn2" href="#/club" style="text-decoration:none">ניהול המנוי</a></div>`
    :(d.plans||[]).map(p=>`<div class="row"><div><b>${esc(p.name)}</b><div class="mut">${p.bags_per_month} שקים בחודש (עד ${fmtQ(p.kg_per_bag)} ק״ג לשק) · איסוף והחזרה חינם${p.extra_bag_price?' · שק חורג ₪'+p.extra_bag_price:''}${p.perks?' · '+esc(p.perks):''}</div></div><div style="text-align:center"><b>₪${p.price}</b><div class="mut">לחודש</div></div><button class="btn2 on" onclick="joinPlan('${slug}','${p.id}')">הצטרפות</button></div>`).join('')}
  </div>`:''}
  <div class="sec" id="info">מידע</div>
  <div class="card mut" style="line-height:1.8">
   שעות פעילות:<br>${Object.entries(l.hours||{}).map(([k,v])=>v&&v.length?`${WD[k]}: ${v.map(r=>'<span dir="ltr">'+r.join('–')+'</span>').join(', ')}`:null).filter(Boolean).join('<br>')||'—'}<br>
   ${l.address?`כתובת: ${esc(l.address)}${l.city?', '+esc(l.city):''}<br>`:''}
   ${l.phone?`טלפון: <a href="tel:${esc(l.phone)}" style="color:#0e7a8a" dir="ltr">${esc(l.phone)}</a><br>`:''}
   ${l.terms?`תקנון: ${esc(l.terms)}`:''}
  </div>
  <div class="sec" id="revs">ביקורות</div>
  <div class="card">${d.reviews.map(rv=>`<div class="row"><div><b>${esc(rv.author||'לקוח')}</b> <span class="stars">${'★'.repeat(rv.rating)}</span><div class="mut">${esc(rv.text||'')}</div></div></div>`).join('')||'<div class="mut">עוד אין ביקורות</div>'}</div>
 </div>`;
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
   <label class="lb">כתובת לאיסוף והחזרה</label>
   <input class="inp" id="co-address" placeholder="רחוב, מספר, עיר" oninput="this.style.borderColor='';const e=document.getElementById('co-address-err');if(e)e.remove()">
   <label class="lb">חלון איסוף</label>
   <select class="inp" id="co-pickup"><option value="">ללא העדפה</option>${winOpts('pickup')}</select>
   <label class="lb">חלון החזרה (אופציונלי)</label>
   <select class="inp" id="co-delivery"><option value="">ללא העדפה</option>${winOpts('delivery')}</select>
   <label class="lb">אמצעי תשלום</label>
   <select class="inp" id="co-pay"><option value="cash">מזומן לשליח</option><option value="demo_online">תשלום מקוון (דמו — ללא סליקה אמיתית)</option></select>
   <label class="lb">הערות</label>
   <input class="inp" id="co-notes" placeholder="כתם עקשן, קומה, קוד שער…">
  </div>
  <button class="btn" onclick="submitOrder('${slug}')">אישור הזמנה</button>
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
async function submitOrder(slug){
 if(!state.token)return needLogin();
 try{
  const items=state.cart.filter(c=>c.slug===slug).map(c=>({item_id:c.item_id,qty:c.qty}));
  const addrEl=$('#co-address');const address=addrEl.value.trim();
  if(!address){addrEl.style.borderColor='#c22';let ie=$('#co-address-err');if(!ie){ie=document.createElement('div');ie.id='co-address-err';ie.className='mut';ie.style.color='#c22';ie.textContent='חסרה כתובת לאיסוף והחזרה';addrEl.after(ie)}addrEl.focus();return}
  addrEl.style.borderColor='';const ie=$('#co-address-err');if(ie)ie.remove();
  const w=($('#co-pickup').value||'').split('|');
  const pickup_at=w.length===2?nextWindowDate(Number(w[0]),w[1]):null;
  const w2=($('#co-delivery')&&$('#co-delivery').value||'').split('|');
  const delivery_at=w2.length===2?nextWindowDate(Number(w2[0]),w2[1]):null;
  const body={slug,items,address,pickup_at,delivery_at,payment_method:$('#co-pay').value,redeem_points:!!($('#redeem')&&$('#redeem').checked),coupon_code:window.__coCoupon?window.__coCoupon.code:undefined,notes:$('#co-notes').value.trim(),use_subscription:!!($('#co-sub')&&$('#co-sub').checked)};
  const r=await api('/orders',{method:'POST',body:JSON.stringify(body)});
  state.cart=state.cart.filter(c=>c.slug!==slug);save();
  toast('ההזמנה נקלטה!');go('#/orders/'+r.order.id);
 }catch(e){toast(e.message)}
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
    <span style="color:#8a99a3">‹</span></div>`).join('')||'<div class="card mut">עוד אין הזמנות. <a href="#/" style="color:#0e7a8a">להתחיל</a></div>'}
 </div>`;
}
async function vOrder(id){
 if(!state.token)return needLogin();
 const d=await api('/orders/'+id);
 const o=d.order;
 const idx=FLOW.indexOf(o.status);
 const isMine=o.customer_id===(state.me&&state.me.id);
 let docs=[];
 if(isMine){try{const dd=await api('/documents/mine');docs=dd.documents.filter(x=>x.order_id===id||(x.covered_order_ids||[]).includes(id))}catch(e){}}
 return `<div class="hdr"><h2><a href="#/orders" style="color:#fff;text-decoration:none" aria-label="חזרה">→</a> הזמנה <span dir="ltr">#${o.id.slice(0,8)}</span></h2><p>${esc(o.tenant_name)} · ${fmtDT(o.created_at)}</p></div>
 <div class="body">
  <div class="card">
   <div class="tl">
    ${FLOW.map((s,i)=>`<div class="stop ${i<idx?'done':i===idx?'now':''}"><b style="font-size:13px">${HE[s]}</b>${i===idx?`<div class="mut">${fmtDT(o.updated_at)}</div>`:''}</div>`).join('')}
   </div>
  </div>
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
  ${isMine&&o.status==='delivered'?`<div class="card"><label class="lb">דרגו את ההזמנה</label>
    <select class="inp" id="rv-rating"><option>5</option><option>4</option><option>3</option><option>2</option><option>1</option></select>
    <input class="inp" id="rv-text" placeholder="איך היה?">
    ${o.courier_id?`<label class="lb" style="margin-top:8px">דרגו את השליח</label>
    <div style="display:flex;gap:6px;align-items:center"><select class="inp" id="rv-courier" style="width:90px"><option value="">—</option><option>5</option><option>4</option><option>3</option><option>2</option><option>1</option></select>
    <div style="display:flex;gap:4px;flex-wrap:wrap">${['בזמן','אדיב','זהיר עם הכביסה','איחור','לא עדכן'].map(t=>`<label class="chip" style="cursor:pointer"><input type="checkbox" class="rv-ctag" value="${t}" style="margin-left:3px">${t}</label>`).join('')}</div></div>`:''}
    <button class="btn2 on" onclick="sendReview('${o.id}')">שליחת דירוג</button></div>`:''}
 </div>`;
}
async function cancelOrder(id){if(!await xconfirm('לא ניתן לשחזר הזמנה לאחר הביטול.',{title:'ביטול הזמנה',okText:'כן, לבטל את ההזמנה'}))return;try{await api('/orders/'+id+'/cancel',{method:'POST',body:'{}'});toast('ההזמנה בוטלה');route()}catch(e){toast(e.message)}}
async function sendReview(id){try{const ctags=[...document.querySelectorAll('.rv-ctag:checked')].map(x=>x.value);const cr=$('#rv-courier')?$('#rv-courier').value:'';await api('/orders/'+id+'/review',{method:'POST',body:JSON.stringify({rating:$('#rv-rating').value,text:$('#rv-text').value,courier_rating:cr||undefined,courier_tags:ctags.length?ctags:undefined})});toast('תודה על הדירוג!');route()}catch(e){toast(e.message)}}

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
  <div class="sec">נקודות</div>
  ${d.balances.map(b=>`<div class="card lcard"><span class="logo sm" style="background:${b.color||'#0e7a8a'}">${esc(b.letter||'מ')}</span>
   <div style="flex:1"><b>${esc(b.name)}</b><div class="mut">יתרה: <b style="color:#0e7a8a">${b.balance}</b> נקודות (שוות ₪${b.balance})</div></div></div>`).join('')||'<div class="card mut">עוד אין נקודות — כל הזמנה צוברת</div>'}
  <div class="sec">תנועות אחרונות</div>
  <div class="card">${d.recent.map(p=>`<div class="row"><div>${esc(p.name)}<div class="mut">${esc(p.reason||'')}</div></div><div style="color:${p.delta>0?'#178a4c':'#c22'};font-weight:700">${p.delta>0?'+':''}${p.delta}</div></div>`).join('')||'<div class="mut">אין תנועות</div>'}</div>
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
async function vManage(sub){
 if(!state.token)return needLogin();
 const me=await api('/auth/me');
 state.memberships=me.memberships||[];save();
 const mems=me.memberships||[];
 const m=mems.find(x=>x.slug===store.get('lastTenant',''))||mems[0];
 const slug=m&&m.slug;
 if(!slug)return `<div class="hdr"><h2>לוח ניהול מכבסה</h2></div><div class="body"><div class="card mut">${me.courier?'החשבון שלך רשום כשליח — לוח הניהול מיועד לבעלי מכבסות. המשימות שלך בלשונית ״שליח״.':`החשבון אינו מקושר למכבסה. <a href="#/join" style="color:#0e7a8a">להצטרפות כמכבסה</a>`}</div></div>`;
 sub=sub||'orders';
 const tabs=[['orders','הזמנות'],['items','מחירון'],['windows','חלונות'],['coupons','קופונים'],['subs','מנויים'],['documents','מסמכים'],['couriers','שליחים'],['customers','לקוחות'],['stats','דוחות'],['settings','הגדרות']];
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
  const v=await xmodal({title:'שינוי תוכנית',body:d.plans.map((p,i)=>`${i+1}. ${esc(p.name)} — ${p.bags_per_month} שקים, ₪${p.price}/חודש`).join('<br>'),okText:'שינוי',fields:[{id:'idx',label:'מספר תוכנית (1-'+d.plans.length+')'}]});
  if(!v)return;
  const p=d.plans[Number(v.idx)-1];if(!p)return toast('בחירה לא תקינה');
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
 const tabs=[['overview','תמונת מצב'],['tenants','מכבסות'],['couriers','שליחים'],['routes','מסלולים'],['register','רישום שליח'],['orders','הזמנות'],['weekly','דוח שבועי']];
 let body='';
 if(sub==='overview'){
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

/* ---- router ---- */

async function vVerify(code){
 const ST={issued:'st-delivered',partially_credited:'st-out_for_delivery',credited:'st-cancelled'};
 let d=null,notFound=false;
 try{d=await api(`/verify/${encodeURIComponent(code||'')}`)}catch(e){if(e.status===404)notFound=true;else throw e}
 const ok=d&&!notFound&&d.status!=='credited';
 return `<div class="hdr"><h2>אימות מסמך</h2></div><div class="body">
  <div class="card" style="text-align:center">
   <div style="font-size:44px">${ok?'✅':notFound?'❓':'⚠️'}</div>
   ${notFound?`<b>המסמך לא נמצא</b><div class="mut" style="margin-top:6px">בדקו שהקוד הוזן כראוי או סרקו שוב את ה-QR.</div>`
   :`<b>${d.kind_he} ${d.doc_number}/${d.doc_year}</b>
    <div style="margin:6px 0"><span class="st-pill ${ST[d.status]||''}">${d.status_he}</span></div>
    <div class="mut">${esc(d.tenant_name)} · ${esc(d.customer_name||'לקוח')}</div>
    <div style="font-size:22px;font-weight:700;margin:6px 0">₪${d.total}</div>
    <div class="mut">הופק ב-${new Date(d.issued_at).toLocaleDateString('he-IL')}${d.orders_count?` · מכסה ${d.orders_count} הזמנות`:''}</div>
    <div class="mut" style="margin-top:10px;color:#b00">מסמך דמו — לא לצורכי מע"מ (טרם רישום תוכנה ברשות המסים)</div>`}
   <div style="margin-top:12px"><button class="btn2" onclick="go('#/');route()">לדף הבית</button></div>
  </div></div>`;
}

async function route(){
 const seq=++routeSeq;
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
  if(parts.length===0)html=await vHome(q.get('q'));
  else if(parts[0]==='login')html=vLogin();
  else if(parts[0]==='laundry')html=await vLaundry(parts[1]);
  else if(parts[0]==='checkout')html=await vCheckout(parts[1]);
  else if(parts[0]==='orders'&&parts[1])html=await vOrder(parts[1]);
  else if(parts[0]==='orders')html=await vOrders();
  else if(parts[0]==='club')html=await vClub();
  else if(parts[0]==='courier')html=await vCourier(parts[1]);
  else if(parts[0]==='manage')html=await vManage(parts[1]);
  else if(parts[0]==='admin'&&parts[1]==='tenant')html=await vAdminTenant(parts[2]);
  else if(parts[0]==='admin')html=await vAdmin(parts[1]);
  else if(parts[0]==='join')html=await vJoin();
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
 const jf=$('#join-files');if(jf)jf.onchange=()=>joinExtract(jf.files);
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
