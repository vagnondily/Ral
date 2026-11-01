-- MEMS 2.0 — Activités de programme (suivi de processus) › sous-activités (Activity_tag) › information.
-- Migration 105 (retours 92 et 106 ; correction de l'utilisateur du 15/10, 11:00 UTC).
--
-- Deux notions DISTINCTES, à ne plus confondre :
--   (A) ACTIVITÉS DE PROGRAMME — ce que le suivi de processus observe : « Catégorie d'activité » du
--       MMR, sites.activity, monitoring_forms.activity_category, site_visits.activity,
--       pdd_distributions.activity. Ex. « Unconditional resource transfers to support access to
--       food », « School meal activities ». Elles portent les SOUS-ACTIVITÉS (Activity_tag : GD,
--       PREVMA, SMP, PECMAM…, table sub_activities de la migration 101), puis leur information.
--   (B) PRESTATIONS CONTRACTUELLES (FLA) — la table `activities` (migration 005 : Suivi, Ciblage,
--       PDM, Distribution, Évaluation) : ce qu'un partenaire est payé pour faire dans un contrat.
--       Inchangée ; les budgets FLA continuent d'y pointer.
--
-- La migration 101 avait rattaché les sous-activités à (B) : elles passent sous (A)
-- (programme_activity_id), l'ancien lien vers `activities` est supprimé ici.
--
-- Les textes libres EXISTANTS ne sont pas réécrits : ils sont LUS à travers
-- programme_activity_aliases (clé normalisée mems_activity_key → activité de programme). Un
-- renommage garde l'ancien libellé comme alias : rien ne se détache.
--
-- Reprise (idempotente, mems_programme_activity_reprise) : une activité de programme par clé
-- distincte des 5 colonnes de texte (libellé le plus fréquent ; code = libellé assaini en
-- majuscules, suffixe -2, -3 en cas de collision) ; un alias par clé ; les Tag_code des sites
-- inconnus deviennent des sous-activités (sous l'activité de leurs sites, sinon « À classer »).
-- La même fonction sert aux jeux de démonstration et au bouton « Reprendre les libellés ».
--
-- Rôle mems_app jamais touché : seul mems2_app reçoit des droits.

-- ---------------------------------------------------------------- clé normalisée --
-- Jumelle JS : server/src/modules/programmes/activityKey.js (parité testée).
CREATE OR REPLACE FUNCTION mems_activity_key(s text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(lower(translate(coalesce(s, ''),
    'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖòóôõöÙÚÛÜùúûüÝýÿ',
    'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOoooooUUUUuuuuYyy')), '[^a-z0-9]+', '', 'g') $$;

-- ------------------------------------------------------------ activités de programme --
CREATE TABLE IF NOT EXISTS programme_activities (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code         text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$'),
  label        text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 160),        -- libellé officiel
  short_label  text CHECK (short_label IS NULL OR length(btrim(short_label)) BETWEEN 1 AND 60),
  description  text CHECK (description IS NULL OR length(description) <= 2000),
  sort_order   int NOT NULL DEFAULT 0,
  active       boolean NOT NULL DEFAULT true,
  -- « À classer » : parent d'attente des sous-activités sans activité connue. Jamais proposé dans
  -- une liste de saisie, jamais désigné par un alias (une seule par compte).
  bucket       boolean NOT NULL DEFAULT false,
  -- 'reprise' = créée par la reprise des libellés existants (à vérifier) ; 'saisie' = Paramétrage.
  origin       text NOT NULL DEFAULT 'saisie' CHECK (origin IN ('saisie', 'reprise')),
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
-- Deux activités de programme d'un compte n'ont jamais la même clé de libellé.
CREATE UNIQUE INDEX IF NOT EXISTS uq_programme_activities_key ON programme_activities (tenant_id, mems_activity_key(label));
CREATE UNIQUE INDEX IF NOT EXISTS uq_programme_activities_bucket ON programme_activities (tenant_id) WHERE bucket;

-- ------------------------------------------------- alias : texte libre → activité --
CREATE TABLE IF NOT EXISTS programme_activity_aliases (
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  alias_key              text NOT NULL CHECK (alias_key ~ '^[a-z0-9]{1,160}$'),
  programme_activity_id  uuid NOT NULL REFERENCES programme_activities(id) ON DELETE CASCADE,
  source                 text NOT NULL CHECK (source IN ('libelle', 'code', 'manuel')),
  label                  text CHECK (label IS NULL OR length(label) <= 160),   -- graphie lue (affichage)
  created_by             uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, alias_key)
);
CREATE INDEX IF NOT EXISTS idx_programme_activity_aliases_target ON programme_activity_aliases (tenant_id, programme_activity_id);

-- ------------------------------------------------------------------ RLS, droits --
ALTER TABLE programme_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE programme_activities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON programme_activities;
CREATE POLICY tenant_isolation ON programme_activities USING (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE programme_activity_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE programme_activity_aliases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON programme_activity_aliases;
CREATE POLICY tenant_isolation ON programme_activity_aliases USING (tenant_id::text = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON programme_activities, programme_activity_aliases TO mems2_app;

-- Une clé étrangère ne passe pas par la RLS : activité d'un alias et auteurs sont contrôlés
-- « même compte » à l'écriture (migration 049).
SELECT mems_install_same_tenant('programme_activities');
SELECT mems_install_same_tenant('programme_activity_aliases');

-- --------------------------------------------------------------- « À classer » --
CREATE OR REPLACE FUNCTION mems_programme_activity_bucket(p_tenant uuid) RETURNS uuid
LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM programme_activities WHERE tenant_id = p_tenant AND bucket;
  IF v_id IS NULL THEN
    INSERT INTO programme_activities (tenant_id, code, label, description, sort_order, bucket, origin)
    VALUES (p_tenant, 'A-CLASSER', 'À classer',
            'Sous-activités sans activité de programme connue : rangez-les sous leur activité.', 9999, true, 'reprise')
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN  -- code A-CLASSER déjà pris par une vraie activité : autre code
      INSERT INTO programme_activities (tenant_id, code, label, description, sort_order, bucket, origin)
      VALUES (p_tenant, 'A-CLASSER-' || substr(md5(p_tenant::text), 1, 6), 'À classer (sous-activités)',
              'Sous-activités sans activité de programme connue : rangez-les sous leur activité.', 9999, true, 'reprise')
      RETURNING id INTO v_id;
    END IF;
  END IF;
  RETURN v_id;
END
$fn$;

-- ----------------------------------------------------------------------- reprise --
-- Idempotente : une clé déjà reconnue (alias existant) n'est jamais reprise deux fois ; rien
-- n'est réécrit dans les tables métier. Renvoie { activities, aliases, subActivities } créés.
CREATE OR REPLACE FUNCTION mems_programme_activity_reprise(p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE
  v_acts   integer := 0;
  v_alias  integer := 0;
  v_subs   integer := 0;
  v_n      integer;
  v_base   text;
  v_code   text;
  v_try    integer;
  v_id     uuid;
  r        record;
BEGIN
  -- 1. Une activité de programme par clé encore inconnue : libellé le plus fréquent (espaces
  --    répétés réduits ; à égalité, l'ordre alphabétique), traitée par poids décroissant.
  FOR r IN
    WITH src AS (
      SELECT btrim(s.activity) AS label FROM sites s WHERE s.tenant_id = p_tenant AND s.activity IS NOT NULL
      UNION ALL SELECT btrim(m.activity_category) FROM mmr_parameters m WHERE m.tenant_id = p_tenant
      UNION ALL SELECT btrim(f.activity_category) FROM monitoring_forms f WHERE f.tenant_id = p_tenant AND f.activity_category IS NOT NULL
      UNION ALL SELECT btrim(v.activity) FROM site_visits v WHERE v.tenant_id = p_tenant AND v.activity IS NOT NULL
      UNION ALL SELECT btrim(d.activity) FROM pdd_distributions d WHERE d.tenant_id = p_tenant
    ),
    keyed AS (
      SELECT left(mems_activity_key(label), 160) AS k, btrim(left(regexp_replace(label, '\s+', ' ', 'g'), 160)) AS label
        FROM src WHERE mems_activity_key(label) <> ''
    ),
    fresh AS (
      SELECT x.* FROM keyed x
       WHERE NOT EXISTS (SELECT 1 FROM programme_activity_aliases a WHERE a.tenant_id = p_tenant AND a.alias_key = x.k)
    ),
    labels AS (SELECT k, label, count(*) AS n FROM fresh GROUP BY k, label),
    best AS (SELECT DISTINCT ON (k) k, label FROM labels ORDER BY k, n DESC, label),
    weights AS (SELECT k, sum(n) AS w FROM labels GROUP BY k)
    SELECT b.k, b.label FROM best b JOIN weights w ON w.k = b.k ORDER BY w.w DESC, b.label, b.k
  LOOP
    -- Code proposé (jumelle JS : activityKey.codeFromLabel / uniqueCode).
    v_base := upper(translate(r.label,
      'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖòóôõöÙÚÛÜùúûüÝýÿ',
      'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOoooooUUUUuuuuYyy'));
    v_base := regexp_replace(v_base, '[^A-Z0-9._-]+', '-', 'g');
    v_base := regexp_replace(v_base, '-{2,}', '-', 'g');
    v_base := regexp_replace(v_base, '^[^A-Z0-9]+', '');
    v_base := regexp_replace(left(v_base, 30), '[._-]+$', '');
    IF v_base = '' THEN v_base := 'ACT'; END IF;
    v_code := v_base;
    v_try := 1;
    WHILE EXISTS (SELECT 1 FROM programme_activities p WHERE p.tenant_id = p_tenant AND lower(p.code) = lower(v_code)) LOOP
      v_try := v_try + 1;
      v_code := regexp_replace(left(v_base, 30 - length('-' || v_try)), '[._-]+$', '') || '-' || v_try;
    END LOOP;

    v_id := NULL;
    INSERT INTO programme_activities (tenant_id, code, label, origin)
    VALUES (p_tenant, v_code, r.label, 'reprise')
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      -- Libellé déjà porté par une activité (même clé, sans alias) : on la reconnaît, sans doublon.
      SELECT p.id INTO v_id FROM programme_activities p
       WHERE p.tenant_id = p_tenant AND NOT p.bucket AND mems_activity_key(p.label) = mems_activity_key(r.label);
    ELSE
      v_acts := v_acts + 1;
    END IF;
    IF v_id IS NOT NULL THEN
      INSERT INTO programme_activity_aliases (tenant_id, alias_key, programme_activity_id, source, label)
      VALUES (p_tenant, r.k, v_id, 'libelle', r.label)
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_alias := v_alias + v_n;
    END IF;
  END LOOP;

  -- 2. Libellé officiel et code de chaque activité reconnus aussi (jamais au détriment d'une clé
  --    déjà prise : elle reste à son propriétaire).
  INSERT INTO programme_activity_aliases (tenant_id, alias_key, programme_activity_id, source, label)
  SELECT p_tenant, left(mems_activity_key(p.label), 160), p.id, 'libelle', p.label
    FROM programme_activities p
   WHERE p.tenant_id = p_tenant AND NOT p.bucket AND mems_activity_key(p.label) <> ''
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_alias := v_alias + v_n;
  INSERT INTO programme_activity_aliases (tenant_id, alias_key, programme_activity_id, source, label)
  SELECT p_tenant, left(mems_activity_key(p.code), 160), p.id, 'code', p.code
    FROM programme_activities p
   WHERE p.tenant_id = p_tenant AND NOT p.bucket AND mems_activity_key(p.code) <> ''
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_alias := v_alias + v_n;

  -- 3. Tag_code des sites inconnus des sous-activités : une sous-activité par clé, sous l'activité
  --    de programme la plus fréquente de ses sites (sinon « À classer »).
  FOR r IN
    WITH tags AS (
      SELECT left(mems_activity_key(s.tag_code), 160) AS k, btrim(s.tag_code) AS code, a.programme_activity_id AS pa
        FROM sites s
        LEFT JOIN programme_activity_aliases a ON a.tenant_id = s.tenant_id
                                              AND a.alias_key = left(mems_activity_key(s.activity), 160)
       WHERE s.tenant_id = p_tenant AND s.tag_code IS NOT NULL AND mems_activity_key(s.tag_code) <> ''
         AND length(btrim(s.tag_code)) <= 60
         AND NOT EXISTS (SELECT 1 FROM sub_activities sa WHERE sa.tenant_id = p_tenant
                            AND mems_activity_key(sa.code) = mems_activity_key(s.tag_code))
    ),
    spelling AS (SELECT DISTINCT ON (k) k, code FROM (SELECT k, code, count(*) AS n FROM tags GROUP BY k, code) x ORDER BY k, n DESC, code),
    parent AS (
      SELECT DISTINCT ON (k) k, pa FROM (SELECT k, pa, count(*) AS n FROM tags WHERE pa IS NOT NULL GROUP BY k, pa) y
       ORDER BY k, n DESC, pa
    )
    SELECT sp.k, sp.code, pr.pa FROM spelling sp LEFT JOIN parent pr ON pr.k = sp.k ORDER BY sp.code
  LOOP
    INSERT INTO sub_activities (tenant_id, programme_activity_id, code, label)
    VALUES (p_tenant, COALESCE(r.pa, mems_programme_activity_bucket(p_tenant)), r.code, r.code)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_subs := v_subs + v_n;
  END LOOP;

  RETURN jsonb_build_object('activities', v_acts, 'aliases', v_alias, 'subActivities', v_subs);
END
$fn$;

-- ------------------------------------------- sous-activités : sous l'activité de programme --
ALTER TABLE sub_activities ADD COLUMN IF NOT EXISTS programme_activity_id uuid REFERENCES programme_activities(id) ON DELETE RESTRICT;
-- L'ancien lien (activity_id, supprimé plus bas) n'est plus exigé pendant la reprise.
ALTER TABLE sub_activities ALTER COLUMN activity_id DROP NOT NULL;

-- Un code (Activity_tag) désigne UNE sous-activité, sans tenir compte de la casse ni de la
-- ponctuation (« GD » = « gd » = « G-D ») : sites.tag_code s'y rattache sans ambiguïté.
DO $$
DECLARE dup text;
BEGIN
  SELECT string_agg(x.codes, ' ; ') INTO dup FROM (
    SELECT string_agg(code, ' / ' ORDER BY code) AS codes FROM sub_activities
     WHERE mems_activity_key(code) <> '' GROUP BY tenant_id, mems_activity_key(code) HAVING count(*) > 1) x;
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'Codes de sous-activité en double (même code à la casse ou à la ponctuation près) : %. Renommez-en un dans Paramétrage › Activités, puis relancez « npm run migrate ».', dup;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sub_activities_code_key ON sub_activities (tenant_id, mems_activity_key(code))
  WHERE mems_activity_key(code) <> '';

GRANT EXECUTE ON FUNCTION mems_activity_key(text) TO mems2_app;
GRANT EXECUTE ON FUNCTION mems_programme_activity_bucket(uuid) TO mems2_app;
GRANT EXECUTE ON FUNCTION mems_programme_activity_reprise(uuid) TO mems2_app;

-- Reprise de chaque compte, puis rattachement des sous-activités existantes (migration 101) à
-- l'activité de programme des sites qui portent leur code (la plus fréquente), sinon « À classer ».
DO $$
DECLARE
  t        record;
  res      jsonb;
  n_ten    integer := 0;
  n_acts   integer := 0;
  n_alias  integer := 0;
  n_subs   integer := 0;
  n_mapped integer := 0;
  n_bucket integer := 0;
  v_n      integer;
BEGIN
  FOR t IN SELECT id FROM tenants ORDER BY id LOOP
    res := mems_programme_activity_reprise(t.id);
    n_ten := n_ten + 1;
    n_acts := n_acts + (res->>'activities')::int;
    n_alias := n_alias + (res->>'aliases')::int;
    n_subs := n_subs + (res->>'subActivities')::int;

    UPDATE sub_activities sa SET programme_activity_id = m.pa, updated_at = now()
      FROM (SELECT DISTINCT ON (x.id) x.id, x.pa
              FROM (SELECT sa2.id, a.programme_activity_id AS pa, count(*) AS n
                      FROM sub_activities sa2
                      JOIN sites s ON s.tenant_id = sa2.tenant_id
                                  AND mems_activity_key(s.tag_code) = mems_activity_key(sa2.code)
                                  AND mems_activity_key(sa2.code) <> ''
                      JOIN programme_activity_aliases a ON a.tenant_id = s.tenant_id
                                                       AND a.alias_key = left(mems_activity_key(s.activity), 160)
                     WHERE sa2.tenant_id = t.id AND sa2.programme_activity_id IS NULL
                     GROUP BY sa2.id, a.programme_activity_id) x
             ORDER BY x.id, x.n DESC, x.pa) m
     WHERE sa.id = m.id AND sa.tenant_id = t.id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    n_mapped := n_mapped + v_n;

    IF EXISTS (SELECT 1 FROM sub_activities WHERE tenant_id = t.id AND programme_activity_id IS NULL) THEN
      UPDATE sub_activities SET programme_activity_id = mems_programme_activity_bucket(t.id), updated_at = now()
       WHERE tenant_id = t.id AND programme_activity_id IS NULL;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      n_bucket := n_bucket + v_n;
    END IF;
  END LOOP;
  RAISE NOTICE 'Activités de programme : % compte(s), % activité(s) reprise(s), % alias, % sous-activité(s) créée(s) depuis les Tag_code ; sous-activités existantes : % rattachée(s) par leurs sites, % sous « À classer ».',
    n_ten, n_acts, n_alias, n_subs, n_mapped, n_bucket;
END $$;

-- L'ancien lien vers les prestations contractuelles (activities) disparaît : la sous-activité
-- appartient désormais à une activité de programme.
ALTER TABLE sub_activities ALTER COLUMN programme_activity_id SET NOT NULL;
DROP INDEX IF EXISTS idx_sub_activities_activity;
ALTER TABLE sub_activities DROP COLUMN IF EXISTS activity_id;
CREATE INDEX IF NOT EXISTS idx_sub_activities_programme ON sub_activities (tenant_id, programme_activity_id);
-- Contrôle « même compte » régénéré sur les références actuelles (programme_activity_id).
SELECT mems_install_same_tenant('sub_activities');
