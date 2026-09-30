-- MEMS 2.0 — Paramètres : registre unifié des partenaires (avec type) et
-- des activités, tous deux configurables. Le module Partenaires & TPM et le
-- module Contrats s'appuient désormais sur ces référentiels.
--
-- Choix de conception : un « prestataire TPM » n'est qu'un partenaire dont
-- le type est « TPM ». On fusionne donc tpm_providers dans un registre
-- partners unique, en CONSERVANT les mêmes UUID — ainsi les clés étrangères
-- existantes (tpm_agents, tpm_assignments, tpm_expenses) restent valides et
-- il suffit de re-pointer les contraintes vers partners.

-- ---------------------------------------------------------- référentiels --
CREATE TABLE partner_types (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code       text NOT NULL,          -- 'tpm', 'prestataire', 'cabinet'…
  label      text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE activities (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code       text NOT NULL,          -- 'suivi', 'ciblage', 'pdm'…
  label      text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE partners (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  partner_type_id  uuid NOT NULL REFERENCES partner_types(id),
  name             text NOT NULL,
  -- TPM-specific attributes (only meaningful when the type is « TPM »)
  daily_rate       numeric(14, 2),
  contract_ref     text,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
CREATE INDEX idx_partners_tenant_type ON partners (tenant_id, partner_type_id);

-- ------------------------------------------------- migrate tpm_providers --
-- Seed the three built-in types for every existing tenant, then move each
-- tpm_providers row into partners (same id → FKs stay valid).
DO $$
DECLARE
  trow record;
  tpm_type_id uuid;
BEGIN
  FOR trow IN SELECT id FROM tenants LOOP
    INSERT INTO partner_types (tenant_id, code, label, sort_order) VALUES
      (trow.id, 'tpm', 'TPM (Tierce partie de suivi)', 1),
      (trow.id, 'prestataire', 'Prestataire', 2),
      (trow.id, 'cabinet', 'Cabinet', 3)
    ON CONFLICT DO NOTHING;

    INSERT INTO activities (tenant_id, code, label, sort_order) VALUES
      (trow.id, 'suivi', 'Suivi', 1),
      (trow.id, 'ciblage', 'Ciblage', 2),
      (trow.id, 'pdm', 'Suivi post-distribution (PDM)', 3),
      (trow.id, 'distribution', 'Distribution', 4),
      (trow.id, 'evaluation', 'Évaluation', 5)
    ON CONFLICT DO NOTHING;

    SELECT id INTO tpm_type_id FROM partner_types WHERE tenant_id = trow.id AND code = 'tpm';

    INSERT INTO partners (id, tenant_id, partner_type_id, name, daily_rate, contract_ref, created_at)
    SELECT p.id, p.tenant_id, tpm_type_id, p.name, p.daily_rate, p.contract_ref, p.created_at
      FROM tpm_providers p WHERE p.tenant_id = trow.id
    ON CONFLICT (id) DO NOTHING;
  END LOOP;
END $$;

-- Re-point the TPM foreign keys from tpm_providers to partners.
ALTER TABLE tpm_agents       DROP CONSTRAINT tpm_agents_tpm_provider_id_fkey;
ALTER TABLE tpm_agents       ADD  CONSTRAINT tpm_agents_partner_fkey
  FOREIGN KEY (tpm_provider_id) REFERENCES partners(id) ON DELETE CASCADE;
ALTER TABLE tpm_assignments  DROP CONSTRAINT tpm_assignments_tpm_provider_id_fkey;
ALTER TABLE tpm_assignments  ADD  CONSTRAINT tpm_assignments_partner_fkey
  FOREIGN KEY (tpm_provider_id) REFERENCES partners(id);
ALTER TABLE tpm_expenses     DROP CONSTRAINT tpm_expenses_tpm_provider_id_fkey;
ALTER TABLE tpm_expenses     ADD  CONSTRAINT tpm_expenses_partner_fkey
  FOREIGN KEY (tpm_provider_id) REFERENCES partners(id) ON DELETE CASCADE;

DROP TABLE tpm_providers;

-- --------------------------------------------------- contrats : refonte --
-- Link contracts to a partner from the registry (keep partner_name as a
-- denormalized snapshot for history) and to a set of activities.
-- The old activities enum CHECK (GD/SMP/…) is dropped: activities are now
-- configurable and referenced through contract_activities below.
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_activities_check;
ALTER TABLE contracts ADD COLUMN partner_id uuid REFERENCES partners(id);

CREATE TABLE contract_activities (
  contract_id  uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  activity_id  uuid NOT NULL REFERENCES activities(id),
  PRIMARY KEY (contract_id, activity_id)
);

-- Rebuild the budget to the real FLA shape: one row per cost line AND per
-- activity. line_code is "<section>.<line>" from budgetCatalog.js.
DROP TABLE contract_budget_lines;
CREATE TABLE contract_budget_lines (
  contract_id  uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  line_code    text NOT NULL,               -- e.g. 'IV.suivi'
  activity_id  uuid NOT NULL REFERENCES activities(id),
  amount       numeric(16, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  PRIMARY KEY (contract_id, line_code, activity_id)
);

-- Contract-level per-section expenses move OUT of the contract module and
-- into the Partenaires & TPM reporting sub-module (see migration 006).
DROP TABLE contract_expenses;

-- ------------------------------------------------------------------ RLS --
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['partner_types', 'activities', 'partners', 'contract_activities'])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id::text = current_setting(''app.tenant_id'', true))', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON partner_types, activities, partners, contract_activities, contract_budget_lines TO mems2_app;
