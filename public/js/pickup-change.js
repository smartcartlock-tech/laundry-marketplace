/* T26: customer pickup change using configured, available Jerusalem-time slots. */
async function editPickup(id, btn){
 if(btn.disabled)return;
 btn.disabled=true;
 try{
  const d=await api('/orders/'+id+'/pickup-options');
  if(!d.options.length){toast('אין חלונות איסוף זמינים כרגע. פנו למכבסה לתיאום');return}
  const body='<label for="pickup-choice">בחרו חלון איסוף חדש</label><select id="pickup-choice" class="inp" name="pickup_at">'+d.options.map(s=>'<option value="'+esc(s.at)+'">'+esc(s.label)+'</option>').join('')+'</select><div class="mut">המכבסה והשליח המשובץ יקבלו עדכון. סביבת דמו.</div>';
  const selected=await new Promise(resolve=>{
   const ov=document.createElement('div');ov.className='modal-ov';
   ov.innerHTML='<div class="modal" role="dialog" aria-modal="true" aria-label="שינוי חלון איסוף"><b>שינוי חלון איסוף</b>'+body+'<div style="display:flex;gap:8px;margin-top:12px"><button class="btn" id="pc-ok">אישור שינוי</button><button class="btn2" id="pc-cancel">ביטול</button></div></div>';
   const done=v=>{ov.remove();resolve(v)};
   ov.querySelector('#pc-ok').onclick=()=>done(ov.querySelector('#pickup-choice').value);
   ov.querySelector('#pc-cancel').onclick=()=>done(null);
   ov.onclick=e=>{if(e.target===ov)done(null)};
   document.body.appendChild(ov);ov.querySelector('select').focus();
  });
  if(!selected)return;
  await api('/orders/'+id+'/pickup',{method:'POST',body:JSON.stringify({pickup_at:selected})});
  toast('חלון האיסוף עודכן');
  await route();
 }catch(e){toast(e.message)}finally{btn.disabled=false}
}
onAct({editPickup:t=>editPickup(t.dataset.a,t)});
