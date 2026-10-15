-- MEMS 2.0 — Lot 5, § 6 : paramètres de la planification automatique. Migration 077.
--
-- Regard S&E (retours 107 et 108, SPEC_LOT_5 § 6.4) : le plan part des BESOINS du MMR et
-- en déduit les agents et les véhicules nécessaires. On ne redemande JAMAIS ce que MEMS sait
-- déjà : univers (grille Sites actifs / inactifs), exigence, suivis par jour, jours ouvrés et
-- personnes (mmr_parameters, par bureau et activité : une seule saisie), priorité (RBM),
-- prestataire (contrats). Le compte ne règle que ce qui n'existe nulle part ailleurs : la
-- stratégie (« besoins » ou « capacite »), les agents par véhicule, et les jours de terrain
-- par agent et par mois, utilisés seulement quand le MMR ne les donne pas.
--
-- Une ligne par compte (sans ligne : les valeurs initiales du code s'appliquent,
-- server/src/modules/tpm/planSettings.js DEFAULTS — un test statique compare ces
-- DEFAULT et ces CHECK aux constantes JS).
--
-- Verrou optimiste : `revision` (un PUT avec une révision périmée → 409).
CREATE TABLE IF NOT EXISTS plan_settings (
  tenant_id          uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  strategy             text     NOT NULL DEFAULT 'besoins' CHECK (strategy IN ('besoins', 'capacite')),
  agents_per_vehicle   smallint NOT NULL DEFAULT 4 CHECK (agents_per_vehicle BETWEEN 1 AND 10),
  field_days_per_month smallint NOT NULL DEFAULT 20 CHECK (field_days_per_month BETWEEN 1 AND 26),
  revision             integer  NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE plan_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON plan_settings;
CREATE POLICY tenant_isolation ON plan_settings
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mems2_app') THEN
    GRANT SELECT, INSERT, UPDATE ON plan_settings TO mems2_app;
  END IF;
END $$;
-- updated_by → users : contrôle « même compte » (049).
SELECT mems_install_same_tenant('plan_settings');
