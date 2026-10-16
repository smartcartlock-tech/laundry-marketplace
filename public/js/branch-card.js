/* G8: כפתור ההדפסה בכרטיס הסניף (/api/laundries/:slug/card) — listener חיצוני; CSP חוסם onclick */
(function(){
 const b=document.getElementById('cardPrint');
 if(b)b.addEventListener('click',()=>window.print());
})();
