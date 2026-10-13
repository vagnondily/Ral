const test = require('node:test');
const assert = require('node:assert/strict');
const { REPAIRS } = require('../src/db/dataRepairs');
const places = require('../src/modules/settings/placeMatch.repository');
const monitoring = require('../src/modules/monitoring/monitoring.repository');

test('réparation R1 : le verrou des rattachements est pris avant toute écriture de site (pas d\'interblocage avec l\'API)', async (t) => {
  const calls = [];
  const stub = (obj, name, ret) => t.mock.method(obj, name, async () => { calls.push(name); return ret; });
  stub(places, 'lockSubmissionLinksTx');
  stub(places, 'applySitesGeoTx', {});
  stub(places, 'applySubmissionsGeoTx', { withOffice: 0, sites: 0 });
  stub(monitoring, 'reliftSubmissionsTx', { updated: 0 });
  const client = { query: async (sql) => { calls.push(sql.trim().split(/\s+/)[0]); return { rows: [{ id: 'f1' }] }; } };
  const r1 = REPAIRS.find((r) => r.key === 'r1_colonnes_reelles_et_sites');
  await r1.run(client, 't1');
  assert.equal(calls[0], 'lockSubmissionLinksTx');
  assert.ok(calls.indexOf('applySitesGeoTx') > 0);
});
