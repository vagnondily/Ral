const test = require('node:test');
const assert = require('node:assert/strict');
const { createSiteTx, upsertSites } = require('../src/modules/tpm/field.repository');
const { AppError } = require('../src/middleware/errors');

const TENANT = '00000000-0000-0000-0000-000000000001';

/** Client pg simulé : enregistre chaque requête, répond selon `reply(sql, params)`. */
function fakeClient(reply) {
  const calls = [];
  return {
    calls,
    async query(sql, params) { calls.push({ sql, params }); return reply(sql, params); },
  };
}

test('rbm-38 : POST /sites sur un site existant → 409 avec son id, aucune écriture (ni fusion, ni effacement)', async () => {
  const client = fakeClient((sql) => (sql.startsWith('SELECT id FROM sites') ? { rows: [{ id: 'site-existant' }] } : assert.fail(`écriture inattendue : ${sql}`)));
  await assert.rejects(
    createSiteTx(client, TENANT, { district: 'Ambovombe', commune: 'Ambazoa', name: 'EPP Ambazoa' }),
    (err) => err instanceof AppError && err.statusCode === 409 && err.details.siteId === 'site-existant' && /existe déjà/.test(err.message)
  );
  assert.equal(client.calls.length, 1, 'seule la vérification a été exécutée');
  assert.deepEqual(client.calls[0].params, [TENANT, 'ambovombe--ambazoa--epp-ambazoa']);
});

test('rbm-38 : site nouveau → simple INSERT, jamais d\'ON CONFLICT … DO UPDATE ; fokontany absent = NULL à la création seulement', async () => {
  // Après l'INSERT, les rattachements communs (afterSitesChangedTx) s'exécutent dans la même
  // transaction : registre et file simulés vides.
  const client = fakeClient((sql) => {
    if (sql.startsWith('SELECT id FROM sites')) return { rows: [] };
    if (/^\s*INSERT INTO sites/.test(sql)) return { rows: [{ id: 'nouveau' }] };
    return { rows: [], rowCount: 0 };
  });
  const id = await createSiteTx(client, TENANT, { district: 'Ambovombe', commune: 'Ambazoa', name: 'EPP Ambazoa', activity: 'Cantines' });
  assert.equal(id, 'nouveau');
  const insert = client.calls[1];
  assert.match(insert.sql, /^\s*INSERT INTO sites/);
  assert.doesNotMatch(insert.sql, /ON CONFLICT|UPDATE/i);
  assert.deepEqual(insert.params, [TENANT, 'ambovombe--ambazoa--epp-ambazoa', 'Ambovombe', 'Ambazoa', null, 'EPP Ambazoa', 'Cantines']);
  assert.equal(client.calls.filter((c) => /INSERT INTO sites/.test(c.sql)).length, 1, 'un seul INSERT de site');
});

test('rbm-38 : une erreur des rattachements après l\'INSERT n\'est jamais présentée comme « site existant »', async () => {
  const client = fakeClient((sql) => {
    if (sql.startsWith('SELECT id FROM sites')) return { rows: [] };
    if (/^\s*INSERT INTO sites/.test(sql)) return { rows: [{ id: 'nouveau' }] };
    throw Object.assign(new Error('duplicate key value violates unique constraint "autre_table"'), { code: '23505' });
  });
  await assert.rejects(createSiteTx(client, TENANT, { district: 'D', commune: 'C', name: 'N' }),
    (err) => !(err instanceof AppError) && err.code === '23505');
});

test('rbm-38 : création simultanée du même site (contrainte unique) → 409 explicite, jamais 500', async () => {
  const client = fakeClient((sql) => {
    if (sql.startsWith('SELECT id FROM sites')) return { rows: [] };
    throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
  });
  await assert.rejects(createSiteTx(client, TENANT, { district: 'D', commune: 'C', name: 'N' }),
    (err) => err instanceof AppError && err.statusCode === 409 && err.details === undefined);
  // Une autre erreur base n'est pas masquée.
  const broken = fakeClient((sql) => { if (sql.startsWith('SELECT')) return { rows: [] }; throw Object.assign(new Error('boom'), { code: '23514' }); });
  await assert.rejects(createSiteTx(broken, TENANT, { district: 'D', commune: 'C', name: 'N' }), (err) => err.code === '23514');
});

test('rbm-38 : l\'import de planning complète un site existant sans rien écraser ni effacer', async () => {
  const client = fakeClient(() => ({ rows: [{ id: 'site-1', inserted: false }] }));
  const { map, inserted } = await upsertSites(client, TENANT, [{ district: 'Ambovombe', commune: 'Ambazoa', name: 'EPP Ambazoa' }]);
  assert.equal(map.get('Ambovombe|Ambazoa|EPP Ambazoa'), 'site-1');
  assert.equal(inserted, 0);
  const { sql, params } = client.calls[0];
  // Fokontany absent de la ligne importée : envoyé NULL, mais jamais affecté tel quel au site existant.
  assert.equal(params[4], null);
  const merge = sql.slice(sql.indexOf('DO UPDATE SET') + 'DO UPDATE SET'.length, sql.indexOf('RETURNING'));
  const assigned = [...merge.matchAll(/(\w+) = (COALESCE\([^)]*\)|[^,]+)/g)];
  assert.deepEqual(assigned.map((m) => m[1]).sort(), ['activity', 'adm2', 'adm3', 'adm4', 'field_office_id', 'fokontany']);
  // Chaque colonne garde la valeur du registre et ne prend celle de l'import que si elle est vide.
  for (const [, col, expr] of assigned) assert.equal(expr, `COALESCE(sites.${col}, EXCLUDED.${col})`, `colonne écrasée par l'import : ${col}`);
});
