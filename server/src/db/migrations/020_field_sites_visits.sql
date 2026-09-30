-- MEMS 2.0 — Suivi terrain : sites (établissements) et planification des
-- visites par bureau, puis affectation aux prestataires TPM / agents.
--
-- Chaîne métier : le bureau recense les sites à suivre (district › commune ›
-- établissement › activité) et planifie les visites du mois ; chaque visite est
-- affectée à un prestataire TPM (et un agent). La réalisation alimente la
-- couverture (visites réalisées / planifiées) et, plus tard, le rapportage.

CREATE TABLE mon_sites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  district    text NOT NULL,
  commune     text NOT NULL,
  fokontany   text,
  name        text NOT NULL,           -- établissement / site
  activity    text,                    -- ex. « Suivi cantines scolaires »
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, district, commune, name)
);
CREATE INDEX idx_mon_sites_tenant ON mon_sites (tenant_id, district, commune);
ALTER TABLE mon_sites ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mon_sites USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON mon_sites TO mems2_app;

CREATE TABLE site_visits (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id       uuid NOT NULL REFERENCES mon_sites(id) ON DELETE CASCADE,
  period_month  date NOT NULL CHECK (extract(day FROM period_month) = 1),
  activity      text,
  contract_id   uuid REFERENCES contracts(id) ON DELETE SET NULL,
  provider_id   uuid REFERENCES partners(id) ON DELETE SET NULL,   -- prestataire TPM affecté
  agent         text,
  status        text NOT NULL DEFAULT 'planifie' CHECK (status IN ('planifie', 'realise', 'annule')),
  visit_date    date,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, site_id, period_month, activity)
);
CREATE INDEX idx_site_visits_month   ON site_visits (tenant_id, period_month);
CREATE INDEX idx_site_visits_provider ON site_visits (tenant_id, provider_id, period_month);
CREATE INDEX idx_site_visits_site    ON site_visits (tenant_id, site_id);
ALTER TABLE site_visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON site_visits USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON site_visits TO mems2_app;
