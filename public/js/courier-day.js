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
  try{
   if(q[i].kind==='photo'){await cqSyncPhoto(q[i]);done++}
   else{await api(q[i].path,q[i].opts);done++}
  }
  catch(e){if(e.status===0){rest.push(...q.slice(i));break}/* שגיאת שרת (למשל 409 כפילות): הפעולה לא תישלח שוב */}
 }
 cqSet(rest);
 return done;
}
/* סנכרון צילום אישור מסירה שנשמר לא-מקוון: בניית FormData מחדש מה-blob ב-IndexedDB (courier-offline.js) */
async function cqSyncPhoto(item){
 const rec=await coffGetPhoto(item.ref);
 if(!rec||!rec.blob)return; /* הבלוב כבר טופל */
 const fd=new FormData();fd.append('method','photo');fd.append('photo',rec.blob,'delivery.jpg');
 let r;
 try{r=await fetch('/api/courier/orders/'+item.orderId+'/confirm-delivery',{method:'POST',headers:{authorization:'Bearer '+state.token},body:fd})}
 catch(e){const ne=new Error('offline');ne.status=0;throw ne} /* רשת — נשאר בתור וב-IndexedDB */
 await coffDelPhoto(item.ref).catch(()=>{});
 if(r.ok)return;
 const se=new Error('server '+r.status);se.status=r.status;throw se; /* שגיאת שרת (כולל 409): לא יישלח שוב */
}
window.addEventListener('online',async()=>{
 const n=await cqSync();
 if(n>0){toast('החיבור חזר — סונכרנו '+n+' פעולות ✓');route()}
});
function cqBadge(){const q=cqGet();const n=q.length;const p=q.filter(x=>x.kind==='photo').length;return n?`<span class="tag" style="background:#fff3cd;color:#7a5c00">⏳ ${n} ${n===1?'פעולה ממתינה':'פעולות ממתינות'} לסנכרון${p?` (${p} ${p===1?'כולל צילום':'כולל צילומים'})`:''}</span>`:''}

function courierSubtabs(on){
 return `<div class="subtabs"><a class="chip" href="#/courier">משימות</a><a class="chip${on==='day'?' on':''}" href="#/courier/day">מסלול יום</a><a class="chip${on==='map'?' on':''}" href="#/courier/map">מפה</a><a class="chip" href="#/courier/earnings">רווחים</a><a class="chip${on==='history'?' on':''}" href="#/courier/history">היסטוריה</a><a class="chip${on==='profile'?' on':''}" href="#/courier/profile">פרופיל</a><a class="chip${on==='help'?' on':''}" href="#/courier/help">עזרה</a><a class="chip" href="#/notif-settings">🔔 התראות</a></div>`;
}

async function vCourierDay(dayDate){
 if(!state.token)return needLogin();
 let me;try{me=await api('/auth/me')}catch(e){return needLogin()}
 if(!me.courier||!me.courier.approved)return vCourier();
 coffPersist(); /* אחסון מתמשך לתור הצילומים הלא-מקוון */
 const hq=new URLSearchParams((location.hash.split('?')[1]||''));
 const order=hq.get('order'),olat=hq.get('lat'),olng=hq.get('lng');
 let qs='';
 if(dayDate)qs='?date='+dayDate;
 if(order==='proximity'){qs+=(qs?'&':'?')+'order=proximity'+(olat&&olng?`&lat=${olat}&lng=${olng}`:'')}
 const d=await api('/courier/day-route'+qs);
 const t=await api('/courier/tasks');
 const av=await api('/courier/availability').catch(()=>({online:true}));
 const offs=await api('/courier/offers').catch(()=>({offers:[]}));
 const pushOn=await courierPushState();
 const s=d.summary;
 return `<div class="hdr"><h2>מסלול יום</h2><p>${new Date().toLocaleDateString('he-IL',{weekday:'long',day:'numeric',month:'long',timeZone:'Asia/Jerusalem'})} · ${me.courier.model==='platform'?'שליח פלטפורמה':me.courier.model==='shared'?'שליח משותף':'שליח מכבסה'}</p></div>
 <div class="body">
 ${courierSubtabs('day')}
 ${offs.offers.length?`<div class="card" style="border:2px solid #0e7a8a">
  <b>🔔 ${offs.offers.length===1?'הצעת שיבוץ חדשה':offs.offers.length+' הצעות שיבוץ חדשות'}</b>
  ${offs.offers.map(f=>`<div style="margin-top:8px;padding-top:8px;border-top:1px solid #e3eef0">
   <b>${f.kind==='pickup'?'איסוף':'מסירה'}</b> · ${esc(f.tenant_name)} · ${esc(f.address)}
   <div class="mut">${f.items&&f.items.length?f.items.map(x=>esc(x.name)+' ×'+x.qty).join(', ')+' · ':''}התקבלה ${fmtDT(f.created_at)}</div>
   <div style="display:flex;gap:8px;margin-top:6px">
    <button class="btn2 green" data-act="courierAcceptOffer" data-a="${f.offer_id}" data-b="${f.created_at}">✓ קבלת המשימה</button>
    <button class="btn2" data-act="courierDeclineOffer" data-a="${f.offer_id}" data-b="${f.created_at}">✕ דחייה</button>
   </div></div>`).join('')}
 </div>`:''}
 <div style="display:flex;gap:8px;align-items:center;margin:8px 0;flex-wrap:wrap">
  <button class="btn2${av.online?' green':''}" data-act="courierToggleAvail" data-a="${av.online?'0':'1'}">${av.online?'🟢 זמין לשיבוץ':'⚫ לא זמין (אופליין)'}</button>
  ${pushOn?`<span class="tag green">🔔 התראות פעילות</span>`:`<button class="btn2" id="push-btn" data-act="pushSubscribe" title="התראה על משימה חדשה — גם כשהאפליקציה סגורה">🔔 הפעלת התראות</button>`}
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
  }catch(e){
   if(!navigator.onLine||e.name==='TypeError'){ /* כשל רשת: שמירה ב-IndexedDB + סמן בתור המאוחד */
    try{
     const ref=await coffSavePhoto(orderId,f);
     cqPush({kind:'photo',orderId,ref});
     done();toast('אין חיבור — הצילום נשמר ויישלח כשהחיבור יחזור ✓');route();
    }catch(ie){toast('שמירה מקומית נכשלה: '+ie.message)}
   }else toast(e.message)
  }
 };
}

/* T12: מצב מנוי התראות דחיפה של השליח (null = לא רשום) */
async function courierPushState(){
 try{
  if(!('serviceWorker' in navigator)||!('PushManager' in window))return null;
  const reg=await navigator.serviceWorker.getRegistration();
  return reg?await reg.pushManager.getSubscription():null;
 }catch(e){return null}
}

/* היסטוריה ורווחים: דירוג השליח, רווחים יומי/שבועי לפי משימה (דמו), היסטוריית משימות */
async function vCourierHistory(period){
 if(!state.token)return needLogin();
 let me;try{me=await api('/auth/me')}catch(e){return needLogin()}
 if(!me.courier||!me.courier.approved)return vCourier();
 period=period==='week'?'week':'day';
 const h=await api('/courier/history');
 const e=await api('/courier/earnings/detail?period='+period);
 const st=await api('/courier/offers/stats').catch(()=>null);
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
 ${st&&st.stats&&(st.stats.accepted+st.stats.declined)>0?`<div class="card mut">זמן תגובה ממוצע להצעות שיבוץ: ${st.stats.avg_response_seconds<60?st.stats.avg_response_seconds+' שניות':Math.round(st.stats.avg_response_seconds/60)+' דקות'} · התקבלו ${st.stats.accepted} · נדחו ${st.stats.declined}${st.recent.filter(r=>r.status==='declined'&&r.decline_reason).length?` · סיבת דחייה אחרונה: ${esc(st.recent.find(r=>r.status==='declined'&&r.decline_reason).decline_reason)}`:''}</div>`:''}
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

/* קבלת/דחיית הצעת שיבוץ — עם סיבת דחייה וזמן תגובה */
function offerRespSecs(createdAt){return Math.max(0,Math.round((Date.now()-new Date(createdAt).getTime())/1000))}
async function courierAcceptOffer(offerId,createdAt){
 try{
  await api('/courier/offers/'+offerId+'/accept',{method:'POST',body:'{}'});
  toast('המשימה התקבלה ✓ · זמן תגובה: '+offerRespSecs(createdAt)+' שניות');route();
 }catch(e){toast(e.message)}
}
async function courierDeclineOffer(offerId,createdAt){
 const v=await xmodal({title:'דחיית הצעת שיבוץ',body:'אפשר לציין סיבה — היא תוצג למכבסה ולפלטפורמה. דחייה אינה פוגעת בדירוג.',okText:'דחיית ההצעה',fields:[{id:'reason',label:'סיבת דחייה (לא חובה)',value:''}]});
 if(!v)return;
 try{
  await api('/courier/offers/'+offerId+'/decline',{method:'POST',body:JSON.stringify({reason:v.reason||''})});
  toast('ההצעה נדחתה · זמן תגובה: '+offerRespSecs(createdAt)+' שניות');route();
 }catch(e){toast(e.message)}
}

/* מפת מסלול פשוטה: קישורי ניווט Waze + Google Maps לכל נקודה, ומסלול מלא מרובה נקודות */
async function vCourierMap(){
 if(!state.token)return needLogin();
 let me;try{me=await api('/auth/me')}catch(e){return needLogin()}
 if(!me.courier||!me.courier.approved)return vCourier();
 const d=await api('/courier/day-route');
 const open=d.stops.filter(s=>!s.done);
 const gm=a=>'https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(a);
 const wz=a=>'https://waze.com/ul?q='+encodeURIComponent(a);
 const full=open.length>=2?gm(open[open.length-1].stop_address)+'&waypoints='+encodeURIComponent(open.slice(0,-1).map(s=>s.stop_address).join('|')):null;
 return `<div class="hdr"><h2>מפת מסלול</h2><p>${open.length} נקודות פתוחות · ${d.date}</p></div>
 <div class="body">
 ${courierSubtabs('map')}
 ${full?`<a class="btn" style="display:block;text-align:center;margin-bottom:10px" href="${full}" target="_blank">🗺️ מסלול מלא ב-Google Maps (${open.length} נקודות)</a>`:''}
 ${open.length?open.map(st=>`<div class="card">
   <span class="tag tb">${st.seq}</span> <b>${COURIER_KIND[st.kind]}</b>
   <div class="mut" style="margin:4px 0">${esc(st.stop_address)}</div>
   <div style="display:flex;gap:8px">
    <a class="btn2" href="${wz(st.stop_address)}" target="_blank" style="flex:1;text-align:center">ניווט Waze</a>
    <a class="btn2" href="${gm(st.stop_address)}" target="_blank" style="flex:1;text-align:center">Google Maps</a>
   </div>
  </div>`).join(''):`<div class="card mut" style="text-align:center">אין נקודות פתוחות במסלול היום.</div>`}
 </div>`;
}

/* פרופיל שליח: צפייה ועריכה של אזורי פעילות, כלי רכב ושעות פעילות */
const DAYS_HE=['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
async function vCourierProfile(){
 if(!state.token)return needLogin();
 let me;try{me=await api('/auth/me')}catch(e){return needLogin()}
 if(!me.courier||!me.courier.approved)return vCourier();
 const pushOn=await courierPushState();
 const p=await api('/courier/profile');
 const c=p.courier, av=c.availability||{};
 return `<div class="hdr"><h2>פרופיל שליח</h2><p>${esc(me.user.name||'')} · ${me.courier.model==='platform'?'שליח פלטפורמה':me.courier.model==='shared'?'שליח משותף':'שליח מכבסה'}</p></div>
 <div class="body">
 ${courierSubtabs('profile')}
 <div class="kpis">
  <div class="kpi"><b>${p.stats.delivered}</b>מסירות בוצעו</div>
  <div class="kpi"><b>${p.stats.active}</b>משימות פעילות</div>
  <div class="kpi"><b>${Number(c.rating||0).toFixed(1)}</b>דירוג</div>
 </div>
 <div class="card" style="display:flex;align-items:center;gap:10px"><div style="flex:1"><b>התראות על משימות חדשות</b><div class="mut">התראת דחיפה בכל שיבוץ — גם כשהאפליקציה סגורה. ניהול העדפות במסך <a href="#/notif-settings" style="color:#0e7a8a">הגדרות התראות</a>.</div></div>${pushOn?`<span class="tag green">🔔 פעילות</span>`:`<button class="btn2 on" id="push-btn" data-act="pushSubscribe">🔔 הפעלה</button>`}</div>
 <div class="card">
  <label class="lbl">כלי רכב</label>
  <input class="inp" id="cp-vehicle" value="${esc(c.vehicle||'')}">
  <label class="lbl">אזורי פעילות (מופרדים בפסיק)</label>
  <input class="inp" id="cp-areas" value="${esc((c.areas||[]).join(', '))}">
  <label class="lbl">שעות פעילות לפי יום</label>
  ${DAYS_HE.map((d,i)=>{const a=av[String(i)]||{};return `<div style="display:flex;gap:6px;align-items:center;margin:4px 0">
    <span style="min-width:52px">${d}</span>
    <input type="checkbox" id="cp-off-${i}" ${a.off?'checked':''} data-actc="courierProfileOff" data-a="${i}"><label for="cp-off-${i}" class="mut">סגור</label>
    <input type="time" class="inp" id="cp-from-${i}" value="${a.from||'08:00'}" style="max-width:110px" ${a.off?'disabled':''}>
    <span class="mut">עד</span>
    <input type="time" class="inp" id="cp-to-${i}" value="${a.to||'18:00'}" style="max-width:110px" ${a.off?'disabled':''}>
   </div>`}).join('')}
  <button class="btn" style="margin-top:10px" data-act="courierSaveProfile">שמירת פרופיל</button>
 </div>
 </div>`;
}
function courierProfileOff(t){
 const i=t.dataset.a;
 ['cp-from-'+i,'cp-to-'+i].forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=t.checked});
}
async function courierSaveProfile(){
 const availability={};
 for(let i=0;i<7;i++){
  availability[String(i)]={from:document.getElementById('cp-from-'+i).value||null,to:document.getElementById('cp-to-'+i).value||null,off:document.getElementById('cp-off-'+i).checked};
 }
 const body={vehicle:document.getElementById('cp-vehicle').value,areas:document.getElementById('cp-areas').value,availability};
 try{
  await api('/courier/profile',{method:'PUT',body:JSON.stringify(body)});
  toast('הפרופיל נשמר ✓');route();
 }catch(e){toast(e.message)}
}

/* מדריך שימוש למסך השליח */
function vCourierHelp(){
 return `<div class="hdr"><h2>עזרה — מדריך לשליח</h2><p>איך עובדים עם מסך השליח</p></div>
 <div class="body">
 ${courierSubtabs('help')}
 <div class="card"><b>מתחילים את היום</b><div class="mut" style="margin-top:4px">1. סמנו <b>🟢 זמין לשיבוץ</b> במסך מסלול יום — רק שליחים זמינים מקבלים שיבוץ אוטומטי. 2. הצעות שיבוץ חדשות מופיעות בכרטיס 🔔 בראש המסך — אשרו או דחו עם סיבה. 3. כרטיס "מפת מסלול" נותן קישור ניווט לכל נקודה.</div></div>
 <div class="card"><b>איסוף ומסירה</b><div class="mut" style="margin-top:4px">בנקודת איסוף מהלקוח לחצו "סימון נאסף". כשהכביסה מוכנה אצל המכבסה יופיע "אספתי — יציאה ללקוח". אצל הלקוח: "מסירה עם אישור לקוח" (4 ספרות אחרונות של הטלפון שלו) או "אישור בצילום". אם ההזמנה במזומן — תראו את הסכום לגבייה על הכרטיס.</div></div>
 <div class="card"><b>מסלול היום</b><div class="mut" style="margin-top:4px">המסלול מסודר אוטומטית לפי המערכת. "📍 סדר לפי קרבה" מסדר מחדש לפי המיקום שלכם. בורר התאריך מציג מסלולים של ימים קודמים ומה שהושלם בהם.</div></div>
 <div class="card"><b>רווחים והיסטוריה</b><div class="mut" style="margin-top:4px">במסך "היסטוריה" רואים דירוג ממוצע, רווחים יומיים/שבועיים לפי משימה (נתוני דמו — אין תשלום אמיתי), זמן תגובה ממוצע להצעות, וכל המשימות שהושלמו עם הדירוג שקיבלתם.</div></div>
 <div class="card"><b>בלי חיבור לאינטרנט</b><div class="mut" style="margin-top:4px">אישור מסירה בקוד נשמר במכשיר ויישלח אוטומטית כשהחיבור חוזר — תראו באדג' "פעולות ממתינות לסנכרון". אישור בצילום דורש חיבור פעיל.</div></div>
 <div class="card"><b>פרופיל</b><div class="mut" style="margin-top:4px">עדכנו כלי רכב, אזורי פעילות ושעות פעילות לפי יום — השיבוץ האוטומטי מתחשב בהם.</div></div>
 </div>`;
}

/* B7: רישום פעולות להאזנה המרכזת (ללא inline handlers) */
onAct({
 courierConfirmDelivery:t=>courierConfirmDelivery(t.dataset.a),
 courierPhotoDelivery:t=>courierPhotoDelivery(t.dataset.a),
 courierDayDate:t=>go('#/courier/day?date='+t.value), courierDayToday:()=>go('#/courier/day'),
 courierToggleAvail:t=>courierToggleAvail(t.dataset.a==='1'),
 courierProximity:()=>courierProximity(),
 courierAcceptOffer:t=>courierAcceptOffer(t.dataset.a,t.dataset.b),
 courierDeclineOffer:t=>courierDeclineOffer(t.dataset.a,t.dataset.b),
 courierProfileOff:t=>courierProfileOff(t),
 courierSaveProfile:()=>courierSaveProfile(),
 pushSubscribe:()=>pushSubscribe()
});
