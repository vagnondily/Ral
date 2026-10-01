-- Taux de change de référence (ariary pour 1 USD), horodatés, saisis dans
-- Paramétrage. Un taux par mois d'application ; la valeur USD d'un montant se
-- lit au taux dont le mois d'application est ≤ la période de saisie (voir
-- currencyMath.pickRate). created_at = horodatage de la saisie.
CREATE TABLE IF NOT EXISTS exchange_rates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  effective_month date NOT NULL,                              -- 1er jour du mois d'application
  usd_rate        numeric(14,4) NOT NULL CHECK (usd_rate > 0), -- ariary pour 1 USD
  note            text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, effective_month)
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_lookup ON exchange_rates (tenant_id, effective_month);

ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON exchange_rates;
CREATE POLICY tenant_isolation ON exchange_rates
  USING (tenant_id::text = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON exchange_rates TO mems2_app;
