/* ---- E10.T2: דף תשלום דמו (pay link) ---- */
async function vPay(orderId){
 let d;
 try{d=await api('/pay/'+orderId)}catch(e){return `<div class="hdr"><h2>תשלום</h2></div><div class="body"><div class="card warn">${esc(e.message)}</div></div>`}
 const o=d.order;
 if(o.payment_status!=='pending')return `<div class="hdr" style="text-align:center"><div class="big">מכבסה בקליק</div></div>
  <div class="body"><div class="card" style="text-align:center"><div style="font-size:40px">✅</div>
   <b>${o.payment_status==='paid_demo'?'תשלום הדמו אושר':'ההזמנה #'+esc(o.short)+' כבר שולמה'}</b>${o.payment_status==='paid_demo'?'<div class="mut" style="margin-top:4px">לא בוצע חיוב אמיתי. זהו אישור להדגמה בלבד.</div>':''}<div class="mut" style="margin:6px 0">${esc(o.tenant_name)} · ₪${o.total}</div>
   <button class="btn2" data-act="openPdfPublic" data-a="/pay/${o.id}/receipt.pdf">הורדת קבלה (PDF)</button></div></div>`;
 if(!d.payable)return `<div class="hdr" style="text-align:center"><div class="big">מכבסה בקליק</div></div>
  <div class="body"><div class="card mut" style="text-align:center">לא ניתן לשלם על הזמנה זו (סטטוס: ${HE[o.status]||o.status})</div></div>`;
 return `<div class="hdr" style="text-align:center"><div class="big">תשלום מאובטח</div><p>הזמנה #${o.short} · ${esc(o.tenant_name)}</p></div>
 <div class="body">
  <div class="card">
   ${d.items.map(it=>`<div class="row"><div>${esc(it.name)}</div><div>${fmtQ(it.qty)} × ₪${it.price}</div></div>`).join('')}
   <div class="row"><div class="mut">שליחות</div><div>₪${o.delivery_fee}</div></div>
   ${Number(o.discount)>0?`<div class="row"><div class="mut">הנחה</div><div>−₪${o.discount}</div></div>`:''}
   <div class="row" style="border-top:2px solid #d3e8ec"><b>סה״כ לתשלום</b><b style="font-size:17px">₪${o.total}</b></div>
  </div>
  <div class="card">
   <label class="lb">מספר כרטיס</label><input class="inp" id="pay-card" dir="ltr" inputmode="numeric" value="4242 4242 4242 4242">
   <div style="display:flex;gap:8px"><div style="flex:1"><label class="lb">תוקף</label><input class="inp" id="pay-exp" dir="ltr" value="12/28"></div>
   <div style="flex:1"><label class="lb">CVV</label><input class="inp" id="pay-cvv" dir="ltr" inputmode="numeric" value="123"></div></div>
   <div class="note">סביבת הדגמה: לא תתבצע סליקה אמיתית — הכרטיס לצורך הדגמה בלבד.</div>
  </div>
  <button class="btn" data-act="confirmPay" data-a="${o.id}">אישור תשלום ₪${o.total}</button>
 </div>`;
}
async function confirmPay(orderId){
 try{
  const r=await api('/pay/'+orderId+'/confirm',{method:'POST',body:JSON.stringify({card_last4:($('#pay-card')||{}).value||''})});
  toast('התשלום התקבל (דמו)');route();
 }catch(e){toast(e.message)}
}
async function openPdfPublic(path){
 try{
  const r=await fetch('/api'+path);
  if(!r.ok)throw new Error('שגיאה בפתיחת PDF');
  const b=await r.blob();window.open(URL.createObjectURL(b),'_blank');
 }catch(e){toast(e.message)}
}
/* B7: רישום פעולות להאזנה המרכזת (ללא inline handlers) */
onAct({
 confirmPay:t=>confirmPay(t.dataset.a), openPdfPublic:t=>openPdfPublic(t.dataset.a)
});
