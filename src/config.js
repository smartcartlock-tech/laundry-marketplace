// A2 (מוצר): מצב סביבה יחיד — APP_MODE=demo|pilot.
// demo (ברירת מחדל): התנהגות הדמו הנוכחית ללא שינוי. pilot: בלי הזרעת דמו, בלי הצגת קוד OTP, בלי תשלום דמו.
const MODE = (process.env.APP_MODE || 'demo').trim() === 'pilot' ? 'pilot' : 'demo';
// G5: בדמו — הודעות יוצאות אמיתיות (וואטסאפ/מייל) רק למספרים ברשימת ההיתר (בקשת המשתמש: מספר חיים).
// ריק = כל השליחות בדמו מדומות בלבד. ב-pilot אין הגבלה.
const DEMO_NOTIFY_ALLOWLIST = (process.env.DEMO_NOTIFY_ALLOWLIST || '').split(',').map(x => x.trim()).filter(Boolean);
module.exports = { MODE, isPilot: MODE === 'pilot', isDemo: MODE === 'demo', DEMO_NOTIFY_ALLOWLIST };
