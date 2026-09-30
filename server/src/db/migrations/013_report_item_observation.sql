-- MEMS 2.0 — facture fidèle : la colonne « Observation » de l'état des
-- dépenses (présente sur la facture réelle YPA). Le montant d'un poste
-- reste calculé (quantité × coût unitaire) ; on ne stocke que la saisie.
ALTER TABLE contract_report_items ADD COLUMN IF NOT EXISTS observation text;
