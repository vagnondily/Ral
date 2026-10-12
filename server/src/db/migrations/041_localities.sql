-- Localités : profil pays, vocabulaire des niveaux, P-code / GPS / lignée des
-- unités administratives — pour un vrai répertoire éditable (CRUD) à l'échelle
-- nationale (≈ 19 000 unités). Additive : aucune donnée existante n'est perdue.

-- (1) Profil du pays du tenant (un pays par tenant/bureau pays).
CREATE TABLE IF NOT EXISTS country_profiles (
  tenant_id   uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  iso3        text CHECK (iso3 IS NULL OR iso3 ~ '^[A-Z]{3}$'),
  currency    text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  center_lat  numeric(9, 6) CHECK (center_lat IS NULL OR center_lat BETWEEN -90 AND 90),
  center_lng  numeric(9, 6) CHECK (center_lng IS NULL OR center_lng BETWEEN -180 AND 180),
  note        text CHECK (note IS NULL OR length(note) <= 500),
  breakdown_source text,                       -- millésime : nom du fichier importé
  breakdown_imported_at timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE country_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON country_profiles;
CREATE POLICY tenant_isolation ON country_profiles USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON country_profiles TO mems2_app;

-- (2) Vocabulaire des niveaux : code de schéma (adm0…adm4) + pluriel.
ALTER TABLE admin_levels ADD COLUMN IF NOT EXISTS code text CHECK (code IS NULL OR code ~ '^adm[0-9]$');
ALTER TABLE admin_levels ADD COLUMN IF NOT EXISTS label_plural text;
-- Libellés hérités d'un import défectueux (nom de colonne « ADM1_PCODE ») →
-- libellé neutre lisible, le code de schéma est conservé à part.
UPDATE admin_levels SET code = lower(substring(label FROM '(?i)^(adm[0-9])')) WHERE code IS NULL AND label ~* '^adm[0-9]';
UPDATE admin_levels SET code = 'adm' || depth WHERE code IS NULL AND depth BETWEEN 0 AND 9;
UPDATE admin_levels SET label = CASE code WHEN 'adm0' THEN 'Pays' WHEN 'adm1' THEN 'Région' WHEN 'adm2' THEN 'District'
                                          WHEN 'adm3' THEN 'Commune' WHEN 'adm4' THEN 'Fokontany' ELSE label END
 WHERE label ~* '^adm[0-9]_';
UPDATE admin_levels SET label_plural = CASE WHEN label ~ '[sxz]$' THEN label ELSE label || 's' END WHERE label_plural IS NULL;

-- (3) Unités : P-code, centroïde GPS, lignée (ids des ancêtres, pour filtrer
-- « toute la descendance de X » via un index GIN), date de modification.
ALTER TABLE admin_areas ADD COLUMN IF NOT EXISTS pcode text;
ALTER TABLE admin_areas ADD COLUMN IF NOT EXISTS lat numeric(9, 6) CHECK (lat IS NULL OR lat BETWEEN -90 AND 90);
ALTER TABLE admin_areas ADD COLUMN IF NOT EXISTS lng numeric(9, 6) CHECK (lng IS NULL OR lng BETWEEN -180 AND 180);
ALTER TABLE admin_areas ADD COLUMN IF NOT EXISTS lineage uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE admin_areas ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Lignée des unités existantes (récursif, une seule requête).
WITH RECURSIVE t AS (
  SELECT id, ARRAY[]::uuid[] AS lineage FROM admin_areas WHERE parent_id IS NULL
  UNION ALL
  SELECT a.id, t.lineage || a.parent_id FROM admin_areas a JOIN t ON a.parent_id = t.id
)
UPDATE admin_areas a SET lineage = t.lineage FROM t WHERE a.id = t.id AND a.lineage = '{}' AND t.lineage <> '{}';

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_areas_pcode ON admin_areas (tenant_id, pcode) WHERE pcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_admin_areas_lineage ON admin_areas USING gin (lineage);
CREATE INDEX IF NOT EXISTS idx_admin_areas_name ON admin_areas (tenant_id, depth, lower(name) text_pattern_ops);
