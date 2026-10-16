# ביצועים — מבדק שאילתות חמות (D1)

תאריך מבדק: 16.10.2026. שיטה: EXPLAIN ANALYZE על DB מקומי מנופח (200 מכבסות, 20,000 הזמנות, 32,000 אירועים, 12,000 ביקורות, 4,000 דיווחי תקלות). מדידת p95 אמיתית מול שרת — ב-F3 (autocannon).

## תוצאות ואינדקסים שהוספו (מיגרציה 012)

| שאילתה | מקור | לפני | אחרי | שינוי |
|---|---|---|---|---|
| דירוג/ביקורות לפי מכבסה | דף מכבסה, `botcentral.js` | Seq Scan על 12K ביקורות, 1.57ms | Bitmap Index על `reviews_tenant_idx`, 0.18ms | ~×9 |
| דוח SLA לאדמין (picked_up ב-30 יום) | `admin.js` | Seq Scan על 32K אירועים, 12.0ms | Bitmap Index על `order_events_status_created_idx`, 6.8ms | ~×2 (נותר seq על orders בצד הjoin — סביר בגודל הזה) |
| ביקורות של משתמש ("שלי") | `me.js` | Seq Scan | `reviews_user_idx` | נוסף |

## שאילתות שנבדקו ונמצאו תקינות

- **רשימת מכבסות** `GET /api/laundries`: Seq Scan על tenants — נכון ב-200 שורות (יש אינדקס ייחודי על slug). תת-השאילתות של min(price) כבר משתמשות ב-`items_tenant_idx`. 2.1ms.
- **רשימת הזמנות למכבסה**: משתמשת ב-`orders_tenant_idx` — 0.3ms. כיסוי נוסף לפי created_at נוסף ב-050 (אנליטיקה).
- **דיווחי תקלה להזמנה**: `issue_reports_one_per_customer` כבר מכסה.
- **אירועי הזמנה**: `events_order_idx` מכסה timeline.

## ממצא כנה: price-compare לא נפתר באינדקס

`GET /api/laundries/:slug/price-compare` עושה self-join על `price_items` לפי (name, unit). ניסיתי אינדקס `(name, unit) WHERE active` — **ה-planner לא בוחר בו אפילו ב-50,000 שורות** (40ms), כי הסלקטיביות נמוכה מבנהית: כל המכבסות חולקות את אותם שמות פריטים, ו-hash join על הסריקה המלאה זול יותר. האינדקס הוסר מהמיגרציה כדי לא לשלם write-amplification על אינדקס מת.

- 5K שורות: ~4ms. 50K שורות: ~40ms — עדיין בסדר ל-endpoint שאינו קריטי-דרך.
- הפתרון הנכון לגדילה: cache/ETag (D2) או טבלת min-price מחושבת — לא אינדקס.

## המלצות המשך

1. F3: מדידת p95 אמיתית עם autocannon מול seed מנופח (תקציב: ציבוריות <500ms, יצירת הזמנה <1s).
2. אם tenants יגדל לאלפים: לשקול אינדקס חלקי `(created_at) WHERE approved` ל-/api/laundries, ו-trigram (pg_trgm) לחיפוש ה-ILIKE.
