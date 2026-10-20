const test = require('node:test');
const assert = require('node:assert/strict');
const u = require('../src/modules/tpm/tpmUnavailability');
const a = require('../src/modules/tpm/tpmAttribution');

const row = (over) => ({ id: 'u1', providerId: 'rano', providerName: 'RANO Control', month: '2026-11', reason: 'Équipe mobilisée sur une urgence', batchId: 'b1', updatedAt: '2026-10-20T08:00:00.000Z', ...over });

test('periodsOf : mois consécutifs d un même TPM, même lot et même motif → une période ; un trou ou un autre motif → deux', () => {
  const rows = [
    row({ id: 'u3', month: '2027-01' }), row({ id: 'u1', month: '2026-11' }), row({ id: 'u2', month: '2026-12' }),
    row({ id: 'u5', month: '2027-03' }), // trou en février
    row({ id: 'u6', month: '2027-04', reason: 'Autre motif valable ici', batchId: 'b2' }),
    row({ id: 'y1', providerId: 'ypa', providerName: 'YPA', month: '2026-11' }),
  ];
  const p = u.periodsOf(rows);
  assert.deepEqual(p.map((x) => [x.providerName, x.from, x.to, x.months]), [
    ['RANO Control', '2026-11', '2027-01', 3], ['RANO Control', '2027-03', '2027-03', 1], ['RANO Control', '2027-04', '2027-04', 1], ['YPA', '2026-11', '2026-11', 1],
  ]);
  assert.deepEqual(p[0].ids, ['u1', 'u2', 'u3']);
  assert.equal(u.nextMonth('2026-12'), '2027-01');
});

test('planUnavailability « poser » : création, nouveau motif, même motif inchangé ; journal avant → après', () => {
  const existing = [row({ id: 'u1', month: '2026-11' }), row({ id: 'u2', month: '2026-12', reason: 'Ancien motif bien rédigé' })];
  const plan = u.planUnavailability({ mode: 'poser', months: ['2026-11', '2026-12', '2027-01'], existing, reason: 'Équipe mobilisée sur une urgence' });
  assert.deepEqual(plan.upserts, ['2026-12', '2027-01']);
  assert.deepEqual(plan.counts, { created: 1, updated: 1, unchanged: 1, deleted: 0, nothing: 0 });
  assert.equal(plan.action, 'indispo_poser');
  assert.deepEqual(plan.log.map((l) => [l.action, l.month, l.oldState, l.oldReason, l.newState]), [
    ['indispo_modifier', '2026-12', 'indisponible', 'Ancien motif bien rédigé', 'indisponible'],
    ['indispo_poser', '2027-01', 'disponible', null, 'indisponible'],
  ]);
  const only = u.planUnavailability({ mode: 'poser', months: ['2026-12'], existing, reason: 'Nouveau motif du bureau' });
  assert.equal(only.action, 'indispo_modifier');
  const none = u.planUnavailability({ mode: 'poser', months: ['2026-11'], existing, reason: 'Équipe mobilisée sur une urgence' });
  assert.equal(none.action, null, 'rien à écrire');
});

test('planUnavailability « retirer » : supprime les mois indisponibles, ignore les autres', () => {
  const existing = [row({ id: 'u1', month: '2026-11' })];
  const plan = u.planUnavailability({ mode: 'retirer', months: ['2026-11', '2026-12'], existing, reason: null });
  assert.deepEqual(plan.deletes, ['u1']);
  assert.deepEqual(plan.counts, { created: 0, updated: 0, unchanged: 0, deleted: 1, nothing: 1 });
  assert.deepEqual(plan.log.map((l) => [l.action, l.oldState, l.newState, l.oldReason]), [['indispo_retirer', 'indisponible', 'disponible', 'Équipe mobilisée sur une urgence']]);
  assert.equal(u.planUnavailability({ mode: 'retirer', months: ['2026-12'], existing, reason: null }).action, null);
  assert.throws(() => u.planUnavailability({ mode: 'oublier', months: [], existing: [] }));
});

test('stampOf : stable, sensible aux lignes existantes et à leur date', () => {
  const ex = [row({ id: 'u1' }), row({ id: 'u2', month: '2026-12' })];
  const s = u.stampOf('rano', ['2026-11', '2026-12'], ex);
  assert.equal(s, u.stampOf('rano', ['2026-12', '2026-11'], [...ex].reverse()));
  assert.notEqual(s, u.stampOf('rano', ['2026-11', '2026-12'], [ex[0]]));
  assert.notEqual(s, u.stampOf('rano', ['2026-11', '2026-12'], [ex[0], { ...ex[1], updatedAt: '2026-10-21T00:00:00.000Z' }]));
  assert.notEqual(s, u.stampOf('ypa', ['2026-11', '2026-12'], ex));
});

test('simulate + zoneMoves : la zone du TPM passe en suivi interne pendant l indisponibilité, et lui revient à la fin', () => {
  const D1 = { id: 'd1', depth: 2, name: 'Bekily', path: 'Androy > Bekily', lineage: ['r1'] };
  const partners = [{ id: 'aina', name: 'ASSOCIATION AINA', typeCode: 'prestataire', active: true }, { id: 'rano', name: 'RANO Control', typeCode: 'tpm', active: true }];
  const k = { id: 'k1', numero: 'CTR-1', status: 'actif', partnerId: 'aina', partnerName: 'ASSOCIATION AINA', holderTypeCode: 'prestataire', holderActive: true,
    dateDebut: '2026-01-01', dateFin: '2027-12-31', monitoring: true, tpms: [{ id: 'rano', name: 'RANO Control' }],
    zones: [{ adminAreaId: 'd1', depth: 2, path: D1.path, lineage: ['r1'] }] };
  const months = ['2026-11', '2026-12'];
  const before = a.buildZoneTable({ areas: [D1], months, contracts: [k], partners });
  const plan = u.planUnavailability({ mode: 'poser', months: ['2026-12'], existing: [], reason: 'Équipe mobilisée sur une urgence' });
  const after = a.buildZoneTable({ areas: [D1], months, contracts: [k], partners, unavailability: u.simulate([], plan, { providerId: 'rano', reason: 'x' }) });
  assert.deepEqual(u.zoneMoves(before, after, 'rano', new Map([['d1', D1]])), { toInternal: 1, toOther: 0, back: 0, list: [{ areaId: 'd1', name: 'Bekily', month: '2026-12', to: 'interne' }] });
  const visits = [{ id: 'v1', districtId: 'd1', communeId: null, month: '2026-12', providerId: 'rano', zoneState: 'contrat', contractId: 'k1', dated: true },
    { id: 'v2', districtId: 'd1', communeId: null, month: '2026-11', providerId: 'rano', zoneState: 'contrat', contractId: 'k1' }];
  assert.deepEqual(a.restampPlan(visits, after).map((c) => [c.id, c.providerId, c.zoneState, c.contractId]), [['v1', null, 'indisponible', null]]);
  // Fin : la simulation inverse rend la visite à RANO.
  const sim = u.simulate([{ id: 'u1', providerId: 'rano', month: '2026-12', reason: 'Équipe mobilisée sur une urgence' }],
    u.planUnavailability({ mode: 'retirer', months: ['2026-12'], existing: [{ id: 'u1', month: '2026-12', reason: 'r' }] }), { providerId: 'rano' });
  assert.deepEqual(sim, []);
});
