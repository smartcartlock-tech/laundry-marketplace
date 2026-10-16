/* ---- courier day: מסלול יום + אישור מסירה + זמינות + היסטוריה/רווחים + מצב לא מקוון (מסך שליח) ---- */
const COURIER_KIND={pickup:'📥 איסוף מהלקוח',collect:'🏪 איסוף מהמכבסה',deliver:'📦 מסירה ללקוח'};

/* מצב לא מקוון בסיסי: פעולות שליח (אישור מסירה בקוד) נשמרות מקומית ומסונכרנות כשהחיבור חוזר */
const CQ_KEY='courier_queue';
function cqGet(){try{return JSON.parse(store.get(CQ_KEY,'[]'))}catch(e){return[]}}
function cqSet(q){store.set(CQ_KEY,JSON.stringify(q))}
function cqPush(item){const q=cqGet();q.push({...item,at:Date.now()});cqSet(q)}
async function cqSync(){
 if(!navigator.onLine)return 0;
 const q=cqGet();if(!q.length)return 0;
 let done=0;const rest=[];
 for(let i=0;i<q.length;i++){
  try{await api(q[i].path,q[i].opts);done++}
  catch(e){if(e.status===0){rest.push(...q.slice(i));break}/* שגיאת שרת (למשל 409 כפילות): הפעולה לא תישלח שוב */}
 }
 cqSet(rest);
 return done;
}
window.addEventListener('online',async()=>{
 const n=await cqSync();
 if(n>0){toast('החיבור חזר — סונכרנו '+n+' פעולות ✓');route()}
});
function cqBadge(){const n=cqGet().length;return n?`<span class="tag" style="background:#fff3cd;color:#7a5c00">⏳ ${n} ${n===1?'פעולה ממתינה':'פעולות ממתינות'} לסנכרון</span>`:''}

function courierSubtabs(on){
 return `<div class="subtabs"><a class="chip" href="#/courier">משימות</a><a class="chip${on==='day'?' on':''}" href="#/courier/day">מסלול יום</a><a class="chip" href="#/courier/earnings">רווחים</a><a class="chip${on==='history'?' on':''}" href="#/courier/history">היסטוריה</a></div>`;
}

async function vCourierDay(dayDate){
 if(!state.token)return needLogin();
 let me;try{me=await api('/auth/me')}catch(e){return needLogin()}
 if(!me.courier||!me.courier.approved)return vCourier();
 const hq=new URLSearchParams((location.hash.split('?')[1]||''));
 const order=hq.get('order'),olat=hq.get('lat'),olng=hq.get('lng');
 let qs='';
 if(dayDate)qs='?date='+dayDate;
 if(order==='proximity'){qs+=(qs?'&':'?')+'order=proximity'+(olat&&olng?`&lat=${olat}&lng=${olng}`:'')}
 const d=await api('/courier/day-route'+qs);
 const t=await api('/courier/tasks');
 const av=await api('/courier/availability').catch(()=>({online:true}));
 const s=d.summary;
 return `<div class="hdr"><h2>מסלול יום</h2><p>${new Date().toLocaleDateString('he-IL',{weekday:'long',day:'numeric',month:'long',timeZone:'Asia/Jerusalem'})} · ${me.courier.model==='platform'?'שליח פלטפורמה':me.courier.model==='shared'?'שליח משותף':'שליח מכבסה'}</p></div>
 <div class="body">
 ${courierSubtabs('day')}
 <div style="display:flex;gap:8px;align-items:center;margin:8px 0;flex-wrap:wrap">
  <button class="btn2${av.online?' green':''}" data-act="courierToggleAvail" data-a="${av.online?'0':'1'}">${av.online?'🟢 זמין לשיבוץ':'⚫ לא זמין (אופליין)'}</button>
  ${cqBadge()}
 </div>
 <div style="display:flex;gap:8px;align-items:center;margin:8px 0;flex-wrap:wrap">
  <input type="date" class="inp" id="courier-day-date" value="${d.date}" style="max-width:170px" data-actc="courierDayDate">
  ${d.date!==new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Jerusalem'})?`<button class="btn2" data-act="courierDayToday">חזרה להיום</button>`:''}
  ${order==='proximity'?`<span class="tag tb">מסודר לפי קרבה 📍</span><button class="btn2" data-act="courierDayToday">סידור רגיל</button>`:`<button class="btn2" data-act="courierProximity">📍 סדר לפי קרבה</button>`}
 </div>
 <div class="kpis">
  <div class="kpi"><b>${s.remaining}</b>נותרו</div>
  <div class="kpi"><b>${s.pickups}</b>איסופים</div>
  <div class="kpi"><b>${s.deliveries}</b>מסירות</div>
  <div class="kpi"><b>${s.done}</b>הושלמו</div>
 </div>
 ${s.total===0?`<div class="card mut" style="text-align:center">אין נקודות במסלול היום. משימות חדשות מגיעות דרך <a href="#/courier" style="color:#0e7a8a">מסך המשימות</a>.</div>`:''}
 ${d.stops.map(st=>{const o=st.order;return `<div class="card"${st.done?' style="opacity:.65"':''}>
   <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
    <div>
     <span class="tag tb">${st.seq}</span> <b>${COURIER_KIND[st.kind]}</b> <span class="st-pill st-${o.status}">${HE[o.status]}</span>
     <div class="mut" style="margin-top:4px">${esc(st.stop_address)}${st.when?` · ${fmtDT(st.when)}`:''}</div>
     <div class="mut">${st.kind==='collect'?esc(o.tenant_name):`${esc(o.customer_name||'לקוח')}${o.customer_phone?` · <a href="tel:${o.customer_phone}" style="color:#0e7a8a">${o.customer_phone}</a>`:''}`} · ${esc(o.tenant_name)}</div>
     ${o.items&&o.items.length?`<div class="mut">פריטים: ${o.items.map(x=>esc(x.name)+' ×'+x.qty).join(', ')}</div>`:''}
     ${!st.done&&st.kind!=='pickup'&&o.payment_method==='cash'&&o.payment_status!=='paid_cash'?`<div class="mut">💵 לגבות ₪${o.total} במזומן</div>`:''}
    </div>
    ${!st.done?`<a class="btn2" href="https://waze.com/ul?q=${encodeURIComponent(st.stop_address)}" target="_blank">ניווט</a>`:''}
   </div>
   ${st.done&&st.order.confirmation?`<div class="mut" style="margin-top:6px">✅ אושרה מסירה (${st.order.confirmation.method==='code'?'קוד לקוח':'צילום'})${st.order.confirmation.has_photo?` · <a href="/api/delivery-confirmations/${st.order.confirmation.id}/photo" target="_blank" style="color:#0e7a8a">צילום אישור</a>`:''}</div>`:''}
   ${!st.done?`<div style="display:flex;gap:8px;margin-top:8px">
     ${st.kind==='pickup'?`<button class="btn2 on" data-act="markOrder" data-a="${o.id}" data-b="picked_up">סימון נאסף</button>`:''}
     ${st.kind==='collect'?`<button class="btn2 on" data-act="markOrder" data-a="${o.id}" data-b="out_for_delivery">אספתי — יציאה ללקוח</button>`:''}
     ${st.kind==='deliver'?`<button class="btn2 green" data-act="courierConfirmDelivery" data-a="${o.id}">מסירה עם אישור לקוח</button><button class="btn2" data-act="courierPhotoDelivery" data-a="${o.id}">אישור בצילום</button>`:''}
    </div>`:`<div class="mut" style="margin-top:6px">✓ הושלם · ${fmtDT(st.when)}</div>`}
  </div>`}).join('')}
 ${t.tasks.in_laundry.length?`<div class="sec">אצל המכבסה (${t.counts.in_laundry})</div>
  ${t.tasks.in_laundry.map(o=>`<div class="card"><b>${esc(o.tenant_name)}</b> <span class="st-pill st-${o.status}">${HE[o.status]}</span>
   <div class="mut">${esc(o.address)} · החזרה תתאפשר כשההזמנה תסומנה "מוכנה"</div></div>`).join('')}`:''}
 </div>`;
}

async function courierToggleAvail(online){
 try{
  await api('/courier/availability',{method:'POST',body:JSON.stringify({online})});
  toast(online?'סומנת כזמין — שיבוץ אוטומטי יכלול אותך':'סומנת כלא זמין — לא ישובצו לך מסלולים חדשים');route();
 }catch(e){toast(e.message)}
}

function courierProximity(){
 const goNear=(lat,lng)=>go('#/courier/day?order=proximity'+(lat!=null?`&lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}`:''));
 if(!navigator.geolocation){toast('אין גישה למיקום — מסדר מהנקודה הראשונה');goNear();return}
 toast('מאתר מיקום…');
 navigator.geolocation.getCurrentPosition(
  p=>goNear(p.coords.latitude,p.coords.longitude),
  ()=>{toast('לא התקבל מיקום — מסדר מהנקודה הראשונה');goNear()},
  {timeout:8000,maximumAge:60000});
}

async function courierConfirmDelivery(orderId){
 const v=await xmodal({title:'אישור מסירה',body:'בקשו מהלקוח את 4 הספרות האחרונות של מספר הטלפון שלו כאישור קבלה.',okText:'אישור מסירה',fields:[{id:'code',label:'קוד אישור (4 ספרות)',value:'',type:'tel'}]});
 if(!v)return;
 try{
  await api(`/courier/orders/${orderId}/confirm-delivery`,{method:'POST',body:JSON.stringify({method:'code',code:v.code})});
  toast('המסירה אושרה ✓');route();
 }catch(e){
  if(e.status===0){
   cqPush({path:`/courier/orders/${orderId}/confirm-delivery`,opts:{method:'POST',body:JSON.stringify({method:'code',code:v.code})}});
   toast('אין חיבור — האישור נשמר ויישלח אוטומטית כשיחזור החיבור');route();
  }else toast(e.message);
 }
}

/* אישור מסירה בצילום: בחירת תמונה (נדחסת אוטומטית ע״י image-compress), שליחה כ-multipart.
   דורש חיבור פעיל — קובץ לא נשמר בתור הלא מקוון. */
function courierPhotoDelivery(orderId){
 const ov=document.createElement('div');ov.className='modal-ov';
 ov.innerHTML=`<div class="modal" role="dialog" aria-modal="true"><b>אישור מסירה בצילום</b>
  <div class="mut" style="margin:8px 0">צלמו את השקים אצל הלקוח או את חתימת הקבלה. התמונה נשמרת כראיה למכבסה ולפלטפורמה.</div>
  <input type="file" id="pd-file" class="inp" accept="image/jpeg,image/png,image/webp" capture="environment">
  <div style="display:flex;gap:8px;margin-top:14px"><button class="btn" id="pd-ok" style="flex:1">העלאה ואישור מסירה</button><button class="btn2" id="pd-cancel" style="flex:1">ביטול</button></div></div>`;
 document.body.appendChild(ov);
 const done=()=>ov.remove();
 ov.querySelector('#pd-cancel').onclick=done;
 ov.onclick=e=>{if(e.target===ov)done()};
 ov.querySelector('#pd-ok').onclick=async()=>{
  const f=ov.querySelector('#pd-file').files[0];
  if(!f){toast('יש לבחור תמונה');return}
  const fd=new FormData();fd.append('method','photo');fd.append('photo',f);
  try{
   const r=await fetch('/api/courier/orders/'+orderId+'/confirm-delivery',{method:'POST',headers:{authorization:'Bearer '+state.token},body:fd});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(j.error||'שגיאה בהעלאה');
   done();toast('המסירה אושרה עם צילום ✓');route();
  }catch(e){toast(e.message)}
 };
}

/* היסטוריה ורווחים: דירוג השליח, רווחים יומי/שבועי לפי משימה (דמו), היסטוריית משימות */
async function vCourierHistory(period){
 if(!state.token)return needLogin();
 let me;try{me=await api('/auth/me')}catch(e){return needLogin()}
 if(!me.courier||!me.courier.approved)return vCourier();
 period=period==='week'?'week':'day';
 const h=await api('/courier/history');
 const e=await api('/courier/earnings/detail?period='+period);
 const stars=n=>'★'.repeat(n)+'☆'.repeat(5-n);
 return `<div class="hdr"><h2>היסטוריה ורווחים</h2><p>${esc(me.user&&me.user.name||'שליח')}</p></div>
 <div class="body">
 ${courierSubtabs('history')}
 <div class="kpis">
  <div class="kpi"><b>${Number(h.rating.rating||0).toFixed(1)}</b>דירוג ממוצע</div>
  <div class="kpi"><b>${h.rating.rating_count||0}</b>דירוגים</div>
  <div class="kpi"><b>${h.rows.length}</b>משימות שהושלמו</div>
  <div class="kpi"><b>₪${e.totals.net}</b>נטו (${period==='day'?'היום':'השבוע'})</div>
 </div>
 <div class="sec">רווחים לפי משימה (נתוני דמו — אין תשלום אמיתי)</div>
 <div class="subtabs" style="margin-bottom:8px">
  <a class="chip${period==='day'?' on':''}" href="#/courier/history?period=day">יומי</a>
  <a class="chip${period==='week'?' on':''}" href="#/courier/history?period=week">שבועי</a>
 </div>
 ${period==='week'&&e.by_day.length?`<div class="card">${e.by_day.map(d=>`<div style="display:flex;justify-content:space-between"><span>${d.day}</span><span>${d.stops} נקודות · ₪${d.net}</span></div>`).join('')}</div>`:''}
 ${e.tasks.length?e.tasks.map(x=>`<div class="card" style="display:flex;justify-content:space-between;gap:8px">
   <div><b>${x.kind==='pickup'?'איסוף':x.kind==='delivery'?'מסירה':'התאמה'}</b> · ${esc(x.tenant_name)}
    <div class="mut">${x.order_address?esc(x.order_address)+' · ':''}${fmtDT(x.created_at)} · ${x.status==='paid_demo'?'שולם (דמו)':'נצבר'}</div></div>
   <div style="text-align:left"><b>₪${x.net}</b><div class="mut">ברוטו ₪${x.gross}</div></div>
  </div>`).join(''):`<div class="card mut" style="text-align:center">אין רשומות רווחים ${period==='day'?'להיום':'לשבוע זה'} — רשומה נוצרת על כל מסירה שמאושרת.</div>`}
 <div class="sec">היסטוריית משימות</div>
 ${h.rows.length?h.rows.map(o=>`<div class="card">
   <b>${esc(o.tenant_name)}</b> · ${esc(o.customer_name||'לקוח')} <span class="st-pill st-delivered">${HE.delivered}</span>
   <div class="mut">${esc(o.address)} · ${fmtDT(o.updated_at)} · ₪${o.total}</div>
   ${o.confirmation?`<div class="mut">✅ אושרה מסירה (${o.confirmation.method==='code'?'קוד לקוח':'צילום'})${o.confirmation.has_photo?` · <a href="/api/delivery-confirmations/${o.confirmation.id}/photo" target="_blank" style="color:#0e7a8a">צילום אישור</a>`:''}</div>`:''}
   ${o.review?`<div style="margin-top:4px"><span style="color:#e6a700">${stars(o.review.rating)}</span>${o.review.text?` <span class="mut">"${esc(o.review.text)}"</span>`:''}</div>`:'<div class="mut">עוד לא התקבל דירוג על משימה זו</div>'}
  </div>`).join(''):`<div class="card mut" style="text-align:center">עוד אין משימות שהושלמו.</div>`}
 </div>`;
}

/* B7: רישום פעולות להאזנה המרכזת (ללא inline handlers) */
onAct({
 courierConfirmDelivery:t=>courierConfirmDelivery(t.dataset.a),
 courierPhotoDelivery:t=>courierPhotoDelivery(t.dataset.a),
 courierDayDate:t=>go('#/courier/day?date='+t.value), courierDayToday:()=>go('#/courier/day'),
 courierToggleAvail:t=>courierToggleAvail(t.dataset.a==='1'),
 courierProximity:()=>courierProximity()
});
