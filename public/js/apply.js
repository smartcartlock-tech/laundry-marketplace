/* B2: טופס בקשת הצטרפות ציבורי + תור אישור לאדמין.
   עצמאי: עוטף את vJoin (טופס פומבי למבקרים לא-מחוברים) ואת vAdmin (תת-לשונית applications) בלי לערוך קבצים של אחרים. */
(function(){
  // --- צד ציבורי: מבקר לא-מחובר רואה טופס בקשה במקום דרישת התחברות ---
  if (typeof window.vJoin === 'function'){
    const origJoin = window.vJoin;
    window.vJoin = async function(){
      if (state.token) return origJoin();
      return `<div class="hdr"><h2>הצטרפות מכבסה לפלטפורמה</h2><p>משאירים פרטים ואנחנו מכינים לך חשבון — או מתחברים ומקימים לבד</p></div>
      <div class="body">
       <div class="card">
        <label class="lb">שם המכבסה</label><input class="inp" id="ap-name">
        <label class="lb">עיר</label><input class="inp" id="ap-city">
        <label class="lb">טלפון</label><input class="inp" id="ap-phone" dir="ltr" inputmode="tel" placeholder="050-1234567">
        <label class="lb">הזמנות משוערות בחודש (רשות)</label><input class="inp" id="ap-est" dir="ltr" inputmode="numeric" type="number" min="0">
        <div style="position:absolute;left:-9999px;top:-9999px" aria-hidden="true"><label>אתר<input id="ap-website" tabindex="-1" autocomplete="off"></label></div>
        <button class="btn" data-act="submitApplication">שליחת בקשת הצטרפות</button>
        <div class="note" style="margin-top:8px">הבקשה נשמרת בתור הטיפול של צוות הפלטפורמה.</div>
       </div>
       <div class="card" style="text-align:center"><span class="mut">כבר יש לך חשבון?</span> <a href="#/login" style="color:#0e7a8a">להתחברות והקמה עצמית עם AI</a></div>
      </div>`;
    };
  }
  window.submitApplication = async function(){
    try{
      const body = { name: $('#ap-name').value, city: $('#ap-city').value, phone: $('#ap-phone').value,
        est_orders: $('#ap-est').value || undefined, website: $('#ap-website').value };
      const r = await fetch('/api/apply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'שגיאה ' + r.status);
      $('#app').innerHTML = `<div class="hdr"><h2>הבקשה התקבלה</h2></div>
       <div class="body"><div class="card" style="text-align:center"><div style="font-size:36px">🧺</div>
       <b>תודה, ${esc(body.name)}!</b><div class="mut" style="margin:6px 0">הבקשה נקלטה בתור ההצטרפות של צוות הפלטפורמה.</div>
       <button class="btn" data-act="goHome">חזרה לדף הבית</button></div></div>`;
    }catch(e){ toast(e.message); }
  };

  // --- צד אדמין: תת-לשונית "בקשות הצטרפות" ---
  if (typeof window.vAdmin === 'function'){
    const origAdmin = window.vAdmin;
    window.vAdmin = async function(sub){
      if (sub === 'applications'){
        const frame = await origAdmin('overview');
        const m = frame.match(/<div class="subtabs">[\s\S]*?<\/div>/);
        const tabs = (m ? m[0].replace('chip on', 'chip') : '')
          .replace(/<\/div>$/, '<a class="chip on" href="#/admin/applications">בקשות הצטרפות</a></div>');
        const d = await api('/admin/applications');
        const ST = { pending: 'ממתין', converted: 'הומר', rejected: 'נדחה' };
        const body = d.applications.map(a => `<div class="card">
          <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px">
           <div><b>${esc(a.laundry_name)}</b> · ${esc(a.city)} · <span dir="ltr">${esc(a.phone)}</span>${a.est_orders ? ` · ~${a.est_orders} הזמנות/חודש` : ''}
            <div class="mut">${fmtDT(a.created_at)} · ${ST[a.status] || a.status}${a.tenant_slug ? ` · <a href="#/admin/tenant/${a.tenant_id}">מכבסה: ${esc(a.tenant_slug)}</a>` : ''}</div></div>
           ${a.status === 'pending' ? `<div style="display:flex;gap:6px;align-items:start">
            <button class="btn2 on" data-act="applicationConvert" data-a="${a.id}">המרה למכבסה</button>
            <button class="btn2" data-act="applicationReject" data-a="${a.id}">דחייה</button></div>` : ''}
          </div></div>`).join('') || '<div class="card mut">אין בקשות הצטרפות</div>';
        return frame.replace(/<div class="body">[\s\S]*$/, `<div class="body">${tabs}${body}</div>`);
      }
      const html = await origAdmin(sub);
      return html.replace('<div class="subtabs">', '<div class="subtabs"><a class="chip" href="#/admin/applications">בקשות הצטרפות</a>');
    };
  }
  window.applicationConvert = async function(id, btn){
    btn.disabled = true;
    try{ await api(`/admin/applications/${id}/convert`, { method: 'POST', body: '{}' }); toast('הבקשה הומרה למכבסה (ממתינה לאישור)'); route(); }
    catch(e){ btn.disabled = false; toast(e.message); }
  };
  window.applicationReject = async function(id){
    try{ await api(`/admin/applications/${id}/reject`, { method: 'POST', body: '{}' }); toast('הבקשה נדחתה'); route(); }
    catch(e){ toast(e.message); }
  };
})();
/* B7: רישום פעולות להאזנה המרכזת (ללא inline handlers) */
onAct({
 applicationConvert:t=>applicationConvert(t.dataset.a,t), applicationReject:t=>applicationReject(t.dataset.a),
 goHome:()=>go('#/'), submitApplication:()=>submitApplication()
});
