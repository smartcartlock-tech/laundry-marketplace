// ולידציות קלט משותפות לנתיבים
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// פרמטרי נתיב שחייבים להיות uuid — מונע 22P02 מ-pg ומחזיר 400 ברור
function uuidParams(...names) {
  return (req, res, next) => {
    for (const n of names) {
      const v = req.params[n];
      if (v !== undefined && !UUID_RE.test(v)) {
        return res.status(400).json({ error: `מזהה לא תקין (${n})` });
      }
    }
    next();
  };
}

module.exports = { uuidParams, UUID_RE };
