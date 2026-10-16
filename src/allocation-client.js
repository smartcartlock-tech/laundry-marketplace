// מתאם (adapter) לשירות מספרי ההקצאה של רשות המסים (חשבוניות ישראל, Approval V2).
// מקורות רשמיים בלבד:
//   מפרט שירות ההקצאה V2: https://www.gov.il/BlobFolder/generalpage/israel-invoice-160723/he/vat_software-houses-180724-en.pdf
//   אימות: OAuth2 "User Restricted" — העוסק מעניק הרשאה דרך פורטל ה-API של רשות המסים.
// עקרונות בטיחות (הוראת חיים 17:05):
//   * ברירת מחדל: מצב כבוי (off). שום קריאת רשת לא תצא בלי מתג מפורש + הרשאות.
//   * מצב simulated: מספר הקצאה מזויף ומסומן בבירור — לפיתוח ולבדיקות בלבד, לא מודפס על מסמך אמיתי.
//   * פרטי גישה (client id/secret) נקראים מ-env בזמן קריאה בלבד; הם יוזנו ב-Render מתוך ה-vault של חיים,
//     אף פעם לא בקוד, בצ'אט, בלוגים או במסד הנתונים.
//   * קריאה אמיתית לרשות (sandbox/production) תתבצע רק אחרי אישור מפורש של חיים למה שנשלח.

const SANDBOX_URL = 'https://ita-api.taxes.gov.il/shaam/tsandbox/Invoices/v2/Approval';
const PRODUCTION_URL = 'https://ita-api.taxes.gov.il/shaam/production/Invoices/v2/Approval';

// מצב עבודה: env ALLOCATION_MODE = off (ברירת מחדל) | simulated | sandbox | production
function mode() {
  const m = (process.env.ALLOCATION_MODE || 'off').trim().toLowerCase();
  return ['off', 'simulated', 'sandbox', 'production'].includes(m) ? m : 'off';
}

function isEnabled() { return mode() !== 'off'; }

// בקשת מספר הקצאה לחשבונית מס. פרמטרים לפי טבלה 2.1 במפרט הרשמי:
// invoiceId (מזהה פנימי A50), invoiceType (סוג מסמך N4), vatNumber (עוסק מנפיק N9),
// invoiceReferenceNumber (אסמכתא A20), customerVatNumber (עוסק לקוח N9),
// paymentAmount, paymentAmountIncludingVat, amountVat — סכומים 12.2N.
async function requestAllocation(input) {
  const m = mode();
  if (m === 'off') {
    return { ok: false, status: 'off', error: 'חיבור מספרי ההקצאה כבוי (ALLOCATION_MODE=off)' };
  }
  // ולידציות לפי המפרט — משותפות לכל המצבים
  const req = {
    invoice_id: String(input.invoiceId || ''),
    invoice_type: Number(input.invoiceType),
    vat_number: String(input.vatNumber || ''),
    invoice_reference_number: String(input.invoiceReferenceNumber || ''),
    customer_vat_number: String(input.customerVatNumber || ''),
    customer_name: input.customerName ? String(input.customerName).slice(0, 25) : undefined,
    payment_amount: input.paymentAmount,
    payment_amount_including_vat: input.paymentAmountIncludingVat,
    amount_vat: input.amountVat,
  };
  if (!req.invoice_id || req.invoice_id.length > 50) return { ok: false, error: 'invoice_id חסר/ארוך (A50)' };
  if (!Number.isInteger(req.invoice_type)) return { ok: false, error: 'invoice_type חייב להיות מספר שלם (N4)' };
  if (!/^[0-9]{9}$/.test(req.vat_number)) return { ok: false, error: 'vat_number חייב להיות 9 ספרות' };
  if (!req.invoice_reference_number || req.invoice_reference_number.length > 20) return { ok: false, error: 'invoice_reference_number חסר/ארוך (A20)' };
  if (!/^[0-9]{9}$/.test(req.customer_vat_number)) return { ok: false, error: 'customer_vat_number חייב להיות 9 ספרות' };

  if (m === 'simulated') {
    // מספר מזויף מסומן: מתחיל ב-000 כדי שלא יתבלבל עם מספר הקצאה אמיתי (9 ספרות)
    const fake = '000' + String(Math.abs(hashCode(req.invoice_id)) % 1000000).padStart(6, '0');
    return {
      ok: true, simulated: true,
      allocation_number: fake,
      warning: 'מספר הקצאה מדומה — אסור להדפיס על מסמך אמיתי',
      echo: req,
    };
  }

  // sandbox/production — קריאה אמיתית. דורש הרשאות שהוזנו מתוך ה-vault של חיים כ-env ב-Render.
  const clientId = process.env.SHAAM_CLIENT_ID;
  const clientSecret = process.env.SHAAM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return { ok: false, status: 'missing_credentials', error: 'חסרים פרטי גישה (SHAAM_CLIENT_ID/SECRET) — להזנה מה-vault של חיים בלבד' };
  }
  const token = await getToken(clientId, clientSecret);
  if (!token.ok) return { ok: false, status: 'auth_failed', error: token.error };
  const url = m === 'sandbox' ? SANDBOX_URL : PRODUCTION_URL;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` },
    body: JSON.stringify(req),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, status: res.status, error: (body && body.message) || 'שגיאת שירות הקצאה', raw_status: res.status };
  return { ok: true, simulated: false, allocation_number: body && (body.confirmation_number || body.allocation_number), raw: body };
}

// OAuth2 "User Restricted" — נקודת הטוקן הרשמית מוגדרת במדריך ה-OpenAPI של הרשות
// (מסמך OpenAPIUserGuide המקושר מהמפרט). מתעדכן לאחר קבלת הגישה; לא מנחשים כתובת.
let cachedToken = null;
async function getToken(clientId, clientSecret) {
  if (cachedToken && cachedToken.exp > Date.now() + 60000) return { ok: true, value: cachedToken.value };
  const tokenUrl = process.env.SHAAM_TOKEN_URL; // יוזן לפי מדריך ה-OpenAPI הרשמי עם קבלת הגישה
  if (!tokenUrl) return { ok: false, error: 'SHAAM_TOKEN_URL לא הוגדר — יוגדר לפי מדריך ה-OpenAPI הרשמי עם קבלת הגישה' };
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || !body.access_token) return { ok: false, error: 'אימות מול הרשות נכשל' };
  cachedToken = { value: body.access_token, exp: Date.now() + Number(body.expires_in || 3000) * 1000 };
  return { ok: true, value: cachedToken.value };
}

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return h;
}

module.exports = { mode, isEnabled, requestAllocation, SANDBOX_URL, PRODUCTION_URL };
