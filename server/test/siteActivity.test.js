const test = require('node:test');
const assert = require('node:assert/strict');
const { activeAt, collapseStatus, siteRangeFacts, ratesOf, sumFacts } = require('../src/modules/common/siteActivity');

const H1 = { from: '2026-01', to: '2026-06' };
const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
const grid = (pattern, year = '2026') => new Map(
  [...pattern].map((c, i) => [`${year}-${String(i + 1).padStart(2, '0')}`, c === 'O' ? true : c === 'N' ? false : undefined])
    .filter(([, v]) => v !== undefined));
const pattern = (site) => MONTHS.map((m) => (activeAt(site.statuses, m, site) ? 'O' : '.')).join('');

test('activeAt : sans grille cette année-là → tout le registre ; avec une grille, seul un « Oui » explicite', () => {
  assert.equal(activeAt(new Map(), '2026-03', { gridYears: [] }), true);           // aucune grille : actif
  assert.equal(activeAt(new Map(), '2026-03', { gridYears: [2026] }), false);      // grille 2026, case vide : inactif
  assert.equal(activeAt(grid('OON'), '2026-02', { gridYears: [2026] }), true);
  assert.equal(activeAt(grid('OON'), '2026-03', { gridYears: [2026] }), false);
  // Statut d'une autre année : jamais reporté.
  assert.equal(activeAt(grid('OOOOOOOOOOOO', '2025'), '2026-01', { gridYears: [2025, 2026] }), false);
  assert.equal(activeAt(grid('OOOOOOOOOOOO', '2025'), '2026-01', { gridYears: new Set([2025]) }), true); // 2026 sans grille
  // Zone interdite : jamais active, même sans grille.
  assert.equal(activeAt(new Map(), '2026-03', { forbidden: true }), false);
  assert.equal(activeAt({ '2026-03': true }, '2026-03', { gridYears: [2026] }), true); // objet accepté
});

test('sémantique sur des statuts simulés (classeur : case vide = non actif)', () => {
  const g = [2025, 2026];
  const sites = {
    A: { statuses: grid('OONNNN'), gridYears: g },                    // inactif dès mars
    B: { statuses: grid('....OO'), gridYears: g },                    // réactivé en mai (cases vides avant)
    C: { statuses: grid('NNNNNN'), gridYears: g },                    // inactif toute la plage
    D: { statuses: grid('OOOOOO'), gridYears: g, forbidden: true },   // zone interdite
    E: { statuses: grid('.......OOOOO'), gridYears: g },              // statut renseigné seulement après la plage → non actif
    F: { statuses: new Map(), gridYears: g },                         // jamais renseigné → non actif
  };
  assert.deepEqual(Object.fromEntries(Object.entries(sites).map(([k, s]) => [k, pattern(s)])),
    { A: 'OO....', B: '....OO', C: '......', D: '......', E: '......', F: '......' });
});

test('collapseStatus : une visite = site × mois, réalisée > prévue > annulée', () => {
  assert.equal(collapseStatus(['planifie', 'realise']), 'realise');
  assert.equal(collapseStatus(['annule', 'planifie']), 'planifie');
  assert.equal(collapseStatus(['annule']), 'annule');
  assert.equal(collapseStatus([]), null);
  assert.equal(collapseStatus(undefined), null);
});

test('siteRangeFacts : union sur la plage, réalisé sur un mois inactif compté à part', () => {
  const g = [2026];
  // Actif janvier-février ; visite réalisée en février (actif) et en avril (inactif).
  const a = siteRangeFacts({ statuses: grid('OONNNN'), gridYears: g, visits: [{ month: '2026-02', status: 'realise' }, { month: '2026-04-01', status: 'realise' }] }, H1);
  assert.deepEqual([a.active, a.planned, a.realised, a.realisedInactive, a.realise, a.realiseActive], [true, true, true, true, 2, 1]);
  // Visite réalisée seulement pendant un mois inactif : jamais dans la couverture.
  const b = siteRangeFacts({ statuses: grid('OONNNN'), gridYears: g, visits: [{ month: '2026-05', status: 'realise' }] }, H1);
  assert.deepEqual([b.active, b.planned, b.realised, b.realisedInactive], [true, false, false, true]);
  // Deux lignes du même site × mois (activité vide et « GD ») : une seule visite.
  const c = siteRangeFacts({ statuses: grid('OOOOOO'), gridYears: g, visits: [{ month: '2026-03', status: 'planifie' }, { month: '2026-03', status: 'realise' }] }, H1);
  assert.deepEqual([c.planifie, c.realise, c.annule], [0, 1, 0]);
  // Visite annulée : ni prévue ni réalisée.
  const d = siteRangeFacts({ statuses: grid('OOOOOO'), gridYears: g, visits: [{ month: '2026-03', status: 'annule' }] }, H1);
  assert.deepEqual([d.planned, d.realised, d.annule], [false, false, 1]);
  // Visite hors plage ignorée.
  const e = siteRangeFacts({ statuses: grid('OOOOOO'), gridYears: g, visits: [{ month: '2026-07', status: 'realise' }] }, H1);
  assert.deepEqual([e.realised, e.realise], [false, 0]);
});

test('exécution : seuls les mois échus comptent, les visites à venir sont rendues à part', () => {
  const f = siteRangeFacts({ statuses: new Map(), gridYears: [], visits: [
    { month: '2026-04', status: 'realise' }, { month: '2026-05', status: 'planifie' }, { month: '2026-06', status: 'planifie' },
  ] }, H1, { todayMonth: '2026-05' });
  assert.deepEqual([f.dueRealise, f.duePlanifie, f.upcoming, f.planifie], [1, 1, 1, 2]);
});

test('ratesOf : null sans site actif, « — aucun plan » sans site prévu ni visite', () => {
  assert.deepEqual(ratesOf({ sitesActive: 0 }), { coverage: null, planning: null, execution: null });
  assert.deepEqual(ratesOf({ sitesActive: 10, sitesPlanned: 0, sitesRealised: 0 }), { coverage: 0, planning: null, execution: null });
  assert.deepEqual(ratesOf({ sitesActive: 4, sitesPlanned: 2, sitesRealised: 1, planifie: 1, realise: 3 }), { coverage: 0.25, planning: 0.5, execution: 0.75 });
});

test('fixture « GD janvier-juin » : 208 actifs, 183 prévus, 170 réalisés, 2 réalisés hors périmètre → 0,880 et 0,817', () => {
  const g = [2025, 2026];
  const sites = [];
  // 170 sites actifs toute la plage, visités (réalisé) en mars.
  for (let i = 0; i < 170; i += 1) sites.push({ statuses: grid('OOOOOO'), gridYears: g, visits: [{ month: '2026-03', status: 'realise' }] });
  // 13 sites ouverts en avril (cases vides avant) : prévus en mai, pas réalisés.
  for (let i = 0; i < 13; i += 1) sites.push({ statuses: grid('...OOO'), gridYears: g, visits: [{ month: '2026-05', status: 'planifie' }] });
  // 25 sites actifs seulement en janvier-février (fermés ensuite, cases vides) : aucune visite.
  for (let i = 0; i < 25; i += 1) sites.push({ statuses: grid('OO'), gridYears: g, visits: [] });
  // 2 sites inactifs (Non) toute la plage, visités quand même : comptés à part.
  for (let i = 0; i < 2; i += 1) sites.push({ statuses: grid('NNNNNN'), gridYears: g, visits: [{ month: '2026-02', status: 'realise' }] });
  // Sites hors périmètre : jamais renseignés, statut seulement après la plage, zone interdite.
  for (let i = 0; i < 30; i += 1) sites.push({ statuses: new Map(), gridYears: g, visits: [] });
  for (let i = 0; i < 9; i += 1) sites.push({ statuses: grid('.......OOOOO'), gridYears: g, visits: [{ month: '2026-08', status: 'realise' }] });
  for (let i = 0; i < 4; i += 1) sites.push({ statuses: grid('OOOOOO'), gridYears: g, forbidden: true, visits: [] });
  const t = sumFacts(sites.map((s) => siteRangeFacts(s, H1)));
  assert.deepEqual([t.sitesActive, t.sitesPlanned, t.sitesRealised, t.sitesRealisedInactive], [208, 183, 170, 2]);
  const r = ratesOf(t);
  assert.equal(r.planning.toFixed(3), '0.880');
  assert.equal(r.coverage.toFixed(3), '0.817');
  assert.equal(Math.round(r.planning * 100), 88);
  assert.equal(Math.round(r.coverage * 100), 82);
});

test('sur un seul mois, la règle de la plage est la règle mensuelle', () => {
  const s = { statuses: grid('ON'), gridYears: [2026], visits: [{ month: '2026-02', status: 'realise' }] };
  const jan = siteRangeFacts(s, { from: '2026-01', to: '2026-01' });
  const feb = siteRangeFacts(s, { from: '2026-02', to: '2026-02' });
  assert.deepEqual([jan.active, jan.realised], [true, false]);
  assert.deepEqual([feb.active, feb.realised, feb.realisedInactive], [false, false, true]);
});

test('isActiveMonth : LA règle « actif au mois M » (une seule pour tous les écrans)', () => {
  const { isActiveMonth } = require('../src/modules/common/siteActivity');
  // Année avec grille : seul un « Oui » explicite ; vide = inactif.
  assert.equal(isActiveMonth(true, true), true);
  assert.equal(isActiveMonth(false, true), false);
  assert.equal(isActiveMonth(undefined, true), false);
  assert.equal(isActiveMonth(null, true), false);
  // Année sans grille : tout le registre.
  assert.equal(isActiveMonth(undefined, false), true);
  assert.equal(isActiveMonth(null, false), true);
  // Même fonction pour la page « Sites (actifs / inactifs) ».
  assert.equal(require('../src/modules/tpm/activationMath').isActiveMonth, isActiveMonth);
});
