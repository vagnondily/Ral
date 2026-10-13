/**
 * Règles PURES du cycle de vie du « Mapping MEMS » d'une fiche (quelle colonne
 * du formulaire alimente chaque dimension MEMS) — demande de l'utilisateur :
 * « mettre auto, en icône : modifier, reseter si validé ou soumis, soumettre, valider ».
 *
 *   brouillon ──Soumettre──▶ soumis ──Valider──▶ valide
 *   soumis / valide ──Réinitialiser──▶ brouillon
 *
 *  - le mapping ne se modifie (colonne choisie, retour à « Automatique ») qu'en
 *    brouillon : un mapping soumis attend la décision sur exactement ce qui a
 *    été soumis, un mapping validé est la référence ;
 *  - séparation des tâches (comme les contrats et les rapports) : la personne
 *    qui valide n'est pas celle qui a soumis ;
 *  - « Appliquer aux soumissions » reste permis à tout statut : il relit les
 *    données avec le mapping en vigueur, sans le modifier.
 * Mêmes règles en base (migration 060). Statut → HTTP : 'status' → 409, 'self' → 403.
 */
const TRANSITIONS = Object.freeze({
  brouillon: Object.freeze(['soumis']),
  soumis: Object.freeze(['valide', 'brouillon']),
  valide: Object.freeze(['brouillon']),
});
const STATUSES = Object.freeze(Object.keys(TRANSITIONS));
/** Statuts où le mapping se modifie. */
const EDITABLE = Object.freeze(['brouillon']);
/** Action → statut d'arrivée. */
const ACTIONS = Object.freeze({ submit: 'soumis', validate: 'valide', reset: 'brouillon' });

const STATUS_LABEL = Object.freeze({ brouillon: 'brouillon', soumis: 'soumis', valide: 'validé' });
const label = (status) => STATUS_LABEL[status] || String(status);

function canTransition(from, to) {
  return Object.prototype.hasOwnProperty.call(TRANSITIONS, from) && TRANSITIONS[from].includes(to);
}

/**
 * Peut-on modifier une dimension du mapping ?
 * @param {{ status: string }} state
 * @returns {null | { code: 'status', message: string }}
 */
function editError(state) {
  if (EDITABLE.includes(state.status)) return null;
  return {
    code: 'status',
    message: state.status === 'soumis'
      ? 'Mapping soumis : il est figé pendant la validation. Réinitialisez-le (retour en brouillon) pour le modifier.'
      : `Mapping ${label(state.status)} : réinitialisez-le (retour en brouillon) pour le modifier.`,
  };
}

/**
 * Erreur d'une action du cycle de vie (null si permise).
 * @param {'submit'|'validate'|'reset'} action
 * @param {{ status: string, submittedBy?: string|null }} state
 * @param {string} actorId
 * @returns {null | { code: 'status'|'self'|'action', message: string }}
 */
function transitionError(action, state, actorId) {
  if (!Object.prototype.hasOwnProperty.call(ACTIONS, action)) return { code: 'action', message: `Action inconnue : ${action}.` };
  if (!canTransition(state.status, ACTIONS[action])) {
    const message = {
      submit: state.status === 'soumis' ? 'Ce mapping est déjà soumis : il attend sa validation.' : 'Un mapping validé ne se soumet pas : réinitialisez-le d\'abord.',
      validate: `Seul un mapping soumis peut être validé (statut actuel : ${label(state.status)}).`,
      reset: 'Ce mapping est déjà en brouillon.',
    }[action];
    return { code: 'status', message };
  }
  if (action === 'validate' && state.submittedBy && state.submittedBy === actorId) {
    return { code: 'self', message: 'Séparation des tâches : le mapping est validé par une autre personne que celle qui l\'a soumis.' };
  }
  return null;
}

/**
 * Actions offertes à un utilisateur, calculées par les MÊMES règles que l'écriture :
 * l'écran n'affiche que ce que le serveur acceptera.
 * @param {{ status: string, submittedBy?: string|null }} state
 * @param {{ userId: string, canWrite: boolean }} actor  canWrite = rôle admin ou gestionnaire
 */
function mappingActions(state, { userId, canWrite }) {
  const w = Boolean(canWrite);
  const validateErr = transitionError('validate', state, userId);
  return {
    edit: w && !editError(state),
    submit: w && !transitionError('submit', state, userId),
    validate: w && !validateErr,
    reset: w && !transitionError('reset', state, userId),
    apply: w,
    validateReason: w && validateErr && validateErr.code === 'self' ? validateErr.message : null,
  };
}

/** Champs à écrire pour passer au statut de l'action (auteurs et horodatages du cycle en cours). */
function transitionPatch(action, actorId, now = new Date()) {
  if (action === 'submit') return { status: 'soumis', submittedBy: actorId, submittedAt: now, validatedBy: null, validatedAt: null };
  if (action === 'validate') return { status: 'valide', validatedBy: actorId, validatedAt: now };
  return { status: 'brouillon', submittedBy: null, submittedAt: null, validatedBy: null, validatedAt: null };
}

module.exports = {
  TRANSITIONS, STATUSES, EDITABLE, ACTIONS, canTransition, editError, transitionError, mappingActions, transitionPatch,
};
