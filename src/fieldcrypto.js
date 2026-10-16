// הצפנה ברמת שדה (AES-256-GCM) לנתונים פיננסיים רגישים — פרטי בנק, ספקים.
// המפתח ב-env: FIELD_ENC_KEY (32 בתים ב-base64). בלי מפתח אמיתי מחוץ לטסטים — fail-fast, כמו JWT_SECRET.
// פורמט שדה מוצפן: v1.<iv>.<tag>.<ciphertext> ב-base64url. שורה שאינה מתחילה ב-v1. היא מידע ישן לא-מוצפן.
const crypto = require('crypto');

function key(envName) {
  const s = process.env[envName];
  if (s) return Buffer.from(s, 'base64');
  if (process.env.NODE_ENV === 'test') return crypto.createHash('sha256').update('test-field-key').digest();
  throw new Error(envName + ' is required — refusing to encrypt/decrypt without a real key');
}
const KEY = () => { const k = key('FIELD_ENC_KEY'); if (k.length !== 32) throw new Error('FIELD_ENC_KEY must be 32 bytes base64'); return k; };

function encryptField(plain) {
  if (plain === null || plain === undefined || plain === '') return plain;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY(), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

function decryptField(stored) {
  if (stored === null || stored === undefined || stored === '') return stored;
  if (!String(stored).startsWith('v1.')) return stored; // מידע ישן טרם-מוצפן — קריאה שקופה
  const [, ivB, tagB, ctB] = String(stored).split('.');
  const d = crypto.createDecipheriv('aes-256-gcm', KEY(), Buffer.from(ivB, 'base64url'));
  d.setAuthTag(Buffer.from(tagB, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ctB, 'base64url')), d.final()]).toString('utf8');
}

// הצגה מוסתרת: 4 ספרות אחרונות בלבד
function maskField(stored) {
  const v = decryptField(stored);
  if (!v) return v;
  const s = String(v);
  return s.length <= 4 ? '••••' : '••••' + s.slice(-4);
}

module.exports = { encryptField, decryptField, maskField };
