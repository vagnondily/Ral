-- MEMS 2.0 — Suivi terrain : planification des visites par bureau puis
-- affectation aux prestataires TPM / rôles (Agent 1, Superviseur 1…, non
-- nominatifs). On RÉUTILISE le registre de sites existant (table `sites`,
-- migration 001, déjà utilisé par le suivi RBM et les affectations) — pas de
-- table de sites dupliquée. On ajoute juste `fokontany` au registre.
--
-- Chaîne métier : le bureau recense les sites à suivre (district › commune ›
-- établissement › activité) et planifie les visites du mois ; chaque visite est
-- affectée à un prestataire TPM (et un rôle). La réalisation alimente la
-- couverture (visites réalisées / planifiées).

ALTER TABLE sites ADD COLUMN IF NOT EXISTS fokontany text;

CREATE TABLE site_visits (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id       uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  period_month  date NOT NULL CHECK (extract(day FROM period_month) = 1),
  activity      text,
  contract_id   uuid REFERENCES contracts(id) ON DELETE SET NULL,
  provider_id   uuid REFERENCES partners(id) ON DELETE SET NULL,   -- prestataire TPM affecté
  agent         text,                                              -- rôle générique (Agent 1…)
  status        text NOT NULL DEFAULT 'planifie' CHECK (status IN ('planifie', 'realise', 'annule')),
  visit_date    date,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, site_id, period_month, activity)
);
CREATE INDEX idx_site_visits_month    ON site_visits (tenant_id, period_month);
CREATE INDEX idx_site_visits_provider ON site_visits (tenant_id, provider_id, period_month);
CREATE INDEX idx_site_visits_site     ON site_visits (tenant_id, site_id);
ALTER TABLE site_visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON site_visits USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON site_visits TO mems2_app;
