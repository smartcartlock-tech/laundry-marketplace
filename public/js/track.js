// T117: גיבוי לסביבות בדיקה שבהן checkout.js לא נטען לפני הקובץ
var fmtShekel=typeof fmtShekel==='function'?fmtShekel:function(n){return '\u20aa'+Number(n||0).toLocaleString('he-IL',{maximumFractionDigits:2})};
var fmtDMYT=typeof fmtDMYT==='function'?fmtDMYT:function(s){if(!s)return '\u2014';var d=new Date(s);return d.toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'Asia/Jerusalem'})+' '+d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Jerusalem'})};
/* G3b: מעקב הזמנה ללקוח בלי התחברות לפי קוד (#/track/:code) + שורת קוד מעקב בצפיית הזמנה (עוטף vOrder). */
(function(){
  window.vTrack = async function(code){
    const input = `<div class="hdr"><h2>מעקב הזמנה</h2><p>מזינים את קוד המעקב שקיבלתם מהמכבסה — בלי התחברות</p></div>
    <div class="body"><div class="card">
     <label class="lb">קוד מעקב (8 תווים)</label>
     <input class="inp" id="tr-code" dir="ltr" style="text-transform:uppercase;letter-spacing:2px" maxlength="8" placeholder="למשל A1B2C3D4" value="${esc(code||'')}">
     <button class="btn" data-act="trackGo">חיפוש</button>
     <div class="mut" style="margin-top:6px">הקוד מופיע בפרטי ההזמנה אצלכם באפליקציה.</div>
    </div><div id="tr-result"></div></div>`;
    if (!code) return input;
    try{
      const d = await api('/track/' + encodeURIComponent(code));
      const FLOW2 = ['new','confirmed','picked_up','in_work','ready','out_for_delivery','delivered'];
      const cur = FLOW2.indexOf(d.status);
      const steps = d.status === 'cancelled'
        ? `<div class="card warn">ההזמנה בוטלה</div>`
        : FLOW2.map((s, i) => {
            const ev = d.events.find(e => e.status === s);
            const cls = i <= cur ? '✅' : '◻️';
            return `<div style="padding:6px 0;border-top:1px solid #edf1f4">${cls} ${HE[s] || s}${ev ? ` <span class="mut">${fmtDMYT(ev.at)}</span>` : ''}</div>`;
          }).join('');
      const eta = d.return_eta_label ? `<div class="mut" style="margin-top:6px">צפי החזרה: <b>${esc(d.return_eta_label)}</b></div>` : (d.delivery_at ? `<div class="mut" style="margin-top:6px">מועד החזרה משוער: ${fmtDMYT(d.delivery_at)}</div>` : '');
      const dcode = d.delivery_code && !['delivered','cancelled'].includes(d.status)
        ? `<div class="card" style="border:2px solid #0e7a8a;text-align:center"><div class="mut">קוד המסירה שלך — מסרו אותו לשליח בקבלת ההזמנה</div><div dir="ltr" style="font-size:26px;font-weight:800;letter-spacing:6px;margin-top:4px">${esc(d.delivery_code)}</div></div>` : '';
      return input.replace('<div id="tr-result"></div>', `<div class="card" id="tr-result">
        <div class="sec">${esc(d.laundry_name)}</div>
        <div>סטטוס נוכחי: <b>${HE[d.status] || esc(d.status)}</b></div>${dcode}${eta}
        <div style="margin-top:8px">${steps}</div></div>`);
    }catch(e){
      return input.replace('<div id="tr-result"></div>', `<div class="card warn" id="tr-result">${esc(e.message)}</div>`);
    }
  };
  window.trackGo = function(){
    const c = ($('#tr-code') || {}).value || '';
    if (c.trim()) go('#/track/' + encodeURIComponent(c.trim().toUpperCase()));
  };

  // שורת קוד מעקב בצפיית הזמנה של הלקוח (עטיפה — בלי עריכת orders.js)
  if (typeof window.vOrder === 'function'){
    const orig = window.vOrder;
    window.vOrder = async function(id){
      const html = await orig(id);
      try{
        if (!state.token) return html;
        const d = await api('/orders/' + id);
        const code = d.order && d.order.tracking_code;
        if (!code) return html;
        // T121: כרטיס אישור עדכון מחיר אחרי שקילה — הגבייה מתעדכנת רק באישור
        const pu = d.order && d.order.price_update;
        if (pu && pu.status === 'pending'){
          const pcard = `<div class="card warn"><div class="sec">עדכון מחיר אחרי שקילה</div>
           <div>המכבסה עדכנה את הסכום: <b>₪${esc(String(pu.from_total))} → ₪${esc(String(pu.to_total))}</b></div>
           ${(pu.items||[]).map(it=>`<div class="mut">${esc(it.name)} ×${esc(String(it.qty))} · ₪${esc(String(it.price))}</div>`).join('')}
           ${pu.note?`<div class="mut">הערה: ${esc(pu.note)}</div>`:''}
           <div style="display:flex;gap:8px;margin-top:8px">
            <button class="btn" data-act="puRespond" data-a="${id}" data-b="1" style="flex:1">מאשר את המחיר</button>
            <button class="btn2" data-act="puRespond" data-a="${id}" data-b="0" style="flex:1">דחייה</button></div>
           <div class="mut" style="margin-top:4px">הגבייה תתבצע רק על הסכום שאושר.</div></div>`;
          const a2 = '<div class="body">';
          return html.includes(a2) ? html.replace(a2, a2 + pcard) : pcard + html;
        }
        const dcode2 = d.order.delivery_code && !['delivered','cancelled'].includes(d.order.status)
          ? `<div style="margin-top:6px">קוד מסירה לשליח: <b dir="ltr" style="letter-spacing:3px">${esc(d.order.delivery_code)}</b></div>` : '';
        const link = location.origin + '/#/track/' + code;
        const card = `<div class="card"><div class="sec">מעקב בלי התחברות</div>
          <div>קוד מעקב: <b dir="ltr" style="letter-spacing:2px">${esc(code)}</b>
          <button class="btn2" data-act="trackCopy" data-a="${esc(link)}" style="margin-inline-start:8px">העתקת קישור</button></div>
          ${dcode2}<div class="mut" style="margin-top:4px">שתפו את הקוד או הקישור — מאפשר צפייה בסטטוס בלי התחברות.</div></div>`;
        const anchor = '<div class="body">';
        return html.includes(anchor) ? html.replace(anchor, anchor + card) : card + html;
      }catch(e){ return html; }
    };
  }
  window.trackCopy = async function(link){
    try{ await navigator.clipboard.writeText(link); toast('הקישור למעקב הועתק'); }
    catch(e){ toast(link); }
  };
  window.puRespond = async function(id, approve, btn){
    btn.disabled = true;
    try{
      await api('/orders/' + id + '/price-update/respond', { method:'POST', body: JSON.stringify({ approve: approve === '1' }) });
      toast(approve === '1' ? 'המחיר אושר — תודה!' : 'עדכון המחיר נדחה'); route();
    }catch(e){ btn.disabled = false; toast(e.message); }
  };
  if (typeof onAct === 'function') onAct({ trackGo: () => trackGo(), trackCopy: t => trackCopy(t.dataset.a), puRespond: t => puRespond(t.dataset.a, t.dataset.b, t) });
})();
