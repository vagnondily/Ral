-- Bureaux & antennes : bureau pays (périmètre national) ou bureau terrain /
-- antenne avec un périmètre de communes. Les sites sont rattachés
-- automatiquement à un bureau selon leur commune (voir settings.repository
-- officesWithCounts). Une antenne est un bureau avec parent_id non nul.
CREATE TABLE IF NOT EXISTS field_offices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code        text NOT NULL,
  name        text NOT NULL,
  nature      text NOT NULL DEFAULT 'terrain' CHECK (nature IN ('pays', 'terrain')),
  parent_id   uuid REFERENCES field_offices(id) ON DELETE SET NULL,  -- antenne d'un bureau
  responsible text,
  national    boolean NOT NULL DEFAULT false,   -- périmètre = tous les sites
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

-- Périmètre d'un bureau : liste de communes (matchées sur sites.commune, le
-- district lève l'ambiguïté des homonymes).
CREATE TABLE IF NOT EXISTS field_office_communes (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  office_id uuid NOT NULL REFERENCES field_offices(id) ON DELETE CASCADE,
  district  text,
  commune   text NOT NULL,
  PRIMARY KEY (office_id, commune)
);

CREATE INDEX IF NOT EXISTS idx_field_offices_tenant ON field_offices (tenant_id);
CREATE INDEX IF NOT EXISTS idx_office_communes_lookup ON field_office_communes (tenant_id, commune);

ALTER TABLE field_offices ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_office_communes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON field_offices;
DROP POLICY IF EXISTS tenant_isolation ON field_office_communes;
CREATE POLICY tenant_isolation ON field_offices USING (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation ON field_office_communes USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON field_offices TO mems2_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON field_office_communes TO mems2_app;
