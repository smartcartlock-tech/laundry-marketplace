/* CX-B: מסכי חשבון לקוח — עטיפות/מסכים עצמאיים, בלי עריכת קבצים משותפים:
   B1: הכתובות שלי (הוספה/עריכה/ברירת מחדל/הערות לשליח) · B2: העדפות כביסה שמצורפות להזמנה
   B3: מנוי משפחתי (דמו) · B4: חיפוש וסינון בהיסטוריית הזמנות */
(function(){
  /* ---------- B1: הכתובות שלי ---------- */
  window.vAddresses = async function(){
    const d = await api('/me/addresses');
    const rows = (d.addresses||[]).map(a=>`
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <b>${esc(a.label)}${a.is_default?' <span class="mut">★ ברירת מחדל</span>':''}</b>
        </div>
        <div>${esc(a.address)}</div>
        ${a.courier_note?`<div class="mut">הערה לשליח: ${esc(a.courier_note)}</div>`:''}
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn2" id="addr-edit-${a.id}">עריכה</button>
          ${a.is_default?'':`<button class="btn2" id="addr-def-${a.id}">הגדרה כברירת מחדל</button>`}
          <button class="btn2" id="addr-del-${a.id}">מחיקה</button>
        </div>
      </div>`).join('');
    return `<div class="hdr"><h2>הכתובות שלי</h2><div class="mut">כתובות שמורות לאיסוף ומסירה · ההערה לשליח מצורפת להזמנה</div></div>
    <div class="body">
      <div class="card" style="background:#eef7f8">
        <b id="addr-form-title">הוספת כתובת</b>
        <input type="hidden" id="addr-id">
        <input class="inp" id="addr-label" placeholder="תווית — בית, עבודה, אצל אמא" style="margin-top:8px">
        <input class="inp" id="addr-addr" placeholder="רחוב, מספר, עיר" style="margin-top:6px">
        <input class="inp" id="addr-note" placeholder="הערה לשליח (לא חובה) — קומה, קוד שער" style="margin-top:6px">
        <label style="display:block;margin-top:6px"><input type="checkbox" id="addr-default"> כתובת ברירת מחדל</label>
        <button class="btn" id="addr-save" style="margin-top:8px">שמירה</button>
      </div>
      ${rows || '<div class="card mut">אין עדיין כתובות שמורות</div>'}
    </div>`;
  };

  /* ---------- B2: העדפות כביסה ---------- */
  window.vPrefs = async function(){
    const d = await api('/me/laundry-prefs');
    const p = d.prefs || {};
    const scents = ['', 'רגיל', 'ללא ריח', 'לבנדר', 'אוקיינוס'];
    return `<div class="hdr"><h2>העדפות כביסה</h2><div class="mut">נשמרות אצלך ומצורפות אוטומטית להזמנה הבאה — גם להזמנה חוזרת</div></div>
    <div class="body">
      <div class="card">
        <label class="mut">ריח מועדף</label>
        <select class="inp" id="lp-scent">${scents.map(s=>`<option value="${esc(s)}"${p.scent===s?' selected':''}>${s||'ללא העדפה'}</option>`).join('')}</select>
        <label style="display:block;margin-top:10px"><input type="checkbox" id="lp-softener"${p.softener?' checked':''}> עם מרכך כביסה</label>
        <label class="mut" style="display:block;margin-top:10px">הוראות מיוחדות</label>
        <textarea class="inp" id="lp-special" rows="3" placeholder="למשל: כותנה בלבד, בלי אבקת כביסה נוזלית">${esc(p.special_instructions||'')}</textarea>
        <button class="btn" id="lp-save" style="margin-top:10px">שמירה</button>
      </div>
    </div>`;
  };

  /* ---------- B3: מנוי משפחתי (דמו) ---------- */
  window.vFamily = async function(){
    const d = await api('/me/family');
    const link = d.invite ? location.origin + '/#/join-family/' + d.invite.token : '';
    const members = (d.members||[]).map(m=>`<div class="card">👤 <b>${esc(m.phone)}</b><div class="mut">הצטרף ${fmtDT(m.since)}</div></div>`).join('');
    return `<div class="hdr"><h2>מנוי משפחתי</h2><div class="mut">סביבת דמו — הקישור להמחשה בלבד</div></div>
    <div class="body">
      <div class="card" style="background:#eef7f8">
        <b>שיתוף המנוי עם בן/בת משפחה או שותף</b>
        <div class="mut" style="margin:6px 0">יוצרים קישור הזמנה, מעתיקים ושולחים בעצמכם (המערכת לא שולחת הודעות). כל קישור תקף להצטרפות אחת.</div>
        <button class="btn" id="fam-create">יצירת קישור הזמנה</button>
        ${link?`<div style="margin-top:10px"><input class="inp" id="fam-link" readonly value="${esc(link)}" style="direction:ltr;text-align:left;font-size:12px">
        <button class="btn2" id="fam-copy" style="margin-top:6px">העתקת הקישור</button></div>`:''}
      </div>
      <h3>בני המשפחה שלי (${(d.members||[]).length})</h3>
      ${members || '<div class="card mut">עוד לא הצטרף אף אחד</div>'}
    </div>`;
  };

  window.vJoinFamily = function(token){
    if (!state.token){
      return `<div class="hdr"><h2>הצטרפות למנוי משפחתי</h2></div>
      <div class="body"><div class="card" style="text-align:center">
        <div style="font-size:40px">🧺</div>
        <b>הוזמנת להצטרף כבן/בת משפחה למנוי</b>
        <div class="mut" style="margin:8px 0">כדי לאשר את ההצטרפות צריך להתחבר או להירשם — ואז נחזיר אתכם לכאן</div>
        <button class="btn" id="fam-login" data-token="${esc(token||'')}">התחברות והצטרפות</button>
      </div></div>`;
    }
    return `<div class="hdr"><h2>הצטרפות למנוי משפחתי</h2></div>
    <div class="body"><div class="card" style="text-align:center">
      <div style="font-size:40px">🧺</div>
      <b>הוזמנת להצטרף כבן/בת משפחה למנוי</b>
      <div class="mut" style="margin:8px 0">סביבת דמו — ההצטרפות להמחשה בלבד</div>
      <button class="btn" id="fam-join" data-token="${esc(token||'')}">אישור הצטרפות</button>
    </div></div>`;
  };

  /* חזרה לקישור הצטרפות אחרי התחברות (הקובץ נטען לפני router.js — עטיפה עצלנית) */
  (function installRouteWrap(){
    if (typeof window.route !== 'function'){ setTimeout(installRouteWrap, 50); return; }
    if (window.route.__famWrapped) return;
    const origR = window.route;
    const wrapped = function(){
      const out = origR.apply(this, arguments);
      try{
        const pend = sessionStorage.getItem('wlm_family_join');
        if (pend && state.token){ sessionStorage.removeItem('wlm_family_join'); setTimeout(()=>go('#/join-family/'+pend), 50); }
      }catch(e){}
      return out;
    };
    wrapped.__famWrapped = true;
    window.route = wrapped;
  })();

  /* ---------- B4: חיפוש וסינון בהיסטוריית הזמנות ---------- */
  const STATUS_HE = {new:'התקבלה',confirmed:'אושרה',picked_up:'נאספה',in_progress:'בעבודה',ready:'מוכנה',out_for_delivery:'בדרך',delivered:'הוחזרה',cancelled:'בוטלה'};
  if (typeof window.vOrders === 'function'){
    const origO = window.vOrders;
    window.vOrders = async function(){
      const html = await origO();
      const bar = `<div class="card" id="ord-filter" style="background:#eef7f8">
        <input class="inp" id="of-text" placeholder="חיפוש — פריט, מכבסה, סכום">
        <div style="display:flex;gap:6px;margin-top:6px">
          <select class="inp" id="of-status" style="flex:1"><option value="">כל הסטטוסים</option>${Object.values(STATUS_HE).map(s=>`<option>${s}</option>`).join('')}</select>
          <input class="inp" type="date" id="of-from" title="מתאריך" style="flex:1">
          <input class="inp" type="date" id="of-to" title="עד תאריך" style="flex:1">
        </div>
        <div class="mut" id="of-count" style="margin-top:4px"></div>
      </div>`;
      const bodyIdx = html.indexOf('<div class="body">');
      if (bodyIdx < 0) return html;
      const at = bodyIdx + '<div class="body">'.length;
      setTimeout(setupOrdersFilter, 0);
      return html.slice(0, at) + bar + html.slice(at);
    };
  }
  async function setupOrdersFilter(){
    const bar = document.getElementById('ord-filter');
    if (!bar || bar.__wired) return;
    bar.__wired = true;
    let orders = [];
    try{ const d = await api('/orders/mine'); orders = d.orders || []; }catch(e){}
    const apply = () => {
      const t = (document.getElementById('of-text').value || '').trim();
      const st = document.getElementById('of-status').value;
      const from = document.getElementById('of-from').value;
      const to = document.getElementById('of-to').value;
      const cards = Array.from(document.querySelectorAll('.lcard'));
      const act = orders.filter(o=>o.status!=='cancelled');
      const cnc = orders.filter(o=>o.status==='cancelled');
      const seq = act.concat(cnc);
      let shown = 0;
      cards.forEach((c, i) => {
        const o = seq[i];
        let ok = true;
        if (t && !c.textContent.includes(t)) ok = false;
        if (ok && st && !(o && STATUS_HE[o.status] === st)) ok = false;
        if (ok && from && !(o && o.created_at >= from)) ok = false;
        if (ok && to && !(o && o.created_at <= to + 'T23:59:59')) ok = false;
        c.style.display = ok ? '' : 'none';
        if (ok) shown++;
      });
      document.getElementById('of-count').textContent = shown === cards.length ? '' : `מציג ${shown} מתוך ${cards.length} הזמנות`;
    };
    ['of-text','of-status','of-from','of-to'].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener('input', apply);
      el.addEventListener('change', apply);
    });
  }

  /* ---------- קישורי חשבון במועדון ---------- */
  if (typeof window.vClub === 'function'){
    const origC2 = window.vClub;
    window.vClub = async function(){
      const html = await origC2();
      const card = `<div class="card"><b>החשבון שלי</b>
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
          <a class="btn2" href="#/addresses">📍 הכתובות שלי</a>
          <a class="btn2" href="#/prefs">🧺 העדפות כביסה</a>
          <a class="btn2" href="#/family">👨‍👩‍👧 מנוי משפחתי</a>
        </div></div>`;
      const anchor = html.indexOf('תנועות אחרונות');
      if (anchor < 0) return html + card;
      return html.slice(0, anchor) + card + html.slice(anchor);
    };
  }

  /* ---------- B2: צירוף אוטומטי בצ׳ק-אאוט (העדפות + הערת שליח מכתובת שמורה) ---------- */
  if (typeof window.vCheckout === 'function'){
    const origCh = window.vCheckout;
    window.vCheckout = async function(slug){
      const html = await origCh(slug);
      setTimeout(()=>{ attachCheckoutPrefs().catch(()=>{}); }, 0);
      return html;
    };
  }
  function prefsLine(p){
    if (!p || (!p.scent && !p.softener && !p.special_instructions)) return '';
    const parts = [];
    if (p.scent) parts.push('ריח: ' + p.scent);
    parts.push('מרכך: ' + (p.softener ? 'כן' : 'לא'));
    if (p.special_instructions) parts.push('הוראות: ' + p.special_instructions);
    return 'העדפות כביסה — ' + parts.join(' · ');
  }
  async function attachCheckoutPrefs(){
    const notes = document.getElementById('co-notes');
    if (!notes || notes.__lpWired) return;
    notes.__lpWired = true;
    let touched = false;
    notes.addEventListener('input', ()=>{ touched = true; });
    try{
      const d = await api('/me/laundry-prefs');
      const line = prefsLine(d.prefs);
      if (line && !notes.value.trim() && !touched) notes.value = line;
    }catch(e){}
    const sel = document.getElementById('co-saved-addr');
    if (sel){
      let addrs = [];
      try{ const d = await api('/me/addresses'); addrs = d.addresses || []; }catch(e){}
      sel.addEventListener('change', ()=>{
        const a = addrs.find(x => x.id === sel.value);
        if (a && a.courier_note && !notes.value.includes(a.courier_note)){
          notes.value = (notes.value ? notes.value + ' · ' : '') + 'הערה לשליח: ' + a.courier_note;
        }
      });
    }
  }

  /* ---------- מטפל לחיצות מרכזי ---------- */
  document.addEventListener('click', async e => {
    const t = e.target.closest('button'); if (!t) return;
    const id = t.id || '';
    try{
      if (id === 'addr-save'){
        const aid = document.getElementById('addr-id').value;
        const body = {
          label: document.getElementById('addr-label').value,
          address: document.getElementById('addr-addr').value,
          courier_note: document.getElementById('addr-note').value,
          is_default: document.getElementById('addr-default').checked,
        };
        if (aid) await api('/me/addresses/'+aid, {method:'PUT', body:JSON.stringify(body)});
        else await api('/me/addresses', {method:'POST', body:JSON.stringify(body)});
        toast('הכתובת נשמרה'); go('#/addresses');
      }
      else if (id.startsWith('addr-edit-')){
        const aid = id.slice('addr-edit-'.length);
        const d = await api('/me/addresses');
        const a = (d.addresses||[]).find(x=>x.id===aid); if (!a) return;
        document.getElementById('addr-id').value = a.id;
        document.getElementById('addr-label').value = a.label;
        document.getElementById('addr-addr').value = a.address;
        document.getElementById('addr-note').value = a.courier_note || '';
        document.getElementById('addr-default').checked = !!a.is_default;
        document.getElementById('addr-form-title').textContent = 'עריכת כתובת';
        window.scrollTo(0,0);
      }
      else if (id.startsWith('addr-def-')){
        await api('/me/addresses/'+id.slice('addr-def-'.length)+'/default', {method:'POST'});
        toast('עודכנה כתובת ברירת מחדל'); go('#/addresses');
      }
      else if (id.startsWith('addr-del-')){
        await api('/me/addresses/'+id.slice('addr-del-'.length), {method:'DELETE'});
        toast('הכתובת נמחקה'); go('#/addresses');
      }
      else if (id === 'lp-save'){
        await api('/me/laundry-prefs', {method:'PUT', body:JSON.stringify({
          scent: document.getElementById('lp-scent').value,
          softener: document.getElementById('lp-softener').checked,
          special_instructions: document.getElementById('lp-special').value,
        })});
        toast('העדפות הכביסה נשמרו — יצורפו להזמנה הבאה');
      }
      else if (id === 'fam-create'){
        await api('/me/family/invite', {method:'POST'});
        go('#/family');
      }
      else if (id === 'fam-copy'){
        const inp = document.getElementById('fam-link');
        inp.select();
        try{ await navigator.clipboard.writeText(inp.value); toast('הקישור הועתק'); }
        catch(e){ document.execCommand('copy'); toast('הקישור הועתק'); }
      }
      else if (id === 'fam-login'){
        try{ sessionStorage.setItem('wlm_family_join', t.dataset.token || ''); }catch(e){}
        go('#/login');
      }
      else if (id === 'fam-join'){
        const d = await api('/family/join', {method:'POST', body:JSON.stringify({token: t.dataset.token})});
        if (d && d.ok){ toast('הצטרפת למנוי המשפחתי! (דמו)'); go('#/club'); }
      }
    }catch(err){ toast(err.message || 'משהו השתבש'); }
  });
})();
