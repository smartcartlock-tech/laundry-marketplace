// G5: איפוס נתוני דמו בטוח — מנקה את נתוני הדמו (purge-demo) ומזריע מחדש (seed).
// הגנות: (1) נעילה לחלוטין ב-APP_MODE=pilot — שם הנתונים אמיתיים; (2) דורש CONFIRM_RESET_DEMO=yes;
// (3) דורש SEED_DEMO=true (סביבת דמו בלבד); (4) מדפיס תוכנית לפני ביצוע.
// הרצה: CONFIRM_RESET_DEMO=yes DATABASE_URL=... node scripts/reset-demo.js
const { MODE } = require('../src/config');

if (MODE === 'pilot') {
  console.error('חסום: reset-demo לא רץ ב-APP_MODE=pilot — שם נמצאים נתוני לקוחות אמיתיים. (בקשת המשתמש: הגנה מפני איפוס ב-pilot)');
  process.exit(1);
}
if (process.env.SEED_DEMO !== 'true') {
  console.error('חסום: reset-demo מיועד לסביבת דמו בלבד (SEED_DEMO=true לא מוגדר).');
  process.exit(1);
}
if (process.env.CONFIRM_RESET_DEMO !== 'yes') {
  console.error('בטיחות: יש להריץ עם CONFIRM_RESET_DEMO=yes. הפעולה מוחקת את כל נתוני הדמו ומזריעה מחדש.');
  process.exit(1);
}

const { execFileSync } = require('child_process');

(async () => {
  console.log('שלב 1/2: ניקוי נתוני דמו קיימים (scripts/purge-demo.js)...');
  execFileSync(process.execPath, [require('path').join(__dirname, 'purge-demo.js')], {
    stdio: 'inherit',
    env: { ...process.env, CONFIRM_PURGE_DEMO: 'yes' },
  });
  console.log('שלב 2/2: הזרעת נתוני דמו מחדש (src/seed.js)...');
  const { migrate } = require('../src/db');
  await migrate();
  await require('../src/seed').run();
  console.log('reset-demo: הושלם — נתוני הדמו אופסו והוזרעו מחדש.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
