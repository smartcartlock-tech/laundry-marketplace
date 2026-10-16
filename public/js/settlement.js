/* התחשבנות וחשבוניות (דמו): לשונית "התחשבנות" בלוח הניהול — דוח תשלומים, התחשבנות עמלה
   חודשית (ציפייה מול בפועל + הפרש), ייצוא לרואה חשבון ובדיקת רצף מספור.
   הנתונים מ-/api/t/:slug/settlement/* (route חדש). עצמאי: עוטף את vManage בלי לערוך קבצים של אחרים.
   בטיחות: כל טקסט דרך esc(), אין onclick inline — האזנה מרוכזת אחת עם data-stl-act. */
(function(){
  let cursor = null; // {y, m} של החודש הנבחר (ברירת מחדל: החודש הנוכחי)
  function cur(){
    if (cursor) return cursor;
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
    cursor = { y: d.getFullYear(), m: d.getMonth() + 1 };
    return cursor;
  }
  function monthRange(){
    const { y, m } = cur();
    const from = y + '-' + String(m).padStart(2,'0') + '-01';
    const last = new Date(y, m, 0).getDate();
    const to = y + '-' + String(m).padStart(2,'0') + '-' + String(last).padStart(2,'0');
    return { from, to, label: m + '/' + y };
  }
  function money(n){ return '₪' + Number(n || 0).toFixed(2); }

  async function settlementBody(slug){
    const { from, to, label } = monthRange();
    const [pay, comm, seq] = await Promise.all([
      api(`/t/${slug}/settlement/payments?from=${from}&to=${to}`),
      api(`/t/${slug}/settlement/commission?year=${cur().y}&month=${cur().m}`),
      api(`/t/${slug}/settlement/sequence-check`),
    ]);
    const k = pay.kpis;
    const kpi = (v,l) => `<div class="kpi"><b>${esc(v)}</b>${esc(l)}</div>`;
    const payRows = pay.by_method.map(x =>
      `<tr><td>${esc(x.method_he)}</td><td>${esc(x.status_he)}</td><td>${x.orders}</td><td>${money(x.total)}</td></tr>`).join('');
    const histRows = comm.history.map(h => {
      const diff = h.diff === null ? '—' : (h.diff === 0 ? '✓ 0' : money(h.diff));
      const cls = h.diff === null || h.diff === 0 ? '' : (h.diff > 0 ? 'style="color:#b00"' : 'style="color:#178a4c"');
      return `<tr><td>${h.month}/${h.year}</td><td>${money(h.expected_total)}</td><td>${h.actual_total === null ? '—' : money(h.actual_total)}</td><td ${cls}>${esc(diff)}</td><td>${esc(h.note || '')}</td></tr>`;
    }).join('');
    const st = comm.statement;
    const stLine = st
      ? (st.actual_total === null
          ? `<div class="mut">נרשמה ציפייה (${money(st.expected_total)}) — טרם הוזן חיוב בפועל</div>`
          : `<div>ציפייה ${money(st.expected_total)} · בפועל ${money(st.actual_total)} · הפרש <b style="color:${st.diff === 0 ? '#178a4c' : '#b00'}">${st.diff === 0 ? 'אין (תקין)' : money(st.diff)}</b></div>`)
      : '<div class="mut">טרם נרשמה התחשבנות לחודש זה</div>';
    const seqRows = seq.kinds.map(s =>
      `<tr><td>${esc(s.kind_he)}</td><td>${s.docs || 0}</td><td>${s.docs ? s.min + '–' + s.max : '—'}</td>
       <td>${s.ok ? '<span class="st-pill st-delivered">רציף ✓</span>' : `<span class="st-pill st-cancelled">פערים: ${esc((s.missing || []).slice(0, 10).join(', '))}${(s.missing || []).length > 10 ? '…' : ''}</span>`}</td></tr>`).join('');
    return `
    <div class="card"><div class="sec">דוח תשלומים · ${esc(label)} <span class="mut">(מסמך דמו)</span></div>
      <div style="display:flex;gap:6px;margin-bottom:8px">
        <button class="btn2" data-stl-act="prev">‹ חודש קודם</button>
        <button class="btn2" data-stl-act="next">חודש הבא ›</button>
      </div>
      <div class="kpis">${kpi(k.orders,'הזמנות')}${kpi(money(k.revenue),'מחזור')}${kpi(money(k.collected),'נגבה')}${kpi(money(k.pending),'ממתין לגבייה')}</div>
      ${pay.cancelled.orders ? `<div class="mut">בוטלו בתקופה: ${pay.cancelled.orders} הזמנות (${money(pay.cancelled.total)}) — לא נכלל במחזור</div>` : ''}
      ${pay.subscriptions && pay.subscriptions.count ? `<div class="mut">מנויים שהצטרפו/חודשו בתקופה: ${pay.subscriptions.count} · הכנסה ${money(pay.subscriptions.total)} (תשלום דמו)</div>` : ''}
      ${payRows ? `<table class="tbl"><tr><th>אמצעי</th><th>סטטוס גבייה</th><th>הזמנות</th><th>סה"כ</th></tr>${payRows}</table>` : '<div class="mut">אין הזמנות בחודש זה</div>'}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
        <button class="btn2" data-stl-act="csv-payments">ייצוא תשלומים CSV</button>
        <button class="btn2" data-stl-act="csv-accountant">ייצוא לרואה חשבון CSV</button>
        <button class="btn2" data-stl-act="pdf-summary">סיכום חודשי PDF</button>
        <button class="btn2" data-stl-act="consistency">בדיקת עקביות</button>
      </div>
      <div id="stl-cons" style="margin-top:6px"></div></div>
    <div class="card"><div class="sec">התחשבנות עמלה מול הפלטפורמה · ${esc(label)} <span class="mut">(דמו, ללא חיוב אמיתי)</span></div>
      <div class="row"><div>לקוחות שלך (ממותג)</div><div class="mut">${comm.expected.own.orders} הזמנות · ${money(comm.expected.own.revenue)} · ${comm.expected.own.pct}% ≈ ${money(comm.expected.own.commission)}</div></div>
      <div class="row"><div>לקוחות מרקטפלייס</div><div class="mut">${comm.expected.marketplace.orders} הזמנות · ${money(comm.expected.marketplace.revenue)} · ${comm.expected.marketplace.pct}% ≈ ${money(comm.expected.marketplace.commission)}</div></div>
      <div class="row"><div><b>ציפיית עמלה לחודש</b></div><div><b>${money(comm.expected.total)}</b></div></div>
      <div style="border-top:1px solid #e3edf0;margin-top:8px;padding-top:8px">${stLine}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        <input class="inp" id="stl-actual" type="number" min="0" step="0.01" placeholder="חיוב בפועל ₪" style="flex:1" ${st && st.actual_total !== null ? `value="${st.actual_total}"` : ''}>
        <input class="inp" id="stl-note" placeholder="הערה (רשות)" style="flex:2" ${st && st.note ? `value="${esc(st.note)}"` : ''}>
        <button class="btn2 on" data-stl-act="save-commission">רישום התחשבנות</button>
      </div>
      ${histRows ? `<div class="sec" style="font-size:13px;margin-top:10px">היסטוריה (12 חודשים)</div>
      <table class="tbl"><tr><th>חודש</th><th>ציפייה</th><th>בפועל</th><th>הפרש</th><th>הערה</th></tr>${histRows}</table>` : ''}</div>
    <div class="card"><div class="sec">מסמכים ומספור רציף <span class="mut">(מסמך דמו — לא חשבונית מס)</span></div>
      ${seqRows ? `<table class="tbl"><tr><th>סוג מסמך</th><th>הונפקו</th><th>טווח</th><th>רצף</th></tr>${seqRows}</table>` : ''}
      <div class="mut" style="margin-top:8px">${seq.ok ? 'המספור רציף בכל סוגי המסמכים ✓' : '⚠️ נמצאו פערים במספור — מומלץ לבדוק'}</div>
      <div style="margin-top:8px"><a class="chip" href="#/manage/documents">להפקת חשבונית מרכזת ולמסמכים ← לשונית מסמכים</a></div></div>`;
  }

  // עטיפת vManage: הזרקת הלשונית + רינדור המסך, בלי לערוך community.js
  if (typeof window.vManage === 'function'){
    const orig = window.vManage;
    window.vManage = async function(sub){
      const html = await orig(sub);
      try{
        const mems = state.memberships || [];
        const m = mems.find(x => x.slug === store.get('lastTenant','')) || mems[0];
        if (!m) return html;
        const chip = `<a class="chip ${sub === 'settlement' ? 'on' : ''}" href="#/manage/settlement">התחשבנות</a>`;
        let out = html.replace(/(<div class="subtabs">[\s\S]*?)(<\/div>)/, (mm, a, b) => a + chip + b);
        if (sub === 'settlement'){
          const body = await settlementBody(m.slug);
          out = out.replace(/<div class="subtabs">([\s\S]*?)<\/div>/, '<div class="subtabs">$1</div>' + body);
        }
        return out;
      }catch(e){ return html; }
    };
  }

  // האזנה מרוכזת (בלי onclick inline)
  document.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-stl-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-stl-act');
    const mems = state.memberships || [];
    const m = mems.find(x => x.slug === store.get('lastTenant','')) || mems[0];
    if (!m) return;
    const slug = m.slug;
    const { from, to } = monthRange();
    try{
      if (act === 'prev' || act === 'next'){
        const { y, m: mm } = cur();
        const d = new Date(y, mm - 1 + (act === 'next' ? 1 : -1), 1);
        cursor = { y: d.getFullYear(), m: d.getMonth() + 1 };
        route();
      } else if (act === 'csv-payments'){
        downloadCsv(`/t/${slug}/settlement/payments.csv?from=${from}&to=${to}`, `payments-${from}-${to}-demo.csv`);
      } else if (act === 'csv-accountant'){
        downloadCsv(`/t/${slug}/settlement/accountant-export.csv?from=${from}&to=${to}`, `accountant-export-${from}-${to}-demo.csv`);
      } else if (act === 'pdf-summary'){
        downloadCsv(`/t/${slug}/settlement/monthly-summary.pdf?from=${from}&to=${to}`, `monthly-summary-${from}-${to}-demo.pdf`);
      } else if (act === 'consistency'){
        const box = document.getElementById('stl-cons');
        if (box) box.innerHTML = '<div class="mut">בודק עקביות…</div>';
        const c = await api(`/t/${slug}/settlement/consistency?from=${from}&to=${to}`);
        const rows = c.checks.map(ch =>
          `<div class="row"><div>${esc(ch.label)}</div><div>${ch.ok ? '<span class="st-pill st-delivered">תקין ✓</span>' : `<span class="st-pill st-cancelled">פער: ${esc(String(ch.a))} מול ${esc(String(ch.b))}</span>`}</div></div>`).join('');
        if (box) box.innerHTML = `<div class="card" style="margin:0"><div class="sec" style="font-size:13px">עקביות דוח תשלומים · מסמכים · התחשבנות <span class="mut">(דמו)</span></div>${rows}</div>`;
      } else if (act === 'save-commission'){
        const inp = document.getElementById('stl-actual');
        const note = document.getElementById('stl-note');
        const raw = inp && inp.value !== '' ? Number(inp.value) : null;
        if (raw !== null && !(raw >= 0)) return toast('סכום לא תקין');
        const r = await api(`/t/${slug}/settlement/commission`, { method: 'POST', body: JSON.stringify({ year: cur().y, month: cur().m, actual_total: raw, note: note ? note.value : '' }) });
        toast(r.statement && r.statement.diff !== null && r.statement.diff !== 0 ? `נרשם — הפרש ${money(r.statement.diff)}` : 'ההתחשבנות נרשמה');
        route();
      }
    }catch(e){ toast(e.message); }
  });
})();
