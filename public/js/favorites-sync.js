/* מועדפים מסונכרנים — עוקבים אחרי החשבון בין מכשירים (משלים את המועדפים המקומיים E13.T6).
   עטיפה בלבד: marketplace.js לא נערך; במצב לא-מחובר ההתנהגות המקומית נשמרת. */
(function(){
 'use strict';
 let synced=false;

 async function loadFavs(){
  if(!state.token)return;
  try{
   const d=await api('/me/favorites');
   const server=(d.favorites||[]).map(f=>({slug:f.slug,name:f.name,color:f.color,letter:f.letter}));
   /* מיזוג חד-פעם: מועדפים מקומיים שעוד לא בשרת נדחפים למעלה */
   const local=store.get('favs',[]);
   const missing=local.filter(l=>!server.some(s=>s.slug===l.slug));
   for(const m of missing){
    try{await api('/me/favorites',{method:'POST',body:JSON.stringify({slug:m.slug})});server.push({slug:m.slug,name:m.name,color:m.color,letter:m.letter})}catch(e){}
   }
   store.set('favs',server);
   synced=true;
  }catch(e){}
 }

 window.isFav=function(slug){return store.get('favs',[]).some(f=>f.slug===slug)};
 window.toggleFav=function(slug,name,color,letter){
  let f=store.get('favs',[]);
  const exists=f.some(x=>x.slug===slug);
  if(exists){f=f.filter(x=>x.slug!==slug);toast('הוסר מהמועדפים')}
  else{f.push({slug:slug,name:name,color:color,letter:letter});toast('נשמר במועדפים ★')}
  store.set('favs',f);
  const b=document.getElementById('fav-btn');if(b)b.textContent=isFav(slug)?'★':'☆';
  if(state.token){
   if(exists)api('/me/favorites/'+encodeURIComponent(slug),{method:'DELETE'}).catch(()=>{});
   else api('/me/favorites',{method:'POST',body:JSON.stringify({slug:slug})}).catch(()=>{});
  }
 };

 /* טעינה בהפעלה ואחרי התחברות (ניווט ראשון עם טוקן) */
 if(state.token)loadFavs();
 window.addEventListener('hashchange',()=>{if(state.token&&!synced)loadFavs()});
})();
