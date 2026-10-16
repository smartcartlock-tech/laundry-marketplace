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

