/**
 * Règles PURES du cycle de vie d'un rapport TPM (facture ou rapport technique).
 *
 * Machine d'états explicite (aucune autre transition n'est possible) :
 *
 *   attendu ──Soumettre──▶ soumis ──Valider──▶ valide   (définitif)
 *   rejete  ──Soumettre──▶ soumis ──Rejeter──▶ rejete
 *   tout statut sauf « valide » ──Non applicable──▶ non_applicable
 *
 * Enregistrer l'état des dépenses ne change jamais le statut : seule l'action
 * « Soumettre » fait passer un rapport à « soumis ». Séparation des tâches :
 * la personne qui a soumis un rapport ne le valide ni ne le rejette.
 */
const TRANSITIONS = Object.freeze({
  attendu: Object.freeze(['soumis', 'non_applicable']),
  soumis: Object.freeze(['valide', 'rejete', 'non_applicable']),
  rejete: Object.freeze(['soumis', 'non_applicable']),
  // « Non applicable » se ré-applique (commentaire mis à jour), comme avant.
  non_applicable: Object.freeze(['non_applicable']),
  valide: Object.freeze([]),
});
const STATUSES = Object.freeze(Object.keys(TRANSITIONS));
const DECIDABLE = 'soumis';
/** Statuts depuis lesquels « Soumettre » est permis. */
const SUBMITTABLE = Object.freeze(STATUSES.filter((s) => TRANSITIONS[s].includes('soumis')));

const STATUS_LABEL = Object.freeze({
  attendu: 'attendu', soumis: 'soumis', valide: 'validé', rejete: 'rejeté', non_applicable: 'non applicable',
});
const label = (status) => STATUS_LABEL[status] || String(status);

/** Vrai si le passage `from` → `to` est autorisé. */
function canTransition(from, to) {
  return Object.prototype.hasOwnProperty.call(TRANSITIONS, from) && TRANSITIONS[from].includes(to);
}

/**
 * Peut-on soumettre ce rapport ? Seul un rapport « attendu » ou « rejeté » se
 * soumet ; une facture (rapport financier) doit porter un état des dépenses
 * (au moins un poste) ou un montant justifié.
 * @param {{ status: string, kind: string, itemCount?: number, reportedAmount?: number|null }} report
 * @returns {null | { code: 'status' | 'empty', message: string }}
 */
function submitError(report) {
  if (!canTransition(report.status, 'soumis')) {
    return {
      code: 'status',
      message: report.status === 'soumis'
        ? 'Ce rapport est déjà soumis : il attend la décision du validateur.'
        : `Seul un rapport attendu ou rejeté peut être soumis (statut actuel : ${label(report.status)}).`,
    };
  }
  if (report.kind === 'financier' && !(Number(report.itemCount) > 0) && !(Number(report.reportedAmount) > 0)) {
    return { code: 'empty', message: 'Remplissez l\'état des dépenses (au moins un poste) avant de soumettre la facture.' };
  }
  return null;
}

/**
 * Peut-on valider / rejeter ce rapport ? Seul un rapport « soumis », et jamais
 * par la personne qui l'a soumis (à défaut de soumetteur connu : son auteur).
 * @param {{ status: string, createdBy?: string, submittedBy?: string|null }} report
 * @param {string} actorId  utilisateur qui décide
 * @returns {null | { code: 'status' | 'self', message: string }}
 */
function decisionError(report, actorId) {
  if (report.status !== DECIDABLE) {
    return { code: 'status', message: `Seul un rapport soumis peut être validé ou rejeté (statut actuel : ${label(report.status)}).` };
  }
  const submitter = report.submittedBy || report.createdBy;
  if (submitter && submitter === actorId) {
    return { code: 'self', message: 'Séparation des tâches : un rapport ne peut pas être validé ou rejeté par la personne qui l\'a soumis.' };
  }
  return null;
}

/** « Non applicable » : permis depuis tout statut sauf « valide ». */
function notApplicableError(report) {
  if (canTransition(report.status, 'non_applicable')) return null;
  return { code: 'locked', message: 'Un rapport validé ne peut pas être marqué non applicable.' };
}

module.exports = {
  TRANSITIONS, STATUSES, DECIDABLE, SUBMITTABLE,
  canTransition, submitError, decisionError, notApplicableError,
};
