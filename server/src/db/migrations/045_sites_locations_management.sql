-- Registre des sites fidèle à la feuille « Locations Management » du classeur
-- RBM (plan de suivi) et à ses échelles (Sheet4). Additive ; l'ancienne
-- sécurité « 2 = élevée » est convertie en « 3 = restriction stricte ».

-- Échelles des critères.
ALTER TABLE sites DROP CONSTRAINT IF EXISTS sites_security_situation_check;
UPDATE sites SET security_situation = 3 WHERE security_situation = 2;
ALTER TABLE sites ADD CONSTRAINT sites_security_situation_check CHECK (security_situation IN (0, 1, 3, 99));
ALTER TABLE sites DROP CONSTRAINT IF EXISTS sites_fraud_suspected_check;
ALTER TABLE sites ADD CONSTRAINT sites_fraud_suspected_check CHECK (fraud_suspected BETWEEN 0 AND 2);

-- Champs de la feuille.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS location_id text CHECK (location_id IS NULL OR location_id ~ '^L[0-9]{3,6}$');
ALTER TABLE sites ADD COLUMN IF NOT EXISTS poi_subtype text CHECK (poi_subtype IS NULL OR length(poi_subtype) <= 80);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS urban_area text CHECK (urban_area IS NULL OR length(urban_area) <= 120);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS modality_type text
  CHECK (modality_type IS NULL OR modality_type IN ('Cash', 'Voucher', 'Food', 'Capacity Strengthening', 'Mix'));
ALTER TABLE sites ADD COLUMN IF NOT EXISTS beneficiary_number integer CHECK (beneficiary_number IS NULL OR beneficiary_number >= 0);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS experienced_partner smallint NOT NULL DEFAULT 0 CHECK (experienced_partner BETWEEN 0 AND 2);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS last_visit_date date;   -- historique antérieur à MEMS (saisi / importé)
CREATE UNIQUE INDEX IF NOT EXISTS uq_sites_location_id ON sites (tenant_id, location_id) WHERE location_id IS NOT NULL;

-- Statut mensuel Active/Inactive par exercice (grille AL:AW du classeur).
-- Vide = non renseigné ; le statut courant = dernier mois renseigné (calculé).
CREATE TABLE IF NOT EXISTS site_month_status (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id    uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  year       integer NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  month      smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
  active     boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, year, month)
);
CREATE INDEX IF NOT EXISTS idx_site_month_status_tenant ON site_month_status (tenant_id, year);
ALTER TABLE site_month_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON site_month_status;
CREATE POLICY tenant_isolation ON site_month_status USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON site_month_status TO mems2_app;
