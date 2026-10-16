/* D4: דחיסת תמונות בצד לקוח לפני העלאה — עצמאי, בלי עריכת קבצי העלאה קיימים.
   מאזין ב-capture לכל input[type=file]; תמונה מעל 1MB נדחסת ב-canvas (מקס 2000px, JPEG 0.85→0.6)
   ומוחלפת ב-input דרך DataTransfer, כך שה-handler המקורי מעלה כבר קובץ דחוס. כשל = נשאר המקור. */
(function(){
  const TARGET = 1024*1024, MAX_DIM = 2000;
  const done = new WeakSet(); /* קבצים שכבר עברו דחיסה — לא לדחוס שוב (מונע לולאה) */
  async function compress(file){
    if (done.has(file) || !/^image\/(jpeg|png|webp)$/.test(file.type) || file.size <= TARGET) return file;
    done.add(file);
    try{
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, MAX_DIM/Math.max(bmp.width, bmp.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bmp.width*scale); canvas.height = Math.round(bmp.height*scale);
      canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
      for (const q of [0.85, 0.7, 0.6]){
        const blob = await new Promise(r=>canvas.toBlob(r, 'image/jpeg', q));
        if (blob && blob.size <= TARGET){
          const nf = new File([blob], file.name.replace(/\.\w+$/, '')+'.jpg', {type:'image/jpeg'});
          done.add(nf); return nf;
        }
      }
      const last = await new Promise(r=>canvas.toBlob(r, 'image/jpeg', 0.6));
      if (last && last.size < file.size){
        const nf = new File([last], file.name.replace(/\.\w+$/, '')+'.jpg', {type:'image/jpeg'});
        done.add(nf); return nf;
      }
      return file;
    }catch(e){ return file; }
  }
  document.addEventListener('change', async (ev)=>{
    const inp = ev.target;
    if (!(inp instanceof HTMLInputElement) || inp.type !== 'file' || !inp.files || !inp.files.length) return;
    if (![...inp.files].some(f=>!done.has(f) && /^image\//.test(f.type) && f.size > TARGET)) return;
    ev.stopImmediatePropagation(); /* ה-handler המקורי יורץ מחדש אחרי ההחלפה */
    const dt = new DataTransfer();
    for (const f of inp.files) dt.items.add(await compress(f));
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change', {bubbles:true}));
  }, true);
})();
