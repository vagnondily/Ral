-- MEMS 2.0 — Lot 8 (retour 28.1) : fiche d'évaluation du prestataire TPM. Migration 086.
--
-- 1. evaluation_criteria : grilles d'appréciation qualitative, par compte et par portée
--    (« prestataire » : proactivité, budgétisation, déploiement… ; « agent » : comportement,
--    protocole…, utilisée par l'évaluation des agents, retour 28.3). Les critères par défaut
--    sont créés à la première lecture par le service (une seule source :
--    server/src/modules/evaluation/gridScore.js DEFAULT_CRITERIA), jamais recopiés ici.
-- 2. evaluation_settings : poids des notes combinées (un réglage par compte, valeurs par
--    défaut documentées dans gridScore.js et docs/SPEC_LOT_8.md).
-- 3. tpm_provider_evaluations (+ _scores) : évaluation datée d'un prestataire sur une
--    période (du … au …), par un évaluateur ; brouillon → validée par une AUTRE personne
--    (séparation des tâches, contrainte en base). Les notes sont RECALCULÉES par le serveur
--    et figées à la validation (jamais prises du client) ; une évaluation validée n'est plus
--    modifiable ni supprimable (déclencheurs). Les critères notés gardent leur libellé et leur
--    poids du moment (une grille modifiée plus tard ne réécrit pas l'historique).

CREATE TABLE IF NOT EXISTS evaluation_criteria (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope      text NOT NULL CHECK (scope IN ('agent', 'prestataire')),
  code       text NOT NULL CHECK (code ~ '^[a-z0-9_]{2,40}$'),
  label      text NOT NULL CHECK (length(btrim(label)) BETWEEN 2 AND 160),
  help       text CHECK (help IS NULL OR length(help) <= 400),
  weight     numeric(5,2) NOT NULL DEFAULT 1 CHECK (weight > 0 AND weight <= 100),
  sort_order int NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, scope, code)
);

CREATE TABLE IF NOT EXISTS evaluation_settings (
  tenant_id              uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  -- Note finale d'un agent = note automatique × p + appréciation qualitative × (100 − p).
  agent_auto_weight      int NOT NULL DEFAULT 60 CHECK (agent_auto_weight BETWEEN 0 AND 100),
  -- Note d'un prestataire = moyenne des notes de ses agents × q + grille du prestataire × (100 − q).
  provider_agents_weight int NOT NULL DEFAULT 30 CHECK (provider_agents_weight BETWEEN 0 AND 100),
  updated_by             uuid REFERENCES users(id),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tpm_provider_evaluations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  partner_id     uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  period_from    date NOT NULL CHECK (extract(day FROM period_from) = 1),
  period_to      date NOT NULL CHECK (extract(day FROM period_to) = 1),
  evaluated_on   date NOT NULL DEFAULT current_date,
  status         text NOT NULL DEFAULT 'brouillon' CHECK (status IN ('brouillon', 'validee')),
  comment        text CHECK (comment IS NULL OR length(comment) <= 2000),
  -- Notes sur 20, recalculées par le serveur ; figées à la validation.
  grid_score     numeric(4,1) CHECK (grid_score IS NULL OR grid_score BETWEEN 0 AND 20),
  agents_score   numeric(4,1) CHECK (agents_score IS NULL OR agents_score BETWEEN 0 AND 20),
  agents_count   int CHECK (agents_count IS NULL OR agents_count >= 0),
  agents_weight  int CHECK (agents_weight IS NULL OR agents_weight BETWEEN 0 AND 100),
  final_score    numeric(4,1) CHECK (final_score IS NULL OR final_score BETWEEN 0 AND 20),
  band           text CHECK (band IS NULL OR band IN ('excellent', 'bon', 'moyen', 'insuffisant')),
  detail         jsonb CHECK (detail IS NULL OR jsonb_typeof(detail) = 'object'),
  evaluated_by   uuid NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  validated_by   uuid REFERENCES users(id),
  validated_at   timestamptz,
  CONSTRAINT tpm_eval_period_chk CHECK (period_to >= period_from AND period_to < period_from + interval '24 months'),
  -- Séparation des tâches : la personne qui valide n'est pas celle qui a évalué.
  CONSTRAINT tpm_eval_duty_chk CHECK (validated_by IS NULL OR validated_by <> evaluated_by),
  -- Une évaluation validée porte son valideur, sa date et sa note figée.
  CONSTRAINT tpm_eval_validated_chk CHECK (
    (status = 'validee') = (validated_by IS NOT NULL AND validated_at IS NOT NULL AND final_score IS NOT NULL AND band IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_tpm_provider_eval ON tpm_provider_evaluations (tenant_id, partner_id, period_to DESC);

CREATE TABLE IF NOT EXISTS tpm_provider_evaluation_scores (
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  evaluation_id   uuid NOT NULL REFERENCES tpm_provider_evaluations(id) ON DELETE CASCADE,
  criterion_code  text NOT NULL CHECK (criterion_code ~ '^[a-z0-9_]{2,40}$'),
  criterion_label text NOT NULL CHECK (length(criterion_label) BETWEEN 1 AND 160),
  weight          numeric(5,2) NOT NULL CHECK (weight > 0 AND weight <= 100),
  sort_order      int NOT NULL DEFAULT 0,
  -- 1 Insuffisant · 2 À améliorer · 3 Satisfaisant · 4 Très bien ; null = pas encore noté (brouillon).
  rating          smallint CHECK (rating IS NULL OR rating BETWEEN 1 AND 4),
  comment         text CHECK (comment IS NULL OR length(comment) <= 1000),
  PRIMARY KEY (evaluation_id, criterion_code)
);

-- Une évaluation validée est figée : ni modification ni suppression (sauf la suppression en
-- cascade d'un compte ou d'un partenaire, qui passe par une clé étrangère : profondeur > 1).
CREATE OR REPLACE FUNCTION mems_tpm_eval_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  IF OLD.status = 'validee' THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'Évaluation validée : elle ne peut plus être modifiée ni supprimée.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tpm_eval_frozen ON tpm_provider_evaluations;
CREATE TRIGGER trg_tpm_eval_frozen BEFORE UPDATE OR DELETE ON tpm_provider_evaluations
  FOR EACH ROW EXECUTE FUNCTION mems_tpm_eval_frozen();

CREATE OR REPLACE FUNCTION mems_tpm_eval_scores_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  st text;
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  SELECT status INTO st FROM tpm_provider_evaluations
   WHERE id = CASE TG_OP WHEN 'DELETE' THEN OLD.evaluation_id ELSE NEW.evaluation_id END;
  IF FOUND AND st = 'validee' THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'Évaluation validée : sa grille ne peut plus être modifiée.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tpm_eval_scores_frozen ON tpm_provider_evaluation_scores;
CREATE TRIGGER trg_tpm_eval_scores_frozen BEFORE INSERT OR UPDATE OR DELETE ON tpm_provider_evaluation_scores
  FOR EACH ROW EXECUTE FUNCTION mems_tpm_eval_scores_frozen();

ALTER TABLE evaluation_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tpm_provider_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tpm_provider_evaluation_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON evaluation_criteria;
CREATE POLICY tenant_isolation ON evaluation_criteria
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS tenant_isolation ON evaluation_settings;
CREATE POLICY tenant_isolation ON evaluation_settings
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS tenant_isolation ON tpm_provider_evaluations;
CREATE POLICY tenant_isolation ON tpm_provider_evaluations
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS tenant_isolation ON tpm_provider_evaluation_scores;
CREATE POLICY tenant_isolation ON tpm_provider_evaluation_scores
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mems2_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON evaluation_criteria, evaluation_settings,
      tpm_provider_evaluations, tpm_provider_evaluation_scores TO mems2_app;
  END IF;
END $$;

-- Références entre tables d'un compte : contrôle « même compte » (migration 049).
SELECT mems_install_same_tenant('evaluation_criteria');
SELECT mems_install_same_tenant('evaluation_settings');
SELECT mems_install_same_tenant('tpm_provider_evaluations');
SELECT mems_install_same_tenant('tpm_provider_evaluation_scores');
