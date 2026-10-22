-- Lien d'activation à l'inscription. L'auto-inscription ne demande plus de mot de passe :
-- l'administrateur valide le compte, puis communique un LIEN D'ACTIVATION (aucun e-mail
-- n'étant configuré) ; la personne définit son mot de passe via ce lien avant sa première
-- connexion. Jusque-là, password_hash porte un marqueur inutilisable ('!') : la connexion échoue.
ALTER TABLE users ADD COLUMN IF NOT EXISTS activation_token   text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS activation_expires timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS users_activation_token_key ON users (activation_token) WHERE activation_token IS NOT NULL;

-- Recherche par jeton d'activation, hors contexte de tenant (comme la connexion) : fonction
-- SECURITY DEFINER dédiée (le tenant n'est pas connu avant de résoudre le jeton).
DROP FUNCTION IF EXISTS auth_activation_lookup(text);
CREATE FUNCTION auth_activation_lookup(p_token text)
RETURNS TABLE (id uuid, tenant_id uuid, status text, active boolean, expires timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, tenant_id, status, active, activation_expires FROM users WHERE activation_token = p_token;
$$;
GRANT EXECUTE ON FUNCTION auth_activation_lookup(text) TO mems2_app;

-- auth_lookup_user renvoie aussi si une activation est en attente (jeton encore présent),
-- pour afficher « compte pas encore activé » plutôt que « identifiants incorrects ».
DROP FUNCTION IF EXISTS auth_lookup_user(citext);
CREATE FUNCTION auth_lookup_user(p_email citext)
RETURNS TABLE (id uuid, tenant_id uuid, password_hash text, role text, active boolean, full_name text, status text, activation_pending boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, tenant_id, password_hash, role, active, full_name, status, (activation_token IS NOT NULL) AS activation_pending
    FROM users WHERE email = p_email;
$$;
GRANT EXECUTE ON FUNCTION auth_lookup_user(citext) TO mems2_app;
