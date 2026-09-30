-- MEMS 2.0 — (1) référentiel du découpage administratif PAR TENANT (pays),
-- importé depuis un shapefile/.dbf dans Paramétrage ; (2) zones affectées au
-- prestataire dans le contrat, choisies dans ce référentiel (listes déroulantes
-- en cascade — pas de saisie libre) ; (3) postes de dépense des rapports
-- financiers (état des dépenses fidèle à la facture TPM).

-- (1a) Libellés des niveaux administratifs, ordonnés (ex. 1 Région, 2 District,
-- 3 Commune…). Propre à chaque tenant/pays.
CREATE TABLE admin_levels (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  depth      integer NOT NULL,          -- 1 = niveau le plus haut
  label      text NOT NULL,
  PRIMARY KEY (tenant_id, depth)
);
ALTER TABLE admin_levels ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON admin_levels USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON admin_levels TO mems2_app;

-- (1b) Découpage administratif hiérarchique (adjacence parent → enfant).
CREATE TABLE admin_areas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  depth       integer NOT NULL,                       -- niveau (cf. admin_levels)
  name        text NOT NULL,
  parent_id   uuid REFERENCES admin_areas(id) ON DELETE CASCADE,
  path        text NOT NULL,                          -- « Région > District > … »
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_admin_areas_tenant_depth ON admin_areas (tenant_id, depth);
CREATE INDEX idx_admin_areas_parent ON admin_areas (parent_id);
ALTER TABLE admin_areas ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON admin_areas USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON admin_areas TO mems2_app;

-- (2) Zones du contrat : chaque ligne référence un nœud du découpage.
CREATE TABLE contract_areas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contract_id    uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  admin_area_id  uuid REFERENCES admin_areas(id) ON DELETE SET NULL,
  path           text NOT NULL,                        -- chemin dénormalisé (affichage/export)
  depth          integer NOT NULL DEFAULT 0,
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_contract_areas_contract ON contract_areas (contract_id);
ALTER TABLE contract_areas ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON contract_areas USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON contract_areas TO mems2_app;

-- (3) Postes de dépense d'un rapport financier (état des dépenses).
CREATE TABLE contract_report_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  report_id    uuid NOT NULL REFERENCES tpm_reports(id) ON DELETE CASCADE,
  line_code    text NOT NULL,                       -- ligne budgétaire FLA (budgetCatalog)
  designation  text NOT NULL,
  unit         text,
  unit_count   numeric(16, 4) NOT NULL DEFAULT 0 CHECK (unit_count >= 0),
  unit_cost    numeric(16, 2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  pay_by       text NOT NULL DEFAULT 'bailleur' CHECK (pay_by IN ('bailleur', 'ong')),
  site         text,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_report_items_report ON contract_report_items (report_id);
ALTER TABLE contract_report_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON contract_report_items USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON contract_report_items TO mems2_app;

-- La facture porte une période et un numéro ; avance déductible.
ALTER TABLE tpm_reports ADD COLUMN period_end date;
ALTER TABLE tpm_reports ADD COLUMN invoice_no text;
ALTER TABLE tpm_reports ADD COLUMN advance_deducted numeric(16, 2) NOT NULL DEFAULT 0;
