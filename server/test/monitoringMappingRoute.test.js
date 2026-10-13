/**
 * Cycle de vie du « Mapping MEMS » de bout en bout par les routes, SANS base :
 * la transaction et le dépôt sont remplacés par un état en mémoire. Vérifie
 * les transitions (brouillon → soumis → validé → brouillon), le refus de
 * modifier une dimension hors brouillon (409), la séparation des tâches (403),
 * les rôles (lecture seule) et la validation des entrées (400).
 */
process.env.NODE_ENV = 'production'; // logger sans transport « pretty » (pas de thread)
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = 'secret-de-test-des-routes-de-mapping-0123456789';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const db = require('../src/config/db');
const repo = require('../src/modules/monitoring/monitoring.repository');
const routes = require('../src/modules/monitoring/monitoring.routes');
const { errorHandler } = require('../src/middleware/errors');

const TENANT = '11111111-1111-1111-1111-111111111111';
const FORM = '22222222-2222-2222-2222-222222222222';
const OTHER = '33333333-3333-3333-3333-333333333333';
const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// ---- État en mémoire (une fiche), transaction simulée avec annulation sur erreur --------------
let state;
let fieldMap;
const reset = () => {
  state = { status: 'brouillon', submittedBy: null, submittedAt: null, validatedBy: null, validatedAt: null };
  fieldMap = new Map();
};
reset();
const locks = [];
db.withTenantTransaction = async (tenantId, fn) => {
  assert.equal(tenantId, TENANT, 'le compte vient du jeton, jamais de la requête');
  const saved = { state: { ...state }, fieldMap: new Map(fieldMap) };
  try { return await fn({ fake: true }); } catch (err) { ({ state, fieldMap } = saved); throw err; }
};
repo.mappingStateTx = async (client, tenantId, formId, { forUpdate } = {}) => {
  locks.push(forUpdate);
  return formId === FORM ? { status: state.status, submittedBy: state.submittedBy, validatedBy: state.validatedBy } : null;
};
repo.setMappingStatusTx = async (client, tenantId, formId, from, patch) => {
  if (state.status !== from) return false;
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) state[k] = v;
  return true;
};
repo.setMemsMappingTx = async (client, tenantId, formId, dimension, column) => { fieldMap.set(dimension, column); return { dimension, columnName: column }; };
repo.resetMemsMappingTx = async (client, tenantId, formId, dimension) => ({ removed: fieldMap.delete(dimension) ? 1 : 0 });
repo.memsMappingTx = async (client, tenantId, formId) => (formId === FORM ? {
  rows: [], columns: [], dates: { total: 0 }, workflow: { ...state },
} : null);

const app = express();
app.use(express.json());
app.use('/api/monitoring', routes);
app.use(errorHandler);
const tokenOf = (sub, role) => jwt.sign({ sub, tenantId: TENANT, role }, process.env.JWT_SECRET);
const as = (sub, role = 'manager') => {
  const token = tokenOf(sub, role);
  const withAuth = (r) => r.set('Authorization', `Bearer ${token}`);
  return {
    get: (p) => withAuth(request(app).get(p)),
    post: (p, b) => withAuth(request(app).post(p)).send(b),
    put: (p, b) => withAuth(request(app).put(p)).send(b),
    del: (p) => withAuth(request(app).delete(p)),
  };
};
const url = (suffix, form = FORM) => `/api/monitoring/forms/${form}/${suffix}`;

test('cycle complet : modifier en brouillon, soumettre, valider par une autre personne, réinitialiser', async () => {
  reset(); locks.length = 0;
  const a = as(A, 'manager'); const b = as(B, 'admin');

  let res = await a.get(url('mems-mapping'));
  assert.equal(res.status, 200);
  assert.deepEqual([res.body.actions.edit, res.body.actions.submit, res.body.actions.validate, res.body.actions.reset], [true, true, false, false]);

  assert.equal((await a.put(url('mems-mapping'), { dimension: 'survey_date', column: 'SvyDate' })).status, 200);
  assert.equal(fieldMap.get('survey_date'), 'SvyDate');
  assert.equal((await a.del(url('mems-mapping/site'))).status, 204);

  res = await a.post(url('mapping/submit'));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: 'soumis' });
  assert.equal(state.submittedBy, A);
  assert.ok(state.submittedAt instanceof Date);

  // Soumis : figé (409), y compris le retour à « Automatique ».
  res = await a.put(url('mems-mapping'), { dimension: 'site', column: 'DPName' });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /Mapping soumis : il est figé/);
  assert.equal((await b.del(url('mems-mapping/survey_date'))).status, 409);
  assert.equal(fieldMap.get('survey_date'), 'SvyDate');
  assert.equal((await a.post(url('mapping/submit'))).status, 409);

  // Séparation des tâches : le soumetteur ne valide pas (403), une autre personne si.
  res = await a.post(url('mapping/validate'));
  assert.equal(res.status, 403);
  assert.match(res.body.error, /Séparation des tâches/);
  assert.equal(state.status, 'soumis');
  res = await a.get(url('mems-mapping'));
  assert.equal(res.body.actions.validate, false);
  assert.match(res.body.actions.validateReason, /Séparation des tâches/);
  assert.equal((await b.get(url('mems-mapping'))).body.actions.validate, true);
  res = await b.post(url('mapping/validate'), {});
  assert.equal(res.status, 200);
  assert.equal(state.status, 'valide');
  assert.equal(state.validatedBy, B);

  // Validé : lecture seule ; seule la réinitialisation le rouvre.
  assert.equal((await b.put(url('mems-mapping'), { dimension: 'site', column: 'DPName' })).status, 409);
  assert.equal((await b.post(url('mapping/validate'))).status, 409);
  assert.equal((await a.post(url('mapping/submit'))).status, 409);
  res = await a.post(url('mapping/reset'));
  assert.equal(res.status, 200);
  assert.deepEqual(state, { status: 'brouillon', submittedBy: null, submittedAt: null, validatedBy: null, validatedAt: null });
  assert.equal((await a.post(url('mapping/reset'))).status, 409); // déjà en brouillon
  assert.equal((await a.put(url('mems-mapping'), { dimension: 'site', column: 'DPName' })).status, 200);
  // Chaque écriture relit le statut sous verrou de ligne.
  assert.ok(locks.length > 0 && locks.every((l) => l === true));
});

test('rôle lecture seule : consulte, mais aucune écriture (403) ; actions toutes fausses', async () => {
  reset();
  const v = as(A, 'viewer');
  const res = await v.get(url('mems-mapping'));
  assert.equal(res.status, 200);
  assert.ok(Object.entries(res.body.actions).filter(([k]) => k !== 'validateReason').every(([, x]) => x === false));
  for (const r of [v.post(url('mapping/submit')), v.put(url('mems-mapping'), { dimension: 'site', column: 'x' }), v.del(url('mems-mapping/site'))]) {
    assert.equal((await r).status, 403);
  }
  assert.equal(state.status, 'brouillon');
  assert.equal(fieldMap.size, 0);
});

test('entrées invalides (400) et fiche introuvable (404), sans écriture', async () => {
  reset();
  const a = as(A);
  assert.equal((await a.put(url('mems-mapping'), { dimension: 'period_month', column: 'x' })).status, 400); // dimension non modifiable
  assert.equal((await a.del(url('mems-mapping/submitted_at'))).status, 400); // la date de réception n'est pas choisie à la main
  assert.equal((await a.post(url('mapping/submit'), { status: 'valide' })).status, 400); // corps inattendu refusé
  assert.equal((await a.post('/api/monitoring/forms/pas-un-uuid/mapping/submit')).status, 400);
  assert.equal((await a.post(url('mapping/submit', OTHER))).status, 404);
  assert.equal((await a.get(url('mems-mapping', OTHER))).status, 404);
  assert.equal((await a.put(url('mems-mapping', OTHER), { dimension: 'site', column: 'x' })).status, 404);
  assert.equal(state.status, 'brouillon');
  assert.equal(fieldMap.size, 0);
});
