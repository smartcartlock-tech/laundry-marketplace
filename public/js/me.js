/* T18: אמצעי קשר וחיבורים במסך "החשבון שלי" — עריכת טלפון/אימייל עם קוד אימות,
   חיבור/ניתוק Google. מספק את meContactSection(u) ל-account-hub (נטען אחריו, זמין בזמן רינדור). */
(function(){
  async function refreshMe(){
    const me=await api('/auth/me');
    state.me=me.user;save();
  }
  async function editContact(kind){
    const isPhone=kind==='phone';
    const cur=isPhone?(state.me&&state.me.phone):(state.me&&state.me.email);
    const v=await xmodal({title:isPhone?'שינוי מספר טלפון':'שינוי כתובת אימייל',okText:'שליחת קוד אימות',
      fields:[{id:'value',label:isPhone?'מספר חדש':'אימייל חדש',value:cur||'',dir:'ltr'}]});
    if(!v)return;
    let req;
    try{
      req=await api('/me/contact/request',{method:'POST',body:JSON.stringify({kind,value:v.value})});
    }catch(e){toast(e.message);return}
    const c=await xmodal({title:'אימות',okText:'אישור ושינוי',
      fields:[{id:'code',label:'קוד האימות'+(req.demoCode?` (בדמו: ${req.demoCode})`:''),value:'',dir:'ltr'}]});
    if(!c)return;
    try{
      const r=await api('/me/contact/confirm',{method:'POST',body:JSON.stringify({kind,value:req.target||v.value,code:c.code})});
      await refreshMe();toast(isPhone?'הטלפון עודכן':'האימייל עודכן');route();
    }catch(e){toast(e.message)}
  }
  function googleConnect(){
    if(!state.cfg||!state.cfg.googleClientId){toast('חיבור Google לא מוגדר כרגע');return}
    if(!window.google||!google.accounts){toast('שירות Google לא נטען — נסו לרענן');return}
    google.accounts.id.initialize({client_id:state.cfg.googleClientId,callback:async(resp)=>{
      try{
        await api('/me/google/connect',{method:'POST',body:JSON.stringify({credential:resp.credential})});
        await refreshMe();toast('חשבון Google חובר');route();
      }catch(e){toast(e.message)}
    }});
    google.accounts.id.prompt();
  }
  async function googleDisconnect(){
    if(!await xconfirm('לנתק את חשבון ה-Google? עדיין תוכלו להתחבר עם טלפון או אימייל.',{title:'ניתוק Google',okText:'כן, לנתק'}))return;
    try{await api('/me/google/disconnect',{method:'POST'});await refreshMe();toast('חשבון Google נותק');route()}
    catch(e){toast(e.message)}
  }
  window.meContactSection=async function(u){
    let g={connected:false,email:null};
    try{g=await api('/me/google/status')}catch(e){}
    const gRow=g.connected
      ?`<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
         <div>🌐 Google <span class="mut">מחובר</span></div>
         <button class="btn2" data-act="meGoogleDisc" style="border-color:#7a2e2e;color:#d66">ניתוק</button></div>`
      :`<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
         <div>🌐 Google <span class="mut">לא מחובר</span></div>
         <button class="btn2" data-act="meGoogleConn">חיבור</button></div>`;
    return `<div class="card"><b>אמצעי קשר והתחברות</b>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
        <div>📱 <span dir="ltr">${esc(u.phone||'—')}</span></div>
        <button class="btn2" data-act="meEditPhone">עריכה</button></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
        <div>✉️ <span dir="ltr">${esc(u.email||'—')}</span></div>
        <button class="btn2" data-act="meEditEmail">עריכה</button></div>
      ${gRow}
      <div class="mut" style="margin-top:8px">שינוי טלפון או אימייל דורש קוד אימות שנשלח ליעד החדש.</div>
    </div>`;
  };
  onAct({meEditPhone:()=>editContact('phone'),meEditEmail:()=>editContact('email'),meGoogleConn:googleConnect,meGoogleDisc:googleDisconnect});
})();
