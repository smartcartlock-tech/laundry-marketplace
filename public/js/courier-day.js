/* ---- courier day: מסלול יום + אישור מסירה (מסך שליח) ---- */
const COURIER_KIND={pickup:'📥 איסוף מהלקוח',collect:'🏪 איסוף מהמכבסה',deliver:'📦 מסירה ללקוח'};

async function vCourierDay(){
 if(!state.token)return needLogin();
 let me;try{me=await api('/auth/me')}catch(e){return needLogin()}
 if(!me.courier||!me.courier.approved)return vCourier();
 const d=await api('/courier/day-route');
 const t=await api('/courier/tasks');
 const s=d.summary;
 return `<div class="hdr"><h2>מסלול יום</h2><p>${new Date().toLocaleDateString('he-IL',{weekday:'long',day:'numeric',month:'long',timeZone:'Asia/Jerusalem'})} · ${me.courier.model==='platform'?'שליח פלטפורמה':me.courier.model==='shared'?'שליח משותף':'שליח מכבסה'}</p></div>
 <div class="body">
 <div class="subtabs"><a class="chip" href="#/courier">משימות</a><a class="chip on" href="#/courier/day">מסלול יום</a><a class="chip" href="#/courier/earnings">רווחים</a></div>
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
   ${!st.done?`<div style="display:flex;gap:8px;margin-top:8px">
     ${st.kind==='pickup'?`<button class="btn2 on" onclick="markOrder('${o.id}','picked_up')">סימון נאסף</button>`:''}
     ${st.kind==='collect'?`<button class="btn2 on" onclick="markOrder('${o.id}','out_for_delivery')">אספתי — יציאה ללקוח</button>`:''}
     ${st.kind==='deliver'?`<button class="btn2 green" onclick="courierConfirmDelivery('${o.id}')">מסירה עם אישור לקוח</button>`:''}
    </div>`:`<div class="mut" style="margin-top:6px">✓ הושלם · ${fmtDT(st.when)}</div>`}
  </div>`}).join('')}
 ${t.tasks.in_laundry.length?`<div class="sec">אצל המכבסה (${t.counts.in_laundry})</div>
  ${t.tasks.in_laundry.map(o=>`<div class="card"><b>${esc(o.tenant_name)}</b> <span class="st-pill st-${o.status}">${HE[o.status]}</span>
   <div class="mut">${esc(o.address)} · החזרה תתאפשר כשההזמנה תסומנה "מוכנה"</div></div>`).join('')}`:''}
 </div>`;
}

async function courierConfirmDelivery(orderId){
 const v=await xmodal({title:'אישור מסירה',body:'בקשו מהלקוח את 4 הספרות האחרונות של מספר הטלפון שלו כאישור קבלה.',okText:'אישור מסירה',fields:[{id:'code',label:'קוד אישור (4 ספרות)',value:'',type:'tel'}]});
 if(!v)return;
 try{
  await api(`/courier/orders/${orderId}/confirm-delivery`,{method:'POST',body:JSON.stringify({method:'code',code:v.code})});
  toast('המסירה אושרה ✓');route();
 }catch(e){toast(e.message)}
}
