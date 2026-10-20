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

test('couverture par bureau de rattachement du site ; site sans bureau regroupé sous « Sans bureau »', () => {
  const s = summarizeVisits([
    { status: 'realise', office: 'Antenne Tsihombe' },
    { status: 'planifie', office: 'Antenne Tsihombe' },
    { status: 'annule', office: 'Antenne Tsihombe' },
    { status: 'realise', office: null },
  ]);
  const ts = s.byOffice.find((r) => r.key === 'Antenne Tsihombe');
  assert.equal(ts.label, 'Antenne Tsihombe');
  assert.equal(ts.active, 2);            // annulée exclue
  assert.equal(ts.rate, 0.5);
  assert.equal(s.byOffice.find((r) => r.key === '—').label, 'Sans bureau');
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

test('collectionDays : les visites d\'un même agent le même jour font UNE journée (comme les journées-agent du plan)', () => {
  // Plan écrit avec « Écrire les dates et les agents » : 4 sites d'une commune le même jour par Agent 1.
  const day = (agent, date, n) => Array.from({ length: n }, () => ({ providerId: 'p1', status: 'planifie', visitDate: date, agent }));
  const visits = [...day('Agent 1', '2026-11-02', 4), ...day('Agent 2', '2026-11-02', 4), ...day('agent 1 ', '2026-11-03', 2),
    { providerId: 'p1', status: 'realise', visitDate: '2026-11-04', agent: null },   // sans agent : une journée
    { providerId: 'p1', status: 'realise', visitDate: '2026-11-04', agent: null },
    { providerId: 'p1', status: 'annule', visitDate: '2026-11-05', agent: 'Agent 1' }];
  const [p1] = collectionDays(visits, {}, { p1: 'YPA' });
  assert.equal(p1.visitDays, 5);      // A1·02, A2·02, A1·03 + 2 visites sans agent
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

// ---- Lot 1b : résumé sur une plage (faits site × mois) ------------------------------
const { shapeRangeSummary } = require('../src/modules/tpm/fieldMath');
const { fieldAlerts } = require('../src/modules/dashboards/alertsMath');

// Visites d'un mois (septembre 2026) : prestataires, sites, statuts — dont une ligne en double du même site × mois.
const SEPT = [
  ...Array.from({ length: 9 }, (_, i) => ({ status: i < 2 ? 'planifie' : 'realise', providerId: 'p1', providerName: 'YPA', siteId: `a${i}` })),
  ...Array.from({ length: 6 }, (_, i) => ({ status: i < 4 ? 'planifie' : 'realise', providerId: 'p2', providerName: 'SAHY', siteId: `b${i}` })),
  { status: 'annule', providerId: 'p2', providerName: 'SAHY', siteId: 'b9' },
  ...Array.from({ length: 3 }, (_, i) => ({ status: 'planifie', providerId: null, siteId: `c${i}` })),
  { status: 'realise', providerId: 'p1', providerName: 'YPA', siteId: 'a0' }, // a0 : 2 lignes (planifiée + réalisée) ce mois
];
// Ce que rendent les deux requêtes SQL sur ces visites : faits (ligne « overall ») et prestataires.
const count = (list, st) => list.filter((v) => v.status === st).length;
function sqlRows(visits) {
  const providers = new Map();
  for (const v of visits) {
    const k = v.providerId || 'non_affecte';
    if (!providers.has(k)) providers.set(k, { key: k, label: v.providerName || null, list: [] });
    providers.get(k).list.push(v);
  }
  const bySite = new Map();
  for (const v of visits) { if (!bySite.has(v.siteId)) bySite.set(v.siteId, []); bySite.get(v.siteId).push(v.status); }
  const collapsed = [...bySite.values()].map((st) => (st.includes('realise') ? 'realise' : st.includes('planifie') ? 'planifie' : 'annule'));
  const sm = (st) => collapsed.filter((x) => x === st).length;
  const overall = {
    dim: 'overall', key: null, planifie: count(visits, 'planifie'), realise: count(visits, 'realise'), annule: count(visits, 'annule'),
    sitesActive: 100, sitesPlanned: sm('planifie') + sm('realise'), sitesRealised: sm('realise'), sitesRealisedInactive: 0,
    smPlanifie: sm('planifie'), smRealise: sm('realise'), smAnnule: sm('annule'), duePlanifie: sm('planifie'), dueRealise: sm('realise'), upcoming: 0,
  };
  const prov = [...providers.values()].map((p) => ({
    key: p.key, label: p.label, planifie: count(p.list, 'planifie'), realise: count(p.list, 'realise'), annule: count(p.list, 'annule'),
    sitesPlanned: new Set(p.list.filter((v) => v.status !== 'annule').map((v) => v.siteId)).size,
    sitesRealised: new Set(p.list.filter((v) => v.status === 'realise').map((v) => v.siteId)).size,
  }));
  return { groups: [overall, { ...overall, dim: 'month', key: '2026-09', known: false }], prov };
}
const legacyOf = ({ key, label, planifie, realise, annule, total, active, rate }) => ({ key, label, planifie, realise, annule, total, active, rate });

test('plage d\'un mois : champs hérités du total et des prestataires identiques à summarizeVisits', () => {
  const old = summarizeVisits(SEPT, { p1: 'YPA', p2: 'SAHY' });
  const { groups, prov } = sqlRows(SEPT);
  const s = shapeRangeSummary(groups, prov);
  assert.deepEqual(legacyOf({ key: undefined, label: undefined, ...s.overall }), legacyOf({ key: undefined, label: undefined, ...old.overall }));
  const byKey = (a, b) => a.key.localeCompare(b.key);
  assert.deepEqual(s.byProvider.map(legacyOf).sort(byKey), old.byProvider.map(legacyOf).sort(byKey));
  // Sites distincts et visites site × mois en plus : a0 (2 lignes) compte une fois.
  assert.deepEqual(s.overall.visits, { planned: 18, realised: 10, cancelled: 1, upcoming: 0 });
  assert.deepEqual([s.overall.planifie, s.overall.realise], [9, 10], 'lignes de visites : sens hérité inchangé (a0 compte 2 lignes)');
  assert.deepEqual(s.byProvider.find((p) => p.key === 'p1').sites, { planned: 9, realised: 8 });
  assert.equal(s.byProvider.find((p) => p.key === 'non_affecte').label, 'Non affecté');
  assert.equal(s.activationKnown, false);
});

test('alertes terrain identiques avec l\'ancien et le nouveau résumé du même mois', () => {
  const old = summarizeVisits(SEPT, { p1: 'YPA', p2: 'SAHY' });
  const { groups, prov } = sqlRows(SEPT);
  const alertsOld = fieldAlerts(old);
  assert.ok(alertsOld.some((a) => a.kind === 'provider_late'), 'le cas couvre un retard de prestataire');
  assert.ok(alertsOld.some((a) => a.kind === 'visits_unassigned'), 'et des visites non affectées');
  assert.deepEqual(fieldAlerts(shapeRangeSummary(groups, prov)), alertsOld);
});

test('taux : couverture et planification sur les sites actifs, exécution null sans visite (« — aucun plan »)', () => {
  const empty = shapeRangeSummary([{ dim: 'overall', sitesActive: 40 }], []);
  assert.deepEqual([empty.overall.coverage, empty.overall.planning, empty.overall.execution, empty.overall.rate], [0, null, null, 0]);
  assert.deepEqual(empty.byOffice, []);
  const none = shapeRangeSummary([{ dim: 'overall' }], []);
  assert.equal(none.overall.coverage, null, 'aucun site actif : « — »');
  const s = shapeRangeSummary([
    { dim: 'overall', sitesActive: 208, sitesPlanned: 183, sitesRealised: 170, sitesRealisedInactive: 2, duePlanifie: 13, dueRealise: 170, smPlanifie: 13, smRealise: 170, planifie: 13, realise: 170 },
    { dim: 'district', key: 'ambovombe', districtLabel: 'Ambovombe', planifie: 0, realise: 0, sitesActive: 50 },
    { dim: 'office', key: '—', planifie: 2, realise: 1, sitesActive: 3 },
  ], []);
  assert.equal(s.overall.planning.toFixed(3), '0.880');
  assert.equal(s.overall.coverage.toFixed(3), '0.817');
  assert.deepEqual(s.overall.sites, { active: 208, planned: 183, realised: 170, realisedInactive: 2 });
  assert.deepEqual(s.byDistrict, [], 'groupe sans visite : absent des tableaux hérités, comme avant');
  assert.equal(s.byOffice[0].label, 'Sans bureau');
  // … mais compté à part : « autres (sans visite) » rapproche le tableau du total.
  assert.deepEqual(s.others.byDistrict, { groups: 1, sitesActive: 50, list: [{ key: 'ambovombe', label: 'Ambovombe', sitesActive: 50 }] });
  assert.deepEqual(s.others.byOffice, { groups: 0, sitesActive: 0, list: [] });
});

test('tableaux par groupe + « autres (sans visite) » = total des sites actifs (Jul–Oct 2026 : 573 + 707 = 1 280)', () => {
  const s = shapeRangeSummary([
    { dim: 'overall', sitesActive: 1280, sitesRealised: 18, planifie: 7, realise: 25 },
    { dim: 'district', key: 'a', districtLabel: 'A', planifie: 4, realise: 20, sitesActive: 400, sitesRealised: 15 },
    { dim: 'district', key: 'b', districtLabel: 'B', planifie: 3, realise: 5, sitesActive: 173, sitesRealised: 3 },
    { dim: 'district', key: 'c', districtLabel: 'C', sitesActive: 600 },
    { dim: 'district', key: 'd', districtLabel: 'D', sitesActive: 107 },
    { dim: 'district', key: 'e', districtLabel: 'E', sitesActive: 0 },
  ], []);
  const shown = s.byDistrict.reduce((n, d) => n + d.sites.active, 0);
  assert.equal(shown, 573);
  assert.equal(s.others.byDistrict.sitesActive, 707);
  assert.equal(s.others.byDistrict.groups, 2, 'un groupe sans site actif n\'est pas compté');
  assert.equal(shown + s.others.byDistrict.sitesActive, s.overall.sites.active);
  assert.deepEqual(s.others.byDistrict.list.map((x) => x.label), ['C', 'D'], 'plus de sites actifs d\'abord');
});

test('série mensuelle : un mois par ligne, triée, avec l\'état de la grille d\'activation', () => {
  const s = shapeRangeSummary([
    { dim: 'month', key: '2026-02', known: true, sitesActive: 10, sitesRealised: 5, smRealise: 5, dueRealise: 5 },
    { dim: 'month', key: '2026-01', known: false, sitesActive: 12 },
  ], []);
  assert.deepEqual(s.monthly.map((m) => [m.month, m.activationKnown, m.sitesActive, m.coverage]), [['2026-01', false, 12, 0], ['2026-02', true, 10, 0.5]]);
  assert.equal(s.activationKnown, false, 'un mois sans grille : activation non connue sur la période');
});

test('matrice de couverture : colonnes = mois d\'une période (au lieu d\'une année)', () => {
  const m = buildCoverageMatrix([{ month: '2025-12', key: 'A', label: 'A', planifie: 1, realise: 2 }], ['2025-11', '2025-12', '2026-01']);
  assert.deepEqual(m.months, ['2025-11', '2025-12', '2026-01']);
  assert.equal(m.year, null);
  assert.equal(m.groups[0].cells[1].realise, 2);
  assert.equal(buildCoverageMatrix([], 2026).months.length, 12);
});
