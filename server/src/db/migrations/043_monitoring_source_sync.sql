-- Connecteurs « lien de données » : nature du lien mémorisé (ona-open-data |
-- kobo-api | file), curseur du rafraîchissement incrémental (plus grand _id
-- déjà importé, filtre gt_id d'Ona) et date de la dernière synchronisation.
-- Aucun secret n'est stocké (les tokens restent saisis à chaque import).
ALTER TABLE monitoring_forms ADD COLUMN IF NOT EXISTS source_kind text
  CHECK (source_kind IS NULL OR source_kind IN ('ona-open-data', 'kobo-api', 'file'));
ALTER TABLE monitoring_forms ADD COLUMN IF NOT EXISTS source_cursor bigint CHECK (source_cursor IS NULL OR source_cursor >= 0);
ALTER TABLE monitoring_forms ADD COLUMN IF NOT EXISTS source_synced_at timestamptz;

-- Provenance des soumissions : ajoute « ona » (API open-data Ona/MoDA, lien WDC).
ALTER TABLE monitoring_submissions DROP CONSTRAINT IF EXISTS monitoring_submissions_source_check;
ALTER TABLE monitoring_submissions ADD CONSTRAINT monitoring_submissions_source_check
  CHECK (source IN ('csv', 'xlsx', 'kobo', 'sav', 'ona'));
