-- MMR : « un seul plan général, modifiable par bureau ». Le plan général a
-- field_office_id = NULL (il vaut pour tous les bureaux) ; une ligne avec un
-- bureau est une dérogation (override) qui prime pour ce bureau. On remplace la
-- contrainte UNIQUE (qui ne couvre pas les NULL) par deux index uniques
-- partiels : un par catégorie pour le plan général, un par bureau × catégorie.
ALTER TABLE mmr_parameters ALTER COLUMN field_office_id DROP NOT NULL;

ALTER TABLE mmr_parameters DROP CONSTRAINT IF EXISTS mmr_parameters_tenant_id_field_office_id_activity_category_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mmr_general
  ON mmr_parameters (tenant_id, activity_category)
  WHERE field_office_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mmr_office
  ON mmr_parameters (tenant_id, field_office_id, activity_category)
  WHERE field_office_id IS NOT NULL;
