/* G9: מדריך הצטרפות לבעל מכבסה — עמוד קריא והדפסה (#/owner-guide) + קישור מעמוד העזרה.
   התוכן מבוסס על docs/OWNER-GUIDE.md ועל מה שקיים במערכת בלבד. */

function vOwnerGuide(){
 const S=[
  ['1. הרשמה',[
   'מתחברים עם מספר הטלפון (מגיע קוד כניסה חד־פעמי) ופותחים את עמוד ההצטרפות (#/join).',
   'שתי דרכים: מעלים תמונות של המחירון, שעות הפעילות והתקנון וה-AI בונה טיוטה, או מזינים ידנית שם, טלפון, כתובת ועיר.',
   'בודקים את הטיוטה ומתקנים — מה שרשום שם הוא בדיוק מה שהלקוחות יראו. פריט בלי מחיר תקין לא עובר.',
   'לוחצים ״שליחה לאישור הפלטפורמה״. לוח הניהול נפתח מיד, והמכבסה מופיעה ללקוחות אחרי אישור מנהל הפלטפורמה.']],
  ['2. השלמת פרופיל',[
   'בלוח הניהול ← הגדרות: דמי שליחות, מינימום הזמנה, צבע מותג, סלוגן ולוגו.',
   'שם גם הקישור לדף הממותג שלך וכרטיס QR להדפסה — תלוי אותו בסניף כדי שלקוחות יזמינו ישירות דרכך.',
   'צ׳ק-ליסט המוכנות בלוח הניהול מראה מה עוד חסר.']],
  ['3. מחירון',[
   'לשונית ״מחירון״: מוסיפים פריט עם שם, מחיר, יחידת מכירה (ליחידה / לק״ג / לשק) וקטגוריה.',
   'כל פריט אפשר לערוך או להסתיר זמנית בלי למחוק — פריט מוסתר לא מופיע ללקוחות.']],
  ['4. חלונות איסוף',[
   'לשונית ״חלונות״: יום בשבוע, שעות התחלה וסיום, סוג (איסוף או החזרה) וקיבולת.',
   'הלקוח בוחר חלון מתוך מה שהגדרת — בלי חלונות מוגדרים אי אפשר לבחור מועד איסוף.']],
  ['5. קבלת הזמנה ראשונה',[
   'הזמנה חדשה מופיעה בלשונית ״הזמנות״ בסטטוס ״התקבלה״, עם התראה (בדמו — סימולציה, חוץ ממספרים שאושרו מראש).',
   'מקדמים בכפתור אחד: התקבלה ← אושרה ← נאספה ← בעבודה ← מוכנה ← בדרך ← הוחזרה. הלקוח רואה כל עדכון.',
   'לאיסוף והחזרה משבצים שליח מתוך כרטיס ההזמנה.',
   'תשלום: מזומן לשליח או תשלום דמו — אין סליקה אמיתית בשלב זה.']],
  ['6. מסמכים',[
   'לשונית ״מסמכים״: כל המסמכים שהונפקו, עם צפייה במקור או העתק (PDF).',
   'כדי שיונפקו מסמכים מגדירים בהגדרות סוג עוסק (פטור = קבלה, מורשה = חשבונית עסקה + קבלה) וח.פ/ע.מ. בלי זה לא יונפקו מסמכים.',
   'אפשר מסמך אוטומטי לכל הזמנה או חשבונית מרכזת ידנית.',
   'כל מסמך מקבל קוד אימות לבדיקה בעמוד #/verify או בסריקת QR.',
   'כל מסמך מסומן ״מסמך דמו — לא לצורכי מע״מ״ עד לרישום התוכנה ברשות המסים.']],
 ];
 return `<style>@media print{#tabs,.og-np,.toast{display:none!important}body{background:#fff}}</style>
 <div class="hdr"><h2>מדריך הצטרפות לבעל מכבסה</h2><p>מההרשמה ועד ההזמנה הראשונה — צעד אחר צעד</p></div>
 <div class="body">
  <div class="card og-np" style="display:flex;gap:8px;flex-wrap:wrap">
   <button class="btn" data-act="printOwnerGuide">הדפסה</button>
   <a class="btn2" href="#/join" style="text-decoration:none">לעמוד ההצטרפות</a>
   <a class="btn2" href="#/help" style="text-decoration:none">חזרה לעזרה</a>
  </div>
  ${S.map(([t,items])=>`<div class="card"><b>${t}</b><ol style="margin:8px 0 0;padding-right:20px">${items.map(i=>`<li style="margin:5px 0">${i}</li>`).join('')}</ol></div>`).join('')}
 </div>`;
}

onAct({ printOwnerGuide:()=>window.print() });

/* קישור למדריך מתוך עמוד העזרה — עצמאי, בלי עריכת קבצים של מפתחים אחרים (אותה שיטה כמו help.js) */
(function(){
 function inject(){
  try{
   if(location.hash.split('?')[0]!=='#/help')return;
   const app=document.getElementById('app');
   if(!app||app.querySelector('[data-og-link]'))return;
   const body=app.querySelector('.body');
   const hdr=app.querySelector('.hdr');
   if(!body||!hdr||!hdr.textContent.includes('עזרה'))return;
   const c=document.createElement('div');
   c.className='card';
   c.setAttribute('data-og-link','1');
   c.style.textAlign='center';
   c.innerHTML='<b>בעל מכבסה?</b> <div class="mut" style="margin:6px 0">מדריך הצטרפות מלא: הרשמה, מחירון, חלונות איסוף, הזמנה ראשונה ומסמכים.</div><a class="btn2" href="#/owner-guide" style="text-decoration:none;display:inline-block">פתיחת המדריך</a>';
   body.prepend(c);
  }catch(e){}
 }
 new MutationObserver(inject).observe(document.getElementById('app')||document.documentElement,{childList:true,subtree:true});
 window.addEventListener('hashchange',()=>setTimeout(inject,0));
})();
