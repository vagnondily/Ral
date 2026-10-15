const test = require('node:test');
const assert = require('node:assert/strict');
const places = require('../src/modules/settings/placeMatch.repository');
const partners = require('../src/modules/partners/partners.repository');
const settings = require('../src/modules/settings/settings.repository');

test('agent qui porte des données : suppression refusée (409) par les DEUX écrans, rien d\'effacé', async (t) => {
  const sql = [];
  t.mock.method(places, 'withSubmissionLinks', async (tenantId, fn) => fn({
    query: async (q) => { sql.push(q); return { rows: /AS history/.test(q) ? [{ id: 'a1', history: true }] : [] }; },
  }));
  for (const del of [partners.deleteAgent, settings.deleteAgent]) {
    sql.length = 0;
    await assert.rejects(del('t1', 'p1', 'a1'), (e) => e.statusCode === 409 && /désactivez-le/.test(e.message));
    const check = sql.find((q) => /AS history/.test(q));
    for (const table of ['tpm_agent_formations', 'training_participants', 'tpm_agent_evaluations', 'tpm_assignments', 'monitoring_submissions', 'monitoring_value_links']) {
      assert.match(check, new RegExp(table), `historique : ${table}`);
    }
    assert.ok(!sql.some((q) => /^\s*DELETE/i.test(q)), 'aucune suppression');
  }
});
