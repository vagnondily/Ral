/**
 * Sémaphore des connexions de fond (common/semaphore) et son emploi dans config/db :
 * au plus N transactions de tâches à la fois (le tiers du pool), dans l'ordre d'arrivée ;
 * une transaction ouverte DANS une autre de la même tâche ne reprend pas de jeton.
 */
process.env.LOG_LEVEL = 'silent';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSemaphore, backgroundSlots } = require('../src/modules/common/semaphore');

test('au plus `size` détenteurs ; les suivants attendent, servis dans l\'ordre d\'arrivée', async () => {
  const s = createSemaphore(2);
  const r1 = await s.acquire();
  const r2 = await s.acquire();
  const order = [];
  const p3 = s.acquire().then((r) => { order.push(3); return r; });
  const p4 = s.acquire().then((r) => { order.push(4); return r; });
  await new Promise((r) => { setImmediate(r); });
  assert.deepEqual(s.stats(), { size: 2, held: 2, waiting: 2 });
  assert.deepEqual(order, []);
  r1();
  const r3 = await p3;
  assert.deepEqual(order, [3]);
  r1(); // libérer deux fois ne rend jamais deux jetons
  await new Promise((r) => { setImmediate(r); });
  assert.deepEqual(order, [3], 'le second appel de r1 est sans effet');
  r2();
  const r4 = await p4;
  assert.deepEqual(order, [3, 4]);
  r3(); r4();
  assert.deepEqual(s.stats(), { size: 2, held: 0, waiting: 0 });
});

test('taille invalide refusée ; jetons de fond = JOBS_DB_SLOTS, sinon le tiers de PG_POOL_MAX (≥ 1)', () => {
  for (const bad of [0, -1, 1.5, '2', null]) assert.throws(() => createSemaphore(bad), /taille invalide/);
  assert.equal(backgroundSlots({}), 6);
  assert.equal(backgroundSlots({ PG_POOL_MAX: '30' }), 10);
  assert.equal(backgroundSlots({ PG_POOL_MAX: '2' }), 1);
  assert.equal(backgroundSlots({ PG_POOL_MAX: 'abc' }), 6);
  assert.equal(backgroundSlots({ JOBS_DB_SLOTS: '3', PG_POOL_MAX: '30' }), 3);
  assert.equal(backgroundSlots({ JOBS_DB_SLOTS: '0', PG_POOL_MAX: '9' }), 3);
});

test('config/db : transactions d\'une tâche bornées par le sémaphore, imbrication sans nouveau jeton', async () => {
  process.env.JOBS_DB_SLOTS = '1';
  const dbPath = require.resolve('../src/config/db');
  delete require.cache[dbPath];
  const db = require('../src/config/db');
  delete process.env.JOBS_DB_SLOTS;
  // Pool remplacé par un double : connexions comptées, aucune base.
  let open = 0; let maxOpen = 0;
  db.pool.connect = async () => {
    open += 1; maxOpen = Math.max(maxOpen, open);
    return { query: async () => ({ rows: [] }), release: () => { open -= 1; } };
  };
  const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });
  try {
    const job = (name, log) => db.runInBackground(() => db.withTransaction(async () => {
      log.push(`${name}:début`);
      // Transaction imbriquée de la même tâche (avancement) : pas de nouveau jeton, pas d'attente.
      await db.withTransaction(async () => { log.push(`${name}:imbriquée`); });
      await wait(20);
      log.push(`${name}:fin`);
    }));
    const log = [];
    await Promise.all([job('A', log), job('B', log)]);
    assert.deepEqual(log, ['A:début', 'A:imbriquée', 'A:fin', 'B:début', 'B:imbriquée', 'B:fin'], 'un seul jeton : B attend la fin de A');
    assert.equal(maxOpen, 2, 'A et sa transaction imbriquée seulement');
    assert.deepEqual(db.backgroundStats(), { size: 1, held: 0, waiting: 0 });
    // Hors tâche de fond (requête interactive) : jamais bornée par le sémaphore.
    const inter = [];
    const blocker = db.runInBackground(() => db.withTransaction(async () => { await wait(30); }));
    await wait(5);
    await db.withTransaction(async () => { inter.push('interactive'); });
    assert.deepEqual(inter, ['interactive'], 'une requête passe pendant qu\'une tâche tient le jeton');
    await blocker;
  } finally {
    delete require.cache[dbPath];
  }
});
