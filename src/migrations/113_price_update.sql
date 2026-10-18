-- T121: צעד שקילה/עדכון מחיר עם אישור לקוח לפני גבייה
-- price_update: {from_total,to_total,items:[{name,qty,price}],note,status:'pending'|'approved'|'rejected',requested_at,responded_at}
ALTER TABLE orders ADD COLUMN IF NOT EXISTS price_update jsonb;
