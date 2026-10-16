/* checkout-empty.js — הודעה ידידותית כשמגיעים ל-#/checkout ללא מכבסה נבחרת (או slug שלא קיים) */
(function(){
 if(!window.vCheckout)return;
 const orig=window.vCheckout;
 const card=()=>`<div class="hdr"><h2>הזמנה</h2></div><div class="body"><div class="card" style="text-align:center" role="status">
  <div style="font-size:40px" aria-hidden="true">🧺</div>
  <b>לא נבחרה מכבסה</b>
  <div class="mut" style="margin:6px 0">כדי להשלים הזמנה, קודם בחרו מכבסה והוסיפו פריטים לסל.</div>
  <button class="btn" data-act="goHome">חזרה למכבסות</button></div></div>`;
 window.vCheckout=async function(slug){
  if(!slug)return card();
  try{return await orig(slug)}
  catch(e){if(e&&e.status===404)return card();throw e}
 };
})();
