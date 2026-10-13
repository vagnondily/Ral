const db = require('../../config/db');
const { badRequest, conflict, forbidden, notFound } = require('../../middleware/errors');
const repo = require('./monitoring.repository');
const { EDITABLE_KEYS } = require('./memsMapping');
const wf = require('./mappingWorkflow');

/**
 * « Mapping MEMS » d'une fiche : lecture, modification d'une dimension et cycle
 * de vie (soumettre / valider / réinitialiser). Règles dans le module pur
 * mappingWorkflow.js ; chaque écriture relit le statut SOUS VERROU de ligne
 * (SELECT … FOR UPDATE) dans la même transaction que la modification, la base
 * (migration 060) restant le filet de sécurité.
 * Erreurs : fiche absente → 404 ; statut incompatible → 409 ; séparation des
 * tâches → 403 ; dimension inconnue → 400.
 */

const WRITE_ROLES = ['admin', 'manager'];
const actorOf = (auth) => ({ userId: auth.userId, canWrite: WRITE_ROLES.includes(auth.role) });

/** Mapping + état du cycle + actions permises à l'utilisateur (mêmes règles qu'à l'écriture). */
async function getMapping(tenantId, formId, auth) {
  return db.withTenantTransaction(tenantId, async (client) => {
    const data = await repo.memsMappingTx(client, tenantId, formId);
    if (!data) throw notFound('Formulaire introuvable');
    return { ...data, actions: wf.mappingActions(data.workflow, actorOf(auth)) };
  });
}

async function lockedState(client, tenantId, formId) {
  const state = await repo.mappingStateTx(client, tenantId, formId, { forUpdate: true });
  if (!state) throw notFound('Formulaire introuvable');
  return state;
}

function assertEditable(state) {
  const err = wf.editError(state);
  if (err) throw conflict(err.message);
}

function assertDimension(dimension) {
  if (!EDITABLE_KEYS.includes(dimension)) throw badRequest(`Dimension non modifiable : « ${dimension} ».`);
}

/** Colonne choisie à la main pour une dimension ('' = « aucune ») — mapping en brouillon seulement. */
async function setDimension(tenantId, formId, dimension, column) {
  assertDimension(dimension);
  return db.withTenantTransaction(tenantId, async (client) => {
    assertEditable(await lockedState(client, tenantId, formId));
    return repo.setMemsMappingTx(client, tenantId, formId, dimension, column);
  });
}

/** Retour à la détection automatique pour une dimension — mapping en brouillon seulement. */
async function resetDimension(tenantId, formId, dimension) {
  assertDimension(dimension);
  return db.withTenantTransaction(tenantId, async (client) => {
    assertEditable(await lockedState(client, tenantId, formId));
    return repo.resetMemsMappingTx(client, tenantId, formId, dimension);
  });
}

/**
 * Soumettre / valider / réinitialiser le mapping d'une fiche.
 * @param {'submit'|'validate'|'reset'} action
 * @returns {Promise<{ status: string }>}
 */
async function transition(tenantId, formId, action, auth) {
  return db.withTenantTransaction(tenantId, async (client) => {
    const state = await lockedState(client, tenantId, formId);
    const err = wf.transitionError(action, state, auth.userId);
    if (err) throw err.code === 'self' ? forbidden(err.message) : conflict(err.message);
    const patch = wf.transitionPatch(action, auth.userId);
    if (!(await repo.setMappingStatusTx(client, tenantId, formId, state.status, patch))) {
      throw conflict('Le mapping a changé entre-temps. Rechargez la page.');
    }
    return { status: patch.status };
  });
}

module.exports = { getMapping, setDimension, resetDimension, transition };
