-- MEMS 2.0 — RBM : tout site doit porter un niveau de risque. Les sites créés
-- par l'import du planning n'en avaient pas (NULL), ce qui faussait le RBM.
-- On fixe un défaut « moyenne » et on rétro-remplit les NULL existants.
UPDATE sites SET risk_level = 'moyenne' WHERE risk_level IS NULL;
ALTER TABLE sites ALTER COLUMN risk_level SET DEFAULT 'moyenne';
