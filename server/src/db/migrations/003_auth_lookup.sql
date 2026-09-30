-- Login happens before we know the caller's tenant, so the ordinary
-- RLS-protected `users` table cannot be queried directly by the restricted
-- mems2_app role (RLS has no tenant_id to compare against yet, so every row
-- would be hidden). This SECURITY DEFINER function is the one narrow,
-- explicit exception: it runs with the privileges of its owner (the
-- migration superuser, who — like any table owner — is exempt from RLS),
-- and only ever returns the single row matching the given email.
CREATE OR REPLACE FUNCTION auth_lookup_user(p_email citext)
RETURNS TABLE (id uuid, tenant_id uuid, password_hash text, role text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, tenant_id, password_hash, role FROM users WHERE email = p_email;
$$;

GRANT EXECUTE ON FUNCTION auth_lookup_user(citext) TO mems2_app;
