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
 * « Soumettre » fait passer un rapport à « soumis ».
 *
 * Séparation des tâches (mêmes règles en base, migration 058) :
 *  - le contenu (état des dépenses) ne se modifie qu'en brouillon (« attendu »
 *    ou « rejeté ») : un rapport soumis est figé pendant la décision, la
 *    personne qui valide voit exactement ce qu'elle valide ;
 *  - seul l'AUTEUR d'un rapport (la personne qui l'a rempli : `editedBy`) le
 *    modifie et le soumet ; un gabarit mensuel encore vierge (sans auteur) est
 *    pris en charge par la première personne qui le remplit ;
 *  - la personne qui décide (valider / rejeter) n'est ni le soumetteur ni
 *    l'auteur du contenu.
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
/** Statuts « brouillon » où le contenu se modifie : exactement ceux qui se soumettent. */
const EDITABLE = SUBMITTABLE;

const STATUS_LABEL = Object.freeze({
  attendu: 'attendu', soumis: 'soumis', valide: 'validé', rejete: 'rejeté', non_applicable: 'non applicable',
});
const label = (status) => STATUS_LABEL[status] || String(status);

/** Vrai si le passage `from` → `to` est autorisé. */
function canTransition(from, to) {
  return Object.prototype.hasOwnProperty.call(TRANSITIONS, from) && TRANSITIONS[from].includes(to);
}

/**
 * Auteur du contenu d'un rapport : la personne qui l'a rempli (`editedBy`).
 * `null` pour un gabarit mensuel encore vierge, que personne n'a rempli.
 */
function authorOf(report) {
  return report.editedBy || null;
}

/** L'acteur est-il l'auteur (ou le rapport est-il encore sans auteur) ? */
function isAuthorOrUnclaimed(report, actorId) {
  const author = authorOf(report);
  return !author || author === actorId;
}

const NOT_AUTHOR = 'Seul l\'auteur de ce rapport (la personne qui l\'a rempli) peut le modifier ou le soumettre.';

/**
 * Peut-on modifier l'état des dépenses (postes, n° de facture, avance) ?
 * Seulement en brouillon (« attendu » / « rejeté ») et par son auteur.
 * @param {{ status: string, editedBy?: string|null }} report
 * @param {string} actorId
 * @returns {null | { code: 'locked' | 'author', message: string }}
 */
function editError(report, actorId) {
  if (!EDITABLE.includes(report.status)) {
    const message = {
      soumis: 'Ce rapport est soumis : il est figé pendant la décision du validateur. S\'il doit être corrigé, le validateur le rejette (avec un motif) et son auteur le reprend.',
      valide: 'Un rapport validé ne peut plus être modifié.',
      non_applicable: 'Un rapport non applicable ne porte pas d\'état des dépenses.',
    }[report.status] || `Ce rapport ne peut pas être modifié (statut actuel : ${label(report.status)}).`;
    return { code: 'locked', message };
  }
  if (!isAuthorOrUnclaimed(report, actorId)) return { code: 'author', message: NOT_AUTHOR };
  return null;
}

/** Soumission : transition permise et acteur auteur (sans la règle « facture vide »). */
function submitTransitionError(report, actorId) {
  if (!canTransition(report.status, 'soumis')) {
    return {
      code: 'status',
      message: report.status === 'soumis'
        ? 'Ce rapport est déjà soumis : il attend la décision du validateur.'
        : `Seul un rapport attendu ou rejeté peut être soumis (statut actuel : ${label(report.status)}).`,
    };
  }
  if (!isAuthorOrUnclaimed(report, actorId)) return { code: 'author', message: NOT_AUTHOR };
  return null;
}

/**
 * Peut-on soumettre ce rapport ? Seul un rapport « attendu » ou « rejeté », par
 * son auteur ; une facture (rapport financier) doit porter un état des dépenses
 * (au moins un poste) ou un montant justifié.
 * @param {{ status: string, kind: string, editedBy?: string|null, itemCount?: number, reportedAmount?: number|null }} report
 * @param {string} actorId
 * @returns {null | { code: 'status' | 'author' | 'empty', message: string }}
 */
function submitError(report, actorId) {
  const err = submitTransitionError(report, actorId);
  if (err) return err;
  if (report.kind === 'financier' && !(Number(report.itemCount) > 0) && !(Number(report.reportedAmount) > 0)) {
    return { code: 'empty', message: 'Remplissez l\'état des dépenses (au moins un poste) avant de soumettre la facture.' };
  }
  return null;
}

/**
 * Peut-on valider / rejeter ce rapport ? Seul un rapport « soumis », et jamais
 * par la personne qui l'a soumis ni par celle qui en a rempli le contenu (à
 * défaut de soumetteur ou d'auteur connu : la personne qui a créé le rapport).
 * @param {{ status: string, createdBy?: string, submittedBy?: string|null, editedBy?: string|null }} report
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
  const author = report.editedBy || report.createdBy;
  if (author && author === actorId) {
    return { code: 'self', message: 'Séparation des tâches : un rapport ne peut pas être validé ou rejeté par la personne qui en a rempli l\'état des dépenses.' };
  }
  return null;
}

/** « Non applicable » : permis depuis tout statut sauf « valide ». */
function notApplicableError(report) {
  if (canTransition(report.status, 'non_applicable')) return null;
  return { code: 'locked', message: 'Un rapport validé ne peut pas être marqué non applicable.' };
}

/**
 * Actions permises à un utilisateur sur un rapport, calculées par les MÊMES
 * règles que celles qui s'appliquent à l'écriture : l'écran n'offre que ce que
 * le serveur acceptera (ni bouton « Valider » sur son propre rapport, ni
 * facture soumise éditable), et le Centre d'alertes ne compte « à valider »
 * que ce que l'utilisateur peut réellement décider.
 * `submit` ignore la règle « facture vide » : l'écran enregistre puis soumet.
 * @param {{ status: string, kind: string, createdBy?: string, submittedBy?: string|null, editedBy?: string|null }} report
 * @param {{ userId: string, canWrite: boolean }} actor  canWrite = rôle admin ou gestionnaire
 */
function reportActions(report, { userId, canWrite, isAdmin = false }) {
  // Seule une facture porte un état des dépenses éditable.
  const editErr = report.kind === 'financier' ? editError(report, userId) : { code: 'kind', message: null };
  const decideErr = decisionError(report, userId);
  return {
    edit: Boolean(canWrite) && !editErr,
    submit: Boolean(canWrite) && !submitTransitionError(report, userId),
    decide: Boolean(canWrite) && !decideErr,
    notApplicable: Boolean(canWrite) && !notApplicableError(report),
    // Suppression (retour 56) : un rapport validé, par un administrateur
    // seulement, et s'il n'a aucun montant compté (le serveur revérifie).
    remove: Boolean(canWrite) && (report.status !== 'valide'
      || (Boolean(isAdmin) && Number(report.reportedAmount || 0) === 0)),
    // Pourquoi une action attendue est indisponible (aide affichée à l'écran).
    editReason: canWrite && editErr && editErr.code !== 'kind' ? editErr.message : null,
    decideReason: canWrite && decideErr && decideErr.code === 'self' ? decideErr.message : null,
  };
}

/**
 * Rôles qui écrivent les rapports (remplir, soumettre, décider) : UNE liste,
 * partagée par les routes (requireRole) et le Centre d'alertes (« à valider »
 * ne compte que ce que l'utilisateur peut décider).
 */
const REPORT_WRITE_ROLES = Object.freeze(['admin', 'manager']);

/** Le rôle de session écrit-il les rapports ? */
const canWriteReports = (role) => REPORT_WRITE_ROLES.includes(role);

module.exports = {
  TRANSITIONS, STATUSES, DECIDABLE, SUBMITTABLE, EDITABLE, REPORT_WRITE_ROLES,
  canTransition, authorOf, editError, submitError, decisionError, notApplicableError, reportActions, canWriteReports,
};
