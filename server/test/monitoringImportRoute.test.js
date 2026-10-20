/**
 * Route POST /api/monitoring/forms/:id/import, de bout en bout SANS base :
 * le dépôt (repository) est remplacé par un espion et le dépôt des tâches de fond par un
 * double en mémoire (règles de la migration 081). On vérifie qu'un fichier refusé par sa
 * forme est refusé TOUT DE SUITE (400 / 413), sans tâche ni écriture ; qu'un fichier accepté
 * répond 202 avec l'identifiant de la tâche, puis que la tâche se termine avec LE MÊME
 * résultat que rendait la requête ; qu'une erreur du contenu (date illisible) devient
 * l'échec de la tâche, avec la même réponse, et rien d'écrit ; et qu'après un refus — y
 * compris l'archive trop grosse — l'API répond toujours.
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
const jobsRoutes = require('../src/modules/jobs/jobs.routes');
const jobsRepo = require('../src/modules/jobs/jobs.repository');
const jobs = require('../src/modules/jobs/jobs.service');
const { errorHandler } = require('../src/middleware/errors');
const { createMemoryJobStore, installMemoryJobStore } = require('./helpers/memoryJobStore');
const { oleFile, biffGlobals } = require('./helpers/oleFixture');
const { buildSav } = require('./helpers/savFixture');

const writes = [];
let lastHeaders = null; // colonnes du fichier transmises au dépôt (colonne choisie absente : signalée)
// Les variables du .sav (catalogue) partent avec les soumissions, dans la même transaction.
// Comme le vrai dépôt : la tâche est marquée terminée DANS la transaction (beforeCommit), puis
// l'écriture est validée.
repo.importSubmissions = async (tenantId, formId, subs, { variables, headers, beforeCommit } = {}) => {
  lastHeaders = headers;
  const out = { received: subs.length, inserted: subs.length };
  if (beforeCommit) await beforeCommit({ fake: 'client' }, out);
  writes.push({ what: 'submissions', n: subs.length });
  if (variables && variables.length) writes.push({ what: 'catalog', n: variables.length });
  return out;
};
repo.formLabel = async (tenantId, formId) => (formId === FORM ? { id: FORM, label: 'Fiche de test' } : null);
repo.importDefinition = async () => { writes.push({ what: 'definition' }); return { formId: 'f', fields: 1, choices: 0 }; };
repo.setCorrespondence = async (tenantId, userId, formId, input) => { writes.push({ what: 'correspondence', input }); return { submissions: 3 }; };
repo.formCorrespondences = async () => ({ rows: [], options: [] });

const app = express();
app.use(express.json()); // comme src/app.js (les envois de fichiers restent en octet-stream)
app.use('/api/monitoring', routes);
app.use('/api/jobs', jobsRoutes);
app.use(errorHandler);
const token = jwt.sign({ sub: 'u1', tenantId: '11111111-1111-1111-1111-111111111111', role: 'manager' }, process.env.JWT_SECRET);
const otherTenant = jwt.sign({ sub: 'u9', tenantId: '99999999-9999-9999-9999-999999999999', role: 'admin' }, process.env.JWT_SECRET);
const FORM = '22222222-2222-2222-2222-222222222222';

// Tâches de fond : dépôt en mémoire, exécuteur intégré démarré comme par server.js.
const store = createMemoryJobStore();
const restoreStore = installMemoryJobStore(jobsRepo, store);
test.before(() => jobs.startRunner({ runner: 'test:import', pollMs: 25 }));
test.after(() => { jobs.stopRunner(); restoreStore(); });

/** Attend la fin d'une tâche, lue comme l'interface : GET /api/jobs/:id. */
async function finished(jobId, auth = token) {
  for (let i = 0; i < 400; i += 1) {
    const res = await request(app).get(`/api/jobs/${jobId}`).set('Authorization', `Bearer ${auth}`);
    assert.equal(res.status, 200, res.body.error);
    if (res.body.status === 'done' || res.body.status === 'failed') return res.body;
    await new Promise((r) => { setTimeout(r, 10); });
  }
  throw new Error(`tâche ${jobId} jamais terminée`);
}
/** Import accepté : 202 + identifiant de tâche, puis la tâche terminée. */
async function accepted(res) {
  assert.equal(res.status, 202, res.body.error);
  assert.match(res.body.jobId, /^[0-9a-f-]{36}$/);
  return finished(res.body.jobId);
}

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

test('fichiers refusés par leur forme : 400 tout de suite qui nomme le format, ni tâche ni écriture', async () => {
  const cases = [
    ['rapport.xls', Buffer.from('<!DOCTYPE html><html><body><table></table></body></html>'), /page web \(HTML\)/],
    ['facture.csv', Buffer.from('%PDF-1.7\n1 0 obj'), /document PDF/],
    ['couverture.docx', zipOf({ '[Content_Types].xml': '<T/>', 'word/document.xml': '<w/>' }), /document Word \(\.docx\)/],
    ['data.sav', Buffer.concat([Buffer.from('$FL3'), Buffer.alloc(400)]), /\.zsav.*\.sav ou \.xlsx/],
    ['export.csv', oleFile(biffGlobals(['data'])), /Excel 97-2003 \(\.xls\)/],
    ['MDG_SMP_Process_Monitoring_Form.xls', oleFile(biffGlobals(['survey', 'choices', 'settings'])), /DÉFINITION.*Importer un XLSForm/],
    ['MDG_GD_Process_Monitoring_Form.xlsx', await xlsform(), /DÉFINITION.*Importer un XLSForm/],
    ['vide.csv', Buffer.alloc(0), /Fichier vide/],
  ];
  for (const [name, buf, pattern] of cases) {
    const res = await upload(buf, name);
    assert.equal(res.status, 400, `${name} : ${res.body.error}`);
    assert.match(res.body.error, pattern);
  }
  assert.deepEqual(writes, []);
  assert.equal(store.jobs.size, 0, 'aucune tâche mise en file');
});

test('erreur du contenu (date illisible) : la tâche échoue avec la réponse qu\'aurait donnée la requête, rien d\'écrit', async () => {
  writes.length = 0;
  const job = await accepted(await upload(Buffer.from('_uuid,SvyDate\nu1,2026-05-03\nu2,30/01/2026\n'), 'donnees.csv'));
  assert.equal(job.status, 'failed');
  assert.equal(job.error.statusCode, 400);
  assert.match(job.error.message, /ligne 3, colonne « SvyDate »/);
  assert.equal(job.result, null);
  assert.deepEqual(writes, []);
  assert.equal(store.inputs.size, 0, 'fichier de la tâche supprimé');
});

test('fiche inconnue : 404 tout de suite, aucune tâche', async () => {
  const before = store.jobs.size;
  const res = await upload(Buffer.from('_uuid;q1\nu1;oui\n'), 'export.csv', '/api/monitoring/forms/33333333-3333-3333-3333-333333333333/import');
  assert.equal(res.status, 404);
  assert.equal(store.jobs.size, before);
});

test('archive trop grosse une fois décompressée : 413 avant décompression, puis l\'API répond toujours', async () => {
  writes.length = 0;
  const cp = declareSize(zipOf({ 'data.sav': buildSav({ cases: [[1, 'A', 'x']] }) }), 215992459);
  const refusedRes = await upload(cp, 'mdg_cp_monitoring_survey_formation_final.zip');
  assert.equal(refusedRes.status, 413);
  assert.match(refusedRes.body.error, /« data\.sav » ferait 216 Mo.*plafond de 150 Mo/);
  assert.deepEqual(writes, []);

  const job = await accepted(await upload(zipOf({ 'data.sav': buildSav({ cases: [[1, 'A', 'x'], [2, 'B', 'y']] }) }), 'export.zip'));
  assert.equal(job.status, 'done', job.error && job.error.message);
  // Résultat de la tâche = la réponse que rendait la requête synchrone.
  assert.deepEqual(job.result, { received: 2, inserted: 2, fields: 3 });
  assert.deepEqual(job.payload, { formId: FORM, formLabel: 'Fiche de test', fileName: 'export.zip' });
  assert.equal(job.kind, 'monitoring.import');
  assert.deepEqual(writes, [{ what: 'submissions', n: 2 }, { what: 'catalog', n: 3 }]);
  assert.equal(lastHeaders.length, 3, 'variables du .sav transmises comme colonnes du fichier');
  assert.equal(store.inputs.size, 0, 'fichier de la tâche supprimé une fois terminée');
});

test('plafond réglable par IMPORT_MAX_UNZIPPED_MB (lu à chaque import)', async () => {
  writes.length = 0;
  const cp = declareSize(zipOf({ 'data.sav': buildSav({ cases: [[1, 'A', 'x']] }) }), 215992459);
  process.env.IMPORT_MAX_UNZIPPED_MB = '300';
  process.env.IMPORT_MAX_ZIP_RATIO = '1000000000';
  try {
    // Contrôle à l'envoi ET lecture par la tâche : le même plafond.
    assert.equal((await accepted(await upload(cp, 'cp.zip'))).status, 'done');
  } finally {
    delete process.env.IMPORT_MAX_UNZIPPED_MB; delete process.env.IMPORT_MAX_ZIP_RATIO;
  }
});

test('un CSV valide passe, quel que soit son nom', async () => {
  writes.length = 0;
  const job = await accepted(await upload(Buffer.from('_uuid;SvyDate;q1\nu1;2026-05-03;oui\n'), 'export.xlsx'));
  assert.deepEqual(job.result, { received: 1, inserted: 1, fields: 3 });
  // Les colonnes du fichier vont au dépôt : une colonne choisie dans « Mapping MEMS » absente est
  // signalée à l'import comme à la vérification (même règle, submissionsImport.missingOverrides).
  assert.deepEqual(lastHeaders, ['_uuid', 'SvyDate', 'q1']);
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

// Vérification avant import (même préparation que l'import, sans écriture) : monitoringImportPreview.test.js.

test('correspondances : dimension et cible contrôlées à l\'entrée, aucune écriture si invalide', async () => {
  writes.length = 0;
  const put = (body) => request(app).put(`/api/monitoring/forms/${FORM}/correspondences`).set('Authorization', `Bearer ${token}`).send(body);
  assert.equal((await put({ dimension: 'partner', raw: '6', mode: 'link' })).status, 400);              // relier sans cible
  assert.equal((await put({ dimension: 'partner', raw: '6', mode: 'auto', targetId: FORM })).status, 400); // cible sans « relier »
  assert.equal((await put({ dimension: 'region', raw: '6', mode: 'auto' })).status, 400);
  assert.equal((await put({ dimension: 'partner', raw: '', mode: 'ignore' })).status, 400);
  assert.deepEqual(writes, []);
  const ok = await put({ dimension: 'partner', raw: '6', mode: 'link', targetId: FORM });
  assert.equal(ok.status, 200);
  assert.equal(writes[0].input.targetId, FORM);
  const get = (q) => request(app).get(`/api/monitoring/forms/${FORM}/correspondences${q}`).set('Authorization', `Bearer ${token}`);
  assert.equal((await get('?dimension=region')).status, 400);
  assert.equal((await get('?dimension=agent')).status, 200);
});

test('tâches : chaque compte ne voit que les siennes (liste et détail)', async () => {
  const job = await accepted(await upload(Buffer.from('_uuid;q1\nu7;oui\n'), 'mine.csv'));
  const mine = await request(app).get('/api/jobs').set('Authorization', `Bearer ${token}`);
  assert.equal(mine.status, 200);
  assert.ok(mine.body.items.some((j) => j.id === job.id));
  const other = await request(app).get('/api/jobs').set('Authorization', `Bearer ${otherTenant}`);
  assert.deepEqual(other.body.items, []);
  assert.equal((await request(app).get(`/api/jobs/${job.id}`).set('Authorization', `Bearer ${otherTenant}`)).status, 404);
  assert.equal((await request(app).get('/api/jobs/pas-un-uuid').set('Authorization', `Bearer ${token}`)).status, 400);
  assert.equal((await request(app).get('/api/jobs?recent=abc').set('Authorization', `Bearer ${token}`)).status, 400);
});

test('réappliquer le mapping : 202 puis la tâche rend le résultat de la réapplication ; fiche inconnue → 404', async () => {
  const seen = [];
  repo.applyMappingToSubmissions = async (tenantId, formId, { beforeCommit, waitMs } = {}) => {
    seen.push({ tenantId, formId, waitMs });
    const out = { applied: 2, updated: 10, dates: { total: 10, monthChanged: 1, updated: 1 }, geo: { offices: 3 } };
    if (beforeCommit) await beforeCommit({ fake: 'client' }, out);
    return out;
  };
  const post = (form) => request(app).post(`/api/monitoring/forms/${form}/mems-mapping/apply`).set('Authorization', `Bearer ${token}`);
  const job = await accepted(await post(FORM));
  assert.equal(job.status, 'done');
  assert.equal(job.kind, 'monitoring.reapply');
  assert.deepEqual(job.result, { applied: 2, updated: 10, dates: { total: 10, monthChanged: 1, updated: 1 }, geo: { offices: 3 } });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].formId, FORM);
  assert.ok(seen[0].waitMs >= 60000, 'la tâche attend le verrou des rattachements plus longtemps qu\'une requête');
  assert.equal((await post('33333333-3333-3333-3333-333333333333')).status, 404);
  assert.equal((await post('pas-un-uuid')).status, 400);
});
