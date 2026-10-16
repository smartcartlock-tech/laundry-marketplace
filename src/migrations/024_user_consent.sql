-- C4: הסכמה לתנאי שימוש ומדיניות פרטיות בצ'ק-אאוט הראשון
ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_at timestamptz;
