/* מכבסה בקליק — PWA מחובר ל-API אמיתי */
const $=s=>document.querySelector(s);
const store={
 get(k,d){try{const v=localStorage.getItem('wlm_'+k);return v?JSON.parse(v):d}catch(e){return d}},
 set(k,v){localStorage.setItem('wlm_'+k,JSON.stringify(v))},
 del(k){localStorage.removeItem('wlm_'+k)}
};
/* בתוך אפליקציית האנדרויד (Capacitor): כפתור חזרה מקורי — חזרה בהיסטוריית ה-SPA, ובדף הבית מזעור */
if(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform()){
 const _capApp=window.Capacitor.Plugins&&window.Capacitor.Plugins.App;
 if(_capApp)_capApp.addListener('backButton',()=>{
  const h=location.hash||'#/';
  if(h!=='#/'&&h!=='#'){history.back()}else{_capApp.minimizeApp()}
 });
}
let state={token:store.get('token',null),me:store.get('me',null),cfg:null,cart:store.get('cart',[]),memberships:store.get('memberships',[]),courier:store.get('courier',null)};
/* E3: מצב מותג לבן — כניסה דרך /b/:slug מציגה רק את המכבסה הזאת, במיתוג שלה */
const __bm=location.pathname.match(/^\/b\/([^\/]+)/);
state.brandSlug=__bm?decodeURIComponent(__bm[1]):null;state.brand=null;
function shade(hex,f){const n=parseInt(hex.slice(1),16);const r=Math.round(((n>>16)&255)*f),g=Math.round(((n>>8)&255)*f),b=Math.round((n&255)*f);return '#'+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1)}
async function applyBrandTheme(slug){
 try{
  if(!state.brand||state.brand.slug!==slug){const d=await api('/laundries/'+slug);state.brand=d.laundry}
  const l=state.brand,c=cssColor(l.color),dark=shade(c,.6);
  let st=document.getElementById('brand-css');
  if(!st){st=document.createElement('style');st.id='brand-css';document.head.appendChild(st)}
  st.textContent=`.hdr{background:linear-gradient(120deg,${dark},${c})!important}.btn{background:linear-gradient(120deg,${dark},${c})!important}.btn2{background:${c}1a!important;color:${c}!important;border-color:${c}55!important}.btn2.on,.chip.on,.searchbar .go{background:${c}!important;color:#fff!important;border-color:${c}!important}.chip{background:${c}14!important;color:${c}!important;border-color:${c}55!important}`;
  document.title=l.name;
  const tm=document.querySelector('meta[name=theme-color]');if(tm)tm.content=c;
  const mf=document.querySelector('link[rel=manifest]');if(mf)mf.href='/api/laundries/'+slug+'/manifest.webmanifest';
 }catch(e){}
}
function save(){if(state.token)store.set('token',state.token);else store.del('token');store.set('me',state.me);store.set('cart',state.cart);store.set('memberships',state.memberships);store.set('courier',state.courier);syncCartCloud()} /* T78: טוקן null נמחק מהאחסון (לא "null") */
/* E14.T1: עגלה בענן — דחיפה מדולדלת אחרי כל שינוי סל (מחוברים בלבד) */
let cartSyncTimer=null;
function syncCartCloud(){
 if(!state.token)return;
 clearTimeout(cartSyncTimer);
 cartSyncTimer=setTimeout(()=>{api('/cart',{method:'PUT',body:JSON.stringify({items:state.cart})}).catch(()=>{})},800);
}
async function adoptCloudCart(){
 if(!state.token)return;
 try{const d=await api('/cart');if(d.items&&d.items.length&&!state.cart.length){state.cart=d.items;store.set('cart',state.cart)}}catch(e){}
}
function cssColor(c){return /^#[0-9a-fA-F]{3,8}$/.test(String(c||''))?String(c):'#0e7a8a'}
function esc(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
/* פתוח כעת: is_open ידני + שעות פעילות (אזור זמן ישראל). בלי שעות מוגדרות — לפי is_open בלבד */
function openNow(l){
 if(!l.is_open)return false;
 const h=l.hours||{};if(!Object.keys(h).length)return true;
 const now=new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Jerusalem'}));
 const rs=h[now.getDay()];if(!rs||!rs.length)return false;
 const hm=now.getHours()*60+now.getMinutes();
 return rs.some(r=>{const m=String(r[0]).match(/(\d+):(\d+)/),n=String(r[1]).match(/(\d+):(\d+)/);if(!m||!n)return false;return hm>=m[1]*60+ +m[2]&&hm<=n[1]*60+ +n[2]});
}
let toastTimer=null;
function toast(m){let t=$('.toast');if(!t){t=document.createElement('div');t.className='toast';document.body.appendChild(t)}t.textContent=m;t.classList.add('show');if(toastTimer)clearTimeout(toastTimer);toastTimer=setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),400)},4000)}
/* חלון אישור/קלט פנימי (מחליף confirm/prompt של הדפדפן) */
function xmodal({title,body,okText='אישור',cancelText='ביטול',fields}){
 return new Promise(resolve=>{
  const ov=document.createElement('div');ov.className='modal-ov';
  ov.innerHTML=`<div class="modal" role="dialog" aria-modal="true"><b>${esc(title)}</b>${body?`<div class="mut" style="margin:8px 0">${body}</div>`:''}
   ${(fields||[]).map(f=>`<label class="lb">${esc(f.label)}</label><input class="inp" id="xm-${f.id}" value="${esc(f.value||'')}" ${f.type?`type="${f.type}"`:''}>`).join('')}
   <div style="display:flex;gap:8px;margin-top:14px"><button class="btn" id="xm-ok" style="flex:1">${esc(okText)}</button><button class="btn2" id="xm-cancel" style="flex:1">${esc(cancelText)}</button></div></div>`;
  document.body.appendChild(ov);
  const done=v=>{ov.remove();resolve(v)};
  ov.querySelector('#xm-ok').onclick=()=>{const vals={};(fields||[]).forEach(f=>vals[f.id]=ov.querySelector('#xm-'+f.id).value);done(fields?vals:true)};
  ov.querySelector('#xm-cancel').onclick=()=>done(null);
  ov.onclick=e=>{if(e.target===ov)done(null)};
 });
}
function xconfirm(msg,opts={}){return xmodal({title:opts.title||'אישור פעולה',body:msg,okText:opts.okText||'אישור'})}
async function api(path,opts={}){
 let r;
 try{r=await fetch('/api'+path,{...opts,headers:{'Content-Type':'application/json',...(state.token?{Authorization:'Bearer '+state.token}:{})}})}
 catch(e){const err=new Error('אין חיבור לרשת — בדקו את החיבור ונסו שוב');err.status=0;throw err}
 const data=await r.json().catch(()=>({}));
 if(!r.ok){const err=new Error(data.error||('שגיאה '+r.status));err.status=r.status;throw err}
 return data;
}
let routeSeq=0;
function go(h){if(location.hash===h)route();else location.hash=h}
async function openPdf(path){
 /* הורדה אמינה: window.open נחסם (קופץ) וניווט top-level ל-blob חסום ב-Chrome — לכן <a download> */
 try{
  const r=await fetch('/api'+path,{headers:state.token?{Authorization:'Bearer '+state.token}:{}});
  if(!r.ok){const d=await r.json().catch(()=>({}));toast(d.error||'שגיאה בפתיחת PDF');return}
  const b=await r.blob();const url=URL.createObjectURL(b);
  const a=document.createElement('a');a.href=url;a.download='מסמך.pdf';document.body.appendChild(a);a.click();a.remove();
  toast('המסמך ירד למכשיר');
  setTimeout(()=>URL.revokeObjectURL(url),60000);
 }catch(e){toast('שגיאה בפתיחת PDF')}
}
async function downloadCsv(path,filename){
 try{
  const r=await fetch('/api'+path,{headers:{Authorization:'Bearer '+state.token}});
  if(!r.ok){const d=await r.json().catch(()=>({}));toast(d.error||'שגיאה בייצוא');return}
  const b=await r.blob();const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),4000);
 }catch(e){toast('שגיאה בייצוא')}
}
function fmtQ(q){const n=Number(q);return (n%1)?String(n):String(Math.round(n))}
function unitLbl(u,qty){if(u==='kg')return 'ק״ג';if(u==='bag')return Number(qty)>1?'שקים':'שק';return 'יח׳'}
const HE={new:'התקבלה',confirmed:'אושרה',picked_up:'נאספה',in_work:'בעבודה',ready:'מוכנה',out_for_delivery:'בדרך',delivered:'הוחזרה',cancelled:'בוטלה'};
const FLOW=['new','confirmed','picked_up','in_work','ready','out_for_delivery','delivered'];
const WD=['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
function fmtDT(s){if(!s)return '—';const d=new Date(s);return d.toLocaleDateString('he-IL',{weekday:'short',day:'numeric',month:'numeric',timeZone:'Asia/Jerusalem'})+' '+d.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Jerusalem'})}
function fmtDate(s){if(!s)return '—';const d=new Date(s);return d.toLocaleDateString('he-IL',{weekday:'short',day:'numeric',month:'numeric',timeZone:'Asia/Jerusalem'})}
function nextWindowDate(weekday,timeStr){
 const d=new Date();const[hh,mm]=timeStr.split(':').map(Number);
 d.setHours(hh,mm,0,0);
 while(d.getDay()!==weekday||d<new Date())d.setDate(d.getDate()+1);
 return d.toISOString();
}

