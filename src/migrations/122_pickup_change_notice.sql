-- T25: תבנית התראת שינוי חלון איסוף לבעלים ולשליח (דמו/סימולציה בלבד)
INSERT INTO message_templates (key, channel, title, body, variables) VALUES
 ('pickup_window_changed', 'in_app', 'חלון איסוף שונה: {{קוד}}',
  'חלון האיסוף של הזמנה {{קוד}} ב{{מכבסה}} שונה ל-{{חלון}}. מסמך דמו.',
  ARRAY['קוד','חלון','מכבסה'])
ON CONFLICT (key) DO NOTHING;
