/* מכבסה בקליק — PWA מחובר ל-API אמיתי */
const $=s=>document.querySelector(s);
const store={
 get(k,d){try{const v=localStorage.getItem('wlm_'+k);return v?JSON.parse(v):d}catch(e){return d}},
 set(k,v){localStorage.setItem('wlm_'+k,JSON.stringify(v))},
 del(k){localStorage.removeItem('wlm_'+k)}
};
let state={token:store.get('token',null),me:store.get('me',null),cfg:null,cart:store.get('cart',[])};
function save(){store.set('token',state.token);store.set('me',state.me);store.set('cart',state.cart)}
function esc(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
let toastTimer=null;
function toast(m){let t=$('.toast');if(!t){t=document.createElement('div');t.className='toast';document.body.appendChild(t)}t.textContent=m;t.classList.add('show');if(toastTimer)clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),4000)}
async function api(path,opts={}){
 const r=await fetch('/api'+path,{...opts,headers:{'Content-Type':'application/json',...(state.token?{Authorization:'Bearer '+state.token}:{})}});
 const data=await r.json().catch(()=>({}));
 if(!r.ok){const err=new Error(data.error||('שגיאה '+r.status));err.status=r.status;throw err}
 return data;
}
function go(h){location.hash=h}
const HE={new:'התקבלה',confirmed:'אושרה',picked_up:'נאספה',in_work:'בעבודה',ready:'מוכנה',out_for_delivery:'בדרך',delivered:'הוחזרה',cancelled:'בוטלה'};
const FLOW=['new','confirmed','picked_up','in_work','ready','out_for_delivery','delivered'];
const WD=['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
function fmtDT(s){if(!s)return '—';const d=new Date(s);return d.toLocaleDateString('he-IL',{weekday:'short',day:'numeric',month:'numeric'})+' '+d.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})}
function nextWindowDate(weekday,timeStr){
 const d=new Date();const[hh,mm]=timeStr.split(':').map(Number);
 d.setHours(hh,mm,0,0);
 while(d.getDay()!==weekday||d<new Date())d.setDate(d.getDate()+1);
 return d.toISOString();
}

/* ---- tabs ---- */
function renderTabs(route){
 const T=[['#/','⌂','בית'],['#/orders','▤','הזמנות'],['#/club','★','מועדון'],['#/courier','▸','שליח'],['#/manage','⚙','ניהול']];
 if(state.me&&state.me.role==='admin')T.push(['#/admin','▣','אדמין']);
 $('#tabs').innerHTML='<div class="in">'+T.map(t=>`<a href="${t[0]}" class="${route===t[0]||(t[0]!=='#/'&&route.startsWith(t[0]))?'on':''}"><span class="ic">${t[1]}</span>${t[2]}</a>`).join('')+'</div>';
}

/* ---- auth ---- */
function vLogin(){
 const gbtn=state.cfg&&state.cfg.googleClientId?`<div id="g-signin" style="margin-top:10px"></div>`:'';
 const demoNote=state.cfg&&state.cfg.demoOtp?`<div class="note" style="margin-top:10px">מצב הדגמה: הקוד יוצג על המסך (בפרודקשן נשלח בוואטסאפ${state.cfg.whatsappOtp?' — פעיל':' — לא מוגדר'}).</div>`:'';
 return `<div class="hdr" style="text-align:center;padding-top:34px">
  <div class="big">מכבסה בקליק</div><p>כל המכבסות באזורך — במקום אחד</p></div>
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
   <input class="inp" id="login-code" inputmode="numeric" maxlength="6" placeholder="••••••">
   <label class="lb">שם (בהרשמה ראשונה)</label>
   <input class="inp" id="login-name" placeholder="השם שלך">
   <button class="btn" onclick="verifyOtp()">כניסה</button>`;
 }catch(e){toast(e.message)}
}
async function verifyOtp(){
 try{
  const r=await api('/auth/otp/verify',{method:'POST',body:JSON.stringify({target:$('#login-target').value.trim(),code:$('#login-code').value.trim(),name:$('#login-name').value.trim()})});
  state.token=r.token;state.me=r.user;save();
  const rt=store.get('returnTo','#/');store.del('returnTo');go(rt);route();
 }catch(e){toast(e.message)}
}
function needLogin(){store.set('returnTo',location.hash||'#/');return vLogin()}
function initGoogle(){
 if(!state.cfg||!state.cfg.googleClientId||!window.google||!google.accounts)return;
 google.accounts.id.initialize({client_id:state.cfg.googleClientId,callback:async(resp)=>{
  try{
   const r=await api('/auth/google',{method:'POST',body:JSON.stringify({credential:resp.credential})});
   state.token=r.token;state.me=r.user;save();const rt=store.get('returnTo','#/');store.del('returnTo');go(rt);route();
  }catch(e){toast(e.message)}
 }});
 const el=document.getElementById('g-signin');
 if(el)google.accounts.id.renderButton(el,{theme:'outline',size:'large',width:320,text:'signin_with',locale:'he'});
}
function logout(){state.token=null;state.me=null;store.del('token');store.del('me');go('#/login');route()}

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
 const cartItems=state.cart.filter(c=>c.slug===slug);
 const cartTotal=cartItems.reduce((s,c)=>s+c.price*c.qty,0);
 const hoursTxt=Object.entries(l.hours||{}).map(([k,v])=>v&&v.length?`${WD[k]}: ${v.map(r=>r.join('–')).join(', ')}`:null).filter(Boolean).join(' · ')||'—';
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
     <div><b>${esc(it.name)}</b><div class="mut">${esc(it.category)} · ₪${it.price}${it.unit==='kg'?' לק״ג':''}</div></div>
     ${c?`<span class="stepper"><button onclick="setQty('${slug}','${it.id}',-1)">−</button><b>${c.qty}</b><button onclick="setQty('${slug}','${it.id}',1)">+</button></span>`
        :`<button class="btn2" onclick="setQty('${slug}','${it.id}',1)">הוספה</button>`}
    </div>`}).join('')||'<div class="mut">המחירון טרם הוזן</div>'}
  </div>
  ${cartItems.length?(cartTotal>=Number(l.min_order||0)?`<button class="btn" onclick="go('#/checkout/${slug}')">להזמנה · סל ₪${cartTotal}</button>`:`<button class="btn" disabled style="opacity:.6;cursor:not-allowed">חסרים ₪${Number(l.min_order)-cartTotal} למינימום הזמנה (₪${l.min_order}) · סל ₪${cartTotal}</button>`):''}
  <div class="sec" id="info">מידע</div>
  <div class="card mut" style="line-height:1.8">
   שעות פעילות:<br>${Object.entries(l.hours||{}).map(([k,v])=>v&&v.length?`${WD[k]}: ${v.map(r=>r.join('–')).join(', ')}`:null).filter(Boolean).join('<br>')||'—'}<br>
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
 const d=await api('/laundries/'+slug);
 const l=d.laundry;
 const items=state.cart.filter(c=>c.slug===slug);
 if(!items.length){go('#/laundry/'+slug);return ''}
 const subtotal=items.reduce((s,c)=>s+c.price*c.qty,0);
 let points=0;
 try{const cl=await api('/orders/club/summary');const b=cl.balances.find(x=>x.slug===slug);points=b?b.balance:0}catch(e){}
 const maxRedeem=Math.min(points,Math.floor(subtotal*(l.points_redeem_max_pct??0.2)));
 const winOpts=kind=>d.windows.filter(w=>w.kind===kind).map(w=>{const dt=new Date(nextWindowDate(w.weekday,w.start_time));const dstr=dt.toLocaleDateString('he-IL',{day:'numeric',month:'numeric'});return `<option value="${w.weekday}|${w.start_time}">${WD[w.weekday]} ${dstr} · ${w.start_time.slice(0,5)}–${w.end_time.slice(0,5)}</option>`}).join('');
 return `<div class="hdr"><h2><a href="#/laundry/${slug}" style="color:#fff;text-decoration:none" aria-label="חזרה">→</a> הזמנה — ${esc(l.name)}</h2></div>
 <div class="body">
  <div class="card">
   ${items.map(c=>`<div class="row"><div>${esc(c.name)}</div><div>${c.qty}${c.unit==='kg'?' ק״ג':''} × ₪${c.price}</div></div>`).join('')}
   <div class="row"><div class="mut">סכום ביניים</div><div>₪${subtotal}</div></div>
   <div class="row"><div class="mut">שליחות</div><div>₪${l.delivery_fee||0}</div></div>
   <div class="row" id="co-discount-row" style="display:none"><div class="mut">הנחת נקודות</div><div id="co-discount">−₪0</div></div>
   <div class="row" style="border-top:2px solid #d3e8ec"><b>סה״כ לתשלום</b><b id="co-total" style="font-size:17px" data-base="${subtotal+Number(l.delivery_fee||0)}" data-redeem="${maxRedeem}">₪${subtotal+Number(l.delivery_fee||0)}</b></div>
   <div class="row"><div class="mut">נקודות במכבסה זו: ${points}</div><div>${maxRedeem>0?`<label style="font-size:12px"><input type="checkbox" id="redeem" onchange="updTotal()"> מימוש ${maxRedeem} נקודות (−₪${maxRedeem})</label>`:'<span class="mut">אין נקודות למימוש כאן</span>'}</div></div>
  </div>
  <div class="card">
   <label class="lb">כתובת לאיסוף והחזרה</label>
   <input class="inp" id="co-address" placeholder="רחוב, מספר, עיר">
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
function updTotal(){const t=$('#co-total');if(!t)return;const on=$('#redeem')&&$('#redeem').checked;const disc=on?Number(t.dataset.redeem):0;$('#co-discount').textContent='−₪'+disc;$('#co-discount-row').style.display=disc?'flex':'none';t.textContent='₪'+(Number(t.dataset.base)-disc)}
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
  const body={slug,items,address,pickup_at,delivery_at,payment_method:$('#co-pay').value,redeem_points:!!($('#redeem')&&$('#redeem').checked),notes:$('#co-notes').value.trim()};
  const r=await api('/orders',{method:'POST',body:JSON.stringify(body)});
  state.cart=state.cart.filter(c=>c.slug!==slug);save();
  toast('ההזמנה נקלטה!');go('#/orders/'+r.order.id);route();
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
    <div class="mut">${fmtDT(o.created_at)} · ₪${o.total}</div></div>
    <span style="color:#8a99a3">‹</span></div>`).join('')||'<div class="card mut">עוד אין הזמנות. <a href="#/" style="color:#0e7a8a">להתחיל</a></div>'}
 </div>`;
}
async function vOrder(id){
 if(!state.token)return needLogin();
 const d=await api('/orders/'+id);
 const o=d.order;
 const idx=FLOW.indexOf(o.status);
 const isMine=o.customer_id===(state.me&&state.me.id);
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
   <div class="mut">כתובת: ${esc(o.address)}${o.pickup_at?' · איסוף: '+fmtDT(o.pickup_at):''}</div>
  </div>
  ${isMine&&['new','confirmed'].includes(o.status)?`<button class="btn2" style="border-color:#f3c2c2;color:#c22;background:#fdeaea" onclick="cancelOrder('${o.id}')">ביטול הזמנה</button>`:''}
  ${isMine&&o.status==='delivered'?`<div class="card"><label class="lb">דרגו את ההזמנה</label>
    <select class="inp" id="rv-rating"><option>5</option><option>4</option><option>3</option><option>2</option><option>1</option></select>
    <input class="inp" id="rv-text" placeholder="איך היה?">
    <button class="btn2 on" onclick="sendReview('${o.id}')">שליחת דירוג</button></div>`:''}
 </div>`;
}
async function cancelOrder(id){if(!confirm('לבטל את ההזמנה? לא ניתן לשחזר לאחר הביטול.'))return;try{await api('/orders/'+id+'/cancel',{method:'POST',body:'{}'});toast('ההזמנה בוטלה');route()}catch(e){toast(e.message)}}
async function sendReview(id){try{await api('/orders/'+id+'/review',{method:'POST',body:JSON.stringify({rating:$('#rv-rating').value,text:$('#rv-text').value})});toast('תודה על הדירוג!');route()}catch(e){toast(e.message)}}

/* ---- club ---- */
async function vClub(){
 if(!state.token)return needLogin();
 const d=await api('/orders/club/summary');
 return `<div class="hdr"><h2>מועדון לקוחות</h2> <p>הנקודות נצברות וניתנות למימוש בכל מכבסה בנפרד — ושוות כסף בהזמנה הבאה</p></div>
 <div class="body">
  ${d.balances.map(b=>`<div class="card lcard"><span class="logo sm" style="background:${b.color||'#0e7a8a'}">${esc(b.letter||'מ')}</span>
   <div style="flex:1"><b>${esc(b.name)}</b><div class="mut">יתרה: <b style="color:#0e7a8a">${b.balance}</b> נקודות (שוות ₪${b.balance})</div></div></div>`).join('')||'<div class="card mut">עוד אין נקודות — כל הזמנה צוברת</div>'}
  <div class="sec">תנועות אחרונות</div>
  <div class="card">${d.recent.map(p=>`<div class="row"><div>${esc(p.name)}<div class="mut">${esc(p.reason||'')}</div></div><div style="color:${p.delta>0?'#178a4c':'#c22'};font-weight:700">${p.delta>0?'+':''}${p.delta}</div></div>`).join('')||'<div class="mut">אין תנועות</div>'}</div>
 </div>`;
}

/* ---- courier ---- */
async function vCourier(){
 if(!state.token)return needLogin();
 let me;try{me=await api('/auth/me')}catch(e){return needLogin()}
 if(!me.courier)return `<div class="hdr"><h2>אפליקציית שליח</h2></div><div class="body"><div class="card mut">החשבון שלך אינו רשום כשליח. שליח מכבסה נרשם דרך לוח המכבסה; שליח פלטפורמה דרך מנהל הפלטפורמה.</div></div>`;
 const [offers,route,profile]=await Promise.all([api('/courier/offers'),api('/courier/route'),api('/courier/profile')]);
 return `<div class="hdr"><h2>שלום ${esc(me.user.name||'')}</h2><p>${me.courier.model==='platform'?'שליח פלטפורמה':me.courier.model==='shared'?'שליח משותף':'שליח מכבסה'} · ${profile.stats.delivered} מסירות בוצעו</p></div>
 <div class="body">
  ${offers.offers.length?`<div class="sec">הצעות שיבוץ חדשות</div>${offers.offers.map(o=>`
   <div class="card"><b>${esc(o.tenant_name)}</b> — הזמנה <span dir="ltr">#${o.order_id.slice(0,8)}</span>
    <div class="mut">${esc(o.address)} · ${o.kind==='pickup'?'איסוף':'החזרה'} · ₪${o.total}</div>
    ${o.pickup_at?`<div class="mut">איסוף: ${fmtDT(o.pickup_at)}</div>`:''}${o.delivery_at?`<div class="mut">החזרה: ${fmtDT(o.delivery_at)}</div>`:''}
    <div class="mut">איסוף מ: ${esc(o.tenant_address||'')}${o.tenant_city?', '+esc(o.tenant_city):''}</div>
    <div style="display:flex;gap:8px;margin-top:8px">
     <button class="btn2 green" onclick="offerAction('${o.offer_id}','accept')">אישור</button>
     <button class="btn2" onclick="offerAction('${o.offer_id}','decline')">דחייה</button>
    </div></div>`).join('')}`:''}
  <div class="sec">מסלול פעיל</div>
  ${route.route.map(o=>`<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center">
     <div><b>${esc(o.customer_name||'לקוח')}</b> <span class="st-pill st-${o.status}">${HE[o.status]}</span>
      <div class="mut">${esc(o.address)}</div>
      <div class="mut">${esc(o.tenant_name)} · ${esc(o.tenant_address||'')}</div>
      <div class="mut">${o.payment_method==='cash'&&o.payment_status!=='paid_cash'?'💵 לגבות ₪'+o.total+' במזומן':'שולם/דמו'}</div>
     </div>
     <a class="btn2" href="https://waze.com/ul?q=${encodeURIComponent(o.address)}" target="_blank">ניווט</a>
    </div>
    <div style="display:flex;gap:8px;margin-top:8px">
     ${o.status==='confirmed'?`<button class="btn2 on" onclick="markOrder('${o.id}','picked_up')">סימון נאסף</button>`:''}
     ${['ready','out_for_delivery'].includes(o.status)?`<button class="btn2 green" onclick="markOrder('${o.id}','delivered')">סימון הוחזר</button>`:''}
    </div>
   </div>`).join('')||'<div class="card mut">אין משימות פעילות כרגע. משימות חדשות מגיעות כהצעות שיבוץ — <a href="javascript:route()" style="color:#0e7a8a">רענון</a></div>'}
 </div>`;
}
async function offerAction(id,a){try{await api(`/courier/offers/${id}/${a}`,{method:'POST',body:'{}'});toast(a==='accept'?'שובצת!':'נדחה');route()}catch(e){toast(e.message)}}
async function markOrder(id,a){try{await api(`/courier/orders/${id}/mark`,{method:'POST',body:JSON.stringify({action:a})});toast(a==='picked_up'?'סומן כנאסף':'סומן כהוחזר');route()}catch(e){toast(e.message)}}

/* ---- manage (owner) ---- */
async function vManage(sub){
 if(!state.token)return needLogin();
 const me=await api('/auth/me');
 const slug=me.memberships[0]&&me.memberships[0].slug;
 if(!slug)return `<div class="hdr"><h2>לוח ניהול מכבסה</h2></div><div class="body"><div class="card mut">${me.courier?'החשבון שלך רשום כשליח — לוח הניהול מיועד לבעלי מכבסות. המשימות שלך בלשונית ״שליח״.':`החשבון אינו מקושר למכבסה. <a href="#/join" style="color:#0e7a8a">להצטרפות כמכבסה</a>`}</div></div>`;
 sub=sub||'orders';
 const tabs=[['orders','הזמנות'],['items','מחירון'],['windows','חלונות'],['couriers','שליחים'],['customers','לקוחות'],['stats','דוחות'],['settings','הגדרות']];
 let body='';
 if(sub==='orders'){
  const d=await api(`/t/${slug}/orders`);
  const NEXT={new:'confirmed',confirmed:'picked_up',picked_up:'in_work',in_work:'ready',ready:'out_for_delivery',out_for_delivery:'delivered'};
  body=d.orders.map(o=>`<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
     <div><b dir="ltr">#${o.id.slice(0,8)}</b> ${esc(o.customer_name||'')} <span class="st-pill st-${o.status}">${HE[o.status]}</span>
      <div class="mut">${fmtDT(o.created_at)} · ₪${o.total} · ${esc(o.address)}${o.source==='bot'?' · מהבוט':''}</div>
      ${o.payment_method==='cash'&&o.payment_status==='pending'?'<div class="mut">💵 גבייה במזומן</div>':''}
     </div>
     <div style="display:flex;gap:6px">
      ${NEXT[o.status]?`<button class="btn2 on" onclick="setStatus('${slug}','${o.id}','${NEXT[o.status]}')">העבר ל״${HE[NEXT[o.status]]}״</button>`:''}
      ${!['delivered','cancelled'].includes(o.status)?`<button class="btn2" onclick="setStatus('${slug}','${o.id}','cancelled')">ביטול</button>`:''}
      ${['new','confirmed','ready'].includes(o.status)?(o.courier_id?'<span class="tag tg">שובץ שליח</span>':`<button class="btn2" onclick="assignCourier('${slug}','${o.id}',this)">שיבוץ שליח</button>`):''}
     </div>
    </div></div>`).join('')||'<div class="card mut">אין הזמנות</div>';
 } else if(sub==='items'){
  const d=await api(`/t/${slug}/items`);
  body=`<div class="card">
    <label class="lb">פריט חדש</label>
    <input class="inp" id="it-name" placeholder="שם הפריט">
    <div style="display:flex;gap:8px"><input class="inp" id="it-price" type="number" placeholder="מחיר ₪" style="flex:1">
    <select class="inp" id="it-unit" style="flex:1"><option value="item">ליחידה</option><option value="kg">לק״ג</option></select>
    <select class="inp" id="it-cat" style="flex:1"><option>כביסה</option><option>ניקוי יבש</option><option>גיהוץ</option><option>שטיחים</option><option>אחר</option></select></div>
    <button class="btn2 on" onclick="addItem('${slug}')">הוספה</button></div>
   <div class="card">${d.items.map(i=>`<div class="row"><div style="${i.active?'':'opacity:.4'}">${esc(i.name)}<div class="mut">${esc(i.category)} · ${i.unit==='kg'?'לק״ג':'ליחידה'}</div></div>
    <div>₪${i.price} <button class="btn2" onclick="editItem('${slug}','${i.id}',this)" data-name="${esc(i.name)}" data-price="${i.price}">עריכה</button> <button class="btn2" onclick="delItem('${slug}','${i.id}')">${i.active?'הסתרה':'החזרה'}</button></div></div>`).join('')}</div>`;
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
 } else if(sub==='couriers'){
  const d=await api(`/t/${slug}/couriers`);
  body=`<div class="card">${d.couriers.map(c=>`<div class="row"><div><b>${esc(c.name)}</b> <span class="tag tb">${c.model==='platform'?'פלטפורמה':c.model==='shared'?'משותף':'פרטי'}</span>
    <div class="mut">${esc(c.phone||'')} · ${esc(c.vehicle||'')} · ${c.active_orders} פעילות · ★${c.rating||'—'}</div></div></div>`).join('')||'<div class="mut">אין שליחים — מנהל הפלטפורמה יכול לרשום שליח פרטי או שתוכלו לשבץ שליח פלטפורמה</div>'}</div>
   <div class="note">לרישום שליח מכבסה חדש פנו כרגע למנהל הפלטפורמה (בקרוב: רישום עצמי מהלוח).</div>`;
 } else if(sub==='customers'){
  const d=await api(`/t/${slug}/customers`);
  body=`<div class="card"><table class="tbl"><tr><th>לקוח</th><th>הזמנות</th><th>₪</th><th>נקודות</th></tr>
   ${d.customers.map(c=>`<tr><td>${esc(c.name||'') }<div class="mut">${esc(c.phone||'')}</div></td><td>${c.orders}</td><td>${c.spent}</td><td>${c.points}</td></tr>`).join('')}</table></div>`;
 } else if(sub==='stats'){
  const d=await api(`/t/${slug}/stats`);
  body=`<div class="kpis">
    <div class="kpi"><b>₪${d.revenue.total}</b>מחזור</div>
    <div class="kpi"><b>${d.revenue.orders}</b>הזמנות</div>
    <div class="kpi"><b>${d.customers.customers}</b>לקוחות</div>
    <div class="kpi"><b>${d.customers.returning}</b>חוזרים</div></div>
   <div class="card"><b>הזמנות לפי סטטוס</b>${d.byStatus.map(s=>`<div class="row"><div>${HE[s.status]}</div><div>${s.n}</div></div>`).join('')}</div>
   <div class="card"><b>פריטים מובילים</b>${d.topItems.map(t=>`<div class="row"><div>${esc(t.name)}</div><div>${t.qty} · ₪${t.revenue}</div></div>`).join('')||'<div class="mut">אין נתונים</div>'}</div>`;
 } else if(sub==='settings'){
  const d=await api('/laundries/'+slug);
  const l=d.laundry;
  body=`<div class="card">
   <label class="lb">שם</label><input class="inp" id="s-name" value="${esc(l.name)}">
   <label class="lb">טלפון</label><input class="inp" id="s-phone" value="${esc(l.phone||'')}">
   <label class="lb">כתובת</label><input class="inp" id="s-address" value="${esc(l.address||'')}">
   <label class="lb">עיר</label><input class="inp" id="s-city" value="${esc(l.city||'')}">
   <label class="lb">דמי שליחות ₪</label><input class="inp" id="s-fee" type="number" value="${l.delivery_fee||0}">
   <label class="lb">מינימום הזמנה ₪</label><input class="inp" id="s-min" type="number" value="${l.min_order||0}">
   <label style="font-size:13px;display:block;margin:8px 0"><input type="checkbox" id="s-open" ${l.is_open?'checked':''}> המכבסה פתוחה להזמנות</label>
   <label class="lb">תקנון</label><textarea class="inp" id="s-terms" rows="3">${esc(l.terms||'')}</textarea>
   <button class="btn" onclick="saveSettings('${slug}')">שמירה</button></div>`;
 }
 return `<div class="hdr"><h2>לוח ניהול — ${esc(me.memberships[0].name)}</h2></div>
 <div class="body"><div class="subtabs">${tabs.map(t=>`<a class="chip ${sub===t[0]?'on':''}" href="#/manage/${t[0]}">${t[1]}</a>`).join('')}</div>${body}</div>`;
}
async function setStatus(slug,id,st){if(st==='cancelled'&&!confirm('לבטל את ההזמנה? הלקוח יקבל עדכון על הביטול.'))return;try{await api(`/t/${slug}/orders/${id}/status`,{method:'POST',body:JSON.stringify({status:st})});route()}catch(e){toast(e.message)}}
async function assignCourier(slug,oid,el){
 try{
  const d=await api(`/t/${slug}/couriers`);
  if(!d.couriers.length)return toast('אין שליחים זמינים');
  const card=el.closest('.card');
  const old=card.querySelector('.assignbox');if(old)old.remove();
  const box=document.createElement('div');box.className='assignbox';box.style.cssText='margin-top:8px;display:flex;gap:6px';
  box.innerHTML=`<select class="inp" id="as-${oid}" style="flex:1">${d.couriers.map(c=>`<option value="${c.id}">${esc(c.name)} · ${c.model==='platform'?'פלטפורמה':c.model==='shared'?'משותף':'פרטי'} · ${c.active_orders} פעילות</option>`).join('')}</select>
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
 const name=prompt('שם הפריט:',btn.dataset.name);if(name===null)return;
 const price=prompt('מחיר בש״ח:',btn.dataset.price);if(price===null)return;
 try{await api(`/t/${slug}/items/${id}`,{method:'PATCH',body:JSON.stringify({name:name.trim()||undefined,price:price?Number(price):undefined})});toast('הפריט עודכן');route()}catch(e){toast(e.message)}
}
async function delItem(slug,id){try{await api(`/t/${slug}/items/${id}`,{method:'DELETE'});route()}catch(e){toast(e.message)}}
async function addWindow(slug){try{await api(`/t/${slug}/windows`,{method:'POST',body:JSON.stringify({weekday:$('#w-day').value,start_time:$('#w-start').value,end_time:$('#w-end').value,kind:$('#w-kind').value})});route()}catch(e){toast(e.message)}}
async function delWindow(slug,id){try{await api(`/t/${slug}/windows/${id}`,{method:'DELETE'});route()}catch(e){toast(e.message)}}
async function saveSettings(slug){try{await api(`/t/${slug}/settings`,{method:'PATCH',body:JSON.stringify({name:$('#s-name').value,phone:$('#s-phone').value,address:$('#s-address').value,city:$('#s-city').value,delivery_fee:$('#s-fee').value,min_order:$('#s-min').value,is_open:$('#s-open').checked,terms:$('#s-terms').value})});toast('נשמר')}catch(e){toast(e.message)}}

/* ---- admin ---- */
async function vAdmin(sub){
 if(!state.token)return needLogin();
 sub=sub||'overview';
 const tabs=[['overview','תמונת מצב'],['tenants','מכבסות'],['couriers','שליחים'],['register','רישום שליח'],['orders','הזמנות']];
 let body='';
 if(sub==='overview'){
  const d=await api('/admin/overview');
  body=`<div class="kpis"><div class="kpi"><b>${d.tenants.approved}</b>מכבסות</div><div class="kpi"><b>${d.orders.total}</b>הזמנות</div><div class="kpi"><b>₪${d.orders.gmv}</b>מחזור</div><div class="kpi"><b>${d.users.total}</b>משתמשים</div></div>
   ${d.tenants.pending?`<div class="warn">${d.tenants.pending} מכבסות ממתינות לאישור</div>`:''}
   ${d.couriers.pending?`<div class="warn">${d.couriers.pending} שליחים ממתינים לאישור</div>`:''}`;
 } else if(sub==='tenants'){
  const d=await api('/admin/tenants');
  body=`<div class="card"><table class="tbl"><tr><th>מכבסה</th><th>הזמנות</th><th>מחזור</th><th></th></tr>
   ${d.tenants.map(t=>`<tr><td>${esc(t.name)}<div class="mut">${esc(t.city||'')}</div></td><td>${t.orders}</td><td>₪${t.gmv}</td>
    <td>${t.approved?`<button class="btn2" onclick="adminTenant('${t.id}','suspend')">השעיה</button>`:`<button class="btn2 green" onclick="adminTenant('${t.id}','approve')">אישור</button>`}</td></tr>`).join('')}</table></div>`;
 } else if(sub==='couriers'){
  const d=await api('/admin/couriers');
  body=`<div class="card"><table class="tbl"><tr><th>שליח</th><th>סוג</th><th>מכבסה</th><th></th></tr>
   ${d.couriers.map(c=>`<tr><td>${esc(c.name)}<div class="mut">${esc(c.phone||'')}</div></td><td>${c.model==='platform'?'פלטפורמה':c.model==='shared'?'משותף':'פרטי'}</td><td>${esc(c.tenant_name||'—')}</td>
    <td>${c.approved?`<button class="btn2" onclick="adminCourier('${c.id}','suspend')">השעיה</button>`:`<button class="btn2 green" onclick="adminCourier('${c.id}','approve')">אישור</button>`}</td></tr>`).join('')}</table></div>`;
 } else if(sub==='register'){
  const d=await api('/admin/tenants');
  body=`<div class="card">
   <label class="lb">שם שליח</label><input class="inp" id="rc-name">
   <label class="lb">טלפון</label><input class="inp" id="rc-phone" placeholder="05x-xxxxxxx">
   <label class="lb">כלי רכב</label><input class="inp" id="rc-vehicle" placeholder="אופנוע / רכב">
   <label class="lb">מודל</label><select class="inp" id="rc-model"><option value="platform">שליח פלטפורמה</option><option value="private">שליח מכבסה פרטי</option><option value="shared">שליח משותף</option></select>
   <label class="lb">מכבסה (לשליח פרטי/משותף)</label><select class="inp" id="rc-tenant"><option value="">—</option>${d.tenants.map(t=>`<option value="${t.slug}">${esc(t.name)}</option>`).join('')}</select>
   <button class="btn" onclick="adminRegisterCourier()">רישום</button></div>`;
 } else if(sub==='orders'){
  const d=await api('/admin/orders');
  body=`<div class="card"><table class="tbl"><tr><th>הזמנה</th><th>מכבסה</th><th>סטטוס</th><th>₪</th></tr>
   ${d.orders.map(o=>`<tr><td><span dir="ltr">#${o.id.slice(0,8)}</span><div class="mut">${esc(o.customer_name||'')}</div></td><td>${esc(o.tenant_name)}</td><td><span class="st-pill st-${o.status}">${HE[o.status]}</span></td><td>${o.total}</td></tr>`).join('')}</table></div>`;
 }
 return `<div class="hdr"><h2>ניהול פלטפורמה</h2></div>
 <div class="body"><div class="subtabs">${tabs.map(t=>`<a class="chip ${sub===t[0]?'on':''}" href="#/admin/${t[0]}">${t[1]}</a>`).join('')}</div>${body}</div>`;
}
async function adminTenant(id,a){try{await api(`/admin/tenants/${id}/${a}`,{method:'POST',body:'{}'});route()}catch(e){toast(e.message)}}
async function adminCourier(id,a){try{await api(`/admin/couriers/${id}/${a}`,{method:'POST',body:'{}'});route()}catch(e){toast(e.message)}}
async function adminRegisterCourier(){try{await api('/admin/couriers/register',{method:'POST',body:JSON.stringify({name:$('#rc-name').value,phone:$('#rc-phone').value,vehicle:$('#rc-vehicle').value,model:$('#rc-model').value,tenant_slug:$('#rc-tenant').value||undefined})});toast('השליח נרשם');go('#/admin/couriers');route()}catch(e){toast(e.message)}}

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
 const hoursRows=Object.entries(d.hours||{}).map(([k,v])=>v&&v.length?`<div class="row"><div>${WD[k]}</div><div>${v.map(r=>r.join('–')).join(', ')}</div></div>`:null).filter(Boolean).join('');
 $('#join-review').innerHTML=`<div class="sec">סקירה לפני שליחה לאישור</div>
  <div class="card">
   <label class="lb">שם</label><input class="inp" id="jr-name" value="${esc(d.name||'')}">
   <label class="lb">טלפון</label><input class="inp" id="jr-phone" value="${esc(d.phone||'')}">
   <label class="lb">כתובת</label><input class="inp" id="jr-address" value="${esc(d.address||'')}">
   <label class="lb">עיר</label><input class="inp" id="jr-city" value="${esc(d.city||'')}">
   <label class="lb">דמי שליחות ₪</label><input class="inp" id="jr-fee" type="number" value="${d.delivery_fee||0}">
  </div>
  <div class="card"><b>מחירון (${(d.items||[]).length} פריטים)</b>
   ${(d.items||[]).map((it,i)=>`<div class="row"><div>${esc(it.name)}<div class="mut">${esc(it.category||'')}</div></div><div>₪${it.price}${it.unit==='kg'?'/ק״ג':''} <button class="btn2" onclick="joinDraft.items.splice(${i},1);renderJoinReview()">✕</button></div></div>`).join('')||'<div class="mut">לא זוהו פריטים — הוסיפו ידנית בלוח הניהול אחרי ההצטרפות</div>'}
  </div>
  ${hoursRows?`<div class="card"><b>שעות פעילות</b>${hoursRows}</div>`:''}
  ${d.terms?`<div class="card"><b>תקנון</b><div class="mut">${esc(d.terms)}</div></div>`:''}
  ${d.notes?`<div class="warn">שימו לב: ${esc(d.notes)}</div>`:''}
  <button class="btn" onclick="joinSubmit()">שליחה לאישור הפלטפורמה</button>`;
}
async function joinSubmit(){
 try{
  const d=joinDraft;
  const body={name:$('#jr-name').value,phone:$('#jr-phone').value,address:$('#jr-address').value,city:$('#jr-city').value,
   delivery_fee:$('#jr-fee').value,items:d.items||[],windows:d.windows||[],services:d.services||['כביסה'],hours:d.hours||{},terms:d.terms||''};
  const r=await api('/onboard/tenants',{method:'POST',body:JSON.stringify(body)});
  joinDraft=null;
  $('#join-review').innerHTML=`<div class="note">✅ המכבסה <b>${esc(r.tenant.name)}</b> נוצרה וממתינה לאישור מנהל הפלטפורמה. אחרי האישור תופיע במרקטפלייס, ולוח הניהול כבר פתוח לך בלשונית ״ניהול״.</div>`;
 }catch(e){toast(e.message)}
}

/* ---- router ---- */
async function route(){
 const h=location.hash||'#/';
 const [,path]=h.split('#');
 const [p,qstr]=path.split('?');
 const q=new URLSearchParams(qstr||'');
 const parts=p.split('/').filter(Boolean);
 renderTabs(h.split('?')[0]);
 let html='';
 $('#app').innerHTML='<div class="body"><div class="card mut" style="text-align:center;padding:40px 0">טוען…</div></div>';
 const tst=$('.toast');if(tst)tst.classList.remove('show');
 try{
  if(!state.token&&parts[0]!=='login'&&parts[0]!==undefined&&![''].includes(parts[0])&&parts.length>0){/* צפייה חופשית בדף הבית ובמכבסות */}
  if(parts.length===0)html=await vHome(q.get('q'));
  else if(parts[0]==='login')html=vLogin();
  else if(parts[0]==='laundry')html=await vLaundry(parts[1]);
  else if(parts[0]==='checkout')html=await vCheckout(parts[1]);
  else if(parts[0]==='orders'&&parts[1])html=await vOrder(parts[1]);
  else if(parts[0]==='orders')html=await vOrders();
  else if(parts[0]==='club')html=await vClub();
  else if(parts[0]==='courier')html=await vCourier();
  else if(parts[0]==='manage')html=await vManage(parts[1]);
  else if(parts[0]==='admin')html=await vAdmin(parts[1]);
  else if(parts[0]==='join')html=await vJoin();
  else html=await vHome();
 }catch(e){
  if(e.status===401){state.token=null;state.me=null;save();html=vLogin()}
  else html=`<div class="body"><div class="card warn">${esc(e.message)}</div></div>`;
 }
 $('#app').innerHTML=html;
 if(parts[0]==='login')initGoogle();
 const jf=$('#join-files');if(jf)jf.onchange=()=>joinExtract(jf.files);
 window.scrollTo(0,0);
}
window.addEventListener('hashchange',route);
(async()=>{
 try{state.cfg=await api('/config')}catch(e){state.cfg={}}
 if(state.token){try{const me=await api('/auth/me');state.me=me.user;save()}catch(e){state.token=null;state.me=null;save()}}
 route();
})();
