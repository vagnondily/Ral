-- MEMS 2.0 — Rapprochement des lieux (lots 3 à 6 de docs/ANALYSE_LIAISONS.md, §2.2).
--
-- Un nom de lieu importé (site, soumission Kobo, distribution PDD, périmètre de
-- bureau) est résolu UNE fois à l'écriture par le moteur pur
-- common/placeMatch.js, puis les jointures se font sur le code ou l'identifiant.
-- La valeur brute est toujours conservée : rien n'est réécrit ni supprimé ici,
-- on AJOUTE le résultat canonique à côté (colonnes nullables).
--
-- - location_aliases : graphies apprises (validées une fois, réutilisées partout).
-- - location_match_queue : file « À rapprocher » (une ligne par graphie non
--   résolue, avec le nombre d'occurrences par source et les candidats).

-- Statuts de résolution (placeMatch) : les 6 premiers sont appliqués automatiquement.
CREATE OR REPLACE FUNCTION mems_geo_status_ok(s text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT s IS NULL OR s IN ('code', 'exact', 'normalise', 'alias', 'unique_niveau', 'deduit',
                            'a_valider', 'ambigu', 'introuvable', 'vide')
$$;

CREATE TABLE IF NOT EXISTS location_aliases (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('zone', 'bureau', 'partenaire', 'mot')),
  depth        int CHECK (depth IS NULL OR depth BETWEEN 1 AND 6),
  parent_key   text NOT NULL DEFAULT '',         -- pcode du parent, sinon sa clé normalisée ; '' = tout le niveau
  alias_key    text NOT NULL CHECK (length(alias_key) BETWEEN 1 AND 200),  -- clé normalisée (placeMatch.normPlace)
  alias_label  text NOT NULL CHECK (length(alias_label) BETWEEN 1 AND 200), -- graphie d'origine
  target_pcode text,
  target_path  text,
  target_id    uuid,                              -- unité (admin_areas), bureau ou partenaire
  source       text NOT NULL CHECK (source IN ('valide', 'renommage', 'xlsform', 'preset')),
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (target_pcode IS NOT NULL OR target_path IS NOT NULL OR target_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_location_alias
  ON location_aliases (tenant_id, kind, COALESCE(depth, 0), parent_key, alias_key);

CREATE TABLE IF NOT EXISTS location_match_queue (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('zone', 'bureau', 'partenaire')),
  depth        int CHECK (depth IS NULL OR depth BETWEEN 1 AND 6),
  parent_key   text NOT NULL DEFAULT '',
  parent_label text,
  raw_key      text NOT NULL CHECK (length(raw_key) BETWEEN 1 AND 200),
  raw_label    text NOT NULL CHECK (length(raw_label) BETWEEN 1 AND 200),
  occurrences  jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {"sites":12,"soumissions":340,"pdd":5}
  candidates   jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{id,pcode,name,path,score}]
  status       text NOT NULL DEFAULT 'a_valider' CHECK (status IN ('a_valider', 'ambigu', 'introuvable', 'ignore', 'resolu')),
  alias_id     uuid REFERENCES location_aliases(id) ON DELETE SET NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  decided_by   uuid REFERENCES users(id),
  decided_at   timestamptz,
  CHECK (jsonb_typeof(occurrences) = 'object' AND jsonb_typeof(candidates) = 'array')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_location_queue
  ON location_match_queue (tenant_id, kind, COALESCE(depth, 0), parent_key, raw_key);
CREATE INDEX IF NOT EXISTS idx_location_queue_status ON location_match_queue (tenant_id, status);

-- Résultats canoniques à côté des valeurs brutes.
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS admin_area_id uuid REFERENCES admin_areas(id) ON DELETE SET NULL, -- unité la plus fine reconnue
  ADD COLUMN IF NOT EXISTS adm1_pcode text,
  ADD COLUMN IF NOT EXISTS adm4_pcode text,
  ADD COLUMN IF NOT EXISTS geo_status text;
ALTER TABLE monitoring_submissions
  ADD COLUMN IF NOT EXISTS adm3_pcode text,
  ADD COLUMN IF NOT EXISTS field_office_id uuid REFERENCES field_offices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS geo_status text;
ALTER TABLE pdd_distributions
  ADD COLUMN IF NOT EXISTS adm1_pcode text,
  ADD COLUMN IF NOT EXISTS adm2_pcode text,
  ADD COLUMN IF NOT EXISTS adm3_pcode text,
  ADD COLUMN IF NOT EXISTS admin_area_id uuid REFERENCES admin_areas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS field_office_id uuid REFERENCES field_offices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES partners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS geo_status text;
ALTER TABLE field_office_communes
  ADD COLUMN IF NOT EXISTS adm3_pcode text,
  ADD COLUMN IF NOT EXISTS admin_area_id uuid REFERENCES admin_areas(id) ON DELETE SET NULL;
ALTER TABLE contract_areas ADD COLUMN IF NOT EXISTS pcode text;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sites', 'monitoring_submissions', 'pdd_distributions'] LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_geo_status_check');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (mems_geo_status_ok(geo_status))', t, t || '_geo_status_check');
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_sites_admin_area ON sites (tenant_id, admin_area_id);
CREATE INDEX IF NOT EXISTS idx_submissions_adm3_pcode ON monitoring_submissions (tenant_id, adm3_pcode);
CREATE INDEX IF NOT EXISTS idx_pdd_adm3_pcode ON pdd_distributions (tenant_id, adm3_pcode);
CREATE INDEX IF NOT EXISTS idx_office_communes_area ON field_office_communes (tenant_id, admin_area_id);

ALTER TABLE location_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_match_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON location_aliases;
DROP POLICY IF EXISTS tenant_isolation ON location_match_queue;
CREATE POLICY tenant_isolation ON location_aliases USING (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation ON location_match_queue USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON location_aliases TO mems2_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON location_match_queue TO mems2_app;

-- Nouvelles références entre tables du compte : contrôle « même compte » (migration 049).
SELECT mems_install_same_tenant(t)
  FROM unnest(ARRAY['location_aliases', 'location_match_queue', 'sites', 'monitoring_submissions',
                    'pdd_distributions', 'field_office_communes']::regclass[]) AS t;
