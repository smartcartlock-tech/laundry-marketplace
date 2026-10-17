/* ---- admin ---- */
onAct({ adminOnboardStage:t=>adminOnboardStage(t.dataset.a,t.dataset.b),
 adminSlaHandle:t=>adminSlaHandle(t.dataset.a), adminSlaReopen:t=>adminSlaReopen(t.dataset.a),
 openIssuePhoto:t=>openIssuePhoto(t.dataset.a), adminIssueHandle:t=>adminIssueHandle(t.dataset.a),
 adminTenant:t=>adminTenant(t.dataset.a,t.dataset.b), addCoupon:t=>addCoupon(t.dataset.a),
 toggleCoupon:t=>toggleCoupon(t.dataset.a,t.dataset.b,t.dataset.c==='true'),
 consolidatedModal:t=>consolidatedModal(t.dataset.a), openPdf:t=>openPdf(t.dataset.a),
 creditDoc:t=>creditDoc(t.dataset.a,t.dataset.b,Number(t.dataset.c),Number(t.dataset.d)),
 adminResolveDispute:t=>adminResolveDispute(t.dataset.a,t.dataset.b), viewCourierDoc:t=>viewCourierDoc(t.dataset.a),
 adminCourier:t=>adminCourier(t.dataset.a,t.dataset.b), adminRejectCourier:t=>adminRejectCourier(t.dataset.a),
 adminAddCluster:()=>adminAddCluster(), adminToggleCluster:t=>adminToggleCluster(t.dataset.a),
 adminAddFixedRoute:t=>adminAddFixedRoute(t.dataset.a), adminAutoBuild:()=>adminAutoBuild(),
 adminRegisterCourier:()=>adminRegisterCourier(), downloadCsv:t=>downloadCsv(t.dataset.a,t.dataset.b)});
async function vAdmin(sub){
 if(!state.token)return needLogin();
 sub=sub||'overview';
 const KNOWN=['overview','dash','onboarding','sla','tenants','couriers','routes','register','orders','weekly','audit'];
 if(!KNOWN.includes(sub))sub='overview'; // תת-מסך לא מוכר — לא דף ריק
 const tabs=[['overview','תמונת מצב'],['dash','דשבורד מרכזי'],['onboarding','צינור קליטה'],['sla','התראות SLA'],['tenants','מכבסות'],['couriers','שליחים'],['routes','מסלולים'],['register','רישום שליח'],['orders','הזמנות'],['weekly','דוח שבועי'],['audit','יומן ביקורת']];
 let body='';
 if(sub==='dash'){
  // E7.T1: דשבורד מנהל מרכזי (מוקאפ 30)
  const d=await api('/admin/dashboard');
  body=`<div class="kpis">
   <div class="kpi"><b>₪${d.month.gmv}</b>מחזור (GMV) החודש</div>
   <div class="kpi"><b>${d.month.orders}</b>הזמנות החודש</div>
   <div class="kpi"><b>₪${d.month.courier_commission}</b>עמלות שליחים</div>
   <div class="kpi"><b>${d.sla.on_time_pct===null?'—':d.sla.on_time_pct+'%'}</b>איסוף בזמן (30 יום)</div>
   <div class="kpi"><b>${d.laundries.active_30d}</b>מכבסות פעילות</div>
   <div class="kpi"><b>${d.alerts.open}</b>התראות פתוחות</div>
  </div>
  <div class="card"><div class="sec">פעילות B2B שבועית</div><div style="display:flex;gap:8px;flex-wrap:wrap">
   <span class="tag tb">פוסטים: ${d.b2b_weekly.posts}</span><span class="tag tb">מכרזים: ${d.b2b_weekly.tenders}</span>
   <span class="tag tb">הצעות: ${d.b2b_weekly.bids}</span><span class="tag tb">קבוצות רכש: ${d.b2b_weekly.purchase_groups}</span>
   <span class="tag tb">קיבולת: ${d.b2b_weekly.capacity_posts}</span></div></div>
  ${d.alerts.open?`<a href="#/admin/sla" style="text-decoration:none"><div class="warn">⚠ ${d.alerts.open} התראות ממתינות לטיפול (${d.alerts.late} איחורים, ${d.alerts.issues} דיווחי לקוחות) — לחצו לתור הטיפול</div></a>`:'<div class="card mut">אין התראות פתוחות ✓</div>'}
  <div class="card mut">מכבסות מאושרות: ${d.laundries.approved} · ברוטו שליחים החודש: ₪${d.month.courier_gross}</div>`;
 } else if(sub==='onboarding'){
  // E7.T2: צינור אונבורדינג מכבסות
  const d=await api('/admin/onboarding');
  const ST={agreement:'הסכם',pricing:'מחירון',bot:'בוט',training:'הדרכה',active:'פעיל'};
  body=`<div class="kpis">${d.stages.map(s=>`<div class="kpi"><b>${d.pipeline[s]}</b>${ST[s]}</div>`).join('')}</div>
  ${d.tenants.map(t=>`<div class="card"><b>${esc(t.name)}</b> <span class="mut">${esc(t.city||'')}</span>${t.approved?'':' <span class="tag ta">ממתינה לאישור</span>'}
   <div class="mut">נפתחה ${fmtDate(t.created_at)} · פריטי מחירון: ${t.price_items}${t.notes?' · '+esc(t.notes):''}</div>
   <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${d.stages.map(st=>`<button class="btn2 ${t.stage===st?'green':''}" data-act="adminOnboardStage" data-a="${t.id}" data-b="${st}">${ST[st]}</button>`).join('')}</div></div>`).join('')}`;
 } else if(sub==='sla'){
  // E7.T3: תור התראות SLA ומחלוקות
  await api('/admin/sla/sync',{method:'POST',body:'{}'});
  const d=await api('/admin/sla?status=all');
  const KIND={late_pickup:'איחור איסוף',late_delivery:'איחור משלוח',customer_issue:'דיווח לקוח',courier_dispute:'מחלוקת שליח'};
  const open=d.alerts.filter(a=>a.status==='open'), done=d.alerts.filter(a=>a.status==='handled');
  body=(open.length?`<div class="sec">פתוחות (${open.length})</div>`+open.map(a=>`<div class="card"><b>${KIND[a.kind]||a.kind}</b> — ${esc(a.tenant_name||'—')}
    <div class="mut">${esc(a.details||'')}</div>
    ${a.order_address?`<div class="mut">${esc(a.order_address)} · סטטוס הזמנה: ${({new:'חדשה',confirmed:'אושרה',picked_up:'נאספה',out_for_delivery:'בדרך ללקוח',delivered:'נמסרה',cancelled:'בוטלה'})[a.order_status]||esc(a.order_status||'')} · לקוח: ${esc(a.customer_name||'')} <span dir="ltr">${esc(a.customer_phone||'')}</span></div>`:''}
    <div class="mut">נוצרה ${fmtDT(a.created_at)}</div>
    <div style="margin-top:6px"><button class="btn2 green" data-act="adminSlaHandle" data-a="${a.id}">סימון כטופלה</button></div></div>`).join(''):'<div class="card mut">אין התראות פתוחות ✓</div>')
   +(done.length?`<div class="sec">טופלו (${done.length})</div>`+done.map(a=>`<div class="card" style="opacity:.7"><b>${KIND[a.kind]||a.kind}</b> — ${esc(a.tenant_name||'—')}
    <div class="mut">${esc(a.details||'')}</div><div class="mut">טופלה ע"י ${esc(a.handled_by_name||'')} · ${fmtDT(a.handled_at)}${a.handle_note?' · '+esc(a.handle_note):''}</div>
    <div style="margin-top:6px"><button class="btn2" data-act="adminSlaReopen" data-a="${a.id}">פתיחה מחדש</button></div></div>`).join(''):'');
  // E9.T1: דיווחי תקלות שהוסלמו לגישור אדמין
  const med=await api('/admin/issues?mediation=1').catch(()=>({issues:[]}));
  if(med.issues&&med.issues.length){
   const KIND2={damage:'נזק',missing:'חסר',late:'איחור',other:'אחר'};
   body+=`<div class="sec">גישור תקלות (${med.issues.length})</div>`+med.issues.map(i=>`<div class="card">
    <b>${KIND2[i.kind]||i.kind}</b> — ${esc(i.tenant_name||'—')} <span class="st-pill ${i.status==='resolved'?'st-delivered':'st-new'}">${{open:'פתוח',in_progress:'בטיפול',resolved:'טופל'}[i.status]||i.status}</span>
    <div>${esc(i.text)}</div>
    <div class="mut">לקוח: ${esc(i.customer_name||'')} <span dir="ltr">${esc(i.customer_phone||'')}</span> · ${fmtDT(i.created_at)}${i.resolution_note?' · תיעוד מכבסה: '+esc(i.resolution_note):''}</div>
    <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
     ${(i.photo_ids||[]).map(pid=>`<button class="btn2" data-act="openIssuePhoto" data-a="${pid}">📷</button>`).join('')}
     ${i.status!=='resolved'?`<button class="btn2 green" data-act="adminIssueHandle" data-a="${i.id}">סיום גישור</button>`:''}
    </div></div>`).join('');
  }
 } else if(sub==='overview'){
  const d=await api('/admin/overview');
  body=`<div class="kpis"><div class="kpi"><b>${d.tenants.approved}</b>מכבסות</div><div class="kpi"><b>${d.orders.total}</b>הזמנות</div><div class="kpi"><b>₪${d.orders.gmv}</b>מחזור</div><div class="kpi"><b>${d.users.total}</b>משתמשים</div></div>
   ${d.tenants.pending?`<a href="#/admin/tenants" style="text-decoration:none"><div class="warn">${d.tenants.pending} מכבסות ממתינות לאישור — לחצו לסקירה</div></a>`:''}
   ${d.couriers.pending?`<div class="warn">${d.couriers.pending} שליחים ממתינים לאישור</div>`:''}`;
 } else if(sub==='tenants'){
  const d=await api('/admin/tenants');
  body=`<div class="card"><table class="tbl"><tr><th>מכבסה</th><th>הזמנות</th><th>מחזור</th><th></th></tr>
   ${d.tenants.map(t=>`<tr><td><a href="#/admin/tenant/${t.id}" style="color:#0e7a8a;font-weight:600">${esc(t.name)}</a>${t.approved?'':' <span class="tag ta">ממתינה</span>'}<div class="mut">${esc(t.city||'')}</div></td><td>${t.orders}</td><td>₪${t.gmv}</td>
    <td>${t.approved?`<button class="btn2" data-act="adminTenant" data-a="${t.id}" data-b="suspend">השעיה</button>`:`<button class="btn2 green" data-act="adminTenant" data-a="${t.id}" data-b="approve">אישור</button>`}</td></tr>`).join('')}</table></div>`;
 } else if(sub==='couriers'){
  const d=await api('/admin/couriers');
  const pd=await api('/admin/couriers/pending');
  const net=await api('/admin/couriers/network');
  body=`<div class="kpis">
   <div class="kpi"><b>${net.counts.active}</b>שליחים פעילים</div>
   <div class="kpi"><b>${net.sla.on_time_pct===null?'—':net.sla.on_time_pct+'%'}</b>איסוף בזמן (30 יום)</div>
   <div class="kpi"><b>${net.routes_30d.combined_pct}%</b>מסלולים משולבים</div>
   <div class="kpi"><b>${net.disputes.length}</b>מחלוקות פתוחות</div>
  </div>
  ${net.coverage.length?`<div class="card"><div class="sec">כיסוי אזורי</div><div style="display:flex;gap:6px;flex-wrap:wrap">${net.coverage.map(x=>`<span class="tag tb">${esc(x.area)}: ${x.couriers}</span>`).join('')}</div></div>`:''}
  ${net.late_alerts.length?`<div class="warn">⚠ ${net.late_alerts.length} הזמנות באיחור חריג (מעל שעתיים מחלון האיסוף):</div>`+net.late_alerts.map(x=>`<div class="card"><b dir="ltr">#${x.id.slice(0,8)}</b> ${esc(x.tenant_name)}<div class="mut">${esc(x.address)} · איסוף תוכנן ${fmtDT(x.pickup_at)}</div></div>`).join(''):''}
  ${net.disputes.length?`<div class="sec">מחלוקות תשלום</div>`+net.disputes.map(x=>`<div class="card"><b>${esc(x.courier_name)}</b> מול ${esc(x.tenant_name||'—')}<div class="mut">שבוע ${fmtDate(x.week_start)} · ברוטו ₪${x.gross} · נטו ₪${x.net}</div>
   <div style="display:flex;gap:6px;margin-top:6px"><button class="btn2 green" data-act="adminResolveDispute" data-a="${x.id}" data-b="approve">אישור התשלום</button><button class="btn2" data-act="adminResolveDispute" data-a="${x.id}" data-b="reject">דחיית החיוב</button></div></div>`).join(''):''}
  ${pd.pending.length?`<div class="sec">ממתינים לאישור (${pd.pending.length})</div>`+pd.pending.map(c=>`<div class="card">
    <b>${esc(c.name||'')}</b> · <span dir="ltr">${esc(c.phone||'')}</span>
    <div class="mut">${c.model==='shared'?'שליח משותף':'שליח פלטפורמה'} · ${esc(c.vehicle||'')} · אזורים: ${(c.areas||[]).map(esc).join(', ')}</div>
    <div class="mut">זמינות: ${Object.keys(c.availability||{}).length?Object.keys(c.availability||{}).map(d=>WD[+d]).join(', '):'לא צוינה'} · נרשם ${fmtDate(c.created_at)}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">${(c.documents||[]).map(doc=>`<button class="btn2" data-act="viewCourierDoc" data-a="${doc.id}">${doc.kind==='license'?'רישיון':doc.kind==='insurance'?'ביטוח':'תמונה'}</button>`).join('')||'<span class="mut">אין מסמכים</span>'}</div>
    <div style="display:flex;gap:8px"><button class="btn2 green" style="flex:1" data-act="adminCourier" data-a="${c.id}" data-b="approve">אישור</button><button class="btn2" style="flex:1" data-act="adminRejectCourier" data-a="${c.id}">דחייה</button></div>
   </div>`).join(''):''}
  <div class="card"><table class="tbl"><tr><th>שליח</th><th>סוג</th><th>מכבסה</th><th></th></tr>
   ${d.couriers.map(c=>`<tr><td>${esc(c.name)}<div class="mut">${esc(c.phone||'')}</div></td><td>${c.model==='platform'?'פלטפורמה':c.model==='shared'?'משותף':'פרטי'}</td><td>${esc(c.tenant_name||'—')}</td>
    <td>${c.approved?`<button class="btn2" data-act="adminCourier" data-a="${c.id}" data-b="suspend">השעיה</button>`:`<button class="btn2 green" data-act="adminCourier" data-a="${c.id}" data-b="approve">אישור</button>`}</td></tr>`).join('')}</table></div>`;
 } else if(sub==='routes'){
  const d=await api('/admin/routes');
  const cl=await api('/admin/clusters');
  const cr=await api('/admin/couriers');
  body=`<div class="sec">קלאסטרים ומסלולים קבועים</div>
  <div class="card"><div style="display:flex;gap:6px"><input class="inp" id="cl-name" placeholder="שם קלאסטר" style="flex:2"><input class="inp" id="cl-area" placeholder="אזור" style="flex:1"><input class="inp" id="cl-fee" type="number" placeholder="דמי ניהול ₪/חודש" style="flex:1"></div>
   <button class="btn2 on" data-act="adminAddCluster">יצירת קלאסטר</button></div>
  ${cl.clusters.map(c=>`<div class="card"><div class="row"><div><b>${esc(c.name)}</b> · ${esc(c.area)} ${c.active?'':'<span class="tag ta">מושבת</span>'}
    <div class="mut">${c.members}/5 מכבסות${c.member_names?': '+c.member_names.map(m=>esc(m.name)).join(', '):''} · דמי ניהול (דמו): ₪${c.mgmt_fee_monthly}/חודש</div>
    ${(c.fixed_routes||[]).map(f=>`<div class="mut">מסלול קבוע: ${WD[f.weekday]} — ${esc(f.courier)}</div>`).join('')}</div>
    <button class="btn2" data-act="adminToggleCluster" data-a="${c.id}">${c.active?'השבתה':'הפעלה'}</button></div>
   <div style="display:flex;gap:6px;margin-top:6px"><select class="inp" id="fr-c-${c.id}" style="flex:2">${cr.couriers.filter(x=>x.approved).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>
    <select class="inp" id="fr-w-${c.id}" style="flex:1">${WD.map((w,i)=>`<option value="${i}">${w}</option>`).join('')}</select>
    <button class="btn2" data-act="adminAddFixedRoute" data-a="${c.id}">+ מסלול קבוע</button></div></div>`).join('')||'<div class="card mut">אין קלאסטרים</div>'}`;
  body+=`<button class="btn" data-act="adminAutoBuild">בניית מסלולים אוטומטית להיום</button>
  <div class="note">המנוע מאחד הזמנות לא משובצות לפי אזור, משבץ שליח פלטפורמה/משותף ומסדר נקודות (nearest neighbor).</div>
  ${d.routes.length?d.routes.map(r=>`<div class="card"><b>${esc(r.courier_name)}</b> ${r.combined?'<span class="tag tb">מסלול משולב</span>':'<span class="tag">רגיל</span>'}
   <div class="mut">${r.stops} נקודות · ${r.tenants} מכבסות</div>
   <table class="tbl"><tr><th>#</th><th>מכבסה</th><th>כתובת</th><th>סטטוס</th></tr>
   ${(r.stop_list||[]).map(x=>`<tr><td>${x.seq}</td><td>${esc(x.tenant||'')}</td><td>${esc(x.address||'')}</td><td>${HE[x.status]||x.status||''}</td></tr>`).join('')}</table></div>`).join(''):'<div class="card mut">אין מסלולים להיום — לחצו על בנייה אוטומטית</div>'}`;
 } else if(sub==='register'){
  const d=await api('/admin/tenants');
  body=`<div class="card">
   <label class="lb">שם שליח</label><input class="inp" id="rc-name">
   <label class="lb">טלפון</label><input class="inp" id="rc-phone" placeholder="05x-xxxxxxx">
   <label class="lb">כלי רכב</label><input class="inp" id="rc-vehicle" placeholder="אופנוע / רכב">
   <label class="lb">מודל</label><select class="inp" id="rc-model"><option value="platform">שליח פלטפורמה</option><option value="private">שליח מכבסה פרטי</option><option value="shared">שליח משותף</option></select>
   <label class="lb">מכבסה (לשליח פרטי/משותף)</label><select class="inp" id="rc-tenant"><option value="">—</option>${d.tenants.map(t=>`<option value="${t.slug}">${esc(t.name)}</option>`).join('')}</select>
   <button class="btn" data-act="adminRegisterCourier">רישום</button></div>`;
 } else if(sub==='weekly'){
  const d=(await api('/admin/weekly-report')).report;
  body=`<div class="kpis"><div class="kpi"><b>₪${d.gmv}</b>מחזור שבועי</div><div class="kpi"><b>${d.orders}</b>הזמנות</div><div class="kpi"><b>${d.delivered}</b>הושלמו</div><div class="kpi"><b>${d.cancelled}</b>בוטלו</div></div>
   <div class="kpis"><div class="kpi"><b>${d.new_users}</b>משתמשים חדשים</div><div class="kpi"><b>${d.new_tenants}</b>מכבסות חדשות</div><div class="kpi"><b>${d.active_tenants}</b>מכבסות פעילות</div><div class="kpi"><b>${d.active_couriers}</b>שליחים פעילים</div></div>
   <div class="card"><b>לפי מכבסה (7 ימים)</b><table class="tbl"><tr><th>מכבסה</th><th>הזמנות</th><th>מחזור</th></tr>
    ${d.by_tenant.map(t=>`<tr><td>${esc(t.name)}</td><td>${t.orders}</td><td>₪${t.gmv}</td></tr>`).join('')||'<tr><td colspan="3" class="mut">אין הזמנות השבוע</td></tr>'}</table></div>
   <button class="btn2" data-act="downloadCsv" data-a="/admin/weekly-report.csv" data-b="weekly-report.csv">ייצוא הדוח ל-CSV</button>`;
 } else if(sub==='audit'){
  body=await vAdminAudit();
 } else if(sub==='orders'){
  const d=await api('/admin/orders');
  body=`<div class="card"><table class="tbl"><tr><th>הזמנה</th><th>מכבסה</th><th>סטטוס</th><th>₪</th></tr>
   ${d.orders.map(o=>`<tr><td><span dir="ltr">#${o.id.slice(0,8)}</span><div class="mut">${esc(o.customer_name||'')}</div></td><td>${esc(o.tenant_name)}</td><td><span class="st-pill st-${o.status}">${HE[o.status]}</span></td><td>${o.total}</td></tr>`).join('')}</table></div>`;
 }
 return `<div class="hdr"><h2>ניהול פלטפורמה</h2></div>
 <div class="body"><div class="subtabs">${tabs.map(t=>`<a class="chip ${sub===t[0]?'on':''}" href="#/admin/${t[0]}">${t[1]}</a>`).join('')}</div>${body}</div>`;
}
async function adminTenant(id,a){
 if(a==='suspend'&&!await xconfirm('המכבסה תוסתר מהמרקטפלייס עד לאישור מחדש. הזמנות פעילות לא יימחקו.',{title:'השעיית מכבסה',okText:'כן, להשעות'}))return;
 if(a==='reject'&&!await xconfirm('פעולה זו תמחק את המכבסה לצמיתות. אפשרי רק למכבסה ללא הזמנות.',{title:'דחייה ומחיקה',okText:'כן, למחוק'}))return;
 try{await api(`/admin/tenants/${id}/${a}`,{method:'POST',body:'{}'});toast(a==='approve'?'המכבסה אושרה':a==='suspend'?'המכבסה הושעתה':'המכבסה נמחקה');go('#/admin/tenants')}catch(e){toast(e.message)}
}
/* מסך פרטי מכבסה לאדמין — סקירה לפני אישור */
async function vAdminTenant(id){
 if(!state.token)return needLogin();
 const d=await api('/admin/tenants/'+id);
 const t=d.tenant;
 const hoursTxt=Object.entries(t.hours||{}).map(([k,v])=>v&&v.length?`${WD[k]}: ${v.map(r=>'<span dir="ltr">'+r.join('–')+'</span>').join(', ')}`:null).filter(Boolean).join('<br>');
 const winTxt=(d.windows||[]).map(w=>`${WD[w.weekday]} <span dir="ltr">${w.start_time.slice(0,5)}–${w.end_time.slice(0,5)}</span> (${w.kind==='pickup'?'איסוף':'החזרה'})`).join('<br>');
 const actions=t.approved
  ?`<button class="btn2" data-act="adminTenant" data-a="${t.id}" data-b="suspend">השעיית המכבסה</button>`
  :`<button class="btn green" data-act="adminTenant" data-a="${t.id}" data-b="approve">אישור המכבסה</button> <button class="btn2" style="color:#c00" data-act="adminTenant" data-a="${t.id}" data-b="reject">דחייה ומחיקה</button>`;
 return `<div class="hdr"><h2>${esc(t.name)}</h2><p><a href="#/admin/tenants" style="color:#fff">← חזרה לרשימת המכבסות</a></p></div>
 <div class="body">
  <div class="card"><b>פרטים</b>
   <div class="mut">סטטוס: ${t.approved?'מאושרת':'ממתינה לאישור'} · נרשמה ${fmtDate(t.created_at)}</div>
   <div class="mut">טלפון: ${esc(t.phone||'—')} · ${esc(t.address||'—')}, ${esc(t.city||'—')}</div>
   <div class="mut">דמי שליחות: ₪${t.delivery_fee||0} · מינימום: ₪${t.min_order||0}</div>
   ${(t.services||[]).length?`<div class="mut">שירותים: ${t.services.map(esc).join(', ')}</div>`:''}
  </div>
  <div class="card"><b>מחירון (${d.items.length})</b>
   ${d.items.map(i=>`<div class="row"><div>${esc(i.name)}<div class="mut">${esc(i.category||'')}</div></div><div>₪${i.price}${i.unit==='item'?'':'/'+unitLbl(i.unit)}${i.active?'':' · מוסתר'}</div></div>`).join('')||'<div class="mut">אין פריטים</div>'}
  </div>
  ${hoursTxt?`<div class="card"><b>שעות פעילות</b><div class="mut">${hoursTxt}</div></div>`:''}
  ${winTxt?`<div class="card"><b>חלונות איסוף/החזרה</b><div class="mut">${winTxt}</div></div>`:''}
  ${t.terms?`<div class="card"><b>תקנון</b><div class="mut">${esc(t.terms)}</div></div>`:''}
  <div class="card"><b>צוות והזמנות</b>
   ${d.members.map(mm=>`<div class="mut">${esc(mm.name||'')} · ${esc(mm.phone||'')} (${mm.role==='owner'?'בעלים':'צוות'})</div>`).join('')||'<div class="mut">אין חברי צוות</div>'}
   <div class="mut">${d.orders} הזמנות</div>
  </div>
  <div style="display:flex;gap:8px;margin:6px 0 20px">${actions}</div>
 </div>`;
}
async function adminAddCluster(){try{await api('/admin/clusters',{method:'POST',body:JSON.stringify({name:$('#cl-name').value,area:$('#cl-area').value,mgmt_fee_monthly:$('#cl-fee').value||undefined})});toast('הקלאסטר נוצר');route()}catch(e){toast(e.message)}}
async function adminToggleCluster(id){try{await api(`/admin/clusters/${id}/toggle`,{method:'POST',body:'{}'});route()}catch(e){toast(e.message)}}
async function adminAddFixedRoute(clid){try{await api(`/admin/clusters/${clid}/fixed-routes`,{method:'POST',body:JSON.stringify({courier_id:$('#fr-c-'+clid).value,weekday:$('#fr-w-'+clid).value})});toast('המסלול הקבוע נוסף');route()}catch(e){toast(e.message)}}
async function adminResolveDispute(id,action){try{await api(`/admin/earnings/${id}/resolve`,{method:'POST',body:JSON.stringify({action})});toast(action==='approve'?'התשלום אושר':'החיוב נדחה ונמחק');route()}catch(e){toast(e.message)}}
async function adminAutoBuild(){try{const r=await api('/admin/routes/auto-build',{method:'POST',body:'{}'});toast(r.routes.length?`נבנו ${r.routes.length} מסלולים`:'אין הזמנות לשיבוץ');route()}catch(e){toast(e.message)}}
async function adminCourier(id,a){try{await api(`/admin/couriers/${id}/${a}`,{method:'POST',body:'{}'});route()}catch(e){toast(e.message)}}
async function adminRejectCourier(id){
 const v=await xmodal({title:'דחיית שליח',body:'הסיבה תוצג לשליח ותאפשר לו להגיש בקשה מתוקנת.',okText:'דחייה',fields:[{id:'reason',label:'סיבת דחייה'}]});
 if(!v)return;
 if(!v.reason||!v.reason.trim())return toast('יש לציין סיבת דחייה');
 try{await api(`/admin/couriers/${id}/reject`,{method:'POST',body:JSON.stringify({reason:v.reason.trim()})});toast('השליח נדחה');route()}catch(e){toast(e.message)}
}
async function viewCourierDoc(id){
 try{
  const r=await fetch('/api/admin/courier-documents/'+id,{headers:{Authorization:'Bearer '+state.token}});
  if(!r.ok)throw new Error('שגיאה '+r.status);
  const b=await r.blob();window.open(URL.createObjectURL(b),'_blank');
 }catch(e){toast(e.message)}
}

async function adminOnboardStage(tid,stage){try{await api(`/admin/onboarding/${tid}/stage`,{method:'POST',body:JSON.stringify({stage})});toast('השלב עודכן');route()}catch(e){toast(e.message)}}
async function adminSlaHandle(id){const note=await xmodal({title:'טיפול בהתראה',body:'תיעוד הטיפול (רשות):',okText:'סימון כטופלה',fields:[{id:'note',label:'הערת טיפול'}]});if(!note)return;try{await api(`/admin/sla/${id}/handle`,{method:'POST',body:JSON.stringify({note:note.note||''})});toast('ההתראה טופלה');route()}catch(e){toast(e.message)}}
async function adminSlaReopen(id){try{await api(`/admin/sla/${id}/reopen`,{method:'POST',body:'{}'});toast('ההתראה נפתחה מחדש');route()}catch(e){toast(e.message)}}
async function adminRegisterCourier(){try{await api('/admin/couriers/register',{method:'POST',body:JSON.stringify({name:$('#rc-name').value,phone:$('#rc-phone').value,vehicle:$('#rc-vehicle').value,model:$('#rc-model').value,tenant_slug:$('#rc-tenant').value||undefined})});toast('השליח נרשם');go('#/admin/couriers')}catch(e){toast(e.message)}}

