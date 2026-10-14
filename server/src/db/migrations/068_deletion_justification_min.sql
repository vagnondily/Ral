-- MEMS 2.0 — Justificatif d'au moins 10 caractères pour supprimer un document
-- validé (revue du retour n° 56). Migration 068.
--
-- La règle vit dans server/src/modules/common/deletionPolicy.js
-- (MIN_JUSTIFICATION = 10, compté en caractères comme length() ici) ; la base
-- en est le filet de sécurité. NOT VALID : les lignes déjà inscrites au journal
-- (append-only, jamais modifiées) restent telles quelles ; toute nouvelle
-- suppression d'un document validé est contrôlée.

ALTER TABLE document_deletions
  ADD CONSTRAINT document_deletions_justif_min_if_validated
  CHECK (NOT validated OR length(btrim(justification)) >= 10) NOT VALID;
