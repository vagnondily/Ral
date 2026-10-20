const repo = require('./evaluation.repository');
const { buildGrid, applyRatings, checkValidation, checkSeen, freeze, preview, agentScoresForPeriod, RuleError } = require('./providerEvaluation');
const { weightsOf } = require('./gridScore');
const { badRequest, conflict, forbidden, notFound } = require('../../middleware/errors');

/**
 * Évaluations (lot 8) — règles de gestion. Les routes appellent ce service ; il appelle le
 * dépôt (SQL) et les modules purs (gridScore, providerEvaluation, agentScore).
 */

/** Erreur de règle pure → erreur HTTP (statusCode) au bord. */
function httpError(err) {
  if (!(err instanceof RuleError)) return err;
  if (err.code === 'duty') return forbidden(err.message);
  if (err.code === 'validated' || err.code === 'stale') return conflict(err.message, { code: err.code });
  return badRequest(err.message, err.missing ? { code: err.code, missing: err.missing } : { code: err.code });
}
async function rules(fn) {
  try { return await fn(); } catch (err) { throw httpError(err); }
}

/**
 * Notes des agents d'un prestataire sur une période (retour 28.3) : la note du TPM en reprend la
 * moyenne. Lecture : evaluation.repository.agentEvaluations ; sélection pure :
 * providerEvaluation.agentScoresForPeriod (les anciennes évaluations /20 comptent).
 */
async function providerAgentScores(tenantId, partnerId, period) {
  return agentScoresForPeriod(await repo.agentEvaluations(tenantId, partnerId, period));
}

async function listProviderEvaluations(tenantId, partnerId) {
  const rows = await repo.listProviderEvaluations(tenantId, partnerId);
  if (!rows) throw notFound('Partenaire introuvable');
  return rows;
}

/** Une évaluation avec, pour un brouillon, l'aperçu des notes (calcul du serveur, rien d'enregistré). */
async function getProviderEvaluation(tenantId, partnerId, id) {
  const e = await repo.getProviderEvaluation(tenantId, partnerId, id);
  if (!e) throw notFound('Évaluation introuvable');
  if (e.status === 'brouillon') {
    const settings = await repo.getSettings(tenantId);
    const agents = await providerAgentScores(tenantId, partnerId, { from: e.periodFrom, to: e.periodTo });
    e.preview = preview(e, { agents, settings });
  }
  return e;
}

async function createProviderEvaluation(tenantId, partnerId, input, userId) {
  const e = await rules(() => repo.createProviderEvaluation(tenantId, partnerId, input, userId, (criteria) => buildGrid(criteria, input.ratings)));
  if (!e) throw notFound('Partenaire introuvable');
  return e;
}

async function updateProviderEvaluation(tenantId, partnerId, id, input, userId) {
  const e = await rules(() => repo.updateProviderEvaluation(tenantId, partnerId, id, (current) => {
    const header = {
      periodFrom: input.periodFrom ?? current.periodFrom, periodTo: input.periodTo ?? current.periodTo,
      evaluatedOn: input.evaluatedOn ?? current.evaluatedOn, comment: input.comment !== undefined ? input.comment : current.comment,
    };
    if (header.periodTo < header.periodFrom) throw new RuleError('period', 'La fin de la période précède son début.');
    return { header, ...applyRatings(current, input.ratings || [], userId) };
  }));
  if (!e) throw notFound('Évaluation introuvable');
  return e;
}

/**
 * Validation, en UNE transaction sous le verrou de l'évaluation : la version validée doit être
 * celle que le valideur a vue (`seenUpdatedAt`, renvoyé par l'écran ; sinon 409 « rechargez ») ;
 * puis état, séparation des tâches, grille complète ; les notes des agents de la période sont lues
 * sur la MÊME connexion, puis tout est figé.
 */
async function validateProviderEvaluation(tenantId, partnerId, id, userId, seenUpdatedAt) {
  const e = await rules(() => repo.validateProviderEvaluation(tenantId, partnerId, id, async (current, { client, settings }) => {
    if (current.status === 'brouillon') checkSeen(current, seenUpdatedAt);
    checkValidation(current, userId);
    const agents = agentScoresForPeriod(await repo.agentEvaluationsTx(client, tenantId, partnerId, { from: current.periodFrom, to: current.periodTo }));
    return freeze(current, { agents, settings, userId });
  }));
  if (!e) throw notFound('Évaluation introuvable');
  return e;
}

/** Supprimer un brouillon : son évaluateur, ou un administrateur ; jamais une évaluation validée. */
async function deleteProviderEvaluation(tenantId, partnerId, id, actor = {}) {
  const r = await repo.deleteProviderEvaluation(tenantId, partnerId, id,
    (row) => actor.role === 'admin' || (actor.userId && row.evaluatedBy === actor.userId));
  if (r === 'not_found') throw notFound('Évaluation introuvable');
  if (r === 'validated') throw conflict('Évaluation validée : elle ne peut plus être supprimée.');
  if (r === 'forbidden') throw forbidden('Seul son évaluateur, ou un administrateur, supprime un brouillon d\'évaluation.');
}

async function settings(tenantId) {
  return { ...weightsOf(await repo.getSettings(tenantId)) };
}

module.exports = {
  httpError,
  listProviderEvaluations, getProviderEvaluation, createProviderEvaluation, updateProviderEvaluation,
  validateProviderEvaluation, deleteProviderEvaluation, settings,
  listCriteria: repo.listCriteria, createCriterion: repo.createCriterion, updateCriterion: repo.updateCriterion,
  saveSettings: repo.saveSettings,
};
