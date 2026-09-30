const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeVisits } = require('../src/modules/tpm/fieldMath');

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
