/**
 * Tâches de fond — règles pures (modules/jobs/jobMachine) : cycle de vie, concurrence (une
 * tâche en cours par compte, deux au plus), forme de l'erreur (celle de la réponse HTTP),
 * avancement borné, tâche montrée par l'API.
 */
process.env.LOG_LEVEL = 'silent';
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../src/modules/jobs/jobMachine');
const { AppError } = require('../src/middleware/errors');

test('cycle de vie : queued → running → done | failed ; une tâche terminée ne change plus', () => {
  assert.equal(m.canTransition('queued', 'running'), true);
  assert.equal(m.canTransition('queued', 'failed'), true);
  assert.equal(m.canTransition('running', 'done'), true);
  assert.equal(m.canTransition('running', 'failed'), true);
  for (const [from, to] of [['queued', 'done'], ['running', 'queued'], ['done', 'failed'], ['failed', 'running'], ['done', 'done'], ['x', 'done']]) {
    assert.equal(m.canTransition(from, to), false, `${from} → ${to}`);
  }
  assert.deepEqual(m.STATUSES.filter(m.isTerminal), ['done', 'failed']);
  assert.deepEqual(m.STATUSES.filter(m.isActive), ['queued', 'running']);
});

test('concurrence : une tâche en cours par compte, deux au plus (JOBS_CONCURRENCY 1 à 4)', () => {
  assert.equal(m.canStart([], 't1'), true);
  assert.equal(m.canStart([{ tenantId: 't1' }], 't1'), false, 'même compte : attend');
  assert.equal(m.canStart([{ tenantId: 't1' }], 't2'), true, 'autre compte : en parallèle');
  assert.equal(m.canStart([{ tenantId: 't1' }, { tenantId: 't2' }], 't3'), false, 'deux en cours : la troisième attend');
  assert.equal(m.canStart(new Map([['a', { tenantId: 't1' }]]), 't2', 1), false);
  assert.equal(m.maxConcurrent({}), 2);
  assert.equal(m.maxConcurrent({ JOBS_CONCURRENCY: '3' }), 3);
  for (const bad of ['0', '5', 'deux', '1.5']) assert.equal(m.maxConcurrent({ JOBS_CONCURRENCY: bad }), 2, bad);
});

test('erreur d\'une tâche = la réponse qu\'aurait donnée la requête, jamais un message interne', () => {
  assert.deepEqual(m.errorRecord(new AppError(400, 'Date illisible ligne 3.', { invalidDates: [{ line: 3 }] })),
    { statusCode: 400, message: 'Date illisible ligne 3.', details: { invalidDates: [{ line: 3 }] } });
  assert.deepEqual(m.errorRecord(Object.assign(new Error('duplicate key value violates unique constraint "x"'), { code: '23505' })),
    { statusCode: 409, message: 'Cette ressource existe déjà.' });
  assert.deepEqual(m.errorRecord(Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' })).statusCode, 503);
  const internal = m.errorRecord(new TypeError('Cannot read properties of undefined (reading \'secret\')'));
  assert.deepEqual(internal, { statusCode: 500, message: 'Erreur interne du serveur.' });
  assert.equal(m.errorRecord(undefined).statusCode, 500);
});

test('avancement borné ; écrit au plus une fois par seconde, sauf changement d\'étape', () => {
  assert.deepEqual(m.progressRecord({ step: 'write', done: 500.7, total: '5000', label: 'x'.repeat(300), extra: { big: 1 } }),
    { step: 'write', done: 500, total: 5000, label: 'x'.repeat(200) });
  assert.deepEqual(m.progressRecord({ done: -1, total: 'abc' }), {});
  const last = { progress: { step: 'write' }, at: 1000 };
  assert.equal(m.shouldPersistProgress(null, { step: 'read' }, 0), true);
  assert.equal(m.shouldPersistProgress(last, { step: 'write' }, 1500), false);
  assert.equal(m.shouldPersistProgress(last, { step: 'write' }, 2000), true);
  assert.equal(m.shouldPersistProgress(last, { step: 'links' }, 1001), true, 'nouvelle étape : écrite tout de suite');
  assert.equal(m.fractionOf({ done: 250, total: 1000 }), 0.25);
  assert.equal(m.fractionOf({ done: 2000, total: 1000 }), 1);
  assert.equal(m.fractionOf({ step: 'links' }), null);
  assert.equal(m.fractionOf({ done: 1, total: 0 }), null);
});

test('tâche montrée par l\'API : ni fichier ni exécuteur ; résultat si terminée, erreur si en échec', () => {
  const row = {
    id: 'j1', tenantId: 't1', kind: 'monitoring.import', status: 'running', progress: { step: 'read' },
    payload: { formId: 'f1', formLabel: 'Fiche GD', fileName: 'export.xlsx', token: 'secret', input: 'x' },
    result: { stale: true }, error: { message: 'x' }, runner: 'host:9000', attempts: 1, dedupeKey: 'k',
    createdBy: 'u1', createdByName: 'Awa', createdAt: '2026-10-15T08:00:00Z', startedAt: '2026-10-15T08:00:01Z',
  };
  const shown = m.publicJob(row, { step: 'write', done: 100, total: 400 });
  assert.deepEqual(shown.payload, { formId: 'f1', formLabel: 'Fiche GD', fileName: 'export.xlsx' });
  assert.deepEqual(shown.progress, { step: 'write', done: 100, total: 400 }, 'avancement en mémoire, plus récent que la base');
  assert.equal(shown.fraction, 0.25);
  assert.equal(shown.result, null);
  assert.equal(shown.error, null);
  for (const k of ['runner', 'attempts', 'dedupeKey', 'tenantId']) assert.equal(k in shown, false, k);
  assert.deepEqual(m.publicJob({ ...row, status: 'done', progress: { step: 'done' } }, { step: 'write' }).result, { stale: true });
  assert.deepEqual(m.publicJob({ ...row, status: 'failed' }).error, { message: 'x' });
  assert.equal(m.publicJob(null), null);
  assert.equal(m.runnerIdentity('serveur-1', 9000), 'serveur-1:9000');
  assert.equal(m.runnerIdentity('', undefined), 'local:');
});
