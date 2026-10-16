/* G5: מצב כהה לבדיקה — כפתור צף, נשמר ב-wlm_theme, ברירת מחדל לפי העדפת מערכת. עצמאי, לא נוגע בקבצים אחרים. */
(function(){
  function apply(on){
    document.documentElement.classList.toggle('dark', !!on);
    const b = document.getElementById('theme-toggle');
    if (b) b.textContent = on ? '☀️' : '🌙';
  }
  window.toggleTheme = function(){
    const on = !document.documentElement.classList.contains('dark');
    store.set('theme', on ? 'dark' : 'light');
    apply(on);
  };
  function init(){
    const saved = store.get('theme', null);
    const on = saved ? saved === 'dark' : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const b = document.createElement('button');
    b.id = 'theme-toggle'; b.className = 'theme-toggle'; b.title = 'מצב כהה/בהיר';
    b.setAttribute('aria-label', 'מעבר מצב כהה/בהיר');
    b.addEventListener('click', toggleTheme);
    document.body.appendChild(b);
    apply(on);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
