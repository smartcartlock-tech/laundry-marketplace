/* ---- checkout ---- */
/* T117: פורמטים אחידים למסכי לקוח (checkout/orders/track/messages) — ₪ עם מפריד אלפים, תאריך dd/mm/yyyy */
function fmtShekel(n){return '₪'+Number(n||0).toLocaleString('he-IL',{maximumFractionDigits:2})}
function fmtDMY(s){if(!s)return '—';return new Date(s).toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'Asia/Jerusalem'})}
function fmtDMYT(s){if(!s)return '—';const d=new Date(s);return d.toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'Asia/Jerusalem'})+' '+d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Jerusalem'})}
function feeLbl(f){return Number(f||0)>0?fmtShekel(f):'משלוח חינם'}
async function vCheckout(slug){
 if(!state.token)return needLogin();
 window.__coCoupon=null;
 const d=await api('/laundries/'+slug);
 const l=d.laundry;
 window.__coWin=d.windows||[];window.__coTurn=Number(l.turnaround_hours)||24; // T106
 const items=state.cart.filter(c=>c.slug===slug);
 if(!items.length){go('#/laundry/'+slug);return ''}
 const subtotal=items.reduce((s,c)=>s+c.price*c.qty,0);
 let mySub=null;
 // E13.T2: כתובות שמורות
 try{const ar=await api('/addresses');__coAddrs=ar.addresses||[]}catch(e){__coAddrs=[]}
 try{const sm=await api('/subscriptions/mine');mySub=sm.subscriptions.find(x=>x.slug===slug&&x.status==='active'&&Number(x.bags_remaining)>0)}catch(e){}
 const eligQty=items.filter(c=>{const it=d.items.find(i=>i.id===c.item_id);return it&&it.subscription_eligible}).reduce((s2,c)=>s2+c.qty,0);
 let points=0;
 try{const cl=await api('/orders/club/summary');const b=cl.balances.find(x=>x.slug===slug);points=b?b.balance:0}catch(e){}
 const maxRedeem=Math.min(points,Math.floor(subtotal*(l.points_redeem_max_pct??0.2)));
 const winOpts=kind=>d.windows.filter(w=>w.kind===kind&&w.weekday!==6).map(w=>{const dt=new Date(nextWindowDate(w.weekday,w.start_time));const dstr=dt.toLocaleDateString('he-IL',{day:'numeric',month:'numeric'});return `<option value="${w.weekday}|${w.start_time}">${WD[w.weekday]} ${dstr} · \u2066${w.start_time.slice(0,5)}–${w.end_time.slice(0,5)}\u2069</option>`}).join('');
 return `<div class="hdr"><h2><a href="#/laundry/${slug}" style="color:#fff;text-decoration:none" aria-label="חזרה">→</a> הזמנה — ${esc(l.name)}</h2></div>
 <div class="body">
  <div class="card">
   ${items.map(c=>`<div class="row"><div>${esc(c.name)}</div><div>${fmtQ(c.qty)} ${unitLbl(c.unit,c.qty)} × ${fmtShekel(c.price)}</div></div>`).join('')}
   <div class="row"><div class="mut">סכום ביניים</div><div>${fmtShekel(subtotal)}</div></div>
   <div class="row"><div class="mut">שליחות</div><div>${feeLbl(l.delivery_fee)}</div></div>
   <div class="row" id="co-coupon-row" style="display:none"><div class="mut">הנחת קופון <b id="co-coupon-code"></b></div><div id="co-coupon-disc" style="color:#0a7">−₪0</div></div>
   <div class="row" id="co-discount-row" style="display:none"><div class="mut">הנחת נקודות</div><div id="co-discount">−₪0</div></div>
   <div class="row" style="border-top:2px solid #d3e8ec"><b>סה״כ לתשלום</b><b id="co-total" style="font-size:17px" data-subtotal="${subtotal}" data-fee="${Number(l.delivery_fee||0)}" data-points="${points}" data-pct="${l.points_redeem_max_pct??0.2}" data-base="${subtotal+Number(l.delivery_fee||0)}" data-redeem="${maxRedeem}" data-noneligible="${items.filter(c=>{const it=d.items.find(i=>i.id===c.item_id);return !it||!it.subscription_eligible}).reduce((s2,c)=>s2+c.price*c.qty,0)}" data-subremaining="${mySub?mySub.bags_remaining:0}" data-extrabag="${mySub&&mySub.extra_bag_price!==null&&mySub.extra_bag_price!==undefined?mySub.extra_bag_price:''}">${fmtShekel(subtotal+Number(l.delivery_fee||0))}</b></div>
   <div class="row"><div class="mut">יש קופון?</div><div style="display:flex;gap:6px"><input class="inp" id="co-coupon" placeholder="קוד קופון" style="margin:0;flex:1"><button class="btn2 on" data-act="applyCoupon" data-a="${esc(slug)}">החלה</button></div></div>
   <div id="co-coupon-msg" class="mut" style="display:none;margin-top:4px"></div>
   ${mySub&&eligQty>0?`<div class="row" id="co-sub-row"><div class="mut">מנוי: ${esc(mySub.plan_name)} · נותרו ${fmtQ(mySub.bags_remaining)} שקים</div><label style="font-size:13px"><input type="checkbox" id="co-sub" data-actc="updTotal"> שלם עם המנוי — פריטים מכוסים ב־₪0, איסוף חינם</label></div>`:''}
   ${points>0?`<div class="row"><div class="mut">נקודות במכבסה זו: ${points}</div><div>${maxRedeem>0?`<label style="font-size:12px"><input type="checkbox" id="redeem" data-actc="updTotal"><span id="co-redeem-lbl"> מימוש ${maxRedeem} נקודות (−${fmtShekel(maxRedeem)})</span></label>`:'<span class="mut">אין נקודות למימוש כאן</span>'}</div></div>`:''}
  </div>
  <div class="card">
   ${__coAddrs.length?`<label class="lb">כתובות שמורות</label>
   <div style="display:flex;gap:6px">
    <select class="inp" id="co-saved-addr" style="margin-bottom:6px;flex:1" data-actc="pickAddr">
     <option value="">כתובת חדשה…</option>
     ${__coAddrs.map(a=>`<option value="${a.id}">${esc(a.label)} — ${esc(a.address)}</option>`).join('')}
    </select>
    <button class="btn2" id="co-del-addr" style="display:none;margin-bottom:6px" data-act="delAddr">מחיקה</button>
   </div>`:''}
   <label class="lb">כתובת לאיסוף והחזרה</label>
   <input class="inp" id="co-address" placeholder="רחוב, מספר, עיר" data-acti="clearAddrErr">
   <div id="co-save-wrap">
    <label style="font-size:12.5px"><input type="checkbox" id="co-save-addr" checked> שמירת הכתובת לפעם הבאה</label>
    <input class="inp" id="co-addr-label" placeholder="תווית לכתובת (בית, עבודה…)" style="margin-top:6px">
   </div>
   <label class="lb">חלון איסוף</label>
   <select class="inp" id="co-pickup" data-actc="updEta"><option value="">ללא העדפה</option>${winOpts('pickup')}</select>
   <label class="lb">חלון החזרה (אופציונלי)</label>
   <select class="inp" id="co-delivery" data-actc="updEta"><option value="">ללא העדפה</option>${winOpts('delivery')}</select>
   <div class="mut" id="co-eta" style="margin-top:2px;color:#0e7a8a;font-weight:600">${coEtaText(d.windows||[],Number(l.turnaround_hours)||24,'','')}</div>
   <label class="lb">אמצעי תשלום</label>
   <select class="inp" id="co-pay"><option value="cash">מזומן לשליח</option><option value="demo_online">תשלום מקוון (דמו — ללא סליקה אמיתית)</option></select>
   <div class="mut">בבחירת תשלום מקוון בדמו, שליחת ההזמנה תאשר גם את תשלום הדמו. אין חיוב אמיתי ואין צורך בפרטי כרטיס.</div>
   <label class="lb">הערות</label>
   <input class="inp" id="co-notes" placeholder="כתם עקשן, קומה, קוד שער…">
  </div>
  <button class="btn" id="co-submit" data-act="submitOrder" data-a="${esc(slug)}">אישור הזמנה</button>
 </div>`;
}
function updTotal(){
 const t=$('#co-total');if(!t)return;
 const subtotal=Number(t.dataset.subtotal),fee=Number(t.dataset.fee),points=Number(t.dataset.points),pct=Number(t.dataset.pct);
 const coupon=window.__coCoupon?Number(window.__coCoupon.discount):0;
 const remaining=Math.max(0,subtotal-coupon);
 const maxRedeem=Math.min(points,Math.floor(remaining*pct));
 const lbl=$('#co-redeem-lbl');if(lbl)lbl.textContent=' מימוש '+maxRedeem+' נקודות (−'+fmtShekel(maxRedeem)+')';
 const on=$('#redeem')&&$('#redeem').checked;
 const subOn=$('#co-sub')&&$('#co-sub').checked;
 const pdisc=on&&!subOn?maxRedeem:0;
 $('#co-discount').textContent='−'+fmtShekel(pdisc);$('#co-discount-row').style.display=pdisc?'flex':'none';
 $('#co-coupon-disc').textContent='−'+fmtShekel(coupon);$('#co-coupon-row').style.display=coupon?'flex':'none';
 if(subOn){
  const nonElig=Number(t.dataset.noneligible),rem=Number(t.dataset.subremaining);
  const elig=Math.max(0,subtotal-Number(t.dataset.noneligible)); // הערכה בלבד — החישוב המחייב בשרת
  t.textContent='~'+fmtShekel(Math.max(0,nonElig-coupon))+' (במנוי)';
 }else t.textContent=fmtShekel(Math.max(0,subtotal+fee-coupon-pdisc));
}
async function applyCoupon(slug){
 const inp=$('#co-coupon'),msg=$('#co-coupon-msg');const code=inp.value.trim();if(!code)return;
 const t=$('#co-total');
 try{
  const r=await api('/orders/validate-coupon',{method:'POST',body:JSON.stringify({slug,code,subtotal:Number(t.dataset.subtotal)})});
  window.__coCoupon={code,discount:r.discount};
  $('#co-coupon-code').textContent=code.toUpperCase();
  msg.style.display='block';msg.style.color='#0a7';msg.textContent='הקופון הוחל: הנחה של ₪'+r.discount;
  updTotal();
 }catch(e){
  window.__coCoupon=null;
  msg.style.display='block';msg.style.color='#c22';msg.textContent=e.message||'קופון לא תקף';
  updTotal();
 }
}
let __coAddrs=[];
function pickAddr(sel){
 const a=__coAddrs.find(x=>x.id===sel.value);
 const inp=$('#co-address'),wrap=$('#co-save-wrap'),del=$('#co-del-addr');
 if(a){if(inp)inp.value=a.address;if(wrap)wrap.style.display='none';if(del)del.style.display=''}
 else{if(wrap)wrap.style.display='block';if(del)del.style.display='none'}
}
async function delAddr(){
 const sel=$('#co-saved-addr');if(!sel||!sel.value)return;
 if(!await xconfirm('למחוק את הכתובת השמורה?',{okText:'מחיקה'}))return;
 try{
  await api('/addresses/'+sel.value,{method:'DELETE'});
  __coAddrs=__coAddrs.filter(x=>x.id!==sel.value);
  const op=sel.querySelector('option[value="'+sel.value+'"]');if(op)op.remove();
  sel.value='';pickAddr(sel);toast('הכתובת נמחקה');
 }catch(e){toast(e.message)}
}

/* T117: מסך 'ההזמנה התקבלה!' — אישור ברור + סיכום + ציפיות, מיד אחרי שליחה מוצלחת */
async function showOrderSuccess(orderId){
 let o;try{o=(await api('/orders/'+orderId)).order}catch(e){go('#/orders/'+orderId);return}
 if(!o){go('#/orders/'+orderId);return}
 history.replaceState(null,'','#/orders/'+orderId); // ה-URL משקף את ההזמנה החדשה (רענון/שיתוף תקינים) בלי רינדור מחדש של מסך ההצלחה
 $('#app').innerHTML=`<div class="hdr"><h2>ההזמנה התקבלה! 🎉</h2><p>${esc(o.tenant_name)}</p></div>
 <div class="body">
  <div class="card" style="text-align:center">
   <div style="font-size:40px">✅</div>
   <b>הזמנה <span dir="ltr">#${o.id.slice(0,8)}</span> נקלטה</b>
   <div class="mut" style="margin-top:4px">המכבסה קיבלה את ההזמנה ומטפלת באישור — נעדכן בכל שינוי סטטוס.</div>
  </div>
  <div class="card"><b>סיכום</b>
   <div class="row"><div class="mut">מכבסה</div><div>${esc(o.tenant_name)}</div></div>
   <div class="row"><div class="mut">סה״כ לתשלום</div><div>${fmtShekel(o.total)}</div></div>
   <div class="row"><div class="mut">איסוף</div><div>${o.pickup_at?fmtDMYT(o.pickup_at):'ללא העדפה — המכבסה תתאם'}</div></div>
   ${o.delivery_at?`<div class="row"><div class="mut">החזרה</div><div>${fmtDMYT(o.delivery_at)}</div></div>`:''}
   <div class="row"><div class="mut">תשלום</div><div>${o.payment_method==='cash'?'מזומן לשליח':'מקוון (דמו — ללא חיוב אמיתי)'}</div></div>
   <div class="row"><div class="mut">כתובת</div><div>${esc(o.address)}</div></div>
  </div>
  <div class="card mut">מה הלאה? המכבסה מאשרת ← שליח אוסף בחלון שבחרתם ← הכביסה בעבודה ← חוזרת עד אליכם. אפשר לעקוב בכל רגע.</div>
  <button class="btn" data-act="orderSuccessTrack" data-a="${esc(o.id)}">מעקב אחר ההזמנה</button>
  <button class="btn2" style="width:100%;margin-top:6px" data-act="goHome">חזרה לדף הבית</button>
 </div>`;
 window.scrollTo(0,0);
}
let __submitting=false;
async function submitOrder(slug){
 if(!state.token)return needLogin();
 if(__submitting)return; // נעילה נגד דאבל-קליק
 __submitting=true;
 const btn=$('#co-submit');const orig=btn&&btn.textContent;
 if(btn){btn.disabled=true;btn.style.opacity='.6';btn.textContent='שולח…'}
 const kill=setTimeout(()=>{__submitting=false;if(btn){btn.disabled=false;btn.style.opacity='';btn.textContent=orig};toast('השליחה לוקחת זמן רק מהרגיל — אם ההזמנה לא אושרה, נסו שוב')},30000);
 try{
  const items=state.cart.filter(c=>c.slug===slug).map(c=>({item_id:c.item_id,qty:c.qty}));
  const addrEl=$('#co-address');const address=addrEl.value.trim();
  if(!address){addrEl.style.borderColor='#c22';let ie=$('#co-address-err');if(!ie){ie=document.createElement('div');ie.id='co-address-err';ie.className='mut';ie.style.color='#c22';ie.textContent='חסרה כתובת לאיסוף והחזרה';addrEl.after(ie)}addrEl.focus();return}
  addrEl.style.borderColor='';const ie=$('#co-address-err');if(ie)ie.remove();
  const w=($('#co-pickup').value||'').split('|');
  const pickup_at=w.length===2?nextWindowDate(Number(w[0]),w[1]):null;
  const w2=($('#co-delivery')&&$('#co-delivery').value||'').split('|');
  const delivery_at=w2.length===2?nextWindowDate(Number(w2[0]),w2[1]):null;
  const body={slug,items,address,pickup_at,delivery_at,payment_method:$('#co-pay').value,redeem_points:!!($('#redeem')&&$('#redeem').checked),coupon_code:window.__coCoupon?window.__coCoupon.code:undefined,notes:$('#co-notes').value.trim(),use_subscription:!!($('#co-sub')&&$('#co-sub').checked),source:state.brandSlug===slug?'branded':undefined};
  const r=await Promise.race([api('/orders',{method:'POST',body:JSON.stringify(body)}),new Promise((_,rej)=>setTimeout(()=>rej(new Error('פג הזמן — בדקו חיבור ונסו שוב')),25000))]);
  try{const sv=$('#co-save-addr');
   if(sv&&sv.checked)await api('/addresses',{method:'POST',body:JSON.stringify({address,label:($('#co-addr-label')?$('#co-addr-label').value.trim():'')||'בית'})});
  }catch(e){/* שמירת כתובת לא מפילה הזמנה שכבר נקלטה */}
  state.cart=state.cart.filter(c=>c.slug!==slug);save();
  showOrderSuccess(r.order.id);
 }catch(e){toast(e.message)}
 finally{clearTimeout(kill);__submitting=false;if(btn){btn.disabled=false;btn.style.opacity='';btn.textContent=orig}}
}




/* T106: צפי החזרה בצ'ק-אאוט — מראי מחשב של לוגיקת src/eta.js בצד לקוח */
function etaDayLabel(dt){
 const a=new Date(dt);a.setHours(0,0,0,0);const n=new Date();n.setHours(0,0,0,0);
 const diff=Math.round((a-n)/86400e3);
 const day=diff===0?'היום':diff===1?'מחר':WD[dt.getDay()];
 return day+' עד '+String(dt.getHours()).padStart(2,'0')+':'+String(dt.getMinutes()).padStart(2,'0');
}
function coEtaText(wins,turn,pickupVal,deliveryVal){
 if(deliveryVal){
  const [wd,st]=deliveryVal.split('|');
  const w=(wins||[]).find(x=>x.kind==='delivery'&&String(x.weekday)===wd&&x.start_time.slice(0,5)===st);
  if(w)return 'צפי החזרה: '+etaDayLabel(new Date(nextWindowDate(Number(wd),w.end_time.slice(0,5))));
 }
 let base=new Date();
 if(pickupVal){const [wd,st]=pickupVal.split('|');const pdt=new Date(nextWindowDate(Number(wd),st));if(pdt>base)base=pdt;}
 const earliest=new Date(base.getTime()+(Number(turn)||24)*3600e3);
 let best=null;
 for(const w of wins||[]){
  if(w.kind!=='delivery'||w.weekday===6)continue;
  const dt=new Date(nextWindowDate(w.weekday,w.end_time.slice(0,5)));
  if(dt>earliest&&(!best||dt<best))best=dt;
 }
 return best?'צפי החזרה: '+etaDayLabel(best):'צפי החזרה: לתיאום עם המכבסה';
}
function updEta(){
 const el=$('#co-eta');if(!el)return;
 el.textContent=coEtaText(window.__coWin||[],window.__coTurn||24,($('#co-pickup')||{}).value||'',($('#co-delivery')||{}).value||'');
}

/* B7: רישום פעולות להאזנה המרכזת (delegate.js) — בלי inline handlers */
onAct({
 updEta:()=>updEta(),
 applyCoupon:t=>applyCoupon(t.dataset.a),
 delAddr:()=>delAddr(),
 submitOrder:t=>submitOrder(t.dataset.a),
 orderSuccessTrack:t=>go('#/orders/'+t.dataset.a),
 updTotal:()=>updTotal(),
 pickAddr:t=>pickAddr(t),
 clearAddrErr:t=>{t.style.borderColor='';const er=document.getElementById('co-address-err');if(er)er.remove()},
});
