/**
 * insertDistributions sans base : un faux client enregistre les requêtes.
 * Le verrou consultatif de transaction vient AVANT l'effacement des mois :
 * deux imports simultanés du même compte passent l'un après l'autre (sinon
 * chacun vide le mois avant que l'autre n'insère, et les lignes s'additionnent
 * — vérifié sur PostgreSQL : 3 imports parallèles de 300 lignes → 900 sans
 * verrou, 300 avec).
 */
process.env.LOG_LEVEL = 'silent';
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/config/db');

const calls = [];
const fakeRows = new Map(); // motif de la requête → lignes renvoyées
db.withTenantTransaction = async (tenantId, fn) => fn({
  query: async (sql, params) => {
    calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    const hit = [...fakeRows.keys()].find((re) => re.test(sql));
    if (/AS total FROM pdd_distributions/.test(sql)) return { rows: [{ total: 7 }] };
    if (hit) return { rows: fakeRows.get(hit) };
    return { rows: /RETURNING id/.test(sql) ? params.slice(3).filter((_, i) => i % 16 === 0).map((_, i) => ({ id: `d${i}` })) : [] };
  },
});
const repo = require('../src/modules/pdd/pdd.repository'); // après le remplacement (déstructuré au chargement)

test('insertDistributions : verrou consultatif du compte, puis effacement des mois, puis insertions', async () => {
  const T = '11111111-1111-1111-1111-111111111111';
  const rows = [
    { periodMonth: '2025-10-01', activity: 'GD', commune: 'Ebelo', modality: 'Inkind', beneficiaries: 10, items: { Riz: 1.5 } },
    { periodMonth: '2025-11-01', activity: 'GD', commune: 'Ifotaka', modality: 'CBT', cashUsd: 300, items: {} },
  ];
  const res = await repo.insertDistributions(T, 'u1', rows, { source: 'xlsx', replaceMonths: true });
  assert.deepEqual(res, { inserted: 2, items: 1 });
  assert.equal(calls[0].sql, "SELECT pg_advisory_xact_lock(hashtext($1::text || ':pdd-import'))");
  assert.deepEqual(calls[0].params, [T]);
  assert.match(calls[1].sql, /^DELETE FROM pdd_distributions WHERE tenant_id = \$1 AND period_month = ANY/);
  assert.deepEqual(calls[1].params, [T, ['2025-10-01', '2025-11-01']]);
  assert.match(calls[2].sql, /^INSERT INTO pdd_distributions/);
  assert.match(calls[3].sql, /^INSERT INTO pdd_distribution_items/);
});

// ---- Période (lot 1b) -------------------------------------------------------------
const TEN = '11111111-1111-1111-1111-111111111111';

test('liste des distributions : plage semi-ouverte, lecture bornée { rows, total, limit, offset }', async () => {
  calls.length = 0;
  const out = await repo.listDistributions(TEN, { period: { from: '2026-01', to: '2026-06' }, hazard: 'cyclone' }, { limit: 50, offset: 100 });
  assert.equal(out.total, 7);
  assert.equal(out.limit, 50);
  assert.equal(out.offset, 100);
  const [count, page] = calls;
  assert.match(count.sql, /WHERE d\.tenant_id = \$1 AND d\.period_month >= \$2::date AND d\.period_month < \$3::date AND d\.hazard = \$4$/);
  assert.deepEqual(count.params, [TEN, '2026-01-01', '2026-07-01', 'cyclone']);
  assert.match(page.sql, /LIMIT \$5 OFFSET \$6$/);
  assert.deepEqual(page.params, [TEN, '2026-01-01', '2026-07-01', 'cyclone', 50, 100]);
  // Plafond : jamais plus de 5 000 lignes ; l'ancien { month } reste lu (appels internes).
  calls.length = 0;
  const capped = await repo.listDistributions(TEN, { month: '2026-03' }, { limit: 999999 });
  assert.equal(capped.limit, 5000);
  assert.deepEqual(calls[0].params, [TEN, '2026-03-01', '2026-04-01']);
  calls.length = 0;
  await repo.listDistributions(TEN, { period: null });
  assert.match(calls[0].sql, /WHERE d\.tenant_id = \$1$/, 'sans période : toutes');
});

test('synthèse : agrégée en SQL (GROUP BY mois × aléa × zone), cumul + pic mensuel, période en écho', async () => {
  calls.length = 0;
  fakeRows.set(/count\(\*\)::int AS lines/, [
    { periodMonth: '2026-01', hazard: 'cyclone', region: 'R', district: 'D', commune: 'C1', lines: 2, beneficiaries: 100, households: 20, cashUsd: 0, totalFood: 1.5 },
    { periodMonth: '2026-02', hazard: 'cyclone', region: 'R', district: 'D', commune: 'C1', lines: 1, beneficiaries: 300, households: 60, cashUsd: 10, totalFood: 0 },
  ]);
  try {
    const out = await repo.summaryData(TEN, { period: { from: '2026-01', to: '2026-02' } });
    assert.equal(out.total.lines, 3);
    assert.equal(out.total.beneficiaries, 400, 'cumul = bénéficiaires-distributions');
    assert.deepEqual(out.peak, { month: '2026-02', beneficiaries: 300, households: 60 });
    assert.deepEqual(out.period, { from: '2026-01', to: '2026-02', months: 2 });
    assert.deepEqual(out.byMonth['2026-01'].hazards, ['cyclone']);
    assert.match(calls[0].sql, /GROUP BY 1, 2, 3, 4, 5$/);
    assert.match(calls[1].sql, /i\.tenant_id = \$1 AND d\.tenant_id = \$1 AND d\.period_month >= \$2::date/);
    assert.match(calls[1].sql, /GROUP BY 1, 2, 3, 4, 5, 6$/);
  } finally { fakeRows.clear(); }
});

test('pipeline : besoin par mois de la période, stocks saisis avant la fin de la période seulement', async () => {
  calls.length = 0;
  await repo.pipelineData(TEN, { period: { from: '2026-01', to: '2026-03' } });
  assert.match(calls[0].sql, /d\.period_month >= \$2::date AND d\.period_month < \$3::date GROUP BY 1, 2$/);
  assert.deepEqual(calls[0].params, [TEN, '2026-01-01', '2026-04-01']);
  assert.match(calls[1].sql, /FROM pdd_stock WHERE tenant_id = \$1 AND period_month < \$2::date$/);
  assert.deepEqual(calls[1].params, [TEN, '2026-04-01']);
});
