-- MEMS 2.0 — module Partenaires & Suivi tiers (TPM)
-- Multitenant strategy: shared schema, tenant_id column on every table +
-- Postgres Row-Level Security as a second line of defense (app-level WHERE
-- tenant_id=$1 is still required in every query; RLS is what saves you the
-- day someone forgets it).

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";   -- case-insensitive email

CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email          citext NOT NULL,
  password_hash  text NOT NULL,
  role           text NOT NULL CHECK (role IN ('admin', 'manager', 'viewer')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

CREATE TABLE sites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code         text NOT NULL,
  name         text NOT NULL,
  district     text,
  commune      text,
  activity     text,
  risk_level   text CHECK (risk_level IN ('faible', 'moyenne', 'elevee')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE tpm_providers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          text NOT NULL,
  contract_ref  text,
  daily_rate    numeric(14, 2) NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tpm_agents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tpm_provider_id  uuid NOT NULL REFERENCES tpm_providers(id) ON DELETE CASCADE,
  name             text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- One plan per tenant per calendar month. status carries the workflow:
-- draft -> submitted -> validated (mirrors the real submit/review/close
-- circuit; a hierarchical 3rd step can be added later without a schema
-- change, by extending the CHECK and adding a validated_by_2 column).
CREATE TABLE tpm_plans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period_month   date NOT NULL, -- always the 1st of the month
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'validated')),
  submitted_at   timestamptz,
  validated_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, period_month)
);

-- The gap this module fills: a site gets assigned a TPM first, then
-- (optionally, at first) one of that TPM's agents.
CREATE TABLE tpm_assignments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id          uuid NOT NULL REFERENCES tpm_plans(id) ON DELETE CASCADE,
  site_id          uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  tpm_provider_id  uuid REFERENCES tpm_providers(id),
  tpm_agent_id     uuid REFERENCES tpm_agents(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, site_id),
  CHECK (tpm_agent_id IS NULL OR tpm_provider_id IS NOT NULL) -- can't have an agent without its TPM
);

CREATE TABLE tpm_mission_days (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  assignment_id   uuid NOT NULL REFERENCES tpm_assignments(id) ON DELETE CASCADE,
  mission_date    date NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, mission_date)
);

-- Computed by the background worker (see jobs/processors/recalcExpenses.js),
-- never written directly by the API — this is derived data, recomputed
-- whenever mission days change, so it can never drift from its inputs.
CREATE TABLE tpm_expenses (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id             uuid NOT NULL REFERENCES tpm_plans(id) ON DELETE CASCADE,
  tpm_provider_id     uuid NOT NULL REFERENCES tpm_providers(id) ON DELETE CASCADE,
  mission_days_count  integer NOT NULL DEFAULT 0,
  amount              numeric(14, 2) NOT NULL DEFAULT 0,
  computed_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, tpm_provider_id)
);

CREATE INDEX idx_sites_tenant ON sites(tenant_id);
CREATE INDEX idx_tpm_providers_tenant ON tpm_providers(tenant_id);
CREATE INDEX idx_tpm_plans_tenant_period ON tpm_plans(tenant_id, period_month);
CREATE INDEX idx_tpm_assignments_plan ON tpm_assignments(plan_id);
CREATE INDEX idx_tpm_assignments_tenant ON tpm_assignments(tenant_id);
CREATE INDEX idx_tpm_mission_days_assignment ON tpm_mission_days(assignment_id);
CREATE INDEX idx_tpm_expenses_plan ON tpm_expenses(plan_id);

-- ---------------------------------------------------------------------
-- Row-level security: every tenant-scoped table only shows rows whose
-- tenant_id matches the session variable app.tenant_id, set once per
-- request/transaction by config/db.js::withTenantTransaction. This is a
-- safety net, not the primary access control (the repository layer always
-- filters by tenant_id explicitly too).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'users', 'sites', 'tpm_providers', 'tpm_agents',
    'tpm_plans', 'tpm_assignments', 'tpm_mission_days', 'tpm_expenses'
  ])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id::text = current_setting(''app.tenant_id'', true))',
      t
    );
  END LOOP;
END $$;
