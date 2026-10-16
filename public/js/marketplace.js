/* ---- marketplace ---- */
/* E13: חיפוש וסינון מתקדם — שירותים, דירוג, זמינות, מחיר לק״ג, שליחות חינם, מרחק ומיון */
function haversine(lat1,lng1,lat2,lng2){
 const R=6371,dLa=(lat2-lat1)*Math.PI/180,dLo=(lng2-lng1)*Math.PI/180;
 const a=Math.sin(dLa/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLo/2)**2;
 return 2*R*Math.asin(Math.sqrt(a));
}
function fmtDist(d){return d<1?Math.round(d*1000)+' מ׳':d.toFixed(1)+' ק״מ'}
function homeGeo(){
 if(!navigator.geolocation)return toast('הדפדפן לא תומך במיקום');
 toast('מאתר מיקום…');
 navigator.geolocation.getCurrentPosition(p=>{
  const geo={lat:p.coords.latitude,lng:p.coords.longitude};store.set('geo',geo);
  document.querySelectorAll('#home-grid .lcard').forEach(c=>{
   const lat=Number(c.dataset.lat),lng=Number(c.dataset.lng);
   if(c.dataset.lat&&!isNaN(lat)&&!isNaN(lng)){
    const d=haversine(geo.lat,geo.lng,lat,lng);c.dataset.dist=d;
    const sp=c.querySelector('.dist');if(sp)sp.textContent=' · '+fmtDist(d);
   }
  });
  const sel=document.getElementById('home-sort');
  if(sel){const op=sel.querySelector('option[value=dist]');if(op)op.disabled=false;sel.value='dist'}
  homeFilter();toast('המיקום עודכן — התוצאות ממוינות לפי קרבה');
 },()=>toast('לא הצלחנו לקבל מיקום — אשרו גישה למיקום בדפדפן'),{timeout:10000});
}
function homeFilterReset(){
 document.querySelectorAll('.home-side input[type=checkbox]:checked').forEach(x=>x.checked=false);
 const k=document.getElementById('hf-kg');if(k)k.value='';
 const s=document.getElementById('home-sort');if(s)s.value='rec';
 homeFilter();
}
async function vHome(q){
 /* E14.T3: התראת שינוי סטטוס בדף הבית (למשל "המכבסה אישרה") — מול תמונת הסטטוסים מהביקור הקודם */
 let orderNews=[];
 if(state.token){try{
  const om=await api('/orders/mine');
  const seen=store.get('orderStatus',{});
  orderNews=om.orders.filter(o=>seen[o.id]&&seen[o.id]!==o.status&&!['delivered','cancelled'].includes(seen[o.id])).slice(0,3);
  const snap={};om.orders.forEach(o=>{snap[o.id]=o.status});store.set('orderStatus',snap);
 }catch(e){}}
 /* E13.T8: היסטוריית חיפושים מקומית (עד 5) */
 if(q){let hs=store.get('searches',[]).filter(x=>x!==q);hs.unshift(q);store.set('searches',hs.slice(0,5))}
 let laundries=[],offlineData=false;
 try{const r=await api('/laundries'+(q?'?q='+encodeURIComponent(q):''));laundries=r.laundries;if(!q)store.set('homeCache',{laundries:laundries,ts:Date.now()})}
 catch(e){const c=store.get('homeCache',null);if(c&&c.laundries&&c.laundries.length){laundries=c.laundries;offlineData=true}else toast(e.message)}
 const geo=store.get('geo',null);
 const svcSet=[...new Set(laundries.flatMap(l=>l.services||[]))].sort();
 const distOf=l=>geo&&l.lat!=null&&l.lng!=null?haversine(geo.lat,geo.lng,l.lat,l.lng):null;
 return `<div class="hdr" style="text-align:center;padding-top:26px">
  <h1 class="big" style="margin:0">מכבסה בקליק</h1>
  <p style="font-size:13px">כל המכבסות באזורך — במקום אחד</p>
  <div class="searchbar" style="margin-top:14px"><input id="q" placeholder="מכבסה, עיר, שירות…" value="${esc(q||'')}" data-actk="searchEnter"><button class="go" data-act="homeSearch">חיפוש</button></div>
 </div>
 <div class="body">
  ${offlineData?'<div class="card warn" style="text-align:center">אין חיבור לרשת — מוצגת רשימת המכבסות שנשמרה במכשיר, וחלק מהפרטים עשויים להשתנות</div>':''}
  ${orderNews.map(n=>`<div class="card" style="background:#e8f7ee;border-color:#cbe9d6;cursor:pointer" data-act="goTo" data-a="#/orders/${n.id}"><b style="color:#178a4c">✓ ${esc(n.tenant_name)} — ההזמנה ${HE[n.status]||n.status}</b><div class="mut">לחצו לצפייה במעקב ההזמנה</div></div>`).join('')}
  <div style="margin:4px 2px 10px">
   <a class="chip ${!q?'on':''}" href="#/">הכל</a><a class="chip" href="#/?q=${encodeURIComponent('כביסה')}">כביסה</a><a class="chip" href="#/?q=${encodeURIComponent('ניקוי יבש')}">ניקוי יבש</a><a class="chip" href="#/?q=${encodeURIComponent('גיהוץ')}">גיהוץ</a><a class="chip" href="#/?q=${encodeURIComponent('שטיח')}">שטיחים</a>
  </div>
  ${!q&&store.get('searches',[]).length?`<div style="margin:0 2px 10px"><span class="mut">חיפושים אחרונים: </span>${store.get('searches',[]).map(h=>`<a class="chip" href="#/?q=${encodeURIComponent(h)}">${esc(h)}</a>`).join('')}<a href="#/" data-act="clearSearches" class="chip" style="color:#8a99a3">ניקוי ✕</a></div>`:''}
  ${laundries.length?`<div style="display:flex;gap:8px;align-items:center;margin:0 2px 10px">
   <button class="btn2 hf-mob" type="button" data-act="toggleSide">☰ סינון</button>
   <select id="home-sort" class="inp" style="margin:0;flex:1;padding:8px 10px;font-size:13px" data-actc="homeFilter">
    <option value="rec">מיון: מומלץ</option>
    <option value="price">מחיר — מהזול ליקר</option>
    <option value="rating">דירוג — מהגבוה לנמוך</option>
    <option value="open">פתוח עכשיו קודם</option>
    <option value="dist" ${geo?'':'disabled'}>מרחק — מהקרוב לרחוק</option>
   </select>
   <button class="btn2" type="button" data-act="homeGeo" title="חישוב מרחק מהמיקום שלי">📍 קרוב אליי</button>
  </div>`:''}
  <div class="home-wrap">
  <aside class="home-side"><h3>סינון <a href="#/" data-act="homeFilterReset" style="font-weight:400;font-size:11px;color:#0e7a8a">ניקוי</a></h3>
   ${svcSet.length?`<div class="sec">שירות</div>
   ${svcSet.map(sv=>`<label style="display:block;margin:4px 0;font-size:13px"><input type="checkbox" class="hf-svc" value="${esc(sv)}" data-actc="homeFilter"> ${esc(sv)}</label>`).join('')}`:''}
   <div class="sec">דירוג</div>
   <label style="display:block;margin:4px 0;font-size:13px"><input type="checkbox" class="hf-rate" value="3" data-actc="homeFilter"> 3★ ומעלה</label>
   <label style="display:block;margin:4px 0;font-size:13px"><input type="checkbox" class="hf-rate" value="4" data-actc="homeFilter"> 4★ ומעלה</label>
   <label style="display:block;margin:4px 0;font-size:13px"><input type="checkbox" class="hf-rate" value="4.5" data-actc="homeFilter"> 4.5★ ומעלה</label>
   <div class="sec">מחיר לק״ג</div>
   <select class="inp" id="hf-kg" style="margin:4px 0;font-size:13px;padding:8px 10px" data-actc="homeFilter">
    <option value="">הכל</option><option value="15">עד ₪15</option><option value="20">עד ₪20</option><option value="25">עד ₪25</option><option value="30">עד ₪30</option>
   </select>
   <div class="sec">זמינות ועלויות</div>
   ${store.get('favs',[]).length?`<label style="display:block;margin:4px 0;font-size:13px"><input type="checkbox" id="hf-fav" data-actc="homeFilter"> ★ המועדפים שלי</label>`:''}
   <label style="display:block;margin:4px 0;font-size:13px"><input type="checkbox" id="hf-open" data-actc="homeFilter"> פתוח עכשיו</label>
   <label style="display:block;margin:4px 0;font-size:13px"><input type="checkbox" id="hf-free" data-actc="homeFilter"> איסוף ומשלוח חינם</label>
  </aside>
  <div>
  <div class="mut" id="hf-count" style="margin:0 2px 8px"></div>
  <div class="home-grid" id="home-grid">
  ${laundries.map((l,i)=>{const dd=distOf(l);return `<a class="card lcard" data-idx="${i}" data-rating="${l.rating||0}" data-rc="${l.rating_count||0}" data-open="${openNow(l)?1:0}" data-services="${esc((l.services||[]).join('|'))}" data-fee="${Number(l.delivery_fee||0)}" data-kg="${l.from_kg!=null?Number(l.from_kg):''}" data-price="${l.from_price!=null?Number(l.from_price):''}" data-lat="${l.lat!=null?l.lat:''}" data-lng="${l.lng!=null?l.lng:''}" data-dist="${dd!=null?dd:''}" data-fav="${isFav(l.slug)?1:0}" href="#/laundry/${l.slug}" style="cursor:pointer;text-decoration:none;color:inherit">
    ${l.has_logo?`<img class="logo" loading="lazy" src="/api/laundries/${l.slug}/logo" style="object-fit:contain;background:#fff" alt="${esc(l.name)}">`:`<span class="logo" style="background:${cssColor(l.color)}">${esc(l.letter||l.name[0])}</span>`}
    <div style="flex:1">
     <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><b>${esc(l.name)}</b>${openNow(l)?'<span class="tag tg">פתוח</span>':'<span class="tag to">סגור</span>'}</div>
     <div class="mut" style="margin-top:3px">${l.rating_count>=3?`<span class="stars">★</span> ${l.rating} (${l.rating_count}) · `:`<span class="tag tb">חדש</span> · `}${esc(l.city||'')}${l.from_price?' · החל מ־₪'+l.from_price:''}<span class="dist">${dd!=null?' · '+fmtDist(dd):''}</span></div>
     <div class="mut">שליחות ₪${l.delivery_fee||0}${Number(l.min_order)>0?' · מינימום ₪'+l.min_order:''}</div>
    </div><span style="color:#8a99a3">‹</span></a>`}).join('')||`<div class="card mut">לא נמצאו מכבסות מתאימות${q?` — <a href="#/" style="color:#0e7a8a">נקה חיפוש</a>`:''}</div>`}
  </div>
  ${laundries.length?`<div class="card mut" id="hf-empty" style="display:none">אין מכבסות שמתאימות לסינון — <a href="#/" data-act="homeFilterReset" style="color:#0e7a8a">ניקוי סינון</a></div>`:''}
  </div></div>
  <div class="card" style="cursor:pointer;background:#e6f4f6;text-align:center" data-act="goTo" data-a="#/join"><b style="color:#0e7a8a">＋ יש לך מכבסה? הצטרפו לפלטפורמה — גם בצילום מחירון בלבד</b></div>
  ${state.me?`<div class="card mut" style="text-align:center">מחובר כ${esc(state.me.name||state.me.phone||state.me.email)} · <a href="#/" data-act="logout" style="color:#0e7a8a">התנתקות</a></div>`:''}
 </div>`;
}

/* E13: סינון + מיון משולבים (עובד גם בסרגל הדסקטופ וגם בפאנל המובייל) */
function homeFilter(){
 const grid=document.getElementById('home-grid');if(!grid)return;
 const svc=[...document.querySelectorAll('.hf-svc:checked')].map(x=>x.value);
 const rates=[...document.querySelectorAll('.hf-rate:checked')].map(x=>Number(x.value));
 const minRate=rates.length?Math.min(...rates):0;
 const openEl=document.getElementById('hf-open'),freeEl=document.getElementById('hf-free');
 const openOnly=openEl&&openEl.checked,freeDel=freeEl&&freeEl.checked;
 const kgEl=document.getElementById('hf-kg');
 const maxKg=kgEl&&kgEl.value?Number(kgEl.value):0;
 const sortEl=document.getElementById('home-sort');
 const sort=sortEl?sortEl.value:'rec';
 const cards=[...grid.querySelectorAll('.lcard')];
 let shown=0;
 cards.forEach(c=>{
  const r=Number(c.dataset.rating||0),o=c.dataset.open==='1',svcs=(c.dataset.services||'').split('|');
  const fee=Number(c.dataset.fee||0),kg=c.dataset.kg!==''?Number(c.dataset.kg):null;
  let ok=true;
  if(svc.length&&!svc.some(x=>svcs.includes(x)))ok=false;
  if(minRate&&r<minRate)ok=false;
  if(openOnly&&!o)ok=false;
  if(freeDel&&fee>0)ok=false;
  if(maxKg&&(kg===null||kg>maxKg))ok=false;
  const favEl=document.getElementById('hf-fav');
  if(favEl&&favEl.checked&&c.dataset.fav!=='1')ok=false;
  c.style.display=ok?'':'none';
  if(ok)shown++;
 });
 const key={rec:c=>Number(c.dataset.idx),
  price:c=>c.dataset.price!==''?Number(c.dataset.price):1e9,
  rating:c=>-(Number(c.dataset.rating||0)*10000+Number(c.dataset.rc||0)),
  open:c=>c.dataset.open==='1'?0:1,
  dist:c=>c.dataset.dist!==''?Number(c.dataset.dist):1e9}[sort];
 if(key)[...cards].sort((a,b)=>key(a)-key(b)).forEach(c=>grid.appendChild(c));
 const cnt=document.getElementById('hf-count');
 if(cnt)cnt.textContent=shown?shown+' מכבסות':'';
 const emp=document.getElementById('hf-empty');
 if(emp)emp.style.display=shown?'none':'block';
}

async function vLaundry(slug){
 let d;
 try{d=await api('/laundries/'+slug)}catch(e){return `<div class="body"><div class="card">${esc(e.message)}</div></div>`}
 const l=d.laundry;
 let mySub=null;
 if(state.token){try{const sm=await api('/subscriptions/mine');mySub=sm.subscriptions.find(x=>x.slug===slug&&x.status!=='cancelled')}catch(e){}}
 const cartItems=state.cart.filter(c=>c.slug===slug);
 const cartTotal=cartItems.reduce((s,c)=>s+c.price*c.qty,0);
 /* E14.T2: השוואת מחירים מול מכבסות אחרות (אותו פריט, אותה יחידה) */
 let cmp={};
 try{const cd=await api('/laundries/'+slug+'/price-compare');cmp=cd.compare||{}}catch(e){}
 /* E13.T4: מחירון מקובץ לקטגוריות עם קפיצה וחיפוש */
 const cats=[];const byCat={};
 d.items.forEach(it=>{const c=it.category||'כללי';if(!byCat[c]){byCat[c]=[];cats.push(c)}byCat[c].push(it)});
 const winTxt=kind=>{
  const m={};(d.windows||[]).filter(w=>w.kind===kind&&w.weekday!==6).forEach(w=>{(m[w.weekday]=m[w.weekday]||[]).push(w.start_time.slice(0,5)+'–'+w.end_time.slice(0,5))});
  const out=Object.keys(m).sort().map(k=>WD[k]+': <span dir="ltr">'+m[k].join(', ')+'</span>').join(' · ');
  return out||'—';
 };
 return `<div class="hdr">
  <div style="display:flex;gap:12px;align-items:center">
   <a href="#/" style="color:#fff;font-size:20px;text-decoration:none" aria-label="חזרה">→</a>
   ${l.has_logo?`<img class="logo" src="/api/laundries/${slug}/logo" style="object-fit:contain;background:#fff" alt="${esc(l.name)}">`:`<span class="logo" style="background:${cssColor(l.color)}">${esc(l.letter||l.name[0])}</span>`}
   <div style="flex:1"><h2>${esc(l.name)}</h2><p>${l.rating_count>=3?`<span class="stars">★</span> ${l.rating} (${l.rating_count} ביקורות) · `:`<span class="tag tb">מכבסה חדשה</span> · `}${esc(l.city||'')} · ${openNow(l)?'פתוח':'סגור'}</p></div>
   <button id="fav-btn" data-act="toggleFav" data-a="${esc(slug)}" data-b="${esc(l.name)}" data-c="${esc(cssColor(l.color))}" data-d="${esc(l.letter||l.name[0])}" style="background:rgba(255,255,255,.18);border:none;color:#ffd34d;border-radius:9px;padding:8px 11px;cursor:pointer;font-family:inherit;font-size:14px;flex-shrink:0" title="שמירה למועדפים">${isFav(slug)?'★':'☆'}</button>
   <button data-act="shareLaundry" data-a="${esc(l.name)}" style="background:rgba(255,255,255,.18);border:none;color:#fff;border-radius:9px;padding:8px 11px;cursor:pointer;font-family:inherit;font-size:14px;flex-shrink:0" title="שיתוף המכבסה">⤴</button>
  </div>
 </div>
 <div class="body">
  ${!l.is_open?`<div class="card warn" style="text-align:center"><b>המכבסה סגורה כרגע</b><div style="margin-top:2px">אפשר לעיין במחירון — הזמנה תהיה אפשרית כשהמכבסה תיפתח</div></div>`:!openNow(l)?`<div class="card warn" style="text-align:center"><b>מחוץ לשעות הפעילות כרגע</b><div style="margin-top:2px">אפשר להזמין — האיסוף יתואם לשעות הפעילות הקרובות</div></div>`:''}
  ${(l.services&&l.services.length)?`<div style="margin:0 2px 8px">${l.services.map(sv=>`<span class="tag tb" style="margin-left:4px;padding:3px 10px">${esc(sv)}</span>`).join('')}</div>`:''}
  <div class="subtabs"><button class="chip on" type="button">מחירון</button><button class="chip" type="button" data-act="scrollTo" data-a="info">מידע</button><button class="chip" type="button" data-act="scrollTo" data-a="revs">ביקורות</button></div>
  <div class="mut" style="margin:0 2px 8px">שליחות ₪${l.delivery_fee||0}${Number(l.min_order)>0?' · מינימום הזמנה ₪'+l.min_order:''}</div>
  ${d.items.length>6?`<input class="inp" id="pl-search" placeholder="חיפוש במחירון…" data-acti="plFilter">`:''}
  ${cats.length>1?`<div style="margin:0 0 6px">${cats.map((c,i)=>`<a class="chip" style="cursor:pointer" data-act="scrollTo" data-a="pcat-${i}">${esc(c)}</a>`).join('')}</div>`:''}
  ${cats.map((c,ci)=>`${cats.length>1?`<div class="sec" id="pcat-${ci}">${esc(c)}</div>`:''}
  <div class="card">
   ${byCat[c].map(it=>{const cr=state.cart.find(x=>x.item_id===it.id);const cp=cmp[it.name+'|'+it.unit];return `<div class="row pl-row" data-name="${esc(it.name)}">
     <div><b>${esc(it.name)}</b><div class="mut">₪${it.price}${it.unit==='item'?'':' ל'+unitLbl(it.unit)}${it.agreement_price?' · מחיר הסכם':''}</div>${cp?`<a href="#/laundry/${cp.slug}" style="text-decoration:none"><span class="tag tg" style="margin-top:3px">זול יותר ב־₪${cp.other_price} ב${esc(cp.laundry_name)}</span></a>`:''}</div>
     ${cr?`<span class="stepper"><button data-act="setQty" data-a="${esc(slug)}" data-b="${esc(it.id)}" data-c="-1">−</button><b>${cr.qty}</b><button data-act="setQty" data-a="${esc(slug)}" data-b="${esc(it.id)}" data-c="1">+</button></span>`
        :`<button class="btn2" data-act="setQty" data-a="${esc(slug)}" data-b="${esc(it.id)}" data-c="1">הוספה</button>`}
    </div>`}).join('')}
  </div>`).join('')||'<div class="card mut">המחירון טרם הוזן</div>'}
  <div class="card mut" id="pl-empty" style="display:none;text-align:center">אין פריטים שמתאימים לחיפוש במחירון</div>
  ${cartItems.length?`<div style="position:sticky;bottom:10px;z-index:20;margin-top:4px">`+(cartTotal>=Number(l.min_order||0)?`<button class="btn" style="box-shadow:0 4px 14px rgba(14,122,138,.35)" data-act="goTo" data-a="#/checkout/${slug}">להזמנה · סל ₪${cartTotal}</button>`:`<button class="btn" disabled style="opacity:.85;cursor:not-allowed;box-shadow:0 4px 14px rgba(0,0,0,.18)">חסרים ₪${Number(l.min_order)-cartTotal} למינימום הזמנה (₪${l.min_order}) · סל ₪${cartTotal}</button>`)+`</div>`:''}
  ${(d.plans&&d.plans.length)||mySub?`<div class="sec">מנוי כביסה חודשי</div>
  <div class="card">
   ${mySub?`<div class="row"><div><b>יש לך ${esc(mySub.plan_name)}</b> ${mySub.status==='paused'?'(מושהה)':''}<div class="mut">נותרו ${fmtQ(mySub.bags_remaining)} שקים החודש · מתחדש ${fmtDate(mySub.period_end)}</div></div><a class="btn2" href="#/club" style="text-decoration:none">ניהול המנוי</a></div>`
    :(d.plans||[]).map(p=>`<div class="row"><div><b>${esc(p.name)}</b><div class="mut">${p.bags_per_month} שקים בחודש (עד ${fmtQ(p.kg_per_bag)} ק״ג לשק) · איסוף והחזרה חינם${p.extra_bag_price?' · שק חורג ₪'+p.extra_bag_price:''}${p.perks?' · '+esc(p.perks):''}</div></div><div style="text-align:center"><b>₪${p.price}</b><div class="mut">לחודש</div></div><button class="btn2 on" data-act="joinPlan" data-a="${esc(slug)}" data-b="${esc(p.id)}">הצטרפות</button></div>`).join('')}
  </div>`:''}
  <div class="sec" id="info">מידע</div>
  <div class="card mut" style="line-height:1.8">
   שעות פעילות:<br>${Object.entries(l.hours||{}).map(([k,v])=>v&&v.length?`${WD[k]}: ${v.map(r=>'<span dir="ltr">'+r.map(x=>esc(x)).join('–')+'</span>').join(', ')}`:null).filter(Boolean).join('<br>')||'—'}<br>
   <span style="color:#17303a;font-weight:700">חלונות איסוף:</span> ${winTxt('pickup')}<br>
   <span style="color:#17303a;font-weight:700">חלונות החזרה:</span> ${winTxt('delivery')}<br>
   ${l.address?`כתובת: ${esc(l.address)}${l.city?', '+esc(l.city):''}<br>`:''}
   ${l.phone?`טלפון: <a href="tel:${esc(l.phone)}" style="color:#0e7a8a" dir="ltr">${esc(l.phone)}</a><br>`:''}
   ${l.terms?`תקנון: ${esc(l.terms)}`:''}
  </div>
  <div class="sec" id="revs">ביקורות</div>
  <div class="card">${d.reviews.map(rv=>`<div class="row"><div><b>${esc(rv.author||'לקוח')}</b> <span class="stars">${'★'.repeat(rv.rating)}</span><div class="mut">${esc(rv.text||'')}</div>${(rv.tags&&rv.tags.length)?`<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:3px">${rv.tags.map(t=>`<span class="tag tg">${esc(t)}</span>`).join('')}</div>`:''}</div></div>`).join('')||'<div class="mut">עוד אין ביקורות</div>'}</div>
  ${state.brandSlug===slug?`<div style="text-align:center;font-size:11px;color:#8a99a3;padding:2px 0 10px">מופעל ע״י מכבסה בקליק</div>`:''}
 </div>`;
}
/* E13.T4: חיפוש חי במחירון */
function plFilter(txt){
 const t=(txt||'').trim();
 let shown=0;
 document.querySelectorAll('.pl-row').forEach(r=>{const ok=!t||r.dataset.name.includes(t);r.style.display=ok?'':'none';if(ok)shown++});
 const emp=document.getElementById('pl-empty');
 if(emp)emp.style.display=shown?'none':'block';
}
/* E14.T4: שיתוף פרטי הזמנה (סיכום טקסטואלי + קישור; הקישור דורש התחברות של בעל ההזמנה) */
async function shareOrder(id){
 try{
  const d=await api('/orders/'+id);const o=d.order;
  const txt=`הזמנה ב${o.tenant_name} (${fmtDT(o.created_at)}) · סטטוס: ${HE[o.status]||o.status} · סה״כ ₪${o.total}`;
  const url=location.origin+'/#/orders/'+id;
  if(navigator.share){await navigator.share({title:'ההזמנה שלי במכבסה בקליק',text:txt,url:url});return}
  await navigator.clipboard.writeText(txt+'\n'+url);toast('פרטי ההזמנה הועתקו לשיתוף');
 }catch(e){if(e&&e.name!=='AbortError')toast('לא ניתן לשתף כרגע')}
}
/* E13.T6: מועדפים — שמירה מקומית, סימון בדף מכבסה וסינון בבית */
function isFav(slug){return store.get('favs',[]).some(f=>f.slug===slug)}
function toggleFav(slug,name,color,letter){
 let f=store.get('favs',[]);
 if(f.some(x=>x.slug===slug)){f=f.filter(x=>x.slug!==slug);toast('הוסר מהמועדפים')}
 else{f.push({slug:slug,name:name,color:color,letter:letter});toast('נשמר במועדפים ★')}
 store.set('favs',f);
 const b=document.getElementById('fav-btn');if(b)b.textContent=isFav(slug)?'★':'☆';
}
/* E13.T4: שיתוף דף מכבסה */
async function shareLaundry(name){
 const url=location.href;
 try{
  if(navigator.share){await navigator.share({title:name,text:name+' — הזמנת כביסה במכבסה בקליק',url:url});return}
  await navigator.clipboard.writeText(url);toast('הקישור הועתק — אפשר לשלוח לחברים');
 }catch(e){if(e&&e.name!=='AbortError')toast('לא ניתן לשתף כרגע')}
}
function setQty(slug,itemId,delta){
 api('/laundries/'+slug).then(d=>{
  const it=d.items.find(x=>x.id===itemId);if(!it)return;
  let c=state.cart.find(x=>x.item_id===itemId);
  if(!c){c={slug,item_id:itemId,name:it.name,price:Number(it.price),unit:it.unit,qty:0};state.cart.push(c)}
  c.qty+=delta;if(c.qty<=0)state.cart=state.cart.filter(x=>x!==c);
  save();route();
 });
}




/* B7: רישום פעולות להאזנה המרכזת (delegate.js) — בלי inline handlers */
onAct({
 toggleFav:t=>toggleFav(t.dataset.a,t.dataset.b,t.dataset.c,t.dataset.d),
 shareLaundry:t=>shareLaundry(t.dataset.a),
 goTo:t=>go(t.dataset.a),
 scrollTo:t=>{const x=document.getElementById(t.dataset.a);if(x)x.scrollIntoView({behavior:'smooth'})},
 setQty:t=>setQty(t.dataset.a,t.dataset.b,Number(t.dataset.c)),
 joinPlan:t=>joinPlan(t.dataset.a,t.dataset.b),
 homeSearch:()=>go('#/?q='+encodeURIComponent($('#q').value)),
 clearSearches:()=>{store.set('searches',[]);route()},
 toggleSide:()=>{const sd=document.querySelector('.home-side');if(sd)sd.classList.toggle('open')},
 homeGeo:()=>homeGeo(),
 homeFilterReset:()=>homeFilterReset(),
 logout:()=>logout(),
 homeFilter:()=>homeFilter(),
 plFilter:t=>plFilter(t.value),
 searchEnter:(t,e)=>{if(e.key==='Enter')go('#/?q='+encodeURIComponent(t.value))},
});
