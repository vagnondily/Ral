-- Concepteur de rapport : modèles personnalisés et documents enregistrés.
-- Le contenu (blocs, texte riche en JSON structuré) est validé par le schéma
-- applicatif (reportModel) ; la base garantit l'isolation, les tailles et
-- l'unicité des noms. Un document FINALISÉ fige ses données (snapshot) : il ne
-- change plus quand les données évoluent (traçabilité).
CREATE TABLE IF NOT EXISTS report_templates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  description  text CHECK (description IS NULL OR length(description) <= 500),
  content      jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object' AND octet_length(content::text) <= 1000000),
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_templates_name ON report_templates (tenant_id, lower(name));

CREATE TABLE IF NOT EXISTS report_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title        text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  template_key text,                                 -- modèle d'origine (système : clé ; perso : uuid)
  period_from  date NOT NULL,
  period_to    date NOT NULL CHECK (period_to >= period_from),
  content      jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object' AND octet_length(content::text) <= 1000000),
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final')),
  snapshot     jsonb,                                -- données figées à la finalisation
  version      integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by   uuid,
  updated_by   uuid,
  finalized_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'final') = (snapshot IS NOT NULL AND finalized_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_report_documents_tenant ON report_documents (tenant_id, updated_at DESC);

ALTER TABLE report_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON report_templates;
DROP POLICY IF EXISTS tenant_isolation ON report_documents;
CREATE POLICY tenant_isolation ON report_templates USING (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation ON report_documents USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON report_templates, report_documents TO mems2_app;

-- Rattachement d'une fiche de suivi à une catégorie d'activité du référentiel
-- de sites (même vocabulaire que sites.activity / MMR) : permet « sites visités
-- ÷ sites actifs » et la complétude par activité.
ALTER TABLE monitoring_forms ADD COLUMN IF NOT EXISTS activity_category text CHECK (activity_category IS NULL OR length(activity_category) <= 160);
