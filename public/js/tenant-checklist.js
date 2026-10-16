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
      // B4: שורת הסכם שירות — קריאה ואישור דיגיטלי מתוך הכרטיס
      let agreementHtml = '';
      try{
        const ag = await api(`/t/${m.slug}/agreement`);
        agreementHtml = ag.accepted_at
          ? `<div class="mut" style="margin-top:6px">✅ הסכם שירות (גרסה ${esc(ag.accepted_version)}) אושר ב-${fmtDT(ag.accepted_at)}</div>`
          : `<details style="margin-top:8px"><summary style="cursor:pointer;color:#0e7a8a;font-weight:600">📄 יש לקרוא ולאשר את הסכם השירות (גרסה ${esc(ag.version)})</summary>
             <div style="white-space:pre-wrap;background:#f6f9fa;border-radius:8px;padding:10px;margin-top:6px;font-size:13px;max-height:220px;overflow:auto">${esc(ag.text)}</div>
             <button class="btn2 on" style="margin-top:8px" onclick="acceptAgreement('${m.slug}','${esc(ag.version)}',this)">קראתי ואני מסכים/ה</button></details>`;
      }catch(e){ /* ההסכם לא חוסם את הכרטיס */ }
      const color = d.complete ? '#178a4c' : '#0e7a8a';
      const rows = d.items.map(i =>
        `<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-top:1px solid #edf1f4">
         <span>${i.done ? '✅' : '◻️'} ${esc(i.label)}</span>${i.done ? '' : `<span class="mut">${esc(i.action)}</span>`}</div>`).join('');
      const card = `<div class="card"><div class="sec">מוכנות המכבסה — ${d.percent}%</div>
        <div style="background:#e5e7eb;border-radius:8px;height:8px"><div style="background:${color};width:${d.percent}%;height:8px;border-radius:8px"></div></div>
        <div style="margin-top:6px">${rows}</div>
        ${d.complete
          ? `<div class="note" style="margin-top:8px;color:#178a4c">המכבסה מוכנה לפעילות 🎉</div>`
          : `<div class="mut" style="margin-top:6px">אלו הפריטים שחסרים לפני שהמכבסה מוכנה ומאושרת.</div>`}${agreementHtml}</div>`;
      return html.replace('<div class="body"><div class="subtabs">', '<div class="body">' + card + '<div class="subtabs">');
    }catch(e){ return html; }
  };
  window.acceptAgreement = async function(slug, version, btn){
    btn.disabled = true;
    try{
      await api(`/t/${slug}/agreement/accept`, { method: 'POST', body: JSON.stringify({ version }) });
      toast('הסכם השירות אושר — תודה!'); route();
    }catch(e){ btn.disabled = false; toast(e.message); }
  };
})();
