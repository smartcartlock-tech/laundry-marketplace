/* הנהלת חשבונות אמיתית (לא דמו): לשונית "הנה״ח" בלוח הניהול — בעלים בלבד.
   מסך מאוחד RTL: לוח (איזון, ממתינים להקצאה), מסמכים, הוצאות, בנק, דוחות.
   הנתונים מ-/api/t/:slug/bookkeeping/* — ההרשאה נאכפת בשרת (owner בלבד).
   בטיחות: כל טקסט דרך esc(), אין onclick inline — האזנה מרוכזת עם data-bk-act. */
(function(){
  function money(n){ return '₪' + Number(n || 0).toFixed(2); }
  const KINDS = [['tax_invoice','חשבונית מס'],['tax_invoice_receipt','חשבונית מס/קבלה'],['invoice','חשבונית עסקה'],['receipt','קבלה']];
  const pill = (txt, ok) => `<span class="st-pill ${ok ? 'st-delivered' : 'st-cancelled'}">${esc(txt)}</span>`;

  async function bookkeepingBody(slug){
    const B = `/t/${slug}/bookkeeping`;
    const [accs, parties, docs, exps, bankTx, tb, pnl, vat, pend, uni, recon, sett] = await Promise.all([
      api(`${B}/accounts`), api(`${B}/parties`), api(`${B}/documents`), api(`${B}/expenses`),
      api(`${B}/bank/transactions`), api(`${B}/trial-balance`),
      api(`${B}/reports/pnl`), api(`${B}/reports/vat`), api(`${B}/reports/pending-allocation`), api(`${B}/uniform-export`), api(`${B}/bank/reconciliation`),
      api(`/t/${slug}/settings`),
    ]);
    // פקודות יומן — נטען רק כשמודול היומן (T55) קיים בדף
    const ents = window.bkJournal ? await api(`${B}/entries`) : { entries: [] };
    // עוסק פטור: מסתירים סוגי חשבונית מס ובאנר הקצאה (השרת חוסם — כאן מונעים הצעה מבלבלת)
    const isMorasha = !!(sett.tenant && sett.tenant.dealer_type === 'morasha');
    const kinds = isMorasha ? KINDS : KINDS.filter(k => k[0] === 'invoice' || k[0] === 'receipt');
    const supOpts = parties.parties.filter(p => p.kind === 'supplier' && p.active)
      .map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    const expAccOpts = accs.accounts.filter(a => a.type === 'expense')
      .map(a => `<option value="${a.code}">${a.code} · ${esc(a.name_he)}</option>`).join('');
    const allAccOpts = accs.accounts.filter(a => a.active && a.code !== '1010')
      .map(a => `<option value="${a.code}">${a.code} · ${esc(a.name_he)}</option>`).join('');

    const docRows = docs.documents.map(d => `
      <tr><td>${esc(d.kind_he)}</td><td>${esc(d.customer_name)}</td>
        <td>${d.doc_number ? d.doc_year + '-' + d.doc_number : '—'}</td>
        <td>${money(d.total)}${d.paid_amount && Number(d.paid_amount) > 0 ? `<div class="mut">שולם ${money(d.paid_amount)}</div>` : ''}</td><td>${pill(d.status_he, d.status === 'issued')}
          ${d.fully_credited ? '<div class="mut">זוכה במלואו</div>' : ''}
          ${d.source_document_id ? `<div class="mut">מקור: ${esc((docs.documents.find(x => x.id === d.source_document_id) || {}).doc_number || d.source_document_id)}</div>` : ''}
          ${d.allocation_number ? `<div class="mut">מספר הקצאה: <b dir="ltr">${esc(d.allocation_number)}</b><br>הוזן ידנית · לא מאומת מול רשות המסים</div>` : ''}</td>
        <td>${d.status === 'draft' && !d.has_allocation && d.kind.startsWith('tax')
            ? `<input class="inp" id="bk-alloc-${d.id}" placeholder="מספר הקצאה" style="width:110px">
               <button class="btn2" data-bk-act="allocate" data-id="${d.id}">הזנה</button>` : ''}
            ${d.status === 'issued' && ['invoice','tax_invoice'].includes(d.kind) && !d.fully_credited && Number(d.total) - Number(d.paid_amount || 0) > 0.004 ? `<button class="btn2" data-bk-act="source-receipt" data-id="${d.id}">קבלה לתשלום</button>` : ''}
            ${isMorasha && d.status === 'issued' && ['invoice','tax_invoice','tax_invoice_receipt'].includes(d.kind) && !d.fully_credited ? `<button class="btn2" data-bk-act="source-credit" data-id="${d.id}">זיכוי מלא (330)</button>` : ''}
            ${d.status === 'draft' ? `<button class="btn2 on" data-bk-act="issue" data-id="${d.id}">הנפקה</button>
              <button class="btn2" data-bk-act="cancel-doc" data-id="${d.id}">ביטול</button>` : ''}</td></tr>`).join('');

    const expRows = exps.expenses.map(x => `
      <tr><td>${esc(x.expense_date.slice(0, 10))}</td><td>${esc(x.supplier)}</td><td>${esc(x.description)}</td>
        <td>${esc(x.account_code)}</td><td>${money(x.total)}</td>
        <td>${x.status === 'posted' ? pill('רשומה', true) : x.status === 'void' ? pill('מבוטלת', false) : pill('טיוטה', false)}</td>
        <td>${x.has_file ? `<button class="btn2" data-bk-act="open-file" data-id="${x.id}">קובץ</button>` : ''}
            ${x.status === 'draft' ? `<button class="btn2 on" data-bk-act="post-exp" data-id="${x.id}">רישום</button>` : ''}
            ${x.status !== 'void' ? `<button class="btn2" data-bk-act="void-exp" data-id="${x.id}">ביטול</button>` : ''}</td></tr>`).join('');

    const unmatched = bankTx.transactions.filter(t => t.status === 'unmatched');
    const bankRows = unmatched.map(t => `
      <tr><td>${esc(t.tx_date.slice(0, 10))}</td><td>${esc(t.description || '')}</td>
        <td style="color:${Number(t.amount) >= 0 ? '#178a4c' : '#b00'}">${money(t.amount)}</td>
        <td><select class="inp" id="bk-book-acc-${t.id}">${allAccOpts}</select>
            <button class="btn2 on" data-bk-act="book-bank" data-id="${t.id}">רישום לספר</button></td></tr>`).join('');
    const un = recon.by_status.unmatched || { count: 0 };

    const pnlIncRows = pnl.income.map(r => `<tr><td>${r.code}</td><td>${esc(r.name_he)}</td><td>${money(r.net)}</td></tr>`).join('');
    const pnlExpRows = pnl.expenses.map(r => `<tr><td>${r.code}</td><td>${esc(r.name_he)}</td><td>${money(r.net)}</td></tr>`).join('');

    return `
    <section id="bk-workspace" dir="rtl" aria-label="הנהלת חשבונות">
    <style>
      #bk-workspace { min-width:0; max-width:100%; }
      #bk-workspace .card { min-width:0; max-width:100%; overflow-x:auto; box-sizing:border-box; }
      #bk-workspace .inp { box-sizing:border-box; min-width:0; max-width:100%; }
      #bk-workspace .tbl { width:100%; }
      #bk-workspace .tbl th, #bk-workspace .tbl td { overflow-wrap:anywhere; }
      #bk-workspace summary { cursor:pointer; }
      @media(max-width:600px) {
        #bk-workspace .inp { flex:1 0 100% !important; width:100% !important; min-width:100% !important; }
        #bk-workspace .btn2 { min-height:44px; }
        #bk-workspace input[type=file] { max-width:100%; }
        #bk-workspace .tbl { min-width:560px; }
        #bk-workspace .tbl th, #bk-workspace .tbl td { white-space:nowrap; overflow-wrap:normal; }
        #bk-workspace .kpis { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); }
        #bk-workspace .bk-j-line { border-bottom:1px solid #e3edf0; padding-bottom:8px; }
        #bk-workspace .btn2 { white-space:normal; }
      }
    </style>
    <div class="card" style="border:2px solid #c26a12">
      <div class="sec">הנהלת חשבונות · מסמך דמו · בעלים בלבד</div>
      ${isMorasha ? `<div style="background:#fdf3e3;border:1px solid #e8c07a;border-radius:8px;padding:8px;font-weight:600">
        חשבונית מס אינה נשלחת ללקוח בלי מספר הקצאה. מספר מבקשים באזור האישי של רשות המסים ומזינים כאן.</div>` : ''}
      <div class="kpis" style="margin-top:8px">
        <div class="kpi"><b>${tb.totals.balanced ? '✓' : '⚠️'}</b>${tb.totals.balanced ? 'ספר מאוזן' : 'ספר לא מאוזן'}</div>
        <div class="kpi"><b>${pend.count}</b>ממתינים להקצאה</div>
        <div class="kpi"><b>${money(pnl.net_profit)}</b>רווח נטו מתחילת שנה</div>
        <div class="kpi"><b>${un.count}</b>תנועות בנק ממתינות</div>
      </div></div>

    <div class="card"><div class="sec">מסמכים</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
        <select class="inp" id="bk-doc-kind" style="flex:1">${kinds.map(k => `<option value="${k[0]}">${k[1]}</option>`).join('')}</select>
        <input class="inp" id="bk-doc-cust" placeholder="שם לקוח" style="flex:2">
        <input class="inp" id="bk-doc-net" type="number" min="0" step="0.01" placeholder="נטו ₪" style="width:90px">
        <input class="inp" id="bk-doc-vat" type="number" min="0" step="0.01" placeholder="מע״מ ₪" style="width:90px">
        <button class="btn2 on" data-bk-act="create-doc">יצירת טיוטה</button>
      </div>
      ${docRows ? `<table class="tbl"><tr><th>סוג</th><th>לקוח</th><th>מספר</th><th>סכום</th><th>סטטוס</th><th>פעולות</th></tr>${docRows}</table>` : '<div class="mut">אין מסמכים עדיין</div>'}</div>

    <div class="card"><div class="sec">הוצאות וספקים</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
        <select class="inp" id="bk-exp-sup" style="flex:1"><option value="">— ספק —</option>${supOpts}</select>
        <select class="inp" id="bk-exp-acc" style="flex:1">${expAccOpts}</select>
        <input class="inp" id="bk-exp-desc" placeholder="תיאור" style="flex:2">
        <input class="inp" id="bk-exp-date" type="date" style="width:140px">
        <input class="inp" id="bk-exp-net" type="number" min="0" step="0.01" placeholder="נטו ₪" style="width:90px">
        ${isMorasha ? `<input class="inp" id="bk-exp-vat" type="number" min="0" step="0.01" placeholder="מע״מ ₪" style="width:90px">` : ''}
        <input type="file" id="bk-exp-file" accept=".pdf,image/jpeg,image/png,image/webp" style="width:170px">
        <button class="btn2 on" data-bk-act="create-exp">הוספת הוצאה</button>
        <button class="btn2" data-bkp-act="sup-toggle">+ ספק חדש</button>
      </div>
      <div id="bk-new-sup" hidden style="gap:6px;flex-wrap:wrap;margin-bottom:8px;border:1px dashed #e3edf0;border-radius:8px;padding:6px">
        <input class="inp" id="bk-ns-name" placeholder="שם ספק (חובה)" style="flex:2">
        <input class="inp" id="bk-ns-taxid" inputmode="numeric" placeholder="מספר עוסק/ח.פ" style="width:120px">
        <input class="inp" id="bk-ns-phone" placeholder="טלפון" style="width:120px">
        <button class="btn2 on" data-bkp-act="sup-create">צור ספק</button>
      </div>
      ${expRows ? `<table class="tbl"><tr><th>תאריך</th><th>ספק</th><th>תיאור</th><th>חשבון</th><th>סכום</th><th>סטטוס</th><th>פעולות</th></tr>${expRows}</table>` : '<div class="mut">אין הוצאות עדיין</div>'}</div>

    <div class="card"><div class="sec">בנק — ייבוא והתאמה</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
        <input type="file" id="bk-bank-file" accept=".csv" style="width:220px">
        <button class="btn2 on" data-bk-act="import-bank">ייבוא CSV</button>
        <span class="mut">יתרת הבנק בספר: ${money(recon.ledger_bank_balance)}</span>
      </div>
      ${bankRows ? `<table class="tbl"><tr><th>תאריך</th><th>תיאור</th><th>סכום</th><th>רישום מול חשבון</th></tr>${bankRows}</table>` : '<div class="mut">אין תנועות ממתינות</div>'}</div>

    <div class="card"><div class="sec">דוחות · מתחילת שנה</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
        <button class="btn2" data-bk-act="csv-accountant">ייצוא לרואה חשבון CSV</button>
      </div>
      <div style="border:1px solid #e3edf0;border-radius:8px;padding:8px;margin-bottom:8px">
        <b>מבנה אחיד (OPENFRMT) — טיוטה</b>
        <div class="mut" style="margin:4px 0">התוכנה טרם נרשמה ברשות המסים, ולכן שדה רישום התוכנה מאופס. הקבצים לעיון ולרואה החשבון, לא להגשה.</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <input class="inp" id="bk-uni-from" type="date" style="width:140px">
          <input class="inp" id="bk-uni-to" type="date" style="width:140px">
          <button class="btn2 on" data-bk-act="uniform-gen">הפקת INI.TXT + BKMVDATA.zip</button>
        </div>
        ${(uni.exports && uni.exports.length) ? `<table class="tbl" style="margin-top:6px"><tr><th>טווח</th><th>הופק</th><th>רשומות</th><th>הורדה</th></tr>${uni.exports.slice(0, 5).map(x => `
          <tr><td>${esc(x.from_date.slice(0, 10))} — ${esc(x.to_date.slice(0, 10))}</td>
            <td>${esc(x.created_at.slice(0, 10))}</td><td>${(x.counts && x.counts.total) || 0}</td>
            <td><button class="btn2" data-bk-act="uniform-dl-ini" data-id="${x.id}">INI.TXT</button>
                <button class="btn2" data-bk-act="uniform-dl-bkmv" data-id="${x.id}">BKMVDATA.zip</button></td></tr>`).join('')}</table>` : ''}
      </div>
      <div class="row"><div><b>הכנסות</b></div><div><b>${money(pnl.total_income)}</b></div></div>
      ${pnlIncRows ? `<table class="tbl">${pnlIncRows}</table>` : ''}
      <div class="row" style="margin-top:6px"><div><b>הוצאות</b></div><div><b>${money(pnl.total_expenses)}</b></div></div>
      ${pnlExpRows ? `<table class="tbl">${pnlExpRows}</table>` : ''}
      <div class="row" style="border-top:1px solid #e3edf0;margin-top:6px;padding-top:6px"><div><b>רווח נטו</b></div><div><b>${money(pnl.net_profit)}</b></div></div>
      ${vat.applicable ? `<div class="mut" style="margin-top:8px">מע״מ תקופה: עסקאות ${money(vat.vat_on_sales)} · תשומות ${money(vat.vat_on_inputs)} · יתרה <b>${money(vat.balance)}</b><br>${esc(vat.disclaimer)}</div>`
        : `<div class="mut" style="margin-top:8px">${esc(vat.note || '')}</div>`}
      ${pend.count ? `<div class="sec" style="font-size:13px;margin-top:10px">ממתינים למספר הקצאה (${pend.count})</div>
        <table class="tbl"><tr><th>סוג</th><th>לקוח</th><th>סכום</th></tr>${pend.pending.map(d => `<tr><td>${esc(d.kind_he)}</td><td>${esc(d.customer_name)}</td><td>${money(d.total)}</td></tr>`).join('')}</table>` : ''}</div>

    ${window.bkParties ? window.bkParties.card(parties) : ''}
    ${window.bkJournal ? window.bkJournal.card(ents, accs, parties) : ''}</section>`;
  }

  if (typeof window.vManage === 'function'){
    const orig = window.vManage;
    window.vManage = async function(sub){
      const html = await orig(sub);
      try{
        const mems = state.memberships || [];
        const m = mems.find(x => x.slug === store.get('lastTenant','')) || mems[0];
        if (!m || m.role !== 'owner') return html; // בעלים בלבד — גם הלשונית מוסתרת מ-staff
        const chip = `<a class="chip ${sub === 'bookkeeping' ? 'on' : ''}" href="#/manage/bookkeeping">הנה״ח</a>`;
        let out = html.replace(/(<div class="subtabs">[\s\S]*?)(<\/div>)/, (mm, a, b) => a + chip + b);
        if (sub === 'bookkeeping'){
          const body = await bookkeepingBody(m.slug);
          out = out.replace(/<div class="subtabs">([\s\S]*?)<\/div>/, '<div class="subtabs">$1</div>' + body);
        }
        return out;
      }catch(e){ return html; }
    };
  }

  const val = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  document.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-bk-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-bk-act');
    const id = btn.getAttribute('data-id');
    const mems = state.memberships || [];
    const m = mems.find(x => x.slug === store.get('lastTenant','')) || mems[0];
    if (!m) return;
    const B = `/t/${m.slug}/bookkeeping`;
    if (btn.disabled) return;
    btn.disabled = true;
    try{
      if (act === 'source-receipt' || act === 'source-credit') {
        const current = await api(`${B}/documents`);
        const source = current.documents.find(d => d.id === id);
        if (!source || source.status !== 'issued' || source.fully_credited) { toast('מסמך המקור אינו זמין לתשלום או לזיכוי'); return; }
        const credit = act === 'source-credit';
        const remaining = Math.round((Number(source.total) - Number(source.paid_amount || 0)) * 100) / 100;
        let amount = Number(source.amount_net);
        if (credit) {
          if (!await xconfirm(`ליצור טיוטת זיכוי מלא למסמך ${esc(source.doc_year)}-${esc(source.doc_number)} על סך ${money(source.total)}? מסמך דמו בלבד. המקור נשאר בספר.`)) return;
        } else {
          if (remaining <= 0) { toast('לא נותרה יתרה לתשלום'); return; }
          const input = await xmodal({ title: 'קבלה לתשלום · מסמך דמו', body: `מסמך ${esc(source.doc_year)}-${esc(source.doc_number)} · יתרה ${money(remaining)}. תיווצר טיוטה בלבד, ללא גביית כסף.`, fields: [{id:'amount', label:'סכום התשלום הכולל', type:'number', value:String(remaining)}], okText:'יצירת טיוטה' });
          if (!input) return;
          amount = Number(input.amount);
          if (!Number.isFinite(amount) || amount <= 0 || amount > remaining + 0.004) { toast('סכום התשלום חייב להיות חיובי ועד היתרה'); return; }
        }
        await api(`${B}/documents`, { method:'POST', body:JSON.stringify({ kind:credit ? 'credit_note':'receipt', source_document_id:id, customer_name:source.customer_name, amount_net:amount, vat_amount:credit ? Number(source.vat_amount):0, notes:'מסמך דמו' }) });
        toast('טיוטה מקושרת נוצרה · מסמך דמו'); route();
      } else if (act === 'create-doc'){
        const body = { kind: val('bk-doc-kind'), customer_name: val('bk-doc-cust'), amount_net: Number(val('bk-doc-net')), vat_amount: Number(val('bk-doc-vat') || 0) };
        await api(`${B}/documents`, { method: 'POST', body: JSON.stringify(body) }); toast('טיוטה נוצרה'); route();
      } else if (act === 'allocate'){
        const num = val('bk-alloc-' + id);
        await api(`${B}/documents/${id}/allocate`, { method: 'POST', body: JSON.stringify({ allocation_number: num }) });
        toast('מספר הקצאה נרשם — אפשר להנפיק'); route();
      } else if (act === 'issue'){
        await api(`${B}/documents/${id}/issue`, { method: 'POST' }); toast('המסמך הונפק ונרשם בספר'); route();
      } else if (act === 'cancel-doc'){
        await api(`${B}/documents/${id}/cancel`, { method: 'POST' }); toast('הטיוטה בוטלה'); route();
      } else if (act === 'create-exp'){
        const fd = new FormData();
        fd.append('party_id', val('bk-exp-sup'));
        fd.append('account_code', val('bk-exp-acc'));
        fd.append('description', val('bk-exp-desc'));
        fd.append('expense_date', val('bk-exp-date') || new Date().toISOString().slice(0, 10));
        fd.append('amount_net', val('bk-exp-net'));
        fd.append('vat_amount', val('bk-exp-vat') || '0');
        const f = document.getElementById('bk-exp-file');
        if (f && f.files[0]) fd.append('invoice', f.files[0]);
        const r = await fetch('/api' + B + '/expenses', { method: 'POST', headers: { Authorization: 'Bearer ' + state.token }, body: fd });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { toast(d.error || 'שגיאה'); return; }
        toast('ההוצאה נוצרה כטיוטה'); route();
      } else if (act === 'post-exp'){
        await api(`${B}/expenses/${id}/post`, { method: 'POST' }); toast('ההוצאה נרשמה בספר'); route();
      } else if (act === 'void-exp'){
        await api(`${B}/expenses/${id}/void`, { method: 'POST' }); toast('ההוצאה בוטלה'); route();
      } else if (act === 'open-file'){
        const r = await fetch('/api' + B + `/expenses/${id}/file`, { headers: { Authorization: 'Bearer ' + state.token } });
        if (!r.ok) { toast('קובץ לא נמצא'); return; }
        const b = await r.blob(); const url = URL.createObjectURL(b);
        window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else if (act === 'import-bank'){
        const f = document.getElementById('bk-bank-file');
        if (!f || !f.files[0]) { toast('יש לבחור קובץ CSV'); return; }
        const fd = new FormData(); fd.append('statement', f.files[0]);
        const r = await fetch('/api' + B + '/bank/import', { method: 'POST', headers: { Authorization: 'Bearer ' + state.token }, body: fd });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { toast(d.error || 'שגיאה'); return; }
        toast(`יובאו ${d.rows} תנועות` + (d.skipped ? ` (${d.skipped} דולגו)` : '')); route();
      } else if (act === 'book-bank'){
        const acc = val('bk-book-acc-' + id);
        await api(`${B}/bank/transactions/${id}/book`, { method: 'POST', body: JSON.stringify({ account_code: acc }) });
        toast('התנועה נרשמה בספר'); route();
      } else if (act === 'csv-accountant'){
        downloadCsv(`${B}/accountant-export.csv`, 'bookkeeping-export.csv');
      } else if (act === 'uniform-gen'){
        const from = val('bk-uni-from'), to = val('bk-uni-to');
        if (!from || !to) { toast('לבחור טווח תאריכים'); return; }
        const r = await api(`${B}/uniform-export`, { method: 'POST', body: JSON.stringify({ from, to }) });
        toast(`הופק (טיוטה): ${r.counts.total} רשומות`); route();
      } else if (act === 'uniform-dl-ini'){
        downloadCsv(`${B}/uniform-export/${id}/ini`, 'INI.TXT');
      } else if (act === 'uniform-dl-bkmv'){
        downloadCsv(`${B}/uniform-export/${id}/bkmv`, 'BKMVDATA.zip');
      }
    }catch(e){ toast(e.message || 'שגיאה'); }
    finally { btn.disabled = false; }
  });
})();
