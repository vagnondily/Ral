-- 127 — Projets (première version — retours 65, 93 ; conception complète : docs/SPEC_PROGRAMMES.md).
-- Un projet = intervention datée, financée, avec un cadre logique. Infos de base + cadre logique
-- (chaîne de résultats) + besoins. Tout reste dans le bureau pays (tenant), RLS comme ailleurs.

CREATE TABLE projects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          text NOT NULL,
  code          text,                 -- code projet / WBS (facultatif), unique par compte s'il est donné
  grant_number  text,                 -- n° de grant (interne)
  award_number  text,                 -- n° d'award (du bailleur)
  donor_code    text,
  donor_name    text,
  regions       text,                 -- information géographique (v1 : libellés de zones, texte)
  start_date    date,
  end_date      date,
  status        text NOT NULL DEFAULT 'en_cours'
                CHECK (status IN ('en_cours', 'suspendu', 'termine', 'abandonne')),
  budget_amount bigint,               -- montant du financement en centimes (facultatif)
  currency      text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  description   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
CREATE UNIQUE INDEX uq_projects_code ON projects (tenant_id, code) WHERE code IS NOT NULL;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON projects USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON projects TO mems2_app;

-- Cadre logique : chaîne de résultats (impact → effet → produit → activité), arbre par parent_id.
CREATE TABLE project_logframe (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id     uuid REFERENCES project_logframe(id) ON DELETE CASCADE,
  level         text NOT NULL CHECK (level IN ('impact', 'outcome', 'output', 'activity')),
  statement     text NOT NULL,
  indicator     text,
  baseline      text,
  target        text,
  means_of_verification text,
  assumptions   text,
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_logframe_project ON project_logframe (tenant_id, project_id, sort_order);
ALTER TABLE project_logframe ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON project_logframe USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON project_logframe TO mems2_app;

-- Besoins : analyse des besoins du projet (zone, population cible, priorité).
CREATE TABLE project_needs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title         text NOT NULL,
  description   text,
  zone          text,
  target_population int CHECK (target_population IS NULL OR target_population >= 0),
  priority      text CHECK (priority IS NULL OR priority IN ('haute', 'moyenne', 'basse')),
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_needs_project ON project_needs (tenant_id, project_id, sort_order);
ALTER TABLE project_needs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON project_needs USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON project_needs TO mems2_app;

-- Références entre tables du même compte (049).
SELECT mems_install_same_tenant('project_logframe');
SELECT mems_install_same_tenant('project_needs');
