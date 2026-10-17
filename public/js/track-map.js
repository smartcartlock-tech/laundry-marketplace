/* T82: מעקב שליח חי במפה (Leaflet+OSM מקומי) + ETA משוער.
   צד לקוח: עטיפת vTrack — מפה בדף המעקב הציבורי בזמן out_for_delivery, רענון כל 15 שניות.
   ETA: מיקום הלקוח נשאר במכשיר בלבד (geolocation בלחיצה), חישוב מרחק/מהירות בצד לקוח.
   צד שליח: עטיפת markOrder — שיתוף מיקום חי בזמן מסירה בלבד, נעצר במסירה/יציאה מהדף. */
(function(){
 'use strict';

 /* --- טעינה עצלה של Leaflet (CSP: script-src 'self' — ספרייה מקומית בלבד) --- */
 let leafletP=null;
 function loadLeaflet(){
  if(window.L)return Promise.resolve();
  if(!leafletP){
   leafletP=new Promise((res,rej)=>{
    const css=document.createElement('link');
    css.rel='stylesheet';css.href='/vendor/leaflet/leaflet.css';
    document.head.appendChild(css);
    const s=document.createElement('script');
    s.src='/vendor/leaflet/leaflet.js';
    s.onload=()=>{
     // אייקון מפורש עם נתיבים מוחלטים — Icon.Default משחר imagePath שזוהה אוטומטית ל-iconUrl ומייצר URL כפול
     L.Icon.Default.imagePath='';
     L.Icon.Default.mergeOptions({
      iconUrl:'/vendor/leaflet/images/marker-icon.png',
      iconRetinaUrl:'/vendor/leaflet/images/marker-icon-2x.png',
      shadowUrl:'/vendor/leaflet/images/marker-shadow.png'
     });
     res();
    };
    s.onerror=()=>{leafletP=null;rej(new Error('leaflet load failed'))};
    document.head.appendChild(s);
   });
  }
  return leafletP;
 }

 /* --- לקוח: מפה בדף המעקב הציבורי --- */
 let mapState={timer:null,hash:null};
 function stopMapPoll(){
  if(mapState.timer){clearInterval(mapState.timer);mapState.timer=null}
 }
 async function bootMap(code){
  stopMapPoll();
  let d;
  try{d=await api('/tracking/'+encodeURIComponent(code)+'/state')}catch(e){return}
  if(d.status!=='out_for_delivery')return;
  const host=document.getElementById('tr-result');
  if(!host||document.getElementById('tr-map-card'))return;
  const card=document.createElement('div');
  card.className='card';card.id='tr-map-card';
  card.innerHTML=`<div class="sec">השליח בדרך אליך${d.courier_first_name?' · '+esc(d.courier_first_name):''}</div>
   <div id="tr-map-canvas" style="height:260px;border-radius:10px;border:1px solid #d3e8ec;overflow:hidden" role="img" aria-label="מפה עם מיקום השליח"></div>
   <div class="mut" id="tr-map-upd" style="margin-top:4px"></div>
   <button class="btn2" id="tr-eta-btn" type="button">חישוב זמן הגעה משוער</button>
   <div class="mut" id="tr-eta" style="margin-top:4px"></div>
   <div class="mut" style="margin-top:4px">המיקום משותף רק בזמן המסירה ונמחק לאחריה. מקור המפה: © OpenStreetMap contributors</div>`;
  host.after(card);
  try{await loadLeaflet()}catch(e){card.style.display='none';return}
  const map=L.map('tr-map-canvas',{attributionControl:false});
  L.tileLayer('/api/tracking/tiles/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
  const marker=L.marker([32.08,34.78],{icon:L.icon({iconUrl:'/vendor/leaflet/images/marker-icon.png',iconRetinaUrl:'/vendor/leaflet/images/marker-icon-2x.png',shadowUrl:'/vendor/leaflet/images/marker-shadow.png',iconSize:[25,41],iconAnchor:[12,41],popupAnchor:[1,-34],shadowSize:[41,41]})}).addTo(map);
  const circle=L.circle([32.08,34.78],{radius:0}).addTo(map);
  let placed=false;
  async function refresh(){
   if(!location.hash.startsWith('#/track/')){stopMapPoll();return}
   try{
    const s=await api('/tracking/'+encodeURIComponent(code)+'/state');
    if(s.status!=='out_for_delivery'||!s.position){stopMapPoll();const c=document.getElementById('tr-map-card');if(c)c.style.display='none';return}
    const p=s.position, ll=[p.lat,p.lon];
    marker.setLatLng(ll);
    circle.setLatLng(ll);circle.setRadius(Math.min(Number(p.accuracy)||50,500));
    if(!placed){map.setView(ll,15);placed=true}else map.panTo(ll,{animate:false});
    const upd=document.getElementById('tr-map-upd');
    if(upd)upd.textContent='עודכן לפני '+Math.max(0,Math.round((Date.now()-new Date(p.at).getTime())/1000))+' שניות';
   }catch(e){}
  }
  await refresh();
  mapState.timer=setInterval(refresh,15000);
  const etaBtn=document.getElementById('tr-eta-btn');
  if(etaBtn)etaBtn.onclick=()=>{
   const out=document.getElementById('tr-eta');
   if(!navigator.geolocation){if(out)out.textContent='המכשיר לא תומך במיקום';return}
   if(out)out.textContent='מאתר את המיקום שלך…';
   navigator.geolocation.getCurrentPosition(pos=>{
    const p=marker.getLatLng();
    const R=6371,rad=x=>x*Math.PI/180;
    const dLat=rad(pos.coords.latitude-p.lat),dLon=rad(pos.coords.longitude-p.lng);
    const a=Math.sin(dLat/2)**2+Math.cos(rad(p.lat))*Math.cos(rad(pos.coords.latitude))*Math.sin(dLon/2)**2;
    const km=2*R*Math.asin(Math.sqrt(a));
    const mins=Math.max(1,Math.round(km/25*60)); // הנחת נסיעה עירונית ~25 קמ״ש
    if(out)out.textContent='זמן הגעה משוער: כ-'+mins+' דקות (משוער, בקו ישר — המיקום שלך לא נשמר)';
   },()=>{if(out)out.textContent='לא ניתן לחשב בלי שיתוף המיקום שלך — המיקום נשאר במכשיר בלבד'},{timeout:10000});
  };
 }

 if(typeof window.vTrack==='function'){
  const origVTrack=window.vTrack;
  window.vTrack=async function(code){
   const html=await origVTrack(code);
   if(code){
    let tries=0;
    const iv=setInterval(()=>{
     if(document.getElementById('tr-result')){clearInterval(iv);bootMap(code)}
     else if(++tries>20)clearInterval(iv);
    },100);
   }
   return html;
  };
 }

 /* --- שליח: שיתוף מיקום חי בזמן מסירה בלבד --- */
 let shareTimer=null,shareOrder=null;
 function stopSharing(silent){
  if(shareTimer){clearInterval(shareTimer);shareTimer=null}
  shareOrder=null;
  if(!silent)toast('שיתוף המיקום הופסק');
 }
 function sendPing(orderId){
  navigator.geolocation.getCurrentPosition(pos=>{
   api('/tracking/ping',{method:'POST',body:JSON.stringify({
    order_id:orderId,lat:pos.coords.latitude,lon:pos.coords.longitude,accuracy:pos.coords.accuracy
   })}).catch(e=>{if(e&&e.status===409)stopSharing(true)});
  },err=>{if(err&&err.code===err.PERMISSION_DENIED)stopSharing(true)},{enableHighAccuracy:true,maximumAge:15000,timeout:10000});
 }
 function startSharing(orderId){
  if(!navigator.geolocation){toast('המכשיר לא תומך בשיתוף מיקום');return}
  stopSharing(true);
  shareOrder=orderId;
  sendPing(orderId);
  shareTimer=setInterval(()=>sendPing(orderId),30000);
  toast('שיתוף מיקום חי הופעל — הלקוח רואה אותך במפה בזמן המסירה בלבד');
 }
 if(typeof window.markOrder==='function'){
  const origMark=window.markOrder;
  window.markOrder=async function(id,a){
   const r=await origMark(id,a);
   try{
    const d=await api('/orders/'+id);
    const st=d.order&&d.order.status;
    if(st==='out_for_delivery')startSharing(id);
    else if(shareOrder===id)stopSharing(true);
   }catch(e){}
   return r;
  };
 }
 window.addEventListener('hashchange',()=>{if(shareTimer)stopSharing(true)});
 window.addEventListener('pagehide',()=>stopSharing(true));
})();
