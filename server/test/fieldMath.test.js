const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeVisits, collectionDays } = require('../src/modules/tpm/fieldMath');

test('coverage excludes cancelled visits and splits by provider/district', () => {
  const visits = [
    { status: 'realise', providerId: 'p1', district: 'A', activity: 'Cantines' },
    { status: 'planifie', providerId: 'p1', district: 'A', activity: 'Cantines' },
    { status: 'realise', providerId: 'p2', district: 'B', activity: 'PECMM' },
    { status: 'annule', providerId: 'p2', district: 'B', activity: 'PECMM' },
    { status: 'planifie', providerId: null, district: 'A', activity: 'Cantines' },
  ];
  const s = summarizeVisits(visits, { p1: 'YPA', p2: 'SAHY' });
  assert.equal(s.overall.total, 5);
  assert.equal(s.overall.realise, 2);
  assert.equal(s.overall.planifie, 2);
  assert.equal(s.overall.annule, 1);
  assert.equal(s.overall.active, 4);            // annulée exclue
  assert.equal(Math.round(s.overall.rate * 100), 50); // 2/4
  const p1 = s.byProvider.find((r) => r.key === 'p1');
  assert.equal(p1.label, 'YPA');
  assert.equal(p1.realise, 1);
  const na = s.byProvider.find((r) => r.key === 'non_affecte');
  assert.equal(na.label, 'Non affecté');
  assert.equal(s.byDistrict.find((r) => r.key === 'A').total, 3);
});

test('empty list yields zero coverage', () => {
  const s = summarizeVisits([]);
  assert.equal(s.overall.total, 0);
  assert.equal(s.overall.rate, 0);
  assert.deepEqual(s.byProvider, []);
});

test('collectionDays = dated visits + manual travel days, per provider', () => {
  const visits = [
    { providerId: 'p1', status: 'planifie', visitDate: '2026-09-02' },
    { providerId: 'p1', status: 'realise', visitDate: '2026-09-03' },
    { providerId: 'p1', status: 'planifie', visitDate: null },       // no date → not counted
    { providerId: 'p1', status: 'annule', visitDate: '2026-09-04' }, // cancelled → not counted
    { providerId: 'p2', status: 'planifie', visitDate: '2026-09-05' },
    { providerId: null, status: 'planifie', visitDate: '2026-09-06' }, // unassigned → ignored
  ];
  const rows = collectionDays(visits, { p1: 2, p2: 0 }, { p1: 'YPA', p2: 'SAHY' });
  const p1 = rows.find((r) => r.providerId === 'p1');
  assert.equal(p1.label, 'YPA');
  assert.equal(p1.visitDays, 2);
  assert.equal(p1.travelDays, 2);
  assert.equal(p1.totalDays, 4);       // 2 visites + 2 déplacement
  const p2 = rows.find((r) => r.providerId === 'p2');
  assert.equal(p2.visitDays, 1);
  assert.equal(p2.totalDays, 1);
});

const { buildCoverageMatrix, coverageRate } = require('../src/modules/tpm/fieldMath');

test('coverageRate excludes cancelled from the denominator and is null when empty', () => {
  assert.deepEqual(coverageRate(2, 3), { planifie: 2, realise: 3, active: 5, rate: 3 / 5 });
  assert.equal(coverageRate(0, 0).rate, null);
});

test('buildCoverageMatrix shapes 12-month rows per group with group/month/global totals', () => {
  const rows = [
    { month: '2026-01', key: 'Cantines', label: 'Cantines', planifie: 4, realise: 1 },
    { month: '2026-02', key: 'Cantines', label: 'Cantines', planifie: 0, realise: 3 },
    { month: '2026-01', key: 'PREVMA', label: 'PREVMA', planifie: 2, realise: 2 },
  ];
  const m = buildCoverageMatrix(rows, 2026);
  assert.equal(m.months.length, 12);
  assert.equal(m.groups.length, 2);
  const cant = m.groups.find((g) => g.key === 'Cantines');
  assert.equal(cant.cells.length, 12);
  assert.equal(cant.cells[0].rate, 1 / 5);          // janvier : 1/(4+1)
  assert.equal(cant.cells[1].rate, 1);              // février : 3/3
  assert.equal(cant.cells[2].rate, null);           // mars : aucune visite
  assert.equal(cant.total.realise, 4);
  assert.equal(m.monthlyTotals[0].active, 9);       // 5 (Cantines : 4+1) + 4 (PREVMA : 2+2) en janvier
  assert.equal(m.total.realise, 6);                 // 1+3+2
  // tri par réalisées décroissantes : Cantines (4) avant PREVMA (2)
  assert.equal(m.groups[0].key, 'Cantines');
});
