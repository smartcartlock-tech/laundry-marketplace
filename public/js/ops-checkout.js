/* אכיפת ימי סגירה בתפריט חלונות האיסוף/המשלוח — עטיפה עצמאית של vCheckout, בלי עריכת checkout.js.
   מסיר אפשרויות שהתאריך שלהן הוא יום סגירה; האכיפה הכפולה נשארת בשרת (409). */
(function(){
  if (typeof window.vCheckout !== 'function') return;
  const orig = window.vCheckout;
  const cache = {}; /* slug -> {ts, days:Set} */
  async function closureDays(slug){
    const c = cache[slug];
    if (c && Date.now()-c.ts < 60000) return c.days;
    try{
      const r = await fetch('/api/public-ops/laundry/'+encodeURIComponent(slug)+'/ops-state');
      if (!r.ok) return new Set();
      const d = await r.json();
      const days = new Set((d.closures||[]).map(x=>x.day));
      cache[slug] = {ts:Date.now(), days};
      return days;
    }catch(e){ return new Set(); }
  }
  function localDay(weekday, timeStr){
    /* אותה לוגיקה כמו nextWindowDate, עם פורמט YYYY-MM-DD לפי שעון מקומי */
    const dt = new Date(nextWindowDate(weekday, timeStr));
    const p = n=>String(n).padStart(2,'0');
    return dt.getFullYear()+'-'+p(dt.getMonth()+1)+'-'+p(dt.getDate());
  }
  window.vCheckout = async function(slug){
    const html = await orig(slug);
    try{
      const days = await closureDays(slug);
      if (!days.size) return html;
      const t = document.createElement('template');
      t.innerHTML = html;
      let removed = 0;
      t.content.querySelectorAll('#co-pickup option, #co-delivery option').forEach(o=>{
        const v = o.value||'';
        const parts = v.split('|');
        if (parts.length !== 2) return;
        if (days.has(localDay(Number(parts[0]), parts[1]))){ o.remove(); removed++; }
      });
      if (removed){
        t.content.querySelectorAll('#co-pickup, #co-delivery').forEach(sel=>{
          const note = document.createElement('option');
          note.disabled = true;
          note.textContent = '— ימי סגירה לא מוצעים —';
          sel.appendChild(note);
        });
      }
      return t.innerHTML;
    }catch(e){ return html; }
  };
})();
