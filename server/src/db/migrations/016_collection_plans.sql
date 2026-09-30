-- MEMS 2.0 — Planification & budget : le budget prévisionnel d'une vague de
-- collecte (reproduction de la feuille « Budget » du fichier de planning).
-- Un plan par prestataire / contrat / mois, avec des postes prévus de même
-- forme que l'état des dépenses (facture) — ce qui rend le pré-remplissage de
-- la facture immédiat. Le « Planifié » de la consolidation en découle.

CREATE TABLE tpm_collection_plans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  partner_id    uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  contract_id   uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  period_month  date NOT NULL CHECK (extract(day FROM period_month) = 1),
  title         text,
  status        text NOT NULL DEFAULT 'brouillon' CHECK (status IN ('brouillon', 'valide')),
  created_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partner_id, contract_id, period_month)
);
CREATE INDEX idx_collection_plans_tenant_contract_month
  ON tpm_collection_plans (tenant_id, contract_id, period_month);
ALTER TABLE tpm_collection_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tpm_collection_plans USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON tpm_collection_plans TO mems2_app;

CREATE TABLE tpm_collection_plan_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id      uuid NOT NULL REFERENCES tpm_collection_plans(id) ON DELETE CASCADE,
  line_code    text NOT NULL,
  designation  text NOT NULL,
  unit         text,
  unit_count   numeric(16, 4) NOT NULL DEFAULT 0 CHECK (unit_count >= 0),
  unit_cost    numeric(16, 2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  pay_by       text NOT NULL DEFAULT 'bailleur' CHECK (pay_by IN ('bailleur', 'ong')),
  site         text,
  observation  text,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_collection_plan_items_plan ON tpm_collection_plan_items (plan_id);
ALTER TABLE tpm_collection_plan_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tpm_collection_plan_items USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON tpm_collection_plan_items TO mems2_app;
