-- MEMS 2.0 — Données de suivi exactes (R1) et rattachement des formulaires aux sites
-- (retour n° 14 : « rattacher DPName, POIName avec les sites du plan »).
--
-- 1. Identifiant Kobo unique quel que soit le format d'export. Un export SPSS
--    nomme l'identifiant « @_uuid » (ou « instanceID » = « uuid: » + le même) ;
--    il n'était pas reconnu, la soumission recevait une empreinte « sav:… » et
--    le même formulaire importé en Excel puis en SPSS comptait deux fois. On
--    ré-attribue l'identifiant canonique (sans « uuid: ») d'après les réponses
--    brutes conservées, et on fusionne les doublons ainsi révélés : une seule
--    ligne par (fiche, identifiant Kobo) — celle qui portait déjà l'identifiant,
--    sinon la plus récente ; une exclusion décidée sur un doublon est conservée.
-- 2. Site du référentiel (sites) reconnu pour chaque soumission : colonnes
--    à côté de la valeur brute, jamais à sa place.
-- 3. Graphies de sites apprises et file « À rapprocher » : nouveau type « site ».
-- 4. Réparations de données exécutées une fois par l'API au démarrage (re-lecture
--    des colonnes typées avec les nouveaux noms de colonnes reconnus).

-- 1. Identifiant Kobo canonique + fusion des doublons ---------------------------
CREATE TEMP TABLE _mems_canon ON COMMIT DROP AS
SELECT id, form_id, external_id, excluded, exclude_reason, created_at,
       regexp_replace(btrim(COALESCE(NULLIF(btrim(data->>'_uuid'), ''), NULLIF(btrim(data->>'@_uuid'), ''),
                                     NULLIF(btrim(data->>'meta/instanceID'), ''), NULLIF(btrim(data->>'instanceID'), ''))),
                      '^uuid:', '', 'i') AS canon
  FROM monitoring_submissions;
DELETE FROM _mems_canon WHERE canon IS NULL OR canon = '';

-- Ligne gardée par (fiche, identifiant) : celle qui a déjà l'identifiant, sinon la plus récente.
CREATE TEMP TABLE _mems_keep ON COMMIT DROP AS
SELECT DISTINCT ON (form_id, canon) form_id, canon, id AS keep_id
  FROM _mems_canon
 ORDER BY form_id, canon, (external_id = canon) DESC, created_at DESC, id DESC;

-- Une exclusion décidée sur un doublon reste acquise sur la ligne gardée.
UPDATE monitoring_submissions s
   SET excluded = true,
       exclude_reason = COALESCE(s.exclude_reason, d.exclude_reason)
  FROM _mems_keep k
  JOIN _mems_canon d ON d.form_id = k.form_id AND d.canon = k.canon AND d.id <> k.keep_id AND d.excluded
 WHERE s.id = k.keep_id AND NOT s.excluded;

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
