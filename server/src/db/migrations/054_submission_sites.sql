-- MEMS 2.0 — Données de suivi exactes (R1) et rattachement des formulaires aux sites
-- (retour n° 14 : « rattacher DPName, POIName avec les sites du plan »).
--
-- 1. Identifiant Kobo unique quel que soit le format d'export. Un export SPSS
--    nomme l'identifiant « @_uuid » (ou « instanceID » = « uuid: » + le même) ;
--    il n'était pas reconnu, la soumission recevait une empreinte « sav:… » et
--    le même formulaire importé en Excel puis en SPSS comptait deux fois. On
--    ré-attribue l'identifiant canonique (sans « uuid: ») d'après les réponses
--    brutes conservées, et on fusionne les doublons ainsi révélés : une seule
--    ligne par (fiche, identifiant Kobo) — la plus complète, qui reçoit les
--    réponses et champs des autres copies ; elle reste comptée si au moins une
--    copie l'était.
-- 2. Site du référentiel (sites) reconnu pour chaque soumission : colonnes
--    à côté de la valeur brute, jamais à sa place.
-- 3. Graphies de sites apprises et file « À rapprocher » : nouveau type « site ».
-- 4. Réparations de données exécutées une fois par l'API au démarrage (re-lecture
--    des colonnes typées avec les nouveaux noms de colonnes reconnus).

-- 1. Identifiant Kobo canonique + fusion des doublons ---------------------------
-- Colonne d'identifiant cherchée comme à l'import (casse et espaces ignorés), dans
-- l'ordre des alias : _uuid, @_uuid, meta/instanceID, instanceID.
CREATE TEMP TABLE _mems_canon ON COMMIT DROP AS
SELECT s.id, s.form_id, s.external_id, s.excluded, s.exclude_reason, s.created_at,
       regexp_replace(btrim(k.value), '^uuid:', '', 'i') AS canon
  FROM monitoring_submissions s
  CROSS JOIN LATERAL (
    SELECT e.value FROM jsonb_each_text(s.data) e
     WHERE lower(btrim(e.key)) IN ('_uuid', '@_uuid', 'meta/instanceid', 'instanceid') AND btrim(e.value) <> ''
     ORDER BY array_position(ARRAY['_uuid', '@_uuid', 'meta/instanceid', 'instanceid'], lower(btrim(e.key)))
     LIMIT 1) k;
DELETE FROM _mems_canon WHERE canon IS NULL OR canon = '';
-- Une ligne qui porte déjà cet identifiant sans la colonne (venue de « _id », « uuid »…)
-- fait partie du groupe : sinon le renommage final heurterait l'unicité (fiche, identifiant).
INSERT INTO _mems_canon (id, form_id, external_id, excluded, exclude_reason, created_at, canon)
SELECT s.id, s.form_id, s.external_id, s.excluded, s.exclude_reason, s.created_at, s.external_id
  FROM monitoring_submissions s
 WHERE NOT EXISTS (SELECT 1 FROM _mems_canon c WHERE c.id = s.id)
   AND EXISTS (SELECT 1 FROM _mems_canon c WHERE c.form_id = s.form_id AND c.canon = s.external_id);

-- Ligne gardée par (fiche, identifiant) : la plus complète (champs typés renseignés : un export
-- Excel « avec les groupes » n'en avait aucun), puis celle qui porte déjà l'identifiant (NULL
-- n'est pas « déjà »), puis la plus récente. all_excluded : toutes les copies étaient exclues.
CREATE TEMP TABLE _mems_keep ON COMMIT DROP AS
SELECT DISTINCT ON (c.form_id, c.canon) c.form_id, c.canon, c.id AS keep_id,
       bool_and(c.excluded) OVER (PARTITION BY c.form_id, c.canon) AS all_excluded,
       count(*) OVER (PARTITION BY c.form_id, c.canon) AS copies
  FROM _mems_canon c JOIN monitoring_submissions s ON s.id = c.id
 ORDER BY c.form_id, c.canon,
          num_nonnulls(s.field_office, s.admin1, s.admin2, s.admin3, s.admin4, s.site, s.partner, s.agent) DESC,
          (c.external_id IS NOT DISTINCT FROM c.canon) DESC, c.created_at DESC, c.id DESC;

-- Rien ne se perd à la fusion : réponses brutes de toutes les copies (celles de la ligne gardée
-- l'emportent, puis les plus récentes) et champs typés manquants repris des autres copies.
WITH entries AS (
  SELECT DISTINCT ON (c.form_id, c.canon, e.key) c.form_id, c.canon, e.key, e.value
    FROM _mems_canon c
    JOIN _mems_keep k ON k.form_id = c.form_id AND k.canon = c.canon AND k.copies > 1
    JOIN monitoring_submissions s ON s.id = c.id
   CROSS JOIN LATERAL jsonb_each(s.data) e
   ORDER BY c.form_id, c.canon, e.key, (c.id = k.keep_id) DESC, c.created_at DESC, c.id DESC
), merged AS (
  SELECT form_id, canon, jsonb_object_agg(key, value) AS data FROM entries GROUP BY form_id, canon
), filled AS (
  SELECT c.form_id, c.canon,
         (array_agg(s.period_month ORDER BY c.created_at DESC) FILTER (WHERE s.period_month IS NOT NULL))[1] AS period_month,
         (array_agg(s.submitted_at ORDER BY c.created_at DESC) FILTER (WHERE s.submitted_at IS NOT NULL))[1] AS submitted_at,
         (array_agg(s.field_office ORDER BY c.created_at DESC) FILTER (WHERE s.field_office IS NOT NULL))[1] AS field_office,
         (array_agg(s.admin1 ORDER BY c.created_at DESC) FILTER (WHERE s.admin1 IS NOT NULL))[1] AS admin1,
         (array_agg(s.admin2 ORDER BY c.created_at DESC) FILTER (WHERE s.admin2 IS NOT NULL))[1] AS admin2,
         (array_agg(s.admin3 ORDER BY c.created_at DESC) FILTER (WHERE s.admin3 IS NOT NULL))[1] AS admin3,
         (array_agg(s.admin4 ORDER BY c.created_at DESC) FILTER (WHERE s.admin4 IS NOT NULL))[1] AS admin4,
         (array_agg(s.site ORDER BY c.created_at DESC) FILTER (WHERE s.site IS NOT NULL))[1] AS site,
         (array_agg(s.partner ORDER BY c.created_at DESC) FILTER (WHERE s.partner IS NOT NULL))[1] AS partner,
         (array_agg(s.agent ORDER BY c.created_at DESC) FILTER (WHERE s.agent IS NOT NULL))[1] AS agent
    FROM _mems_canon c
    JOIN _mems_keep k ON k.form_id = c.form_id AND k.canon = c.canon AND k.copies > 1
    JOIN monitoring_submissions s ON s.id = c.id
   GROUP BY c.form_id, c.canon
)
UPDATE monitoring_submissions s
   SET data = m.data,
       period_month = COALESCE(s.period_month, f.period_month),
       submitted_at = COALESCE(s.submitted_at, f.submitted_at),
       field_office = COALESCE(s.field_office, f.field_office),
       admin1 = COALESCE(s.admin1, f.admin1), admin2 = COALESCE(s.admin2, f.admin2),
       admin3 = COALESCE(s.admin3, f.admin3), admin4 = COALESCE(s.admin4, f.admin4),
       site = COALESCE(s.site, f.site), partner = COALESCE(s.partner, f.partner), agent = COALESCE(s.agent, f.agent)
  FROM _mems_keep k
  JOIN merged m ON m.form_id = k.form_id AND m.canon = k.canon
  JOIN filled f ON f.form_id = k.form_id AND f.canon = k.canon
 WHERE s.id = k.keep_id;

-- Exclusion : la soumission reste comptée si au moins une copie l'était (exclure UN doublon
-- était la façon de dédoublonner à la main) ; exclue seulement si toutes les copies l'étaient.
UPDATE monitoring_submissions s
   SET excluded = k.all_excluded,
       exclude_reason = CASE WHEN k.all_excluded THEN COALESCE(s.exclude_reason,
         (SELECT d.exclude_reason FROM _mems_canon d WHERE d.form_id = k.form_id AND d.canon = k.canon AND d.exclude_reason IS NOT NULL LIMIT 1))
         ELSE NULL END
  FROM _mems_keep k
 WHERE s.id = k.keep_id AND (s.excluded IS DISTINCT FROM k.all_excluded OR (k.all_excluded AND s.exclude_reason IS NULL));

DO $$
DECLARE n int;
BEGIN
  DELETE FROM monitoring_submissions s
   USING _mems_canon c JOIN _mems_keep k ON k.form_id = c.form_id AND k.canon = c.canon
   WHERE s.id = c.id AND c.id <> k.keep_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE 'Suivi de processus : % soumission(s) en double (même identifiant Kobo) fusionnée(s).', n; END IF;
END $$;

UPDATE monitoring_submissions s SET external_id = k.canon
  FROM _mems_keep k
 WHERE s.id = k.keep_id AND s.external_id IS DISTINCT FROM k.canon;

-- 2. Site reconnu ----------------------------------------------------------------
-- Statuts (common/siteMatch.js) : les 5 premiers sont appliqués automatiquement.
CREATE OR REPLACE FUNCTION mems_site_status_ok(s text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT s IS NULL OR s IN ('code', 'lieu', 'nom', 'alias', 'deduit', 'a_valider', 'ambigu', 'introuvable', 'vide')
$$;
ALTER TABLE monitoring_submissions
  ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES sites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS site_status text;
ALTER TABLE monitoring_submissions DROP CONSTRAINT IF EXISTS monitoring_submissions_site_status_check;
ALTER TABLE monitoring_submissions ADD CONSTRAINT monitoring_submissions_site_status_check CHECK (mems_site_status_ok(site_status));
CREATE INDEX IF NOT EXISTS idx_mon_sub_site ON monitoring_submissions (tenant_id, site_id, period_month) WHERE site_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sites_adm4_pcode ON sites (tenant_id, adm4_pcode) WHERE adm4_pcode IS NOT NULL;
-- La nouvelle référence vers sites est couverte par le contrôle « même client » (migration 049).
SELECT mems_install_same_tenant('monitoring_submissions');

-- 3. Graphies et file « À rapprocher » : type « site » -------------------------
ALTER TABLE location_aliases DROP CONSTRAINT IF EXISTS location_aliases_kind_check;
ALTER TABLE location_aliases ADD CONSTRAINT location_aliases_kind_check CHECK (kind IN ('zone', 'bureau', 'partenaire', 'mot', 'site'));
ALTER TABLE location_match_queue DROP CONSTRAINT IF EXISTS location_match_queue_kind_check;
ALTER TABLE location_match_queue ADD CONSTRAINT location_match_queue_kind_check CHECK (kind IN ('zone', 'bureau', 'partenaire', 'site'));

-- 4. Réparations de données faites une fois par client, au démarrage de l'API ---
CREATE TABLE IF NOT EXISTS data_repairs (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key       text NOT NULL CHECK (length(key) BETWEEN 1 AND 80),
  result    jsonb NOT NULL DEFAULT '{}'::jsonb,
  done_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);
ALTER TABLE data_repairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_repairs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON data_repairs;
CREATE POLICY tenant_isolation ON data_repairs
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mems2_app') THEN
    GRANT SELECT, INSERT, UPDATE ON data_repairs TO mems2_app;
  END IF;
END $$;
