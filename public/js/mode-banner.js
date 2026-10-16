/* A3: באנר "סביבת דמו" ובידוד התנהגויות דמו בצד לקוח.
   באנר מוצג רק כש-/api/config מחזיר mode:'demo'; ב-pilot אין באנר וכרטיס דמו 4242 לא מוזן מראש.
   עצמאי: לא עורך קבצי JS אחרים — מזריק את הסרגל בעצמו אחרי ש-state.cfg נטען. */
(function(){
  function mode(){ return (window.state && state.cfg && state.cfg.mode) || 'demo'; }
  function banner(){
    let b = document.getElementById('mode-banner');
    if (mode() === 'demo'){
      if (!b){
        b = document.createElement('div');
        b.id = 'mode-banner'; b.className = 'mode-banner';
        b.textContent = 'סביבת דמו — הנתונים להמחשה בלבד · אין חיוב ואין משלוח אמיתיים';
        document.body.prepend(b);
      }
    } else if (b) b.remove();
    if (mode() === 'pilot'){
      const c = document.getElementById('pay-card');
      if (c){ c.value = ''; c.placeholder = 'מספר כרטיס'; }
    }
  }
  let scheduled = false;
  function schedule(){ if (scheduled) return; scheduled = true; setTimeout(()=>{ scheduled = false; banner(); }, 60); }
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  const wait = setInterval(()=>{ if (window.state && state.cfg){ banner(); clearInterval(wait); } }, 300);
  document.addEventListener('DOMContentLoaded', banner);
})();
