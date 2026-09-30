-- MEMS 2.0 — module Contrats (schéma de base)
-- Cœur transactionnel : toute donnée de contrat naît ici. Les autres modules
-- réagissent à ses événements (outbox ci-dessous) sans jamais écrire dans ces
-- tables. Mêmes règles multitenant que le reste : tenant_id partout + RLS.
--
-- NB : la migration 005 fait ensuite évoluer ce schéma (partenaire lié,
-- activités configurables, budget FLA détaillé par activité) et la 006 ajoute
-- les rapports TPM. Ce fichier pose les fondations sur lesquelles elles
-- s'appuient.

CREATE TABLE contracts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  numero               text NOT NULL,                    -- interne, auto : CTR-2026-0001
  partner_name         text NOT NULL,
  activities           text[] NOT NULL DEFAULT '{}',
  numero_fla           text,
  numero_po            text,
  numero_vendor        text,
  date_debut           date NOT NULL,
  date_fin             date NOT NULL,
  status               text NOT NULL DEFAULT 'brouillon'
                       CHECK (status IN ('brouillon', 'en_validation', 'actif', 'rejete', 'resilie')),
  validator_id         uuid REFERENCES users(id),
  submitted_by         uuid REFERENCES users(id),
  submitted_at         timestamptz,
  decided_by           uuid REFERENCES users(id),
  decided_at           timestamptz,
  termination_reason   text,
  termination_date     date,
  renewed_from_id      uuid REFERENCES contracts(id),
  amendment_count      integer NOT NULL DEFAULT 0,
  created_by           uuid NOT NULL REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  version              integer NOT NULL DEFAULT 1,        -- verrouillage optimiste
  UNIQUE (tenant_id, numero),
  CHECK (date_fin > date_debut),
  CHECK (status <> 'resilie' OR (termination_reason IS NOT NULL AND termination_date IS NOT NULL))
);
CREATE UNIQUE INDEX uq_contracts_renewed_from ON contracts (renewed_from_id) WHERE renewed_from_id IS NOT NULL;

-- Budget de base (remplacé par la migration 005 par un modèle par activité).
CREATE TABLE contract_budget_lines (
  contract_id  uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  section      text NOT NULL,
  amount       numeric(16, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  PRIMARY KEY (contract_id, section)
);

-- Dépenses de base (déplacées vers le module TPM par la migration 005).
CREATE TABLE contract_expenses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contract_id    uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  section        text NOT NULL,
  period_month   date NOT NULL,
  amount         numeric(16, 2) NOT NULL CHECK (amount > 0),
  invoice_ref    text,
  label          text,
  created_by     uuid NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  cancelled_at   timestamptz,
  cancelled_by   uuid REFERENCES users(id),
  cancel_reason  text
);

CREATE TABLE contract_amendments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contract_id       uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  number            integer NOT NULL,
  justification     text NOT NULL,
  new_date_fin      date,
  budget_changes    jsonb NOT NULL DEFAULT '{}'::jsonb,
  status            text NOT NULL DEFAULT 'en_validation' CHECK (status IN ('en_validation', 'approuve', 'rejete')),
  validator_id      uuid NOT NULL REFERENCES users(id),
  created_by        uuid NOT NULL REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  decided_by        uuid REFERENCES users(id),
  decided_at        timestamptz,
  decision_comment  text,
  UNIQUE (contract_id, number)
);
CREATE UNIQUE INDEX uq_amendment_pending ON contract_amendments (contract_id) WHERE status = 'en_validation';

CREATE TABLE contract_counters (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  year        integer NOT NULL,
  last_value  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, year)
);

CREATE TABLE contract_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contract_id  uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  action       text NOT NULL,
  actor_id     uuid NOT NULL REFERENCES users(id),
  comment      text,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Transactional outbox : les événements sont écrits dans la même transaction
-- que le changement, puis publiés en asynchrone par le worker.
CREATE TABLE domain_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type     text NOT NULL,
  aggregate_id   uuid NOT NULL,
  payload        jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  claimed_at     timestamptz,
  published_at   timestamptz,
  attempts       integer NOT NULL DEFAULT 0
);

CREATE INDEX idx_contracts_tenant_status ON contracts (tenant_id, status);
CREATE INDEX idx_contract_amendments_contract ON contract_amendments (contract_id);
CREATE INDEX idx_contract_history_contract ON contract_history (contract_id, created_at);
CREATE INDEX idx_domain_events_unpublished ON domain_events (created_at) WHERE published_at IS NULL;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'contracts', 'contract_budget_lines', 'contract_expenses', 'contract_amendments',
    'contract_counters', 'contract_history', 'domain_events'
  ])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id::text = current_setting(''app.tenant_id'', true))',
      t
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  contracts, contract_budget_lines, contract_expenses, contract_amendments, contract_counters, domain_events
  TO mems2_app;
GRANT SELECT, INSERT ON contract_history TO mems2_app;
REVOKE UPDATE, DELETE, TRUNCATE ON contract_history FROM mems2_app;

-- Outbox : deux fonctions SECURITY DEFINER (le publisher travaille tous
-- tenants confondus). Bail de 5 min → un lot d'un publisher planté est repris.
CREATE OR REPLACE FUNCTION outbox_claim(p_limit integer)
RETURNS SETOF domain_events
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE domain_events e
     SET claimed_at = now(), attempts = e.attempts + 1
   WHERE e.id IN (
     SELECT id FROM domain_events
      WHERE published_at IS NULL
        AND (claimed_at IS NULL OR claimed_at < now() - interval '5 minutes')
      ORDER BY created_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING e.*;
$$;

CREATE OR REPLACE FUNCTION outbox_mark_published(p_ids uuid[])
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH done AS (
    UPDATE domain_events SET published_at = now() WHERE id = ANY (p_ids) AND published_at IS NULL RETURNING 1
  )
  SELECT count(*)::integer FROM done;
$$;

GRANT EXECUTE ON FUNCTION outbox_claim(integer) TO mems2_app;
GRANT EXECUTE ON FUNCTION outbox_mark_published(uuid[]) TO mems2_app;
