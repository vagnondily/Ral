-- MEMS 2.0 — Factures (R0) : cohérence « à la charge de » ⇔ « % bailleur »
-- sur les postes, et soumetteur d'un rapport TPM.
--
-- ============================================================================
-- (1) pay_by ⇔ bailleur_pct
-- ============================================================================
-- Règle (identique à reportMath.payByOf / normalizeItems) :
--     pay_by = 'ong'      ⇔ bailleur_pct = 0
--     pay_by = 'bailleur' ⇔ bailleur_pct > 0
-- La migration 019 a ajouté bailleur_pct avec DEFAULT 1 : une ligne insérée
-- avec pay_by = 'ong' sans préciser le % (données de test) était affichée
-- « ONG » mais comptée à 100 % côté bailleur.
--
-- Reprise des données existantes, AVANT la contrainte. Principe : la valeur
-- saisie explicitement l'emporte sur la valeur par défaut de la colonne.
--   a) 'ong' + 100 %            : le 100 % est le DEFAULT de 019, « ONG » est
--                                 le choix saisi                → bailleur_pct = 0
--   b) 'ong' + 0 < % < 100 %    : un % partiel est forcément saisi
--                                 (le résumé binaire est faux)  → pay_by = 'bailleur'
--   c) 'bailleur' + 0 %         : le 0 % est forcément saisi    → pay_by = 'ong'
-- Seul (a) change une part bailleur. La part bailleur d'un rapport financier
-- (reported_amount, dérivée de ses postes) est donc recalculée pour les seuls
-- rapports concernés par (a), en centimes comme reportMath.summarize :
--     Σ arrondi(arrondi(qté × coût × 100) × %) / 100.
-- Les plans de collecte ne stockent aucun total : leur « Planifié » est
-- recalculé à la lecture depuis les postes.

-- (a') Part bailleur des rapports touchés par (a), calculée avec le % repris
--      (doit précéder (a) : même instruction = même instantané).
UPDATE tpm_reports r
   SET reported_amount = s.funder, updated_at = now()
  FROM (
    SELECT i.tenant_id, i.report_id,
           SUM(round(round(i.unit_count * i.unit_cost * 100)
                     * CASE WHEN i.pay_by = 'ong' AND i.bailleur_pct = 1 THEN 0 ELSE i.bailleur_pct END)) / 100 AS funder
      FROM contract_report_items i
     GROUP BY i.tenant_id, i.report_id
    HAVING bool_or(i.pay_by = 'ong' AND i.bailleur_pct = 1)
  ) s
 WHERE r.tenant_id = s.tenant_id AND r.id = s.report_id AND r.kind = 'financier';

-- (a) (b) (c) — postes de facture.
UPDATE contract_report_items SET bailleur_pct = 0       WHERE pay_by = 'ong' AND bailleur_pct = 1;
UPDATE contract_report_items SET pay_by = 'bailleur'    WHERE pay_by = 'ong' AND bailleur_pct > 0;
UPDATE contract_report_items SET pay_by = 'ong'         WHERE pay_by = 'bailleur' AND bailleur_pct = 0;

-- (a) (b) (c) — postes des plans de collecte (même paire de colonnes, migration 019).
UPDATE tpm_collection_plan_items SET bailleur_pct = 0    WHERE pay_by = 'ong' AND bailleur_pct = 1;
UPDATE tpm_collection_plan_items SET pay_by = 'bailleur' WHERE pay_by = 'ong' AND bailleur_pct > 0;
UPDATE tpm_collection_plan_items SET pay_by = 'ong'      WHERE pay_by = 'bailleur' AND bailleur_pct = 0;

-- Contraintes (violation → 23514 → 400 par le gestionnaire central).
ALTER TABLE contract_report_items DROP CONSTRAINT IF EXISTS contract_report_items_pay_by_pct_check;
ALTER TABLE contract_report_items ADD CONSTRAINT contract_report_items_pay_by_pct_check
  CHECK ((pay_by = 'ong' AND bailleur_pct = 0) OR (pay_by = 'bailleur' AND bailleur_pct > 0));

ALTER TABLE tpm_collection_plan_items DROP CONSTRAINT IF EXISTS tpm_collection_plan_items_pay_by_pct_check;
ALTER TABLE tpm_collection_plan_items ADD CONSTRAINT tpm_collection_plan_items_pay_by_pct_check
  CHECK ((pay_by = 'ong' AND bailleur_pct = 0) OR (pay_by = 'bailleur' AND bailleur_pct > 0));

-- ============================================================================
-- (2) Soumetteur d'un rapport (séparation des tâches)
-- ============================================================================
-- Un rapport « attendu » se soumet désormais par l'action « Soumettre », pas
-- forcément par son auteur (un gabarit mensuel est généré par une personne et
-- rempli par une autre). La personne qui SOUMET ne valide ni ne rejette :
-- elle doit donc être enregistrée.
ALTER TABLE tpm_reports ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES users(id);

-- Reprise : pour un rapport déjà passé par une soumission, la règle appliquée
-- jusqu'ici tenait l'auteur pour soumetteur ; on l'écrit explicitement.
UPDATE tpm_reports SET submitted_by = created_by
 WHERE submitted_by IS NULL AND status IN ('soumis', 'valide', 'rejete');

-- Base déjà migrée en 049 : le contrôle « même compte » couvre aussi la
-- nouvelle référence. (Base neuve : 049 passe après et l'installe lui-même.)
DO $$
BEGIN
  IF to_regprocedure('mems_install_same_tenant(regclass)') IS NOT NULL THEN
    PERFORM mems_install_same_tenant('tpm_reports');
  END IF;
END $$;
