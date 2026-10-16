-- מסך שליח: סגירת מרוץ שיבוץ מקבילי ב-auto-build
-- נמצא בבדיקת עומס קצה: 8 בניית מסלולים מקבילות → 1600 עצירות ל-200 הזמנות (כל הזמנה ב-8 מסלולים).
-- הזמנה יכולה להיות משובצת למסלול אחד בלבד — אילוץ ברמת בסיס הנתונים.
-- הצד המפסיד במרוץ יקבל שגיאת ייחודיות ויתבטל (rollback) במקום לייצר שיבוץ כפול שקט.

-- ניקוי כפילויות קיימות: נשארת העצירה הראשונה שנוצרה לכל הזמנה
DELETE FROM courier_route_stops a
USING courier_route_stops b
WHERE a.order_id = b.order_id
  AND (a.created_at > b.created_at OR (a.created_at = b.created_at AND a.id > b.id));

CREATE UNIQUE INDEX IF NOT EXISTS route_stops_order_uniq ON courier_route_stops(order_id);

-- route_stops_order_idx מ-044 מיותר כעת (האינדקס הייחודי מכסה אותו)
DROP INDEX IF EXISTS route_stops_order_idx;
