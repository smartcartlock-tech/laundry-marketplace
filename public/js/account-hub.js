/* CX-D2: מסך "החשבון שלי" — רכזת אחת: פרופיל ועריכת שם, נקודות, קיצורים להזמנות/כתובות/העדפות/מועדון/משפחה,
   ייצוא המידע האישי (תיקון 13) ומחיקת חשבון באנונימיזציה. עצמאי, בלי עריכת קבצים משותפים.
   בונוס: מסך שגיאה ידידותי להזמנה שלא נמצאה (wrapper על vOrder). */
(function(){
  async function exportMyData(){
    try{
      const t=JSON.parse(localStorage.getItem('wlm_token'));
      const r=await fetch('/api/me/export',{headers:{Authorization:'Bearer '+t}});
      if(!r.ok)throw new Error('ייצוא נכשל');
      const blob=await r.blob();
      const a=document.createElement('a');
      a.href=URL.createObjectURL(blob);a.download='my-data.json';
      document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(a.href),4000);
      toast('המידע ירד כקובץ JSON');
    }catch(e){toast(e.message)}
  }
  async function editName(){
    const cur=(state.me&&state.me.name)||'';
    const v=await xmodal({title:'עריכת שם מלא',okText:'שמירה',fields:[{id:'name',label:'שם מלא',value:cur}]});
    if(!v)return;
    try{
      const r=await api('/me',{method:'PATCH',body:JSON.stringify({name:v.name})});
      state.me=Object.assign(state.me||{},r.user);save();toast('השם עודכן');route();
    }catch(e){toast(e.message)}
  }
  async function deleteAccount(){
    if(!await xconfirm('החשבון יימחק לצמיתות: הפרטים האישיים יושמטו ולא ניתן יהיה להתחבר שוב. הזמנות וחשבוניות נשמרות באופן אנונימי.',{title:'מחיקת החשבון',okText:'כן, למחוק את החשבון'}))return;
    try{
      const t=JSON.parse(localStorage.getItem('wlm_token'));
      const r=await fetch('/api/me',{method:'DELETE',headers:{Authorization:'Bearer '+t}});
      if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.error||'מחיקה נכשלה')}
      localStorage.clear();
      location.hash='#/';
      location.reload();
    }catch(e){toast(e.message)}
  }
  window.vAccountHub=async function(){
    if(!state.token)return needLogin();
    const me=await api('/auth/me');
    state.me=me.user;save();
    let pts=0;try{const s=await api('/orders/club/summary');pts=(s.balances||[]).reduce((a,b)=>a+Number(b.balance||0),0)}catch(e){}
    const u=me.user||{};
    return `<div class="hdr"><h2>החשבון שלי</h2></div>
    <div class="body">
     <div class="card"><b>${esc(u.name||'ללא שם')}</b><div class="mut" dir="ltr" style="text-align:right">${esc(u.phone||u.email||'')}</div>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
       <button class="btn2" data-act="acctEditName">✏️ עריכת שם</button>
       <a class="btn2" href="#/sessions">🔐 התחברויות פעילות</a>
      </div></div>
     ${window.meContactSection?await window.meContactSection(u):''}
     <div class="card"><b>נקודות מועדון</b><div class="mut">יתרה כוללת: <b style="color:#0e7a8a">${pts}</b> נקודות (שוות ₪${pts})</div>
      <div style="margin-top:8px"><a class="btn2" href="#/club">★ למועדון</a></div></div>
     <div class="card"><b>הפעילות שלי</b>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
       <a class="btn2" href="#/orders">▤ היסטוריית הזמנות</a>
       <a class="btn2" href="#/addresses">📍 כתובות שמורות</a>
       <a class="btn2" href="#/prefs">🧺 העדפות כביסה</a>
       <a class="btn2" href="#/family">👨‍👩‍👧 מנוי משפחתי</a>
      </div></div>
     <div class="card"><b>המידע שלי</b><div class="mut">אפשר לייצא את כל המידע האישי כקובץ JSON (תיקון 13).</div>
      <div style="margin-top:8px"><button class="btn2" data-act="acctExport">⬇️ ייצוא המידע שלי</button></div></div>
     <div class="card" style="border-color:#7a2e2e"><b style="color:#d66">מחיקת החשבון</b><div class="mut">מחיקה לצמיתות: הפרטים יושמטו באנונימיזציה, ולא ניתן יהיה להתחבר שוב.</div>
      <div style="margin-top:8px"><button class="btn2" data-act="acctDelete" style="border-color:#7a2e2e;color:#d66">🗑️ מחיקת החשבון</button></div></div>
    </div>`;
  };
  /* הזמנה שלא נמצאה — מסך ידידותי במקום כרטיס שגיאה חשוף */
  if(typeof window.vOrder==='function'){
    const origO=window.vOrder;
    window.vOrder=async function(id){
      try{return await origO(id)}
      catch(e){
        if(e&&e.status===404)return `<div class="hdr"><h2>מעקב הזמנה</h2></div><div class="body"><div class="card" style="text-align:center"><div style="font-size:40px">🧺</div><b>לא מצאנו את ההזמנה</b><div class="mut" style="margin:6px 0">הקישור אולי שגוי, או שההזמנה שייכת לחשבון אחר.</div><a class="btn" href="#/orders">להזמנות שלי</a></div></div>`;
        throw e;
      }
    };
  }
  onAct({acctEditName:editName,acctExport:exportMyData,acctDelete:deleteAccount});
})();
