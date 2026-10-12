-- MEMS 2.0 — Correspondances des valeurs codées des formulaires reçus (retour n° 3).
--
-- Un formulaire Kobo code le bureau (« 7 »), le partenaire (« 2 » = LALANA) et
-- l'enquêteur (« 37 ») ; la même valeur peut désigner deux choses différentes
-- d'un formulaire à l'autre (« 7 » = Tsihombe ici, Ampanihy là). MEMS les
-- relie automatiquement quand c'est sûr ; l'utilisateur corrige ici, FICHE PAR
-- FICHE, et la correction s'applique aux formulaires déjà reçus.
--
-- 1. monitoring_value_links : une correction par (fiche, dimension, valeur).
--    La cible est dans la colonne de sa dimension (clés étrangères réelles) ;
--    toutes vides = « ne pas relier » (valeur volontairement écartée, ex. 999).
-- 2. monitoring_submissions.partner_id / agent_id : partenaire et agent MEMS
--    reconnus, à côté des valeurs brutes (jamais à leur place).

CREATE TABLE IF NOT EXISTS monitoring_value_links (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  form_id    uuid NOT NULL REFERENCES monitoring_forms(id) ON DELETE CASCADE,
  dimension  text NOT NULL CHECK (dimension IN ('field_office', 'partner', 'agent')),
  raw_value  text NOT NULL CHECK (length(raw_value) BETWEEN 1 AND 200),
  office_id  uuid REFERENCES field_offices(id) ON DELETE CASCADE,
  partner_id uuid REFERENCES partners(id) ON DELETE CASCADE,
  agent_id   uuid REFERENCES tpm_agents(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, form_id, dimension, raw_value),
  -- Seule la colonne de la dimension peut porter une cible.
  CONSTRAINT monitoring_value_links_target_chk CHECK (
    (dimension = 'field_office' AND partner_id IS NULL AND agent_id IS NULL)
    OR (dimension = 'partner' AND office_id IS NULL AND agent_id IS NULL)
    OR (dimension = 'agent' AND office_id IS NULL AND partner_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_value_links_form ON monitoring_value_links (tenant_id, form_id, dimension);

ALTER TABLE monitoring_value_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitoring_value_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON monitoring_value_links;
CREATE POLICY tenant_isolation ON monitoring_value_links
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE monitoring_submissions
  ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES partners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES tpm_agents(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_mon_sub_partner ON monitoring_submissions (tenant_id, partner_id, period_month) WHERE partner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mon_sub_agent ON monitoring_submissions (tenant_id, agent_id, period_month) WHERE agent_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mems2_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON monitoring_value_links TO mems2_app;
  END IF;
END $$;

-- Les nouvelles références sont couvertes par le contrôle « même client » (migration 049).
SELECT mems_install_same_tenant('monitoring_value_links');
SELECT mems_install_same_tenant('monitoring_submissions');
