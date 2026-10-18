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
            return `<div style="padding:6px 0;border-top:1px solid #edf1f4">${cls} ${HE[s] || s}${ev ? ` <span class="mut">${fmtDT(ev.at)}</span>` : ''}</div>`;
          }).join('');
      const eta = d.delivery_at ? `<div class="mut" style="margin-top:6px">מועד החזרה משוער: ${fmtDT(d.delivery_at)}</div>` : '';
      // T93: קוד מסירה חד-פעמי — מוצג ללקוח במעקב, מומסר לשליח בקבלת ההזמנה
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
  if (typeof onAct === 'function') onAct({ trackGo: () => trackGo(), trackCopy: t => trackCopy(t.dataset.a) });
})();
