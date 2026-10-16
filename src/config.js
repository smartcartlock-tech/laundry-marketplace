// A2 (מוצר): מצב סביבה יחיד — APP_MODE=demo|pilot.
// demo (ברירת מחדל): התנהגות הדמו הנוכחית ללא שינוי. pilot: בלי הזרעת דמו, בלי הצגת קוד OTP, בלי תשלום דמו.
const MODE = (process.env.APP_MODE || 'demo').trim() === 'pilot' ? 'pilot' : 'demo';
module.exports = { MODE, isPilot: MODE === 'pilot', isDemo: MODE === 'demo' };
