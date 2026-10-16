/* ---- courier offline: תור צילומי אישור מסירה לא-מקוון (IndexedDB) — מסך שליח ----
   מדוע IndexedDB ולא localStorage: Blob בינארי בלי base64 (~1.3x נפח), מכסת אחסון גדולה בהרבה,
   ואין חסימת thread ראשי. התמונה נשארת על המכשיר עד שהסנכרון מצליח (409 = כבר אושר = טופל). */
const COFF_DB='courier-offline', COFF_STORE='photos';

function coffOpen(){
 return new Promise((res,rej)=>{
  const r=indexedDB.open(COFF_DB,1);
  r.onupgradeneeded=()=>{r.result.createObjectStore(COFF_STORE,{keyPath:'id'})};
  r.onsuccess=()=>res(r.result);
  r.onerror=()=>rej(r.error);
 });
}

async function coffReq(mode,run){
 const db=await coffOpen();
 try{
  return await new Promise((res,rej)=>{
   const tx=db.transaction(COFF_STORE,mode);
   const st=tx.objectStore(COFF_STORE);
   const r=run(st);
   tx.oncomplete=()=>res(r&&'result' in r?r.result:undefined);
   tx.onerror=()=>rej(tx.error);
  });
 }finally{db.close()}
}

function coffSavePhoto(orderId,blob){
 const id=(crypto.randomUUID?crypto.randomUUID():String(Date.now())+'-'+Math.random().toString(36).slice(2));
 return coffReq('readwrite',st=>st.put({id,orderId,blob,type:blob.type||'image/jpeg',at:Date.now()})).then(()=>id);
}
function coffGetPhoto(id){return coffReq('readonly',st=>st.get(id))}
function coffDelPhoto(id){return coffReq('readwrite',st=>st.delete(id))}
function coffListPhotos(){return coffReq('readonly',st=>st.getAll()).then(a=>a||[])}

/* בקשת אחסון מתמשך (מקטינה סיכון לפינוי IDB בלחץ אחסון, בעיקר ב-iOS) + הערכת מכסה */
async function coffPersist(){
 try{if(navigator.storage&&navigator.storage.persist)await navigator.storage.persist()}catch(e){}
}
async function coffEstimate(){
 try{if(navigator.storage&&navigator.storage.estimate){const e=await navigator.storage.estimate();return{usage:e.usage||0,quota:e.quota||0}}}catch(e){}
 return{usage:0,quota:0};
}
