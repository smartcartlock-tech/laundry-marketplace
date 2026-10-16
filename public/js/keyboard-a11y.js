/* G6: נגישות מקלדת למודאלים — פוקוס ראשוני בפתיחה, Esc לסגירה, מלכודת Tab, החזרת פוקוס.
   עטיפה גנרית על כל .modal-ov (xmodal של core.js, מודאל צילום של courier-day וכו') — בלי עריכת קבצים אחרים. */
(function(){
  const focusStack = [];
  const SELECTOR = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const topOverlay = () => { const o = document.querySelectorAll('.modal-ov'); return o.length ? o[o.length-1] : null; };
  const visibleFocusables = (dlg) => [...dlg.querySelectorAll(SELECTOR)].filter(el => el.offsetParent !== null);

  // פתיחה: שמירת הפוקוס הקודם + פוקוס ראשוני בתוך הדיאלוג
  new MutationObserver(muts => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType === 1 && n.classList && n.classList.contains('modal-ov')) {
        focusStack.push(document.activeElement);
        const f = n.querySelector('input,button,select,textarea,a[href]');
        if (f) setTimeout(() => f.focus(), 0);
      }
    }
    for (const m of muts) for (const n of m.removedNodes) {
      if (n.nodeType === 1 && n.classList && n.classList.contains('modal-ov')) {
        const prev = focusStack.pop();
        if (prev && prev.focus && document.contains(prev)) prev.focus();
      }
    }
  }).observe(document.body, { childList: true });

  document.addEventListener('keydown', (e) => {
    const ov = topOverlay();
    if (!ov) return;
    if (e.key === 'Escape') {
      const cancel = ov.querySelector('#xm-cancel,[id$="-cancel"]') || [...ov.querySelectorAll('button')].pop();
      if (cancel) { e.preventDefault(); cancel.click(); }
      return;
    }
    if (e.key !== 'Tab') return;
    const f = visibleFocusables(ov.querySelector('.modal') || ov);
    if (!f.length) return;
    const first = f[0], last = f[f.length-1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }, true);
})();
