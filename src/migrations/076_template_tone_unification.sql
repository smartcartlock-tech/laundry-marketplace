-- N8: איחוד טון של כל תבניות ההודעה — עברית פשוטה, בלי ניסוח מנופח, סימון דמו עקבי
UPDATE message_templates SET title='עדכון על ההזמנה שלך', body='שלום {{name}}, הזמנה {{order_id}} עברה לסטטוס: {{status}}.' WHERE key='order_status_in_app';
UPDATE message_templates SET title='ברוכים הבאים (דמו)', body='שלום {{name}}! שמחים שהצטרפת למכבסה בקליק. זו הודעת דמו — לא נשלח דבר באמת.' WHERE key='welcome_sim';
UPDATE message_templates SET title='קבלה במייל (דמו)', body='היי {{name}}, מצורפת קבלה על הזמנה {{order_id}} בסך ₪{{total}}. מסמך דמו — לא לצורכי מע"מ.' WHERE key='receipt_email_sim';
UPDATE message_templates SET title='משימה חדשה: הזמנה {{קוד}}', body='{{סוג}}: הזמנה {{קוד}} ב{{מכבסה}}. כתובת: {{כתובת}}' WHERE key='courier_new_task';
UPDATE message_templates SET title='הזמנה חדשה {{קוד}}', body='הזמנה חדשה מ{{לקוח}} (קוד מעקב {{קוד}}) — סה"כ ₪{{סכום}}. מסמך דמו, אין חיוב אמיתי.' WHERE key='laundry_new_order';
UPDATE message_templates SET title='סיכום יומי ליום {{תאריך}}', body='סיכום יומי (דמו): היום {{מספר_הזמנות}} הזמנות, הכנסה ₪{{הכנסה}}. חריגים: {{חריגים}}. מסמך דמו — להמחשה בלבד.' WHERE key='owner_daily_summary';
