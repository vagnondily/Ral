-- Module « Plan de Distribution d'urgence » (PDD). Réutilise les mêmes zones
-- (région/district/commune = adm1-3), bureaux (antenne/sous-bureau) et
-- partenaires que le reste de MEMS : on stocke leurs libellés tels quels pour
-- ne pas dupliquer de référentiel. Chaque ligne = une distribution planifiée
-- (mois × activité × zone × partenaire × modalité) avec bénéficiaires + tonnages.

-- Référentiel des denrées (Riz, Sorgho, Huile, CSB+, Cash…).
CREATE TABLE IF NOT EXISTS pdd_commodities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code        text NOT NULL,
  label       text NOT NULL,
  unit        text NOT NULL DEFAULT 'MT',
  kind        text NOT NULL DEFAULT 'food' CHECK (kind IN ('food', 'cash')),
  sort_order  int  NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, code)
);
ALTER TABLE pdd_commodities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pdd_commodities;
CREATE POLICY tenant_isolation ON pdd_commodities USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON pdd_commodities TO mems2_app;

-- Lignes de distribution.
CREATE TABLE IF NOT EXISTS pdd_distributions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period_month  date NOT NULL,
  activity      text NOT NULL,
  hazard        text NOT NULL DEFAULT 'autre' CHECK (hazard IN ('drought', 'cyclone', 'autre')),
  wbs           text,
  antenne       text,
  sous_bureau   text,
  partner       text,
  corridor      text,
  region        text,   -- adm1
  district      text,   -- adm2
  commune       text,   -- adm3
  modality      text,   -- Inkind / CBT
  beneficiaries int  NOT NULL DEFAULT 0 CHECK (beneficiaries >= 0),
  households    int  NOT NULL DEFAULT 0 CHECK (households >= 0),
  cash_usd      numeric(14,2) NOT NULL DEFAULT 0 CHECK (cash_usd >= 0),
  total_food    numeric(14,3) NOT NULL DEFAULT 0 CHECK (total_food >= 0),
  source        text,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pdd_dist_month ON pdd_distributions (tenant_id, period_month);
CREATE INDEX IF NOT EXISTS idx_pdd_dist_zone ON pdd_distributions (tenant_id, region, district, commune);
ALTER TABLE pdd_distributions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pdd_distributions;
CREATE POLICY tenant_isolation ON pdd_distributions USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON pdd_distributions TO mems2_app;

-- Tonnage par denrée pour une ligne.
CREATE TABLE IF NOT EXISTS pdd_distribution_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  distribution_id uuid NOT NULL REFERENCES pdd_distributions(id) ON DELETE CASCADE,
  commodity       text NOT NULL,
  qty_mt          numeric(14,3) NOT NULL DEFAULT 0 CHECK (qty_mt >= 0)
);
CREATE INDEX IF NOT EXISTS idx_pdd_items ON pdd_distribution_items (tenant_id, distribution_id);
CREATE INDEX IF NOT EXISTS idx_pdd_items_comm ON pdd_distribution_items (tenant_id, commodity);
ALTER TABLE pdd_distribution_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pdd_distribution_items;
CREATE POLICY tenant_isolation ON pdd_distribution_items USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON pdd_distribution_items TO mems2_app;

-- Stock disponible par denrée × mois (pour l'analyse pipeline : stock vs besoin).
CREATE TABLE IF NOT EXISTS pdd_stock (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period_month  date NOT NULL,
  commodity     text NOT NULL,
  available_mt  numeric(14,3) NOT NULL DEFAULT 0 CHECK (available_mt >= 0),
  donor         text,
  note          text,
  updated_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, period_month, commodity)
);
ALTER TABLE pdd_stock ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pdd_stock;
CREATE POLICY tenant_isolation ON pdd_stock USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON pdd_stock TO mems2_app;
