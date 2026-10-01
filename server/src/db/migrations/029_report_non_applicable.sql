-- Rapports mensuels : un gabarit « attendu » est créé par mois selon la durée
-- du contrat, puis rempli (facture) OU marqué « non applicable » si aucun suivi
-- n'a eu lieu ce mois. On ajoute donc le statut non_applicable.
ALTER TABLE tpm_reports DROP CONSTRAINT IF EXISTS tpm_reports_status_check;
ALTER TABLE tpm_reports ADD CONSTRAINT tpm_reports_status_check
  CHECK (status IN ('attendu', 'soumis', 'valide', 'rejete', 'non_applicable'));
