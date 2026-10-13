/**
 * Vérification avant import (POST /forms/:id/import/preview) de bout en bout SANS base :
 * la transaction est remplacée par un faux client qui ne répond qu'aux LECTURES (aucune
 * écriture possible). Vérifie que la vérification applique la MÊME préparation que l'import
 * (monitoring.repository.importPreview → submissionsImport.prepareImport) : colonne de date
 * choisie dans « Mapping MEMS » (une colonne, ou « Aucune »), doublons du fichier comptés une
 * fois — donc des mois et des comptes identiques à ce que l'import écrira.
 */
process.env.NODE_ENV = 'production'; // logger sans transport « pretty » (pas de thread)
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = 'secret-de-test-de-la-verification-0123456789';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const db = require('../src/config/db');

const TENANT = '11111111-1111-1111-1111-111111111111';
const FORM = '22222222-2222-2222-2222-222222222222';

// ---- Faux client : lectures seulement ---------------------------------------------------------
let overrides = [];
const queries = [];
const fakeClient = {
  async query(sql, params = []) {
    queries.push(sql);
    assert.match(sql.trim(), /^SELECT/, 'la vérification n\'écrit jamais');
    assert.equal(params[0], TENANT, 'toujours filtré par le compte');
    if (/FROM monitoring_forms/.test(sql)) return { rows: params[1] === FORM ? [{ id: FORM }] : [] };
    if (/FROM monitoring_field_map/.test(sql)) return { rows: overrides };
    if (/FROM monitoring_form_fields/.test(sql)) return { rows: [] };
    if (/external_id = ANY/.test(sql)) return { rows: [{ n: params[2].filter((x) => x.startsWith('old')).length }] };
    throw new Error(`requête inattendue : ${sql.slice(0, 80)}`);
  },
};
// Avant le chargement du dépôt (il garde la fonction au chargement).
db.withTenantTransaction = async (tenantId, fn) => { assert.equal(tenantId, TENANT); return fn(fakeClient); };

const routes = require('../src/modules/monitoring/monitoring.routes');
const { errorHandler } = require('../src/middleware/errors');
const { parseSubmissions, prepareImport, dateSummary } = require('../src/modules/monitoring/submissionsImport');

const app = express();
app.use(express.json());
app.use('/api/monitoring', routes);
app.use(errorHandler);
const token = jwt.sign({ sub: 'u1', tenantId: TENANT, role: 'manager' }, process.env.JWT_SECRET);
const preview = (buf, form = FORM) => request(app).post(`/api/monitoring/forms/${form}/import/preview`)
  .set('Authorization', `Bearer ${token}`).set('Content-Type', 'application/octet-stream').send(buf);

const CSV = [
  '_uuid,SvyDate,DateVisite,_submission_time,Field_office,DPName,q1',
  'old-1,2026-02-01,2026-01-20,2026-02-03T08:00:00,6,EPP A,oui',
  'new-1,2026-02-10,2026-01-25,2026-02-11T08:00:00,7,EPP B,non',
  'new-1,2026-02-10,2026-01-25,2026-02-11T08:00:00,7,EPP B,non',
  ',2026-03-02,,2026-03-04T08:00:00,7,EPP C,oui',
].join('\n');

/** Ce que l'import écrira pour ce fichier avec ces surcharges (même préparation). */
async function written(ov) {
  const { unique } = prepareImport((await parseSubmissions(Buffer.from(CSV))).submissions, { overrides: ov });
  const months = new Map();
  for (const s of unique) if (s.periodMonth) months.set(s.periodMonth, (months.get(s.periodMonth) || 0) + 1);
  return { months: [...months.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, n]) => ({ month, n })), dates: dateSummary(unique) };
}

test('vérification : contenu du fichier, nouvelles / déjà importées, doublons comptés une fois, aucune écriture', async () => {
  overrides = []; queries.length = 0;
  const res = await preview(Buffer.from(CSV));
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.count, 4);
  assert.equal(res.body.source, 'csv');
  assert.equal(res.body.recognized.field_office, 'Field_office');
  assert.equal(res.body.recognized.site, 'DPName');
  assert.equal(res.body.recognized.survey_date, 'SvyDate');
  assert.equal(res.body.recognized.admin1, null);
  assert.deepEqual(res.body.manual, []);
  // Le doublon new-1 ne compte qu'une fois, comme à l'import (dernière version retenue).
  assert.deepEqual(res.body.months, [{ month: '2026-02-01', n: 2 }, { month: '2026-03-01', n: 1 }]);
  assert.deepEqual(res.body.months, (await written([])).months);
  assert.equal(res.body.from, '2026-02-01');
  assert.equal(res.body.to, '2026-03-02');
  assert.equal(res.body.duplicatesInFile, 1);
  assert.equal(res.body.withoutId, 1);
  assert.equal(res.body.alreadyImported, 1);
  assert.equal(res.body.newCount, 1);
  assert.equal(res.body.ids, undefined);
  assert.ok(queries.length > 0 && queries.every((q) => /^\s*SELECT/.test(q)));
});

test('vérification : la date de collecte choisie dans « Mapping MEMS » (colonne ou « Aucune ») est celle de l\'import', async () => {
  overrides = [{ dimension: 'survey_date', columnName: 'DateVisite' }];
  let res = await preview(Buffer.from(CSV));
  assert.equal(res.status, 200, res.text);
  // DateVisite : janvier pour les deux premières ; la 3ᵉ n'en a pas → mois de réception (mars).
  assert.deepEqual(res.body.months, [{ month: '2026-01-01', n: 2 }, { month: '2026-03-01', n: 1 }]);
  const w = await written(overrides);
  assert.deepEqual(res.body.months, w.months);
  assert.deepEqual(res.body.dates, w.dates);
  assert.equal(res.body.recognized.survey_date, 'DateVisite');
  assert.deepEqual(res.body.manual, ['survey_date']);

  overrides = [{ dimension: 'survey_date', columnName: '' }]; // « Aucune » : mois de réception
  res = await preview(Buffer.from(CSV));
  assert.deepEqual(res.body.months, [{ month: '2026-02-01', n: 2 }, { month: '2026-03-01', n: 1 }]);
  assert.deepEqual(res.body.months, (await written(overrides)).months);
  assert.equal(res.body.dates.fromUpload, 3);
  assert.equal(res.body.dates.fromSurvey, 0);
  assert.equal(res.body.recognized.survey_date, null);

  // Colonne de bureau choisie à la main : reconnue telle quelle dans la vérification.
  overrides = [{ dimension: 'field_office', columnName: 'DPName' }];
  res = await preview(Buffer.from(CSV));
  assert.equal(res.body.recognized.field_office, 'DPName');
  assert.deepEqual(res.body.manual, ['field_office']);
});

test('vérification : fiche d\'un autre compte ou inconnue → 404 ; fichier refusé → 400', async () => {
  overrides = [];
  const other = await preview(Buffer.from(CSV), '33333333-3333-3333-3333-333333333333');
  assert.equal(other.status, 404);
  const bad = await preview(Buffer.from('%PDF-1.4 x'));
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /PDF/);
});
