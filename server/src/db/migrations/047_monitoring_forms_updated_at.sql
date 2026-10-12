-- La mise à jour d'une fiche (réimport d'un XLSForm, édition) horodate updated_at,
-- mais la colonne n'existait pas : tout réimport d'un XLSForm existant échouait (500).
ALTER TABLE monitoring_forms ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
