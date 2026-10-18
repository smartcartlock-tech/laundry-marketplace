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
             <button class="btn2 on" style="margin-top:8px" data-act="acceptAgreement" data-a="${m.slug}" data-b="${esc(ag.version)}">קראתי ואני מסכים/ה</button></details>`;
      }catch(e){ /* ההסכם לא חוסם את הכרטיס */ }
      const color = d.complete ? '#178a4c' : '#0e7a8a';
      const rows = d.items.map(i =>
        `<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-top:1px solid #edf1f4">
         <span>${i.done ? '✅' : '◻️'} ${esc(i.label)}</span>${i.done ? '' : `<span class="mut">${esc(i.action)}</span>`}</div>`).join('');
      /* T116: הכרטיס מכווץ — פתוח רק בלשונית 'היום' כדי לא לתפוס גלילה מלאה בכל לשונית */
      const card = `<details class="card" ${sub==='today'?'open':''}><summary style="cursor:pointer;font-weight:700">מוכנות המכבסה — ${d.percent}%${d.complete?' ✅':''}</summary>
        <div style="background:#e5e7eb;border-radius:8px;height:8px;margin-top:8px"><div style="background:${color};width:${d.percent}%;height:8px;border-radius:8px"></div></div>
        <div style="margin-top:6px">${rows}</div>
        ${d.complete
          ? `<div class="note" style="margin-top:8px;color:#178a4c">המכבסה מוכנה לפעילות 🎉</div>`
          : `<div class="mut" style="margin-top:6px">אלו הפריטים שחסרים לפני שהמכבסה מוכנה ומאושרת.</div>`}${agreementHtml}</details>`;
      // עיגון גמיש: הכרטיס מוכנס מיד אחרי <div class="body"> — עמיד גם אם מבנה הלוח משתנה (למשל הוספת לוח זמינות לפני ה-subtabs)
      /* M07: הכרטיס מוכנס אחרי תפריט הניהול (subtabs) — התפריט נשאר בראש ולא נדחף ל-y1109 */
      const st = '<div class="subtabs">';
      if (html.includes(st)) { const ci = html.indexOf('</div>', html.indexOf(st)); if (ci > 0) return html.slice(0, ci + 6) + card + html.slice(ci + 6); }
      const anchor = '<div class="body">';
      return html.includes(anchor) ? html.replace(anchor, anchor + card) : card + html;
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
/* B7: רישום פעולות להאזנה המרכזת (ללא inline handlers) */
onAct({
 acceptAgreement:t=>acceptAgreement(t.dataset.a,t.dataset.b,t)
});
