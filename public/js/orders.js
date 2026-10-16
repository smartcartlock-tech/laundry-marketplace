/* ---- orders ---- */
async function vOrders(){
 if(!state.token)return needLogin();
 const r=await api('/orders/mine');
 return `<div class="hdr"><h2>ההזמנות שלי</h2></div>
 <div class="body">
  ${(()=>{const act=r.orders.filter(o=>o.status!=='cancelled'),cnc=r.orders.filter(o=>o.status==='cancelled');state.__cncCount=cnc.length;return act.map(o=>`<div class="card lcard" style="cursor:pointer" onclick="go('#/orders/${o.id}')">
    <span class="logo sm" style="background:${cssColor(o.color)}">${esc(o.letter||'מ')}</span>
    <div style="flex:1"><b>${esc(o.tenant_name)}</b> <span class="st-pill st-${o.status}">${HE[o.status]}</span>
    <div class="mut">${fmtDT(o.created_at)} · ₪${o.total}${o.items&&o.items.length?' · '+o.items.slice(0,2).map(i=>esc(i.name)+' ×'+fmtQ(i.qty)).join(', ')+(o.items.length>2?' +'+(o.items.length-2):''):''}</div></div>
    ${o.status==='delivered'?`<button class="btn2" style="flex-shrink:0" onclick="event.stopPropagation();reorder('${o.id}','${o.slug}')" title="הוספת אותם פריטים לסל">↻ שוב</button>`:''}
    <span style="color:#8a99a3">‹</span></div>`).join('')||'<div class="card mut">עוד אין הזמנות פעילות. <a href="#/" style="color:#0e7a8a">להתחיל</a></div>'})()}
  ${r.orders.some(o=>o.status==='cancelled')?`<details class="card" style="cursor:pointer"><summary class="mut" style="cursor:pointer">הזמנות שבוטלו (${r.orders.filter(o=>o.status==='cancelled').length}) — הצגה</summary>`+r.orders.filter(o=>o.status==='cancelled').map(o=>`<div class="card lcard" style="cursor:pointer;opacity:.75" onclick="go('#/orders/${o.id}')">
    <span class="logo sm" style="background:${cssColor(o.color)}">${esc(o.letter||'מ')}</span>
    <div style="flex:1"><b>${esc(o.tenant_name)}</b> <span class="st-pill st-${o.status}">${HE[o.status]}</span>
    <div class="mut">${fmtDT(o.created_at)} · ₪${o.total}</div></div>
    <span style="color:#8a99a3">‹</span></div>`).join('')+`</details>`:''}
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
  ${isMine?`<div style="text-align:center;margin-bottom:12px"><button class="btn2" onclick="shareOrder('${o.id}')">⤴ שיתוף פרטי ההזמנה</button></div>`:''}
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

