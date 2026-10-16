/* ---- join: onboarding מכבסה עם AI ---- */
let joinDraft=null;
async function vJoin(){
 if(!state.token)return needLogin();
 return `<div class="hdr"><h2>הצטרפות מכבסה לפלטפורמה</h2><p>צלמו מחירון, שעות פעילות ותקנון — וה-AI יבנה את הפרופיל</p></div>
 <div class="body">
  <div class="card">
   <div class="subtabs"><button class="chip on" type="button" id="tab-ai" onclick="joinMode('ai')">העלאת תמונות (AI)</button><button class="chip" type="button" id="tab-manual" onclick="joinMode('manual')">הזנה ידנית</button></div>
   <div id="join-ai">
    <label class="upload" for="join-files">📷 לחצו להעלאת תמונות מחירון / שעות / תקנון<input id="join-files" type="file" accept="image/*,application/pdf" multiple></label>
    <div id="join-extract"></div>
   </div>
   <div id="join-manual" style="display:none">
    <label class="lb">שם המכבסה</label><input class="inp" id="j-name">
    <label class="lb">טלפון</label><input class="inp" id="j-phone">
    <label class="lb">כתובת</label><input class="inp" id="j-address">
    <label class="lb">עיר</label><input class="inp" id="j-city">
    <button class="btn" onclick="joinManual()">המשך</button>
   </div>
  </div>
  <div id="join-review"></div>
 </div>`;
}
function joinMode(m){
 $('#tab-ai').className='chip'+(m==='ai'?' on':'');$('#tab-manual').className='chip'+(m==='manual'?' on':'');
 $('#join-ai').style.display=m==='ai'?'':'none';$('#join-manual').style.display=m==='manual'?'':'none';
}
async function joinManual(){
 joinDraft={name:$('#j-name').value,phone:$('#j-phone').value,address:$('#j-address').value,city:$('#j-city').value,items:[],windows:[],services:['כביסה']};
 renderJoinReview();
}
async function joinExtract(files){
 const fd=new FormData();for(const f of files)fd.append('files',f);
 $('#join-extract').innerHTML='<div class="mut" style="margin-top:10px">🤖 מנתח את המסמכים…</div>';
 try{
  const r=await fetch('/api/onboard/extract',{method:'POST',headers:{Authorization:'Bearer '+state.token},body:fd});
  const d=await r.json();if(!r.ok)throw new Error(d.error||'שגיאה');
  joinDraft=d.draft;
  $('#join-extract').innerHTML='';
  renderJoinReview();
 }catch(e){$('#join-extract').innerHTML=`<div class="warn" style="margin-top:10px">${esc(e.message)}</div>`}
}
function renderJoinReview(){
 const d=joinDraft;if(!d)return;
 const lowItems=(d.items||[]).filter(it=>it.confidence==='low').length;
 const hoursRows=Object.entries(d.hours||{}).map(([k,v])=>v&&v.length?`<div class="row"><div>${WD[k]}</div><div><input class="inp" dir="ltr" style="width:170px;padding:6px" value="${v.map(r=>r.join('–')).join(', ')}" onchange="joinSetHours('${k}',this.value)" placeholder="08:00–20:00"></div></div>`:null).filter(Boolean).join('');
 $('#join-review').innerHTML=`<div class="sec">סקירה לפני שליחה לאישור</div>
  <div class="warn">בדקו את הפרטים שזוהו מהמסמכים ותקנו כל טעות לפני השליחה — המחירון יופיע ללקוחות כפי שמופיע כאן.</div>
  <div class="card">
   <label class="lb">שם</label><input class="inp" id="jr-name" value="${esc(d.name||'')}">
   <label class="lb">טלפון</label><input class="inp" id="jr-phone" value="${esc(d.phone||'')}">
   <label class="lb">כתובת</label><input class="inp" id="jr-address" value="${esc(d.address||'')}">
   <label class="lb">עיר</label><input class="inp" id="jr-city" value="${esc(d.city||'')}">
   <label class="lb">דמי שליחות ₪</label><input class="inp" id="jr-fee" type="number" value="${d.delivery_fee||0}">
  </div>
  <div class="card"><b>מחירון (${(d.items||[]).length} פריטים)</b>
   ${lowItems?`<div class="warn">${lowItems} פריטים מסומנים בענבר — הזיהוי לא בטוח, יש לוודא את המחיר.</div>`:''}
   ${(d.items||[]).map((it,i)=>`<div class="row" style="${it.confidence==='low'?'background:#fff7e6;border-radius:8px':''}"><div style="flex:2"><input class="inp" value="${esc(it.name)}" onchange="joinDraft.items[${i}].name=this.value"><div class="mut">${esc(it.category||'')}${it.unit==='item'?' · ליחידה':' · ל'+unitLbl(it.unit)}</div></div><div style="display:flex;align-items:center;gap:4px;flex:1">₪<input class="inp" type="number" style="width:80px" value="${it.price}" onchange="joinDraft.items[${i}].price=Number(this.value)"> <button class="btn2" onclick="joinDraft.items.splice(${i},1);renderJoinReview()">✕</button></div></div>`).join('')||'<div class="mut">לא זוהו פריטים — הוסיפו ידנית בלוח הניהול אחרי ההצטרפות</div>'}
  </div>
  ${hoursRows?`<div class="card"><b>שעות פעילות</b>${d.hours_confidence==='low'?'<div class="warn">השעות שזוהו לא בטוחות — יש לוודא.</div>':''}${hoursRows}</div>`:''}
  ${d.terms?`<div class="card"><b>תקנון</b><div class="mut">${esc(d.terms)}</div></div>`:''}
  ${d.notes?`<div class="warn">שימו לב: ${esc(d.notes)}</div>`:''}
  <div id="jr-err"></div>
  <button class="btn" onclick="joinSubmit()">שליחה לאישור הפלטפורמה</button>`;
}
function joinSetHours(day,val){
 const rows=val.split(',').map(x=>x.trim()).filter(Boolean).map(x=>{
  const m=x.replace(/\s/g,'').match(/^(\d{1,2}:\d{2})[-–—](\d{1,2}:\d{2})$/);
  if(!m)throw new Error('פורמט שעות לא תקין: '+x+' (צפוי 08:00–20:00)');
  return [m[1],m[2]];
 });
 joinDraft.hours=joinDraft.hours||{};joinDraft.hours[day]=rows;
}
async function joinSubmit(){
 try{
  const d=joinDraft;
  const miss=[];
  if(!$('#jr-name').value.trim())miss.push('שם');
  if(!$('#jr-phone').value.trim())miss.push('טלפון');
  if(!$('#jr-address').value.trim())miss.push('כתובת');
  if(!$('#jr-city').value.trim())miss.push('עיר');
  const zero=(d.items||[]).filter(it=>!(Number(it.price)>0));
  if(miss.length){$('#jr-err').innerHTML=`<div class="warn">חסרים שדות חובה: ${miss.join(', ')}</div>`;window.scrollTo(0,0);return}
  if(zero.length){$('#jr-err').innerHTML=`<div class="warn">${zero.length} פריטים ללא מחיר תקין — תקנו או מחקו אותם לפני השליחה.</div>`;return}
  const body={name:$('#jr-name').value,phone:$('#jr-phone').value,address:$('#jr-address').value,city:$('#jr-city').value,
   delivery_fee:$('#jr-fee').value,items:d.items||[],windows:d.windows||[],services:d.services||['כביסה'],hours:d.hours||{},terms:d.terms||''};
  const r=await api('/onboard/tenants',{method:'POST',body:JSON.stringify(body)});
  joinDraft=null;
  $('#join-review').innerHTML=`<div class="note">✅ המכבסה <b>${esc(r.tenant.name)}</b> נוצרה וממתינה לאישור מנהל הפלטפורמה. אחרי האישור תופיע במרקטפלייס, ולוח הניהול כבר פתוח לך בלשונית ״ניהול״.</div>`;
 }catch(e){toast(e.message)}
}

