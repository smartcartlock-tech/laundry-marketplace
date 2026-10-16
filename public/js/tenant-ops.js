/* C5: כרטיס "סיכום יומי" בלוח הניהול — נוצרו/נאספו/נמסרו היום, איחורים, פילוח שליחים.
   הנתונים מ-/api/t/:slug/ops/daily-summary (route חדש). עצמאי: עוטף את vManage בלי לערוך קבצים של אחרים. */
(function(){
  if (typeof window.vManage !== 'function') return;
  const orig = window.vManage;
  window.vManage = async function(sub){
    const html = await orig(sub);
    try{
      const mems = state.memberships || [];
      const m = mems.find(x => x.slug === store.get('lastTenant','')) || mems[0];
      if (!m) return html;
      const d = await api(`/t/${m.slug}/ops/daily-summary`);
      const lateRows = d.late.length
        ? d.late.map(o => `<div style="padding:4px 0;border-top:1px solid #f3e2e2"><b dir="ltr">#${o.id.slice(0,8)}</b> ${esc(o.customer_name||'')} <span class="st-pill st-${o.status}">${HE[o.status]||o.status}</span><div class="mut">החזרה: ${fmtDT(o.delivery_at)}</div></div>`).join('')
        : '<div class="mut">אין איחורים 🎉</div>';
      const courierRows = d.couriers.length
        ? d.couriers.map(c => `<div style="display:flex;justify-content:space-between;padding:4px 0;border-top:1px solid #edf1f4"><span>${esc(c.name)}</span><span class="mut">נאספו ${c.picked_today} · נמסרו ${c.delivered_today} · פעילות ${c.active}</span></div>`).join('')
        : '<div class="mut">לא שובצו שליחים היום</div>';
      const stat = (n, l, color) => `<div style="flex:1;text-align:center"><div style="font-size:22px;font-weight:800;color:${color}">${n}</div><div class="mut" style="font-size:12px">${l}</div></div>`;
      const card = `<div class="card"><div class="sec">סיכום יומי · ${d.date.split('-').reverse().join('.')}</div>
        <div style="display:flex;gap:8px;margin:6px 0">${stat(d.created_today,'נוצרו','#0e7a8a')}${stat(d.picked_today,'נאספו','#8a6d1a')}${stat(d.delivered_today,'נמסרו','#178a4c')}</div>
        <div class="sec" style="font-size:13px">איחורים (${d.late.length})</div>${lateRows}
        <div class="sec" style="font-size:13px">שליחים</div>${courierRows}</div>`;
      // עיגון גמיש (כלל DEVELOPMENT.md): מיד אחרי <div class="body"> — עמיד לשינויי מבנה של הלוח
      const anchor = '<div class="body">';
      return html.includes(anchor) ? html.replace(anchor, anchor + card) : card + html;
    }catch(e){ return html; }
  };
})();

/* C1+C3: ניהול מצב "עסוק" וימי סגירה — מוזרק לכרטיס הסיכום היומי + באנר ללקוח בדף המכבסה */
async function opsPauseToggle(slug, pause){
 try{
  if(pause){const r=await api(`/t/${slug}/ops/pause`,{method:'POST',body:JSON.stringify({minutes:120})});toast('ההזמנות הושהו עד '+new Date(r.paused_until).toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'}))}
  else{await api(`/t/${slug}/ops/resume`,{method:'POST',body:'{}'});toast('קבלת הזמנות חודשה')}
  route();
 }catch(e){toast(e.message)}
}
async function opsClosureAdd(slug){
 const inp=document.getElementById('ops-closure-day');if(!inp||!inp.value)return;
 /* קלט dd/mm/yyyy עברי → YYYY-MM-DD לשרת */
 const m=inp.value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
 if(!m){toast('פורמט תאריך: dd/mm/yyyy');return}
 const day=m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');
 try{await api(`/t/${slug}/ops/closures`,{method:'POST',body:JSON.stringify({day})});toast('יום הסגירה נוסף');route()}catch(e){toast(e.message)}
}
async function opsClosureDel(slug,day){
 try{await api(`/t/${slug}/ops/closures/${day}`,{method:'DELETE'});toast('יום הסגירה הוסר');route()}catch(e){toast(e.message)}
}
(function(){
  if (typeof window.vManage !== 'function') return;
  const orig = window.vManage;
  window.vManage = async function(sub){
    const html = await orig(sub);
    try{
      const mems = state.memberships || [];
      const m = mems.find(x => x.slug === store.get('lastTenant','')) || mems[0];
      if (!m) return html;
      const d = await api(`/t/${m.slug}/ops/state`);
      const paused = d.paused_until && new Date(d.paused_until) > new Date();
      const card = `<div class="card"><div class="sec">זמינות לקבלת הזמנות</div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
         <span class="st-pill ${paused?'st-cancelled':'st-delivered'}">${paused?'מושהה עד '+new Date(d.paused_until).toLocaleString('he-IL',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}):'פעיל'}</span>
         <button class="btn2" data-act="opsPauseToggle" data-a="${m.slug}" data-b="${!paused}">${paused?'חידוש קבלת הזמנות':'השהיה לשעתיים'}</button></div>
        <div class="sec" style="font-size:13px;margin-top:8px">ימי סגירה/חגים</div>
        <div style="display:flex;gap:6px;align-items:center"><input type="text" class="inp" id="ops-closure-day" placeholder="dd/mm/yyyy" inputmode="numeric" style="max-width:170px"><button class="btn2" data-act="opsClosureAdd" data-a="${m.slug}">הוספה</button></div>
        ${d.closures.length?d.closures.map(c=>`<div style="display:flex;justify-content:space-between;padding:4px 0;border-top:1px solid #edf1f4"><span>${c.day.split('-').reverse().join('/')}${c.note?' · '+esc(c.note):''}</span><a style="color:#b00;cursor:pointer" data-act="opsClosureDel" data-a="${m.slug}" data-b="${c.day}">הסרה</a></div>`).join(''):'<div class="mut">אין ימי סגירה מתוכננים</div>'}</div>`;
      return html.replace('<div class="body">', '<div class="body">' + card);
    }catch(e){ return html; }
  };
  /* באנר ללקוח בדף המכבסה כשהמכבסה מושהית או סגורה בחג */
  if (typeof window.vLaundry === 'function'){
    const origL = window.vLaundry;
    window.vLaundry = async function(slug){
      const html = await origL(slug);
      try{
        const r = await fetch('/api/public-ops/laundry/'+encodeURIComponent(slug)+'/ops-state');
        if (!r.ok) return html;
        const d = await r.json();
        const paused = d.paused_until && new Date(d.paused_until) > new Date();
        const soon = (d.closures||[]).slice(0,3);
        if (!paused && !soon.length) return html;
        const msg = paused
          ? `<b>המכבסה בהפסקה זמנית</b> עד ${new Date(d.paused_until).toLocaleString('he-IL',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'})} — אפשר לעיין במחירון, הזמנה תתאפשר כשההפסקה תסתיים`
          : `<b>שימו לב:</b> המכבסה סגורה ב־${soon.map(c=>c.day.split('-').reverse().join('/')).join(', ')}`;
        const banner = `<div class="card warn" style="text-align:center">${msg}</div>`;
        return html.replace('<div class="body">', '<div class="body">'+banner);
      }catch(e){ return html; }
    };
  }
})();
/* B7: רישום פעולות להאזנה המרכזת (ללא inline handlers) */
onAct({
 opsClosureAdd:t=>opsClosureAdd(t.dataset.a), opsClosureDel:t=>opsClosureDel(t.dataset.a,t.dataset.b),
 opsPauseToggle:t=>opsPauseToggle(t.dataset.a,t.dataset.b==='true')
});
