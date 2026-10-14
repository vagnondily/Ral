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
 *         par un ADMINISTRATEUR, et AVEC un justificatif d'au moins
 *         MIN_JUSTIFICATION caractères ;
 *   - quel que soit le statut, un document dont la suppression détruirait
 *     (cascade) ou orphelinerait (clé étrangère) d'AUTRES documents
 *     (`dependents`, ex. les rapports et plans d'un contrat) n'est pas
 *     supprimable ;
 *   - toute suppression de document est inscrite au journal des suppressions
 *     (fait par l'appelant, dans la même transaction).
 *
 * Les RÉFÉRENTIELS (sites, agents, partenaires, bureaux…) ne passent pas par
 * cette politique : porteurs de données, ils se DÉSACTIVENT (inchangé).
 *
 * Ce module ne fait pas d'I/O : l'appelant lui fournit `validated`,
 * `hasLinkedData` (calculés par le dépôt selon le type) et le `justification`
 * saisi, et reçoit une décision. Les mêmes règles sont le filet de sécurité en
 * base (migration 065 : CHECK justificatif non vide si validé ; migration 068 :
 * au moins 10 caractères ; journal append-only). Codes de refus → HTTP
 * (`refusalStatus`) : 'linked_data' → 409, 'admin_required' → 403,
 * 'justification_required' → 400.
 */

const MAX_JUSTIFICATION = 1000;
/** Longueur minimale (en caractères, après nettoyage) du justificatif d'un document validé. */
const MIN_JUSTIFICATION = 10;

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

/**
 * Justificatif nettoyé (coupé à MAX_JUSTIFICATION caractères), ou chaîne vide.
 * Compté en caractères Unicode, comme `length()` en SQL : un emoji compte 1.
 */
function cleanJustification(justification) {
  if (typeof justification !== 'string') return '';
  return [...justification.trim()].slice(0, MAX_JUSTIFICATION).join('').trim();
}

/** Nombre de caractères Unicode (= `length()` PostgreSQL). */
const charCount = (s) => [...s].length;

/**
 * Décide si un document peut être supprimé.
 * @param {object} p
 * @param {boolean} p.validated       le document est-il validé ?
 * @param {boolean} [p.hasLinkedData] porte-t-il une donnée reliée ? (compte pour un validé seulement)
 * @param {boolean} [p.dependents]    sa suppression détruirait-elle d'autres documents ? (tout statut)
 * @param {boolean} [p.isAdmin]       l'auteur de la demande est-il administrateur ?
 * @param {string}  [p.justification] justificatif saisi
 * @returns {{ allowed: boolean, requireJustification: boolean,
 *            reason: null | 'linked_data' | 'admin_required' | 'justification_required',
 *            justification: string }}
 */
function decideDocumentDeletion({ validated, hasLinkedData = false, dependents = false, isAdmin = false, justification } = {}) {
  const just = cleanJustification(justification);
  const refuse = (reason) => ({ allowed: false, requireJustification: Boolean(validated), reason, justification: just });

  // D'autres documents en dépendent : jamais supprimable, quel que soit le statut.
  if (dependents) return refuse('linked_data');

  // Non validé : supprimable sans justificatif. La notion de « donnée reliée »
  // ne s'applique pas (un document non validé n'alimente aucun cumul).
  if (!validated) {
    return { allowed: true, requireJustification: false, reason: null, justification: just };
  }

  // Validé + donnée reliée : jamais supprimable (le justificatif n'y change rien).
  if (hasLinkedData) return refuse('linked_data');

  // Validé sans donnée reliée : réservé à l'administrateur…
  if (!isAdmin) return refuse('admin_required');

  // … et avec un vrai justificatif.
  if (charCount(just) < MIN_JUSTIFICATION) return refuse('justification_required');

  return { allowed: true, requireJustification: true, reason: null, justification: just };
}

/**
 * Libellés des données reliées (singulier, pluriel), par clé. Source unique
 * pour le message du serveur ; l'écran traduit les mêmes clés.
 */
const LINKED_LABELS = Object.freeze({
  reports: ['rapport', 'rapports'],
  factures: ['facture', 'factures'],
  plans: ['plan de collecte', 'plans de collecte'],
  amendments: ['avenant', 'avenants'],
  renewals: ['renouvellement', 'renouvellements'],
  visits: ['visite de terrain', 'visites de terrain'],
  items: ['poste de dépense', 'postes de dépense'],
  booked: ['montant compté dans la consolidation', 'montants comptés dans la consolidation'],
  applied: ['modification appliquée au contrat', 'modifications appliquées au contrat'],
});

/**
 * Données reliées, à partir de comptes par clé : seules les clés connues et
 * non nulles, dans l'ordre de LINKED_LABELS.
 * @param {Record<string, number>} counts  ex. { reports: 2, plans: 0 }
 * @returns {{ key: string, count: number, label: string }[]}
 */
function linkedSummary(counts = {}) {
  const out = [];
  for (const [key, [one, many]] of Object.entries(LINKED_LABELS)) {
    const n = Math.max(0, Math.trunc(Number(counts?.[key]) || 0));
    if (n > 0) out.push({ key, count: n, label: n === 1 ? one : many });
  }
  return out;
}

/** Données reliées qui se nomment sans compte (il n'y en a qu'une). */
const UNCOUNTED = new Set(['booked', 'applied']);

/** « 2 rapports, 1 plan de collecte » (chaîne vide si rien). */
function linkedText(list = []) {
  return list.map((l) => (UNCOUNTED.has(l.key) ? l.label : `${l.count} ${l.label}`)).join(', ');
}

/** Statut HTTP d'un code de refus. */
function refusalStatus(reason) {
  switch (reason) {
    case 'linked_data': return 409;
    case 'admin_required': return 403;
    default: return 400;
  }
}

/**
 * Message FR d'un refus.
 * @param {string} reason
 * @param {object} [o]
 * @param {string} [o.subject]  « ce contrat », « ce plan »… (défaut « ce document »)
 * @param {{count:number,label:string}[]} [o.linked]  données reliées à nommer
 * @param {string} [o.hint]     conseil ajouté au refus « donnée reliée »
 */
function refusalMessage(reason, { subject = 'ce document', linked = [], hint = '' } = {}) {
  const Subject = subject.charAt(0).toUpperCase() + subject.slice(1);
  switch (reason) {
    case 'linked_data': {
      const text = linkedText(linked);
      const what = text ? `des données reliées (${text})` : 'des données reliées';
      return `${Subject} porte ${what} : suppression impossible.${hint ? ` ${hint}` : ''}`;
    }
    case 'admin_required':
      return 'Seul un administrateur peut supprimer un document validé.';
    case 'justification_required':
      return `Un justificatif d'au moins ${MIN_JUSTIFICATION} caractères est obligatoire pour supprimer un document validé.`;
    default:
      return 'Suppression refusée.';
  }
}

/** Détails joints au refus (lus par l'écran pour un message traduit). */
function refusalDetails(reason, linked = []) {
  return reason === 'justification_required'
    ? { reason, min: MIN_JUSTIFICATION }
    : { reason, linked };
}

module.exports = {
  MAX_JUSTIFICATION,
  MIN_JUSTIFICATION,
  DOCUMENT_TYPES,
  VALIDATED_STATUSES,
  LINKED_LABELS,
  isValidatedStatus,
  cleanJustification,
  decideDocumentDeletion,
  linkedSummary,
  linkedText,
  refusalStatus,
  refusalMessage,
  refusalDetails,
};
