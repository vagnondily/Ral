-- MEMS 2.0 — Lot 5, § 7 : traçabilité du plan généré automatiquement. Migration 078.
--
-- 1. plan_runs : une ligne par plan APPLIQUÉ (« Appliquer » du panneau « Planifier
--    automatiquement ») — qui, quand, horizon, objectif, périmètre, paramètres et valeurs
--    MMR utilisés (copie), empreinte des entrées, résumé. Les aperçus ne sont PAS stockés :
--    le générateur est pur et déterministe, il est relancé à l'application sous les verrous
--    des mois et l'empreinte des entrées est comparée (409 si les données ont changé).
-- 2. site_visits : pourquoi chaque visite générée a été choisie (code + paramètres, rendus
--    en FR / EN à l'écran — jamais un texte figé), et sa tournée / journée dans le mois.
--    Le prestataire (provider_id) n'est JAMAIS choisi par le générateur (retour 58 : la
--    base l'estampille d'après les contrats).
CREATE TABLE IF NOT EXISTS plan_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  year            integer  NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  from_month      smallint NOT NULL CHECK (from_month BETWEEN 1 AND 12),
  to_month        smallint NOT NULL CHECK (to_month BETWEEN 1 AND 12),
  objective       text     NOT NULL CHECK (objective IN ('auto', 'mmr_complet', 'couverture')),
  scope           jsonb    NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(scope) <= 4096),
  params          jsonb    NOT NULL CHECK (pg_column_size(params) <= 16384),
  pools           jsonb    NOT NULL CHECK (pg_column_size(pools) <= 262144),
  summary         jsonb    NOT NULL CHECK (pg_column_size(summary) <= 262144),
  fingerprint     text     NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  proposed        integer  NOT NULL CHECK (proposed >= 0),
  kept            integer  NOT NULL CHECK (kept >= 0 AND kept <= proposed),
  created_visits  integer  NOT NULL DEFAULT 0 CHECK (created_visits >= 0 AND created_visits <= kept),
  manual_changes  integer  NOT NULL DEFAULT 0 CHECK (manual_changes >= 0),
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_runs_months CHECK (from_month <= to_month)
);
CREATE INDEX IF NOT EXISTS idx_plan_runs_tenant ON plan_runs (tenant_id, created_at DESC);

ALTER TABLE plan_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON plan_runs;
CREATE POLICY tenant_isolation ON plan_runs
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
-- Trace : lecture, insertion, et la seule mise à jour du nombre de visites créées (même
-- transaction) ; jamais de suppression par l'application. Les privilèges par défaut
-- (002 / 012) donnent tout : on les retire, puis on n'accorde que la colonne utile.
-- (La mise à NULL de created_by quand un utilisateur est supprimé est une action de clé
-- étrangère, exécutée comme propriétaire de la table : non affectée.)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mems2_app') THEN
    REVOKE UPDATE, DELETE ON plan_runs FROM mems2_app;
    GRANT SELECT, INSERT ON plan_runs TO mems2_app;
    GRANT UPDATE (created_visits) ON plan_runs TO mems2_app;
  END IF;
END $$;
SELECT mems_install_same_tenant('plan_runs');

ALTER TABLE site_visits
  ADD COLUMN IF NOT EXISTS plan_run_id uuid REFERENCES plan_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS plan_why    text,
  ADD COLUMN IF NOT EXISTS plan_detail jsonb,
  ADD COLUMN IF NOT EXISTS plan_tour   smallint,
  ADD COLUMN IF NOT EXISTS plan_day    smallint;
ALTER TABLE site_visits DROP CONSTRAINT IF EXISTS site_visits_plan_why_check;
ALTER TABLE site_visits ADD CONSTRAINT site_visits_plan_why_check
  CHECK (plan_why IS NULL OR plan_why IN ('urgent', 'du', 'meme_lieu', 'meme_commune', 'meme_district', 'couverture', 'anticipee'));
ALTER TABLE site_visits DROP CONSTRAINT IF EXISTS site_visits_plan_detail_check;
ALTER TABLE site_visits ADD CONSTRAINT site_visits_plan_detail_check
  CHECK (plan_detail IS NULL OR (jsonb_typeof(plan_detail) = 'object' AND pg_column_size(plan_detail) <= 2048));
ALTER TABLE site_visits DROP CONSTRAINT IF EXISTS site_visits_plan_slot_check;
ALTER TABLE site_visits ADD CONSTRAINT site_visits_plan_slot_check
  CHECK ((plan_tour IS NULL OR plan_tour BETWEEN 1 AND 9999) AND (plan_day IS NULL OR plan_day BETWEEN 1 AND 9999));
CREATE INDEX IF NOT EXISTS idx_site_visits_plan_run ON site_visits (tenant_id, plan_run_id) WHERE plan_run_id IS NOT NULL;

-- Nouvelle référence site_visits → plan_runs : contrôle « même compte » (049) régénéré.
SELECT mems_install_same_tenant('site_visits');
