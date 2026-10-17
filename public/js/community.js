/* ---- E6: קהילת מכבסות (B2B) ---- */
const FORUM_CATS=[['operations','תפעול'],['suppliers','ספקים'],['group_purchase','רכש משותף'],['pricing','תמחור']];
const CONTENT_CATS={article:'מאמר',guide:'מדריך',standard:'תקן',news:'חדשות'};
async function vCommunity(sub,id){
 if(!state.token)return needLogin();
 sub=sub||'forum';
 const tabs=[['forum','פורום'],['tenders','מכרזים'],['groups','רכש משותף'],['capacity','קיבולת'],['content','תוכן']];
 let body='';
 try{
 if(sub==='forum'){
  const cat=new URLSearchParams(location.hash.split('?')[1]||'').get('cat')||'';
  const d=await api('/community/forum/posts'+(cat?'?category='+cat:''));
  body=`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px"><a class="chip ${!cat?'on':''}" href="#/community/forum">הכל</a>${FORUM_CATS.map(c=>`<a class="chip ${cat===c[0]?'on':''}" href="#/community/forum?cat=${c[0]}">${c[1]}</a>`).join('')}
   <button class="btn2 on" style="margin-right:auto" data-act="forumNewPost">+ פוסט חדש</button></div>
  ${d.posts.map(p=>`<a href="#/community/post/${p.id}" style="text-decoration:none;color:inherit"><div class="card">
    <b>${esc(p.title)}</b> <span class="tag tb">${(FORUM_CATS.find(c=>c[0]===p.category)||['',''])[1]}</span>
    <div class="mut">${esc(p.excerpt)}${p.excerpt&&p.excerpt.length>=200?'…':''}</div>
    <div class="mut">${esc(p.author_name||'')} · <b>${esc(p.tenant_name)}</b> ✓ · ${fmtDate(p.created_at)} · 👍 ${p.useful} · 💬 ${p.comments}</div></div></a>`).join('')||'<div class="card mut">אין פוסטים עדיין — היו הראשונים לשתף</div>'}`;
 } else if(sub==='post'){
  const d=await api('/community/forum/posts/'+id);
  const p=d.post;
  body=`<a href="#/community/forum" style="color:#0e7a8a">← חזרה לפורום</a>
  <div class="card"><b style="font-size:17px">${esc(p.title)}</b> <span class="tag tb">${(FORUM_CATS.find(c=>c[0]===p.category)||['',''])[1]}</span>
   <div class="mut">${esc(p.author_name||'')} · <b>${esc(p.tenant_name)}</b> ✓ · ${fmtDT(p.created_at)}</div>
   <div style="margin:10px 0;white-space:pre-wrap">${esc(p.body)}</div>
   <button class="btn2" data-act="forumUseful" data-a="${p.id}">👍 שימושי (${p.useful})${p.voted?' ✓':''}</button></div>
  <div class="sec">תגובות (${d.comments.length})</div>
  ${d.comments.map(c=>`<div class="card"><div class="mut"><b>${esc(c.author_name||'')}</b> · ${esc(c.tenant_name)} ✓ · ${fmtDT(c.created_at)}</div><div style="white-space:pre-wrap">${esc(c.body)}</div></div>`).join('')}
  <div class="card"><input class="inp" id="fc-body" placeholder="כתבו תגובה…"><button class="btn2 on" data-act="forumComment" data-a="${p.id}">פרסום תגובה</button></div>`;
 } else if(sub==='tenders'){
  const d=await api('/community/tenders');
  body=`<button class="btn2 on" data-act="tenderNew">+ פרסום מכרז</button>
  ${d.tenders.map(t=>`<a href="#/community/tender/${t.id}" style="text-decoration:none;color:inherit"><div class="card">
    <b>${esc(t.title)}</b> <span class="tag ${t.status==='open'?'tg':t.status==='awarded'?'tb':'ta'}">${t.status==='open'?'פתוח':t.status==='awarded'?'נבחר זוכה':'סגור'}</span>
    <div class="mut">${esc(t.poster_name)}${t.volume_kg?' · '+t.volume_kg+' ק"ג':''}${t.frequency?' · '+esc(t.frequency):''}${t.budget?' · תקציב ₪'+t.budget:''} · הגשה עד ${fmtDT(t.deadline)} · ${t.bids} הצעות</div></div></a>`).join('')||'<div class="card mut">אין מכרזים</div>'}`;
 } else if(sub==='tender'){
  const d=await api('/community/tender/'+id);
  const t=d.tender;
  body=`<a href="#/community/tenders" style="color:#0e7a8a">← חזרה למכרזים</a>
  <div class="card"><b style="font-size:17px">${esc(t.title)}</b> <span class="tag ${t.status==='open'?'tg':'ta'}">${t.status==='open'?'פתוח':t.status==='awarded'?'נבחר זוכה':'סגור'}</span>
   <div class="mut">${esc(t.poster_name)} · הגשה עד ${fmtDT(t.deadline)}</div>
   ${t.description?`<div style="margin:8px 0;white-space:pre-wrap">${esc(t.description)}</div>`:''}
   <div class="mut">${[t.volume_kg&&'נפח '+t.volume_kg+' ק"ג',t.frequency,t.sla_text&&'SLA: '+t.sla_text,t.budget&&'תקציב ₪'+t.budget].filter(Boolean).map(esc).join(' · ')}</div></div>
  <div class="sec">הצעות (${d.bids_count})</div>
  ${d.bids.map(b=>`<div class="card"><div class="row"><div><b>₪${b.price_per_kg}</b> לק"ג ${b.is_winner?'<span class="tag tg">זוכה ✓</span>':''}
    <div class="mut">${esc(b.bidder_name)} · ${fmtDT(b.created_at)}${b.notes?' · '+esc(b.notes):''}</div></div>
    ${d.is_poster&&t.status==='open'?`<button class="btn2 green" data-act="tenderAward" data-a="${t.id}" data-b="${b.id}">בחירה כזוכה</button>`:''}</div></div>`).join('')||'<div class="card mut">אין הצעות עדיין</div>'}
  ${!d.is_poster&&t.status==='open'?`<div class="card"><label class="lb">הגשת הצעה — מחיר לק"ג</label>
   <div style="display:flex;gap:6px"><input class="inp" id="tb-price" type="number" step="0.1" placeholder="₪" style="flex:1"><input class="inp" id="tb-notes" placeholder="הערות" style="flex:2"></div>
   <button class="btn2 on" data-act="tenderBid" data-a="${t.id}">הגשת הצעה</button></div>`:''}`;
 } else if(sub==='groups'){
  const d=await api('/community/groups');
  body=`<button class="btn2 on" data-act="groupNew">+ קבוצת רכש חדשה</button>
  ${d.groups.map(g=>`<div class="card"><b>${esc(g.product)}</b> ${g.status!=='open'?'<span class="tag ta">נסגר</span>':g.participants>=g.target_participants?'<span class="tag tg">היעד הושג!</span>':''}
   <div class="mut">${esc(g.creator_name)}${g.supplier?' · ספק: '+esc(g.supplier):''} · מחיר רגיל ₪${g.unit_price} → <b>מחיר קבוצה ₪${g.group_price}</b></div>
   <div class="mut">${g.participants}/${g.target_participants} משתתפים · ${g.total_qty} יח' · חיסכון משוער: <b>₪${Math.round(g.est_savings)}</b> · סגירה ${fmtDate(g.deadline)}</div>
   <div style="display:flex;gap:6px;margin-top:6px">${g.status==='open'?(g.joined?`<button class="btn2" data-act="groupLeave" data-a="${g.id}">עזיבה</button>`:`<input class="inp" id="gq-${g.id}" type="number" value="10" style="width:80px"><button class="btn2 green" data-act="groupJoin" data-a="${g.id}">הצטרפות</button>`):''}</div></div>`).join('')||'<div class="card mut">אין קבוצות רכש</div>'}`;
 } else if(sub==='capacity'){
  const d=await api('/community/capacity');
  body=`<button class="btn2 on" data-act="capacityNew">+ מודעת קיבולת</button>
  ${d.posts.map(p=>`<div class="card"><b>${p.kind==='request'?'מבוקש':'מוצע'}: ${esc(p.equipment)}</b> <span class="tag ${p.status==='open'?'tg':p.status==='engaged'?'tb':'ta'}">${p.status==='open'?'פתוח':p.status==='engaged'?'בהתקשרות':'נסגר'}</span>
   <div class="mut">${esc(p.tenant_name)} (${esc(p.tenant_city||'')})${p.kg_per_day?' · '+p.kg_per_day+' ק"ג/יום':''}${p.days?' · '+p.days+' ימים':''}${p.area?' · '+esc(p.area):''}${p.price?' · ₪'+p.price:''}</div>
   ${p.notes?`<div class="mut">${esc(p.notes)}</div>`:''}
   ${(p.engagements||[]).map(e=>`<div class="mut">התקשרות עם ${esc(e.tenant)} — ${e.status==='done'?`הושלם ✓${e.payment_demo?' · תשלום דמו ₪'+e.payment_demo:''}`:'פעילה'} ${e.status==='active'?`<button class="btn2" data-act="capacityDone" data-a="${e.id}">סימון הושלם + תשלום דמו</button>`:''}</div>`).join('')}
   ${p.status==='open'?`<button class="btn2 green" style="margin-top:6px" data-act="capacityEngage" data-a="${p.id}" data-b="${p.kind}">${p.kind==='request'?'הצעת קיבולת':'בקשת קיבולת'}</button>`:''}</div>`).join('')||'<div class="card mut">אין מודעות קיבולת</div>'}`;
 } else if(sub==='content'){
  const d=await api('/community/content');
  body=(state.me&&state.me.role==='admin'?`<button class="btn2 on" data-act="contentNew">+ פרסום תוכן</button>`:'')+
  `${d.articles.map(a=>`<a href="#/community/article/${a.id}" style="text-decoration:none;color:inherit"><div class="card">
    <b>${esc(a.title)}</b> <span class="tag tb">${CONTENT_CATS[a.category]||a.category}</span>
    <div class="mut">${esc(a.excerpt)}${a.excerpt&&a.excerpt.length>=200?'…':''}</div>
    <div class="mut">${esc(a.author_name||'')} · ${fmtDate(a.created_at)} · 👁 ${a.views}</div></div></a>`).join('')||'<div class="card mut">אין תוכן עדיין</div>'}`;
 } else if(sub==='article'){
  const d=await api('/community/article/'+id);
  body=`<a href="#/community/content" style="color:#0e7a8a">← חזרה לתוכן</a>
  <div class="card"><b style="font-size:17px">${esc(d.article.title)}</b> <span class="tag tb">${CONTENT_CATS[d.article.category]}</span>
   <div class="mut">${esc(d.article.author_name||'')} · ${fmtDate(d.article.created_at)} · 👁 ${d.article.views}</div>
   <div style="margin-top:10px;white-space:pre-wrap">${esc(d.article.body)}</div></div>`;
 }
 }catch(e){
  if(e.status===403)body=`<div class="card mut">הקהילה פתוחה לבעלי מכבסות מאומתים בלבד. <a href="#/join" style="color:#0e7a8a">להצטרפות כמכבסה</a></div>`;
  else throw e;
 }
 return `<div class="hdr"><h2>קהילת המכבסות</h2></div>
 <div class="body">${!['post','tender','article'].includes(sub)?`<div class="subtabs">${tabs.map(t=>`<a class="chip ${sub===t[0]?'on':''}" href="#/community/${t[0]}">${t[1]}</a>`).join('')}</div>`:''}${body}</div>`;
}
async function forumNewPost(){
 const v=await xmodal({title:'פוסט חדש',okText:'פרסום',fields:[{id:'title',label:'כותרת'},{id:'body',label:'תוכן'}]});
 if(!v)return;
 const cat=await xmodal({title:'קטגוריה',body:'כתבו: operations / suppliers / group_purchase / pricing',okText:'פרסום',fields:[{id:'cat',label:'קטגוריה',value:'suppliers'}]});
 if(!cat)return;
 try{const r=await api('/community/forum/posts',{method:'POST',body:JSON.stringify({category:cat.cat,title:v.title,body:v.body})});toast('הפוסט פורסם');go('#/community/post/'+r.post.id);route()}catch(e){toast(e.message)}
}
async function forumComment(id){try{await api('/community/forum/posts/'+id+'/comments',{method:'POST',body:JSON.stringify({body:$('#fc-body').value})});route()}catch(e){toast(e.message)}}
async function forumUseful(id){try{await api('/community/forum/posts/'+id+'/useful',{method:'POST',body:'{}'});route()}catch(e){toast(e.message)}}
async function tenderNew(){
 const v=await xmodal({title:'פרסום מכרז',okText:'פרסום',fields:[{id:'title',label:'כותרת'},{id:'volume_kg',label:'נפח ק"ג',type:'number'},{id:'frequency',label:'תדירות (שבועי/חודשי)'},{id:'budget',label:'תקציב ₪',type:'number'},{id:'days',label:'ימים להגשה',value:'7',type:'number'}]});
 if(!v)return;
 try{await api('/community/tenders',{method:'POST',body:JSON.stringify({title:v.title,volume_kg:v.volume_kg||undefined,frequency:v.frequency||undefined,budget:v.budget||undefined,deadline:new Date(Date.now()+(Number(v.days)||7)*86400e3).toISOString()})});toast('המכרז פורסם');route()}catch(e){toast(e.message)}
}
async function tenderBid(id){try{await api('/community/tenders/'+id+'/bids',{method:'POST',body:JSON.stringify({price_per_kg:$('#tb-price').value,notes:$('#tb-notes').value||undefined})});toast('ההצעה הוגשה');route()}catch(e){toast(e.message)}}
async function tenderAward(tid,bid){if(!await xconfirm('בחירת הזוכה תסגור את המכרז.',{title:'בחירת זוכה',okText:'בחירה'}))return;try{await api('/community/tenders/'+tid+'/award',{method:'POST',body:JSON.stringify({bid_id:bid})});toast('הזוכה נבחר');route()}catch(e){toast(e.message)}}
async function groupNew(){
 const v=await xmodal({title:'קבוצת רכש חדשה',okText:'פתיחה',fields:[{id:'product',label:'מוצר'},{id:'supplier',label:'ספק'},{id:'unit_price',label:'מחיר רגיל ₪',type:'number'},{id:'group_price',label:'מחיר קבוצה ₪',type:'number'},{id:'target',label:'יעד משתתפים',value:'3',type:'number'},{id:'days',label:'ימים לסגירה',value:'7',type:'number'}]});
 if(!v)return;
 try{await api('/community/groups',{method:'POST',body:JSON.stringify({product:v.product,supplier:v.supplier||undefined,unit_price:v.unit_price,group_price:v.group_price,target_participants:v.target||undefined,deadline:new Date(Date.now()+(Number(v.days)||7)*86400e3).toISOString()})});toast('הקבוצה נפתחה');route()}catch(e){toast(e.message)}
}
async function groupJoin(id){try{await api('/community/groups/'+id+'/join',{method:'POST',body:JSON.stringify({qty:$('#gq-'+id).value})});toast('הצטרפת לקבוצה');route()}catch(e){toast(e.message)}}
async function groupLeave(id){try{await api('/community/groups/'+id+'/leave',{method:'POST',body:'{}'});route()}catch(e){toast(e.message)}}
async function capacityNew(){
 const v=await xmodal({title:'מודעת קיבולת',body:'kind: request (מבוקש) / offer (מוצע)',okText:'פרסום',fields:[{id:'kind',label:'סוג',value:'request'},{id:'equipment',label:'ציוד (מכונה 18 ק"ג...)'},{id:'kg_per_day',label:'ק"ג ליום',type:'number'},{id:'days',label:'ימים',type:'number'},{id:'area',label:'אזור'},{id:'price',label:'מחיר ₪',type:'number'}]});
 if(!v)return;
 try{await api('/community/capacity',{method:'POST',body:JSON.stringify({kind:v.kind,equipment:v.equipment,kg_per_day:v.kg_per_day||undefined,days:v.days||undefined,area:v.area||undefined,price:v.price||undefined})});toast('המודעה פורסמה');route()}catch(e){toast(e.message)}
}
async function capacityEngage(id,kind){
 const v=await xmodal({title:kind==='request'?'הצעת קיבולת':'בקשת קיבולת',okText:'התקשרות',fields:[{id:'price',label:'מחיר מוסכם ₪',type:'number'}]});
 if(!v)return;
 try{await api('/community/capacity/'+id+'/engage',{method:'POST',body:JSON.stringify({agreed_price:v.price||undefined})});toast('נוצרה התקשרות');route()}catch(e){toast(e.message)}
}
async function capacityDone(eid){
 const v=await xmodal({title:'סיום התקשרות',body:'התשלום מתועד כדמו בלבד.',okText:'סיום',fields:[{id:'payment',label:'תשלום דמו ₪',type:'number'}]});
 if(!v)return;
 try{await api('/community/capacity/engagements/'+eid+'/done',{method:'POST',body:JSON.stringify({payment_demo:v.payment||undefined})});toast('ההתקשרות הושלמה');route()}catch(e){toast(e.message)}
}
async function contentNew(){
 const v=await xmodal({title:'פרסום תוכן',body:'קטגוריה: article / guide / standard / news',okText:'פרסום',fields:[{id:'category',label:'קטגוריה',value:'article'},{id:'title',label:'כותרת'},{id:'body',label:'תוכן'}]});
 if(!v)return;
 try{await api('/community/content',{method:'POST',body:JSON.stringify({category:v.category,title:v.title,body:v.body})});toast('התוכן פורסם');route()}catch(e){toast(e.message)}
}
async function vManage(sub){
 if(!state.token)return needLogin();
 const me=await api('/auth/me');
 state.memberships=me.memberships||[];save();
 const mems=me.memberships||[];
 const m=mems.find(x=>x.slug===store.get('lastTenant',''))||mems[0];
 const slug=m&&m.slug;
 if(!slug)return `<div class="hdr"><h2>לוח ניהול מכבסה</h2></div><div class="body"><div class="card mut">${me.courier?'החשבון שלך רשום כשליח — לוח הניהול מיועד לבעלי מכבסות. המשימות שלך בלשונית ״שליח״.':`החשבון אינו מקושר למכבסה. <a href="#/join" style="color:#0e7a8a">להצטרפות כמכבסה</a>`}</div></div>`;
 sub=sub||'orders';
 const tabs=[['orders','הזמנות'],['items','מחירון'],['windows','חלונות'],['coupons','קופונים'],['subs','מנויים'],['biz','עסקיים'],['documents','מסמכים'],['issues','תקלות'],['couriers','שליחים'],['customers','לקוחות'],['stats','דוחות'],['settings','הגדרות']];
 let body='';
 if(sub==='orders'){
  const d=await api(`/t/${slug}/orders`);
  const NEXT={new:'confirmed',confirmed:'picked_up',picked_up:'in_work',in_work:'ready',ready:'out_for_delivery',out_for_delivery:'delivered'};
  body=d.orders.map(o=>`<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
     <div><b dir="ltr">#${o.id.slice(0,8)}</b> ${esc(o.customer_name||'')} <span class="st-pill st-${o.status}">${HE[o.status]}</span>
      <div class="mut">${fmtDT(o.created_at)} · ₪${o.total} · ${esc(o.address)}${o.source==='bot'?' · מהבוט':''}</div>
      ${o.items&&o.items.length?`<div class="mut">${o.items.slice(0,3).map(i=>esc(i.name)+' ×'+fmtQ(i.qty)).join(', ')}${o.items.length>3?' +'+(o.items.length-3):''}</div>`:''}
      ${o.pickup_at?`<div class="mut">איסוף: ${fmtDT(o.pickup_at)}</div>`:''}${o.delivery_at?`<div class="mut">החזרה: ${fmtDT(o.delivery_at)}</div>`:''}
      ${o.payment_method==='cash'&&o.payment_status==='pending'?'<div class="mut">💵 גבייה במזומן</div>':''}
      ${o.delivery_confirmation?`<div class="mut">✅ אושרה מסירה (${o.delivery_confirmation.method==='code'?'קוד לקוח':'צילום'}) · ${fmtDT(o.delivery_confirmation.at)}${o.delivery_confirmation.has_photo?` · <a href="/api/delivery-confirmations/${o.delivery_confirmation.id}/photo" target="_blank" style="color:#0e7a8a">צילום אישור</a>`:''}</div>`:''}
     </div>
     <div style="display:flex;gap:6px">
      ${NEXT[o.status]?`<button class="btn2 on" data-act="setStatus" data-a="${slug}" data-b="${o.id}" data-c="${NEXT[o.status]}">העבר ל״${HE[NEXT[o.status]]}״</button>`:''}
      ${!['delivered','cancelled'].includes(o.status)?`<button class="btn2" data-act="setStatus" data-a="${slug}" data-b="${o.id}" data-c="cancelled">ביטול</button>`:''}
      ${['new','confirmed','ready'].includes(o.status)?(o.courier_id?'<span class="tag tg">שובץ שליח</span>':o.has_open_offer?'<span class="tag tb">ממתין לאישור שליח</span>':`<button class="btn2" data-act="assignCourier" data-a="${slug}" data-b="${o.id}">שיבוץ שליח</button>`):''}
     </div>
    </div></div>`).join('')||'<div class="card mut">אין הזמנות</div>';
 } else if(sub==='issues'){
  // E9.T1: פניות תקלות מלקוחות — טיפול מול המכבסה + הסלמה לגישור אדמין
  const d=await api(`/t/${slug}/issues`);
  const KIND={damage:'נזק',missing:'חסר',late:'איחור',other:'אחר'};
  const STI={open:'פתוח',in_progress:'בטיפול',resolved:'טופל'};
  body=d.issues.map(i=>`<div class="card">
   <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:6px">
    <div><b>${KIND[i.kind]||i.kind}</b> <span class="st-pill ${i.status==='resolved'?'st-delivered':'st-new'}">${STI[i.status]||i.status}</span>${i.mediation?' <span class="tag ta">בגישור אדמין</span>':''}
     <div>${esc(i.text)}</div>
     <div class="mut">${esc(i.customer_name||'')} · הזמנה <span dir="ltr">#${(i.order_id||'').slice(0,8)}</span> · ${esc(i.order_address||'')} · ${fmtDT(i.created_at)}</div>
     ${i.resolution_note?`<div class="mut">תיעוד: ${esc(i.resolution_note)}</div>`:''}
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
     ${(i.photo_ids||[]).map(pid=>`<button class="btn2" data-act="openIssuePhoto" data-a="${pid}">📷</button>`).join('')}
     ${i.status!=='resolved'?`<button class="btn2 on" data-act="tenantIssueHandle" data-a="${slug}" data-b="${i.id}">עדכון טיפול</button>`:''}
    </div>
   </div></div>`).join('')||'<div class="card mut">אין פניות תקלות ✓</div>';
 } else if(sub==='items'){
  const d=await api(`/t/${slug}/items`);
  body=`<div class="card">
    <label class="lb">פריט חדש</label>
    <input class="inp" id="it-name" placeholder="שם הפריט">
    <div style="display:flex;gap:8px"><input class="inp" id="it-price" type="number" placeholder="מחיר ₪" style="flex:1">
    <select class="inp" id="it-unit" style="flex:1"><option value="item">ליחידה</option><option value="kg">לק״ג</option><option value="bag">לשק</option></select>
    <select class="inp" id="it-cat" style="flex:1"><option>כביסה</option><option>ניקוי יבש</option><option>גיהוץ</option><option>שטיחים</option><option>אחר</option></select></div>
    <button class="btn2 on" data-act="addItem" data-a="${slug}">הוספה</button></div>
   <div class="card">${d.items.map(i=>`<div class="row"><div style="${i.active?'':'opacity:.4'}">${esc(i.name)}<div class="mut">${esc(i.category)} · ${i.unit==='item'?'ליחידה':'ל'+unitLbl(i.unit)}</div></div>
    <div>₪${i.price} <button class="btn2" ${i.subscription_eligible?'style="border-color:#0e7a8a;color:#0e7a8a"':''} title="פריט מכוסה במנוי" data-act="toggleItemSub" data-a="${slug}" data-b="${i.id}" data-c="${!i.subscription_eligible}">${i.subscription_eligible?'✓ במנוי':'למנוי'}</button> <button class="btn2" data-act="editItem" data-a="${slug}" data-b="${i.id}" data-name="${esc(i.name)}" data-price="${i.price}">עריכה</button> <button class="btn2" data-act="delItem" data-a="${slug}" data-b="${i.id}">${i.active?'הסתרה':'החזרה'}</button></div></div>`).join('')}</div>`;
 } else if(sub==='windows'){
  const d=await api(`/t/${slug}/windows`);
  body=`<div class="card">
    <label class="lb">חלון חדש</label>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
     <select class="inp" id="w-day" style="flex:1 1 100%">${WD.map((d,i)=>`<option value="${i}">${d}</option>`).join('')}</select>
     <input class="inp" id="w-start" type="time" style="flex:1 1 40%;min-width:120px"><input class="inp" id="w-end" type="time" style="flex:1 1 40%;min-width:120px">
     <select class="inp" id="w-kind" style="flex:1 1 100%"><option value="pickup">איסוף</option><option value="delivery">החזרה</option></select>
    </div>
    <button class="btn2 on" data-act="addWindow" data-a="${slug}" style="min-height:44px">הוספה</button></div>
   <div class="card">${d.windows.map(w=>`<div class="row"><div>${WD[w.weekday]} <span dir="ltr">${w.start_time.slice(0,5)}–${w.end_time.slice(0,5)}</span><div class="mut">${w.kind==='pickup'?'איסוף':'החזרה'} · קיבולת ${w.capacity}</div></div><button class="btn2" data-act="delWindow" data-a="${slug}" data-b="${w.id}">מחיקה</button></div>`).join('')}</div>`;
 } else if(sub==='coupons'){
  const d=await api(`/t/${slug}/coupons`);
  body=`<div class="card">
    <label class="lb">קופון חדש</label>
    <div style="display:flex;gap:8px"><input class="inp" id="cp-code" placeholder="קוד (למשל SAVE10)" style="flex:2">
    <select class="inp" id="cp-kind" style="flex:1"><option value="percent">אחוז %</option><option value="amount">סכום ₪</option></select>
    <input class="inp" id="cp-value" type="number" placeholder="ערך" style="flex:1"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
     <input class="inp" id="cp-min" type="number" placeholder="מינימום הזמנה ₪" style="flex:1">
     <input class="inp" id="cp-usage" type="number" placeholder="מגבלת שימושים" style="flex:1">
     <input class="inp" id="cp-peruser" type="number" placeholder="מגבלה ללקוח" style="flex:1">
     <input class="inp" id="cp-exp" type="date" style="flex:1">
    </div>
    <button class="btn2 on" data-act="addCoupon" data-a="${slug}">יצירת קופון</button></div>
   <div class="card">${d.coupons.map(c=>`<div class="row"><div style="${c.active?'':'opacity:.4'}"><b dir="ltr">${esc(c.code)}</b> — ${c.kind==='percent'?c.value+'%':'₪'+c.value}
    <div class="mut">${c.min_order>0?'מינימום ₪'+c.min_order+' · ':''}${c.usage_limit?'עד '+c.usage_limit+' שימושים · ':''}${c.per_user_limit?c.per_user_limit+' ללקוח · ':''}${c.expires_at?'בתוקף עד '+new Date(c.expires_at).toLocaleDateString('he-IL')+' · ':''}מומש ${c.used_count||0}</div></div>
    <button class="btn2" data-act="toggleCoupon" data-a="${slug}" data-b="${c.id}" data-c="${!c.active}">${c.active?'השבתה':'הפעלה'}</button></div>`).join('')||'<div class="mut">אין קופונים עדיין</div>'}</div>`;
 } else if(sub==='subs'){
  const d=await api(`/t/${slug}/plans`);
  const sb=await api(`/t/${slug}/subscriptions`);
  const act=sb.subscriptions.filter(x=>x.status==='active');
  const mrr=act.reduce((sm,x)=>sm+Number(x.plan_price),0);
  body=`<div class="kpis"><div class="kpi"><b>${act.length}</b>מנויים פעילים</div><div class="kpi"><b>₪${mrr}</b>הכנסה חוזרת חודשית</div></div>
  <div class="card"><label class="lb">תוכנית מנוי חדשה</label>
   <input class="inp" id="pl-name" placeholder="שם התוכנית (למשל מנוי משפחתי)">
   <div style="display:flex;gap:8px;flex-wrap:wrap">
    <input class="inp" id="pl-bags" type="number" placeholder="שקים בחודש" style="flex:1" min="1">
    <input class="inp" id="pl-kg" type="number" placeholder="ק״ג לשק" style="flex:1" min="1">
    <input class="inp" id="pl-price" type="number" placeholder="מחיר ₪/חודש" style="flex:1" min="0">
    <input class="inp" id="pl-extra" type="number" placeholder="שק חורג ₪ (רשות)" style="flex:1" min="0">
   </div>
   <input class="inp" id="pl-perks" placeholder="הטבות (טקסט חופשי, רשות)">
   <button class="btn2 on" data-act="addPlan" data-a="${slug}">יצירת תוכנית</button></div>
  <div class="sec">תוכניות (${d.plans.length})</div>
  <div class="card">${d.plans.map(p=>`<div class="row"><div style="${p.active?'':'opacity:.4'}"><b>${esc(p.name)}</b> — ₪${p.price}/חודש
    <div class="mut">${p.bags_per_month} שקים · ${fmtQ(p.kg_per_bag)} ק״ג לשק${p.extra_bag_price?' · שק חורג ₪'+p.extra_bag_price:''}${p.perks?' · '+esc(p.perks):''} · ${p.active_subs} מנויים פעילים</div></div>
    <button class="btn2" data-act="togglePlan" data-a="${slug}" data-b="${p.id}" data-c="${!p.active}">${p.active?'השבתה':'הפעלה'}</button></div>`).join('')||'<div class="mut">אין תוכניות מנוי עדיין</div>'}</div>
  <div class="sec">מנויים (${sb.subscriptions.length})</div>
  <div class="card">${sb.subscriptions.map(x=>`<div class="row"><div><b>${esc(x.customer_name||'')}</b> · ${esc(x.plan_name)} ${x.status==='paused'?'<span class="tag tb">מושהה</span>':''}
    <div class="mut"><span dir="ltr">${esc(x.customer_phone||'')}</span> · נוצלו ${fmtQ(x.bags_used)}/${x.bags_per_month} שקים החודש · מתחדש ${fmtDate(x.period_end)}</div></div><div>₪${x.plan_price}</div></div>`).join('')||'<div class="mut">אין מנויים עדיין — שתפו עם הלקוחות את דף המכבסה</div>'}</div>`;
 } else if(sub==='biz'){
  body=await vManageBiz(slug);
 } else if(sub==='documents'){
  const d=await api(`/t/${slug}/documents`);
  const ST_HE={issued:'הופק',partially_credited:'זוכה חלקית',credited:'זוכה'};
  const consBtn=`<button class="btn2 on" style="margin-bottom:10px" data-act="consolidatedModal" data-a="${slug}">🧾 הפק חשבונית מרכזת</button>`;
  body=consBtn+(d.documents.length?`<div class="card docs-list">${d.documents.map(dc=>`<div class="row"><div>
    <b>${dc.kind_he} ${dc.doc_number}/${dc.doc_year}</b> <span class="st-pill ${dc.status==='credited'?'st-cancelled':'st-delivered'}">${ST_HE[dc.status]||dc.status}</span>
    <div class="mut">${fmtDT(dc.issued_at)} · ${esc(dc.customer_name||'לקוח')} · ₪${dc.total}${dc.orders_count?' · מכסה '+dc.orders_count+' הזמנות':''}${Number(dc.credited_amount)>0?' · זוכה ₪'+dc.credited_amount:''}${dc.allocation_number?' · הקצאה '+dc.allocation_number:''}</div></div>
    <div class="docs-actions">
     <button class="btn2" data-act="openPdf" data-a="/t/${slug}/documents/${dc.id}/pdf">מקור</button>
     <button class="btn2" data-act="openPdf" data-a="/t/${slug}/documents/${dc.id}/pdf?copy=1">העתק</button>
     ${dc.kind!=='credit'&&dc.status!=='credited'?`<button class="btn2" style="border-color:#f3c2c2;color:#c22" data-act="creditDoc" data-a="${slug}" data-b="${dc.id}" data-c="${dc.total}" data-d="${dc.credited_amount}">זיכוי</button>`:''}
    </div></div>`).join('')}</div>`
   :'<div class="card mut">אין מסמכים עדיין — בהתאם להגדרות, מסמכים מונפקים אוטומטית בסיום הזמנה או מרוכזים ידנית בחשבונית מרכזת.</div>');
 } else if(sub==='couriers'){
  const d=await api(`/t/${slug}/couriers/overview`);
  const est=d.estimate;
  body=`<div class="card"><b>עלות משוערת לשיבוץ</b><div class="mut">₪${est.rate_per_stop} לנקודה × ${est.stops_per_order} נקודות (איסוף+מסירה) = <b>₪${est.per_order}</b> להזמנה · עמלת הפלטפורמה ${est.platform_commission_pct}% מחושבת לשליח, לא למכבסה</div></div>
  ${d.today.length?`<div class="sec">שיבוץ פעיל (${d.today.length})</div>`+d.today.map(o=>`<div class="card"><b>${esc(o.courier_name)}</b> ← הזמנה <span dir="ltr">#${o.id.slice(0,8)}</span> <span class="st-pill st-${o.status}">${HE[o.status]}</span>
    <div class="mut">${esc(o.customer_name||'')} · ${esc(o.address)}${o.pickup_at?' · איסוף '+fmtDT(o.pickup_at):''}</div></div>`).join(''):''}
  <div class="sec">שליחים (${d.couriers.length})</div>
  ${d.couriers.map(c=>{const onPct=c.pickups_30d?Math.round(100*c.ontime_30d/c.pickups_30d):null;return `<div class="card"><div class="row"><div><b>${esc(c.name)}</b> <span class="tag tb">${c.model==='platform'?'פלטפורמה':c.model==='shared'?'משותף':'פרטי'}</span>
    <div class="mut"><span dir="ltr">${esc(c.phone||'')}</span> · ${esc(c.vehicle||'')}${c.areas&&c.areas.length?' · '+(c.areas||[]).map(esc).join(', '):''}</div>
    <div class="mut">30 יום: ${c.delivered_30d} מסירות${onPct!==null?` · ${onPct}% איסוף בזמן (${c.ontime_30d}/${c.pickups_30d})`:''} · ★${c.rating||'—'}${c.rating_count?' ('+c.rating_count+')':''} · ${c.active_orders} פעילות</div></div>
    <button class="btn2" data-act="tenantRateCourier" data-a="${slug}" data-b="${c.id}" data-c="${esc(c.name)}">דירוג</button></div></div>`}).join('')||'<div class="card mut">אין שליחים זמינים</div>'}
  ${d.clusters&&d.clusters.length?`<div class="card"><div class="sec">קלאסטרים אזוריים (מסלולים משותפים קבועים)</div>
   ${d.clusters.map(cl=>`<div class="row"><div><b>${esc(cl.name)}</b> · ${esc(cl.area)}<div class="mut">${cl.members} מכבסות · דמי ניהול חודשיים (דמו): ₪${cl.mgmt_fee_monthly}${cl.fixed_routes&&cl.fixed_routes.length?' · מסלול קבוע: '+cl.fixed_routes.map(f=>WD[f.weekday]+' — '+esc(f.courier)).join(', '):''}</div></div>
    <button class="btn2 ${cl.joined?'':'green'}" data-act="tenantCluster" data-a="${slug}" data-b="${cl.id}" data-c="${cl.joined?'leave':'join'}">${cl.joined?'עזיבה':'הצטרפות'}</button></div>`).join('')}</div>`:''}
  ${d.payments.length?`<div class="card"><div class="sec">היסטוריית תשלומים לשליחים (דרך הפלטפורמה)</div><table class="tbl"><tr><th>שבוע</th><th>נקודות</th><th>ברוטו</th><th>עמלת פלטפורמה</th><th>סטטוס</th></tr>
   ${d.payments.map(x=>`<tr><td>${fmtDate(x.week_start)}</td><td>${x.stops}</td><td>₪${x.gross}</td><td>₪${x.commission}</td><td>${x.statuses.includes('paid_demo')?'שולם (דמו)':x.statuses.includes('disputed')?'במחלוקת':'נצבר'}</td></tr>`).join('')}</table></div>`:''}`;
 } else if(sub==='customers'){
  const d=await api(`/t/${slug}/customers`);
  body=`<div class="card"><table class="tbl"><tr><th>לקוח</th><th>הזמנות</th><th>₪</th><th>נקודות</th></tr>
   ${d.customers.map(c=>`<tr><td>${esc(c.name||'') }<div class="mut" dir="ltr">${esc(c.phone||'')}</div></td><td>${c.orders}</td><td>${c.spent}</td><td>${c.points}</td></tr>`).join('')}</table></div>`;
 } else if(sub==='stats'){
  const d=await api(`/t/${slug}/reports`);
  const maxRev=Math.max(1,...d.weekly.map(w=>Number(w.revenue)));
  const CH={app:'אפליקציה',bot:'בוט וואטסאפ'};
  body=`<div class="kpis">
    <div class="kpi"><b>₪${d.totals.revenue}</b>מחזור</div>
    <div class="kpi"><b>${d.totals.orders}</b>הזמנות</div>
    <div class="kpi"><b>₪${d.totals.avg_order}</b>ממוצע</div>
    <div class="kpi"><b>${d.customers.returning}/${d.customers.customers}</b>חוזרים</div>
    ${d.subscriptions?`<div class="kpi"><b>${d.subscriptions.active}</b>מנויים פעילים</div>
    <div class="kpi"><b>₪${d.subscriptions.mrr}</b>הכנסה חוזרת</div>`:''}</div>
   <div class="card"><b>הכנסות שבועיות (8 שבועות)</b>
    ${d.weekly.length?`<div style="display:flex;align-items:flex-end;gap:6px;height:110px;margin-top:12px;direction:ltr">${d.weekly.map(w=>`<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%"><div class="mut" style="font-size:10px">₪${Math.round(w.revenue)}</div><div style="width:70%;background:linear-gradient(180deg,#12869b,#0a4f5c);border-radius:6px 6px 0 0;height:${Math.max(4,Math.round(Number(w.revenue)/maxRev*82))}%"></div><div class="mut" style="font-size:10px;margin-top:3px">${new Date(w.week).toLocaleDateString('he-IL',{day:'numeric',month:'numeric',timeZone:'Asia/Jerusalem'})}</div></div>`).join('')}</div>`:'<div class="mut" style="margin-top:8px">אין עדיין נתונים לגרף</div>'}
   </div>
   <div class="card"><b>פילוח ערוצים</b>
    ${d.channels.map(c=>{const pct=d.totals.orders?Math.round(c.orders/d.totals.orders*100):0;return `<div style="margin-top:8px"><div class="row" style="border:none;padding:0"><div>${CH[c.source]||c.source}</div><div class="mut">${c.orders} הזמנות · ₪${c.revenue} · ${pct}%</div></div><div class="bar-wrap"><div class="bar-fill" style="width:${pct}%"></div></div></div>`}).join('')||'<div class="mut">אין נתונים</div>'}
   </div>
   ${d.commission?`<div class="card"><b>עמלה משוערת לפי מקור לקוח</b>
    <div class="row"><div>לקוחות שלך (מהדף הממותג)</div><div>${d.commission.own.orders} הזמנות · ₪${d.commission.own.revenue} · עמלה ${d.commission.own.commission_pct}% ≈ ₪${d.commission.own.commission_est}</div></div>
    <div class="row"><div>לקוחות מרקטפלייס</div><div>${d.commission.marketplace.orders} הזמנות · ₪${d.commission.marketplace.revenue} · עמלה ${d.commission.marketplace.commission_pct}% ≈ ₪${d.commission.marketplace.commission_est}</div></div></div>`:''}
   <div class="card"><b>פריטים מובילים</b>${d.topItems.map(t=>`<div class="row"><div>${esc(t.name)}</div><div>${t.qty} · ₪${t.revenue}</div></div>`).join('')||'<div class="mut">אין נתונים</div>'}</div>
   <div class="card"><b>ייצוא (Excel)</b>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
     <button class="btn2" data-act="downloadCsv" data-a="/t/${slug}/export/orders.csv" data-b="orders.csv">הזמנות CSV</button>
     <button class="btn2" data-act="downloadCsv" data-a="/t/${slug}/export/customers.csv" data-b="customers.csv">לקוחות CSV</button>
     <button class="btn2" data-act="downloadCsv" data-a="/t/${slug}/export/courier-payments.csv" data-b="courier-payments.csv">תשלומי שליחים CSV</button>
    </div></div>`;
 } else if(sub==='settings'){
  const d=await api('/laundries/'+slug);
  const l=d.laundry;
  try{const td=await api(`/t/${slug}/settings`);if(td.tenant){l.dealer_type=td.tenant.dealer_type;l.dealer_id=td.tenant.dealer_id;l.invoice_mode=td.tenant.invoice_mode||'per_order'}}catch(e){}
  body=`<div class="card">
   <label class="lb">שם</label><input class="inp" id="s-name" value="${esc(l.name)}">
   <label class="lb">טלפון</label><input class="inp" id="s-phone" value="${esc(l.phone||'')}" dir="ltr" style="text-align:right">
   <label class="lb">כתובת</label><input class="inp" id="s-address" value="${esc(l.address||'')}">
   <label class="lb">עיר</label><input class="inp" id="s-city" value="${esc(l.city||'')}">
   <label class="lb">דמי שליחות ₪</label><input class="inp" id="s-fee" type="number" value="${l.delivery_fee||0}">
   <label class="lb">מינימום הזמנה ₪</label><input class="inp" id="s-min" type="number" value="${l.min_order||0}">
   <label style="font-size:13px;display:block;margin:8px 0"><input type="checkbox" id="s-open" ${l.is_open?'checked':''}> המכבסה פתוחה להזמנות</label>
   <div style="border-top:1px solid #e3edf0;margin-top:10px;padding-top:8px"><b>חשבוניות (דמו)</b>
   <div class="mut" style="margin:4px 0">המסמכים מסומנים ״מסמך דמו״ עד לרישום התוכנה ברשות המסים. בלי סוג עוסק לא יונפקו מסמכים.</div>
   <label class="lb">סוג עוסק</label><select class="inp" id="s-dealer-type"><option value="">לא הוגדר — לא יונפקו מסמכים</option><option value="patur" ${l.dealer_type==='patur'?'selected':''}>עוסק פטור — מונפקת קבלה</option><option value="morasha" ${l.dealer_type==='morasha'?'selected':''}>עוסק מורשה — חשבונית עסקה + קבלה</option></select>
   <label class="lb">אופן הפקת מסמכים</label><select class="inp" id="s-invoice-mode"><option value="per_order" ${l.invoice_mode!=='consolidated'?'selected':''}>מסמך לכל הזמנה — אוטומטי בסיום הזמנה</option><option value="consolidated" ${l.invoice_mode==='consolidated'?'selected':''}>חשבונית מרכזת — הפקה ידנית מרוכזת בלשונית מסמכים</option></select>
   <label class="lb">ח.פ/ע.מ (9 ספרות)</label><input class="inp" id="s-dealer-id" value="${esc(l.dealer_id||'')}" maxlength="9" inputmode="numeric" placeholder="למשל 512345678">
   </div>
   <div style="border-top:1px solid #e3edf0;margin-top:10px;padding-top:8px"><b>מיתוג הדף העסקי (White Label)</b>
   <div class="mut" style="margin:4px 0">הדף הממותג: <a href="/b/${slug}" target="_blank" style="color:#0e7a8a" dir="ltr">/b/${slug}</a> · <a href="/api/laundries/${slug}/card" target="_blank" style="color:#0e7a8a">כרטיס QR להדפסה</a></div>
   <label class="lb">צבע מותג</label><input class="inp" id="s-color" type="color" value="${cssColor(l.color)}" style="height:44px;padding:4px">
   <label class="lb">סלוגן</label><input class="inp" id="s-slogan" value="${esc(l.slogan||'')}">
   <label class="lb">וואטסאפ עסקי</label><input class="inp" id="s-wa" value="${esc(l.whatsapp||'')}" dir="ltr">
   <label class="lb">לוגו (PNG/JPG/WebP עד 2MB)</label>
   ${l.has_logo?`<div style="margin-bottom:6px"><img src="/api/laundries/${slug}/logo" style="height:48px;border:1px solid #e2eaee;border-radius:8px;padding:4px;background:#fff"> <button class="btn2" data-act="delLogo" data-a="${slug}">הסרת לוגו</button></div>`:''}
   <input class="inp" id="s-logo" type="file" accept="image/png,image/jpeg,image/webp">
   <button class="btn2 on" data-act="uploadLogo" data-a="${slug}">העלאת לוגו</button></div>
   <label class="lb">תקנון</label><textarea class="inp" id="s-terms" rows="3">${esc(l.terms||'')}</textarea>
   <button class="btn" data-act="saveSettings" data-a="${slug}">שמירה</button></div>`;
 }
 store.set('lastTenant',slug);
 const switcher=mems.length>1?`<select class="sel" style="margin-top:8px" data-actc="commTenantSwitch">${mems.map(x=>`<option value="${x.slug}" ${x.slug===slug?'selected':''}>${esc(x.name)}</option>`).join('')}</select>`:'';
 return `<div class="hdr"><h2>לוח ניהול — ${esc(m.name)}</h2>${switcher}<a href="#" data-act="logout" style="color:#fff;font-size:12px;opacity:.85">התנתקות</a></div>
 <div class="body"><div class="subtabs">${tabs.map(t=>`<a class="chip ${sub===t[0]?'on':''}" href="#/manage/${t[0]}">${t[1]}</a>`).join('')}</div>${body}</div>`;
}
async function joinPlan(slug,planId){
 if(!state.token)return go('#/login');
 if(!await xconfirm('ההצטרפות כוללת תשלום דמו (ללא סליקה אמיתית). המנוי מתחדש אוטומטית כל חודש עד לביטול.',{title:'הצטרפות למנוי חודשי',okText:'מאשר, הצטרפו'}))return;
 try{await api('/subscriptions/join',{method:'POST',body:JSON.stringify({slug,plan_id:planId})});toast('ברוך הבא! המנוי פעיל');route()}catch(e){toast(e.message)}
}
async function subAct(id,a){try{await api('/subscriptions/'+id+'/'+a,{method:'POST',body:'{}'});toast(a==='pause'?'המנוי הושהה':'המנוי חודש');route()}catch(e){toast(e.message)}}
async function subCancel(id){if(!await xconfirm('המנוי יבוטל והחידוש האוטומטי יופסק. שקים שלא נוצלו לא יועברו.',{title:'ביטול מנוי',okText:'כן, לבטל את המנוי'}))return;try{await api('/subscriptions/'+id+'/cancel',{method:'POST',body:'{}'});toast('המנוי בוטל');route()}catch(e){toast(e.message)}}
async function subUpgrade(id,slug){
 try{
  const d=await api('/subscriptions/plans/'+slug);
  if(!d.plans.length)return toast('אין תוכניות זמינות');
  const p=await new Promise(resolve=>{
   const ov=document.createElement('div');ov.className='modal-ov';
   ov.innerHTML=`<div class="modal" role="dialog" aria-modal="true"><b>שינוי תוכנית</b><div class="mut" style="margin:8px 0">בחרו תוכנית חדשה:</div>${d.plans.map((p,i)=>`<button class="btn2" style="display:block;width:100%;margin:6px 0;text-align:right" data-i="${i}"><b>${esc(p.name)}</b> · ${p.bags_per_month} שקים · ₪${p.price}/חודש</button>`).join('')}<button class="btn2" id="pl-cancel" style="width:100%;margin-top:8px">ביטול</button></div>`;
   document.body.appendChild(ov);
   const done=v=>{ov.remove();resolve(v)};
   ov.querySelectorAll('[data-i]').forEach(b=>b.onclick=()=>done(d.plans[Number(b.dataset.i)]));
   ov.querySelector('#pl-cancel').onclick=()=>done(null);
   ov.onclick=e=>{if(e.target===ov)done(null)};
  });
  if(!p)return;
  await api('/subscriptions/'+id+'/upgrade',{method:'POST',body:JSON.stringify({plan_id:p.id})});
  toast('התוכנית עודכנה');route();
 }catch(e){toast(e.message)}
}
async function subUsage(id){
 try{
  const d=await api('/subscriptions/'+id+'/usage');
  await xmodal({title:'היסטוריית ניצול',okText:'סגור',cancelText:'סגור',body:d.usage.map(u=>`${fmtDT(u.created_at)} — ${Number(u.bags)>0?'ניצול '+fmtQ(u.bags)+' שקים':Number(u.bags)<0?'החזר '+fmtQ(-Number(u.bags))+' שקים':esc(u.note||'')}`).join('<br>')||'אין תנועות'});
 }catch(e){toast(e.message)}
}
async function uploadLogo(slug){
 const f=$('#s-logo').files[0];if(!f)return toast('בחרו קובץ תמונה');
 const fd=new FormData();fd.append('logo',f);
 try{
  const r=await fetch('/api/t/'+slug+'/logo',{method:'POST',headers:{authorization:'Bearer '+state.token},body:fd});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)return toast(j.error||'ההעלאה נכשלה');
  toast('הלוגו עודכן');route();
 }catch(e){toast(e.message)}
}
async function delLogo(slug){try{await api(`/t/${slug}/logo`,{method:'DELETE'});toast('הלוגו הוסר');route()}catch(e){toast(e.message)}}
async function addPlan(slug){try{await api(`/t/${slug}/plans`,{method:'POST',body:JSON.stringify({name:$('#pl-name').value,bags_per_month:$('#pl-bags').value,kg_per_bag:$('#pl-kg').value||8,price:$('#pl-price').value,extra_bag_price:$('#pl-extra').value,perks:$('#pl-perks').value})});toast('התוכנית נוצרה');route()}catch(e){toast(e.message)}}
async function togglePlan(slug,id,active){try{await api(`/t/${slug}/plans/${id}`,{method:'PATCH',body:JSON.stringify({active})});route()}catch(e){toast(e.message)}}
async function toggleItemSub(slug,id,on){try{await api(`/t/${slug}/items/${id}`,{method:'PATCH',body:JSON.stringify({subscription_eligible:on})});route()}catch(e){toast(e.message)}}
// N9: נעילת הזמנה בזמן מעבר סטטוס — לחיצה כפולה/מהירה לא שולחת POST נוסף על אותה הזמנה עד התגובה
const _statusLocks=new Set();
async function setStatus(slug,id,st,btn){
 if(_statusLocks.has(id))return;
 if(st==='cancelled'&&!await xconfirm('הלקוח יקבל עדכון על הביטול.',{title:'ביטול הזמנה',okText:'כן, לבטל'}))return;
 _statusLocks.add(id);
 if(btn){btn.disabled=true;btn.style.opacity='.6';}
 try{
  await api(`/t/${slug}/orders/${id}/status`,{method:'POST',body:JSON.stringify({status:st})});
  route();
 }catch(e){
  // 409 "ברצף" = הכפתור נבנה מסטטוס מיושן (re-render/לחיצה חוזרת) — רענון שקט במקום טוסט מבלבל
  if(e.status===409&&e.message==='מעבר סטטוס חייב להיות לשלב הבא ברצף'){route();return}
  if(btn){btn.disabled=false;btn.style.opacity='';}
  toast(e.message);
 }finally{_statusLocks.delete(id)}
}
async function assignCourier(slug,oid,el){
 try{
  const d=await api(`/t/${slug}/couriers/overview`);
  if(!d.couriers.length)return toast('אין שליחים זמינים');
  const card=el.closest('.card');
  const old=card.querySelector('.assignbox');if(old)old.remove();
  const box=document.createElement('div');box.className='assignbox';box.style.cssText='margin-top:8px;display:flex;gap:6px';
  box.innerHTML=`<div class="mut" style="margin-bottom:4px">עלות משוערת: ₪${(d.estimate&&d.estimate.per_order)||''} (${(d.estimate&&d.estimate.stops_per_order)||2} נקודות × ₪${(d.estimate&&d.estimate.rate_per_stop)||''})</div>
   <select class="inp" id="as-${oid}" style="flex:1">${d.couriers.map(c=>`<option value="${c.id}">${esc(c.name)} · ${c.model==='platform'?'פלטפורמה':c.model==='shared'?'משותף':'פרטי'} · ${c.active_orders} פעילות</option>`).join('')}</select>
   <button class="btn2 on" data-act="doAssign" data-a="${slug}" data-b="${oid}">שליחת הצעה</button>`;
  card.appendChild(box);
 }catch(e){toast(e.message)}
}
async function doAssign(slug,oid,btn){
 btn.disabled=true;btn.textContent='שולח…';
 try{
  const cid=document.getElementById('as-'+oid).value;
  const r=await api(`/t/${slug}/orders/${oid}/assign`,{method:'POST',body:JSON.stringify({courier_id:cid})});
  toast(r.mode==='assigned'?'שובץ שליח מכבסה':'הצעה נשלחה לשליח');route();
 }catch(e){btn.disabled=false;btn.textContent='שליחת הצעה';toast(e.message)}
}
/* E4.T4: מסך חשבון עסקי (מוקאפ 7) — מצטבר חודשי, הזמנה חוזרת, מחירון הסכמי, חשבונית מרוכזת, הזמנה חדשה */
let bizSel=null;
async function vManageBiz(slug){
 const d=await api(`/t/${slug}/business-accounts`);
 const items=(await api(`/t/${slug}/items`)).items.filter(i=>i.active);
 const acc=d.accounts.find(a=>a.id===bizSel)||d.accounts[0];
 bizSel=acc?acc.id:null;
 let html=`<div class="card"><label class="lb">חשבון עסקי חדש</label>
  <input class="inp" id="bz-name" placeholder="שם החברה">
  <div style="display:flex;gap:8px;flex-wrap:wrap">
   <input class="inp" id="bz-comp" placeholder="ח״פ" style="flex:1;min-width:100px">
   <input class="inp" id="bz-contact" placeholder="איש קשר" style="flex:1;min-width:100px">
   <input class="inp" id="bz-phone" placeholder="טלפון איש קשר" style="flex:1;min-width:110px">
  </div>
  <button class="btn2 on" data-act="bizCreate" data-a="${slug}">יצירת חשבון</button></div>`;
 html+=`<div class="card">${d.accounts.map(a=>`<div class="row"><div style="${a.active?'':'opacity:.4'}"><b>${esc(a.name)}</b>${a.active?'':' (מושבת)'}
   <div class="mut">${a.company_id?'ח״פ '+esc(a.company_id)+' · ':''}${a.users_count} משתמשים · ${a.prices_count} מחירים הסכמיים · ${a.payment_terms==='net30'?'שוטף+30':esc(a.payment_terms)}</div></div>
   <button class="btn2 ${bizSel===a.id?'on':''}" data-act="bizPick" data-a="${a.id}">${bizSel===a.id?'נבחר':'ניהול'}</button></div>`).join('')||'<div class="mut">אין חשבונות עסקיים עדיין</div>'}</div>`;
 if(!acc)return html;
 const det=await api(`/t/${slug}/business-accounts/${acc.id}`);
 const sum=(await api(`/t/${slug}/business-accounts/${acc.id}/summary`)).summary;
 const rec=(await api(`/t/${slug}/business-accounts/${acc.id}/recurring`)).templates;
 const inv=(await api(`/t/${slug}/business-accounts/${acc.id}/invoices`)).invoices;
 html+=`<div class="kpis"><div class="kpi"><b>${sum.orders_count}</b>הזמנות החודש</div><div class="kpi"><b>₪${sum.month_total}</b>מצטבר חודשי</div></div>`;
 // הזמנה חדשה מהמחירון ההסכמי
 html+=`<div class="card"><label class="lb">הזמנה חדשה מהמחירון ההסכמי</label>
  <div style="display:flex;gap:8px;flex-wrap:wrap">
   <select class="inp" id="bz-ouser" style="flex:1;min-width:130px">${det.users.map(u=>`<option value="${u.id}">${esc(u.name||u.phone)}</option>`).join('')||'<option value="">— שייכו משתמש קודם —</option>'}</select>
   <select class="inp" id="bz-oitem" style="flex:1;min-width:130px">${items.map(i=>{const o=det.prices.find(p=>p.item_id===i.id);return `<option value="${i.id}">${esc(i.name)} · ₪${o?o.price:i.price}</option>`}).join('')}</select>
   <input class="inp" id="bz-oqty" type="number" value="1" min="1" style="width:70px">
  </div>
  <input class="inp" id="bz-oaddr" placeholder="כתובת איסוף">
  <button class="btn2 on" data-act="bizOrder" data-a="${slug}" data-b="${acc.id}">יצירת הזמנה</button></div>`;
 // הזמנה חוזרת
 const DAYS=['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'];
 html+=`<div class="card"><label class="lb">הזמנה חוזרת</label>
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${DAYS.map((d,i)=>`<label class="chip" style="cursor:pointer"><input type="checkbox" id="bz-d${i}" style="accent-color:#0e7a8a"> ${d}</label>`).join('')}</div>
  <div style="display:flex;gap:8px;flex-wrap:wrap">
   <select class="inp" id="bz-ruser" style="flex:1;min-width:120px">${det.users.map(u=>`<option value="${u.id}">${esc(u.name||u.phone)}</option>`).join('')||'<option value="">— שייכו משתמש קודם —</option>'}</select>
   <select class="inp" id="bz-ritem" style="flex:1;min-width:120px">${items.map(i=>`<option value="${i.id}">${esc(i.name)}</option>`).join('')}</select>
   <input class="inp" id="bz-rqty" type="number" value="1" min="1" style="width:60px">
   <input class="inp" id="bz-rtime" type="time" value="09:00" style="width:100px">
  </div>
  <input class="inp" id="bz-raddr" placeholder="כתובת קבועה לאיסוף">
  <button class="btn2 on" data-act="bizRecCreate" data-a="${slug}" data-b="${acc.id}">יצירת תבנית</button>
  ${rec.map(t=>`<div class="row" style="margin-top:8px"><div style="${t.active?'':'opacity:.4'}"><b>${esc(t.user_name||'')}</b> · ימים ${(t.days||[]).map(d=>DAYS[d]).join(' ')}${t.pickup_time?' · '+t.pickup_time.slice(0,5):''}
    <div class="mut">${(t.items||[]).map(i=>{const it=items.find(x=>x.id===i.item_id);return (it?esc(it.name):'פריט')+' ×'+fmtQ(i.qty)}).join(', ')} · ${esc(t.address)}${t.last_run_on?' · הופק לאחרונה '+fmtDate(t.last_run_on):''}</div></div>
    <button class="btn2" data-act="bizRecToggle" data-a="${slug}" data-b="${acc.id}" data-c="${t.id}" data-d="${!t.active}">${t.active?'השהיה':'הפעלה'}</button></div>`).join('')}</div>`;
 // מחירון הסכמי
 html+=`<div class="card"><label class="lb">מחירון הסכמי</label>
  <div style="display:flex;gap:8px;flex-wrap:wrap">
   <select class="inp" id="bz-pitem" style="flex:2;min-width:140px">${items.map(i=>`<option value="${i.id}">${esc(i.name)} (רגיל ₪${i.price})</option>`).join('')}</select>
   <input class="inp" id="bz-pprice" type="number" placeholder="מחיר הסכמי ₪" style="flex:1;min-width:110px">
   <button class="btn2 on" data-act="bizSetPrice" data-a="${slug}" data-b="${acc.id}">קביעה</button>
  </div>
  ${det.prices.map(p=>`<div class="row" style="margin-top:6px"><div>${esc(p.name)} <div class="mut">רגיל ₪${p.regular_price}</div></div>
   <div><b>₪${p.price}</b> <button class="btn2" data-act="bizDelPrice" data-a="${slug}" data-b="${acc.id}" data-c="${p.item_id}">הסרה</button></div></div>`).join('')||'<div class="mut" style="margin-top:6px">אין דריסות מחיר — ההזמנות במחירון הרגיל</div>'}</div>`;
 // משתמשים
 html+=`<div class="card"><label class="lb">משתמשים משויכים</label>
  <div style="display:flex;gap:8px"><input class="inp" id="bz-uphone" placeholder="טלפון משתמש רשום" style="flex:1"><button class="btn2 on" data-act="bizAddUser" data-a="${slug}" data-b="${acc.id}">שיוך</button></div>
  ${det.users.map(u=>`<div class="row" style="margin-top:6px"><div>${esc(u.name||'')} <span class="mut" dir="ltr">${esc(u.phone)}</span></div><button class="btn2" data-act="bizDelUser" data-a="${slug}" data-b="${acc.id}" data-c="${u.id}">הסרה</button></div>`).join('')||'<div class="mut" style="margin-top:6px">אין משתמשים משויכים</div>'}</div>`;
 // חשבונית מרוכזת
 const now=new Date();
 html+=`<div class="card"><label class="lb">חשבונית מרוכזת חודשית</label>
  <div class="mut">הפקה אוטומטית ב-1 לחודש · מסמך דמו — לא חשבונית מס · ברירת מחדל מופעלת לחשבון עסקי</div>
  <label style="display:flex;gap:8px;align-items:center;margin:6px 0;cursor:pointer"><input type="checkbox" id="bz-cons" ${acc.consolidated_billing!==false?'checked':''} data-actc="bizConsToggle" data-a="${slug}" data-b="${acc.id}"> חשבונית מרכזת חודשית מופעלת</label>
  <button class="btn2 on" data-act="bizInvGen" data-a="${slug}" data-b="${acc.id}">הפקה לחודש ${now.getMonth()+1}/${now.getFullYear()}</button>
  ${inv.map(i=>`<div class="row" style="margin-top:6px"><div><b>${i.month}/${i.year}</b>${i.regenerated_count>0?' <span class="tag tb">הופק מחדש ×'+i.regenerated_count+'</span>':''} <div class="mut">${i.orders_count} הזמנות · הופק ${fmtDate(i.issued_at)}${i.regenerated_at?' · עודכן '+fmtDate(i.regenerated_at):''}</div></div>
   <div><b>₪${i.total}</b> <button class="btn2" data-act="bizDoc" data-a="${slug}" data-b="${acc.id}" data-c="${i.id}" data-d="pdf">PDF</button> <button class="btn2" data-act="bizDoc" data-a="${slug}" data-b="${acc.id}" data-c="${i.id}" data-d="csv">CSV</button></div></div>`).join('')||'<div class="mut" style="margin-top:6px">אין חשבוניות עדיין</div>'}</div>`;
 return html;
}
function bizPick(id){bizSel=id;route()}
async function bizConsToggle(slug,bid,on){try{await api(`/t/${slug}/business-accounts/${bid}`,{method:'PATCH',body:JSON.stringify({consolidated_billing:on})});toast(on?'חשבונית מרכזת הופעלה':'חשבונית מרכזת כובתה')}catch(e){toast(e.message);route()}}
async function bizCreate(slug){try{await api(`/t/${slug}/business-accounts`,{method:'POST',body:JSON.stringify({name:$('#bz-name').value,company_id:$('#bz-comp').value,contact_name:$('#bz-contact').value,contact_phone:$('#bz-phone').value})});route()}catch(e){toast(e.message)}}
async function bizAddUser(slug,bid){try{await api(`/t/${slug}/business-accounts/${bid}/users`,{method:'POST',body:JSON.stringify({phone:$('#bz-uphone').value})});route()}catch(e){toast(e.message)}}
async function bizDelUser(slug,bid,uid){try{await api(`/t/${slug}/business-accounts/${bid}/users/${uid}`,{method:'DELETE'});route()}catch(e){toast(e.message)}}
async function bizSetPrice(slug,bid){try{await api(`/t/${slug}/business-accounts/${bid}/prices`,{method:'PUT',body:JSON.stringify({prices:[{item_id:$('#bz-pitem').value,price:Number($('#bz-pprice').value)}]})});route()}catch(e){toast(e.message)}}
async function bizDelPrice(slug,bid,itemId){try{await api(`/t/${slug}/business-accounts/${bid}/prices`,{method:'PUT',body:JSON.stringify({prices:[{item_id:itemId,price:null}]})});route()}catch(e){toast(e.message)}}
async function bizRecCreate(slug,bid){try{
 const days=[0,1,2,3,4,5,6].filter(i=>$('#bz-d'+i)&&$('#bz-d'+i).checked);
 await api(`/t/${slug}/business-accounts/${bid}/recurring`,{method:'POST',body:JSON.stringify({user_id:$('#bz-ruser').value,days,items:[{item_id:$('#bz-ritem').value,qty:Number($('#bz-rqty').value)||1}],pickup_time:$('#bz-rtime').value,address:$('#bz-raddr').value})});route()}catch(e){toast(e.message)}}
async function bizRecToggle(slug,bid,rid,active){try{await api(`/t/${slug}/business-accounts/${bid}/recurring/${rid}`,{method:'PATCH',body:JSON.stringify({active})});route()}catch(e){toast(e.message)}}
async function bizInvGen(slug,bid){try{const now=new Date();await api(`/t/${slug}/business-accounts/${bid}/invoices/generate`,{method:'POST',body:JSON.stringify({year:now.getFullYear(),month:now.getMonth()+1})});toast('החשבונית הופקה');route()}catch(e){toast(e.message)}}
async function bizOrder(slug,bid){try{
 const r=await api(`/t/${slug}/business-accounts/${bid}/orders`,{method:'POST',body:JSON.stringify({user_id:$('#bz-ouser').value,items:[{item_id:$('#bz-oitem').value,qty:Number($('#bz-oqty').value)||1}],address:$('#bz-oaddr').value})});
 toast('הזמנה נוצרה בסך ₪'+r.order.total);route()}catch(e){toast(e.message)}}
async function bizDoc(slug,bid,iid,kind){try{
 const r=await fetch(`/api/t/${slug}/business-accounts/${bid}/invoices/${iid}/${kind}`,{headers:{authorization:'Bearer '+state.token}});
 if(!r.ok)throw new Error('שגיאה בטעינת המסמך');
 const b=await r.blob();window.open(URL.createObjectURL(b),'_blank')}catch(e){toast(e.message)}}
async function addItem(slug){try{await api(`/t/${slug}/items`,{method:'POST',body:JSON.stringify({name:$('#it-name').value,price:$('#it-price').value,unit:$('#it-unit').value,category:$('#it-cat').value})});route()}catch(e){toast(e.message)}}
async function editItem(slug,id,btn){
 const vals=await xmodal({title:'עריכת פריט',okText:'שמירה',fields:[{id:'name',label:'שם הפריט',value:btn.dataset.name},{id:'price',label:'מחיר בש״ח',value:btn.dataset.price,type:'number'}]});
 if(!vals)return;
 try{await api(`/t/${slug}/items/${id}`,{method:'PATCH',body:JSON.stringify({name:vals.name.trim()||undefined,price:vals.price?Number(vals.price):undefined})});toast('הפריט עודכן');route()}catch(e){toast(e.message)}
}
async function delItem(slug,id){try{await api(`/t/${slug}/items/${id}`,{method:'DELETE'});route()}catch(e){toast(e.message)}}

async function consolidatedModal(slug){
 let d; try{d=await api(`/t/${slug}/documents/consolidated/eligible`)}catch(e){return toast(e.message)}
 if(!d.customers.length)return toast('אין הזמנות מוכנות לחשבונית מרכזת — נדרשות הזמנות שהושלמו ועדיין לא הונפק להן מסמך');
 const ov=document.createElement('div');ov.className='modal-ov';
 ov.innerHTML=`<div class="modal"><b>הפקת חשבונית מרכזת</b>
  <div class="mut" style="margin:6px 0">מסמך A4 מעוצב המרכז מספר הזמנות של לקוח אחד — כולל QR וברקוד לאימות. הזמנות שייכוסו כאן לא יקבלו מסמך נפרד.</div>
  <label class="lb">לקוח</label>
  <select class="inp" id="cm-cust">${d.customers.map((c,i)=>`<option value="${i}">${esc(c.customer.name||'לקוח')} · ${c.orders.length} הזמנות זכאיות</option>`).join('')}</select>
  <div id="cm-orders" style="max-height:220px;overflow:auto;margin-top:8px"></div>
  <div style="display:flex;gap:8px;margin-top:14px"><button class="btn" id="cm-ok" style="flex:1">הפק חשבונית מרכזת</button><button class="btn2" id="cm-cancel" style="flex:1">ביטול</button></div></div>`;
 document.body.appendChild(ov);
 const renderOrders=()=>{const c=d.customers[+ov.querySelector('#cm-cust').value];
  ov.querySelector('#cm-orders').innerHTML=c.orders.map(o=>`<label style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid #eef3f5;cursor:pointer"><input type="checkbox" class="cm-o" value="${o.id}" checked> הזמנה #${o.id.slice(0,8)} · ${new Date(o.created_at).toLocaleDateString('he-IL')} · ₪${o.total}</label>`).join('')};
 renderOrders();
 ov.querySelector('#cm-cust').onchange=renderOrders;
 ov.querySelector('#cm-cancel').onclick=()=>ov.remove();
 ov.onclick=e=>{if(e.target===ov)ov.remove()};
 ov.querySelector('#cm-ok').onclick=async()=>{
  const c=d.customers[+ov.querySelector('#cm-cust').value];
  const ids=[...ov.querySelectorAll('.cm-o:checked')].map(x=>x.value);
  if(!ids.length)return toast('בחרו לפחות הזמנה אחת');
  try{const r=await api(`/t/${slug}/documents/consolidated`,{method:'POST',body:JSON.stringify({customer_id:c.customer.id,order_ids:ids})});
   ov.remove();toast(`חשבונית מרכזת ${r.document.doc_number}/${r.document.doc_year} הונפקה`);route()}catch(e){toast(e.message)}
 };
}

async function creditDoc(slug,id,total,credited){
 const rem=Math.round((Number(total)-Number(credited))*100)/100;
 const vals=await xmodal({title:'הנפקת זיכוי',body:`יתרה לזיכוי במסמך: ₪${rem}. השאר את השדה ריק לזיכוי מלא.`,okText:'הנפק זיכוי',fields:[{id:'amt',label:'סכום חלקי (אופציונלי)',type:'number'}]});
 if(!vals)return;
 try{await api(`/t/${slug}/documents/${id}/credit`,{method:'POST',body:JSON.stringify(vals.amt&&vals.amt.trim()?{amount:Number(vals.amt)}:{})});toast('הזיכוי הונפק');route()}catch(e){toast(e.message)}
}
async function addCoupon(slug){try{const b={code:$('#cp-code').value,kind:$('#cp-kind').value,value:$('#cp-value').value,min_order:$('#cp-min').value||undefined,usage_limit:$('#cp-usage').value||undefined,per_user_limit:$('#cp-peruser').value||undefined,expires_at:$('#cp-exp').value||undefined};await api(`/t/${slug}/coupons`,{method:'POST',body:JSON.stringify(b)});toast('הקופון נוצר');route()}catch(e){toast(e.message)}}
async function toggleCoupon(slug,id,active){try{await api(`/t/${slug}/coupons/${id}`,{method:'PATCH',body:JSON.stringify({active})});route()}catch(e){toast(e.message)}}
async function addWindow(slug){try{await api(`/t/${slug}/windows`,{method:'POST',body:JSON.stringify({weekday:$('#w-day').value,start_time:$('#w-start').value,end_time:$('#w-end').value,kind:$('#w-kind').value})});route()}catch(e){toast(e.message)}}
async function delWindow(slug,id){try{await api(`/t/${slug}/windows/${id}`,{method:'DELETE'});route()}catch(e){toast(e.message)}}
async function saveSettings(slug){try{await api(`/t/${slug}/settings`,{method:'PATCH',body:JSON.stringify({name:$('#s-name').value,phone:$('#s-phone').value,address:$('#s-address').value,city:$('#s-city').value,slogan:$('#s-slogan').value,whatsapp:$('#s-wa').value,color:$('#s-color').value,delivery_fee:$('#s-fee').value,min_order:$('#s-min').value,is_open:$('#s-open').checked,terms:$('#s-terms').value,dealer_type:$('#s-dealer-type').value||null,dealer_id:$('#s-dealer-id').value||null,invoice_mode:$('#s-invoice-mode').value})});toast('נשמר')}catch(e){toast(e.message)}}
/* B7: רישום פעולות להאזנה המרכזת (ללא inline handlers) */
onAct({
 bizConsToggle:t=>bizConsToggle(t.dataset.a,t.dataset.b,t.checked),
 commTenantSwitch:t=>{store.set('lastTenant',t.value);route()},
 addItem:t=>addItem(t.dataset.a), addPlan:t=>addPlan(t.dataset.a), addWindow:t=>addWindow(t.dataset.a),
 assignCourier:t=>assignCourier(t.dataset.a,t.dataset.b,t), doAssign:t=>doAssign(t.dataset.a,t.dataset.b,t),
 bizAddUser:t=>bizAddUser(t.dataset.a,t.dataset.b), bizCreate:t=>bizCreate(t.dataset.a),
 bizDelPrice:t=>bizDelPrice(t.dataset.a,t.dataset.b,t.dataset.c), bizDelUser:t=>bizDelUser(t.dataset.a,t.dataset.b,t.dataset.c),
 bizDoc:t=>bizDoc(t.dataset.a,t.dataset.b,t.dataset.c,t.dataset.d), bizInvGen:t=>bizInvGen(t.dataset.a,t.dataset.b),
 bizOrder:t=>bizOrder(t.dataset.a,t.dataset.b), bizPick:t=>bizPick(t.dataset.a),
 bizRecCreate:t=>bizRecCreate(t.dataset.a,t.dataset.b), bizRecToggle:t=>bizRecToggle(t.dataset.a,t.dataset.b,t.dataset.c,t.dataset.d==='true'),
 bizSetPrice:t=>bizSetPrice(t.dataset.a,t.dataset.b), capacityDone:t=>capacityDone(t.dataset.a),
 capacityEngage:t=>capacityEngage(t.dataset.a,t.dataset.b), capacityNew:()=>capacityNew(), contentNew:()=>contentNew(),
 delItem:t=>delItem(t.dataset.a,t.dataset.b), delLogo:t=>delLogo(t.dataset.a), delWindow:t=>delWindow(t.dataset.a,t.dataset.b),
 editItem:t=>editItem(t.dataset.a,t.dataset.b,t), forumComment:t=>forumComment(t.dataset.a),
 forumNewPost:()=>forumNewPost(), forumUseful:t=>forumUseful(t.dataset.a),
 groupJoin:t=>groupJoin(t.dataset.a), groupLeave:t=>groupLeave(t.dataset.a), groupNew:()=>groupNew(),
 saveSettings:t=>saveSettings(t.dataset.a), setStatus:t=>setStatus(t.dataset.a,t.dataset.b,t.dataset.c,t),
 tenantCluster:t=>tenantCluster(t.dataset.a,t.dataset.b,t.dataset.c), tenantIssueHandle:t=>tenantIssueHandle(t.dataset.a,t.dataset.b),
 tenantRateCourier:t=>tenantRateCourier(t.dataset.a,t.dataset.b,t.dataset.c),
 tenderAward:t=>tenderAward(t.dataset.a,t.dataset.b), tenderBid:t=>tenderBid(t.dataset.a), tenderNew:()=>tenderNew(),
 toggleItemSub:t=>toggleItemSub(t.dataset.a,t.dataset.b,t.dataset.c==='true'),
 togglePlan:t=>togglePlan(t.dataset.a,t.dataset.b,t.dataset.c==='true'), uploadLogo:t=>uploadLogo(t.dataset.a),
 logout:(t,e)=>{e.preventDefault();logout()}
});
