-- T10: תבנית הודעת ביטול לבעל מכבסה — קוד מעקב + פירוט החזרים (דמו/סימולציה בלבד)
INSERT INTO message_templates (key, channel, title, body, variables) VALUES
 ('laundry_order_cancelled', 'in_app', 'הזמנה {{קוד}} בוטלה',
  'הזמנה {{קוד}} בוטלה על ידי {{לקוח}} (סה"כ ₪{{סכום}}). {{החזרים}}. מסמך דמו, אין חיוב אמיתי.',
  ARRAY['קוד','לקוח','סכום','החזרים'])
ON CONFLICT (key) DO NOTHING;
