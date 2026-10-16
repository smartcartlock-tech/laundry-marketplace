/* חוויית לקוח — עטיפות עצמאיות, בלי עריכת קבצים משותפים:
   CX1: זמן משוער (ETA) במסך מעקב ההזמנה · CX3: הסבר מימוש נקודות · CX5: העדפות התראות */
(function(){
  /* CX1: ETA במסך ההזמנה — עוטף vOrder, מזריק כרטיס אחרי כרטיס ציר הזמן */
  if (typeof window.vOrder === 'function'){
    const orig = window.vOrder;
    window.vOrder = async function(id){
      const html = await orig(id);
      try{
        const d = await api('/orders/'+id);
        const o = d.order;
        if (['delivered','cancelled'].includes(o.status)) return html;
        let eta = '';
        if (['new','confirmed'].includes(o.status))
          eta = o.pickup_at ? 'איסוף משוער: <b>'+fmtDT(o.pickup_at)+'</b>' : 'איסוף משוער: המכבסה תתאם מולך';
        else if (o.status==='picked_up')
          eta = o.delivery_at ? 'מסירה משוערת: <b>'+fmtDT(o.delivery_at)+'</b>' : 'הכביסה בדרך אליך — המסירה תתואם';
        else if (o.delivery_at) eta = 'מסירה משוערת: <b>'+fmtDT(o.delivery_at)+'</b>';
        if (!eta) return html;
        const card = '<div class="card" style="text-align:center;background:#eef7f8"><b>זמן משוער</b><div style="margin-top:2px">'+eta+'</div><div class="mut">הזמן משוער בלבד ומתעדכן לפי חלונות המכבסה</div></div>';
        /* הכנסה אחרי סוף כרטיס ציר הזמן (המכיל "רענון עכשיו") */
        const anchor = html.indexOf('רענון עכשיו</a></div>');
        if (anchor < 0) return html;
        const closeIdx = html.indexOf('</div>', anchor + 'רענון עכשיו</a></div>'.length);
        if (closeIdx < 0) return html;
        const at = closeIdx + '</div>'.length;
        return html.slice(0, at) + card + html.slice(at);
      }catch(e){ return html; }
    };
  }
  /* CX3+CX5: כרטיסי מימוש נקודות והעדפות התראות במסך המועדון — עוטף vClub */
  if (typeof window.vClub === 'function'){
    const origC = window.vClub;
    window.vClub = async function(){
      const html = await origC();
      try{
        const redeem = '<div class="card" style="background:#eef7f8"><b>מה אפשר לעשות עם הנקודות?</b>'
          + '<div class="mut" style="margin-top:4px">כל נקודה = ₪1 הנחה (עד 20% מסכום ההזמנה). בצ׳ק-אאוט מסמנים ״מימוש נקודות״ וההנחה יורדת מהסכום לתשלום.</div>'
          + '<div class="mut">איך צוברים? נקודות על כל הזמנה לפי קצב הצבירה של המכבסה · 20 נקודות על ביקורת (פעם אחת להזמנה)</div></div>';
        let prefs = {status_updates:true, marketing:true};
        try{ prefs = await api('/me/notification-prefs'); }catch(e){}
        const card = '<div class="card"><b>העדפות התראות</b><div class="mut" style="margin:4px 0">מה לשלוח לך — אפשר לכבות בלי לוותר על הכל</div>'
          + '<label style="display:flex;gap:8px;align-items:center;padding:6px 0"><input type="checkbox" id="np-status"'+(prefs.status_updates?' checked':'')+'> עדכוני סטטוס הזמנה (push / וואטסאפ)</label>'
          + '<label style="display:flex;gap:8px;align-items:center;padding:6px 0"><input type="checkbox" id="np-mkt"'+(prefs.marketing?' checked':'')+'> הטבות, מבצעים ועדכוני מועדון</label>'
          + '<button class="btn2" id="np-save">שמירה</button></div>';
        return html
          .replace('<div class="sec">נקודות</div>', redeem + '<div class="sec">נקודות</div>')
          .replace('<div class="sec">תנועות אחרונות</div>', card + '<div class="sec">תנועות אחרונות</div>');
      }catch(e){ return html; }
    };
    /* שמירת העדפות — delegation גלובלי, בלי לגעת ב-handlers הקיימים */
    document.addEventListener('click', async (ev)=>{
      if (!ev.target || ev.target.id !== 'np-save') return;
      try{
        await api('/me/notification-prefs', {method:'PUT', body:JSON.stringify({
          status_updates: !!document.getElementById('np-status').checked,
          marketing: !!document.getElementById('np-mkt').checked })});
        toast('ההעדפות נשמרו');
      }catch(e){ toast(e.message||'שמירה נכשלה'); }
    });
  }
})();
