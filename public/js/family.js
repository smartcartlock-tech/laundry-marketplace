/* T17: מנוי משפחתי מלא — מסך ניהול לבעלים (הסרת חבר, ביטול הזמנה משפחתית),
   מסך "אני חבר אצל X" + עזיבה לחבר. wrapper עצמאי על vFamily של CX-B3 (נטען אחריו). */
(function(){
  if (typeof window.vFamily !== 'function') return;
  window.vFamily = async function(){
    const d = await api('/me/family');
    const link = d.invite ? location.origin + '/#/join-family/' + d.invite.token : '';
    const members = (d.members||[]).map(m=>`<div class="card" style="display:flex;justify-content:space-between;align-items:center">
      <div>👤 <b>${esc(m.name||m.phone)}</b><div class="mut">${esc(m.phone)} · הצטרף ${fmtDT(m.since)}</div></div>
      <button class="btn2" data-act="famRemove" data-a="${esc(m.id)}" style="border-color:#7a2e2e;color:#d66">הסרה</button>
    </div>`).join('');
    const ST={new:'התקבלה',confirmed:'אושרה',picked_up:'נאספה',in_work:'בעבודה',ready:'מוכנה',out_for_delivery:'בדרך',delivered:'הוחזרה',cancelled:'בוטלה'};
    const orders=(d.family_orders||[]).map(o=>{
      const canCancel=['new','confirmed'].includes(o.status);
      return `<div class="card" style="display:flex;justify-content:space-between;align-items:center">
        <div>▤ <b>${esc(o.tenant_name)}</b> · ₪${o.total}<div class="mut">${esc(o.member_name)} · ${ST[o.status]||o.status} · ${fmtDT(o.created_at)}</div></div>
        ${canCancel?`<button class="btn2" data-act="famCancelOrder" data-a="${esc(o.id)}" style="border-color:#7a2e2e;color:#d66">ביטול</button>`:''}
      </div>`;}).join('');
    const membershipCard = d.membership ? `<div class="card" style="background:#eef7f8">
        <b>אני חבר במנוי של ${esc(d.membership.owner_name)}</b>
        <div class="mut" style="margin:6px 0">הצטרפת ${fmtDT(d.membership.since)} · ההזמנות שלך מנוהלות במשותף עם בעל המנוי (הוא רואה ויכול לבטל אותן לפני איסוף).</div>
        <button class="btn2" data-act="famLeave" style="border-color:#7a2e2e;color:#d66">עזיבת המנוי</button>
      </div>` : '';
    return `<div class="hdr"><h2>מנוי משפחתי</h2><div class="mut">סביבת דמו — הקישור להמחשה בלבד</div></div>
    <div class="body">
      ${membershipCard}
      <div class="card" style="background:#eef7f8">
        <b>שיתוף המנוי עם בן/בת משפחה או שותף</b>
        <div class="mut" style="margin:6px 0">יוצרים קישור הזמנה, מעתיקים ושולחים בעצמכם (המערכת לא שולחת הודעות). כל קישור תקף להצטרפות אחת.</div>
        <button class="btn" id="fam-create">יצירת קישור הזמנה</button>
        ${link?`<div style="margin-top:10px"><input class="inp" id="fam-link" readonly value="${esc(link)}" style="direction:ltr;text-align:left;font-size:12px">
        <button class="btn2" id="fam-copy" style="margin-top:6px">העתקת הקישור</button></div>`:''}
      </div>
      <h3>בני המשפחה שלי (${(d.members||[]).length})</h3>
      ${members || '<div class="card mut">עוד לא הצטרף אף אחד</div>'}
      <h3>הזמנות משפחתיות (${(d.family_orders||[]).length})</h3>
      <div class="mut" style="margin-bottom:6px">הזמנות של בני המשפחה — ניתן לבטל לפני איסוף.</div>
      ${orders || '<div class="card mut">אין הזמנות עדיין</div>'}
    </div>`;
  };

  onAct({
    famRemove: async (a)=>{
      if(!a.a)return;
      if(!await xconfirm('להסיר את החבר מהמנוי המשפחתי? ההיסטוריה שלו נשמרת, והוא יפסיק להיות משויך.',{title:'הסרת חבר',okText:'כן, להסיר'}))return;
      try{await api('/me/family/members/'+a.a,{method:'DELETE'});toast('החבר הוסר');route()}
      catch(e){toast(e.message)}
    },
    famLeave: async ()=>{
      if(!await xconfirm('לעזוב את המנוי המשפחתי? בעל המנוי לא יוכל יותר לראות או לבטל את ההזמנות שלך.',{title:'עזיבת מנוי',okText:'כן, לעזוב'}))return;
      try{await api('/me/family/leave',{method:'POST'});toast('עזבת את המנוי');route()}
      catch(e){toast(e.message)}
    },
    famCancelOrder: async (a)=>{
      if(!a.a)return;
      if(!await xconfirm('לבטל את ההזמנה המשפחתית? החבר יראה שההזמנה בוטלה.',{title:'ביטול הזמנה משפחתית',okText:'כן, לבטל'}))return;
      try{await api('/me/family/orders/'+a.a+'/cancel',{method:'POST'});toast('ההזמנה בוטלה');route()}
      catch(e){toast(e.message)}
    },
  });
})();
