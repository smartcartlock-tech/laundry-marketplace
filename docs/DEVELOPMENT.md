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
