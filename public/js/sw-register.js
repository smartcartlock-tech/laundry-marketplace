/* PWA installable: רישום service worker (גרסה מנוכחת תמיד מהרשת, fallback אופליין) — B7: הועבר מ-inline ב-index.html */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
