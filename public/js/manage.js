/* ---- manage (owner) ---- */
async function tenantCluster(slug,clid,action){try{await api(`/t/${slug}/clusters/${clid}/${action}`,{method:'POST',body:'{}'});toast(action==='join'?'הצטרפת לקלאסטר':'עזבת את הקלאסטר');route()}catch(e){toast(e.message)}}
async function tenantRateCourier(slug,cid,name){
 const v=await xmodal({title:'דירוג '+name,body:'איך השליח עבד איתכם לאחרונה?',okText:'שליחת דירוג',fields:[{id:'rating',label:'דירוג 1-5',value:'5',type:'number'}]});
 if(!v)return;
 try{await api(`/t/${slug}/couriers/${cid}/rate`,{method:'POST',body:JSON.stringify({rating:Number(v.rating)})});toast('הדירוג נשמר');route()}catch(e){toast(e.message)}
}
/* E5.T1: טופס הרשמה לשליח עצמאי (מוקאפ 19) */
function vCourierRegister(user,courier){
 const days=WD.map((d,i)=>`<label style="display:flex;align-items:center;gap:6px"><input type="checkbox" class="cr-day" value="${i}">${d}</label>`).join('');
 return `<div class="hdr"><h2>הצטרפות כשליח</h2><p>${courier&&courier.rejected_reason?'הבקשה הקודמת נדחתה — ניתן להגיש מחדש':'הרשמה לשליח עצמאי של הפלטפורמה'}</p></div>
 <div class="body">
 ${courier&&courier.rejected_reason?`<div class="card warn"><b>הבקשה נדחתה:</b> ${esc(courier.rejected_reason)}</div>`:''}
 <div class="card">
  <label class="lb">שם מלא</label><input class="inp" id="cr-name" value="${esc(user.name||'')}">
  <label class="lb">טלפון</label><input class="inp" value="${esc(user.phone||'')}" disabled>
  <label class="lb">סוג רכב</label><select class="inp" id="cr-vehicle"><option value="">— בחר —</option><option>אופנוע</option><option>קטנוע</option><option>רכב</option><option>אופניים חשמליים</option></select>
  <label class="lb">אזורי פעילות (מופרדים בפסיק)</label><input class="inp" id="cr-areas" placeholder="תל אביב, רמת גן, גבעתיים">
  <label class="lb">זמינות שבועית</label><div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">${days}</div>
  <label class="lb">מודל עבודה</label><select class="inp" id="cr-model"><option value="platform">שליח פלטפורמה — משימות מכל המכבסות</option><option value="shared">שליח משותף — משימות משולבות של מכבסות שכנות</option></select>
 </div>
 <div class="card">
  <div class="sec">מסמכים</div>
  <label class="lb">רישיון נהיגה (חובה)</label><input class="inp" id="cr-license" type="file" accept="image/*,application/pdf">
  <label class="lb">ביטוח (רשות)</label><input class="inp" id="cr-insurance" type="file" accept="image/*,application/pdf">
  <label class="lb">תמונה אישית (רשות)</label><input class="inp" id="cr-photo" type="file" accept="image/*">
 </div>
 <button class="btn" onclick="courierRegister()">שליחת בקשה לאישור</button>
 </div>`;
}
async function courierRegister(){
 try{
  const vehicle=$('#cr-vehicle').value;
  if(!vehicle)return toast('יש לבחור סוג רכב');
  if(!$('#cr-license').files[0])return toast('יש לצרף רישיון נהיגה');
  const fd=new FormData();
  fd.append('name',$('#cr-name').value);
  fd.append('vehicle',vehicle);
  fd.append('model',$('#cr-model').value);
  fd.append('areas',JSON.stringify($('#cr-areas').value.split(',').map(x=>x.trim()).filter(Boolean)));
  const avail={};document.querySelectorAll('.cr-day:checked').forEach(c=>avail[c.value]=[['08:00','20:00']]);
  fd.append('availability',JSON.stringify(avail));
  for(const k of ['license','insurance','photo']){const f=$('#cr-'+k).files[0];if(f)fd.append(k,f);}
  const r=await fetch('/api/courier/register',{method:'POST',headers:{Authorization:'Bearer '+state.token},body:fd});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||'שגיאה '+r.status);
  state.courier={id:d.courier.id,model:d.courier.model,approved:false};save();
  toast('הבקשה נשלחה לאישור');route();
 }catch(e){toast(e.message)}
}
