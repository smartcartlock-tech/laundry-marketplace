/* T83: צ'אט תמיכה לקוח-מכבסה בתוך האפליקציה.
   לקוח: כרטיס "צ'אט תמיכה" ב"החשבון שלי" + כפתור בדף הזמנה. מכבסה: לשונית "תמיכה" בלוח הניהול.
   אדמין: לשונית "תמיכה" בניהול פלטפורמה — צפייה בלבד, מתועדת כ"צפיית מנהל" ומוצגת לצדדים.
   רענון כל 15 שניות כל עוד החלון פתוח; בלי websockets ובלי התראות החוצה. כל תוכן עובר esc(). */
(function(){
 if(typeof onAct!=='function')return;
 const L=(p,o)=>api('/chat'+p,o);
 let pollT=null, cur=null;
 function stopPoll(){if(pollT){clearInterval(pollT);pollT=null}}

 function msgHtml(m,myRole){
  const mine=m.sender_role===myRole;
  return `<div style="display:flex;justify-content:${mine?'flex-start':'flex-end'};margin:6px 0">
   <div style="max-width:82%;padding:8px 12px;border-radius:12px;background:${mine?'#dff3f6':'#fff'};border:1px solid #d3e8ec">
    <div style="white-space:pre-wrap;word-break:break-word">${esc(m.body)}</div>
    <div class="mut" style="font-size:10px;margin-top:2px">${fmtDT(m.ts)}${mine?(m.read_at?' · נקרא ✓✓':' · נשלח ✓'):''}</div>
   </div></div>`;
 }

 async function refresh(){
  if(!cur||!document.body.contains(cur.ov)){stopPoll();cur=null;return}
  try{
   const d=await L('/threads/'+cur.id+'/messages');
   const box=cur.ov.querySelector('#sc-msgs');
   box.innerHTML=d.messages.length?d.messages.map(m=>msgHtml(m,cur.role==='admin'?null:cur.role)).join(''):'<div class="mut" style="text-align:center;margin:14px 0">עוד אין הודעות — כתבו את הראשונה</div>';
   box.scrollTop=box.scrollHeight;
   const note=cur.ov.querySelector('#sc-admin-note');
   if(note)note.innerHTML=d.thread.admin_viewed_at?'<div class="warn" style="margin:6px 0">👁 מנהל פלטפורמה צפה בשיחה זו ('+fmtDT(d.thread.admin_viewed_at)+')</div>':'';
   const closed=d.thread.status!=='open';
   const inp=cur.ov.querySelector('#sc-inp'),btn=cur.ov.querySelector('#sc-send-btn'),cl=cur.ov.querySelector('#sc-close-btn');
   if(inp){inp.disabled=closed;inp.placeholder=closed?'השרשור סגור':'כתבו הודעה...'}
   if(btn)btn.disabled=closed;
   if(cl)cl.style.display=closed?'none':'';
   if(cur.role!=='admin'&&!closed)await L('/threads/'+cur.id+'/read',{method:'POST'}).catch(()=>{});
  }catch(e){/* שגיאת רשת זמנית — הסיבוב הבא ינסה שוב */}
 }

 function openOverlay(threadId,role,title){
  stopPoll();
  const old=document.getElementById('sc-ov');if(old)old.remove();
  const ov=document.createElement('div');ov.className='modal-ov';ov.id='sc-ov';
  ov.innerHTML=`<div class="modal" role="dialog" aria-modal="true" style="max-height:84vh;display:flex;flex-direction:column;width:min(480px,94vw)">
   <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
    <b>${esc(title||'צ\'אט תמיכה')}</b>
    <span style="display:flex;gap:6px">
     ${role!=='admin'?`<button class="btn2" id="sc-close-btn" data-act="scCloseThread" style="padding:6px 10px;font-size:12px">סגירת שרשור</button>`:''}
     <button class="btn2" data-act="scClose" style="padding:6px 12px">✕</button>
    </span></div>
   ${role==='admin'?'<div class="warn" style="margin:6px 0">👁 צפיית מנהל — הצפייה מתועדת וגלויה לצדדים. לא ניתן לכתוב.</div>':''}
   <div id="sc-admin-note"></div>
   <div id="sc-msgs" style="flex:1;overflow-y:auto;margin:8px 0;min-height:180px"><div class="mut" style="text-align:center;margin:14px 0">טוען...</div></div>
   ${role!=='admin'?`<div style="display:flex;gap:6px">
    <input class="inp" id="sc-inp" style="margin-bottom:0;flex:1" placeholder="כתבו הודעה..." maxlength="2000" aria-label="תוכן ההודעה">
    <button class="btn" id="sc-send-btn" data-act="scSend" style="flex-shrink:0">שליחה</button></div>`:''}
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov){ov.remove();stopPoll();cur=null}});
  cur={id:threadId,role,ov};
  const inp=ov.querySelector('#sc-inp');
  if(inp)inp.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();sendMsg()}});
  refresh();
  pollT=setInterval(refresh,15000);
 }

 async function sendMsg(){
  if(!cur)return;
  const inp=cur.ov.querySelector('#sc-inp');if(!inp)return;
  const body=inp.value.trim();if(!body)return;
  inp.value='';
  try{await L('/threads/'+cur.id+'/messages',{method:'POST',body:JSON.stringify({body})});refresh()}
  catch(e){toast(e.message||'שליחה נכשלה');inp.value=body}
 }

 onAct({
  scClose:()=>{const ov=document.getElementById('sc-ov');if(ov)ov.remove();stopPoll();cur=null},
  scSend:sendMsg,
  scCloseThread:async()=>{
   if(!cur)return;
   if(!await xconfirm('לסגור את השרשור? לא ניתן יהיה לכתוב בו עוד.'))return;
   try{await L('/threads/'+cur.id+'/close',{method:'POST'});toast('השרשור נסגר');refresh()}catch(e){toast(e.message)}
  },
  // לקוח: פתיחת צ'אט מהזמנה (a=slug, b=orderId) או שרשור קיים (a=threadId, b=שם מכבסה)
  scOrder:async(t)=>{const a=t.dataset.a,b=t.dataset.b;try{const d=await L('/threads',{method:'POST',body:JSON.stringify({slug:a,order_id:b||undefined})});openOverlay(d.thread.id,'customer')}catch(e){toast(e.message)}},
  scOpenThread:t=>openOverlay(t.dataset.a,'customer',t.dataset.b),
  // מכבסה/אדמין: פתיחת שרשור מהתיבה (data-a=threadId, data-b=כותרת)
  scOpenManage:t=>openOverlay(t.dataset.a,'laundry',t.dataset.b),
  scOpenAdmin:t=>openOverlay(t.dataset.a,'admin',t.dataset.b),
  scNewChat:async()=>{
   const sel=document.getElementById('sc-laund');if(!sel||!sel.value)return toast('בחרו מכבסה');
   try{const d=await L('/threads',{method:'POST',body:JSON.stringify({slug:sel.value})});openOverlay(d.thread.id,'customer',sel.options[sel.selectedIndex].textContent)}catch(e){toast(e.message)}
  }
 });

 /* --- לקוח: כרטיס ב"החשבון שלי" --- */
 if(typeof window.vAccountHub==='function'){
  const origH=window.vAccountHub;
  window.vAccountHub=async function(){
   const html=await origH();
   if(!state.token)return html;
   let card='';
   try{
    const d=await L('/threads/mine');
    const lnd=await api('/laundries');
    const rows=(d.threads||[]).map(t=>`<div class="row" style="cursor:pointer" data-act="scOpenThread" data-a="${t.id}" data-b="${esc(t.tenant_name)}">
      <div><b>${esc(t.tenant_name)}</b>${t.status!=='open'?' <span class="mut">(סגור)</span>':''}<div class="mut">${t.last_body?esc(String(t.last_body).slice(0,60)):''}</div></div>
      ${t.unread?`<span class="tag tb">${t.unread}</span>`:'<span style="color:#8a99a3">‹</span>'}</div>`).join('');
    card=`<div class="body" style="padding-top:0"><div class="card"><b>💬 צ\'אט תמיכה</b>
     ${rows||'<div class="mut" style="margin:4px 0">אין שיחות פתוחות</div>'}
     <div style="display:flex;gap:6px;margin-top:8px">
      <select class="inp" id="sc-laund" style="flex:1;margin-bottom:0"><option value="">צ\'אט חדש עם מכבסה...</option>${(lnd.laundries||[]).map(l=>`<option value="${esc(l.slug)}">${esc(l.name)}</option>`).join('')}</select>
      <button class="btn2" data-act="scNewChat" style="flex-shrink:0">פתיחה</button></div>
    </div></div>`;
   }catch(e){}
   return html+card;
  };
 }

 /* --- לקוח: כפתור בדף ההזמנה --- */
 if(typeof window.vOrder==='function'){
  const origOd=window.vOrder;
  window.vOrder=async function(id){
   const html=await origOd(id);
   try{
    const d=await api('/orders/'+id);
    if(!d.order||d.order.customer_id!==(state.me&&state.me.id)||!d.order.slug)return html;
    return html+`<div class="body" style="padding-top:0"><button class="btn2" style="width:100%" data-act="scOrder" data-a="${esc(d.order.slug)}" data-b="${esc(id)}">💬 צ\'אט תמיכה עם ${esc(d.order.tenant_name)}</button></div>`;
   }catch(e){return html}
  };
 }

 /* --- מכבסה: לשונית תמיכה בלוח הניהול (wrapper, בלי לגעת בקובץ המשותף) --- */
 function addChip(html,on,href,label){
  if(!html||html.indexOf(href)>=0)return html;
  const i=html.indexOf('<div class="subtabs">');if(i<0)return html;
  const j=html.indexOf('</div>',i);if(j<0)return html;
  return html.slice(0,j)+`<a class="chip ${on?'on':''}" href="${href}">${label}</a>`+html.slice(j);
 }
 if(typeof window.vManage==='function'){
  const origM=window.vManage;
  window.vManage=async function(sub){
   if(sub!=='support')return addChip(await origM(sub),false,'#/manage/support','תמיכה 💬');
   const shell=await origM('orders');
   if(typeof shell!=='string'||shell.indexOf('<div class="subtabs">')<0)return shell;
   let body;
   try{
    const m=(state.memberships||[]).find(x=>x.slug===store.get('lastTenant',''))||(state.memberships||[])[0];
    const d=await L('/t/'+m.slug+'/threads');
    body=`<div class="card"><b>💬 שיחות תמיכה</b>${(d.threads||[]).length?'':'<div class="mut" style="margin-top:4px">אין שיחות מלקוחות עדיין</div>'}</div>`
     +(d.threads||[]).map(t=>`<div class="card lcard" style="cursor:pointer" data-act="scOpenManage" data-a="${t.id}" data-b="${esc(t.customer_name||'לקוח')}">
       <div style="flex:1"><b>${esc(t.customer_name||'לקוח')}</b>${t.status!=='open'?' <span class="mut">(סגור)</span>':''}${t.order_id?' <span class="mut">· על הזמנה</span>':''}
       <div class="mut">${t.last_ts?fmtDT(t.last_ts)+' · ':''}${t.last_body?esc(String(t.last_body).slice(0,60)):''}</div>
       ${t.admin_viewed_at?`<div class="mut" style="font-size:10px">👁 מנהל צפה ${fmtDT(t.admin_viewed_at)}</div>`:''}</div>
       ${t.unread?`<span class="tag tb">${t.unread}</span>`:'<span style="color:#8a99a3">‹</span>'}</div>`).join('');
   }catch(e){body=`<div class="card mut">לא ניתן לטעון שיחות כרגע</div>`}
   const html=addChip(shell,true,'#/manage/support','תמיכה 💬');
   const i=html.indexOf('<div class="subtabs">'),j=html.indexOf('</div>',i);
   return html.slice(0,j+6)+body+'</div>';
  };
 }

 /* --- אדמין: לשונית תמיכה (צפייה מתועדת בלבד) --- */
 if(typeof window.vAdmin==='function'){
  const origA=window.vAdmin;
  window.vAdmin=async function(sub){
   if(sub!=='support')return addChip(await origA(sub),false,'#/admin/support','תמיכה 💬');
   const shell=await origA('audit');
   if(typeof shell!=='string'||shell.indexOf('<div class="subtabs">')<0)return shell;
   let body;
   try{
    const d=await L('/admin/threads');
    body=`<div class="card"><b>💬 שיחות תמיכה — כל המכבסות</b><div class="mut" style="margin-top:4px">פתיחת שיחה מתועדת כ"צפיית מנהל" וגלויה ללקוח ולמכבסה. צפייה בלבד.</div></div>`
     +(d.threads||[]).map(t=>`<div class="card lcard" style="cursor:pointer" data-act="scOpenAdmin" data-a="${t.id}" data-b="${esc(t.tenant_name)} · ${esc(t.customer_name||'לקוח')}">
       <div style="flex:1"><b>${esc(t.tenant_name)}</b> · ${esc(t.customer_name||'לקוח')}${t.status!=='open'?' <span class="mut">(סגור)</span>':''}
       <div class="mut">${t.last_ts?fmtDT(t.last_ts)+' · ':''}${t.last_body?esc(String(t.last_body).slice(0,60)):''}</div></div>
       ${t.admin_viewed_at?'<span class="tag tg">נצפה</span>':'<span style="color:#8a99a3">‹</span>'}</div>`).join('')||'';
   }catch(e){body=`<div class="card mut">לא ניתן לטעון שיחות כרגע</div>`}
   const html=addChip(shell,true,'#/admin/support','תמיכה 💬');
   const i=html.indexOf('<div class="subtabs">'),j=html.indexOf('</div>',i);
   return html.slice(0,j+6)+body+'</div>';
  };
 }
})();
