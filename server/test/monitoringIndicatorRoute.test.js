/**
 * Routes des indicateurs (retour n° 20), de bout en bout SANS base : le dépôt
 * est remplacé par un espion. On vérifie ce qui ARRIVE au dépôt : une
 * modification partielle ne transmet que les clés envoyées (null = effacer),
 * le code se modifie, un code en double répond 409, « % = valeur » sans valeur
 * est refusé, l'aperçu du calcul est une lecture ouverte à tout utilisateur.
 */
process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = 'secret-de-test-des-routes-indicateurs-0123456789';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const repo = require('../src/modules/monitoring/monitoring.repository');
const routes = require('../src/modules/monitoring/monitoring.routes');
const { errorHandler } = require('../src/middleware/errors');

const calls = [];
const dup = () => Object.assign(new Error('duplicate key'), { code: '23505' });
repo.updateIndicator = async (tenantId, id, patch) => {
  calls.push({ fn: 'update', tenantId, id, patch });
  if (patch.code === 'PRIS') throw dup();
  return id !== '99999999-9999-9999-9999-999999999999';
};
repo.createIndicator = async (tenantId, formId, ind) => {
  calls.push({ fn: 'create', tenantId, formId, ind });
  if (ind.code === 'PRIS') throw dup();
  return formId === '99999999-9999-9999-9999-999999999999' ? null : 'new-id';
};
repo.indicatorPreview = async (tenantId, formId, def, period) => {
  calls.push({ fn: 'preview', formId, def, period });
  return { n: 3, explain: { value: 50 }, period };
};
repo.applyTemplateUpdate = async (tenantId, id, input) => {
  calls.push({ fn: 'templateUpdate', tenantId, id, input });
  if (id === '99999999-9999-9999-9999-999999999999') return null;
  return { patch: input.expected };
};
repo.formMonths = async (tenantId, formId) => (formId === '99999999-9999-9999-9999-999999999999' ? null : { months: [{ month: '2026-07', submissions: 74 }], latest: '2026-07' });

const app = express();
app.use(express.json());
app.use('/api/monitoring', routes);
app.use(errorHandler);
const TENANT = '11111111-1111-1111-1111-111111111111';
const manager = jwt.sign({ sub: 'u1', tenantId: TENANT, role: 'manager' }, process.env.JWT_SECRET);
const viewer = jwt.sign({ sub: 'u2', tenantId: TENANT, role: 'viewer' }, process.env.JWT_SECRET);
const FORM = '22222222-2222-2222-2222-222222222222';
const IND = '33333333-3333-3333-3333-333333333333';
const as = (tok) => ({ Authorization: `Bearer ${tok}` });
const last = () => calls[calls.length - 1];

test('PATCH partiel : seules les clés envoyées partent au dépôt (le reste n\'est pas effacé)', async () => {
  const res = await request(app).patch(`/api/monitoring/indicators/${IND}`).set(as(manager)).send({ active: false });
  assert.equal(res.status, 204);
  assert.deepEqual(last().patch, { active: false });
  assert.equal(last().tenantId, TENANT); // le compte vient du jeton, jamais du corps
});

test('PATCH : « » ou null efface module / valeur comptée / cible ; le code se modifie', async () => {
  const res = await request(app).patch(`/api/monitoring/indicators/${IND}`).set(as(manager)).send({ module: '', positiveValue: null, target: null, code: ' NOUVEAU ' });
  assert.equal(res.status, 204);
  assert.deepEqual(last().patch, { module: null, positiveValue: null, target: null, code: 'NOUVEAU' });
});

test('PATCH : code déjà pris → 409 ; indicateur inconnu → 404 ; clé inconnue ou identifiant invalide → 400', async () => {
  const taken = await request(app).patch(`/api/monitoring/indicators/${IND}`).set(as(manager)).send({ code: 'PRIS' });
  assert.equal(taken.status, 409);
  assert.match(taken.body.error, /existe déjà/);
  const missing = await request(app).patch('/api/monitoring/indicators/99999999-9999-9999-9999-999999999999').set(as(manager)).send({ label: 'x' });
  assert.equal(missing.status, 404);
  const n = calls.length;
  assert.equal((await request(app).patch(`/api/monitoring/indicators/${IND}`).set(as(manager)).send({ templateCode: 'X' })).status, 400);
  assert.equal((await request(app).patch('/api/monitoring/indicators/pas-un-uuid').set(as(manager)).send({ label: 'x' })).status, 400);
  assert.equal((await request(app).patch(`/api/monitoring/indicators/${IND}`).set(as(manager)).send({ target: 'beaucoup' })).status, 400);
  assert.equal(calls.length, n); // rien n'a atteint le dépôt
});

test('PATCH / POST réservés aux gestionnaires (403 pour un lecteur)', async () => {
  assert.equal((await request(app).patch(`/api/monitoring/indicators/${IND}`).set(as(viewer)).send({ label: 'x' })).status, 403);
  assert.equal((await request(app).post(`/api/monitoring/forms/${FORM}/indicators`).set(as(viewer)).send({ code: 'A', label: 'A', sourceField: 'q' })).status, 403);
});

test('POST : « % = valeur » sans valeur comptée → 400 sans écriture ; code en double → 409 ; fiche inconnue → 404', async () => {
  const n = calls.length;
  const bad = await request(app).post(`/api/monitoring/forms/${FORM}/indicators`).set(as(manager))
    .send({ code: 'A', label: 'A', sourceField: 'q', agg: 'percent_value', positiveValue: '' });
  assert.equal(bad.status, 400);
  assert.equal(calls.length, n);
  const ok = await request(app).post(`/api/monitoring/forms/${FORM}/indicators`).set(as(manager))
    .send({ code: 'A', label: 'A', sourceField: 'q', agg: 'percent_value', positiveValue: '1|2', module: '', naValues: ['9999'] });
  assert.equal(ok.status, 201);
  assert.deepEqual(ok.body, { id: 'new-id' });
  assert.equal(last().ind.module, null);
  assert.equal(last().ind.positiveValue, '1|2');
  assert.equal((await request(app).post(`/api/monitoring/forms/${FORM}/indicators`).set(as(manager)).send({ code: 'PRIS', label: 'A', sourceField: 'q' })).status, 409);
  assert.equal((await request(app).post('/api/monitoring/forms/99999999-9999-9999-9999-999999999999/indicators').set(as(manager)).send({ code: 'B', label: 'B', sourceField: 'q' })).status, 404);
});

test('erreurs structurées : message français + code, pour que l\'interface refasse la phrase dans sa langue', async () => {
  const taken = await request(app).post(`/api/monitoring/forms/${FORM}/indicators`).set(as(manager)).send({ code: 'PRIS', label: 'A', sourceField: 'q' });
  assert.equal(taken.status, 409);
  assert.equal(taken.body.error, 'Un indicateur avec ce code existe déjà sur cette fiche.');
  assert.deepEqual(taken.body.details, { code: 'duplicate_code', field: 'code', value: 'PRIS' });
  const takenPatch = await request(app).patch(`/api/monitoring/indicators/${IND}`).set(as(manager)).send({ code: 'PRIS' });
  assert.equal(takenPatch.body.details.code, 'duplicate_code');
  const n = calls.length;
  const bad = await request(app).post(`/api/monitoring/forms/${FORM}/indicators`).set(as(manager))
    .send({ code: 'A', label: 'A', sourceField: 'q', agg: 'percent_value' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /« % = valeur » : précisez la valeur comptée/);
  assert.equal(bad.body.details.code, 'positive_required');
  assert.equal(bad.body.details.field, 'positiveValue');
  assert.equal(calls.length, n); // rien n'a atteint le dépôt
  // Autres erreurs de saisie : inchangées (« Données invalides », sans code).
  const other = await request(app).post(`/api/monitoring/forms/${FORM}/indicators`).set(as(manager)).send({ code: '', label: 'A', sourceField: 'q' });
  assert.equal(other.status, 400);
  assert.equal(other.body.error, 'Données invalides');
  assert.equal(other.body.details.code, undefined);
});

test('aperçu du calcul : lecture pour tout utilisateur, période transmise, méthode par défaut % de oui', async () => {
  const res = await request(app).post(`/api/monitoring/forms/${FORM}/indicators/preview`).set(as(viewer))
    .send({ sourceField: 'MOInfoSession', positiveValue: '1', naValues: ['9999'], month: '2026-07' });
  assert.equal(res.status, 200);
  assert.deepEqual(last().def, { agg: 'percent_yes', sourceField: 'MOInfoSession', positiveValue: '1', naValues: ['9999'] });
  // Période commune (lot 1b) : { month } hérité ≡ { from, to } d'un mois.
  assert.deepEqual(last().period, { from: '2026-07', to: '2026-07' });
  const bad = await request(app).post(`/api/monitoring/forms/${FORM}/indicators/preview`).set(as(viewer)).send({ sourceField: 'q', month: '07/2026' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.details.code, 'period_format');
  assert.equal((await request(app).post(`/api/monitoring/forms/${FORM}/indicators/preview`).set(as(viewer)).send({ agg: 'mean' })).status, 400);
});

test('mois ayant des données : période par défaut des résultats', async () => {
  const res = await request(app).get(`/api/monitoring/forms/${FORM}/months`).set(as(viewer));
  assert.equal(res.status, 200);
  assert.equal(res.body.latest, '2026-07');
  assert.equal((await request(app).get('/api/monitoring/forms/99999999-9999-9999-9999-999999999999/months').set(as(viewer))).status, 404);
});

// ---- Modèle d'indicateurs (retours 66, 85) : proposition et création d'un clic.
repo.formTemplate = async (tenantId, formId, opts) => {
  calls.push({ fn: 'template', tenantId, formId, opts });
  return { form: { id: formId }, source: 'proposal', template: null };
};
repo.applyTemplate = async (tenantId, formId, opts) => {
  calls.push({ fn: 'apply', tenantId, formId, opts });
  return { applied: 3, kept: 0, conflicts: 0, template: 'SMP' };
};

test('modèle : lecture pour tout utilisateur ; modèle choisi transmis ; clé invalide refusée', async () => {
  const res = await request(app).get(`/api/monitoring/forms/${FORM}/template?template=RES`).set(as(viewer));
  assert.equal(res.status, 200);
  assert.deepEqual(last().opts, { template: 'RES' });
  const plain = await request(app).get(`/api/monitoring/forms/${FORM}/template`).set(as(viewer));
  assert.equal(plain.status, 200);
  assert.deepEqual(last().opts, { template: null });
  const n = calls.length;
  assert.equal((await request(app).get(`/api/monitoring/forms/${FORM}/template?template=x;drop`).set(as(viewer))).status, 400);
  assert.equal(calls.length, n);
});

test('créer depuis le modèle : soit les éléments choisis, soit « proposed » d\'un clic ; jamais les deux, jamais d\'activité', async () => {
  const one = await request(app).post(`/api/monitoring/forms/${FORM}/template/apply`).set(as(manager)).send({ proposed: true });
  assert.equal(one.status, 200);
  assert.deepEqual(last().opts, { items: null, proposed: true, template: null });
  assert.equal(last().tenantId, TENANT);
  const items = await request(app).post(`/api/monitoring/forms/${FORM}/template/apply`).set(as(manager))
    .send({ items: [{ code: 'SMP_MENU_DISPLAYED', sourceField: 'DIRNBSchMealMenu', positiveValue: '1' }], template: 'SMP' });
  assert.equal(items.status, 200);
  assert.deepEqual(last().opts, { items: [{ code: 'SMP_MENU_DISPLAYED', sourceField: 'DIRNBSchMealMenu', positiveValue: '1' }], proposed: false, template: 'SMP' });
  const n = calls.length;
  const both = await request(app).post(`/api/monitoring/forms/${FORM}/template/apply`).set(as(manager))
    .send({ proposed: true, items: [{ code: 'A', sourceField: 'b' }] });
  assert.equal(both.status, 400);
  assert.equal(both.body.details.code, 'items_or_proposed');
  assert.equal((await request(app).post(`/api/monitoring/forms/${FORM}/template/apply`).set(as(manager)).send({})).status, 400);
  // Clés inconnues refusées : ni compte venu du corps, ni rattachement d'activité par ce chemin.
  assert.equal((await request(app).post(`/api/monitoring/forms/${FORM}/template/apply`).set(as(manager)).send({ proposed: true, tenantId: 'x' })).status, 400);
  assert.equal((await request(app).post(`/api/monitoring/forms/${FORM}/template/apply`).set(as(manager)).send({ proposed: true, attach: true })).status, 400);
  // Lecteur : pas d'écriture.
  assert.equal((await request(app).post(`/api/monitoring/forms/${FORM}/template/apply`).set(as(viewer)).send({ proposed: true })).status, 403);
  assert.equal(calls.length, n);
});

test('mise à jour depuis le modèle (R6) : la modification montrée part au dépôt ; indicateur disparu → 404 indicator_not_found', async () => {
  const res = await request(app).post(`/api/monitoring/indicators/${IND}/template-update`).set(as(manager))
    .send({ mode: 'corrections', expected: { label: 'Nouveau', naValues: ['888'] } });
  assert.equal(res.status, 200);
  assert.deepEqual(last().input, { mode: 'corrections', template: null, expected: { label: 'Nouveau', naValues: ['888'] } });
  assert.equal(last().tenantId, TENANT);
  const gone = await request(app).post('/api/monitoring/indicators/99999999-9999-9999-9999-999999999999/template-update').set(as(manager))
    .send({ expected: { label: 'x' } });
  assert.deepEqual([gone.status, gone.body.details.code], [404, 'indicator_not_found']);
  const bad = await request(app).post(`/api/monitoring/indicators/${IND}/template-update`).set(as(manager)).send({ expected: { inconnu: 1 } });
  assert.equal(bad.status, 400);
  const ro = await request(app).post(`/api/monitoring/indicators/${IND}/template-update`).set(as(viewer)).send({ expected: { label: 'x' } });
  assert.equal(ro.status, 403);
});
