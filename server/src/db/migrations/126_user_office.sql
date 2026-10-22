-- 126 — Rattachement d'un utilisateur à un bureau (multitenant).
-- Chaque compte appartient déjà à un pays (tenant). On lui ajoute, facultativement, SON bureau de
-- terrain/antenne : utile pour savoir de quel bureau relève un agent S&E et pour filtrer plus tard.
-- Référence entre deux tables du même tenant → déclencheur « même tenant » (migration 049).
ALTER TABLE users ADD COLUMN IF NOT EXISTS field_office_id uuid REFERENCES field_offices(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_field_office ON users (tenant_id, field_office_id);
SELECT mems_install_same_tenant('users');
