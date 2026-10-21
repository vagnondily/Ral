/**
 * « Effacer les planifications » — SQL de clearPlannedTx SANS base (client espion) : le mois courant
 * est un PARAMÈTRE lié (horloge de l'application), jamais now() de la base ; chaque requête lie
 * exactement les paramètres qu'elle lit ; sans mois courant, refus.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { clearPlannedTx, CLEARABLE_SQL } = require('../src/modules/tpm/planAuto.repository');

const TENANT = '00000000-0000-0000-0000-000000000001';
const refs = (sql) => [...new Set([...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);

function spy() {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      return /^\s*DELETE/.test(sql) ? { rowCount: 2, rows: [] } : { rows: [{ n: 5 }] };
    },
  };
}

test('mois courant lié en paramètre (jamais now()) ; chaque requête lie ce qu\'elle lit', async () => {
  for (const scope of [{}, { district: 'Ambovombe', activity: 'Cantines' }]) {
    const client = spy();
    const res = await clearPlannedTx(client, TENANT, { year: 2026, from: 1, to: 12, risk: 'elevee', scope, nowMonth: '2026-11' });
    assert.deepEqual(res, { deleted: 2, kept: 5 });
    const [del, count] = client.calls;
    // Lignes verrouillées par identifiant croissant (ordre de mems_tpm_stamp), jamais dans l'ordre du parcours.
    assert.match(del.sql, /^DELETE FROM site_visits WHERE tenant_id = \$1 AND id IN \(\s*SELECT v\.id FROM site_visits v WHERE /);
    assert.match(del.sql, /ORDER BY v\.id FOR UPDATE OF v\)$/);
    assert.doesNotMatch(del.sql, /now\(\)|current_date/i, 'jamais l\'horloge de la base');
    assert.equal(del.params.at(-1), '2026-11-01');
    assert.match(del.sql, new RegExp(`v\\.period_month >= \\$${del.params.length}::date`));
    for (const q of [del, count]) assert.deepEqual(refs(q.sql), q.params.map((_, i) => i + 1), q.sql.slice(0, 40));
    assert.deepEqual(count.params, del.params.slice(0, -1));
  }
  assert.match(CLEARABLE_SQL('$9'), /v\.period_month >= \$9::date/);
});

test('sans mois courant (ou illisible) : refus, rien n\'est lancé', async () => {
  for (const nowMonth of [undefined, null, '2026-13', '2026-1', 'novembre']) {
    const client = spy();
    await assert.rejects(clearPlannedTx(client, TENANT, { year: 2026, from: 1, to: 12, nowMonth }), /mois courant requis/);
    assert.equal(client.calls.length, 0);
  }
});
