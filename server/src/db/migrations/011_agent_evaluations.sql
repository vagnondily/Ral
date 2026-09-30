-- MEMS 2.0 — évaluation des agents TPM, DISTINCTE des formations. L'évaluation
-- porte sur le travail réalisé sur le terrain (missions, jours de mission) :
-- une note périodique, une appréciation et un commentaire.
CREATE TABLE tpm_agent_evaluations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id     uuid NOT NULL REFERENCES tpm_agents(id) ON DELETE CASCADE,
  periode      date NOT NULL,                       -- mois évalué (1er du mois)
  note         numeric(4, 1) CHECK (note >= 0 AND note <= 20),
  appreciation text,                                -- Excellent / Bon / Moyen / Insuffisant
  commentaire  text,
  evaluated_by uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_agent_evaluations_agent ON tpm_agent_evaluations (agent_id);
ALTER TABLE tpm_agent_evaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tpm_agent_evaluations USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON tpm_agent_evaluations TO mems2_app;
