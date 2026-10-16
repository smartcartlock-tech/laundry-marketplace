-- QA-flow: ביקורת אחת ללקוח להזמנה (מכבסה + שליח בנפרד) — מונע בונוס כפול בתחרות
DELETE FROM reviews a USING reviews b
 WHERE a.ctid > b.ctid AND a.order_id=b.order_id AND a.user_id=b.user_id
   AND ((a.target_courier_id IS NULL AND b.target_courier_id IS NULL) OR a.target_courier_id=b.target_courier_id);
CREATE UNIQUE INDEX IF NOT EXISTS reviews_laundry_uniq ON reviews(order_id, user_id) WHERE target_courier_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS reviews_courier_uniq ON reviews(order_id, user_id, target_courier_id) WHERE target_courier_id IS NOT NULL;
