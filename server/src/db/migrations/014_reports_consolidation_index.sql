-- MEMS 2.0 — performance : la consolidation budgétaire agrège les rapports
-- par (tenant, contrat, mois) [voir consolidation.repository.js]. Cet index
-- composite sert directement ce GROUP BY filtré par tenant, pour que la vue
-- reste rapide quand le volume de rapports grandit (échelle entreprise).
CREATE INDEX IF NOT EXISTS idx_tpm_reports_tenant_contract_month
  ON tpm_reports (tenant_id, contract_id, period_month);
