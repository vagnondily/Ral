-- Identifiant de localité L### attribué par la BASE à toute création de site
-- (quel que soit l'écrivain : écran, import, seed) via un compteur par tenant
-- verrouillé en ligne (sûr en concurrence) ; l'index unique reste le garde-fou.
-- Rattrapage : les sites existants reçoivent un ID stable (ordre district,
-- commune, nom) — indispensable à l'aller-retour Excel du plan de suivi.
CREATE TABLE IF NOT EXISTS site_location_counters (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  last_no   integer NOT NULL DEFAULT 0 CHECK (last_no >= 0)
);
ALTER TABLE site_location_counters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON site_location_counters;
CREATE POLICY tenant_isolation ON site_location_counters USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE ON site_location_counters TO mems2_app;

-- Rattrapage des sites sans ID.
WITH base AS (
  SELECT tenant_id, COALESCE(max(NULLIF(substring(location_id FROM 2), '')::int), 0) AS mx FROM sites GROUP BY tenant_id
), numbered AS (
  SELECT s.id, s.tenant_id, b.mx + row_number() OVER (PARTITION BY s.tenant_id ORDER BY s.district, s.commune, s.name, s.id) AS n
    FROM sites s JOIN base b ON b.tenant_id = s.tenant_id WHERE s.location_id IS NULL
)
-- Au moins 3 chiffres sans jamais tronquer (lpad seul couperait 1000 en 100).
UPDATE sites s SET location_id = 'L' || (CASE WHEN n < 1000 THEN lpad(n::text, 3, '0') ELSE n::text END) FROM numbered x WHERE s.id = x.id;

INSERT INTO site_location_counters (tenant_id, last_no)
SELECT tenant_id, COALESCE(max(NULLIF(substring(location_id FROM 2), '')::int), 0) FROM sites GROUP BY tenant_id
ON CONFLICT (tenant_id) DO UPDATE SET last_no = GREATEST(site_location_counters.last_no, EXCLUDED.last_no);

CREATE OR REPLACE FUNCTION sites_assign_location_id() RETURNS trigger AS $$
DECLARE n integer;
BEGIN
  IF NEW.location_id IS NULL THEN
    INSERT INTO site_location_counters (tenant_id, last_no) VALUES (NEW.tenant_id, 1)
    ON CONFLICT (tenant_id) DO UPDATE SET last_no = site_location_counters.last_no + 1
    RETURNING last_no INTO n;
    NEW.location_id := 'L' || (CASE WHEN n < 1000 THEN lpad(n::text, 3, '0') ELSE n::text END);
  ELSE
    -- ID fourni (import) : le compteur ne redescend jamais sous un ID existant.
    INSERT INTO site_location_counters (tenant_id, last_no) VALUES (NEW.tenant_id, COALESCE(NULLIF(substring(NEW.location_id FROM 2), '')::int, 0))
    ON CONFLICT (tenant_id) DO UPDATE SET last_no = GREATEST(site_location_counters.last_no, EXCLUDED.last_no);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sites_location_id ON sites;
CREATE TRIGGER trg_sites_location_id BEFORE INSERT ON sites FOR EACH ROW EXECUTE FUNCTION sites_assign_location_id();
