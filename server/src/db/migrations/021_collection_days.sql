-- MEMS 2.0 — Jours de collecte : lien planification terrain → budget.
-- Règle métier : pour un prestataire et un mois, le NOMBRE DE JOURS DE COLLECTE
-- budgété = (nombre de visites datées planifiées) + (jours de déplacement
-- saisis manuellement). Les jours de visite se déduisent des dates posées sur
-- les visites (site_visits.visit_date) ; les jours de déplacement sont une
-- majoration manuelle, stockée ici.

CREATE TABLE tpm_collection_days (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider_id   uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  period_month  date NOT NULL CHECK (extract(day FROM period_month) = 1),
  travel_days   integer NOT NULL DEFAULT 0 CHECK (travel_days >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider_id, period_month)
);
ALTER TABLE tpm_collection_days ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tpm_collection_days USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON tpm_collection_days TO mems2_app;
