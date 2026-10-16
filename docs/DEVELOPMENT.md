# פיתוח — מכבסה בקליק

מדריך למפתח/סוכן שמצטרף לפרויקט. לפרטי המערכת עצמה ראו README.md.

## הרצה מקומית

```bash
cp .env.example .env   # DATABASE_URL + JWT_SECRET
npm install
SEED_DEMO=true npm start
```

## בדיקות יחידה/אינטגרציה

```bash
npm test            # node --test test/*.test.js
```

כל קובץ בדיקה מרים את השרת על פורט אקראי מול Postgres בסכימה מבודדת (`test_XXXX`), עם SEED_DEMO ו-DEMO_OTP פעילים. ברירת המחדל של חיבור הבדיקה: `postgres://postgres:postgres@127.0.0.1:5433/laundry_test` — ניתן לעקוף עם `TEST_DATABASE_URL`.

**אין Postgres מקומי?** אפשר בלי סודו עם חבילת `embedded-postgres` (מורידה בינארי לתיקיית הבית), או כל Postgres אחר שזמין לכם.

## בדיקות e2e (דפדפן אמיתי)

```bash
npm run test:e2e        # Playwright: דסקטופ + מובייל, מול השרת על :4700 בסכימת e2e
```

- `playwright.config.js` מרים את האפליקציה לבד (webServer), עם נתוני דמו.
- מקומית משתמש ב-Chrome המותקן (channel: chrome); ב-CI מתקין chromium.
- בדיקות: `e2e/smoke.spec.js` (דפים, RTL, חיפוש, SEO, API) ו-`e2e/customer-flow.spec.js` (זרימת הזמנה מלאה דרך UI: סל → OTP דמו → צ'קאאוט → מעקב).
- בדיקה חיה מול פרודקשן (קריאות + הזמנת דמו שמבוטלת): `BASE=https://laundry-marketplace-ay5h.onrender.com ./scripts/qa-live.sh`


## מבנה צד-לקוח (אחרי פיצול F1)

`public/app.js` פוצל ל-16 מודולים ב-`public/js/` (classic scripts, scope משותף, טעינה מסודרת ב-`index.html`). כללים: פיצ'ר צד-לקוח חדש = קובץ JS חדש משלך + שורת טעינה אחת ב-`index.html` · אין עריכת קובץ JS של משימה אחרת בלי תיאום · `core.js` ו-`router.js` בבעלות מנהל הפיתוח.

## עטיפות צד-לקוח והזרקה ל-markup של אחרים

עטיפה (קובץ שמחליף `window.vX` ומזריק HTML לתוך התוצאה של view אחר) **אסור** שתעגן למחרוזת רב-אלמנטית מה-markup של קובץ אחר (למשל `'<div class="body"><div class="subtabs">'`) — כל כרטיס שמתווסף לפני האלמנט המעוגן שובר את העטיפה **בשקט** (הכרטיס פשוט נעלם; רגרסיה אמיתית ב-16.10). הכללים:

1. עוגן מינימלי: אלמנט יחיד יציב (`'<div class="body">'`) + fallback (`card + html`) אם העוגן לא נמצא.
2. מועדף על עיגון מחרוזתי בכלל: הזרקה דרך DOM אחרי רינדור (`onboard-wizard.js`), או חיבור בסוף (`analytics.js` משתמש ב-`lastIndexOf`).
3. `test/wrapper-anchors.test.js` רץ בכל סוויטה ומוודא שכל עוגן עדיין קיים בקבצי ה-view ושאין עוגן קשיח רב-אלמנטי. טסט שנכשל אחרי שינוי view = לעדכן את העוגן, לא למחוק את הטסט.
4. שינוי מבנה של view משותף (vManage, vAdmin, vLaundry, vJoin, vCheckout) = לחפש `replace(`/`match(` בקבצי העטיפה ולוודא שהם עדיין מוזרקים.

## מיגרציות (אחרי A2)

הסכימה מנוהלת ב-`src/migrations/*.sql` עם טבלת `schema_migrations`. **מיגרציה חדשה = קובץ חדש עם מספר רץ (`003_name.sql`), אף פעם לא עריכת קובץ קיים.** `src/schema.sql` הוא עותק עיון בלבד ולא מורץ. DB קיים מסומן baseline אוטומטית ב-boot הראשון.

## CI (GitHub Actions)

ה-workflow מוכן אך **דורש טוקן עם scope של `workflow`** כדי לדחוף אותו (PAT רגיל חסום על ידי GitHub). עד אז — הדביקו את התוכן הבא דרך ממשק הווב של GitHub (Add file → `.github/workflows/ci.yml`), או צרו PAT חדש עם ✓ workflow:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    name: בדיקות יחידה ואינטגרציה
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:14-alpine
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: laundry_test
        ports: ['5433:5432']
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s --health-timeout 5s --health-retries 20
    env:
      TEST_DATABASE_URL: postgres://postgres:postgres@127.0.0.1:5433/laundry_test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test

  e2e:
    name: בדיקות e2e (דפדפן אמיתי, דסקטופ + מובייל)
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:14-alpine
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: laundry_test
        ports: ['5433:5432']
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s --health-timeout 5s --health-retries 20
    env:
      TEST_DATABASE_URL: postgres://postgres:postgres@127.0.0.1:5433/laundry_test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-results
          path: test-results/
          retention-days: 7
```

Render פורס אוטומטית מ-`main`, ולכן **הכלל: לא למזג/לדחוף כשה-CI אדום** — זה השער לפני דיפלוי.

## ביצועים

- `compression` פעיל: כל התגובות נדחסות (app.js ~165KB → ~35KB).
- `GET /api/laundries` ו-`GET /api/laundries/:slug` עם `Cache-Control: public, max-age=30`.
- סטטיקה: אייקונים/manifest נשמרים יום; html/css/js/sw עם `no-cache` (אימות מחדש מול השרת, ETag מחזיר 304 כשלא השתנה).
- cold start: Render free נרדם אחרי 15 דקות. יש keepalive חיצוני ב-cron-job.org שמריץ ping ל-`/health` (הוגדר בחשבון, לא בקוד).

## ניטור תקלות

- כל שגיאת 500 נרשמת לטבלת `error_log` (נוצרת אוטומטית בהפעלה; נשמרות 500 האחרונות).
- צפייה (אדמין בלבד): `GET /api/admin/errors?limit=50`.
- שגיאות לקוח 4xx לא נרשמות (לא תקלות שרת).

## גיבוי וייצוא

- **ייצוא מלא מה-API** (אדמין): `GET /api/admin/export` — מוריד JSON של כל הטבלאות בסכימה.
- **גיבוי ידני**: `node scripts/backup.js` — כותב `backups/backup-<timestamp>.json` (דורש את אותם DATABASE_URL/PGSCHEMA).
- המלצה: להריץ את הסקריפט פעם ביום (כל cron מקומי). בחינם, בלי שירות חדש.

## כללי עבודה מקבילה בריפו

1. `git pull --rebase` לפני כל push.
2. קומיטים קטנים ונושאיים.
3. לא לשכתב קבצים של אחרים — שינויים מינימליים וממוקדים.
4. `npm test` ו-`npm run test:e2e` ירוקים לפני push.
