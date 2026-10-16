/* ---- E9.T1: דיווח תקלה עם תמונות ---- */
function openReportModal(orderId){
 const ov=document.createElement('div');ov.className='modal-ov';
 ov.innerHTML=`<div class="modal" role="dialog" aria-modal="true"><b>דיווח על תקלה</b>
  <label class="lb">סוג התקלה</label>
  <select class="inp" id="rp-kind"><option value="damage">נזק לכביסה</option><option value="missing">פריט חסר</option><option value="late">איחור</option><option value="other">אחר</option></select>
  <label class="lb">תיאור</label>
  <input class="inp" id="rp-text" placeholder="מה קרה?">
  <label class="lb">תמונות (עד 3)</label>
  <input class="inp" id="rp-photos" type="file" accept="image/jpeg,image/png,image/webp" multiple>
  <div class="mut" id="rp-pmsg" style="margin:4px 0"></div>
  <div style="display:flex;gap:8px;margin-top:14px"><button class="btn" id="rp-ok" style="flex:1">שליחת דיווח</button><button class="btn2" id="rp-cancel" style="flex:1">ביטול</button></div></div>`;
 document.body.appendChild(ov);
 ov.querySelector('#rp-cancel').onclick=()=>ov.remove();
 ov.onclick=e=>{if(e.target===ov)ov.remove()};
 ov.querySelector('#rp-ok').onclick=async()=>{
  const btn=ov.querySelector('#rp-ok');btn.disabled=true;
  try{
   const files=[...ov.querySelector('#rp-photos').files].slice(0,3);
   const photos=[];
   for(const f of files)photos.push(await fileToB64(f));
   await api('/orders/'+orderId+'/report',{method:'POST',body:JSON.stringify({kind:ov.querySelector('#rp-kind').value,text:ov.querySelector('#rp-text').value,photos:photos.length?photos:undefined})});
   ov.remove();toast('הדיווח נשלח — המכבסה תטפל');route();
  }catch(e){btn.disabled=false;ov.querySelector('#rp-pmsg').textContent=e.message}
 };
}
function fileToB64(f){
 return new Promise((res,rej)=>{
  if(!/^image\/(jpeg|png|webp)$/.test(f.type))return rej(new Error('סוג קובץ לא נתמך'));
  const img=new Image();
  img.onload=()=>{
   const MAX=1024,sc=Math.min(1,MAX/Math.max(img.width,img.height));
   const cv=document.createElement('canvas');cv.width=Math.round(img.width*sc);cv.height=Math.round(img.height*sc);
   cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);
   const url=cv.toDataURL('image/jpeg',0.8);
   URL.revokeObjectURL(img.src);
   res({content_type:'image/jpeg',data_b64:url.split(',')[1]});
  };
  img.onerror=()=>rej(new Error('לא ניתן לקרוא את התמונה'));
  img.src=URL.createObjectURL(f);
 });
}
async function openIssuePhoto(pid){
 try{
  const r=await fetch('/api/issue-photos/'+pid,{headers:state.token?{Authorization:'Bearer '+state.token}:{}});
  if(!r.ok)throw new Error('אין הרשאה לתמונה');
  const b=await r.blob();
  const w=window.open(URL.createObjectURL(b),'_blank');
  if(!w)toast('אפשרו חלונות קופצים לצפייה בתמונה');
 }catch(e){toast(e.message)}
}
async function tenantIssueHandle(slug,id){
 const v=await new Promise(resolve=>{
  const ov=document.createElement('div');ov.className='modal-ov';
  ov.innerHTML=`<div class="modal" role="dialog" aria-modal="true"><b>עדכון טיפול בתקלה</b>
   <div class="mut" style="margin:8px 0">בחרו סטטוס:</div>
   <div style="display:flex;gap:6px" id="ih-status">
    <button class="btn2 ih-st" data-v="open" style="flex:1">פתוח</button>
    <button class="btn2 ih-st on" data-v="in_progress" style="flex:1">בטיפול</button>
    <button class="btn2 ih-st" data-v="resolved" style="flex:1">טופל</button>
   </div>
   <label class="lb" style="margin-top:10px">תיעוד הטיפול</label><input class="inp" id="ih-note">
   <div style="display:flex;gap:8px;margin-top:14px"><button class="btn" id="ih-ok" style="flex:1">שמירה</button><button class="btn2" id="ih-cancel" style="flex:1">ביטול</button></div></div>`;
  document.body.appendChild(ov);
  ov.querySelectorAll('.ih-st').forEach(b=>b.onclick=()=>{ov.querySelectorAll('.ih-st').forEach(x=>x.classList.remove('on'));b.classList.add('on')});
  const done=v=>{ov.remove();resolve(v)};
  ov.querySelector('#ih-ok').onclick=()=>done({status:ov.querySelector('.ih-st.on').dataset.v,note:ov.querySelector('#ih-note').value});
  ov.querySelector('#ih-cancel').onclick=()=>done(null);
  ov.onclick=e=>{if(e.target===ov)done(null)};
 });
 if(!v)return;
 const med=await xconfirm('להסלים את התקלה לגישור אדמין הפלטפורמה?',{title:'הסלמה לגישור',okText:'כן, להסלים'});
 try{await api(`/t/${slug}/issues/${id}/handle`,{method:'POST',body:JSON.stringify({status:v.status,note:v.note||undefined,mediation:!!med})});toast('הטיפול עודכן');route()}catch(e){toast(e.message)}
}
async function adminIssueHandle(id){
 const v=await xmodal({title:'סיום גישור אדמין',okText:'סגירת תקלה',fields:[{id:'note',label:'תיעוד הגישור'}]});
 if(!v)return;
 try{await api(`/admin/issues/${id}/handle`,{method:'POST',body:JSON.stringify({status:'resolved',note:v.note||''})});toast('התקלה נסגרה בגישור');route()}catch(e){toast(e.message)}
}
