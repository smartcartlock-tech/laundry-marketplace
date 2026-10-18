-- T109: העשרת כרטיס הצעת שיבוץ — תגמול משוער (₪) ומרחק (ק"מ) מחושבים בזמן ההצעה
ALTER TABLE dispatch_offers ADD COLUMN IF NOT EXISTS payout_estimate numeric;
ALTER TABLE dispatch_offers ADD COLUMN IF NOT EXISTS distance_km numeric;
