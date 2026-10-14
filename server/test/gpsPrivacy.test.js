/**
 * Vie privée des positions de ménages (lot 6a, correctif) : hors admin / gestionnaire,
 * AUCUNE coordonnée GPS précise ne sort par les aperçus du suivi de processus —
 * aperçu d'un champ calculé (lignes d'exemple, répartition, formule qui recopie la
 * latitude) et « Comment c'est calculé » d'un indicateur (valeurs, répartition).
 * Dépôt joué SANS base (faux client) ; routes de bout en bout avec un dépôt espion.
 */
process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = 'secret-de-test-vie-privee-gps-0123456789abcdef';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/config/db');
const { seesPreciseGps, stripRowsGps, PRECISE_ROLES } = require('../src/modules/map/submissionGps');

const T = '11111111-1111-1111-1111-111111111111';
const FORM = '33333333-3333-3333-3333-333333333333';
// Trois ménages (positions réelles de la forme Kobo : paire, chaîne geopoint, _geolocation).
const HOUSES = [
  { '@_HHCoord_latitude': '-24.7840622', '@_HHCoord_longitude': '45.1925514', '@_HHCoord_precision': '4.8', q1: '1' },
  { '@_HHCoord_latitude': -24.7911234, '@_HHCoord_longitude': 45.2011876, HHCoord: '-24.7911234 45.2011876 12 4.5', q1: '0' },
  { _geolocation: [-21.2031341, 48.2250182], q1: '1' },
];
const CALC = [{ id: 'c1', name: 'lat_copy', label: 'Copie', kind: 'expression', expression: '[@_HHCoord_latitude]', sourceField: null, mapping: null, defaultValue: null, sort_order: 1 }];

/** Faux client : rend les lignes selon le SQL (seules les requêtes utiles sont jouées). */
db.withTenantTransaction = async (_tenantId, fn) => fn({
  query: async (sql) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (/^SELECT id FROM monitoring_forms WHERE tenant_id = \$1 AND id = \$2/.test(s)) return { rows: [{ id: FORM }] };
    if (/FROM monitoring_calc_fields WHERE tenant_id = \$1 AND form_id = \$2 ORDER BY sort_order, name/.test(s)) return { rows: CALC };
    if (/^SELECT name AS k FROM monitoring_form_fields/.test(s)) {
      return { rows: ['@_HHCoord_latitude', '@_HHCoord_longitude', '@_HHCoord_precision', 'HHCoord', '_geolocation', 'q1'].map((k) => ({ k })) };
    }
    if (/^SELECT COALESCE\(\(SELECT jsonb_object_agg/.test(s)) return { rows: HOUSES.map((d) => ({ data: { ...d } })) };
    if (/^SELECT ms\.id, ms\.external_id AS "externalId"/.test(s)) return { rows: HOUSES.map((d, i) => ({ id: `s${i}`, data: { ...d } })) };
    return { rows: [] };
  },
});
const repo = require('../src/modules/monitoring/monitoring.repository');

/** Un nombre à plus de 2 décimales (une coordonnée de ménage) quelque part dans la réponse ? */
const PRECISE_NUM = /-?\d{1,3}\.\d{3,}/;

test('règle des rôles : admin et gestionnaire seulement', () => {
  assert.deepEqual([...PRECISE_ROLES].sort(), ['admin', 'manager']);
  assert.equal(seesPreciseGps('viewer'), false);
  assert.equal(seesPreciseGps(undefined), false);
  assert.equal(seesPreciseGps('admin'), true);
  const rows = [{ data: { ...HOUSES[1] } }];
  assert.deepEqual(stripRowsGps(rows, false)[0].data, { q1: '0' });
  assert.equal(stripRowsGps(rows, true), rows, 'rôle précis : lignes intactes');
  assert.equal(rows[0].data['@_HHCoord_latitude'], -24.7911234, 'l\'entrée n\'est jamais modifiée');
});

test('aperçu d\'un champ calculé : lecteur → aucune coordonnée (entrées, répartition, formule qui recopie la latitude)', async () => {
  for (const expression of ['[@_HHCoord_latitude] + [@_HHCoord_longitude]', '[lat_copy]', '[HHCoord]']) {
    const out = await repo.calcPreview(T, FORM, { kind: 'expression', expression }, {});
    assert.ok(!out.check.error, expression);
    assert.doesNotMatch(JSON.stringify({ samples: out.samples, distribution: out.distribution }), PRECISE_NUM, expression);
    assert.equal(out.distinct, 0, `${expression} : rien de calculable sans coordonnées`);
  }
  // Rôle précis : les valeurs réelles (comportement inchangé pour l'administrateur / le gestionnaire).
  const precise = await repo.calcPreview(T, FORM, { kind: 'expression', expression: '[@_HHCoord_latitude]' }, { precise: true });
  assert.match(JSON.stringify(precise.samples), /-24\.7840622/);
});

test('« Comment c\'est calculé » d\'un indicateur : lecteur → variable GPS absente, aucune valeur ni répartition précise', async () => {
  for (const sourceField of ['@_HHCoord_latitude', 'lat_copy', 'HHCoord']) {
    const out = await repo.indicatorPreview(T, FORM, { sourceField, agg: 'mean' }, null);
    assert.doesNotMatch(JSON.stringify(out.explain), PRECISE_NUM, sourceField);
  }
  const ok = await repo.indicatorPreview(T, FORM, { sourceField: 'q1', agg: 'percent_yes', positiveValue: '1' }, null);
  assert.equal(ok.n, 3, 'les autres réponses restent lues');
  const precise = await repo.indicatorPreview(T, FORM, { sourceField: '@_HHCoord_latitude', agg: 'mean' }, null, { precise: true });
  assert.match(JSON.stringify(precise.explain), /-24\.78/);
});

test('soumissions d\'une fiche : coordonnées retirées AVANT les champs calculés (une formule ne les recopie pas)', async () => {
  const out = await repo.formSubmissions(T, FORM, { limit: 10 });
  assert.equal(out.rows.length, 3);
  assert.ok(out.rows.every((r) => r.data.q1 !== undefined && 'lat_copy' in r.data), 'réponses et champ calculé présents');
  assert.doesNotMatch(JSON.stringify(out.rows), PRECISE_NUM);
  const precise = await repo.formSubmissions(T, FORM, { limit: 10, precise: true });
  assert.equal(String(precise.rows[0].data.lat_copy), '-24.7840622');
});

test('routes : le rôle du jeton décide (lecteur → precise: false ; admin / gestionnaire → true)', async () => {
  const express = require('express');
  const request = require('supertest');
  const jwt = require('jsonwebtoken');
  const seen = [];
  repo.calcPreview = async (tenantId, formId, def, opts) => { seen.push({ fn: 'calc', tenantId, opts }); return { check: {}, samples: [] }; };
  repo.indicatorPreview = async (tenantId, formId, def, period, opts) => { seen.push({ fn: 'ind', tenantId, opts }); return { explain: {} }; };
  const { errorHandler } = require('../src/middleware/errors');
  const app = express();
  app.use(express.json());
  app.use('/api/monitoring', require('../src/modules/monitoring/monitoring.routes'));
  app.use(errorHandler);
  const tok = (role) => ({ Authorization: `Bearer ${jwt.sign({ sub: 'u', tenantId: T, role }, process.env.JWT_SECRET)}` });
  for (const [role, precise] of [['viewer', false], ['manager', true], ['admin', true]]) {
    const c = await request(app).post(`/api/monitoring/forms/${FORM}/calc-fields/preview`).set(tok(role)).send({ kind: 'expression', expression: '[q1]' });
    assert.equal(c.status, 200, role);
    assert.equal(seen[seen.length - 1].opts.precise, precise, `calc ${role}`);
    assert.equal(seen[seen.length - 1].tenantId, T);
    const i = await request(app).post(`/api/monitoring/forms/${FORM}/indicators/preview`).set(tok(role)).send({ sourceField: 'q1', agg: 'mean' });
    assert.equal(i.status, 200, role);
    assert.equal(seen[seen.length - 1].opts.precise, precise, `indicateur ${role}`);
  }
});
