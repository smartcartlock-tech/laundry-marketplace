/* הנה״ח — כרטיסי ספקים/לקוחות (T3): מסך כרטיסים עם חיפוש + יצירה,
   וספק חדש inline בטופס ההוצאה. נטען אחרי bookkeeping.js; נצרב לתחתית
   לשונית הנה״ח דרך window.bkParties.card(...) ש-bookkeeping.js קורא בזמן רינדור.
   בטיחות: כל טקסט דרך esc(), אין onclick inline — האזנה מרוכזת עם data-bkp-act. */
(function(){
  function moneyKind(k){ return k === 'supplier' ? 'ספק' : 'לקוח'; }

  function card(partiesRes){
    const parties = (partiesRes && partiesRes.parties) || [];
    const rows = parties.map(p => `
      <tr class="bk-p-row" data-name="${esc((p.name || '') + ' ' + (p.phone || '') + ' ' + (p.email || ''))}">
        <td>${esc(moneyKind(p.kind))}</td><td>${esc(p.name)}</td>
        <td>${p.tax_id ? esc(p.tax_id) : '—'}</td><td>${esc(p.phone || '—')}</td>
        <td>${esc(p.email || '—')}</td>
        <td>${p.active ? '<span class="st-pill st-delivered">פעיל</span>' : '<span class="st-pill st-cancelled">לא פעיל</span>'}</td>
      </tr>`).join('');
    return `
    <div class="card" id="bk-parties-card"><div class="sec">כרטיסי ספקים ולקוחות</div>
      <details style="margin-bottom:8px"><summary>כרטיס חדש</summary>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
          <select class="inp" id="bk-p-kind" style="flex:1">
            <option value="supplier">ספק</option><option value="customer">לקוח</option>
          </select>
          <input class="inp" id="bk-p-name" placeholder="שם (חובה)" style="flex:2">
          <input class="inp" id="bk-p-taxid" inputmode="numeric" placeholder="מספר עוסק/ח.פ" style="width:120px">
          <input class="inp" id="bk-p-phone" placeholder="טלפון" style="width:120px">
          <input class="inp" id="bk-p-email" type="email" placeholder="אימייל" style="flex:1">
          <input class="inp" id="bk-p-address" placeholder="כתובת" style="flex:2">
          <button class="btn2 on" data-bkp-act="create">יצירת כרטיס</button>
        </div>
        <div class="mut" style="margin-top:4px">מספר העוסק נשמר מוצפן ומוצג מוסתר בלבד.</div>
      </details>
      <input class="inp" id="bk-p-search" placeholder="חיפוש כרטיס…" style="width:220px;margin-bottom:6px">
      <div style="overflow-x:auto">
      ${rows ? `<table class="tbl" id="bk-p-table"><tr><th>סוג</th><th>שם</th><th>עוסק/ח.פ</th><th>טלפון</th><th>אימייל</th><th>סטטוס</th></tr>${rows}</table>`
        : '<div class="mut">אין כרטיסים עדיין — צרו כרטיס ראשון למעלה</div>'}</div>
    </div>`;
  }

  window.bkParties = { card };

  const val = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };

  // חיפוש חי בטבלת הכרטיסים
  document.addEventListener('input', (ev) => {
    if (!ev.target || ev.target.id !== 'bk-p-search') return;
    const term = ev.target.value.trim().toLocaleLowerCase();
    document.querySelectorAll('#bk-p-table .bk-p-row').forEach((tr) => {
      tr.style.display = !term || (tr.getAttribute('data-name') || '').toLocaleLowerCase().includes(term) ? '' : 'none';
    });
  });

  document.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-bkp-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-bkp-act');
    const mems = state.memberships || [];
    const m = mems.find(x => x.slug === store.get('lastTenant','')) || mems[0];
    if (!m || m.role !== 'owner' || btn.disabled) return;
    btn.disabled = true;
    const B = `/t/${m.slug}/bookkeeping`;
    try{
      if (act === 'create'){
        const body = {
          kind: val('bk-p-kind'), name: val('bk-p-name'),
          tax_id: val('bk-p-taxid') || undefined,
          phone: val('bk-p-phone') || undefined,
          email: val('bk-p-email') || undefined,
          address: val('bk-p-address') || undefined,
        };
        if (!body.name || body.name.length < 2) { toast('שם כרטיס חסר'); return; }
        await api(`${B}/parties`, { method: 'POST', body: JSON.stringify(body) });
        toast('הכרטיס נוצר'); route();
      } else if (act === 'sup-toggle'){
        const d = document.getElementById('bk-new-sup');
        if (d) { d.hidden = !d.hidden; d.style.display = d.hidden ? '' : 'flex'; }
      } else if (act === 'sup-create'){
        const body = {
          kind: 'supplier', name: val('bk-ns-name'),
          tax_id: val('bk-ns-taxid') || undefined,
          phone: val('bk-ns-phone') || undefined,
        };
        if (!body.name || body.name.length < 2) { toast('שם ספק חסר'); return; }
        const result = await api(`${B}/parties`, { method: 'POST', body: JSON.stringify(body) });
        const select = document.getElementById('bk-exp-sup');
        if (select && result.party && result.party.id) {
          const option = document.createElement('option');
          option.value = result.party.id; option.textContent = result.party.name || body.name;
          select.appendChild(option); select.value = result.party.id;
          const panel = document.getElementById('bk-new-sup');
          if (panel) { panel.hidden = true; panel.style.display = ''; }
          toast('הספק נוצר ונבחר להוצאה');
        } else { toast('הספק נוצר'); route(); }
      }
    }catch(e){ toast(e.message || 'שגיאה'); }
    finally { btn.disabled = false; }
  });
})();
