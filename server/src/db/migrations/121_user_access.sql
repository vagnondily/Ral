-- Auto-inscription (comptes à valider) + restrictions d'accès par écran, par personne.
--   status       — 'active' (par défaut), 'pending' (auto-inscrit, en attente de validation admin).
--   page_access  — NULL = aucune restriction (voit tout ce que son rôle permet) ;
--                  tableau JSON de clés d'écran (modules du menu) = voit SEULEMENT ces écrans
--                  (intersection avec les droits du rôle ; Paramétrage reste réservé aux admins).
--   approved_by / approved_at — traçabilité de la validation d'un compte auto-inscrit.
-- Un compte 'pending' ne peut pas se connecter (auth bloque) : il ne voit RIEN tant qu'un
-- administrateur ne l'a pas validé et ne lui a pas attribué un rôle.

ALTER TABLE users ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'pending'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS page_access jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- page_access, quand il est fourni, est un tableau JSON (de chaînes).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_page_access_is_array;
ALTER TABLE users ADD CONSTRAINT users_page_access_is_array
  CHECK (page_access IS NULL OR jsonb_typeof(page_access) = 'array');

-- auth_lookup_user renvoie aussi `status` : la connexion refuse un compte 'pending'
-- (auto-inscrit, pas encore validé) comme elle refuse déjà un compte désactivé.
DROP FUNCTION IF EXISTS auth_lookup_user(citext);
CREATE FUNCTION auth_lookup_user(p_email citext)
RETURNS TABLE (id uuid, tenant_id uuid, password_hash text, role text, active boolean, full_name text, status text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, tenant_id, password_hash, role, active, full_name, status FROM users WHERE email = p_email;
$$;
GRANT EXECUTE ON FUNCTION auth_lookup_user(citext) TO mems2_app;
