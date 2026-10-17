/* T85: איסוף קבוע לצרכן — מנוי איסוף חוזר (שבועי/דו-שבועי).
   כפתור "איסוף קבוע" בדף המכבסה (טופס: יום, תדירות, שעה, כתובת, פריטים)
   + כרטיס ניהול ב"החשבון שלי" (השהיה/חידוש/ביטול). נטען אחרי account-hub ו-support-chat. */
(function(){
 if(typeof onAct!=='function')return;
 const DAYS=['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
 let ctx=null; // {slug, items}

 async function openForm(slug){
  const d=await api('/laundries/'+encodeURIComponent(slug));
  if(!d||!d.items||!d.items.length)return toast('אין פריטים זמינים במכבסה');
  ctx={slug,items:d.items};
  const old=document.getElementById('rp-ov');if(old)old.remove();
  const ov=document.createElement('div');ov.className='modal-ov';ov.id='rp-ov';
  const defAddr=(state.me&&state.me.address)||'';
  ov.innerHTML=`<div class="modal" role="dialog" aria-modal="true" style="max-height:86vh;overflow-y:auto;width:min(480px,94vw)">
   <div style="display:flex;justify-content:space-between;align-items:center">
    <b>איסוף קבוע — ${esc(d.laundry?d.laundry.name:'')}</b>
    <button class="btn2" data-act="rpClose" style="padding:6px 12px">✕</button></div>
   <div class="mut" style="font-size:12px;margin:4px 0">הזמנה תיווצר אוטומטית בכל שבוע ביום שתבחרו. אפשר להשהות או לבטל בכל רגע ב"החשבון שלי".</div>
   <label class="lbl">יום קבוע</label>
   <select class="inp" id="rp-wd">${DAYS.map((d2,i)=>`<option value="${i}">${d2}</option>`).join('')}</select>
   <label class="lbl">תדירות</label>
   <select class="inp" id="rp-freq"><option value="weekly">כל שבוע</option><option value="biweekly">כל שבועיים</option></select>
   <label class="lbl">שעת איסוף מועדפת (לא חובה)</label>
   <input class="inp" id="rp-time" type="time">
   <label class="lbl">כתובת איסוף</label>
   <input class="inp" id="rp-addr" value="${esc(defAddr)}" placeholder="רחוב, מספר, עיר">
   <label class="lbl">פריטים קבועים</label>
   <div style="max-height:180px;overflow-y:auto;border:1px solid #d3e8ec;border-radius:10px;padding:6px">
    ${d.items.map(it=>`<label style="display:flex;gap:8px;align-items:center;padding:4px 2px;font-size:14px">
      <input type="checkbox" class="rp-item" value="${it.id}"> <span style="flex:1">${esc(it.name)}</span> <span class="mut">₪${it.price}</span></label>`).join('')}
   </div>
   <button class="btn" data-act="rpCreate" style="width:100%;margin-top:10px">הפעלת איסוף קבוע</button></div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove()});
 }

 function subRow(s){
  const freq=s.frequency==='biweekly'?'כל שבועיים':'כל שבוע';
  return `<div class="card lcard">
   <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
    <div><b>${esc(s.tenant_name)}</b><div class="mut" style="font-size:12px">יום ${DAYS[s.weekday]} · ${freq}${s.pickup_time?' · '+esc(s.pickup_time):''}</div>
     <div class="mut" style="font-size:12px">${esc(s.address)}</div></div>
    <span class="st-pill ${s.active?'ok':''}">${s.active?'פעיל':'מושהה'}</span></div>
   <div style="display:flex;gap:6px;margin-top:8px">
    <button class="btn2" data-act="rpToggle" data-a="${s.id}" data-b="${s.active?'1':'0'}" style="flex:1">${s.active?'השהיה':'חידוש'}</button>
    <button class="btn2" data-act="rpCancel" data-a="${s.id}" style="flex:1;color:#b3261e">ביטול מנוי</button></div></div>`;
 }

 async function loadMine(box){
  try{
   const d=await api('/me/recurring-pickups');
   box.innerHTML=d.subscriptions.length?d.subscriptions.map(subRow).join(''):'<div class="mut">אין מנויים פעילים — אפשר לקבוע איסוף קבוע מדף המכבסה.</div>';
  }catch(e){box.innerHTML='<div class="mut">לא ניתן לטעון מנויים כרגע</div>'}
 }

 onAct({
  rpClose:()=>{const ov=document.getElementById('rp-ov');if(ov)ov.remove()},
  rpOpen:t=>{if(!state.token)return toast('התחברו כדי לקבוע איסוף קבוע');openForm(t.dataset.a).catch(e=>toast(e.message||'שגיאה'))},
  rpCreate:async()=>{
   if(!ctx)return;
   const items=[...document.querySelectorAll('.rp-item:checked')].map(c=>({item_id:c.value,qty:1}));
   const body={weekday:Number(document.getElementById('rp-wd').value),frequency:document.getElementById('rp-freq').value,
    pickup_time:document.getElementById('rp-time').value||null,address:document.getElementById('rp-addr').value.trim(),items};
   try{
    await api('/t/'+encodeURIComponent(ctx.slug)+'/recurring-pickup',{method:'POST',body:JSON.stringify(body)});
    toast('איסוף קבוע הופעל — ההזמנה הראשונה תיווצר ביום הקבוע הקרוב');
    const ov=document.getElementById('rp-ov');if(ov)ov.remove();
   }catch(e){toast(e.message||'שגיאה בהפעלה')}
  },
  rpToggle:async t=>{
   try{await api('/me/recurring-pickups/'+t.dataset.a,{method:'PATCH',body:JSON.stringify({active:t.dataset.b!=='1'})});
    toast(t.dataset.b==='1'?'המנוי הושהה':'המנוי חודש');const box=document.getElementById('rp-mine');if(box)loadMine(box);
   }catch(e){toast(e.message||'שגיאה')}
  },
  rpCancel:async t=>{
   if(!await xconfirm('לבטל את האיסוף הקבוע? הזמנות שכבר נוצרו לא יבוטלו.'))return;
   try{await api('/me/recurring-pickups/'+t.dataset.a,{method:'DELETE'});toast('המנוי בוטל');
    const box=document.getElementById('rp-mine');if(box)loadMine(box);
   }catch(e){toast(e.message||'שגיאה')}
  }
 });

 /* כפתור בדף מכבסה: עטיפה של vLaundry */
 if(typeof window.vLaundry==='function'){
  const origL=window.vLaundry;
  window.vLaundry=async function(slug){
   const html=await origL(slug);
   if(!state.token)return html;
   const btn=`<div class="body" style="padding-top:0"><button class="btn2" style="width:100%" data-act="rpOpen" data-a="${esc(slug)}">🔄 קביעת איסוף קבוע</button></div>`;
   return html+btn;
  };
 }

 /* כרטיס ניהול ב"החשבון שלי": עטיפה של vAccountHub */
 if(typeof window.vAccountHub==='function'){
  const origH=window.vAccountHub;
  window.vAccountHub=async function(){
   const html=await origH();
   if(!state.token)return html;
   const card=`<div class="body"><div class="card"><b>🔄 איסוף קבוע שלי</b><div id="rp-mine" style="margin-top:8px"><div class="mut">טוען...</div></div></div></div>`;
   setTimeout(()=>{const box=document.getElementById('rp-mine');if(box)loadMine(box)},0);
   return html+card;
  };
 }
})();
