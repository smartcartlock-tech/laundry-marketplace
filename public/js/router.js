/* ---- router ---- */

async function vVerify(code){
 const ICON={authentic:'✅',partial:'⚠️',credited:'⛔',altered:'❌'};
 const PILL={authentic:'st-delivered',partial:'st-out_for_delivery',credited:'st-cancelled',altered:'st-cancelled'};
 let d=null,notFound=false;
 try{d=await api(`/verify/${encodeURIComponent(code||'')}`)}catch(e){if(e.status===404)notFound=true;else throw e}
 return `<div class="hdr"><h2>אימות מסמך</h2></div><div class="body">
  <div class="card" style="text-align:center">
   <div style="font-size:44px">${notFound?'❓':ICON[d.result]||'❓'}</div>
   ${notFound?`<b>המסמך לא נמצא</b><div class="mut" style="margin-top:6px">בדקו שהקוד הוזן כראוי או סרקו שוב את ה-QR.</div>`
   :`<b>${d.kind_he} ${d.doc_number}/${d.doc_year}</b>
    <div style="margin:6px 0"><span class="st-pill ${PILL[d.result]||''}">${d.result_he}</span></div>
    <div class="mut">המפיק: ${esc(d.tenant_name)}</div>
    <div style="font-size:22px;font-weight:700;margin:6px 0">₪${d.total}</div>
    <div class="mut">הופק ב-${new Date(d.issued_at).toLocaleDateString('he-IL')}${d.orders_count?` · מכסה ${d.orders_count} הזמנות`:''}</div>
    <div class="mut" style="margin-top:6px">${d.signature_valid?'חתימה דיגיטלית תקינה (HMAC-SHA256)':'⚠️ החתימה הדיגיטלית אינה תואמת'}${d.sha256?' · גיבוב מסמך נשמר':''}</div>
    <div class="mut" style="margin-top:10px;color:#b00">מסמך דמו — לא לצורכי מע"מ (טרם רישום תוכנה ברשות המסים)</div>`}
   <div style="margin-top:12px"><button class="btn2" data-act="goHomeRoute">לדף הבית</button></div>
  </div></div>`;
}

async function route(){
 const seq=++routeSeq;
 if(orderPoll){clearInterval(orderPoll);orderPoll=null}
 document.querySelectorAll('.modal-ov').forEach(m=>m.remove());
 const h=location.hash||'#/';
 const [,path]=h.split('#');
 const [p,qstr]=path.split('?');
 const q=new URLSearchParams(qstr||'');
 // P0: חלקי ה-route מקודדים (סלאג עברי ב-hash מגיע percent-encoded) — פענוח בטוח
 const dec=s=>{try{return decodeURIComponent(s)}catch(_){return s}};
 const parts=p.split('/').filter(Boolean).map(dec);
 let html='';
 $('#app').innerHTML='<div class="body"><div class="card mut" style="text-align:center;padding:40px 0">טוען…</div></div>';
 const tst=$('.toast');if(tst)tst.classList.remove('show');
 try{
  if(parts.length===0)html=state.brandSlug?await vLaundry(state.brandSlug):await vHome(q.get('q'));
  else if(parts[0]==='login')html=vLogin();
  else if(parts[0]==='laundry')html=await vLaundry(parts[1]);
  else if(parts[0]==='checkout')html=await vCheckout(parts[1]);
  else if(parts[0]==='orders'&&parts[1])html=await vOrder(parts[1]);
  else if(parts[0]==='orders')html=await vOrders();
  else if(parts[0]==='club')html=await vClub();
  else if(parts[0]==='sessions')html=await vSessions(); // ביקורת סשנים
  else if(parts[0]==='addresses')html=await vAddresses(); // CX-B1
  else if(parts[0]==='prefs')html=await vPrefs(); // CX-B2
  else if(parts[0]==='family')html=await vFamily(); // CX-B3
  else if(parts[0]==='account')html=await vAccountHub(); // CX-D2
  else if(parts[0]==='join-family')html=vJoinFamily(parts[1]); // CX-B3
  else if(parts[0]==='courier'&&parts[1]==='day')html=await vCourierDay(q.get('date'));
  else if(parts[0]==='courier'&&parts[1]==='history')html=await vCourierHistory(q.get('period'));
  else if(parts[0]==='courier'&&parts[1]==='map')html=await vCourierMap();
  else if(parts[0]==='courier'&&parts[1]==='profile')html=await vCourierProfile();
  else if(parts[0]==='courier'&&parts[1]==='help')html=await vCourierHelp();
  else if(parts[0]==='courier')html=await vCourier(parts[1]);
  else if(parts[0]==='community')html=await vCommunity(parts[1],parts[2]);
 else if(parts[0]==='manage')html=await vManage(parts[1]);
  else if(parts[0]==='admin'&&parts[1]==='tenant')html=await vAdminTenant(parts[2]);
  else if(parts[0]==='admin')html=await vAdmin(parts[1]);
  else if(parts[0]==='join')html=await vJoin();
  else if(parts[0]==='help')html=vHelp(); // D1
  else if(parts[0]==='owner-guide')html=vOwnerGuide(); // G9
  else if(parts[0]==='messages')html=await vMessages(); // N1
  else if(parts[0]==='notif-settings')html=await vNotifSettings(); // N7
  else if(parts[0]==='notif-log')html=await vOwnerNotifLog(parts[1]); // N8
  else if(parts[0]==='bot-sim')html=vBotSim(); // N3
  else if(parts[0]==='pay')html=await vPay(parts[1]);
  else if(parts[0]==='verify')html=await vVerify(parts[1]);
  else if(parts[0]==='track')html=await vTrack(parts[1]); // G3b
  else html=`<div class="hdr"><h2>הדף לא נמצא</h2></div><div class="body"><div class="card" style="text-align:center"><div style="font-size:40px">🧺</div><b>404 — לא מצאנו את הדף הזה</b><div class="mut" style="margin:6px 0">הקישור אולי השתנה או שהוזן בטעות.</div><button class="btn" data-act="goHome">חזרה לדף הבית</button></div></div>`;
 }catch(e){
  if(e.status===401){state.token=null;state.me=null;state.memberships=[];state.courier=null;save();html=vLogin()}
  else html=`<div class="body"><div class="card warn">${esc(e.message)}</div></div>`;
 }
 if(seq!==routeSeq)return; // ניווט חדש יותר דורס רינדור ישן — נחיתה עקבית תמיד
 renderTabs(h.split('?')[0]);
 $('#app').innerHTML=html;
 if(parts[0]==='login')initGoogle();
 if(state.brandSlug)applyBrandTheme(state.brandSlug);
 const jf=$('#join-files');if(jf)jf.onchange=()=>joinExtract(jf.files);
 if(parts[0]==='checkout'&&__coAddrs.length===1){const sa=$('#co-saved-addr');if(sa){sa.value=__coAddrs[0].id;pickAddr(sa)}} // E13.T2: כתובת שמורה יחידה נבחרת אוטומטית
 window.scrollTo(0,0);
}
window.addEventListener('hashchange',route);
window.addEventListener('storage',e=>{
 if(e.key&&e.key.startsWith('wlm_')){
  state.token=store.get('token',null);state.me=store.get('me',null);state.memberships=store.get('memberships',[]);state.courier=store.get('courier',null);
  route();
 }
});
(async()=>{
 try{state.cfg=await api('/config')}catch(e){state.cfg={}}
 if(state.token){try{const me=await api('/auth/me');state.me=me.user;state.memberships=me.memberships||[];state.courier=me.courier||null;save();await adoptCloudCart()}catch(e){if(e&&e.status===401){state.token=null;state.me=null;state.memberships=[];state.courier=null;save();toast('פג תוקף החיבור — התחברו שוב')}/* T78: תקלה זמנית (רשת/שרת) — הטוקן נשמר, ה-route יציג שגיאה במקום ניתוק שקט */}}
 route();
})();
/* B7: רישום פעולות להאזנה המרכזת (ללא inline handlers) */
onAct({
 goHome:()=>go('#/'), goHomeRoute:()=>{go('#/');route()}
});
