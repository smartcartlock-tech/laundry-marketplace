/* B7: האזנת אירועים מרכזת — מחליפה inline event handlers כהכנה ל-CSP בלי unsafe-inline.
   כל מודול רושם מפת פעולות עם onAct({name:fn}); האלמנט מסמן data-act="name" ו-data-a/b/c/d לארגומנטים.
   data-actc ל-change, data-acti ל-input. */
(function(){
 const REG={};
 window.onAct=function(map){Object.assign(REG,map)};
 document.addEventListener('click',e=>{const t=e.target.closest('[data-act]');if(t&&REG[t.dataset.act])REG[t.dataset.act](t,e)});
 document.addEventListener('change',e=>{const t=e.target.closest('[data-actc]');if(t&&REG[t.dataset.actc])REG[t.dataset.actc](t,e)});
 document.addEventListener('input',e=>{const t=e.target.closest('[data-acti]');if(t&&REG[t.dataset.acti])REG[t.dataset.acti](t,e)});
})();
