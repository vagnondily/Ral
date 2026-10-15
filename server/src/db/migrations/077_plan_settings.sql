-- MEMS 2.0 — Lot 5, § 6 : paramètres de la planification automatique. Migration 077.
--
-- Une ligne par compte (sans ligne : les valeurs initiales du code s'appliquent,
-- server/src/modules/tpm/planSettings.js DEFAULTS — un test statique compare ces
-- DEFAULT et ces CHECK aux constantes JS). Les paramètres PAR ACTIVITÉ (durée,
-- risque, faisable, personnes, suivis/jour, jours ouvrés) restent dans mmr_parameters :
-- une seule saisie.
--
-- Verrou optimiste : `revision` (un PUT avec une révision périmée → 409).
CREATE TABLE IF NOT EXISTS plan_settings (
  tenant_id              uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  objective              text     NOT NULL DEFAULT 'auto'
                         CHECK (objective IN ('auto', 'mmr_complet', 'couverture')),
  coverage_target_pct    smallint NOT NULL DEFAULT 80 CHECK (coverage_target_pct BETWEEN 1 AND 100),
  levels                 text[]   NOT NULL DEFAULT ARRAY['haute', 'moyenne', 'basse']::text[]
                         CHECK (cardinality(levels) BETWEEN 1 AND 3 AND levels <@ ARRAY['haute', 'moyenne', 'basse']::text[]),
  coverage_catch_up      boolean  NOT NULL DEFAULT true,
  day_grouping           text     NOT NULL DEFAULT 'commune'
                         CHECK (day_grouping IN ('lieu', 'commune', 'district')),
  fill_district          boolean  NOT NULL DEFAULT true,
  multi_activity_days    boolean  NOT NULL DEFAULT true,
  capacity_margin_pct    smallint NOT NULL DEFAULT 100 CHECK (capacity_margin_pct BETWEEN 10 AND 200),
  travel_days_per_tour   smallint NOT NULL DEFAULT 0 CHECK (travel_days_per_tour BETWEEN 0 AND 10),
  urgent_min_gap_months  smallint NOT NULL DEFAULT 1 CHECK (urgent_min_gap_months BETWEEN 1 AND 12),
  anticipation_months    smallint NOT NULL DEFAULT 0 CHECK (anticipation_months BETWEEN 0 AND 6),
  default_visits_per_day numeric(3,1) NOT NULL DEFAULT 1
                         CHECK (default_visits_per_day BETWEEN 0.5 AND 10 AND default_visits_per_day * 2 = trunc(default_visits_per_day * 2)),
  general_row_mode       text     NOT NULL DEFAULT 'par_bureau'
                         CHECK (general_row_mode IN ('par_bureau', 'commune')),
  revision               integer  NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_by             uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE plan_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON plan_settings;
CREATE POLICY tenant_isolation ON plan_settings
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mems2_app') THEN
    GRANT SELECT, INSERT, UPDATE ON plan_settings TO mems2_app;
  END IF;
END $$;
-- updated_by → users : contrôle « même compte » (049).
SELECT mems_install_same_tenant('plan_settings');
