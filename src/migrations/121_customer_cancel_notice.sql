-- T24: תבנית אישור ביטול בכתב ללקוח — קוד מעקב + פירוט החזרים (דמו/סימולציה בלבד)
INSERT INTO message_templates (key, channel, title, body, variables) VALUES
 ('customer_order_cancelled', 'in_app', 'ההזמנה {{קוד}} בוטלה',
  'ביטלת את ההזמנה {{קוד}} ב{{מכבסה}}. {{החזרים}}. מסמך דמו, אין חיוב אמיתי.',
  ARRAY['קוד','מכבסה','החזרים'])
ON CONFLICT (key) DO NOTHING;
