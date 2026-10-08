-- Nettoyage / préparation des données de suivi avant analyse :
--  • exclusion de soumissions (curation) : excluded + motif. Les lignes
--    exclues ne comptent plus dans les indicateurs / le tableau de bord ;
--  • champs calculés (type Tableau) : variables dérivées par recode ou
--    expression sûre, réutilisables comme source d'indicateur.
ALTER TABLE monitoring_submissions ADD COLUMN IF NOT EXISTS excluded boolean NOT NULL DEFAULT false;
ALTER TABLE monitoring_submissions ADD COLUMN IF NOT EXISTS exclude_reason text;
CREATE INDEX IF NOT EXISTS idx_mon_sub_excluded ON monitoring_submissions (tenant_id, form_id, excluded);

CREATE TABLE IF NOT EXISTS monitoring_calc_fields (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  form_id       uuid NOT NULL REFERENCES monitoring_forms(id) ON DELETE CASCADE,
  name          text NOT NULL,
  label         text,
  kind          text NOT NULL DEFAULT 'expression' CHECK (kind IN ('expression', 'recode')),
  expression    text,
  source_field  text,
  mapping       jsonb,
  default_value text,
  sort_order    int NOT NULL DEFAULT 0,
  UNIQUE (form_id, name)
);
CREATE INDEX IF NOT EXISTS idx_mon_calc_form ON monitoring_calc_fields (tenant_id, form_id);

ALTER TABLE monitoring_calc_fields ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON monitoring_calc_fields;
CREATE POLICY tenant_isolation ON monitoring_calc_fields USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON monitoring_calc_fields TO mems2_app;
