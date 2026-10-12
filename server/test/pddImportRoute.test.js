/**
 * Route POST /api/pdd/import, de bout en bout SANS base : le dépôt est
 * remplacé par un espion. Tout ou rien par défaut : une ligne ignorée d'un
 * mois que l'import remplacerait (ou de mois illisible) bloque l'import, rien
 * n'est écrit ; ?partial=1 (« Importer quand même ») force l'écriture.
 */
process.env.NODE_ENV = 'production'; // logger sans transport « pretty » (pas de thread)
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = 'secret-de-test-des-routes-pdd-0123456789abcdef';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const ExcelJS = require('exceljs');
const repo = require('../src/modules/pdd/pdd.repository');
const routes = require('../src/modules/pdd/pdd.routes');
const { errorHandler } = require('../src/middleware/errors');
const { MESSAGES } = require('../src/modules/pdd/pddImport');

const writes = [];
repo.insertDistributions = async (tenantId, userId, rows, opts) => {
  writes.push({ tenantId, rows, opts });
  return { inserted: rows.length, items: rows.reduce((s, r) => s + Object.keys(r.items).length, 0) };
};

const app = express();
app.use('/api/pdd', routes);
app.use(errorHandler);
const TENANT = '11111111-1111-1111-1111-111111111111';
const token = (role = 'manager') => jwt.sign({ sub: 'u1', tenantId: TENANT, role }, process.env.JWT_SECRET);
const upload = (buf, query = '', role) => request(app).post(`/api/pdd/import${query}`)
  .set('Authorization', `Bearer ${token(role)}`).set('Content-Type', 'application/octet-stream').send(buf);

// Modèle MEMS : feuille « PDD base », en-tête ligne 5 (positions réelles).
const HEADERS = { 1: 'Mois', 2: 'Année', 7: 'Activité', 14: 'Région', 15: 'District', 16: 'Commune', 20: 'Bénéficiaires',
  21: 'Ménages', 22: 'Modalité', 27: 'Riz', 28: 'Mais concassé', 29: 'Mais en grain', 30: 'Sorgho', 31: 'LS', 32: 'Huile',
  33: 'MNP', 34: 'P Sup', 35: 'CSB+', 36: 'CSB++', 37: 'P Doz', 38: 'LNS-sq', 39: 'Dattes', 40: 'HEB', 41: 'Total vivres', 43: 'Cash (USD)' };
const row = ({ month = 'octobre', year = 2025, commune = 'Ebelo', riz = 1.5, over = {} } = {}) => ({
  1: month, 2: year, 7: 'GD sécheresse', 14: 'Anosy', 15: 'Amboasary', 16: commune, 20: 120, 21: 24, 22: 'Inkind', 27: riz, 41: riz, ...over,
});
async function workbook(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('PDD base');
  for (const [c, h] of Object.entries(HEADERS)) ws.getRow(5).getCell(Number(c)).value = h;
  rows.forEach((r, i) => { for (const [c, v] of Object.entries(r)) ws.getRow(6 + i).getCell(Number(c)).value = v; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('ligne ignorée d\'un mois remplacé : 400 avec le résumé, RIEN n\'est écrit ; ?partial=1 importe les lignes valides', async () => {
  writes.length = 0;
  const buf = await workbook([row(), row({ commune: 'Ifotaka', riz: { error: '#REF!' } }), row({ month: 'novembre', commune: 'Mahaly' })]);
  const refused = await upload(buf);
  assert.equal(refused.status, 400);
  assert.equal(refused.body.details.code, 'IMPORT_PARTIAL_REFUSED');
  assert.equal(refused.body.details.template, MESSAGES.IMPORT_PARTIAL_REFUSED);
  assert.deepEqual(refused.body.details.params, { blocking: 1 });
  assert.equal(refused.body.details.partialAllowed, true);
  assert.equal(refused.body.details.blocking, 1);
  assert.deepEqual(refused.body.details.skippedRows.map((s) => [s.line, s.month, s.blocking, s.issues[0].code]), [[7, '2025-10-01', true, 'EXCEL_ERROR']]);
  assert.match(refused.body.error, /^1 ligne\(s\) ignorée\(s\) concernent un mois que cet import remplacerait/);
  assert.deepEqual(writes, []);

  const forced = await upload(buf, '?partial=1');
  assert.equal(forced.status, 200, JSON.stringify(forced.body));
  assert.equal(forced.body.partial, true);
  assert.equal(forced.body.inserted, 2);
  assert.equal(forced.body.skipped, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].tenantId, TENANT);
  assert.deepEqual(writes[0].rows.map((r) => r.commune), ['Ebelo', 'Mahaly']);
  assert.deepEqual(writes[0].opts, { source: 'xlsx', replaceMonths: true });
});

test('mois illisible : bloquant aussi (on ne peut pas savoir quel mois il effacerait)', async () => {
  writes.length = 0;
  const res = await upload(await workbook([row(), row({ month: 'Octobr', commune: 'Ifotaka' })]));
  assert.equal(res.status, 400);
  assert.equal(res.body.details.code, 'IMPORT_PARTIAL_REFUSED');
  assert.equal(res.body.details.skippedRows[0].month, null);
  assert.deepEqual(writes, []);
});

test('ligne ignorée d\'un mois NON remplacé : import direct (ce mois n\'est pas touché), ligne listée', async () => {
  writes.length = 0;
  const res = await upload(await workbook([row(), row({ month: 'décembre', commune: 'Ifotaka', riz: -2 })]));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.partial, false);
  assert.equal(res.body.blocking, 0);
  assert.deepEqual(res.body.months, ['2025-10-01']);
  assert.deepEqual(res.body.skippedRows.map((s) => [s.line, s.month, s.blocking]), [[7, '2025-12-01', false]]);
  assert.equal(writes.length, 1);
});

test('fichier propre : import direct, aucune ligne ignorée', async () => {
  writes.length = 0;
  const res = await upload(await workbook([row(), row({ commune: 'Ifotaka', over: { 22: 'Cash', 27: null, 41: 0, 43: 350 } })]));
  assert.equal(res.status, 200);
  assert.equal(res.body.skipped, 0);
  assert.deepEqual(writes[0].rows.map((r) => r.modality), ['Inkind', 'CBT']);
});

test('refus avant lecture : format (par les octets), paramètre invalide, fichier vide, rôle — aucune écriture', async () => {
  writes.length = 0;
  const pdf = await upload(Buffer.from('%PDF-1.7\n1 0 obj'));
  assert.equal(pdf.status, 400);
  assert.equal(pdf.body.details.code, 'IMPORT_NOT_XLSX');
  assert.match(pdf.body.error, /document PDF/);
  const bad = await upload(await workbook([row()]), '?partial=oui');
  assert.equal(bad.status, 400);
  const empty = await upload(Buffer.alloc(0));
  assert.equal(empty.status, 400);
  const viewer = await upload(await workbook([row()]), '', 'viewer');
  assert.equal(viewer.status, 403);
  assert.deepEqual(writes, []);
});

test('disposition non conforme ou aucune ligne valide : 400 codé, aucune écriture', async () => {
  writes.length = 0;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('PDD base');
  for (const [c, h] of Object.entries({ ...HEADERS, 43: 'Cash-MGA' })) ws.getRow(5).getCell(Number(c)).value = h;
  ws.getRow(6).values = ['octobre', 2025];
  const layout = await upload(Buffer.from(await wb.xlsx.writeBuffer()));
  assert.equal(layout.status, 400);
  assert.equal(layout.body.details.code, 'IMPORT_LAYOUT');
  assert.deepEqual(layout.body.details.layoutIssues.map((i) => i.code), ['LAYOUT_CASH_CURRENCY']);
  const none = await upload(await workbook([row({ year: null })]));
  assert.equal(none.status, 400);
  assert.equal(none.body.details.code, 'IMPORT_NO_VALID_ROWS');
  assert.deepEqual(writes, []);
});
