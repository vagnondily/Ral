-- MEMS 2.0 — Sous-activités (retour n° 92). Migration 101.
--
-- « La liste des activités devrait être configurée dans la configuration, où on
--   a activités > sous-activité (activity_tag) > information. »
--
-- Chaque activité (table `activities`, migration 005) peut porter plusieurs
-- SOUS-ACTIVITÉS. Le `code` d'une sous-activité est l'« activity_tag » : c'est
-- lui qu'un site porte dans `sites.tag_code` (migration 066) — la sous-activité
-- décrit donc le tag, avec une « information » libre (notes / définition).
--
-- L'UUID interne reste la clé technique. `code` est unique par compte (un tag
-- renvoie à une seule sous-activité) pour que `sites.tag_code` s'y rattache sans
-- ambiguïté. Référentiel : une sous-activité utilisée par des sites ne se
-- supprime pas, elle se désactive (garde côté application).

CREATE TABLE sub_activities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  code        text NOT NULL,          -- « activity_tag » (ex. GD, MAM, SMP…)
  label       text NOT NULL,
  info        text,                    -- information libre (définition, notes)
  sort_order  int  NOT NULL DEFAULT 0,
  active       boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX idx_sub_activities_activity ON sub_activities (tenant_id, activity_id);

ALTER TABLE sub_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sub_activities
  USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON sub_activities TO mems2_app;

-- La référence activity_id → activities passe aussi le contrôle « même compte » (049).
SELECT mems_install_same_tenant('sub_activities');
