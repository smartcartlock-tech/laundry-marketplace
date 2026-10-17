/* הנה״ח — מסך יומן (T55): פקודה ידנית, צפייה בפקודות עם שורות, סטורנו דרך ה-API הקיים.
   סטורנו מוצע רק לפקודות ידניות (source=manual) שעוד לא סווטרנו: סטורנו של פקודת
   מסמך ממתין לעקביות מסמך-פקודה (T42 בשרת), הוצאה מבטלים ממסך ההוצאות.
   נצרב לתחתית לשונית הנה״ח דרך window.bkJournal.card(...) ש-bookkeeping.js קורא בזמן רינדור.
   בטיחות: כל טקסט דרך esc(), אין onclick inline — האזנה מרוכזת עם data-bkj-act. */
(function(){
  function money(n){ return '₪' + Number(n || 0).toFixed(2); }
  const SRC_HE = { manual: 'פקודת יומן', invoice: 'חשבונית', expense: 'הוצאה', bank: 'בנק', reversal: 'סטורנו' };

  function lineRowHtml(){
    return `
      <div class="bk-j-line" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:4px">
        <select class="inp bk-j-acc" style="flex:2">${window.bkJournal._accOpts}</select>
        <select class="inp bk-j-party" style="flex:1"><option value="">— ללא כרטיס —</option>${window.bkJournal._partyOpts}</select>
        <input class="inp bk-j-debit" type="number" min="0" step="0.01" placeholder="חובה ₪" style="width:90px">
        <input class="inp bk-j-credit" type="number" min="0" step="0.01" placeholder="זכות ₪" style="width:90px">
        <input class="inp bk-j-details" placeholder="פרטים" style="flex:2">
      </div>`;
  }

  function card(entsRes, accsRes, partiesRes){
    window.bkJournal._accs = accsRes; window.bkJournal._parties = partiesRes;
    const entries = (entsRes && entsRes.entries) || [];
    const accs = ((accsRes && accsRes.accounts) || []).filter(a => a.active);
    const parties = ((partiesRes && partiesRes.parties) || []).filter(p => p.active);
    window.bkJournal._accOpts = accs.map(a => `<option value="${a.code}">${a.code} · ${esc(a.name_he)}</option>`).join('');
    window.bkJournal._partyOpts = parties.map(p => `<option value="${p.id}">${esc(p.name)} (${p.kind === 'supplier' ? 'ספק' : 'לקוח'})</option>`).join('');

    const reversedIds = new Set(entries.map(e => e.reversal_of).filter(Boolean));
    const reversalByOrig = {};
    entries.forEach(e => { if (e.reversal_of) reversalByOrig[e.reversal_of] = e.entry_no; });

    const rows = entries.map(e => {
      const total = (e.lines || []).reduce((s, l) => s + Number(l.debit || 0), 0);
      const lineRows = (e.lines || []).map(l => `
        <tr><td>${esc(l.account_code)}</td><td>${esc(l.account_name)}</td>
          <td>${l.party_name ? esc(l.party_name) : '—'}</td>
          <td>${Number(l.debit) ? money(l.debit) : ''}</td><td>${Number(l.credit) ? money(l.credit) : ''}</td>
          <td>${esc(l.details || '')}</td></tr>`).join('');
      let action;
      if (e.source === 'manual' && !reversedIds.has(e.id)) {
        action = `<button class="btn2" data-bkj-act="reverse" data-id="${e.id}" data-no="${e.entry_no}">סטורנו</button>`;
      } else if (reversedIds.has(e.id)) {
        action = `<span class="mut">בוצע סטורנו (#${reversalByOrig[e.id]})</span>`;
      } else if (e.source === 'reversal') {
        action = `<span class="mut">פקודת סטורנו${e.reversal_of ? ` ל-#${entries.find(x => x.id === e.reversal_of) ? (entries.find(x => x.id === e.reversal_of).entry_no) : ''}` : ''}</span>`;
      } else if (e.source === 'expense') {
        action = `<span class="mut">ביטול דרך מסך ההוצאות</span>`;
      } else {
        action = `<span class="mut">ביטול מסמך באמצעות זיכוי בלבד</span>`;
      }
      return `
      <tr class="bk-j-row" data-date="${esc(String(e.entry_date).slice(0, 10))}">
        <td>${e.entry_no}</td><td>${esc(String(e.entry_date).slice(0, 10))}</td>
        <td><details><summary>${esc(e.description)}</summary>
          <table class="tbl" style="margin-top:4px"><tr><th>קוד</th><th>חשבון</th><th>כרטיס</th><th>חובה</th><th>זכות</th><th>פרטים</th></tr>${lineRows}</table>
        </details></td>
        <td>${esc(SRC_HE[e.source] || e.source)}</td><td>${money(total)}</td><td>${action}</td>
      </tr>`;
    }).join('');

    return `
    <div class="card" id="bk-journal-card"><div class="sec">יומן — פקודות ורישומים</div>
      <details style="margin-bottom:8px"><summary>פקודת יומן ידנית</summary>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0">
          <input class="inp" id="bk-j-date" type="date" style="width:150px">
          <input class="inp" id="bk-j-desc" placeholder="תיאור הפקודה (חובה)" style="flex:3">
        </div>
        <div id="bk-j-lines">${lineRowHtml()}${lineRowHtml()}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:4px">
          <button class="btn2" data-bkj-act="add-line">+ שורה</button>
          <span class="mut" id="bk-j-balance">חובה 0.00 · זכות 0.00</span>
          <button class="btn2 on" data-bkj-act="submit-entry">רישום פקודה</button>
        </div>
        <div class="mut" style="margin-top:4px">הפקודה חייבת להיות מאוזנת (חובה = זכות). תקופה סגורה תיחסם בשרת.</div>
      </details>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px">
        <input class="inp" id="bk-j-from" type="date" style="width:140px">
        <input class="inp" id="bk-j-to" type="date" style="width:140px">
        <button class="btn2" data-bkj-act="filter">סינון</button>
        <button class="btn2" data-bkj-act="clear-filter">ניקוי</button>
        <span class="mut">מוצגות עד 500 פקודות אחרונות</span>
      </div>
      <div style="overflow-x:auto">
      ${rows ? `<table class="tbl" id="bk-j-table"><tr><th>מס׳</th><th>תאריך</th><th>תיאור ושורות</th><th>מקור</th><th>סכום</th><th>פעולות</th></tr>${rows}</table>`
        : '<div class="mut">אין פקודות עדיין</div>'}</div>
    </div>`;
  }

  window.bkJournal = { card, _accOpts: '', _partyOpts: '' };

  const val = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };

  function sums(){
    let d = 0, c = 0;
    document.querySelectorAll('#bk-j-lines .bk-j-line').forEach((row) => {
      d += Number(row.querySelector('.bk-j-debit').value || 0);
      c += Number(row.querySelector('.bk-j-credit').value || 0);
    });
    return { d, c };
  }

  // מחוון איזון חי בטופס הפקודה
  document.addEventListener('input', (ev) => {
    if (!ev.target || !ev.target.closest || !ev.target.closest('#bk-journal-card')) return;
    const el = document.getElementById('bk-j-balance');
    if (!el) return;
    const { d, c } = sums();
    el.textContent = `חובה ${d.toFixed(2)} · זכות ${c.toFixed(2)}` + (Math.abs(d - c) <= 0.004 && d > 0 ? ' · מאוזנת ✓' : '');
  });

  document.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-bkj-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-bkj-act');
    const mems = state.memberships || [];
    const m = mems.find(x => x.slug === store.get('lastTenant','')) || mems[0];
    if (!m || m.role !== 'owner' || btn.disabled) return;
    btn.disabled = true;
    const B = `/t/${m.slug}/bookkeeping`;
    try{
      if (act === 'add-line'){
        const box = document.getElementById('bk-j-lines');
        if (box) box.insertAdjacentHTML('beforeend', lineRowHtml());
      } else if (act === 'filter'){
        const from = val('bk-j-from'), to = val('bk-j-to');
        if (from && to && from > to) { toast('תאריך ההתחלה מאוחר מתאריך הסיום'); return; }
        const query = new URLSearchParams();
        if (from) query.set('from', from); if (to) query.set('to', to);
        const result = await api(`${B}/entries?${query}`);
        const panel = document.getElementById('bk-journal-card');
        if (panel) {
          panel.outerHTML = card(result, window.bkJournal._accs, window.bkJournal._parties);
          document.getElementById('bk-j-from').value = from;
          document.getElementById('bk-j-to').value = to;
        }
      } else if (act === 'clear-filter'){
        const f = document.getElementById('bk-j-from'), t = document.getElementById('bk-j-to');
        if (f) f.value = ''; if (t) t.value = '';
        route();
      } else if (act === 'submit-entry'){
        const desc = val('bk-j-desc');
        if (desc.length < 2) { toast('תיאור פקודה חסר'); return; }
        const lines = [];
        let bad = null;
        document.querySelectorAll('#bk-j-lines .bk-j-line').forEach((row) => {
          const debit = Number(row.querySelector('.bk-j-debit').value || 0);
          const credit = Number(row.querySelector('.bk-j-credit').value || 0);
          if (!debit && !credit) return; // שורה ריקה — מדלגים
          if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0 || (debit > 0) === (credit > 0)) { bad = 'כל שורה חייבת להיות חובה או זכות בלבד'; return; }
          lines.push({
            account_code: row.querySelector('.bk-j-acc').value,
            party_id: row.querySelector('.bk-j-party').value || undefined,
            debit, credit,
            details: row.querySelector('.bk-j-details').value.trim() || undefined,
          });
        });
        if (bad) { toast(bad); return; }
        if (lines.length < 2) { toast('פקודה דורשת לפחות 2 שורות'); return; }
        const { d, c } = sums();
        if (Math.abs(d - c) > 0.004 || d <= 0) { toast(`פקודה לא מאוזנת: חובה ${d.toFixed(2)} מול זכות ${c.toFixed(2)}`); return; }
        const body = {
          entry_date: val('bk-j-date') || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
          description: desc, lines,
        };
        await api(`${B}/entries`, { method: 'POST', body: JSON.stringify(body) });
        toast('הפקודה נרשמה'); route();
      } else if (act === 'reverse'){
        if (!await xconfirm(`לבצע סטורנו לפקודה ${esc(btn.getAttribute('data-no'))}? תיווצר פקודת היפוכה חדשה.`)) return;
        const r = await api(`${B}/entries/${btn.getAttribute('data-id')}/reverse`, { method: 'POST' });
        toast(`בוצע סטורנו — פקודה ${r.reversal.entry_no}`); route();
      }
    }catch(e){ toast(e.message || 'שגיאה'); }
    finally { btn.disabled = false; }
  });
})();
