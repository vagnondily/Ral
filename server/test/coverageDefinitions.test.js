const test = require('node:test');
const assert = require('node:assert/strict');
const { activeAt, siteRangeFacts } = require('../src/modules/common/siteActivity');
const {
  siteCounts, groupRows, activityKey, measuresOf, shapeCoverage, checkConsistency,
} = require('../src/modules/dashboards/coverageDefinitions');

// Retour 110 : UNE définition par mesure, les mêmes chiffres sur la Synthèse et sur
// « Couverture & performance ». Les comptes par site viennent du jumeau pur du service unique
// (common/siteActivity.siteRangeFacts) ; la concordance avec la requête SQL est vérifiée en base
// (test/coverageDb.test.js).

const P = { from: '2026-01', to: '2026-09' };
const TODAY = '2026-10';
const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
const grid = (pattern) => new Map([...pattern].map((c, i) => [MONTHS[i], c === 'O' ? true : c === 'N' ? false : undefined])
  .filter(([, v]) => v !== undefined));

/** Un site du registre → ses comptes (twin + mois de référence + état RBM). */
function site({ activity = 'School meal activities', office = 'Toliara', district = 'Ampanihy', statuses = new Map(), gridYears = [2026],
  forbidden = false, visits = [], dataMonths = [], due = false, risk = 'moyenne', today = TODAY } = {}) {
  const s = { statuses, gridYears, forbidden, visits, dataMonths };
  const f = siteRangeFacts(s, P, { todayMonth: today });
  const activeRef = activeAt(statuses, P.to, s);
  return { activity, office, district, counts: siteCounts({ ...f, forbidden, activeRef, due, risk }), facts: f };
}

test('définitions sur des cas écrits à la main : univers, suivi par visite OU données, prévus, à venir, référence RBM', () => {
  const sites = [
    // A : actif toute l'année, visite prévue en février suivie par des DONNÉES, visite déclarée en mars.
    site({ statuses: grid('OOOOOOOOO'), visits: [{ month: '2026-02', status: 'planifie' }, { month: '2026-03', status: 'realise' }], dataMonths: ['2026-02'], due: true, risk: 'elevee' }),
    // B : actif, prévu en avril, jamais suivi.
    site({ statuses: grid('OOOOOOOOO'), visits: [{ month: '2026-04', status: 'planifie' }] }),
    // C : actif janvier-mars seulement ; données en juin (mois INACTIF) : jamais un suivi ; inactif au mois de référence.
    site({ statuses: grid('OOONNNNNN'), dataMonths: ['2026-06'] }),
    // D : aucun « Oui » sur la période, visites prévues : hors univers, ne compte nulle part.
    site({ statuses: grid('NNNNNNNNN'), visits: [{ month: '2026-02', status: 'planifie' }, { month: '2026-05', status: 'realise' }] }),
    // E : zone interdite (même avec des « Oui ») : hors univers.
    site({ statuses: grid('OOOOOOOOO'), forbidden: true, dataMonths: ['2026-02'] }),
    // F : autre activité (même libellé, casse et espaces différents) ; suivi par visite déclarée seulement.
    site({ activity: 'school  meal ACTIVITIES ', statuses: grid('OOOOOOOOO'), visits: [{ month: '2026-08', status: 'realise' }] }),
    // G : activité vide, actif, visite annulée en mai : ni prévue ni suivie.
    site({ activity: '', office: '', statuses: grid('OOOOOOOOO'), visits: [{ month: '2026-05', status: 'annule' }] }),
  ];
  const shape = shapeCoverage(groupRows(sites), { refMonth: P.to });
  assert.deepEqual(checkConsistency(shape), []);
  const o = shape.overall;
  assert.equal(o.sites, 5, 'univers = A, B, C, F, G');
  assert.deepEqual(shape.universe, { sites: 5, registry: 7, forbidden: 1, inactive: 1, activation: 'none' });
  assert.deepEqual([o.coverage.covered, o.coverage.byData, o.coverage.byVisit, o.coverage.both], [2, 1, 2, 1], 'A (données et visite), F (visite)');
  assert.equal(o.coverage.rate, 2 / 5);
  // Prévus (mois échus ; une visite déclarée était prévue) : A, B et F ; suivis parmi eux : A et F.
  assert.deepEqual([o.plannedSites.planned, o.plannedSites.covered], [3, 2]);
  // Visites prévues échues : A-février (données), A-mars (déclarée), B-avril (non suivie), F-août (déclarée).
  assert.deepEqual([o.execution.planned, o.execution.covered, o.execution.byData, o.execution.byVisit], [4, 3, 1, 2]);
  assert.equal(o.execution.rate, 3 / 4);
  // Mois de référence (septembre) : A, B, F, G actifs ; A à suivre.
  assert.deepEqual([o.rbm.sites, o.rbm.due, o.rbm.upToDate], [4, 1, 3]);
  assert.deepEqual(o.rbm.byRisk, { elevee: 1, moyenne: 3, faible: 0 });
  // Un libellé d'activité = une ligne, casse et espaces ignorés ; « — » en dernier ; jamais de correspondance inventée.
  assert.deepEqual(shape.byActivity.map((a) => [a.key, a.label, a.sites]),
    [['school meal activities', 'School meal activities', 4], ['—', '—', 1]]);
  assert.deepEqual(shape.byOffice.map((g) => [g.key, g.sites]), [['Toliara', 4], ['—', 1]]);
  // Dit à part, jamais compté : activité pendant un mois non actif (C : données de juin ; D : visite de mai ;
  // E : zone interdite), visite annulée d'un mois actif (G, mai).
  assert.equal(o.outside, 3);
  assert.equal(o.execution.cancelled, 1);
  assert.equal(o.execution.upcomingUnset, 0);
});

test('visites prévues à venir sur des mois pas encore « Oui » (grille non renseignée en fin d\'année) : rendues à part, jamais perdues', () => {
  const year = { from: '2026-01', to: '2026-12' };
  const s = { statuses: grid('OOOOOOOOO'), gridYears: [2026], visits: [{ month: '2026-05', status: 'realise' }, { month: '2026-11', status: 'planifie' }, { month: '2026-12', status: 'planifie' }] };
  const f = siteRangeFacts(s, year, { todayMonth: '2026-10' });
  const m = measuresOf(groupRows([{ activity: 'X', office: 'O', district: 'D', counts: siteCounts({ ...f, activeRef: false }) }]).find((r) => r.dim === 'overall'));
  assert.deepEqual([m.execution.planned, m.execution.upcoming, m.execution.upcomingUnset], [1, 0, 2]);
});

test('visites à venir : jamais « non exécutées », rendues à part', () => {
  const a = site({ statuses: grid('OOOOOOOOO'), today: '2026-06',
    visits: [{ month: '2026-05', status: 'realise' }, { month: '2026-07', status: 'planifie' }, { month: '2026-08', status: 'planifie' }] });
  const m = measuresOf(groupRows([a]).find((r) => r.dim === 'overall'));
  assert.deepEqual([m.execution.planned, m.execution.covered, m.execution.upcoming], [1, 1, 2]);
  assert.equal(m.execution.rate, 1);
});

test('taux sans dénominateur : null (« — »), jamais 0 %', () => {
  const m = measuresOf({});
  assert.equal(m.coverage.rate, null);
  assert.equal(m.execution.rate, null);
  assert.equal(m.plannedSites.rate, null);
  assert.equal(m.rbm.rate, null);
  const shape = shapeCoverage([], { refMonth: '2026-09' });
  assert.equal(shape.communes.rate, null);
  assert.deepEqual(shape.byActivity, []);
  assert.deepEqual(checkConsistency(shape), []);
});

test('jeu synthétique : chaque découpage (activité, bureau, district) se somme aux tuiles, et chaque sous-ensemble reste dans son ensemble', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const acts = ['School meal activities', 'school meal activities', 'School feeding (on-site)', 'Nutrition treatment activities', ''];
  const sites = [];
  for (let i = 0; i < 400; i += 1) {
    const pattern = MONTHS.map(() => (rnd() < 0.35 ? 'O' : rnd() < 0.5 ? 'N' : '.')).join('');
    const visits = MONTHS.filter(() => rnd() < 0.3).map((m) => ({ month: m, status: pick(['planifie', 'planifie', 'realise', 'annule']) }));
    const dataMonths = MONTHS.filter(() => rnd() < 0.15);
    sites.push(site({
      activity: pick(acts), office: pick(['Toliara', 'Ampanihy', '']), district: pick(['A', 'B', 'C', '—']),
      statuses: grid(pattern), gridYears: rnd() < 0.9 ? [2026] : [], forbidden: rnd() < 0.05,
      visits, dataMonths, due: rnd() < 0.6, risk: pick(['elevee', 'moyenne', 'faible', null]),
    }));
  }
  const shape = shapeCoverage(groupRows(sites), { refMonth: P.to });
  assert.deepEqual(checkConsistency(shape), []);
  // Univers recompté naïvement : actif au moins un mois de la période.
  const naiveU = sites.filter((s) => s.facts.active).length;
  const naiveCovered = sites.filter((s) => s.facts.realisedAny).length;
  assert.equal(shape.overall.sites, naiveU);
  assert.equal(shape.overall.coverage.covered, naiveCovered);
  assert.ok(shape.overall.plannedSites.planned <= shape.overall.sites);
  // Les variantes de casse d'un même libellé se regroupent ; deux libellés différents restent deux lignes.
  assert.deepEqual(shape.byActivity.map((a) => a.key).sort(),
    ['nutrition treatment activities', 'school feeding (on-site)', 'school meal activities', '—'].sort());
  // Concordance cassée → signalée.
  const broken = JSON.parse(JSON.stringify(shape));
  broken.byActivity[0].coverage.covered += 1;
  assert.ok(checkConsistency(broken).some((e) => e.includes('byActivity') && e.includes('coverage.covered')));
});

test('activityKey : casse et espaces ignorés, « — » sans activité', () => {
  assert.equal(activityKey('  School  Meal activities '), 'school meal activities');
  assert.equal(activityKey(''), '—');
  assert.equal(activityKey(null), '—');
});
