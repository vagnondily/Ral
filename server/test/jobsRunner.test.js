/**
 * Exécuteur des tâches de fond (modules/jobs/jobs.runner) avec un double en mémoire du dépôt
 * (règles de la migration 081) : une tâche en cours par compte, deux au plus ; échec sous la
 * forme de la réponse HTTP ; tâche interrompue par un arrêt → échec clair au redémarrage ;
 * « terminée » dans la transaction de l'écriture (tout ou rien) ; avancement en mémoire.
 */
process.env.LOG_LEVEL = 'silent';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRunner } = require('../src/modules/jobs/jobs.runner');
const { AppError } = require('../src/middleware/errors');
const { createMemoryJobStore } = require('./helpers/memoryJobStore');

const silent = { info() {}, warn() {}, error() {} };
const tick = () => new Promise((r) => { setImmediate(r); });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

function setup(handlers, opts = {}) {
  const store = opts.store || createMemoryJobStore();
  const runner = createRunner({ store, handlers, runner: 'test:1', log: silent, pollMs: 60000, inBackground: (fn) => fn(), ...opts });
  return { store, runner };
}

test('une tâche en file est prise, exécutée et terminée avec son résultat ; son fichier est supprimé', async () => {
  const { store, runner } = setup({ echo: { run: async (job) => ({ got: job.payload.n }) } });
  const { id } = await store.enqueue('t1', { kind: 'echo', payload: { n: 7 }, input: Buffer.from('fichier') });
  assert.equal(store.inputs.size, 1);
  await runner.start();
  await runner.drain();
  runner.stop();
  const job = await store.get('t1', id);
  assert.equal(job.status, 'done');
  assert.deepEqual(job.result, { got: 7 });
  assert.equal(store.inputs.size, 0, 'fichier supprimé à la fin');
});

test('concurrence : jamais deux tâches d\'un même compte à la fois ; deux comptes en parallèle ; deux au plus', async () => {
  const gates = new Map();
  const live = new Set(); let maxLive = 0; const sameTenant = [];
  const handlers = {
    wait: {
      async run(job) {
        for (const other of live) if (other.startsWith(`${job.tenantId}/`)) sameTenant.push([other, job.id]);
        live.add(`${job.tenantId}/${job.id}`); maxLive = Math.max(maxLive, live.size);
        const g = deferred(); gates.set(job.id, g);
        await g.promise;
        live.delete(`${job.tenantId}/${job.id}`);
        return { ok: job.id };
      },
    },
  };
  const { store, runner } = setup(handlers);
  const a1 = await store.enqueue('A', { kind: 'wait' });
  const a2 = await store.enqueue('A', { kind: 'wait' });
  const b1 = await store.enqueue('B', { kind: 'wait' });
  const c1 = await store.enqueue('C', { kind: 'wait' });
  await runner.start();
  await tick();
  assert.deepEqual([...gates.keys()].sort(), [a1.id, b1.id].sort(), 'A et B démarrent ; A2 attend A1 ; C attend une place');
  assert.equal(runner.stats().running, 2);
  gates.get(a1.id).resolve();
  for (let i = 0; i < 20 && !gates.has(a2.id); i += 1) await tick();
  assert.equal(gates.has(a2.id), true, 'A1 terminée : A2 (plus ancienne en file d\'un compte libre) démarre');
  assert.equal(gates.has(c1.id), false);
  gates.get(b1.id).resolve();
  for (let i = 0; i < 20 && !gates.has(c1.id); i += 1) await tick();
  assert.equal(gates.has(c1.id), true);
  gates.get(a2.id).resolve(); gates.get(c1.id).resolve();
  await runner.drain();
  runner.stop();
  assert.deepEqual(sameTenant, []);
  assert.equal(maxLive, 2);
  for (const j of [a1, a2, b1, c1]) assert.equal(store.jobs.get(j.id).status, 'done');
});

test('échec : l\'erreur garde la forme de la réponse HTTP ; bug → 500 générique ; type inconnu → échec', async () => {
  const { store, runner } = setup({
    refuse: { run: async () => { throw new AppError(400, 'Date illisible ligne 3, colonne « SvyDate ».', { invalidDates: [{ line: 3 }] }); } },
    bug: { run: async () => { throw new TypeError('x is undefined (chemin interne /srv/app)'); } },
  });
  const r = await store.enqueue('t1', { kind: 'refuse', input: Buffer.from('a') });
  const b = await store.enqueue('t2', { kind: 'bug' });
  const u = await store.enqueue('t3', { kind: 'inconnu' });
  await runner.start(); await runner.drain(); runner.stop();
  assert.deepEqual((await store.get('t1', r.id)).error,
    { statusCode: 400, message: 'Date illisible ligne 3, colonne « SvyDate ».', details: { invalidDates: [{ line: 3 }] } });
  assert.deepEqual((await store.get('t2', b.id)).error, { statusCode: 500, message: 'Erreur interne du serveur.' });
  assert.deepEqual((await store.get('t3', u.id)).error, { statusCode: 500, message: 'Type de tâche inconnu.' });
  assert.equal(store.inputs.size, 0);
});

test('redémarrage : la tâche restée « en cours » par cet exécuteur passe en échec clair, la file repart', async () => {
  const store = createMemoryJobStore();
  const crashed = await store.enqueue('t1', { kind: 'echo', input: Buffer.from('x') });
  const queued = await store.enqueue('t1', { kind: 'echo' });
  await store.claim('test:1'); // le processus précédent l'avait prise puis s'est arrêté
  const { runner } = setup({ echo: { run: async () => 'ok' } }, { store });
  await runner.start(); await runner.drain(); runner.stop();
  const c = await store.get('t1', crashed.id);
  assert.equal(c.status, 'failed');
  assert.equal(c.error.statusCode, 503);
  assert.match(c.error.message, /interrompue : le serveur s'est arrêté pendant son exécution\. Relancez-la\./);
  assert.equal(store.inputs.size, 0);
  assert.equal((await store.get('t1', queued.id)).status, 'done', 'la tâche suivante du compte tourne');
});

test('tout ou rien : « terminée » dans la transaction de l\'écriture ; tâche déjà close → écriture annulée', async () => {
  const written = [];
  const handlers = {
    write: {
      // Comme importJob : la transaction (simulée) n'est validée que si completeTx réussit.
      async run(job, ctx) {
        const tx = [];
        tx.push(job.payload.row);
        await ctx.completeTx({ fake: 'client' }, { rows: tx.length });
        written.push(...tx); // « COMMIT »
        return { rows: tx.length };
      },
    },
  };
  const { store, runner } = setup(handlers);
  const ok = await store.enqueue('t1', { kind: 'write', payload: { row: 'r1' } });
  await runner.start(); await runner.drain();
  assert.deepEqual((await store.get('t1', ok.id)).result, { rows: 1 });
  assert.deepEqual(written, ['r1']);
  // Tâche déclarée interrompue (battement de cœur tu) PENDANT son exécution : rien n'est écrit.
  const gate = deferred();
  handlers.write.run = async (job, ctx) => {
    await gate.promise;
    await ctx.completeTx({ fake: 'client' }, { rows: 1 }); // lève : plus « en cours »
    written.push(job.payload.row);
    return { rows: 1 };
  };
  const late = await store.enqueue('t1', { kind: 'write', payload: { row: 'r2' } });
  runner.nudge();
  for (let i = 0; i < 20 && store.jobs.get(late.id).status !== 'running'; i += 1) await tick();
  store.jobs.get(late.id).heartbeatAt = new Date(Date.now() - 120000);
  assert.equal(await store.failStale(null, 90), 1);
  gate.resolve();
  await runner.drain(); runner.stop();
  assert.deepEqual(written, ['r1'], 'la seconde écriture est annulée');
  const l = await store.get('t1', late.id);
  assert.equal(l.status, 'failed');
  assert.equal(l.error.code, 'interrupted', 'l\'échec enregistré reste celui de l\'interruption');
});

test('avancement : en mémoire à chaque appel, en base au plus une fois par seconde sauf nouvelle étape', async () => {
  let clock = 1000;
  const gate = deferred();
  const seen = [];
  const handlers = {
    steps: {
      async run(job, ctx) {
        ctx.progress({ step: 'read' });
        for (let done = 100; done <= 500; done += 100) { clock += 200; ctx.progress({ step: 'write', done, total: 500 }); }
        seen.push(runnerRef.progressOf(job.id));
        await gate.promise;
        ctx.progress({ step: 'links' });
        return 'ok';
      },
    },
  };
  const { store, runner } = setup(handlers, { now: () => clock, progressEveryMs: 1000 });
  const runnerRef = runner;
  const { id } = await store.enqueue('t1', { kind: 'steps' });
  await runner.start();
  for (let i = 0; i < 20 && !seen.length; i += 1) await tick();
  assert.deepEqual(seen[0], { step: 'write', done: 500, total: 500 }, 'lu en mémoire par l\'API, toujours à jour');
  // read (écrit), write 100 (nouvelle étape : écrit), 200…500 en 800 ms : pas d'écriture de plus.
  assert.deepEqual(store.calls.setProgress.map((c) => c.progress.step + (c.progress.done ?? '')), ['read', 'write100']);
  gate.resolve();
  await runner.drain(); runner.stop();
  assert.deepEqual(store.calls.setProgress.map((c) => c.progress.step + (c.progress.done ?? '')), ['read', 'write100', 'links']);
  assert.equal((await store.get('t1', id)).status, 'done');
  assert.equal(runner.progressOf(id), null, 'tâche finie : plus d\'avancement en mémoire');
});

test('chaque tâche tourne dans le contexte « de fond » (connexions bornées par le sémaphore)', async () => {
  let wrapped = 0;
  const { store, runner } = setup({ echo: { run: async () => 'ok' } }, { inBackground: (fn) => { wrapped += 1; return fn(); } });
  await store.enqueue('t1', { kind: 'echo' });
  await store.enqueue('t2', { kind: 'echo' });
  await runner.start(); await runner.drain(); runner.stop();
  assert.equal(wrapped, 2);
});
