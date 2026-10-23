-- 128 — Rattachement d'un contrat à un projet (interconnexion Projets ↔ Contrats).
-- Un contrat FLA est financé sous un projet (grant). On ajoute, facultativement, SON projet :
-- ainsi budget / TPM / consolidation (tous indexés par contrat) remontent au projet.
-- Référence entre deux tables du même tenant → déclencheur « même tenant » (migration 049).
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_contracts_project ON contracts (tenant_id, project_id);
SELECT mems_install_same_tenant('contracts');
