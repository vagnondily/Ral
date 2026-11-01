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

test('liste des partenaires, fiche et onglet Contrats : le jour LOCAL en paramètre, jamais la date de la session (point D)', () => {
  const src = fs.readFileSync(path.join(SRC, 'partners/partners.repository.js'), 'utf8');
  assert.doesNotMatch(src, /current_date|CURRENT_DATE|now\(\)::date|localtimestamp/, 'partners.repository : date de la session (UTC)');
  // providersList et contractsOf lisent localClock() (common/localDay), comme la fiche.
  for (const fn of ['async function providersList', 'async function contractsOf', 'async function sheet']) {
    const at = src.indexOf(fn);
    assert.ok(at >= 0, fn);
    assert.match(src.slice(at, src.indexOf('\n}\n', at)), /localClock\(\)/, `${fn} : horloge locale`);
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

test('fin de mois à 01 h 30, heure locale : liste et onglet Contrats reçoivent le 1ᵉʳ du mois LOCAL, comme la fiche (point D)', async () => {
  const stub = (rel, exports) => {
    const p = require.resolve(rel);
    const saved = require.cache[p];
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
    return () => { if (saved) require.cache[p] = saved; else delete require.cache[p]; };
  };
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql: String(sql), params: params || [] });
      if (/FROM partners p JOIN partner_types t/.test(sql) && /p\.id = \$2/.test(sql)) return { rows: [{ id: 'p1', name: 'TSARA' }] };
      return { rows: [] };
    },
  };
  // Le 31/10 à 22 h 30 UTC = le 1ᵉʳ novembre à 01 h 30 à Antananarivo : la base dirait encore octobre.
  const restore = [
    stub('../src/modules/common/localDay', { ...require('../src/modules/common/localDay'), localDay: () => '2026-11-01' }),
    stub('../src/config/db', { withTenantTransaction: async (_t, fn) => fn(client), pool: { query: async () => ({ rows: [] }) } }),
  ];
  const repoPath = require.resolve('../src/modules/partners/partners.repository');
  delete require.cache[repoPath];
  try {
    const repo = require('../src/modules/partners/partners.repository');
    await repo.providersList('t1');
    const list = calls.find((c) => /AS "zonesActive"/.test(c.sql));
    assert.deepEqual(list.params.slice(2), ['2026-11-01', '2026-11-01'], 'liste : 1ᵉʳ du mois et jour locaux en paramètres');
    const held = calls.find((c) => /ORDER BY c\.numero_fla NULLS LAST/.test(c.sql));
    assert.deepEqual(held.params, ['t1', '2026-11-01'], 'contrats actifs de la liste : le mois local');
    const out = await repo.contractsOf('t1', 'p1');
    assert.equal(out.today, '2026-11-01', 'onglet Contrats : le jour local, comme la fiche');
  } finally {
    delete require.cache[repoPath];
    for (const r of restore) r();
  }
});
