-- MEMS 2.0 — Lot 6a « Carte exploitable » (retours 17, 27, 49, 50).
--
-- 1. Position GPS de chaque soumission, lue UNE fois dans les réponses brutes (data),
--    rangée dans trois colonnes simples (gps_lat, gps_lng, gps_accuracy_m) indexées
--    partiellement. Tous les chemins d'écriture sont couverts (imports CSV / XLSX / SAV /
--    Kobo / Ona, ré-import ON CONFLICT DO UPDATE SET data) sans toucher au code d'import :
--      - AFTER INSERT (ligne réellement insérée) : la règle est évaluée une fois et la
--        position écrite si elle diffère ; PostgreSQL déclenche les BEFORE INSERT AVANT
--        le contrôle de conflit — un BEFORE INSERT évaluerait la règle pour chaque ligne
--        d'un ré-import, même déjà présente (mesuré : ×7 sur 562 lignes identiques) ;
--      - BEFORE UPDATE OF data / colonnes GPS : recalcul seulement si les réponses ou les
--        colonnes changent (un ré-import identique ne recalcule rien) ; l'écriture faite
--        par le déclencheur AFTER INSERT (pg_trigger_depth() > 1, mêmes réponses) n'est
--        pas réévaluée.
--    Une mise à jour d'autres colonnes (rattachements aux lieux) ne recalcule rien. Coût
--    mesuré : environ 0,5 ms par ligne évaluée (≈ 25 s pour 50 000 lignes au rattrapage
--    ci-dessous). Référence lisible et testée de la même règle :
--    modules/map/submissionGps.js (mêmes motifs, même ordre de choix).
--    Si la règle change : CREATE OR REPLACE la fonction, puis rejouer l'UPDATE de
--    rattrapage ci-dessous (il ne réécrit que les lignes dont la position change).
-- 2. map_shape_links : correction manuelle district (P-code) → contour de la carte.

CREATE OR REPLACE FUNCTION mems_submission_gps(d jsonb) RETURNS numeric[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT ARRAY[c.lat, c.lng, c.acc] FROM (
    -- a) paire <préfixe>_latitude[_xxxx] / _longitude[_xxxx] (+ _precision) : exports Kobo.
    --    Seules les clés contenant « atitude » sont examinées (préfiltre bon marché).
    SELECT 1 AS src, length(e.key) AS kl, e.key,
           CASE WHEN (e.value #>> '{}') ~ '^\s*-?\d+(\.\d+)?\s*$' THEN (e.value #>> '{}')::numeric END AS lat,
           CASE WHEN (d #>> ARRAY[regexp_replace(e.key, '_latitude((_[0-9a-f]{4})?)$', '_longitude\1', 'i')]) ~ '^\s*-?\d+(\.\d+)?\s*$'
                THEN (d #>> ARRAY[regexp_replace(e.key, '_latitude((_[0-9a-f]{4})?)$', '_longitude\1', 'i')])::numeric END AS lng,
           CASE WHEN (d #>> ARRAY[regexp_replace(e.key, '_latitude((_[0-9a-f]{4})?)$', '_precision\1', 'i')]) ~ '^\s*\d+(\.\d+)?\s*$'
                THEN (d #>> ARRAY[regexp_replace(e.key, '_latitude((_[0-9a-f]{4})?)$', '_precision\1', 'i')])::numeric END AS acc
      FROM jsonb_each(d) e
     WHERE e.key ILIKE '%atitude%' AND e.key ~* '_latitude(_[0-9a-f]{4})?$'
    UNION ALL
    -- b) chaîne geopoint « lat lng [altitude [précision]] » (API Kobo : HHCoord) ; au moins
    --    3 décimales en latitude ET en longitude : « 1 2 » (choix multiple) n'est pas un point.
    --    Seules les chaînes contenant une espace et un point sont essayées.
    SELECT 2, length(g.key), g.key, m[1]::numeric, m[2]::numeric, m[4]::numeric
      FROM (SELECT e.key, btrim(e.value #>> '{}') AS v
              FROM jsonb_each(d) e
             WHERE jsonb_typeof(e.value) = 'string'
               AND strpos(e.value #>> '{}', ' ') > 0 AND strpos(e.value #>> '{}', '.') > 0) g
     CROSS JOIN LATERAL regexp_match(g.v,
       '^(-?\d{1,2}\.\d{3,})\s+(-?\d{1,3}\.\d{3,})(?:\s+(-?\d+(?:\.\d+)?))?(?:\s+(\d+(?:\.\d+)?))?$') m
     WHERE m IS NOT NULL
    UNION ALL
    -- c) _geolocation [lat, lng] (API Kobo JSON)
    SELECT 3, 12, '_geolocation',
           CASE WHEN (d -> '_geolocation' ->> 0) ~ '^\s*-?\d+(\.\d+)?\s*$' THEN (d -> '_geolocation' ->> 0)::numeric END,
           CASE WHEN (d -> '_geolocation' ->> 1) ~ '^\s*-?\d+(\.\d+)?\s*$' THEN (d -> '_geolocation' ->> 1)::numeric END,
           NULL::numeric
     WHERE jsonb_typeof(d -> '_geolocation') = 'array'
  ) c
  WHERE c.lat BETWEEN -90 AND 90 AND c.lng BETWEEN -180 AND 180 AND NOT (c.lat = 0 AND c.lng = 0)
  ORDER BY c.src, c.kl, c.key COLLATE "C"   -- clé sans suffixe d'abord ; même ordre que le JS
  LIMIT 1
$$;

ALTER TABLE monitoring_submissions
  ADD COLUMN IF NOT EXISTS gps_lat numeric(9,6),
  ADD COLUMN IF NOT EXISTS gps_lng numeric(9,6),
  ADD COLUMN IF NOT EXISTS gps_accuracy_m numeric(10,1);

-- Mise à jour (BEFORE UPDATE OF data, gps_*) : une évaluation par ligne dont les réponses ou
-- les colonnes GPS changent ; une écriture directe des colonnes GPS est recalculée depuis
-- data (les colonnes ne peuvent pas diverger des réponses). Un ré-import identique
-- (ON CONFLICT DO UPDATE SET data = EXCLUDED.data, mêmes réponses) ne recalcule rien :
-- comparer deux jsonb coûte bien moins que la règle. L'écriture du déclencheur AFTER
-- INSERT ci-dessous (profondeur > 1, réponses inchangées) vient d'être calculée : gardée.
CREATE OR REPLACE FUNCTION mems_submission_gps_fill() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g numeric[];
BEGIN
  IF NEW.data IS NOT DISTINCT FROM OLD.data AND (pg_trigger_depth() > 1 OR (
       NEW.gps_lat IS NOT DISTINCT FROM OLD.gps_lat AND NEW.gps_lng IS NOT DISTINCT FROM OLD.gps_lng
       AND NEW.gps_accuracy_m IS NOT DISTINCT FROM OLD.gps_accuracy_m)) THEN
    RETURN NEW;
  END IF;
  g := mems_submission_gps(NEW.data);
  NEW.gps_lat := round(g[1], 6);
  NEW.gps_lng := round(g[2], 6);
  -- LEAST ignore les NULL : sans précision lue, la colonne reste NULL (jamais 999 999 999).
  NEW.gps_accuracy_m := CASE WHEN g[3] IS NULL THEN NULL ELSE round(LEAST(g[3], 999999999), 1) END;
  RETURN NEW;
END $$;

-- Insertion (AFTER INSERT, ligne réellement insérée — jamais une ligne en conflit d'un
-- ré-import, qui passe par la mise à jour ci-dessus) : une évaluation ; écriture seulement
-- si la position lue diffère des colonnes (aucune écriture pour une soumission sans GPS).
CREATE OR REPLACE FUNCTION mems_submission_gps_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g numeric[]; v_lat numeric; v_lng numeric; v_acc numeric;
BEGIN
  g := mems_submission_gps(NEW.data);
  v_lat := round(g[1], 6);
  v_lng := round(g[2], 6);
  v_acc := CASE WHEN g[3] IS NULL THEN NULL ELSE round(LEAST(g[3], 999999999), 1) END;
  IF v_lat IS DISTINCT FROM NEW.gps_lat OR v_lng IS DISTINCT FROM NEW.gps_lng OR v_acc IS DISTINCT FROM NEW.gps_accuracy_m THEN
    UPDATE monitoring_submissions SET gps_lat = v_lat, gps_lng = v_lng, gps_accuracy_m = v_acc
     WHERE id = NEW.id AND tenant_id = NEW.tenant_id;
  END IF;
  RETURN NULL;
END $$;

-- Rattrapage des lignes existantes, AVANT le déclencheur (une évaluation par ligne ;
-- idempotent). C'est aussi la commande de recalcul si la règle change.
DROP TRIGGER IF EXISTS trg_mon_sub_gps ON monitoring_submissions;
DROP TRIGGER IF EXISTS trg_mon_sub_gps_ins ON monitoring_submissions;
UPDATE monitoring_submissions s
   SET gps_lat = round(x.g[1], 6), gps_lng = round(x.g[2], 6),
       gps_accuracy_m = CASE WHEN x.g[3] IS NULL THEN NULL ELSE round(LEAST(x.g[3], 999999999), 1) END
  FROM (SELECT id, mems_submission_gps(data) AS g FROM monitoring_submissions) x
 WHERE x.id = s.id
   AND (s.gps_lat IS DISTINCT FROM round(x.g[1], 6) OR s.gps_lng IS DISTINCT FROM round(x.g[2], 6)
        OR s.gps_accuracy_m IS DISTINCT FROM CASE WHEN x.g[3] IS NULL THEN NULL ELSE round(LEAST(x.g[3], 999999999), 1) END);

CREATE TRIGGER trg_mon_sub_gps
  BEFORE UPDATE OF data, gps_lat, gps_lng, gps_accuracy_m ON monitoring_submissions
  FOR EACH ROW EXECUTE FUNCTION mems_submission_gps_fill();
CREATE TRIGGER trg_mon_sub_gps_ins
  AFTER INSERT ON monitoring_submissions
  FOR EACH ROW EXECUTE FUNCTION mems_submission_gps_insert();

CREATE INDEX IF NOT EXISTS idx_mon_sub_period    ON monitoring_submissions (tenant_id, period_month) WHERE NOT excluded;
CREATE INDEX IF NOT EXISTS idx_mon_sub_gps_month ON monitoring_submissions (tenant_id, period_month) WHERE gps_lat IS NOT NULL AND NOT excluded;
CREATE INDEX IF NOT EXISTS idx_mon_sub_gps_site  ON monitoring_submissions (tenant_id, site_id) WHERE gps_lat IS NOT NULL AND site_id IS NOT NULL AND NOT excluded;
CREATE INDEX IF NOT EXISTS idx_mon_sub_gps_com   ON monitoring_submissions (tenant_id, adm3_pcode) WHERE gps_lat IS NOT NULL AND NOT excluded;

-- 2. Corrections district -> contour. Clé = P-code (stable au ré-import du découpage).
--    Un seul jeu de contours pour l'instant (valeur fixe, sans surface d'API) ; le lot 6
--    importera des contours par compte.
CREATE TABLE IF NOT EXISTS map_shape_links (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shape_set  text NOT NULL DEFAULT 'mdg-adm2.v1' CHECK (length(shape_set) BETWEEN 1 AND 40),
  area_pcode text NOT NULL CHECK (length(area_pcode) BETWEEN 2 AND 40),
  shape_key  text CHECK (shape_key IS NULL OR length(shape_key) BETWEEN 1 AND 120), -- NULL = « ne pas dessiner »
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, shape_set, area_pcode)
);
ALTER TABLE map_shape_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE map_shape_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON map_shape_links;
CREATE POLICY tenant_isolation ON map_shape_links
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mems2_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON map_shape_links TO mems2_app;
  END IF;
END $$;
SELECT mems_install_same_tenant('map_shape_links');
