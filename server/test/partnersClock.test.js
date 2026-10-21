/**
 * Un seul mois courant (revue croisée #26) : partenaires et contrats lisent l'horloge du serveur
 * (common/localDay, via rbmMath.currentMonth) — jamais leur propre Intl ni le mois UTC ; un fuseau
 * invalide se replie sur UTC au lieu de lever (un changement de rôle ne répond jamais 500 pour ça).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../src/modules');
const FILES = ['partners/partnerRole.js', 'partners/partners.routes.js', 'contracts/contracts.service.js'];

test('partenaires et contrats : aucune horloge à eux (ni Intl.DateTimeFormat, ni mois UTC)', () => {
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(SRC, f), 'utf8');
    assert.doesNotMatch(src, /new Intl\.DateTimeFormat/, `${f} : horloge propre`);
    assert.doesNotMatch(src, /toISOString\(\)\.slice\(0, ?7\)/, `${f} : mois UTC`);
  }
});

test('changement de rôle avec un APP_TIMEZONE invalide : réestampille au mois courant (repli UTC), jamais une exception', async () => {
  const saved = process.env.APP_TIMEZONE;
  process.env.APP_TIMEZONE = 'Pas/Un_Fuseau';
  try {
    let scope = null;
    const repoPath = require.resolve('../src/modules/tpm/tpmAttribution.repository');
    require.cache[repoPath] = { id: repoPath, filename: repoPath, loaded: true, exports: { restampVisitsTx: async (_c, _t, s) => { scope = s; } } };
    const { restampIfRoleChangedTx } = require('../src/modules/partners/partnerRole');
    const changed = await restampIfRoleChangedTx({ query: async () => ({ rows: [] }) }, 't', { partnerTypeId: 'a', active: true }, { partnerTypeId: 'b', active: true });
    assert.equal(changed, true);
    assert.deepEqual(scope, { fromMonth: new Date().toISOString().slice(0, 7) });
  } finally {
    if (saved === undefined) delete process.env.APP_TIMEZONE; else process.env.APP_TIMEZONE = saved;
  }
});
