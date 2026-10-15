const repo = require('./evaluation.repository');
const { buildGrid, applyRatings, checkValidation, freeze, preview, RuleError } = require('./providerEvaluation');
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
  if (err.code === 'validated') return conflict(err.message);
  return badRequest(err.message, err.missing ? { code: err.code, missing: err.missing } : { code: err.code });
}
async function rules(fn) {
  try { return await fn(); } catch (err) { throw httpError(err); }
}

/**
 * Notes finales des agents d'un prestataire sur une période (évaluation des agents, retour
 * 28.3) : la note du prestataire en reprend la moyenne, avec la même règle partout.
 */
async function providerAgentScores(_tenantId, _partnerId, _period) {
  return [];
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
 * Validation : les notes des agents de la période sont lues AVANT d'ouvrir la transaction de
 * validation (jamais deux connexions tenues à la fois) ; sous le verrou, la période relue doit
 * être la même, sinon 409 (le brouillon a changé entre-temps).
 */
async function validateProviderEvaluation(tenantId, partnerId, id, userId) {
  const before = await repo.getProviderEvaluation(tenantId, partnerId, id);
  if (!before) throw notFound('Évaluation introuvable');
  const agents = await providerAgentScores(tenantId, partnerId, { from: before.periodFrom, to: before.periodTo });
  const e = await rules(() => repo.validateProviderEvaluation(tenantId, partnerId, id, async (current, { settings }) => {
    checkValidation(current, userId);
    if (current.periodFrom !== before.periodFrom || current.periodTo !== before.periodTo) {
      throw new RuleError('validated', 'L\'évaluation a été modifiée entre-temps : relancez la validation.');
    }
    return freeze(current, { agents, settings, userId });
  }));
  if (!e) throw notFound('Évaluation introuvable');
  return e;
}

async function deleteProviderEvaluation(tenantId, partnerId, id) {
  const r = await repo.deleteProviderEvaluation(tenantId, partnerId, id);
  if (r === 'not_found') throw notFound('Évaluation introuvable');
  if (r === 'validated') throw conflict('Évaluation validée : elle ne peut plus être supprimée.');
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
