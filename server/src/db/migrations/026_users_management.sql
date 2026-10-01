-- Gestion des utilisateurs & accès (Paramétrage › Sécurité). On enrichit la
-- table users (nom, actif, horodatage) et on étend auth_lookup_user pour
-- renvoyer aussi `active` : un compte désactivé ne peut plus se connecter.
ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name  text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS active     boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Le type de retour change → il faut DROP avant de recréer (CREATE OR REPLACE
-- ne peut pas modifier la signature de sortie).
DROP FUNCTION IF EXISTS auth_lookup_user(citext);
CREATE FUNCTION auth_lookup_user(p_email citext)
RETURNS TABLE (id uuid, tenant_id uuid, password_hash text, role text, active boolean, full_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, tenant_id, password_hash, role, active, full_name FROM users WHERE email = p_email;
$$;

GRANT EXECUTE ON FUNCTION auth_lookup_user(citext) TO mems2_app;
