# גיבוי, שחזור והתאוששות מאסון (DR) — מכבסה בקליק

**יעדים:** RPO ≤ 24 שעות (גיבוי יומי) · RTO ≤ שעתיים (שחזור מתועד ומוטמע).
**אילוץ:** הכל חינם, בלי שירותי Render חדשים.

## מה מגובה ואיך

- **פורמט:** JSON אחד של כל טבלאות הסכימה (`src/backup.js` → `exportAll`), אותו פורמט של `GET /api/admin/export`.
- **גיבוי ידני (זמין היום):** `DATABASE_URL=... node scripts/backup.js` → `backups/backup-<timestamp>.json`. לשמור את הקובץ מחוץ ל-Render (מחשב מקומי / Drive).
- **גיבוי יומי אוטומטי (E1):** GitHub Actions מתוזמן שמריץ `scripts/backup.js` מול Neon ושומר artifact ל-30 יום. **ממתין להרשאת `workflow` בטוקן של בעל הריפו** — התוכן מוכן ב-`docs/ci/backup.yml` ומועלה ידנית דרך ממשק הווב (Add file) או עם PAT חדש. נדרש גם repo secret בשם `DATABASE_URL`.
- **תדירות:** יומית (מכסה RPO). עד הפעלת האוטומציה — להריץ ידנית פעם ביום (cron מקומי כלשהו).

## שחזור (E2)

`scripts/restore.js` משחזר קובץ גיבוי לסכימה **ריקה**:

```bash
# שחזור לסכימת בדיקה (מומלץ תחילה — תרגיל!):
DATABASE_URL=postgres://... PGSCHEMA=restore_drill node scripts/restore.js backups/backup-2026-10-16.json

# שחזור מעל סכימה עם נתונים — דורש אישור מפורש:
DATABASE_URL=postgres://... PGSCHEMA=target node scripts/restore.js backups/backup-....json --force
```

מה הסקריפט עושה:
1. בונה את הסכימה מהמיגרציות המגורסות (`src/migrations/` — baseline + קבצים ממוספרים לפי סדר).
2. **מגן:** נעצר אם סכימת היעד אינה ריקה, בלי `--force` (מניעת מחיקת פרוד בטעות).
3. מכניס שורות בסדר טופולוגי לפי מפתחות זרים; מעגלי FK (tenders↔tender_bids) מטופלים בהורדה והחזרה של האילוצים בתוך טרנזקציה — החזרה מצליחה רק אם כל ההפניות שלמות.
4. מאפס רצפי serial כדי שהכנסות חדשות לא יתנגשו.
5. הכל בטרנזקציה אחת — כשל = rollback מלא.

טיפוסים מיוחדים מכוסים: `bytea` (PDF/לוגו), `jsonb`, `text[]`, תאריכים.

### תרגיל שחזור (להריץ אחרי כל שינוי בסכימה)
1. גבה: `node scripts/backup.js /tmp/drill.json`
2. שחזר לסכימה טרייה: `PGSCHEMA=restore_drill node scripts/restore.js /tmp/drill.json`
3. אמת: השווה מספרי שורות בטבלאות ליבה (tenants, users, orders, price_items) מול המקור.
4. בדיקה אוטומטית מלאה (export→restore→export): `node --test test/restore.test.js`

## נוהל חירום (RTO ≤ שעתיים)

| שלב | פעולה | זמן יעד |
|---|---|---|
| 1 | הכרזת תקלה: הפרוד לא עונה / נתונים נפגמו. מקור אמת לסטטוס: Render dashboard + Neon console | 10 דק׳ |
| 2 | אם ה-DB שמור: redeploy ב-Render בלבד | 20 דק׳ |
| 3 | אם ה-DB נפגע: פתיחת פרויקט Neon חדש (free) או branch חדש | 20 דק׳ |
| 4 | שחזור הגיבוי האחרון לסכימה החדשה (`scripts/restore.js`) | 30 דק׳ |
| 5 | עדכון `DATABASE_URL` ב-Render env + redeploy | 15 דק׳ |
| 6 | אימות: `/health`, `/api/laundries`, התחברות OTP דמו (אם במצב דמו) | 15 דק׳ |

## נקודות כשל ומענה (E5)

| רכיב | כשל אפשרי | מענה |
|---|---|---|
| **Neon Postgres** (eu-central-1, free) | נפילה/מחיקה | שחזור מגיבוי לפי נוהל החירום. free ללא PITR — הגיבוי היומי הוא ההגנה היחידה, לכן RPO 24ש׳ |
| **Render web** (פרנקפורט, free) | נפילה / שינה אחרי 15 דק׳ | keepalive חיצוני (cron-job.org) שומר ערות; redeploy מ-main. cold start צפוי — לא תקלה |
| **cron-job.org keepalive** | פינג מפסיק | לבדוק בחשבון cron-job.org שה-job פעיל ומכוון ל-`/health`; השהייה שלו תגרום cold starts בלבד, לא לאובדן נתונים |
| **Twilio WhatsApp sandbox** | סשן פג / מכסה | OTP נופל ל-log בלבד; במצב דמו הקוד מוצג על המסך. go-live: ראו H1 |
| **Gemini (onboarding)** | timeout/מכסה | חילוץ מתמונות נכשל — ניתן להזין מכבסה ידנית באדמין |
| **הבוט של CleanShop** (BOT_OUTBOUND_URL) | לא זמין | `sendViaBot` נופל ל-Twilio ישיר/לוג; התראות נשמרות בטבלת notifications גם כשלא נשלחו |
| **GitHub** | הריפו לא זמין | main משוכפל אצל כל מפתח; Render שומר את הדיפלוי האחרון פעיל |

## ניטור תקלות שוטף
- כל 500 נרשם ל-`error_log` (500 אחרונות) + צפייה: `GET /api/admin/errors`.
- E3 (בביצוע): התראת WhatsApp/push לאדמין על 500 חדש, מדוכאת לאחת ל-10 דקות.
- קריטריון ריליס: אפס 500 חדשים ב-24 השעות שאחרי דיפלוי.
