/* G17.T5/T6/T7: מחיקת חשבון מחוזקת — OTP ייעודי, חסימת הזמנות פעילות,
   מסך "מה נשמר" לפני אישור, וקישורי מדיניות/תנאים במסך החשבון.
   עטיפה עצמאית על vAccountHub ורישום-מחדש של acctDelete — בלי עריכת קבצים משותפים.
   נטען דינמית מ-consent.js (מחוץ ל-precache: הזרימה דורשת רשת בכל מקרה). */
(function(){
  /* ---- T5: קישורי מדיניות פרטיות ותנאי שימוש במסך החשבון ---- */
  function wrapAccountHub(){
    if (typeof window.vAccountHub !== 'function' || window.vAccountHub.__privacyWrapped) return;
    const orig = window.vAccountHub;
    const wrapped = async function(){
      const html = await orig();
      const card = `<div class="card"><b>פרטיות ותנאים</b><div class="mut">מסמכי דמו — טיוטות לאישור הבעלים</div>
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
          <a class="btn2" href="/privacy" target="_blank" rel="noopener">🔒 מדיניות פרטיות</a>
          <a class="btn2" href="/terms" target="_blank" rel="noopener">📄 תנאי שימוש</a>
        </div></div>`;
      const anchor = html.indexOf('מחיקת החשבון');
      if (anchor < 0) return html + card;
      const cardStart = html.lastIndexOf('<div class="card"', anchor);
      if (cardStart < 0) return html + card;
      return html.slice(0, cardStart) + card + html.slice(cardStart);
    };
    wrapped.__privacyWrapped = true;
    window.vAccountHub = wrapped;
  }
  wrapAccountHub();

  /* ---- T6/T7: זרימת מחיקה מחוזקת ---- */
  const li = (arr) => arr.map(x => `<li style="margin:4px 0">${x}</li>`).join('');
  async function deleteAccountFlow(){
    let prev;
    try { prev = await api('/me/deletion-preview'); }
    catch(e){ toast(e.message || 'טעינת פרטי המחיקה נכשלה'); return; }

    if (!prev.can_delete){
      const body = `<div style="text-align:right">לא ניתן למחוק את החשבון כרגע:</div>
        <ul style="text-align:right;margin:8px 0">${li(prev.blockers.map(b => esc(b.message)))}</ul>
        <div class="mut">אחרי שטיפלת בנושאים אלה אפשר לחזור ולמחוק.</div>`;
      await xmodal({ title: 'מחיקת החשבון חסומה', body, okText: 'הבנתי', cancelText: 'סגור' });
      return;
    }

    /* מסך "מה נשמר" לפני אישור (T7) */
    const keepBody = `<div style="text-align:right">
      ${prev.warnings.length ? `<b style="color:#b26a00">שימו לב:</b><ul style="margin:6px 0">${li(prev.warnings.map(w => esc(w.message)))}</ul>` : ''}
      <b>יימחק לצמיתות:</b><ul style="margin:6px 0">${li(prev.will_delete.map(esc))}</ul>
      <b>יישמר (מנותק מזהות, לפי חובת שמירת הרשומות):</b><ul style="margin:6px 0">${li(prev.kept.map(esc))}</ul>
      <div class="mut">הפעולה בלתי הפיכה — לא ניתן יהיה להתחבר שוב לחשבון זה.</div></div>`;
    const ok = await xmodal({ title: 'מחיקת החשבון — מה נמחק ומה נשמר', body: keepBody, okText: 'המשך לאימות', cancelText: 'חזרה' });
    if (!ok) return;

    /* OTP ייעודי (T6) */
    let otpRes;
    try { otpRes = await api('/me/delete/request-otp', { method: 'POST' }); }
    catch(e){ toast(e.message || 'שליחת הקוד נכשלה'); return; }
    const demoLine = otpRes.demoCode ? `<div style="background:#fff8e1;border-radius:6px;padding:6px 10px;margin:6px 0">סביבת דמו — הקוד: <b dir="ltr">${esc(otpRes.demoCode)}</b></div>` : '';
    const v = await xmodal({
      title: 'אימות מחיקת חשבון',
      body: `<div style="text-align:right">נשלח קוד אימות ${otpRes.channel === 'whatsapp' ? 'בוואטסאפ' : ''} למספר הרשום בחשבון. הזינו אותו כדי לאשר את המחיקה לצמיתות.</div>${demoLine}`,
      okText: 'מחקו את החשבון לצמיתות',
      cancelText: 'חזרה',
      fields: [{ id: 'code', label: 'קוד אימות (6 ספרות)' }],
    });
    if (!v) return;
    try {
      const t = JSON.parse(localStorage.getItem('wlm_token'));
      const r = await fetch('/api/me', { method: 'DELETE', headers: { Authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: JSON.stringify({ code: String(v.code || '').trim() }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok){
        if (r.status === 409 && d.blockers){
          await xmodal({ title: 'המחיקה נחסמה', body: `<ul style="text-align:right">${li(d.blockers.map(b => esc(b.message)))}</ul>`, okText: 'הבנתי', cancelText: 'סגור' });
          return;
        }
        throw new Error(d.error || 'המחיקה נכשלה');
      }
      localStorage.clear();
      toast('החשבון נמחק. תודה שהייתם איתנו.');
      location.hash = '#/';
      location.reload();
    } catch(e){ toast(e.message); }
  }
  if (typeof onAct === 'function') onAct({ acctDelete: deleteAccountFlow });
})();
