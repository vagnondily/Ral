-- MEMS 2.0 — Suivi de processus : données réelles de suivi (Kobo / CSV / SAV)
-- et indicateurs paramétrables reliés à ces données.
--
-- Trois briques :
--   1) monitoring_forms       — un formulaire / module de suivi (GD, MIARO, SMP…)
--   2) monitoring_indicators  — un indicateur du dashboard, RELIÉ à un champ du
--                               formulaire + un mode d'agrégation (le « mapping »
--                               paramétrable demandé)
--   3) monitoring_submissions — les soumissions réelles (1 visite = 1 ligne),
--                               réponses brutes en JSONB, quel que soit l'import
--
-- Multitenant : tenant_id + RLS sur chaque table, comme le reste de l'app.

CREATE TABLE monitoring_forms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code        text NOT NULL,                 -- ex. 'GD_PREVMA', 'MIARO', 'SMP'
  label       text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
ALTER TABLE monitoring_forms ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON monitoring_forms USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON monitoring_forms TO mems2_app;

-- Un indicateur : quel champ du formulaire, agrégé comment.
CREATE TABLE monitoring_indicators (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  form_id      uuid NOT NULL REFERENCES monitoring_forms(id) ON DELETE CASCADE,
  code         text NOT NULL,
  label        text NOT NULL,
  module       text,                          -- regroupement d'affichage (ex. « CFM »)
  source_field text NOT NULL,                 -- nom du champ dans la soumission
  agg          text NOT NULL DEFAULT 'percent_yes'
               CHECK (agg IN ('percent_yes', 'mean', 'sum', 'count', 'percent_value')),
  positive_value text,                        -- valeur « oui » pour percent_yes / percent_value
  target       numeric(12, 4),                -- cible / seuil (optionnel)
  direction    text NOT NULL DEFAULT 'higher_better' CHECK (direction IN ('higher_better', 'lower_better')),
  sort_order   integer NOT NULL DEFAULT 0,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (form_id, code)
);
CREATE INDEX idx_mon_indicators_form ON monitoring_indicators (tenant_id, form_id);
ALTER TABLE monitoring_indicators ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON monitoring_indicators USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON monitoring_indicators TO mems2_app;

-- Les soumissions réelles. Les réponses brutes sont en JSONB — indépendant de
-- la source (CSV, XLSX Kobo, API Kobo v2, SAV) : chaque importeur remplit `data`.
CREATE TABLE monitoring_submissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  form_id       uuid NOT NULL REFERENCES monitoring_forms(id) ON DELETE CASCADE,
  external_id   text,                         -- identifiant Kobo (_uuid) pour la dé-duplication
  period_month  date,                         -- 1er du mois de la visite
  submitted_at  timestamptz,
  field_office  text,
  admin1        text,
  admin2        text,
  admin3        text,
  admin4        text,
  site          text,
  partner       text,
  agent         text,
  source        text NOT NULL DEFAULT 'csv' CHECK (source IN ('csv', 'xlsx', 'kobo', 'sav')),
  data          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (form_id, external_id)               -- idempotence de l'import quand _uuid existe
);
CREATE INDEX idx_mon_sub_form_period ON monitoring_submissions (tenant_id, form_id, period_month);
ALTER TABLE monitoring_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON monitoring_submissions USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON monitoring_submissions TO mems2_app;
