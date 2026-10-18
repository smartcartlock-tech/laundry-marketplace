-- T106 (צוות J): זמן עבודה מוצהר של המכבסה בשעות — בסיס לחישוב צפי החזרה (ETA)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS turnaround_hours int NOT NULL DEFAULT 24;
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_turnaround_hours_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_turnaround_hours_check CHECK (turnaround_hours BETWEEN 1 AND 168);
