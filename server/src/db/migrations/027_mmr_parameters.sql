-- MMR — Minimum Monitoring Requirements (feuille « Overarching parameters » du
-- Plan de suivi) : par bureau × catégorie d'activité, les paramètres qui
-- pilotent la fréquence de suivi. L'intervalle, la fréquence, le nombre ciblé
-- et le ratio sont DÉRIVÉS (mmrMath.deriveMmr), pas stockés.
CREATE TABLE IF NOT EXISTS mmr_parameters (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  field_office_id    uuid NOT NULL REFERENCES field_offices(id) ON DELETE CASCADE,
  activity_category  text NOT NULL,
  operation_duration int  NOT NULL DEFAULT 12 CHECK (operation_duration >= 0 AND operation_duration <= 12),
  number_of_sites    int  NOT NULL DEFAULT 0  CHECK (number_of_sites >= 0),
  risk_level         int  NOT NULL DEFAULT 2  CHECK (risk_level BETWEEN 1 AND 3),
  feasible           int  CHECK (feasible IS NULL OR feasible >= 0),
  note               text,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, field_office_id, activity_category)
);

CREATE INDEX IF NOT EXISTS idx_mmr_params_lookup ON mmr_parameters (tenant_id, field_office_id);

ALTER TABLE mmr_parameters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON mmr_parameters;
CREATE POLICY tenant_isolation ON mmr_parameters USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON mmr_parameters TO mems2_app;
