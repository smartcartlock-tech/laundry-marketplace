// B4: אבטחת העלאות — אימות תוכן קובץ (magic bytes) ולא רק סיומת/mimetype.
// mimetype מגיע מהלקוח ואינו ראיה; לכן כל קובץ שעלה נבדק מול החתימות הבינאריות שלו.
const MAGIC = [
  { mime: 'image/jpeg', test: b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', test: b => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/webp', test: b => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
  { mime: 'application/pdf', test: b => b.length > 5 && b.toString('ascii', 0, 5) === '%PDF-' },
];
const IMAGES = ['image/jpeg', 'image/png', 'image/webp'];

// מזהה את סוג הקובץ האמיתי מהבייטים; מחזיר null אם לא זוהה (כולל SVG/HTML/EXE — כולם נדחים)
function sniff(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return null;
  // SVG/HTML מבוססי טקסט: דחייה מפורשת גם אם ידווחו כ-image
  const head = buffer.toString('ascii', 0, Math.min(buffer.length, 256)).trimStart().toLowerCase();
  if (head.startsWith('<')) return null;
  const hit = MAGIC.find(m => m.test(buffer));
  return hit ? hit.mime : null;
}

// fileFilter למולטר: שלב ראשון לפי mimetype מדווח (השלב המכריע הוא ה-sniff על הבאפר)
function fileFilter(allowed) {
  return (req, file, cb) => {
    const ok = allowed.includes(file.mimetype);
    cb(ok ? null : Object.assign(new Error('סוג קובץ לא נתמך'), { code: 'BAD_FILE_TYPE' }), ok);
  };
}

// בדיקה מכרעת אחרי העלאה: הבאפר תואם לסוג המדווח ונמצא ברשימת המותרים
function verifyFile(file, allowed) {
  if (!file || !file.buffer) return false;
  const real = sniff(file.buffer);
  return !!real && real === file.mimetype && allowed.includes(real);
}

// לתמונות base64 (תמונות תקלות): מפענח ומוודא שהתוכן תואם לסוג המדווח
function verifyB64Image(contentType, dataB64, maxBytes) {
  if (!/^image\/(jpeg|png|webp)$/.test(contentType || '')) return null;
  let buf;
  try { buf = Buffer.from(dataB64, 'base64'); } catch { return null; }
  if (!buf.length || (maxBytes && buf.length > maxBytes)) return null;
  return sniff(buf) === contentType ? buf : null;
}

module.exports = { sniff, fileFilter, verifyFile, verifyB64Image, IMAGES };
