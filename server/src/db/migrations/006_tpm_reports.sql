-- MEMS 2.0 — Partenaires & TPM : rapports & dépenses.
-- L'assignation des dépenses se fait ici (et non plus dans le module
-- Contrats) : chaque mois, un partenaire TPM produit des rapports financiers
-- et techniques, rattachés au budget mensuel planifié (ligne « Suivi » de la
-- section IV du contrat) et à faire AVANT le rapportage.
--
-- Les fichiers ne sont pas stockés pour l'instant (métadonnées d'abord) :
-- on conserve le nom et la référence du document, l'upload réel viendra
-- dans une itération ultérieure.

CREATE TABLE tpm_reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  partner_id       uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,     -- partenaire TPM
  contract_id      uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,    -- contrat suivi
  period_month     date NOT NULL CHECK (extract(day FROM period_month) = 1),
  kind             text NOT NULL CHECK (kind IN ('financier', 'technique')),
  -- Financier : montant justifié (la « dépense » assignée) + budget prévu du mois.
  planned_amount   numeric(16, 2) CHECK (planned_amount IS NULL OR planned_amount >= 0),
  reported_amount  numeric(16, 2) CHECK (reported_amount IS NULL OR reported_amount >= 0),
  reference        text,
  -- Métadonnées du document à uploader (le fichier lui-même n'est pas encore stocké).
  document_name    text,
  status           text NOT NULL DEFAULT 'attendu'
                   CHECK (status IN ('attendu', 'soumis', 'valide', 'rejete')),
  comment          text,
  created_by       uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  submitted_at     timestamptz,
  decided_by       uuid REFERENCES users(id),
  decided_at       timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- One financial and one technical report per partner / contract / month.
  UNIQUE (partner_id, contract_id, period_month, kind),
  -- A financial report carries an amount; a technical one does not.
  CHECK (kind <> 'financier' OR reported_amount IS NOT NULL),
  CHECK (kind <> 'technique' OR reported_amount IS NULL)
);
CREATE INDEX idx_tpm_reports_partner ON tpm_reports (tenant_id, partner_id, period_month);
CREATE INDEX idx_tpm_reports_contract ON tpm_reports (contract_id);

ALTER TABLE tpm_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tpm_reports USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON tpm_reports TO mems2_app;
