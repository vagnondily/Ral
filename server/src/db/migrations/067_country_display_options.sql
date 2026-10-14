-- MEMS 2.0 — Option d'affichage des codes du découpage (retour 71).
--
-- Les codes Adm (P-codes adm1 à adm4) des sites s'affichent ou non dans les listes,
-- selon une option du compte réglée dans Paramétrage › Localités › Pays & découpage.
-- Les modèles et exports Excel les gardent toujours (aller-retour hors ligne).
ALTER TABLE country_profiles ADD COLUMN IF NOT EXISTS show_adm_codes boolean NOT NULL DEFAULT false;
