/* B3: שיפורי אשף ההקמה — שמירת טיוטה (שרת), שחזור אחרי רענון, סיכום שדות חסרים חי, הוספת פריט למחירון.
   עצמאי: עוטף vJoin/renderJoinReview/joinSubmit בלי לערוך join.js. */
(function(){
  let saveTimer = null;

  function currentDraft(){
    const d = window.joinDraft; if (!d) return null;
    const g = id => { const el = document.getElementById(id); return el ? el.value : undefined; };
    return { ...d,
      name: g('jr-name') !== undefined ? g('jr-name') : d.name,
      phone: g('jr-phone') !== undefined ? g('jr-phone') : d.phone,
      address: g('jr-address') !== undefined ? g('jr-address') : d.address,
      city: g('jr-city') !== undefined ? g('jr-city') : d.city,
      delivery_fee: g('jr-fee') !== undefined ? Number(g('jr-fee')) : d.delivery_fee,
      turnaround_hours: g('jr-turn') !== undefined ? Number(g('jr-turn')) : d.turnaround_hours };
  }

  function missingSummary(){
    const d = currentDraft(); if (!d) return '';
    const miss = [];
    if (!(d.name || '').trim()) miss.push('שם');
    if (!(d.phone || '').trim()) miss.push('טלפון');
    if (!(d.address || '').trim()) miss.push('כתובת');
    if (!(d.city || '').trim()) miss.push('עיר');
    if (!(d.items || []).length) miss.push('פריט מחירון אחד לפחות');
    if (!Object.values(d.hours || {}).some(v => v && v.length)) miss.push('שעות פעילות');
    if (!(d.windows || []).some(w => w && w.kind === 'delivery')) miss.push('חלון החזרה');
    if (!miss.length) return '<div class="note" style="margin-bottom:8px">✅ כל שדות החובה מולאו — אפשר לשלוח לאישור.</div>';
    return `<div class="warn" style="margin-bottom:8px">חסרים לפני שליחה: ${miss.join(', ')}</div>`;
  }

  function scheduleSave(){
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const d = currentDraft(); if (!d || !state.token) return;
      try{
        await api('/onboard/draft', { method: 'POST', body: JSON.stringify({ draft: d }) });
        const el = document.getElementById('wiz-saved'); if (el) el.textContent = 'הטיוטה נשמרה ✓';
      }catch(e){ /* שמירת טיוטה לא חוסמת */ }
    }, 1200);
  }

  if (typeof window.renderJoinReview === 'function'){
    const orig = window.renderJoinReview;
    window.renderJoinReview = function(){
      orig.apply(this, arguments);
      const host = document.getElementById('join-review'); if (!host) return;
      // סיכום חסרים חי מעל הטפסים
      const sum = document.createElement('div'); sum.id = 'wiz-missing'; sum.innerHTML = missingSummary();
      host.prepend(sum);
      // הוספת פריט לטבלת המחירון + שורת סטטוס שמירה
      const btn = host.querySelector('button.btn');
      if (btn){
        const add = document.createElement('button');
        add.className = 'btn2'; add.style.marginInlineStart = '6px'; add.textContent = '+ הוספת פריט למחירון';
        add.onclick = () => {
          const nm = prompt('שם הפריט (למשל: חולצה)'); if (!nm) return;
          const pr = Number(prompt('מחיר ב-₪')); if (!(pr > 0)) return toast('מחיר לא תקין');
          window.joinDraft.items = window.joinDraft.items || [];
          window.joinDraft.items.push({ name: nm, price: pr, unit: 'item', category: 'כביסה', confidence: 'high' });
          window.renderJoinReview();
        };
        btn.after(add);
        const saved = document.createElement('span'); saved.id = 'wiz-saved'; saved.className = 'mut'; saved.style.marginInlineStart = '8px';
        add.after(saved);
      }
      host.querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => {
        const s = document.getElementById('wiz-missing'); if (s) s.innerHTML = missingSummary();
        scheduleSave();
      }));
      scheduleSave();
    };
  }

  if (typeof window.joinSubmit === 'function'){
    const origSubmit = window.joinSubmit;
    window.joinSubmit = async function(){
      await origSubmit.apply(this, arguments);
      if (document.querySelector('#join-review .note')){
        try{ await api('/onboard/draft', { method: 'DELETE' }); }catch(e){}
      }
    };
  }

  // שחזור טיוטה שמורה בכניסה לאשף
  if (typeof window.vJoin === 'function'){
    const origJoin = window.vJoin;
    window.vJoin = async function(){
      const html = await origJoin.apply(this, arguments);
      if (!state.token) return html;
      (async () => {
        // ה-router מזריק את ה-HTML אחרי שה-view חוזר — מחכים שה-DOM יתעדכן
        let host = null;
        for (let i = 0; i < 10 && !host; i++){
          await new Promise(r => setTimeout(r, 300));
          host = document.getElementById('join-extract') || document.getElementById('join-review');
        }
        try{
          const r = await api('/onboard/draft');
          if (!r.draft || window.joinDraft) return;
          if (!host) return;
          const bar = document.createElement('div');
          bar.className = 'card'; bar.style.marginTop = '10px';
          bar.innerHTML = `<b>נמצאה טיוטה שמורה</b> <span class="mut">(נשמרה ${fmtDT(r.updated_at)})</span>
            <div style="display:flex;gap:6px;margin-top:8px">
             <button class="btn2 on" id="wiz-restore">המשך מהטיוטה</button>
             <button class="btn2" id="wiz-discard">מחיקת הטיוטה</button></div>`;
          host.prepend(bar);
          document.getElementById('wiz-restore').onclick = () => { window.joinDraft = r.draft; window.renderJoinReview(); bar.remove(); };
          document.getElementById('wiz-discard').onclick = async () => { try{ await api('/onboard/draft', { method: 'DELETE' }); }catch(e){} bar.remove(); };
        }catch(e){}
      })();
      return html;
    };
  }
})();
