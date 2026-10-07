-- Liaison « données réelles → site » par pcode de commune.
-- Les soumissions de suivi (monitoring_submissions) sont géocodées par pcode
-- (code admin), sans identifiant de site : au mieux la commune (adm3). Pour
-- relier ces données au référentiel de sites (qui est nommé, pas codé), on
-- stocke le pcode de district (adm2) et de commune (adm3) sur chaque site.
-- La dernière collecte réelle d'un site = la soumission la plus récente dont
-- le pcode de commune correspond (granularité commune — ce que la donnée
-- permet réellement). Aucun référentiel dupliqué : on enrichit `sites`.

ALTER TABLE sites ADD COLUMN IF NOT EXISTS adm2_pcode text;  -- code district
ALTER TABLE sites ADD COLUMN IF NOT EXISTS adm3_pcode text;  -- code commune

-- On filtre/joint sur le pcode de commune pour rattacher les soumissions.
CREATE INDEX IF NOT EXISTS idx_sites_adm3_pcode ON sites (tenant_id, adm3_pcode);
-- Et sur le pcode de commune des soumissions (adm3) pour la jointure inverse.
CREATE INDEX IF NOT EXISTS idx_mon_sub_admin3 ON monitoring_submissions (tenant_id, admin3);
