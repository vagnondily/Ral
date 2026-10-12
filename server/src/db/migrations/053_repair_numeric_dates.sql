-- MEMS 2.0 — Réparation des dates de collecte lues en 1970 (retour n° 1 et 11).
--
-- Avant le chantier R0 « imports », une date NUMÉRIQUE était passée telle
-- quelle à `new Date(n)`, qui la lit en millisecondes. Les exports SPSS de Kobo
-- donnent des secondes depuis le 14/10/1582 : 13 985 222 400 devenait le
-- 12/06/1970 au lieu du 16/12/2025. Ces soumissions tombent hors de tout mois
-- récent : la Synthèse et les tableaux de bord les ignorent.
--
-- La valeur d'origine se retrouve exactement : n = epoch(submitted_at) × 1000.
-- On la relit avec les mêmes codages, dans le même ordre, que la lecture
-- stricte (collectionDate.js) — leurs fenêtres 2000-2100 sont disjointes :
--   série Excel (jours depuis 1899-12-30) · secondes Unix · secondes SPSS.
-- Seules les lignes dont la date ET la période sont antérieures à 2000 (ou la
-- période vide) sont touchées, et seulement si un codage tombe dans 2000-2100 :
-- une vraie date de tablette remise à zéro reste telle quelle. Rejouable sans
-- effet (après réparation, plus aucune ligne ne répond au filtre).

WITH broken AS (
  SELECT id, round(extract(epoch FROM submitted_at) * 1000)::numeric AS n
    FROM monitoring_submissions
   WHERE submitted_at < '2000-01-01'
     AND (period_month IS NULL OR period_month < '2000-01-01')
), fixed AS (
  SELECT id,
         CASE
           WHEN n >= 36526 AND n < 73051                     -- série Excel : [2000-01-01, 2100-01-01)
             THEN timestamptz '1899-12-30 00:00:00+00' + n * interval '1 day'
           WHEN n >= 946684800 AND n < 4102444800             -- secondes Unix
             THEN to_timestamp(n::double precision)
           WHEN n - 12219379200 >= 946684800 AND n - 12219379200 < 4102444800 -- secondes SPSS (depuis le 14/10/1582)
             THEN to_timestamp((n - 12219379200)::double precision)
         END AS at
    FROM broken
)
UPDATE monitoring_submissions s
   SET submitted_at = f.at,
       period_month = date_trunc('month', f.at AT TIME ZONE 'UTC')::date
  FROM fixed f
 WHERE s.id = f.id AND f.at IS NOT NULL;
