-- MEMS 2.0 — Périmètre des bureaux (écart M1 de docs/ANALYSE_LIAISONS.md).
--
-- La clé (office_id, commune) était sensible à la casse et ignorait le district :
-- « AMBATOSOLA » et « Ambatosola » coexistaient pour le même bureau, alors que
-- deux communes HOMONYMES de districts différents ne pouvaient pas l'être (la
-- seconde était perdue en silence). Nouvelle unicité : bureau + district +
-- commune, casse et espaces ignorés. L'unité reconnue du découpage
-- (admin_area_id, migration 050) est renseignée à l'écriture par le moteur de
-- rapprochement.

-- 1. Doublons de casse/espaces dans un même bureau et district : une seule ligne
--    est gardée (de préférence la graphie en casse mixte), aucune commune perdue.
DELETE FROM field_office_communes c
 USING (
   SELECT ctid, row_number() OVER (
            PARTITION BY office_id, lower(btrim(COALESCE(district, ''))), lower(btrim(commune))
            ORDER BY (commune = upper(commune)), commune) AS rn
     FROM field_office_communes) d
 WHERE c.ctid = d.ctid AND d.rn > 1;

-- 2. Clé technique + unicité insensible à la casse, district compris.
ALTER TABLE field_office_communes ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE field_office_communes DROP CONSTRAINT IF EXISTS field_office_communes_pkey;
ALTER TABLE field_office_communes ADD PRIMARY KEY (id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_office_commune
  ON field_office_communes (office_id, lower(btrim(COALESCE(district, ''))), lower(btrim(commune)));
