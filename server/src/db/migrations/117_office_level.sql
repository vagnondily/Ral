-- Hiérarchie des bureaux à 6 niveaux (désagrégation demandée) :
--   Siège (hq) › Bureau régional (regional) › Bureau pays (country) › Area Office (area)
--   › Sous-bureau (sub) › Antenne (antenna).
-- Additif : la colonne `office_level` classe le bureau ; le modèle existant (arbre parent_id,
-- périmètre de communes, drapeau `national`) est inchangé. `nature` ('pays'/'terrain') reste
-- pour compatibilité et est dérivée du niveau (hq/regional/country → 'pays', sinon 'terrain').
ALTER TABLE field_offices
  ADD COLUMN IF NOT EXISTS office_level text
    CHECK (office_level IS NULL OR office_level IN ('hq', 'regional', 'country', 'area', 'sub', 'antenna'));

-- Reprise des bureaux existants : un bureau à périmètre national devient « Bureau pays »,
-- un bureau terrain devient « Antenne » s'il a un parent, sinon « Area Office ».
UPDATE field_offices
   SET office_level = CASE
         WHEN office_level IS NOT NULL THEN office_level
         WHEN nature = 'pays' OR national THEN 'country'
         WHEN parent_id IS NOT NULL THEN 'antenna'
         ELSE 'area' END
 WHERE office_level IS NULL;
