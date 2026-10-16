-- C3: ימי סגירה/חגים למכבסה
CREATE TABLE IF NOT EXISTS tenant_closures (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  day date NOT NULL,
  note text,
  PRIMARY KEY (tenant_id, day)
);
