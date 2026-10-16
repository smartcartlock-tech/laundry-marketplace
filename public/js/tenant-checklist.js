/* B1: כרטיס "מוכנות המכבסה" בלוח הניהול — אחוז השלמה + פעולה מתקנת לכל פריט חסר.
   הנתונים מ-/api/t/:slug/checklist (route חדש). עצמאי: עוטף את vManage בלי לערוך קבצים של אחרים. */
(function(){
  if (typeof window.vManage !== 'function') return;
  const orig = window.vManage;
  window.vManage = async function(sub){
    const html = await orig(sub);
    try{
      const mems = state.memberships || [];
      const m = mems.find(x => x.slug === store.get('lastTenant','')) || mems[0];
      if (!m) return html;
      const d = await api(`/t/${m.slug}/checklist`);
      const color = d.complete ? '#178a4c' : '#0e7a8a';
      const rows = d.items.map(i =>
        `<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-top:1px solid #edf1f4">
         <span>${i.done ? '✅' : '◻️'} ${esc(i.label)}</span>${i.done ? '' : `<span class="mut">${esc(i.action)}</span>`}</div>`).join('');
      const card = `<div class="card"><div class="sec">מוכנות המכבסה — ${d.percent}%</div>
        <div style="background:#e5e7eb;border-radius:8px;height:8px"><div style="background:${color};width:${d.percent}%;height:8px;border-radius:8px"></div></div>
        <div style="margin-top:6px">${rows}</div>
        ${d.complete
          ? `<div class="note" style="margin-top:8px;color:#178a4c">המכבסה מוכנה לפעילות 🎉</div>`
          : `<div class="mut" style="margin-top:6px">אלו הפריטים שחסרים לפני שהמכבסה מוכנה ומאושרת.</div>`}</div>`;
      return html.replace('<div class="body"><div class="subtabs">', '<div class="body">' + card + '<div class="subtabs">');
    }catch(e){ return html; }
  };
})();
