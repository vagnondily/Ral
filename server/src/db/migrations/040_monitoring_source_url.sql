-- Connecteur « lien de données » (ONA / MoDA / tout export web) : URL
-- configurable par fiche, réimportable sans réécrire le lien. L'import va
-- chercher le fichier/flux à l'URL (CSV / XLSX / JSON) côté serveur et le
-- passe au même pipeline que l'import de fichier.
ALTER TABLE monitoring_forms ADD COLUMN IF NOT EXISTS source_url text;
