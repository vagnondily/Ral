-- MEMS 2.0 — Journal des changements d'activité des sites (retour n° 64). Migration 072.
--
-- La grille « Sites (actifs / inactifs) » (feuille « Site Actif » du classeur
-- d'activation) dit, pour chaque site et chaque mois de l'exercice, s'il est
-- actif (Oui), inactif (Non) ou non renseigné. L'état courant reste dans
-- site_month_status (migration 045). Ce journal garde CHAQUE changement : qui,
-- quand, quel mois, avant → après, d'où (écran ou import) et le « Motif du
-- changement » (facultatif, « mais relu longtemps après »).
--
-- APPEND-ONLY : mems2_app n'a que SELECT et INSERT.

CREATE TABLE IF NOT EXISTS site_activation_changes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id     uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  year        integer NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  month       smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
  -- Avant → après : true = actif, false = inactif, NULL = non renseigné.
  before      boolean,
  after       boolean,
  reason      text CHECK (reason IS NULL OR length(reason) <= 500),
  source      text NOT NULL CHECK (source IN ('ecran', 'import')),
  changed_by  uuid NOT NULL REFERENCES users(id),
  changed_at  timestamptz NOT NULL DEFAULT now(),
  -- Un changement change quelque chose.
  CONSTRAINT site_activation_changes_changes CHECK (before IS DISTINCT FROM after)
);

CREATE INDEX IF NOT EXISTS idx_site_activation_changes_site
  ON site_activation_changes (tenant_id, site_id, year, changed_at DESC);

ALTER TABLE site_activation_changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON site_activation_changes;
CREATE POLICY tenant_isolation ON site_activation_changes
  USING (tenant_id::text = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT ON site_activation_changes TO mems2_app;
REVOKE UPDATE, DELETE ON site_activation_changes FROM mems2_app;

-- Les références site_id et changed_by passent le contrôle « même compte » (049).
SELECT mems_install_same_tenant('site_activation_changes');
