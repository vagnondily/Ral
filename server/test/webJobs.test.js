const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// Tâches de fond côté écran (web/src/lib/jobs.js, module pur) : étape, avancement, tâches de
// l'en-tête, fin détectée entre deux relevés (rechargement de l'écran), cadence des relevés.
const webFile = (...p) => path.join(__dirname, '../../web/src', ...p);
const load = async (t, ...p) => {
  const file = webFile(...p);
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return import(pathToFileURL(file).href);
};

const job = (over) => ({
  id: 'j1', kind: 'monitoring.import', status: 'running', progress: {}, fraction: null,
  payload: { formId: 'f1', formLabel: 'Fiche GD', fileName: 'export.xlsx' }, createdAt: '2026-10-15T08:00:00.000Z', ...over,
});

test('étape et avancement : total connu → %, sans total → barre indéterminée, terminée → 100 %', async (t) => {
  const m = await load(t, 'lib', 'jobs.js'); if (!m) return;
  assert.equal(m.jobStepLabel(job({ status: 'queued' })), 'En attente de démarrage');
  assert.equal(m.jobStepLabel(job({ progress: { step: 'write', done: 2000, total: 5000 } })), 'Écriture des soumissions');
  assert.equal(m.jobStepLabel(job({ progress: { step: 'links' } })), 'Rattachement aux bureaux, lieux et sites');
  assert.equal(m.jobStepLabel(job({ progress: { step: 'inconnue' } })), 'Démarrage');
  assert.equal(m.jobStepLabel(job({ status: 'done' })), 'Terminée');
  assert.equal(m.jobStepLabel(job({ status: 'failed' })), 'Échec');
  assert.equal(m.jobPercent(job({ fraction: 0.4 })), 40);
  assert.equal(m.jobPercent(job({ fraction: 0.999 })), 99, 'jamais 100 % avant la fin');
  assert.equal(m.jobPercent(job({ fraction: null })), null);
  assert.equal(m.jobPercent(job({ status: 'queued', fraction: 0.5 })), null);
  assert.equal(m.jobPercent(job({ status: 'done' })), 100);
  assert.equal(m.jobElapsedSeconds(job({ startedAt: '2026-10-15T08:00:02.000Z' }), Date.parse('2026-10-15T08:00:14.400Z')), 12);
  assert.equal(m.jobElapsedSeconds(job({ startedAt: '2026-10-15T08:00:00.000Z', finishedAt: '2026-10-15T08:00:20.000Z' }), Date.parse('2026-10-15T09:00:00Z')), 20);
});

test('erreur d\'une tâche = erreur d\'API (statut, message, lignes en cause) ; rien si elle a réussi', async (t) => {
  const m = await load(t, 'lib', 'jobs.js'); if (!m) return;
  const e = m.jobError(job({ status: 'failed', error: { statusCode: 400, message: 'Date illisible.', details: { invalidDates: [{ line: 3 }] } } }));
  assert.deepEqual(e, { status: 400, message: 'Date illisible.', details: { invalidDates: [{ line: 3 }] } });
  assert.equal(m.jobError(job({ status: 'done' })), null);
  assert.deepEqual(m.jobError(job({ status: 'failed', error: null })), { status: 500, message: 'Erreur interne du serveur.', details: undefined });
});

test('fin d\'une tâche détectée entre deux relevés ; relevés rapides seulement quand une tâche tourne', async (t) => {
  const m = await load(t, 'lib', 'jobs.js'); if (!m) return;
  const before = [job({ id: 'a' }), job({ id: 'b', status: 'queued' }), job({ id: 'c', status: 'done' })];
  const after = [job({ id: 'a', status: 'done' }), job({ id: 'b', status: 'running' }), job({ id: 'c', status: 'done' }), job({ id: 'd', status: 'failed' })];
  assert.deepEqual(m.finishedSince(before, after).map((j) => j.id), ['a'], 'c était déjà finie, d jamais vue en cours');
  assert.deepEqual(m.finishedSince([job({ id: 'x', status: 'queued' })], [job({ id: 'x', status: 'failed' })]).map((j) => j.id), ['x']);
  assert.equal(m.pollDelay(after), 1500);
  assert.equal(m.pollDelay([job({ status: 'done' })]), 60000);
  assert.equal(m.pollDelay([]), 60000);
});

test('en-tête : actives d\'abord (plus récentes en tête), puis terminées récentes ; fusion d\'une tâche', async (t) => {
  const m = await load(t, 'lib', 'jobs.js'); if (!m) return;
  const list = [
    job({ id: 'done-old', status: 'done', finishedAt: '2026-10-15T08:01:00Z' }),
    job({ id: 'run', createdAt: '2026-10-15T08:02:00Z' }),
    job({ id: 'failed-new', status: 'failed', finishedAt: '2026-10-15T08:05:00Z' }),
    job({ id: 'queued', status: 'queued', createdAt: '2026-10-15T08:03:00Z' }),
  ];
  assert.deepEqual(m.headerJobs(list).map((j) => j.id), ['queued', 'run', 'failed-new', 'done-old']);
  assert.deepEqual(m.headerJobs(list, 2).map((j) => j.id), ['queued', 'run']);
  const merged = m.mergeJob(list, { id: 'run', status: 'done', result: { created: 5 } });
  assert.equal(merged[0].id, 'run');
  assert.equal(merged[0].payload.formId, 'f1', 'champs connus gardés');
  assert.equal(merged.length, 4);
  assert.equal(m.activeJobFor(list, 'monitoring.import', 'f1').id, 'queued');
  assert.equal(m.activeJobFor(list, 'monitoring.import', 'autre'), null);
  assert.deepEqual(m.jobTarget(job({})), ['processus', 'donnees', 'f1', 'importation']);
  assert.deepEqual(m.jobTarget(job({ kind: 'monitoring.reapply' })), ['processus', 'donnees', 'f1', 'mapping']);
  assert.equal(m.jobTarget(job({ payload: {} })), null);
});

test('libellés des tâches traduits en anglais (types, étapes, statuts)', async (t) => {
  const m = await load(t, 'lib', 'jobs.js'); if (!m) return;
  const en = (await load(t, 'locales', 'en.js')).default;
  const phrases = [
    ...Object.values(m.JOB_KIND_LABELS), ...Object.values(m.JOB_STEP_LABELS), ...Object.values(m.JOB_STATUS).map((s) => s.label),
    'Tâche de fond', 'En attente de démarrage', 'Démarrage', 'Terminée', 'Échec',
  ];
  for (const p of phrases) assert.equal(typeof en[p], 'string', `traduction manquante : « ${p} »`);
});
