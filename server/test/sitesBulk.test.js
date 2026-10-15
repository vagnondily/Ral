/**
 * Paramétrage › Sites — actions groupées (retour 62) et suppression protégée (retour 33) :
 * dépôt joué sans base (faux client), verrou des rattachements simulé.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const placeMatch = require('../src/modules/settings/placeMatch.repository');
let client; let reapplied = 0;
placeMatch.withSubmissionLinks = async (_tenant, fn) => fn(client);
placeMatch.afterSitesChangedTx = async () => { reapplied += 1; };
const repo = require('../src/modules/settings/sitesAdmin.repository');

const T = '11111111-1111-1111-1111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OFFICE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/** Faux client : sites existants, données reliées par site ; journal des requêtes. */
function fake({ sites, linked = {}, offices = [OFFICE] }) {
  const calls = [];
  return {
    calls,
    query: async (sql, params = []) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      calls.push({ s, params });
      if (s.startsWith('SELECT id, name FROM sites')) return { rows: sites.filter((x) => params[1].includes(x.id)) };
      if (s.startsWith('SELECT 1 FROM sites')) return { rows: sites.some((x) => x.id === params[1]) ? [{}] : [] };
      if (s.startsWith('SELECT x.site_id')) {
        return { rows: params[1].filter((id) => linked[id]).map((id) => ({ site_id: id, visits: 0, submissions: 0, activation: 0, assignments: 0, ...linked[id] })) };
      }
      if (s.startsWith('SELECT 1 FROM field_offices')) return { rows: offices.includes(params[1]) ? [{}] : [] };
      if (s.startsWith('DELETE FROM sites')) return { rowCount: Array.isArray(params[1]) ? params[1].length : 1 };
      if (s.startsWith('UPDATE sites')) return { rowCount: params[1].length };
      return { rows: [] };
    },
  };
}

test('suppression groupée : seuls les sites sans donnée reliée partent, les autres sont rendus avec leurs comptes', async () => {
  reapplied = 0;
  client = fake({ sites: [{ id: A, name: 'Site A' }, { id: B, name: 'Site B' }, { id: C, name: 'Site C' }], linked: { B: null, [B]: { visits: 2, submissions: 5 } } });
  const r = await repo.bulkSites(T, { ids: [A, B, C], action: 'delete' });
  assert.equal(r.deleted, 2);
  assert.equal(r.keptCount, 1);
  assert.deepEqual(r.keptIds, [B]);
  assert.deepEqual(r.sample.map((x) => [x.id, x.counts.visits, x.counts.submissions]), [[B, 2, 5]]);
  assert.deepEqual(r.byReason, { visits: 1, submissions: 1, activation: 0, assignments: 0 });
  const del = client.calls.find((c) => c.s.startsWith('DELETE FROM sites'));
  assert.deepEqual(del.params, [T, [A, C]], 'un seul DELETE, tenant en $1');
  assert.ok(client.calls[0].s.includes('FOR UPDATE'), 'lignes verrouillées d\'abord');
  assert.equal(reapplied, 1, 'rattachements ré-appliqués une fois');
});

test('suppression groupée : rien de libre → aucun DELETE ni ré-application', async () => {
  reapplied = 0;
  client = fake({ sites: [{ id: A, name: 'Site A' }], linked: { [A]: { activation: 12 } } });
  const r = await repo.bulkSites(T, { ids: [A, B], action: 'delete' });
  assert.equal(r.deleted, 0);
  assert.equal(r.missing, 1, 'un identifiant inconnu (ou d\'un autre compte) est compté, jamais touché');
  assert.ok(!client.calls.some((c) => c.s.startsWith('DELETE')));
  assert.equal(reapplied, 0);
});

test('changement groupé : activité et bureau en un UPDATE ; bureau inconnu refusé', async () => {
  reapplied = 0;
  client = fake({ sites: [{ id: A, name: 'A' }, { id: B, name: 'B' }] });
  const r = await repo.bulkSites(T, { ids: [A, B], action: 'set', patch: { activityTag: 'SMP', fieldOfficeId: OFFICE } });
  assert.equal(r.updated, 2);
  const up = client.calls.find((c) => c.s.startsWith('UPDATE sites'));
  assert.match(up.s, /SET activity = \$3, field_office_id = \$4 WHERE tenant_id = \$1 AND id = ANY\(\$2::uuid\[\]\)/);
  assert.deepEqual(up.params, [T, [A, B], 'SMP', OFFICE]);
  assert.equal(reapplied, 1);
  client = fake({ sites: [{ id: A, name: 'A' }], offices: [] });
  await assert.rejects(() => repo.bulkSites(T, { ids: [A], action: 'set', patch: { fieldOfficeId: OFFICE } }), (e) => e.code === 'BAD_OFFICE');
  client = fake({ sites: [{ id: A, name: 'A' }] });
  const clear = await repo.bulkSites(T, { ids: [A], action: 'set', patch: { activityTag: '' } });
  assert.equal(clear.updated, 1);
  assert.equal(client.calls.find((c) => c.s.startsWith('UPDATE')).params[2], null, 'vide = activité retirée');
});

test('suppression d\'un site : refusée avec les comptes quand il porte des données', async () => {
  client = fake({ sites: [{ id: A, name: 'A' }], linked: { [A]: { submissions: 3 } } });
  const r = await repo.deleteSite(T, A);
  assert.equal(r.outcome, 'linked');
  assert.equal(r.linked.submissions, 3);
  assert.ok(!client.calls.some((c) => c.s.startsWith('DELETE')));
  client = fake({ sites: [{ id: A, name: 'A' }] });
  assert.equal((await repo.deleteSite(T, A)).outcome, 'ok');
  assert.equal((await repo.deleteSite(T, B)).outcome, 'not_found');
});
