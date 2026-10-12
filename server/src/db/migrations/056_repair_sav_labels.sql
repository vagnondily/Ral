-- MEMS 2.0 — Libellés des exports SPSS mal décodés (« bÃ©nÃ©ficiaire »).
--
-- Le lecteur .sav lisait les libellés de variables et d'étiquettes de valeurs
-- en latin1 avant de connaître l'encodage du fichier (UTF-8 pour Kobo) ; c'est
-- corrigé dans savParser. On répare ici les libellés déjà enregistrés : un texte
-- qui, ré-encodé en latin1, forme de l'UTF-8 valide est remplacé par sa forme
-- correcte ; tout autre texte (vraie lettre « Ã », caractère hors latin1) reste
-- tel quel. Rejouable sans effet.
CREATE OR REPLACE FUNCTION pg_temp.mems_fix_mojibake(t text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF t IS NULL OR t !~ '[ÃÂ]' THEN RETURN t; END IF;
  RETURN convert_from(convert_to(t, 'LATIN1'), 'UTF8');
EXCEPTION WHEN others THEN
  RETURN t;
END $$;

UPDATE monitoring_form_fields SET label = pg_temp.mems_fix_mojibake(label)
 WHERE label ~ '[ÃÂ]' AND pg_temp.mems_fix_mojibake(label) IS DISTINCT FROM label;
UPDATE monitoring_choices SET label = pg_temp.mems_fix_mojibake(label)
 WHERE label ~ '[ÃÂ]' AND pg_temp.mems_fix_mojibake(label) IS DISTINCT FROM label;
