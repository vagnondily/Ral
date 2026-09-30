-- MEMS 2.0 — évaluation des agents TPM : formations suivies (thématique,
-- date, durée en jours). Le nombre de formations sert d'indicateur de montée
-- en compétence.
CREATE TABLE tpm_agent_formations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id    uuid NOT NULL REFERENCES tpm_agents(id) ON DELETE CASCADE,
  thematique  text NOT NULL,
  date_formation date,
  jours       numeric(6, 1) NOT NULL DEFAULT 1 CHECK (jours >= 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_agent_formations_agent ON tpm_agent_formations (agent_id);
ALTER TABLE tpm_agent_formations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tpm_agent_formations USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON tpm_agent_formations TO mems2_app;
