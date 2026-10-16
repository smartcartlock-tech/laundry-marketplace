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
      return html.replace('<div class="body"><div class="subtabs">', '<div class="body">' + card + '<div class="subtabs">');
    }catch(e){ return html; }
  };
})();
