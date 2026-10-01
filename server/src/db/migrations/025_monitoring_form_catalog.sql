-- Catalogue de champs et listes de choix d'une fiche de suivi, importé depuis
-- un XLSForm (Kobo/ODK). Permet de configurer les indicateurs (mapping) dès
-- l'import du formulaire, avant toute soumission. Les champs dérivés des
-- soumissions (clés JSONB) restent utilisables en complément.
CREATE TABLE IF NOT EXISTS monitoring_form_fields (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  form_id    uuid NOT NULL REFERENCES monitoring_forms(id) ON DELETE CASCADE,
  name       text NOT NULL,
  type       text,
  label      text,
  group_path text,
  list_name  text,
  sort_order int NOT NULL DEFAULT 0,
  UNIQUE (form_id, name)
);

CREATE TABLE IF NOT EXISTS monitoring_choices (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  form_id    uuid NOT NULL REFERENCES monitoring_forms(id) ON DELETE CASCADE,
  list_name  text NOT NULL,
  value      text NOT NULL,
  label      text,
  sort_order int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_mon_fields_form ON monitoring_form_fields (tenant_id, form_id);
CREATE INDEX IF NOT EXISTS idx_mon_choices_form ON monitoring_choices (tenant_id, form_id, list_name);

ALTER TABLE monitoring_form_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitoring_choices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON monitoring_form_fields;
DROP POLICY IF EXISTS tenant_isolation ON monitoring_choices;
CREATE POLICY tenant_isolation ON monitoring_form_fields USING (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation ON monitoring_choices USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON monitoring_form_fields TO mems2_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON monitoring_choices TO mems2_app;
