-- MEMS 2.0 — budget FLA au niveau POSTE (reproduction fidèle du fichier).
-- Chaque ligne de coût contient des postes (description, # unités, coût
-- unitaire), répartis en % par activité. Les montants et totaux sont
-- calculés ; la commission de gestion (% des coûts directs) donne le
-- « Total de l'accord », le plafond du contrat.

-- Le barème journalier n'existe pas : on retire son usage. La colonne
-- daily_rate reste (nullable) pour ne rien casser mais n'est plus alimentée.
ALTER TABLE contracts ADD COLUMN management_fee_pct numeric(6, 4) NOT NULL DEFAULT 0.07;
ALTER TABLE contracts ADD COLUMN period_months integer;

CREATE TABLE contract_budget_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contract_id  uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  line_code    text NOT NULL,                 -- 'IV.suivi' etc (budgetCatalog)
  description  text NOT NULL,
  unit_count   numeric(16, 4) NOT NULL DEFAULT 0 CHECK (unit_count >= 0),
  unit_cost    numeric(16, 2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  allocations  jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { "<activity_id>": pct }
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_budget_items_contract ON contract_budget_items (contract_id);
CREATE INDEX idx_budget_items_line ON contract_budget_items (contract_id, line_code);

-- Ancien budget « cellule » remplacé par les postes.
DROP TABLE IF EXISTS contract_budget_lines;

ALTER TABLE contract_budget_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON contract_budget_items USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON contract_budget_items TO mems2_app;
