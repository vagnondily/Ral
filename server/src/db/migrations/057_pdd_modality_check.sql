-- MEMS 2.0 — Modalité des distributions PDD : trois valeurs, contrôlées en base.
--
-- Jusqu'au chantier R0 « PDD », l'import enregistrait la modalité telle que
-- saisie (« Inkind », « Vivres », « Cash », « Mixte », « In-kind »…). L'import
-- la ramène désormais à sa valeur canonique (pddImport.js, MODALITIES) :
--   Inkind — distribution en nature (vivres) ;
--   CBT    — transfert monétaire (cash-based transfer) ;
--   Mixte  — vivres + transfert monétaire.
-- 1. Les lignes existantes sont normalisées avec les MÊMES synonymes et la
--    même clé de comparaison (minuscules, sans accents, espaces ni ponctuation).
--    Une valeur vide devient NULL. Une valeur qui n'est le synonyme d'aucune
--    modalité (ex. « Voucher », que l'import refuse) devient NULL : elle n'a
--    jamais été une modalité reconnue ; le nombre de lignes concernées est
--    signalé (NOTICE) et un réimport du fichier, corrigé, la rétablit.
-- 2. La base refuse ensuite toute autre valeur (CHECK). Rejouable sans effet.

DO $$
DECLARE
  unknown_count int;
  unknown_values text;
BEGIN
  CREATE TEMP TABLE pdd_modality_norm ON COMMIT DROP AS
  SELECT id,
         modality AS raw,
         CASE
           WHEN k IN ('inkind', 'vivres', 'vivre', 'food', 'ennature', 'nature', 'denrees') THEN 'Inkind'
           WHEN k IN ('cbt', 'cash', 'cashbasedtransfer', 'cashbasedtransfers', 'transfertmonetaire', 'transfertsmonetaires', 'argent', 'especes') THEN 'CBT'
           WHEN k IN ('mixte', 'mixed', 'mix', 'inkindcbt', 'cbtinkind', 'vivrescash', 'cashvivres', 'vivresetcash', 'cashetvivres', 'foodcash', 'cashfood') THEN 'Mixte'
         END AS canon,
         k
    FROM (
      SELECT id, modality,
             regexp_replace(lower(translate(modality,
               'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖòóôõöÙÚÛÜùúûüÝýÿ',
               'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOoooooUUUUuuuuYyy')), '[^a-z0-9]', '', 'g') AS k
        FROM pdd_distributions
       WHERE modality IS NOT NULL
         AND modality NOT IN ('Inkind', 'CBT', 'Mixte')
    ) s;

  SELECT count(*), string_agg(DISTINCT raw, ', ')
    INTO unknown_count, unknown_values
    FROM pdd_modality_norm
   WHERE canon IS NULL AND k <> '';
  IF unknown_count > 0 THEN
    RAISE NOTICE 'PDD : % ligne(s) avec une modalité non reconnue (%) remise(s) à vide.', unknown_count, left(unknown_values, 500);
  END IF;

  UPDATE pdd_distributions d
     SET modality = n.canon
    FROM pdd_modality_norm n
   WHERE d.id = n.id;
END $$;

ALTER TABLE pdd_distributions DROP CONSTRAINT IF EXISTS pdd_distributions_modality_check;
ALTER TABLE pdd_distributions ADD CONSTRAINT pdd_distributions_modality_check
  CHECK (modality IS NULL OR modality IN ('Inkind', 'CBT', 'Mixte'));
