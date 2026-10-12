/**
 * Route POST /api/monitoring/forms/:id/import, de bout en bout SANS base :
 * le dépôt (repository) est remplacé par un espion. On vérifie qu'un fichier
 * refusé ne déclenche AUCUNE écriture (aucun appel au dépôt), et qu'après un
 * refus — y compris l'archive trop grosse — l'API répond toujours.
 */
process.env.NODE_ENV = 'production'; // logger sans transport « pretty » (pas de thread)
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = 'secret-de-test-des-routes-de-suivi-0123456789';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const AdmZip = require('adm-zip');
const ExcelJS = require('exceljs');
const repo = require('../src/modules/monitoring/monitoring.repository');
const routes = require('../src/modules/monitoring/monitoring.routes');
const { errorHandler } = require('../src/middleware/errors');
const { oleFile, biffGlobals } = require('./helpers/oleFixture');
const { buildSav } = require('./helpers/savFixture');

const writes = [];
// Les variables du .sav (catalogue) partent avec les soumissions, dans la même transaction.
repo.importSubmissions = async (tenantId, formId, subs, { variables } = {}) => {
  writes.push({ what: 'submissions', n: subs.length });
  if (variables && variables.length) writes.push({ what: 'catalog', n: variables.length });
  return { received: subs.length, inserted: subs.length };
};
repo.importDefinition = async () => { writes.push({ what: 'definition' }); return { formId: 'f', fields: 1, choices: 0 }; };
repo.importPreview = async (tenantId, formId, ids) => ({ already: ids.filter((x) => x.startsWith('old')).length });

const app = express();
app.use('/api/monitoring', routes);
app.use(errorHandler);
const token = jwt.sign({ sub: 'u1', tenantId: '11111111-1111-1111-1111-111111111111', role: 'manager' }, process.env.JWT_SECRET);
const FORM = '22222222-2222-2222-2222-222222222222';

const upload = (buf, name = 'fichier.csv', path = `/api/monitoring/forms/${FORM}/import`) => request(app).post(path)
  .set('Authorization', `Bearer ${token}`).set('Content-Type', 'application/octet-stream').set('X-Filename', name).send(buf);

const zipOf = (files) => { const z = new AdmZip(); for (const [n, c] of Object.entries(files)) z.addFile(n, Buffer.from(c)); return z.toBuffer(); };
async function xlsform() {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('survey').addRows([['type', 'name', 'label'], ['integer', 'nb', 'Nombre']]);
  wb.addWorksheet('choices').addRows([['list_name', 'name', 'label']]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
function declareSize(zipBuf, size) {
  const b = Buffer.from(zipBuf);
  for (let p = 0; p + 4 <= b.length; p += 1) {
    if (b.readUInt32LE(p) === 0x04034b50) b.writeUInt32LE(size, p + 22);
    else if (b.readUInt32LE(p) === 0x02014b50) b.writeUInt32LE(size, p + 24);
  }
  return b;
}

test('fichiers refusés : 400 qui nomme le format, et aucune écriture', async () => {
  const cases = [
    ['rapport.xls', Buffer.from('<!DOCTYPE html><html><body><table></table></body></html>'), /page web \(HTML\)/],
    ['facture.csv', Buffer.from('%PDF-1.7\n1 0 obj'), /document PDF/],
    ['couverture.docx', zipOf({ '[Content_Types].xml': '<T/>', 'word/document.xml': '<w/>' }), /document Word \(\.docx\)/],
    ['data.sav', Buffer.concat([Buffer.from('$FL3'), Buffer.alloc(400)]), /\.zsav.*\.sav ou \.xlsx/],
    ['export.csv', oleFile(biffGlobals(['data'])), /Excel 97-2003 \(\.xls\)/],
    ['MDG_SMP_Process_Monitoring_Form.xls', oleFile(biffGlobals(['survey', 'choices', 'settings'])), /DÉFINITION.*Importer un XLSForm/],
    ['MDG_GD_Process_Monitoring_Form.xlsx', await xlsform(), /DÉFINITION.*Importer un XLSForm/],
    ['donnees.csv', Buffer.from('_uuid,SvyDate\nu1,2026-05-03\nu2,30/01/2026\n'), /ligne 3, colonne « SvyDate »/],
  ];
  for (const [name, buf, pattern] of cases) {
    const res = await upload(buf, name);
    assert.equal(res.status, 400, `${name} : ${res.body.error}`);
    assert.match(res.body.error, pattern);
  }
  assert.deepEqual(writes, []);
});

test('archive trop grosse une fois décompressée : 413 avant décompression, puis l\'API répond toujours', async () => {
  writes.length = 0;
  const cp = declareSize(zipOf({ 'data.sav': buildSav({ cases: [[1, 'A', 'x']] }) }), 215992459);
  const refusedRes = await upload(cp, 'mdg_cp_monitoring_survey_formation_final.zip');
  assert.equal(refusedRes.status, 413);
  assert.match(refusedRes.body.error, /« data\.sav » ferait 216 Mo.*plafond de 150 Mo/);
  assert.deepEqual(writes, []);

  const ok = await upload(zipOf({ 'data.sav': buildSav({ cases: [[1, 'A', 'x'], [2, 'B', 'y']] }) }), 'export.zip');
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { received: 2, inserted: 2, fields: 3 });
  assert.deepEqual(writes, [{ what: 'submissions', n: 2 }, { what: 'catalog', n: 3 }]);
});

test('plafond réglable par IMPORT_MAX_UNZIPPED_MB (lu à chaque import)', async () => {
  writes.length = 0;
  const cp = declareSize(zipOf({ 'data.sav': buildSav({ cases: [[1, 'A', 'x']] }) }), 215992459);
  process.env.IMPORT_MAX_UNZIPPED_MB = '300';
  process.env.IMPORT_MAX_ZIP_RATIO = '1000000000';
  try {
    assert.equal((await upload(cp, 'cp.zip')).status, 200);
  } finally {
    delete process.env.IMPORT_MAX_UNZIPPED_MB; delete process.env.IMPORT_MAX_ZIP_RATIO;
  }
});

test('un CSV valide passe, quel que soit son nom', async () => {
  writes.length = 0;
  const res = await upload(Buffer.from('_uuid;SvyDate;q1\nu1;2026-05-03;oui\n'), 'export.xlsx');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { received: 1, inserted: 1, fields: 3 });
});

test('import de définition : un fichier de données est renvoyé vers « Importer un fichier »', async () => {
  writes.length = 0;
  const res = await upload(Buffer.from('_uuid,q1\nu1,oui\n'), 'form.xlsx', '/api/monitoring/import-definition');
  assert.equal(res.status, 400);
  assert.match(res.body.error, /n'est pas un XLSForm \(format reconnu : fichier texte \(CSV\)\).*Importer un fichier/);
  const pdf = await upload(Buffer.from('%PDF-1.4'), 'form.xlsx', '/api/monitoring/import-definition');
  assert.match(pdf.body.error, /format reconnu : document PDF/);
  assert.deepEqual(writes, []);
});

test('vérification avant import : ce que contient le fichier, nouvelles / déjà importées, et AUCUNE écriture', async () => {
  writes.length = 0;
  const csv = [
    '_uuid,_submission_time,Field_office,DPName,q1',
    'old-1,2026-05-03T08:00:00,6,EPP A,oui',
    'new-1,2026-05-20T08:00:00,7,EPP B,non',
    'new-1,2026-05-20T08:00:00,7,EPP B,non',
    ',2026-06-02T08:00:00,7,EPP C,oui',
  ].join('\n');
  const res = await upload(Buffer.from(csv), 'export.csv', `/api/monitoring/forms/${FORM}/import/preview`);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.count, 4);
  assert.equal(res.body.source, 'csv');
  assert.equal(res.body.recognized.field_office, 'Field_office');
  assert.equal(res.body.recognized.site, 'DPName');
  assert.equal(res.body.recognized.admin1, null);
  assert.deepEqual(res.body.months, [{ month: '2026-05-01', n: 3 }, { month: '2026-06-01', n: 1 }]);
  assert.equal(res.body.from, '2026-05-03');
  assert.equal(res.body.to, '2026-06-02');
  assert.equal(res.body.duplicatesInFile, 1);
  assert.equal(res.body.withoutId, 1);
  assert.equal(res.body.alreadyImported, 1);
  assert.equal(res.body.newCount, 1);
  assert.equal(res.body.ids, undefined);
  assert.deepEqual(writes, []);
  const bad = await upload(Buffer.from('%PDF-1.4 x'), 'rapport.pdf', `/api/monitoring/forms/${FORM}/import/preview`);
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /PDF/);
});
