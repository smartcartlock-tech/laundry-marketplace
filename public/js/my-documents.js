/* E12.T4: כרטיס "המסמכים שלי" במסך החשבון (#/account של D) — wrapper עצמאי על vAccountHub,
   בלי עריכת account-hub.js. לקוח רואה רק מסמכים שלו (נאכף בשרת: /api/documents/mine).
   המסמכים הם קבלות/חשבוניות דמו מסומנות ("מסמך דמו, לא לצורכי מע״מ") — צפייה והורדת PDF בלבד. */
(function(){
  const KIND_ICON = { receipt: '🧾', invoice: '📄', credit: '↩️', consolidated: '📑' };
  async function myDocsCard(){
    let docs = [];
    try{ const r = await api('/documents/mine'); docs = r.documents || []; }catch(e){}
    const rows = docs.map(d => {
      const num = d.doc_year && d.doc_number ? `${d.doc_year}-${d.doc_number}` : '—';
      const date = (d.issued_at || '').slice(0, 10);
      const icon = KIND_ICON[d.kind] || '📄';
      return `<tr><td>${icon} ${esc(d.kind_he || d.kind)}</td><td>${esc(num)}</td>
        <td>${esc(d.tenant_name || '')}</td><td>${esc(date)}</td><td>₪${Number(d.total || 0).toFixed(2)}</td>
        <td><button class="btn2" data-mydoc-act="view" data-id="${d.id}">צפייה</button>
            <button class="btn2" data-mydoc-act="dl" data-id="${d.id}" data-name="${esc(d.kind)}-${esc(num)}.pdf">הורדה</button></td></tr>`;
    }).join('');
    return `<div class="card"><b>המסמכים שלי</b>
      <div class="mut">קבלות וחשבוניות שהופקו עבורך. מסמכי דמו — לא לצורכי מע״מ.</div>
      ${rows ? `<table class="tbl" style="margin-top:6px"><tr><th>סוג</th><th>מספר</th><th>מכבסה</th><th>תאריך</th><th>סכום</th><th></th></tr>${rows}</table>`
        : '<div class="mut" style="margin-top:6px">אין מסמכים עדיין</div>'}
    </div>`;
  }
  function wrap(){
    if (typeof window.vAccountHub !== 'function' || window.vAccountHub.__myDocsWrapped) return;
    const orig = window.vAccountHub;
    const wrapped = async function(){
      const html = await orig();
      try{
        const card = await myDocsCard();
        return html.replace(/(<div class="card"><b>המידע שלי<\/b>)/, card + '$1');
      }catch(e){ return html; }
    };
    wrapped.__myDocsWrapped = true;
    window.vAccountHub = wrapped;
  }
  wrap(); // הטעינה אחרי account-hub.js; אם סדר השתנה — ניסיון חוזר בטעינת הדף
  document.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-mydoc-act]');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    try{
      const t = JSON.parse(localStorage.getItem('wlm_token'));
      const r = await fetch('/api/documents/' + id + '/pdf', { headers: { Authorization: 'Bearer ' + t } });
      if (!r.ok){ const d = await r.json().catch(() => ({})); toast(d.error || 'שגיאה בפתיחת המסמך'); return; }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      if (btn.getAttribute('data-mydoc-act') === 'view'){
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else {
        const a = document.createElement('a');
        a.href = url; a.download = btn.getAttribute('data-name') || 'document.pdf';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }
    }catch(e){ toast('שגיאה בפתיחת המסמך'); }
  });
})();
