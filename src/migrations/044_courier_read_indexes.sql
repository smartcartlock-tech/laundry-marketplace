-- מסך שליח: אינדקסים לקריאות החמות של מסך השליח (day-route/tasks/history/offers)
-- נמצא בבדיקת עומס: 200 שליחים / 1000 הזמנות — seq scan על orders לפי courier_id
CREATE INDEX IF NOT EXISTS orders_courier_idx ON orders(courier_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS route_stops_order_idx ON courier_route_stops(order_id);
