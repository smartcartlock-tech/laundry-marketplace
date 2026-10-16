/* CX-D: לשונית "ביקורות" בלוח הבעלים — wrapper עצמאי על vManage (בלי שינוי בקובץ המשותף).
   מציג את אותן ביקורות שפורסמו בדף המכבסה הציבורי (מקור אחד: GET /laundries/:slug). */
(function(){
 if(typeof window.vManage!=='function')return;
 const orig=window.vManage;
 function chip(on){return `<a class="chip ${on?'on':''}" href="#/manage/reviews">ביקורות</a>`}
 function addChip(html,on){
  if(!html||html.indexOf('#/manage/reviews')>=0)return html;
  const i=html.indexOf('<div class="subtabs">');if(i<0)return html;
  const j=html.indexOf('</div>',i);if(j<0)return html;
  return html.slice(0,j)+chip(on)+html.slice(j);
 }
 window.vManage=async function(sub){
  if(sub!=='reviews')return addChip(await orig(sub),false);
  // משתמשים בשלד של לשונית ההזמנות (כותרת + מייצג מכבסות) ומחליפים רק את גוף הלשונית
  const shell=await orig('orders');
  if(typeof shell!=='string'||shell.indexOf('<div class="subtabs">')<0)return shell;
  let body;
  try{
   const m=(state.memberships||[]).find(x=>x.slug===store.get('lastTenant',''))||(state.memberships||[])[0];
   const d=await api('/laundries/'+m.slug);
   const rvs=d.reviews||[];
   const avg=d.laundry&&d.laundry.rating,cnt=(d.laundry&&d.laundry.rating_count)||0;
   body=`<div class="card"><b>${avg?('דירוג ממוצע ★'+avg+' · '+cnt+' ביקורות'):'אין ביקורות עדיין'}</b><div class="mut">ביקורות נאספות מלקוחות אחרי הזמנה שהושלמה, ומוצגות גם בדף המכבסה הציבורי.</div></div>`
    +(rvs.map(r=>`<div class="card"><div><b style="color:#e8a020">${'★'.repeat(r.rating)}</b> <span class="mut">${esc(r.author||'לקוח/ה')} · ${fmtDT(r.created_at)}</span></div>${r.text?`<div style="margin-top:4px">${esc(r.text)}</div>`:''}${Array.isArray(r.tags)&&r.tags.length?`<div class="mut" style="margin-top:4px">${r.tags.map(t=>esc(String(t))).join(' · ')}</div>`:''}</div>`).join(''));
  }catch(e){body=`<div class="card mut">לא ניתן לטעון ביקורות כרגע</div>`}
  const html=addChip(shell,true);
  const i=html.indexOf('<div class="subtabs">');
  const j=html.indexOf('</div>',i);
  return html.slice(0,j+6)+body+'</div>';
 };
})();
