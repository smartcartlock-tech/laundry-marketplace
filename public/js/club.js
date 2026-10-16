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
    <span class="logo sm" style="background:${cssColor(sb.color)}">${esc(sb.letter||'מ')}</span>
    <div style="flex:1"><b>${esc(sb.tenant_name)}</b> · ${esc(sb.plan_name)} ${sb.status==='paused'?'<span class="tag tb">מושהה</span>':''}
     <div class="mut">₪${sb.plan_price}/חודש · מתחדש ${fmtDate(sb.period_end)}</div>
     ${sb.perks?`<div class="mut">${esc(sb.perks)}</div>`:''}
    </div>
    <div style="text-align:center;min-width:64px"><b style="font-size:22px;color:#0e7a8a">${fmtQ(sb.bags_remaining)}</b><div class="mut">שקים נותרו</div></div>
   </div>
   <div class="mut" style="margin:8px 0 2px">נוצלו ${fmtQ(sb.bags_used)} מתוך ${sb.bags_per_month} שקים החודש</div>
   <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
    <button class="btn2" data-act="subUsage" data-a="${sb.id}">היסטוריית ניצול</button>
    ${sb.status==='active'?`<button class="btn2" data-act="subUpgrade" data-a="${sb.id}" data-b="${sb.slug}">שינוי תוכנית</button><button class="btn2" data-act="subAct" data-a="${sb.id}" data-b="pause">השהיה</button>`:''}
    ${sb.status==='paused'?`<button class="btn2 on" data-act="subAct" data-a="${sb.id}" data-b="resume">חידוש מנוי</button>`:''}
    <button class="btn2" style="border-color:#f3c2c2;color:#c22" data-act="subCancel" data-a="${sb.id}">ביטול מנוי</button>
   </div>
  </div>`).join(''):''}
  <div class="card"><b>התראות דחיפה</b><div class="mut" style="margin:4px 0">עדכון מיידי בכל שינוי סטטוס בהזמנה — גם כשהאפליקציה סגורה</div>
   <button class="btn2 on" id="push-btn" data-act="pushSubscribe">🔔 הפעלת התראות</button></div>
  <div class="sec">נקודות</div>
  ${d.balances.map(b=>`<div class="card lcard"><span class="logo sm" style="background:${cssColor(b.color)}">${esc(b.letter||'מ')}</span>
   <div style="flex:1"><b>${esc(b.name)}</b><div class="mut">יתרה: <b style="color:#0e7a8a">${b.balance}</b> נקודות (שוות ₪${b.balance})</div></div></div>`).join('')||'<div class="card mut">עוד אין נקודות — כל הזמנה צוברת</div>'}
  <div class="sec">תנועות אחרונות</div>
  <div class="card">${d.recent.map(p=>`<div class="row"><div>${esc(p.name)}<div class="mut">${esc(({review_bonus:'בונוס על ביקורת'})[p.reason]||p.reason||'')}</div></div><div style="color:${p.delta>0?'#178a4c':'#c22'};font-weight:700">${p.delta>0?'+':''}${p.delta}</div></div>`).join('')||'<div class="mut">אין תנועות</div>'}</div>
 </div>`;
}
/* B7: רישום פעולות להאזנה המרכזת (ללא inline handlers) */
onAct({
 pushSubscribe:()=>pushSubscribe(), subAct:t=>subAct(t.dataset.a,t.dataset.b),
 subCancel:t=>subCancel(t.dataset.a), subUpgrade:t=>subUpgrade(t.dataset.a,t.dataset.b), subUsage:t=>subUsage(t.dataset.a)
});
