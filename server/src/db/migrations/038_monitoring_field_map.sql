-- Surcharge manuelle du mapping « formulaire ↔ référentiels MEMS ». Une ligne
-- par fiche × dimension MEMS indique la colonne du formulaire choisie à la main
-- (column_name NULL / '' = dimension explicitement « non reliée », pour écraser
-- une détection automatique erronée). Absence de ligne = détection automatique.
CREATE TABLE IF NOT EXISTS monitoring_field_map (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  form_id     uuid NOT NULL REFERENCES monitoring_forms(id) ON DELETE CASCADE,
  dimension   text NOT NULL,
  column_name text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (form_id, dimension)
);
CREATE INDEX IF NOT EXISTS idx_mon_field_map_form ON monitoring_field_map (tenant_id, form_id);

ALTER TABLE monitoring_field_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON monitoring_field_map;
CREATE POLICY tenant_isolation ON monitoring_field_map USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON monitoring_field_map TO mems2_app;
