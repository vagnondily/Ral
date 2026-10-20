-- MEMS 2.0 — Lot 8 (retour 28.3) : évaluation des agents. Migration 088.
--
-- (a) Note AUTOMATIQUE tirée des données de suivi, réglée PAR FICHE importée :
--     agent_score_configs   une configuration par fiche (active ou non, période proposée,
--                           nombre minimal de formulaires, couverture minimale du poids) ;
--     agent_score_criteria  les critères : mesure (volume de formulaires valides, part
--                           écartée, part avec GPS, part reliée à un site, ou un INDICATEUR de
--                           la fiche calculé sur les seuls formulaires de l'agent), poids,
--                           plancher (le critère vaut 0) et cible (il vaut 100 %).
--     Le sens découle de l'ordre des seuils (cible > plancher : plus c'est haut, mieux c'est ;
--     cible < plancher : plus c'est bas, mieux c'est) : plancher ≠ cible imposé par la base.
--     Calcul pur : server/src/modules/evaluation/agentScore.js. Rien n'est stocké tant que
--     l'évaluation n'est pas validée (note recalculée en direct).
-- (b) Appréciation QUALITATIVE : tpm_agent_evaluations est prolongée (période du … au …,
--     brouillon → validée par une autre personne, notes figées) + sa grille
--     tpm_agent_evaluation_scores (critères de portée « agent », migration 086). Les
--     évaluations existantes (note saisie à la main) restent lisibles : « ancienne évaluation ».
-- (c) Note FINALE = automatique × p + qualitative × (100 − p) (p = 60 par défaut,
--     evaluation_settings), figée à la validation avec son détail.

CREATE TABLE IF NOT EXISTS agent_score_configs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  form_id          uuid NOT NULL REFERENCES monitoring_forms(id) ON DELETE CASCADE,
  enabled          boolean NOT NULL DEFAULT true,
  period           text NOT NULL DEFAULT 'trimestre' CHECK (period IN ('mois', 'trimestre', 'semestre')),
  min_submissions  int NOT NULL DEFAULT 5 CHECK (min_submissions BETWEEN 1 AND 1000),
  min_coverage_pct int NOT NULL DEFAULT 60 CHECK (min_coverage_pct BETWEEN 1 AND 100),
  updated_by       uuid REFERENCES users(id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, form_id)
);

CREATE TABLE IF NOT EXISTS agent_score_criteria (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  config_id    uuid NOT NULL REFERENCES agent_score_configs(id) ON DELETE CASCADE,
  metric       text NOT NULL CHECK (metric IN ('volume', 'ecartes', 'gps', 'site', 'indicateur')),
  indicator_id uuid REFERENCES monitoring_indicators(id) ON DELETE CASCADE,
  label        text NOT NULL CHECK (length(btrim(label)) BETWEEN 2 AND 160),
  weight       numeric(6,2) NOT NULL CHECK (weight > 0 AND weight <= 100),
  floor        numeric(12,2) NOT NULL,
  target       numeric(12,2) NOT NULL,
  sort_order   int NOT NULL DEFAULT 0,
  CONSTRAINT agent_score_criteria_thresholds_chk CHECK (floor <> target),
  CONSTRAINT agent_score_criteria_indicator_chk CHECK ((metric = 'indicateur') = (indicator_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_agent_score_criteria_config ON agent_score_criteria (tenant_id, config_id);

-- L'indicateur d'un critère appartient à la fiche de SA configuration (contrôlé aussi par le service).
CREATE OR REPLACE FUNCTION mems_agent_criterion_form() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.indicator_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM monitoring_indicators i JOIN agent_score_configs c ON c.form_id = i.form_id
        WHERE i.id = NEW.indicator_id AND c.id = NEW.config_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'L''indicateur d''un critère doit appartenir à la fiche configurée.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_agent_criterion_form ON agent_score_criteria;
CREATE TRIGGER trg_agent_criterion_form BEFORE INSERT OR UPDATE ON agent_score_criteria
  FOR EACH ROW EXECUTE FUNCTION mems_agent_criterion_form();

-- ---- Appréciation qualitative et note finale --------------------------------------------
ALTER TABLE tpm_agent_evaluations
  ADD COLUMN IF NOT EXISTS period_to    date,
  ADD COLUMN IF NOT EXISTS status       text NOT NULL DEFAULT 'validee',
  ADD COLUMN IF NOT EXISTS legacy       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS evaluated_on date,
  ADD COLUMN IF NOT EXISTS qual_score   numeric(4,1),
  ADD COLUMN IF NOT EXISTS auto_score   numeric(4,1),
  ADD COLUMN IF NOT EXISTS auto_detail  jsonb,
  ADD COLUMN IF NOT EXISTS auto_weight  int,
  ADD COLUMN IF NOT EXISTS final_score  numeric(4,1),
  ADD COLUMN IF NOT EXISTS band         text,
  ADD COLUMN IF NOT EXISTS validated_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at   timestamptz NOT NULL DEFAULT now();

-- Les évaluations déjà saisies (note à la main) deviennent des « anciennes évaluations », validées.
UPDATE tpm_agent_evaluations SET legacy = true, period_to = date_trunc('month', periode)::date, evaluated_on = created_at::date
 WHERE period_to IS NULL;
ALTER TABLE tpm_agent_evaluations ALTER COLUMN status SET DEFAULT 'brouillon';
ALTER TABLE tpm_agent_evaluations ALTER COLUMN period_to SET NOT NULL;

ALTER TABLE tpm_agent_evaluations
  DROP CONSTRAINT IF EXISTS agent_eval_status_chk,
  DROP CONSTRAINT IF EXISTS agent_eval_period_chk,
  DROP CONSTRAINT IF EXISTS agent_eval_scores_chk,
  DROP CONSTRAINT IF EXISTS agent_eval_band_chk,
  DROP CONSTRAINT IF EXISTS agent_eval_duty_chk,
  DROP CONSTRAINT IF EXISTS agent_eval_validated_chk;
ALTER TABLE tpm_agent_evaluations
  ADD CONSTRAINT agent_eval_status_chk CHECK (status IN ('brouillon', 'validee')),
  ADD CONSTRAINT agent_eval_period_chk CHECK (extract(day FROM period_to) = 1 AND period_to >= date_trunc('month', periode)::date
                                             AND period_to < periode + interval '24 months'),
  ADD CONSTRAINT agent_eval_scores_chk CHECK ((qual_score IS NULL OR qual_score BETWEEN 0 AND 20)
                                             AND (auto_score IS NULL OR auto_score BETWEEN 0 AND 20)
                                             AND (final_score IS NULL OR final_score BETWEEN 0 AND 20)
                                             AND (auto_weight IS NULL OR auto_weight BETWEEN 0 AND 100)),
  ADD CONSTRAINT agent_eval_band_chk CHECK (band IS NULL OR band IN ('excellent', 'bon', 'moyen', 'insuffisant')),
  -- Séparation des tâches : la personne qui valide n'est pas l'évaluateur ; une évaluation validée
  -- (hors anciennes) a toujours son évaluateur (sinon la règle ne pourrait pas être vérifiée).
  ADD CONSTRAINT agent_eval_duty_chk CHECK ((validated_by IS NULL OR evaluated_by IS NULL OR validated_by <> evaluated_by)
                                            AND (legacy OR status <> 'validee' OR evaluated_by IS NOT NULL)),
  -- Une évaluation validée (hors anciennes) porte son valideur, sa date et sa note finale figée.
  ADD CONSTRAINT agent_eval_validated_chk CHECK (legacy OR (status = 'validee') = (validated_by IS NOT NULL AND validated_at IS NOT NULL
                                                  AND final_score IS NOT NULL AND band IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_agent_eval_period ON tpm_agent_evaluations (tenant_id, agent_id, period_to DESC);

CREATE TABLE IF NOT EXISTS tpm_agent_evaluation_scores (
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  evaluation_id   uuid NOT NULL REFERENCES tpm_agent_evaluations(id) ON DELETE CASCADE,
  criterion_code  text NOT NULL CHECK (criterion_code ~ '^[a-z0-9_]{2,40}$'),
  criterion_label text NOT NULL CHECK (length(criterion_label) BETWEEN 1 AND 160),
  weight          numeric(5,2) NOT NULL CHECK (weight > 0 AND weight <= 100),
  sort_order      int NOT NULL DEFAULT 0,
  rating          smallint CHECK (rating IS NULL OR rating BETWEEN 1 AND 4),
  comment         text CHECK (comment IS NULL OR length(comment) <= 1000),
  PRIMARY KEY (evaluation_id, criterion_code)
);

-- Évaluation validée figée (même règle que celle d'un prestataire, migration 086) ; les anciennes
-- évaluations gardent leur comportement d'origine (suppression possible par l'ancien écran).
CREATE OR REPLACE FUNCTION mems_agent_eval_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  IF OLD.status = 'validee' AND NOT OLD.legacy THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'Évaluation validée : elle ne peut plus être modifiée ni supprimée.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_agent_eval_frozen ON tpm_agent_evaluations;
CREATE TRIGGER trg_agent_eval_frozen BEFORE UPDATE OR DELETE ON tpm_agent_evaluations
  FOR EACH ROW EXECUTE FUNCTION mems_agent_eval_frozen();

CREATE OR REPLACE FUNCTION mems_agent_eval_scores_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  st text;
  old_row boolean;
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  SELECT status, legacy INTO st, old_row FROM tpm_agent_evaluations
   WHERE id = CASE TG_OP WHEN 'DELETE' THEN OLD.evaluation_id ELSE NEW.evaluation_id END;
  IF FOUND AND st = 'validee' AND NOT old_row THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Évaluation validée : sa grille ne peut plus être modifiée.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_agent_eval_scores_frozen ON tpm_agent_evaluation_scores;
CREATE TRIGGER trg_agent_eval_scores_frozen BEFORE INSERT OR UPDATE OR DELETE ON tpm_agent_evaluation_scores
  FOR EACH ROW EXECUTE FUNCTION mems_agent_eval_scores_frozen();

ALTER TABLE agent_score_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_score_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE tpm_agent_evaluation_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON agent_score_configs;
CREATE POLICY tenant_isolation ON agent_score_configs
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS tenant_isolation ON agent_score_criteria;
CREATE POLICY tenant_isolation ON agent_score_criteria
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS tenant_isolation ON tpm_agent_evaluation_scores;
CREATE POLICY tenant_isolation ON tpm_agent_evaluation_scores
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mems2_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON agent_score_configs, agent_score_criteria, tpm_agent_evaluation_scores TO mems2_app;
  END IF;
END $$;

-- Références entre tables d'un compte : contrôle « même compte » (migration 049).
SELECT mems_install_same_tenant('agent_score_configs');
SELECT mems_install_same_tenant('agent_score_criteria');
SELECT mems_install_same_tenant('tpm_agent_evaluations');
SELECT mems_install_same_tenant('tpm_agent_evaluation_scores');
