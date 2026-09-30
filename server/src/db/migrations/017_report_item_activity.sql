-- MEMS 2.0 — chaque poste de l'état des dépenses (facture) et du plan de
-- collecte porte l'ACTIVITÉ à laquelle il se rattache, choisie dans le
-- référentiel configurable « Paramétrage › Activités » (table activities).
-- Reproduit les colonnes « Activité » de la facture mensuelle réelle.
ALTER TABLE contract_report_items      ADD COLUMN IF NOT EXISTS activity_id uuid REFERENCES activities(id);
ALTER TABLE tpm_collection_plan_items  ADD COLUMN IF NOT EXISTS activity_id uuid REFERENCES activities(id);
CREATE INDEX IF NOT EXISTS idx_report_items_activity ON contract_report_items (activity_id);
CREATE INDEX IF NOT EXISTS idx_plan_items_activity ON tpm_collection_plan_items (activity_id);
