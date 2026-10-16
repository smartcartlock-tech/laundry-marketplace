/* דוחות וניתוח: כרטיס אנליטיקה בלשונית "דוחות" של המכבסה ובלשונית "דוח שבועי" של האדמין.
   הכנסות ליום, הזמנות לפי שירות, לקוחות חוזרים, ייצוא CSV. גרפים ב-CSS בלבד. נתוני דמו. */
(function(){
  const RANGES=[[7,'7 ימים'],[30,'30 ימים'],[90,'90 ימים']];
  const days=()=>Number(store.get('anDays',30))||30;
  const shortDay=s=>{const [,m,d]=s.split('-');return `${Number(d)}/${Number(m)}`};
  function chart(a){
    const max=Math.max(1,...a.daily.map(d=>d.revenue));
    const n=a.daily.length, step=Math.max(1,Math.ceil(n/7));
    return `<div style="display:flex;align-items:flex-end;gap:2px;height:120px;margin-top:12px;direction:ltr" role="img" aria-label="גרף הכנסות לפי יום">
      ${a.daily.map((d,i)=>`<div title="${shortDay(d.day)}: ₪${Math.round(d.revenue)} · ${d.orders} הזמנות" style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;min-width:0">
       <div style="width:100%;max-width:18px;background:linear-gradient(180deg,#12869b,#0a4f5c);border-radius:3px 3px 0 0;height:${d.revenue?Math.max(3,Math.round(d.revenue/max*88)):1}%;${d.revenue?'':'background:#d5dde2'}"></div>
       <div class="mut" style="font-size:9px;margin-top:3px;height:11px;white-space:nowrap">${i%step===0?shortDay(d.day):''}</div></div>`).join('')}</div>`;
  }
  function card(a,csvPath,csvName,scope){
    const T=a.totals, C=a.customers;
    const maxS=Math.max(1,...a.services.map(s=>Number(s.revenue)));
    const pct=C.repeat_pct||0;
    return `<div class="card" id="an-card"><div class="sec">אנליטיקה${scope?' — '+esc(scope):''} <span class="mut" style="font-weight:400">(נתוני דמו)</span></div>
     <div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0">${RANGES.map(r=>`<button class="btn2 ${days()===r[0]?'on':''}" onclick="anRange(${r[0]})">${r[1]}</button>`).join('')}</div>
     <div class="kpis">
      <div class="kpi"><b>₪${T.revenue}</b>הכנסות</div><div class="kpi"><b>${T.orders}</b>הזמנות</div>
      <div class="kpi"><b>₪${T.avg_order}</b>ממוצע להזמנה</div><div class="kpi"><b>${T.cancelled}</b>בוטלו</div></div>
     <b>הכנסות לפי יום</b>${T.orders?chart(a):'<div class="mut" style="margin-top:8px">אין הזמנות בטווח הנבחר</div>'}
     <div style="margin-top:14px"><b>הזמנות לפי שירות</b>
      ${a.services.map(s=>`<div style="margin-top:8px"><div class="row" style="border:none;padding:0"><div>${esc(s.service)}</div><div class="mut">${s.orders} הזמנות · ₪${s.revenue}</div></div><div class="bar-wrap"><div class="bar-fill" style="width:${Math.round(Number(s.revenue)/maxS*100)}%"></div></div></div>`).join('')||'<div class="mut">אין נתונים</div>'}</div>
     <div style="margin-top:14px"><b>לקוחות חוזרים</b>
      <div style="display:flex;gap:14px;align-items:center;margin-top:8px">
       <div role="img" aria-label="${pct}% לקוחות חוזרים" style="width:72px;height:72px;border-radius:50%;flex:none;background:conic-gradient(#0a4f5c ${pct*3.6}deg,#e5e7eb 0)"><div style="width:46px;height:46px;border-radius:50%;background:#fff;margin:13px;display:flex;align-items:center;justify-content:center;font-weight:700">${pct}%</div></div>
       <div class="mut">${C.returning} מתוך ${C.customers} לקוחות חוזרים${Number(C.returning_revenue)?` · הכנסה מהם ₪${C.returning_revenue}`:''}
        ${C.top.length?`<div>המובילים: ${C.top.map(c=>esc(c.name||'לקוח')+' ('+c.orders+')').join(', ')}</div>`:''}</div></div></div>
     ${a.by_tenant.length?`<div style="margin-top:14px"><b>לפי מכבסה</b><table class="tbl"><tr><th>מכבסה</th><th>הזמנות</th><th>הכנסות</th></tr>${a.by_tenant.map(t=>`<tr><td>${esc(t.name)}</td><td>${t.orders}</td><td>₪${t.revenue}</td></tr>`).join('')}</table></div>`:''}
     <button class="btn2" style="margin-top:12px" onclick="downloadCsv('${csvPath}?days=${days()}','${csvName}')">ייצוא אנליטיקה CSV</button></div>`;
  }
  function inject(html,c){const i=html.lastIndexOf('</div>');return i<0?html+c:html.slice(0,i)+c+html.slice(i)}
  window.anRange=function(d){store.set('anDays',d);route()};
  if(typeof window.vManage==='function'){
    const o=window.vManage;
    window.vManage=async function(sub){
      const html=await o(sub);
      if(sub!=='stats')return html;
      try{
        const m=(state.memberships||[]).find(x=>x.slug===store.get('lastTenant',''))||(state.memberships||[])[0];
        if(!m)return html;
        const a=await api(`/t/${m.slug}/analytics?days=${days()}`);
        return inject(html,card(a,`/t/${m.slug}/analytics.csv`,'analytics.csv'));
      }catch(e){return html}
    };
  }
  if(typeof window.vAdmin==='function'){
    const o=window.vAdmin;
    window.vAdmin=async function(sub){
      const html=await o(sub);
      if(sub!=='weekly')return html;
      try{
        const a=await api(`/admin/analytics?days=${days()}`);
        return inject(html,card(a,'/admin/analytics.csv','analytics.csv','כל הפלטפורמה'));
      }catch(e){return html}
    };
  }
})();
