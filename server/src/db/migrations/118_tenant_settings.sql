-- Options du compte (réglages par tenant). Première option : « modification libre par
-- l'administrateur » (admin_free_edit) — quand elle est activée, un administrateur peut modifier
-- des éléments déjà VALIDÉS/verrouillés (p. ex. le budget d'un contrat actif, aujourd'hui modifiable
-- seulement via un avenant). Désactivée par défaut : la fiabilité / l'audit restent la règle. Chaque
-- modification faite sous ce pouvoir reste tracée dans l'historique du document concerné.
CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id       uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  admin_free_edit boolean NOT NULL DEFAULT false,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_settings;
CREATE POLICY tenant_isolation ON tenant_settings USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_settings TO mems2_app;
