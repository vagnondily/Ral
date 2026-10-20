/**
 * Pool de fils de calcul (common/cpuPool) : une tâche PURE tourne sur un autre fil (le fil
 * principal reste libre), un fichier part sans copie, une erreur métier garde son statut,
 * la file est bornée, un fil trop long ou qui tombe est remplacé — sans base.
 */
process.env.LOG_LEVEL = 'silent';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCpuPool, defaultSize, transferable, errorFrom } = require('../src/modules/common/cpuPool');
const { AppError } = require('../src/middleware/errors');
const { parseSubmissions } = require('../src/modules/monitoring/submissionsImport');

test('taille : CPU_POOL_SIZE, sinon min(2, cœurs − 1), au moins 1 ; 0 = sans fil', () => {
  assert.equal(defaultSize({}, 8), 2);
  assert.equal(defaultSize({}, 2), 1);
  assert.equal(defaultSize({}, 1), 1);
  assert.equal(defaultSize({ CPU_POOL_SIZE: '0' }, 8), 0);
  assert.equal(defaultSize({ CPU_POOL_SIZE: '3' }, 8), 3);
  assert.equal(defaultSize({ CPU_POOL_SIZE: 'abc' }, 8), 2);
  assert.equal(defaultSize({ CPU_POOL_SIZE: '99' }, 8), 2);
});

test('une tâche tourne sur un fil : résultat cloné, fil principal libre pendant le calcul', async () => {
  const pool = createCpuPool({ size: 1 });
  try {
    assert.deepEqual(await pool.run('test.echo', [{ a: 1, d: new Date('2026-01-02T00:00:00Z'), list: [1, 'x'] }]),
      { a: 1, d: new Date('2026-01-02T00:00:00Z'), list: [1, 'x'] });
    // 300 ms de calcul sur le fil : le fil principal continue de tourner (minuteries à l'heure).
    let ticks = 0; let worst = 0; let last = Date.now();
    const iv = setInterval(() => { const now = Date.now(); worst = Math.max(worst, now - last); last = now; ticks += 1; }, 10);
    await pool.run('test.spin', [300]);
    clearInterval(iv);
    assert.ok(ticks >= 10, `minuteries exécutées pendant le calcul (${ticks})`);
    assert.ok(worst < 150, `plus long blocage du fil principal ${worst} ms`);
  } finally { await pool.close(); }
});

test('fichier transféré sans copie quand il a son propre tampon ; copié s\'il partage une plage', async () => {
  const pool = createCpuPool({ size: 1 });
  try {
    const own = Buffer.alloc(64 * 1024, 1);
    assert.equal(own.byteOffset, 0);
    assert.equal(await pool.run('test.sum', [own], { transfer: true }), 64 * 1024);
    assert.equal(own.byteLength, 0, 'tampon propre : transféré (détaché ici)');
    const shared = Buffer.from('abc'); // pris dans la plage partagée de Node
    const before = shared.toString();
    assert.equal(await pool.run('test.sum', [shared], { transfer: true }), 97 + 98 + 99);
    assert.equal(shared.toString(), before, 'tampon partagé : copié, jamais détaché');
  } finally { await pool.close(); }
  const slab = Buffer.from('xyz');
  const ab = transferable(slab);
  assert.equal(ab.byteLength, 3);
  assert.equal(Buffer.from(ab).toString(), 'xyz');
});

test('erreur métier : statut et détails gardés (AppError) ; autre erreur : erreur interne', async () => {
  const pool = createCpuPool({ size: 1 });
  try {
    await assert.rejects(pool.run('test.fail', [400]), (e) => e instanceof AppError && e.statusCode === 400 && e.details.code === 'test');
    await assert.rejects(pool.run('test.fail', [null]), (e) => !(e instanceof AppError) && /échec de test/.test(e.message));
    await assert.rejects(pool.run('inconnue', []), /Tâche de calcul inconnue/);
  } finally { await pool.close(); }
  assert.equal(errorFrom({ statusCode: 413, message: 'gros' }).statusCode, 413);
  assert.equal(errorFrom({ statusCode: 200, message: 'x' }) instanceof AppError, false);
});

test('file bornée : au-delà de maxQueue, 503 « réessayez » ; les tâches en file passent dans l\'ordre', async () => {
  const pool = createCpuPool({ size: 1, maxQueue: 1 });
  try {
    const order = [];
    const a = pool.run('test.spin', [150]).then(() => order.push('a'));
    const b = pool.run('test.echo', ['b']).then(() => order.push('b'));
    await assert.rejects(pool.run('test.echo', ['c']), (e) => e.statusCode === 503 && e.pool === true);
    await Promise.all([a, b]);
    assert.deepEqual(order, ['a', 'b']);
    assert.equal(pool.stats().rejectedBusy, 1);
  } finally { await pool.close(); }
});

test('deux fils : deux calculs en parallèle', async () => {
  const pool = createCpuPool({ size: 2 });
  try {
    await Promise.all([pool.run('test.echo', [0]), pool.run('test.echo', [0])]); // fils démarrés
    const t0 = Date.now();
    await Promise.all([pool.run('test.spin', [300]), pool.run('test.spin', [300])]);
    assert.ok(Date.now() - t0 < 550, `en parallèle (${Date.now() - t0} ms)`);
  } finally { await pool.close(); }
});

test('délai dépassé : 503, le fil est remplacé et la tâche suivante passe', async () => {
  const pool = createCpuPool({ size: 1, timeoutMs: 200 });
  try {
    await assert.rejects(pool.run('test.spin', [3000]), (e) => e.statusCode === 503 && /trop long/.test(e.message) && e.pool === true);
    assert.equal(await pool.run('test.echo', ['après']), 'après');
    assert.equal(pool.stats().timeouts, 1);
  } finally { await pool.close(); }
});

test('fil qui s\'arrête net : erreur pour sa tâche, remplacé pour les suivantes', async () => {
  const pool = createCpuPool({ size: 1 });
  try {
    await assert.rejects(pool.run('test.crash', []), (e) => e.pool === true);
    assert.equal(await pool.run('test.echo', [42]), 42);
  } finally { await pool.close(); }
});

test('sans fil (taille 0) : même résultat, même erreur, sur le fil principal', async () => {
  const pool = createCpuPool({ size: 0 });
  assert.equal(await pool.run('test.echo', ['x']), 'x');
  await assert.rejects(pool.run('test.fail', [400]), (e) => e.statusCode === 400);
  await pool.close();
});

test('lecture d\'un fichier de soumissions sur un fil = lecture sur le fil principal', async () => {
  const csv = Buffer.from('_uuid,SvyDate,admin1,score\nu1,2026-01-15,Anosy,3\nu2,2026-02-03,Androy,5\n');
  const direct = await parseSubmissions(Buffer.from(csv));
  const pool = createCpuPool({ size: 1 });
  try {
    const viaPool = await pool.run('parseSubmissions', [Buffer.from(csv), {}], { transfer: true });
    assert.deepEqual(viaPool, direct);
    // Erreur de format : même statut et même message que sur le fil principal.
    const html = Buffer.from('<!doctype html><html><body>page</body></html>');
    const err = await parseSubmissions(html).catch((e) => e);
    await assert.rejects(pool.run('parseSubmissions', [html, {}]), (e) => e instanceof AppError && e.statusCode === err.statusCode && e.message === err.message);
    // Par paquets (comme l'import) : même résultat.
    assert.deepEqual(await pool.run('parseSubmissions', [Buffer.from(csv), {}], { transfer: true, chunkField: 'submissions', chunkSize: 1 }), direct);
  } finally { await pool.close(); }
});

test('grand résultat renvoyé par paquets : même résultat, et le fil principal sert d\'autres travaux entre deux paquets', async () => {
  const pool = createCpuPool({ size: 1 });
  try {
    const whole = await pool.run('test.rows', [1003, 40]);
    // Pendant la réception par paquets, un autre travail (setImmediate en boucle) avance.
    let turns = 0; let stop = false;
    const spin = () => { if (stop) return; turns += 1; setImmediate(spin); };
    setImmediate(spin);
    const parts = await pool.run('test.rows', [1003, 40], { chunkField: 'rows', chunkSize: 100 });
    stop = true;
    assert.deepEqual(parts, whole);
    assert.equal(parts.rows.length, 1003);
    assert.deepEqual(parts.meta, { n: 1003, width: 40 });
    assert.ok(turns >= 11, `au moins un tour de boucle par paquet (${turns})`);
    // Petit tableau (≤ un paquet) ou champ absent : un seul message, même résultat.
    assert.deepEqual(await pool.run('test.rows', [3, 2], { chunkField: 'rows', chunkSize: 100 }), await pool.run('test.rows', [3, 2]));
    assert.deepEqual(await pool.run('test.echo', [{ a: 1 }], { chunkField: 'rows' }), { a: 1 });
    // Le fil reste utilisable après un envoi par paquets.
    assert.equal(await pool.run('test.echo', [7]), 7);
    assert.equal(pool.stats().done, 6);
  } finally { await pool.close(); }
});
