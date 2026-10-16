// חילוץ מחירון/שעות/תקנון מתמונות דרך Gemini (vision). מחזיר JSON מובנה.
const BASE = () => process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/models/'; // B3: נקודת החלפה לסימולציה בבדיקות
const MODELS = () => [process.env.GEMINI_MODEL, 'gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'].filter((v,i,a)=>v&&a.indexOf(v)===i);

async function extractFromImages(apiKey, images) {
  // images: [{mimeType, base64}]
  const url = BASE() + (process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite') + ':generateContent?key=' + apiKey;
  const prompt = `אתה ממיר מסמכי מכבסה ל-JSON. קיבלת תמונות של מחירון מכבסה, שעות פעילות ו/או תקנון.
החזר אך ורק JSON תקין במבנה:
{
  "name": "שם המכבסה אם מופיע",
  "phone": "טלפון אם מופיע", "address": "כתובת אם מופיעה", "city": "עיר אם מופיעה",
  "items": [{"name":"שם פריט","price":0,"unit":"item|kg","category":"כביסה|ניקוי יבש|גיהוץ|שטיחים|אחר","confidence":"high|low"}],
  "hours": {"0":[["08:00","20:00"]],"1":[],...} // ימים 0=ראשון..6=שבת; רשימה ריקה=סגור
  ,
  "hours_confidence": "high|low",
  "terms": "נקודות עיקריות מהתקנון/מדיניות, עד 500 תווים",
  "delivery_fee": 0,
  "notes": "הערות לא בטוחות"
}
כללים:
- מחירים במספרים בשקלים בלבד, ללא סימן ₪. קרא כל ספרה בדיוק — הבדל של ספרה אחת משנה את המחיר.
- מחירי כביסה טיפוסיים הם 3-500 ש״ח לפריט. אם מחיר נראה חריג (0, או גבוה מאוד) — בדוק שוב; אם עדיין לא בטוח, סמן "confidence":"low".
- אם מחיר לא קריא בוודאות — אל תנחש: השאר את הפריט בחוץ וציין ב-notes כמה פריטים דולגו.
- "שק כביסה" או "כביסה במשקל" הם בדרך כלל מחיר לשק שלם (unit:"item") ולא לק״ג, אלא אם כתוב מפורשות מחיר לק״ג.
- שעות בפורמט HH:MM 24 שעות; שעת סגירה תמיד אחרי שעת פתיחה. אם השעות לא ברורות — סמן "hours_confidence":"low".
- אל תמציא פריטים, מחירים או שעות. אם שדה לא מופיע במסמכים — השאר ריק/ברירת מחדל.`;
  const parts = [{ text: prompt }, ...images.map(im => ({ inline_data: { mime_type: im.mimeType, data: im.base64 } }))];
  let r = null, lastErr = '';
  for (const m of MODELS()) {
    const u = BASE() + m + ':generateContent?key=' + apiKey;
    r = await fetch(u, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.1, responseMimeType: 'application/json' } })
    });
    if (r.ok) break;
    lastErr = m + ' HTTP ' + r.status + ': ' + (await r.text()).slice(0, 200);
    if (r.status !== 503 && r.status !== 429) throw new Error('Gemini ' + lastErr);
    console.warn('[gemini] ' + lastErr + ' — trying next model');
  }
  if (!r || !r.ok) throw new Error('Gemini unavailable: ' + lastErr);
  const data = await r.json();
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  try { return JSON.parse(text); } catch (e) {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('Gemini returned non-JSON');
  }
}
module.exports = { extractFromImages };
