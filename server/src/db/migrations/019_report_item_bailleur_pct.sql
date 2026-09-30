-- MEMS 2.0 — fidélité facture : la part à la charge du bailleur devient un
-- POURCENTAGE par ligne (0..1) au lieu du binaire bailleur/ONG, et un poste
-- peut se répartir sur DEUX activités (Activité 1 / Activité 2), comme le
-- template « Facture et État des dépenses ».
--
-- Additif et idempotent : les colonnes existantes (pay_by, activity_id) restent
-- pour compatibilité ; bailleur_pct est rétro-rempli depuis pay_by.

ALTER TABLE contract_report_items
  ADD COLUMN IF NOT EXISTS bailleur_pct  numeric(6,5) NOT NULL DEFAULT 1
    CHECK (bailleur_pct >= 0 AND bailleur_pct <= 1),
  ADD COLUMN IF NOT EXISTS activity2_id  uuid REFERENCES activities(id),
  ADD COLUMN IF NOT EXISTS activity1_pct numeric(6,5)
    CHECK (activity1_pct IS NULL OR (activity1_pct >= 0 AND activity1_pct <= 1));

ALTER TABLE tpm_collection_plan_items
  ADD COLUMN IF NOT EXISTS bailleur_pct  numeric(6,5) NOT NULL DEFAULT 1
    CHECK (bailleur_pct >= 0 AND bailleur_pct <= 1),
  ADD COLUMN IF NOT EXISTS activity2_id  uuid REFERENCES activities(id),
  ADD COLUMN IF NOT EXISTS activity1_pct numeric(6,5)
    CHECK (activity1_pct IS NULL OR (activity1_pct >= 0 AND activity1_pct <= 1));

-- Rétro-remplissage depuis le binaire existant.
UPDATE contract_report_items     SET bailleur_pct = CASE WHEN pay_by = 'ong' THEN 0 ELSE 1 END;
UPDATE tpm_collection_plan_items SET bailleur_pct = CASE WHEN pay_by = 'ong' THEN 0 ELSE 1 END;

CREATE INDEX IF NOT EXISTS idx_report_items_activity2 ON contract_report_items (activity2_id);
CREATE INDEX IF NOT EXISTS idx_plan_items_activity2   ON tpm_collection_plan_items (activity2_id);
