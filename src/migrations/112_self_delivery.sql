-- T108: מסירה עצמית בלי שליח — בעלים מסירה בעצמו; מאפשר קידום סטטוס בלי courier_id
ALTER TABLE orders ADD COLUMN IF NOT EXISTS self_delivery boolean NOT NULL DEFAULT false;
