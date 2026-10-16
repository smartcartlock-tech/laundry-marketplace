# תוכנית שדרוגים — מכבסה בקליק: מגרסה 1.0 לבשלות ייצור

**תאריך:** 16.10.2026 · **שלב:** תכנון בלבד (אין כאן שינויי קוד מוצר) · **קהל:** מפתחים/סוכני פיתוח שיבצעו את המשימות במקביל

**אילוצים קשיחים לכל התוכנית:** חינם בלבד · בלי תשלומים וסליקה אמיתית · בלי פנייה לאנשים אמיתיים · בלי הגשות לרשות המסים · בלי שירותי Render חדשים.

---

## 1. תמונת מצב טכנית (אומת מול הקוד והפרוד החי ב-16.10)

**מחסנית:** Node 20+ / Express 4 / PostgreSQL גולמי (pg, ללא ORM), CommonJS, ~4,900 שורות צד-שרת (`src/`), PWA ונילה בקובץ יחיד (`public/app.js`, 1,927 שורות, ~165KB), 55 טבלאות (`src/schema.sql`), 40 קבצי בדיקות יחידה/אינטגרציה (~70 מקרי בדיקה, `node --test` מול Postgres בסכימות מבודדות), 10 בדיקות e2e (Playwright, דסקטופ+מובייל), בדיקה חיה מול פרוד (`scripts/qa-live.sh`).

**פריסה בפועל (נבדק דרך Render API):** שירות web אחד free ב-Render (פרנקפורט) + **Neon free Postgres** (eu-central-1) — כבר לא משתף אינסטנס עם הבוט, אין PGSCHEMA בפרוד. Twilio **sandbox** לוואטסאפ, Gemini ל-onboarding, הבוט של CleanShop כערוץ outbound (BOT_OUTBOUND_URL), keepalive חיצוני ב-cron-job.org. APK עטוף קיים מחוץ לריפו (TWA).

**מה שכבר טוב (לא לתכנן מחדש):** כותרות אבטחה ידניות (CSP, nosniff, DENY), rate limiting על OTP (לפי יעד + לפי IP), פרמטריזציה מלאה של SQL, עזר `esc()` ל-XSS בצד לקוח, fileFilter על העלאות שליח, דחיסת gzip + מטמון 30ש׳ ל-API ציבורי, טבלת error_log + endpoint אדמין, גיבוי ידני (CLI + API), אימות הרשאות לפי תפקידים, אינדקסים על הנתיבים החמים, בדיקות הרשאות קצה (permissions-edge).

**הפערים המרכזיים שהתוכנית סוגרת:**

| # | פער | ראיה |
|---|---|---|
| 1 | אין CI בפועל — ה-workflow מוכן אך לא הועלה (PAT ללא scope `workflow`) | `docs/DEVELOPMENT.md`; אין `.github/` |
| 2 | אין מיגרציות מגורסות — `schema.sql` אחד + ALTERs אד-הוק + **מחיקת/הכנסת נתונים בכל boot** | `src/schema.sql` שורות 696-712, `src/db.js` |
| 3 | `DEMO_OTP=true` ו-`SEED_DEMO=true` בפרוד החי | אומת: `POST /api/auth/otp/request` מחזיר `demoCode`; Render env |
| 4 | JWT: סוד ברירת-מחדל בקוד (`dev-insecure-secret`), תוקף 60 יום, בלי ביטול | `src/auth.js` |
| 5 | קודי OTP ומפתחות API של מכבסות שמורים גלויים ב-DB | `otp_codes`, `tenants.api_key` |
| 6 | `multer@1.4.5-lts.1` — גרסה עם CVEs ידועים | `package.json` |
| 7 | גיבוי ידני בלבד; אין שחזור מתועד, RPO/RTO, או התראות על תקלות | `scripts/backup.js`, `src/errlog.js` |
| 8 | פרטיות: אין מדיניות/תנאים, זכויות נושא מידע (תיקון 13), או retention jobs | — |
| 9 | `public/app.js` קובץ יחיד ענק — צוואר בקבוק לעבודה מקבילה; CSP עם `unsafe-inline` | `public/app.js`, `src/server.js` |
| 10 | דף תשלום/קבלה חושף כתובת לקוח דרך capability URL | `src/routes/pay.js` |
| 11 | אין מדידת כיסוי בדיקות, אין בדיקת עומס | — |
| 12 | תיעוד פריסה מיושן (render.yaml עדיין מתייחס ל-PG משותף של Render) | `render.yaml` מול מציאות Neon |

---

## 2. איך מחלקים לעבודה מקבילה בלי התנגשויות

**נקודות חיכוך בריפו (סדר קדימויות לבעלות):**
1. `src/schema.sql` / `src/migrations/*` — נעול לאפיק A עד סיום A3. אחר כך: מיגרציה חדשה = קובץ חדש בלבד (מספר רץ), אין עריכת קבצים קיימים.
2. `public/app.js` — בעלים יחיד בכל רגע (D3 או B7). שאר האפיקים לא נוגעים בו בזמן העבודות האלה.
3. `src/server.js` — הוספת route = שורה אחת; מיזוג אחרון, קונפליקט טריוויאלי.
4. `package.json` / `package-lock.json` — שינויי תלויות רק ב-B4 ו-G2, מתואמים מראש.
5. `docs/DEVELOPMENT.md`, `README.md` — עדכון בתוך המשימה שנוגעת בנושא.

**כללי עבודה (בנוסף ל-DEVELOPMENT.md):** משימה = בעלים אחד וענף אחד · קומיטים קטנים נושאיים · `git pull --rebase` לפני push · CI ירוק לפני מיזוג · מיגרציות הן קבצים חדשים בלבד, אף פעם לא עריכת קיימת.

**מפת אפיקים:** A תשתית/CI/מיגרציות · B אבטחה · C פרטיות ותאימות · D ביצועים · E גיבוי/ניטור · F כיסוי בדיקות · G מבנה קוד · H go-live.

**דירוג:** ערך = 🟥 גבוה / 🟨 בינוני / 🟦 נמוך. מאמץ = S עד יום · M יומיים-שלושה · L שבוע+.

---

## 3. האפיקים והמשימות

### אפיק A — תשתית, CI ומיגרציות (גֵיט לכל השאר)

| מזהה | משימה | ערך/מאמץ | קבצים | תלויות |
|---|---|---|---|---|
| A1 | **CI בפועל:** להעלות את ה-workflow המוכן מ-`docs/DEVELOPMENT.md` ל-`.github/workflows/ci.yml` דרך ממשק הווב של GitHub (או PAT חדש עם scope `workflow`), להוסיף badge ולחסום מיזוג על אדום | 🟥 / S | `.github/workflows/ci.yml`, `README.md` | פעולה ידנית חד-פעמית של בעל הריפו (GitHub חוסם דחיפת workflows ב-PAT רגיל) |
| A2 | **מיגרציות מגורסות:** `src/migrations/001_baseline.sql` (תוכן schema.sql הנוכחי) + טבלת `schema_migrations(version)` + runner ב-`src/migrate.js` שמריץ לפי סדר ורושם. בדיקה: DB חדש ו-DB קיים מגיעים לאותה סכימה (השוואת `pg_dump --schema-only`) | 🟥 / M | `src/migrations/*`, `src/migrate.js`, `src/db.js`, `test/migrations.test.js` (חדש), `docs/DEVELOPMENT.md` | — |
| A3 | **לנקות data-fixes מה-boot:** להעביר את מיזוג doc_counters, ניקוי כפילות reviews, הרחבת unit 'bag' ו-consolidated_billing מ-`schema.sql` למיגרציות חד-פעמיות. boot לא משנה נתונים יותר | 🟥 / S | `src/schema.sql`, `src/migrations/002+`, `src/db.js` | A2 |
| A4 | **לתקן תיעוד/קונפיג פריסה:** render.yaml ו-README מיושרים למציאות (Neon, ללא PGSCHEMA, הערת DEMO_OTP/SEED_DEMO כ-go-live gate) | 🟨 / S | `render.yaml`, `README.md`, `docs/DEVELOPMENT.md` | — |

**קריטריון קבלה לאפיק:** CI ירוק על main; boot על DB ריק ועל DB קיים עולה זהה; `npm test` ירוק.

### אפיק B — אבטחה

| מזהה | משימה | ערך/מאמץ | קבצים | תלויות |
|---|---|---|---|---|
| B1 | **JWT:** fail-fast בלי JWT_SECRET אמיתי (לא ליפול ל-`dev-insecure-secret` מחוץ ל-test), תוקף 7 ימים + עמודת `users.token_version` לביטול גלובלי + `POST /api/auth/logout` | 🟥 / M | `src/auth.js`, `src/routes/auth.js`, מיגרציה, `test/auth.test.js`, `test/session.test.js` | A2 |
| B2 | **OTP:** אחסון HMAC של הקוד (לא גלוי), מגבלת 10 ניסיונות אימות לקוד, מחיקת קודים שפגו (יחד עם C3) | 🟥 / S | `src/routes/auth.js`, מיגרציה, בדיקות | A2 |
| B3 | **hash למפתחות בוט:** `tenants.api_key_hash` (sha256), הצגת המפתח פעם אחת ביצירה/רוטציה, `botAuth` משווה hash, רוטציה מהאדמין | 🟥 / M | `src/routes/bot.js`, `src/routes/tenant.js`, `src/routes/admin.js`, מיגרציה (כולל גיבוי המפתחות הקיימים לבעלים לפני המרה), בדיקות | A2 |
| B4 | **העלאות + multer:** שדרוג multer לגרסה מתוקנת (2.x / lts עדכני), אימות magic-bytes (JPG/PNG/WEBP/PDF) בכל 4 נקודות ההעלאה, חסימת SVG, עזר משותף `src/uploads.js` | 🟥 / M | `package.json`, `src/uploads.js` (חדש), `src/routes/courier.js`, `src/routes/onboard.js`, `src/routes/tenant.js`, `src/routes/issue-photos.js`, בדיקות | — (תלויות package: תיאום עם G2) |
| B5 | **צמצום PII בקישורים פומביים:** דף תשלום/קבלה מציג סכומים ומספר הזמנה בלבד; כתובת/טלפון רק אחרי קוד אימות קצר (4 ספרות אחרונות של טלפון הלקוח) | 🟨 / M | `src/routes/pay.js`, `src/receipt.js`, בדיקות | — |
| B6 | **שרשרת אספקה:** `npm audit --audit-level=high` + gitleaks ב-CI, dependabot (חינם ב-GitHub) | 🟨 / S | `.github/workflows/ci.yml`, `.github/dependabot.yml` | A1 |
| B7 | **CSP בלי unsafe-inline:** שלב א — `Content-Security-Policy-Report-Only` מחמיר + endpoint דיווח; שלב ב — העברת inline handlers מ-`index.html` ל-`app.js` והחמרה בפועל | 🟨 / L | `src/server.js`, `public/index.html`, `public/app.js`, מיגרציה (טבלת דיווחים) | D3 (בעלים יחיד על app.js) |

### אפיק C — פרטיות ותאימות (תיקון 13 לחוק הגנת הפרטיות)

| מזהה | משימה | ערך/מאמץ | קבצים | תלויות |
|---|---|---|---|---|
| C1 | **דפי מדיניות פרטיות + תנאי שימוש** (סטטיים, עברית, RTL), קישור בפוטר וב-sitemap. **המשימה מייצרת טיוטה בלבד — פרסום מותנה באישור תוכן של הבעלים** | 🟥 / S | `public/privacy.html`, `public/terms.html`, `public/index.html`, `src/routes/seo.js` | — |
| C2 | **זכויות נושא מידע:** `GET /api/me/export` (כל הנתונים האישיים ב-JSON), `DELETE /api/me` (אנונימיזציה: מחיקת שם/טלפון/כתובות/סשנים, חסימת התחברות; שמירת מסמכים פיננסיים לפי חובת שמירת רשומות) | 🟥 / M | `src/routes/me.js` (חדש), `src/server.js` (שורה), `src/auth.js`, מיגרציה (`users.anonymized_at`), `test/me.test.js` | A2 |
| C3 | **Retention jobs:** מחיקה מתוזמנת של otp_codes שפגו, notifications מעל 90 יום, bot_sessions שפגו, push_subscriptions מתות (410/404 בשליחה — קוד קיים חלקית, להשלים) | 🟨 / S | `src/retention.js` (חדש), `src/server.js`, `src/push.js`, בדיקות | — |
| C4 | **הסכמה בהרשמה:** צ'קבוקס תנאים+פרטיות בצ'ק-אאוט הראשון, שמירת `users.consent_at` | 🟨 / S | `public/app.js` (בתיאום בעלים), `src/routes/auth.js`, מיגרציה, בדיקות | D3/B7 לא פעילים |

### אפיק D — ביצועים וסקיילביליות

| מזהה | משימה | ערך/מאמץ | קבצים | תלויות |
|---|---|---|---|---|
| D1 | **אינדקסים + EXPLAIN:** מבדק שאילתות חמות (`/api/laundries` + מיון מרחק, רשימת הזמנות, price-compare, דוחות אדמין), אינדקסים חסרים במיגרציה, תיעוד p95 ב-`docs/PERF.md` | 🟥 / M | מיגרציה, `docs/PERF.md`, `src/routes/*` (תיקוני N+1 נקודתיים) | A2 |
| D2 | **ETag למחירון:** תגובת `GET /api/t/:slug/pricelist` עם ETag לפי `max(updated_at)`; 304 חוסך את רוב הטעינות החוזרות בדף מכבסה | 🟨 / S | `src/routes/tenant.js`, `src/routes/public.js`, בדיקות | — |
| D3 | **פיצול `public/app.js` למודולים:** `public/js/` לפי מסך עם dynamic import לפי route. **בעלים יחיד — נועל את app.js** | 🟨 / L | `public/app.js` → `public/js/*.js`, `public/index.html`, `public/sw.js`, e2e | לתאם עם C4 ו-B7 |
| D4 | **תמונות קלות:** הקטנה/דחיסה ב-canvas בצד לקוח לפני העלאה (יעד <1MB), תקרה קשיחה בשרת, job ניקוי תמונות יתומות | 🟨 / M | `public/app.js` (UI העלאה), `src/routes/courier.js`, `src/routes/issue-photos.js`, `src/retention.js` | B4, C3; D3 לא פעיל |

### אפיק E — גיבוי, התאוששות וניטור

| מזהה | משימה | ערך/מאמץ | קבצים | תלויות |
|---|---|---|---|---|
| E1 | **גיבוי יומי אוטומטי (חינם):** GitHub Actions מתוזמן שמריץ `scripts/backup.js` מול Neon (DATABASE_URL ב-repo secrets) ושומר artifact ל-30 יום | 🟥 / S | `.github/workflows/backup.yml`, `scripts/backup.js`, `docs/RECOVERY.md` | A1 |
| E2 | **שחזור מתועד + תרגיל:** `scripts/restore.js` (JSON dump → סכימה ריקה), בדיקה אוטומטית export→restore→export, `docs/RECOVERY.md` עם RPO ≤24ש׳ / RTO ≤2ש׳ ונוהל חירום | 🟥 / M | `scripts/restore.js` (חדש), `test/backup.test.js`, `docs/RECOVERY.md` | E1 |
| E3 | **התראת תקלות לאדמין:** 500 חדש ב-`error_log` מפעיל הודעת WhatsApp/push לאדמין (דרך Twilio/push הקיימים), throttle של התראה אחת ל-10 דקות | 🟥 / S | `src/errlog.js`, `src/notify.js`, בדיקות | — |
| E4 | **מדדי בריאות:** הרחבת `/health` לאדמין (זמן DB, גודל סכימה, uptime, מניין 500 ב-24ש׳) + תצוגה בדשבורד אדמין | 🟨 / M | `src/server.js`, `src/routes/adminplus.js`, `public/app.js` (בתיאום בעלים) | D3 לא פעיל |
| E5 | **תיעוד DR:** נקודות כשל ומענה (Neon, Render, Twilio sandbox, Gemini, הבוט), סטטוס keepalive של cron-job.org | 🟨 / S | `docs/RECOVERY.md` | — |

### אפיק F — כיסוי בדיקות ותשתית QA

| מזהה | משימה | ערך/מאמץ | קבצים | תלויות |
|---|---|---|---|---|
| F1 | **מדידת כיסוי + סף ב-CI:** `node --test --experimental-test-coverage`, דוח בכל build, סף התחלתי 70% שורות | 🟥 / S | `package.json`, `.github/workflows/ci.yml`, `docs/DEVELOPMENT.md` | A1 |
| F2 | **e2e לזרימות תפקידים:** שליח מלא דרך UI, אישור מכבסה ע״י אדמין, מנוי מלא, חשבון עסקי + חשבונית מרכזת | 🟥 / M | `e2e/roles.spec.js`, `e2e/business.spec.js` (חדש) | — |
| F3 | **בדיקת עומס בסיסית:** autocannon (dev dep, חינם) מול שרת מקומי עם seed מנופח; תקציב p95: קריאות ציבוריות <500ms, יצירת הזמנה <1s; תוצאות ב-`docs/PERF.md` | 🟨 / M | `scripts/load.js` (חדש), `docs/PERF.md`, `package.json` | D1 |
| F4 | **חוזה בוט:** בדיקות שגיאה/אימות מלאות ל-`/api/bot/*` ו-`/api/bot-central/*` (מפתח שגוי, סשן פג, קלט חסר) | 🟨 / S | `test/bot.test.js`, `test/bot-central.test.js` | — |

### אפיק G — מבנה קוד וחוב טכני

| מזהה | משימה | ערך/מאמץ | קבצים | תלויות |
|---|---|---|---|---|
| G1 | **CODEOWNERS + מפת בעלות:** `.github/CODEOWNERS` לפי אפיקים/תיקיות, עדכון כללי המקביליות ב-DEVELOPMENT.md (כולל כלל המיגרציות החדש) | 🟨 / S | `.github/CODEOWNERS`, `docs/DEVELOPMENT.md` | A1 |
| G2 | **eslint + prettier חד-פעמי:** הגדרה, ריצת עיצוב אחת ב-PR ייעודי כשאין עבודות פתוחות, gate ב-CI | 🟨 / M | כל הריפו (one-shot מתואם), `.eslintrc`, `.prettierrc`, `ci.yml` | A1; אחרי גל 1, בתיאום מלא |

### אפיק H — בשלות ייצור (go-live)

| מזהה | משימה | ערך/מאמץ | קבצים | תלויות |
|---|---|---|---|---|
| H1 | **`docs/GO-LIVE.md` — צ'ק-ליסט:** `DEMO_OTP=false`, `SEED_DEMO=false`, VAPID mailto אמיתי, דומיין + PUBLIC_URL, Google OAuth client לפרוד, מדיניות פרטיות אושרה (C1), Twilio: נשאר sandbox עד החלטת תקציב — החלופה החינמית היא התראות push בלבד | 🟥 / S | `docs/GO-LIVE.md` | C1, B1 |
| H2 | **Bootstrap אדמין בלי דמו:** `ADMIN_PHONE` ב-env יוצר מנהל ראשון ב-DB ריק, בלי SEED_DEMO | 🟥 / S | `src/seed.js` / `src/server.js`, בדיקות | — |
| H3 | **ניקוי נתוני דמו מהפרוד:** סקריפט מתועד להסרת 4 המכבסות ומשתמשי הדמו לפני go-live (אחרי גיבוי E1) | 🟥 / S | `scripts/purge-demo.js`, `docs/GO-LIVE.md` | E1 |

---

## 4. סדר ביצוע מומלץ (גלים)

- **גל 0 (רציף, יד אחת — פותח את המקביליות):** A1 → A2 → A3 → A4
- **גל 1 (עד 4 מפתחים במקביל):** B1, B2, B3, B4 · E1, E2 · C1 · G1
- **גל 2 (עד 5 במקביל):** B5, B6 · C2, C3, C4 · E3, E4 · F1, F2, F4 · D1, D2 · H2
- **גל 3 (אחרון):** G2 (חלון מתואם) → D3 (בעלים יחיד על app.js) → D4, E4-UI, B7 → F3 → H1, H3, E5

כללי נעילה: `src/schema.sql`/`migrations` נעול לאפיק A בגל 0 · `public/app.js` נעול ל-D3/B7 בגל 3 · `package.json` משתנה רק ב-B4, F3, G2 (מתואם).

---

## 5. תוכנית בדיקות QA — להפעלה אחרי שלב הפיתוח

**שכבות (הכל חינם):** יחידה/אינטגרציה (`npm test`, סכימת Postgres מבודדת לכל קובץ) → e2e (`npm run test:e2e`, דסקטופ+מובייל) → חי (`scripts/qa-live.sh` מול הפרוד) → עומס (`scripts/load.js`).

**מטריצת רגרסיה (מינימום לריליס):**

| אזור | מקרי בדיקה מרכזיים |
|---|---|
| אימות | OTP מלא, קוד שגוי ×10 (429), פג תוקף, Google Sign-In, logout/ביטול טוקן (B1) |
| הזמנות | יצירה→ביטול, מקסימום סטטוסים, דאבל-קליק אישור (idempotency), חלון איסוף מלא, הזמנה חוזרת |
| שליחים | רישום+אישור, שיבוץ (אישור/דחייה), מסלול, סימון נאסף/הוחזר, דירוג |
| מנויים | רכישה, ניצול שקים, הזמנה חוזרת אוטומטית (job), שדרוג/ביטול |
| עסקי | חשבון עסקי, מחירון ייעודי, חשבונית מרכזת חודשית, מספור רציף ללא פערים |
| ביקורות/נקודות | צבירה ב-delivered בלבד, מימוש כהנחה, ביקורת אחת להזמנה, קופון |
| קהילה B2B | פוסט/תגובה/מכרז/קבוצת רכש — הרשאות לפי חברות |
| בוט | מחירון/חלונות/יצירת הזמנה/סטטוס עם api_key, סשן מרכזי פג |
| אדמין | אישור מכבסה/שליח, דשבורד, error_log, export |
| PWA | אופליין (באנר+מטמון), התקנה, התראת push, עגלה בענן אחרי login |

**בדיקות גבול:** cold start אחרי שינה (Render free), ניתוק רשת באמצע צ'ק-אאוט, timeout של Gemini/Twilio, העלאת קובץ 9MB (נדחה), DB לא זמין ב-boot.
**שימושיות מובייל:** RTL, מסכי 360px, מקלדת במסכי OTP וצ'ק-אאוט.

**קריטריון מעבר ריליס:** CI ירוק · e2e ירוק · qa-live PASS · אפס 500 חדשים ב-`error_log` ב-24ש׳ אחרי דיפלוי · כיסוי מעל הסף (F1).

---

## 6. תוכנית ביקורת אבטחה וסייבר — להפעלה אחרי שלב הפיתוח

**מודל איומים (ראשי):**
| איום | נכס | הגנה קיימת | פער שנסגר בתוכנית |
|---|---|---|---|
| Brute force OTP | חשבונות | rate limit ליעד+IP | B2 (hash + ניסיונות) |
| ניטרול טוקן גנוב | סשנים | — | B1 (תוקף קצר + token_version) |
| IDOR על הזמנות/מסמכים/תמונות | PII | בדיקות הרשאה בנתיבים מרכזיים | בדיקת IDOR ידנית (סעיף 6.2) |
| XSS בקהילה/ביקורות/שמות | משתמשים | `esc()` בצד לקוח | B7 (CSP מחמיר), בדיקת הזרקה ידנית |
| העלאה זדונית | שרת/משתמשים | fileFilter על שליחים בלבד | B4 (magic bytes + SVG בכל נקודה) |
| דליפת PII בקישור תשלום/קבלה | לקוחות | uuid בלתי ניחש | B5 (מיסוך + קוד) |
| גניבת api_key מה-DB | מכבסות/בוט | — | B3 (hash) |
| עלות Gemini מנוצלת | תקציב | — | B6+ניטור שגיאות; שקול limiter על `/api/onboard/extract` (חלק מ-B4) |
| זיוף outbound מהבוט | התראות | BOT_OUTBOUND_KEY | תיעוד בסיכונים, רוטציה תקופתית |
| דליפת סודות מהריפו | כל המערכת | — | B6 (gitleaks) |

**6.1 סריקות אוטומטיות (חינם):** OWASP ZAP baseline מול ה-URL החי · `npm audit` · gitleaks · בדיקת כותרות (securityheaders.com).

**6.2 ביקורת ידנית (רשימת בדיקה):**
1. מטריצת תפקידים מלאה (לקוח/מכבסה/שליח/אדמין/בוט/אנונימי) מול כל endpoint ב-`src/server.js` — כל שורה מסומנת הרשאה מצופה/בפועל.
2. IDOR ידני: הזמנות, מסמכים, תמונות תקלות, מסמכי שליח, כתובות, עגלה — ניסיון גישה עם טוקן של משתמש אחר.
3. הזרקות: שדות טקסט חופשי (שם, כתובת, הערות, פוסטים, ביקורות) עם `<script>`/HTML — וידוא escaping בתצוגה.
4. העלאות: קבצים עם סיומת מתחזה, polyglot, PDF עם JS.
5. פרוד env (Render): אין סודות מיותרים, `DEMO_OTP/SEED_DEMO` כבויים ב-go-live, JWT_SECRET חזק, רוטציה מתועדת.
6. לוגים: אין PII/סודות ב-`console.*` וב-`error_log` (שמירת body מצומצמת).

**קריטריון מעבר:** אפס ממצאים Critical/High פתוחים · Medium עם החלטת קבלה מתועדת · ביקורת חוזרת לפני go-live ואחרי כל שינוי ב-auth/העלאות/תשלומים.

---

## 7. הנחות וגבולות התוכנית

- סליקה אמיתית (Cardcom/Tranzila וכו') מחוץ לתוכנית — אילוץ ״בלי תשלומים״. נקודת ההרחבה (`src/routes/pay.js`) נשארת דמו.
- Twilio production ודומיין בתשלום — מחוץ לאילוצים; החלופות החינמיות (push, סנדבוקס) מתועדות ב-H1.
- בלי שירותי Render חדשים — לכן אין staging: בדיקות מקומיות + qa-live על הפרוד, וגיבוי/CI דרך GitHub Actions החינמי.
- דפי מדיניות/תנאים (C1) הם טיוטה בלבד ודורשים אישור בעלים לפני פרסום (אילוץ ״בלי פנייה לאנשים״).
- חשבוניות/מסמכים נשארים כפי שהם — אין שינוי שמחייב התייעצות מס או הגשות.
