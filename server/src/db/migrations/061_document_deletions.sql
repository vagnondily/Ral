-- MEMS 2.0 — Journal des suppressions de documents (retour n° 56).
--
-- Une politique UNIQUE de suppression des documents (rapports / factures TPM,
-- plans de collecte, contrats et avenants) est désormais appliquée partout —
-- règles pures dans server/src/modules/common/deletionPolicy.js :
--
--   - document NON validé (brouillon, soumis, rejeté…) → supprimable après
--     confirmation, sans justificatif ;
--   - document VALIDÉ → supprimable SEULEMENT sans donnée reliée, AVEC un
--     justificatif obligatoire.
--
-- Chaque suppression de document est inscrite ici : qui (deleted_by), quand
-- (deleted_at), pourquoi (justification), et un résumé lisible (doc_ref +
-- summary) pour garder une trace même après disparition du document.
--
-- Le concepteur de rapport (report_documents) n'est pas couvert ici : il est
-- aligné séparément avec le lot 7a.
--
-- Journal APPEND-ONLY : mems2_app n'a que SELECT, INSERT (aucune modification
-- ni suppression d'une ligne de journal). Les règles de la politique sont le
-- filet de sécurité en base : justificatif non vide si validé (CHECK).

CREATE TABLE document_deletions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Type de document supprimé. Même liste que deletionPolicy.DOCUMENT_TYPES.
  doc_type            text NOT NULL CHECK (doc_type IN
                        ('tpm_report', 'collection_plan', 'contract', 'contract_amendment')),
  -- Id du document supprimé. Pas de clé étrangère : le document n'existe plus.
  doc_id              uuid NOT NULL,
  -- Référence lisible (n° de facture, mois, prestataire, intitulé du contrat…).
  doc_ref             text,
  -- Résumé du document au moment de la suppression (texte ou JSON compact ≤ 4 Ko).
  summary             text CHECK (summary IS NULL OR length(summary) <= 4096),
  -- Statut métier au moment de la suppression, et si le document était validé.
  status_at_deletion  text NOT NULL,
  validated           boolean NOT NULL,
  -- Justificatif : obligatoire (non vide) pour un document validé, libre sinon.
  justification       text CHECK (justification IS NULL OR length(justification) <= 1000),
  deleted_by          uuid NOT NULL REFERENCES users(id),
  deleted_at          timestamptz NOT NULL DEFAULT now(),
  -- Filet de sécurité de la règle « validé → justificatif obligatoire ».
  CONSTRAINT document_deletions_justif_if_validated
    CHECK (NOT validated OR (justification IS NOT NULL AND length(trim(justification)) > 0))
);

CREATE INDEX idx_document_deletions_tenant_time
  ON document_deletions (tenant_id, deleted_at DESC);
CREATE INDEX idx_document_deletions_doc
  ON document_deletions (tenant_id, doc_type, doc_id);

ALTER TABLE document_deletions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document_deletions
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- Append-only : lecture et insertion seulement. mems2_app reçoit déjà
-- SELECT/INSERT/UPDATE/DELETE par ALTER DEFAULT PRIVILEGES (migrations 002/012) ;
-- on RÉVOQUE donc UPDATE et DELETE pour qu'aucune ligne de journal ne puisse
-- être modifiée ni effacée par l'application. (La purge en cascade d'un tenant
-- s'exécute comme propriétaire de la table, pas comme mems2_app : non affectée.)
GRANT SELECT, INSERT ON document_deletions TO mems2_app;
REVOKE UPDATE, DELETE ON document_deletions FROM mems2_app;

-- La référence deleted_by → users passe aussi le contrôle « même compte » (049).
SELECT mems_install_same_tenant('document_deletions');
