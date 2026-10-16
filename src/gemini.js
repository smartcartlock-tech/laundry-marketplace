// חילוץ מחירון/שעות/תקנון מתמונות דרך Gemini (vision). מחזיר JSON מובנה.
const MODELS = () => [process.env.GEMINI_MODEL, 'gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'].filter((v,i,a)=>v&&a.indexOf(v)===i);

async function extractFromImages(apiKey, images) {
  // images: [{mimeType, base64}]
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + (process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite') + ':generateContent?key=' + apiKey;
  const prompt = `אתה ממיר מסמכי מכבסה ל-JSON. קיבלת תמונות של מחירון מכבסה, שעות פעילות ו/או תקנון.
החזר אך ורק JSON תקין במבנה:
{
  "name": "שם המכבסה אם מופיע",
  "items": [{"name":"שם פריט","price":0,"unit":"item|kg","category":"כביסה|ניקוי יבש|גיהוץ|שטיחים|אחר"}],
  "hours": {"0":[["08:00","20:00"]],"1":[],...} // ימים 0=ראשון..6=שבת; רשימה ריקה=סגור
  ,
  "terms": "נקודות עיקריות מהתקנון/מדיניות, עד 500 תווים",
  "delivery_fee": 0,
  "notes": "הערות לא בטוחות"
}
כללים: מחירים במספרים בשקלים בלבד. אל תמציא פריטים. אם שדה לא מופיע במסמכים — השאר ריק/ברירת מחדל.`;
  const parts = [{ text: prompt }, ...images.map(im => ({ inline_data: { mime_type: im.mimeType, data: im.base64 } }))];
  let r = null, lastErr = '';
  for (const m of MODELS()) {
    const u = 'https://generativelanguage.googleapis.com/v1beta/models/' + m + ':generateContent?key=' + apiKey;
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
