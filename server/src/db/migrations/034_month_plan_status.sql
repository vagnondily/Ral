-- Situation (workflow) du plan de visites mensuel : brouillon → soumis → validé,
-- ou annulé / non applicable. Une ligne par mois (et par tenant).
CREATE TABLE IF NOT EXISTS field_month_plans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period_month  date NOT NULL,
  status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'soumis', 'valide', 'annule', 'non_applicable')),
  note          text,
  updated_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, period_month)
);

ALTER TABLE field_month_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON field_month_plans;
CREATE POLICY tenant_isolation ON field_month_plans USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON field_month_plans TO mems2_app;
