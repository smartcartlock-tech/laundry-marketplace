-- אנליטיקה: אינדקסים לשאילתות טווח תאריכים (ללא שינוי נתונים)
CREATE INDEX IF NOT EXISTS orders_created_idx ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS orders_tenant_created_idx ON orders(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id);
