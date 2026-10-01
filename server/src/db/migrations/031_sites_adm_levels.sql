-- Toujours porter le découpage administratif complet sur les sites/localités :
-- adm1 (région) · adm2 (district) · adm3 (commune) · adm4 (fokontany).
-- Les colonnes district/commune/fokontany restent (compatibilité) et sont la
-- source de backfill.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS adm1 text;  -- Région
ALTER TABLE sites ADD COLUMN IF NOT EXISTS adm2 text;  -- District
ALTER TABLE sites ADD COLUMN IF NOT EXISTS adm3 text;  -- Commune
ALTER TABLE sites ADD COLUMN IF NOT EXISTS adm4 text;  -- Fokontany

UPDATE sites SET
  adm2 = COALESCE(adm2, district),
  adm3 = COALESCE(adm3, commune),
  adm4 = COALESCE(adm4, fokontany)
WHERE adm2 IS NULL OR adm3 IS NULL OR adm4 IS NULL;

CREATE INDEX IF NOT EXISTS idx_sites_adm ON sites (tenant_id, adm1, adm2, adm3);
