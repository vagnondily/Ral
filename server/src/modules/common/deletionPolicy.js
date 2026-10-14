/**
 * Politique PURE et commune de suppression des DOCUMENTS (retour n° 56).
 *
 * Règle unique, appliquée partout (rapports / factures TPM, plans de collecte,
 * contrats et avenants, …) :
 *
 *   - document NON validé (brouillon, soumis, rejeté, attendu, non applicable)
 *       → supprimable après simple confirmation, sans justificatif ;
 *   - document VALIDÉ
 *       → supprimable SEULEMENT s'il ne porte AUCUNE donnée reliée,
 *         et AVEC un justificatif obligatoire ;
 *   - toute suppression de document est inscrite au journal des suppressions
 *     (fait par l'appelant, dans la même transaction).
 *
 * Les RÉFÉRENTIELS (sites, agents, partenaires, bureaux…) ne passent pas par
 * cette politique : porteurs de données, ils se DÉSACTIVENT (inchangé).
 *
 * Ce module ne fait pas d'I/O : l'appelant lui fournit `validated`,
 * `hasLinkedData` (calculés par le dépôt selon le type) et le `justification`
 * saisi, et reçoit une décision. Les mêmes règles sont le filet de sécurité en
 * base (migration 061 : CHECK justificatif non vide si validé ; journal
 * append-only). Codes de refus → HTTP : 'linked_data' → 409,
 * 'justification_required' → 400.
 */

const MAX_JUSTIFICATION = 1000;

/**
 * Types de documents couverts par la politique commune. Le concepteur de
 * rapport (report_documents) est aligné séparément avec le lot 7a.
 */
const DOCUMENT_TYPES = Object.freeze([
  'tpm_report',
  'collection_plan',
  'contract',
  'contract_amendment',
]);

/**
 * Statuts qui comptent comme « validé » par type. Source unique : le dépôt et
 * la base s'y réfèrent, aucune 2ᵉ règle ailleurs.
 */
const VALIDATED_STATUSES = Object.freeze({
  tpm_report: Object.freeze(['valide']),
  collection_plan: Object.freeze(['valide']),
  contract: Object.freeze(['actif', 'resilie']),
  contract_amendment: Object.freeze(['approuve']),
});

/**
 * Un statut donné correspond-il à un document « validé » ?
 * @param {string} docType  l'un de DOCUMENT_TYPES
 * @param {string} status   statut métier du document
 * @returns {boolean}
 */
function isValidatedStatus(docType, status) {
  const list = VALIDATED_STATUSES[docType];
  if (!list) throw new Error(`type de document inconnu : ${docType}`);
  return list.includes(status);
}

/** Justificatif nettoyé (coupé à MAX_JUSTIFICATION), ou chaîne vide. */
function cleanJustification(justification) {
  if (typeof justification !== 'string') return '';
  return justification.trim().slice(0, MAX_JUSTIFICATION);
}

/**
 * Décide si un document peut être supprimé.
 * @param {object} p
 * @param {boolean} p.validated       le document est-il validé ?
 * @param {boolean} [p.hasLinkedData] porte-t-il une donnée reliée ? (validé seul)
 * @param {string}  [p.justification] justificatif saisi
 * @returns {{ allowed: boolean, requireJustification: boolean,
 *            reason: null | 'linked_data' | 'justification_required',
 *            justification: string }}
 */
function decideDocumentDeletion({ validated, hasLinkedData = false, justification } = {}) {
  const just = cleanJustification(justification);

  // Non validé : supprimable sans justificatif. La notion de « donnée reliée »
  // ne s'applique pas (un document non validé n'alimente aucun cumul).
  if (!validated) {
    return { allowed: true, requireJustification: false, reason: null, justification: just };
  }

  // Validé + donnée reliée : jamais supprimable (le justificatif n'y change rien).
  if (hasLinkedData) {
    return { allowed: false, requireJustification: true, reason: 'linked_data', justification: just };
  }

  // Validé sans donnée reliée : il faut un justificatif.
  if (!just) {
    return { allowed: false, requireJustification: true, reason: 'justification_required', justification: just };
  }

  return { allowed: true, requireJustification: true, reason: null, justification: just };
}

/** Message FR par code de refus (pour l'API / l'écran). */
function refusalMessage(reason) {
  switch (reason) {
    case 'linked_data':
      return 'Ce document est validé et porte des données reliées : il ne peut pas être supprimé.';
    case 'justification_required':
      return 'Un justificatif est obligatoire pour supprimer un document validé.';
    default:
      return 'Suppression refusée.';
  }
}

module.exports = {
  MAX_JUSTIFICATION,
  DOCUMENT_TYPES,
  VALIDATED_STATUSES,
  isValidatedStatus,
  cleanJustification,
  decideDocumentDeletion,
  refusalMessage,
};
