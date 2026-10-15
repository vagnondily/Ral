-- MEMS 2.0 — Identifiant professionnel des sites (retour n° 64). Migration 073.
--
-- « Les clés utilisées dans MEMS sont enfantines » (PLAN-0001, L001) : chaque
-- site reçoit un identifiant affiché court, alphanumérique et non devinable,
-- « S-7K3F-9Q2X » : 8 symboles Crockford base 32 (sans I, L, O, U) tirés au
-- hasard, uniques par compte et IMMUABLES. L'UUID interne reste la clé
-- technique (jamais montré) ; les anciens codes restent dans leurs colonnes et
-- restent reconnus à l'import. Règles pures : server/src/modules/common/publicId.js.
--
-- Hasard : octets d'un UUID v4 (gen_random_uuid, fourni par PostgreSQL), sans
-- extension supplémentaire ; 32^8 ≈ 1,1 × 10^12 valeurs.

CREATE OR REPLACE FUNCTION mems_site_public_id() RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  b bytea := uuid_send(gen_random_uuid());
  s text := '';
  i int;
BEGIN
  FOR i IN 0..7 LOOP
    s := s || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
  END LOOP;
  RETURN 'S-' || substr(s, 1, 4) || '-' || substr(s, 5, 4);
END;
$$;

ALTER TABLE sites ADD COLUMN IF NOT EXISTS public_id text;

-- Sites existants : un identifiant chacun, tirages répétés tant qu'il reste un doublon dans un compte.
DO $$
DECLARE dup int;
BEGIN
  UPDATE sites SET public_id = mems_site_public_id() WHERE public_id IS NULL;
  LOOP
    WITH d AS (
      SELECT id FROM (
        SELECT id, row_number() OVER (PARTITION BY tenant_id, public_id ORDER BY id) AS rn FROM sites
      ) x WHERE rn > 1)
    UPDATE sites s SET public_id = mems_site_public_id() FROM d WHERE s.id = d.id;
    GET DIAGNOSTICS dup = ROW_COUNT;
    EXIT WHEN dup = 0;
  END LOOP;
END $$;

ALTER TABLE sites ALTER COLUMN public_id SET DEFAULT mems_site_public_id();
ALTER TABLE sites ALTER COLUMN public_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sites_public_id ON sites (tenant_id, public_id);
ALTER TABLE sites DROP CONSTRAINT IF EXISTS sites_public_id_format;
ALTER TABLE sites ADD CONSTRAINT sites_public_id_format
  CHECK (public_id ~ '^S-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$');

-- Immuable : un identifiant donné ne change jamais (classeurs hors ligne, rapports, échanges).
CREATE OR REPLACE FUNCTION mems_site_public_id_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.public_id IS DISTINCT FROM OLD.public_id THEN
    RAISE EXCEPTION 'L''identifiant d''un site (%) ne change jamais.', OLD.public_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_site_public_id_immutable ON sites;
CREATE TRIGGER trg_site_public_id_immutable BEFORE UPDATE OF public_id ON sites
  FOR EACH ROW EXECUTE FUNCTION mems_site_public_id_immutable();
