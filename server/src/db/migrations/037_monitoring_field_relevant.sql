-- Capture la logique de saut (skip logic) d'un champ XLSForm : la colonne
-- « relevant » de la feuille survey. Permet de comprendre, dans l'écran des
-- variables, à quelle condition chaque question s'affiche (name + label +
-- skip logic), au-delà du seul mapping name/label.
ALTER TABLE monitoring_form_fields ADD COLUMN IF NOT EXISTS relevant text;
ALTER TABLE monitoring_form_fields ADD COLUMN IF NOT EXISTS required boolean NOT NULL DEFAULT false;
