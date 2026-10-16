/* D1: עמוד עזרה — שאלות נפוצות ללקוח, למכבסה ולשליח + דרכי פנייה (תוכן סטטי, בלי פנייה לאנשים אמיתיים) */
const HELP_SECTIONS = [
 { title: 'ללקוחות', items: [
  ['איך מזמינים?', 'בוחרים מכבסה בדף הבית, מוסיפים פריטים מהמחירון לסל, ממלאים כתובת וחלון איסוף ומאשרים. אפשר לעקוב אחרי ההזמנה בלשונית "הזמנות".'],
  ['איך משלמים?', 'כרגע: מזומן לשליח או תשלום דמו (בסביבת הדגמה). אין סליקה אמיתית.'],
  ['מה זה נקודות?', 'על כל הזמנה צוברים נקודות מועדון אצל המכבסה. אפשר לממש אותן כהנחה בצ׳קאאוט.'],
  ['איך מזמינים שוב את אותה הזמנה?', 'בלשונית "הזמנות", בהזמנה שהוחזרה יש כפתור "שוב" שמוסיף את אותם הפריטים לסל.'],
  ['יש בעיה בהזמנה', 'בעמוד ההזמנה יש "דיווח על תקלה" — המכבסה והפלטפורמה מקבלות את הדיווח ומטפלות.'],
 ]},
 { title: 'למכבסות', items: [
  ['איך מתחילים?', 'פונים להצטרפות ("/join"), מזינים פרטים ומחירון. צ׳ק-ליסט המוכנות בלוח הניהול מראה מה חסר.'],
  ['איך מעדכנים סטטוס הזמנה?', 'בלוח הניהול, בלשונית "הזמנות", לוחצים על ההזמנה ומקדמים שלב. הלקוח מקבל עדכון.'],
  ['איך מדפיסים תווית לשקית?', 'בכל הזמנה בלוח הניהול אפשר לפתוח את דף האיסוף/תווית (PDF) ולהדפיס.'],
  ['איך רואים סיכום יומי?', 'כרטיס "סיכום יומי" בראש לוח הניהול: כמה נוצרו, נאספו ונמסרו היום, איחורים ופילוח שליחים.'],
 ]},
 { title: 'לשליחים', items: [
  ['איך מצטרפים כשליח?', 'נרשמים באפליקציה ובוחרים "הצטרפות כשליח" — מצרפים רישיון נהיגה וממתינים לאישור.'],
  ['איך מקבלים משימות?', 'בלשונית "שליח" רואים הצעות איסוף פתוחות ומאשרים.'],
 ]},
 { title: 'פרטיות וביטחון', items: [
  ['מה נשמר עליי?', 'טלפון/אימייל לכניסה, כתובות ששמרתם, והיסטוריית הזמנות. אין תשלום אמיתי ואין מסירה לצדדים שלישיים.'],
  ['זו סביבת דמו?', 'אם מופיע קוד כניסה על המסך — אתם בסביבת הדגמה, והנתונים בה לצורכי הדגמה בלבד.'],
 ]},
];
function vHelp(){
 return `<div class="hdr"><h2>עזרה ושאלות נפוצות</h2></div><div class="body">
  ${HELP_SECTIONS.map(s=>`<div class="sec">${s.title}</div><div class="card">
   ${s.items.map(([q,a])=>`<details style="padding:7px 0;border-top:1px solid #edf1f4"><summary style="cursor:pointer;font-weight:600">${q}</summary><div class="mut" style="margin-top:5px">${a}</div></details>`).join('')}
  </div>`).join('')}
  <div class="card" style="text-align:center"><b>לא מצאתם תשובה?</b>
   <div class="mut" style="margin:6px 0">בעיה ספציפית בהזמנה — דווחו מעמוד ההזמנה עצמו ("דיווח על תקלה").</div>
   <a class="btn2" href="#/orders" style="text-decoration:none;display:inline-block">להזמנות שלי</a></div>
 </div>`;
}

/* הזרקת קישור "עזרה" לניווט התחתון — עצמאי, בלי עריכת קבצים משותפים.
   MutationObserver כי ה-nav נבנה מחדש בכל ניווט (hashchange קורא ל-route המקורי ישירות) */
(function(){
  function inject(){
    try{
      const nav = document.querySelector('nav');
      if (!nav || nav.querySelector('a[href$="#/help"]')) return;
      const a = document.createElement('a');
      a.href = '#/help';
      /* בלי צבע inline — יורש את עיצוב שאר הקישורים (מובייל=כהה על לבן, דסקטופ=לבן על כהה) */
      a.innerHTML = '<span class="ic">?</span>עזרה';
      (nav.querySelector('.in') || nav).appendChild(a);
    }catch(e){}
  }
  function watch(){
    const nav = document.querySelector('nav');
    if (!nav) return;
    inject();
    new MutationObserver(inject).observe(nav, {childList:true, subtree:true});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();
  /* ה-nav עלול להיווצר מאוחר יותר ע"י רינדור ראשוני */
  setTimeout(watch, 500); setTimeout(watch, 2000);
})();
