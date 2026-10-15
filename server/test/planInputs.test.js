/**
 * Entrées du générateur (lot 5, § 7.1) : dernière visite réelle (visite réalisée, donnée
 * rattachée AU SITE, date déclarée du registre — jamais une donnée de la seule commune),
 * site actif (lot 1b activeAt), pool MMR (bureau → parent → général, modèle par bureau ou
 * commun), capacités entières, premier mois planifiable, périmètre, avertissements.
 * Plus l'empreinte des entrées et le contrôle des invariants lui-même.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assemble, poolCapacity } = require('../src/modules/tpm/planInputs');
const { fromRow, withOverrides } = require('../src/modules/tpm/planSettings');
const { U, costUnits, generatePlan } = require('../src/modules/tpm/planGenerator');
const { fingerprintInputs, changedSections, canonical } = require('../src/modules/tpm/planFingerprint');
const { checkInvariants } = require('../src/modules/tpm/planInvariants');

const B1 = 'b1'; const ANT = 'a1'; const B2 = 'b2';
const offices = [{ id: B1, parentId: null, name: 'Bureau 1' }, { id: ANT, parentId: B1, name: 'Antenne 1' }, { id: B2, parentId: null, name: 'Bureau 2' }];
const mmr = [
  { id: 'g', fieldOfficeId: null, activityCategory: 'School meal activities', operationDuration: 10, numberOfSites: 2, riskLevel: 2, feasible: 52, visitsPerDay: 3, personsToDeploy: null, workingDays: null },
  { id: 'o', fieldOfficeId: B2, activityCategory: 'school meal activities ', operationDuration: 9, numberOfSites: 1, riskLevel: 2, feasible: 30, visitsPerDay: null, personsToDeploy: 2, workingDays: 18 },
  { id: 'z', fieldOfficeId: null, activityCategory: 'Climate', operationDuration: 0, numberOfSites: 1, riskLevel: 1, feasible: 12, visitsPerDay: 3, personsToDeploy: null, workingDays: null },
];
const site = (id, o = {}) => ({
  id, code: id, name: `Ecole ${id}`, activity: 'School meal activities', fieldOfficeId: ANT, adm1: 'R', adm2: 'District A', district: 'District A',
  adm3: 'Commune X', commune: 'Commune X', riskLevel: 'elevee', security: 0, lastVisitDate: null, ...o,
});
const raw = (o = {}) => ({ offices, mmr, sites: [site('s1')], grid: [], gridKnown: false, visits: [], lastBefore: [], data: [], ...o });
const opts = (o = {}) => ({ year: 2027, todayMonth: '2026-10', from: 1, to: 12, settings: fromRow(null), ...o });
const one = (a, id = 's1') => a.input.sites.find((s) => s.id === id);

test('dernière visite réelle : la plus récente entre visite réalisée, donnée DU site et date déclarée (avant le 1er mois planifiable)', () => {
  const a = assemble(raw({
    sites: [site('s1', { lastVisitDate: '2026-11-15' }), site('s2', { lastVisitDate: '2027-03-01' }), site('s3')],
    lastBefore: [{ siteId: 's1', month: '2026-05' }, { siteId: 's2', month: '2026-02' }],
    data: [{ siteId: 's3', before: '2026-08', months: [] }],
  }), opts());
  assert.equal(one(a, 's1').lastReal, '2026-11');
  assert.equal(a.siteInfo.get('s1').lastSource, 'registre');
  assert.equal(one(a, 's2').lastReal, '2026-02', 'une date déclarée postérieure au 1er mois planifiable est ignorée');
  assert.equal(a.siteInfo.get('s2').lastSource, 'visite');
  assert.equal(one(a, 's3').lastReal, '2026-08');
  assert.equal(a.siteInfo.get('s3').lastSource, 'donnees');
});

test('donnée rattachée au site dans l\'exercice = visite réalisée ce mois ; statut unique réalisée > prévue > annulée', () => {
  const a = assemble(raw({
    visits: [{ siteId: 's1', month: 2, status: 'annule' }, { siteId: 's1', month: 2, status: 'planifie' }, { siteId: 's1', month: 5, status: 'annule' }],
    data: [{ siteId: 's1', before: null, months: ['2027-02', '2027-07', '2026-12'] }],
  }), opts());
  const st = one(a).months.map((c) => c.st);
  assert.equal(st[1], 'realise');
  assert.equal(st[4], 'annule');
  assert.equal(st[6], 'realise');
  assert.equal(st.filter(Boolean).length, 3);
});

test('chargeur : seules les données rattachées AU SITE (jamais la commune) — le SQL le garantit', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../src/modules/tpm/plan.repository.js'), 'utf8');
  const q = sql.slice(sql.indexOf('FROM monitoring_submissions ms'), sql.indexOf('GROUP BY ms.site_id'));
  assert.match(sql, /ms\.site_id IS NOT NULL AND NOT ms\.excluded/);
  assert.match(q, /JOIN sites s ON s\.id = ms\.site_id AND s\.tenant_id = ms\.tenant_id/);
  assert.doesNotMatch(q, /adm3_pcode/);
  assert.match(q, /WHERE ms\.tenant_id = \$1/);
  // Toutes les requêtes du chargeur filtrent le compte.
  const loader = sql.slice(sql.indexOf('async function loadPlanInputsTx'), sql.indexOf('async function insertRunTx'));
  assert.equal((loader.match(/client\.query\(/g) || []).length, (loader.match(/tenant_id = \$1/g) || []).length);
  assert.doesNotMatch(loader, /Promise\.all/);
});

test('site actif (lot 1b) : grille connue → « Oui » explicite seulement ; sinon tout le registre ; zone interdite jamais', () => {
  const grid = [{ siteId: 's1', month: 1, active: true }, { siteId: 's1', month: 2, active: false }];
  const known = assemble(raw({ grid, gridKnown: true }), opts());
  assert.deepEqual(one(known).months.slice(0, 3).map((c) => c.active), [true, false, false]);
  const unknown = assemble(raw(), opts());
  assert.ok(one(unknown).months.every((c) => c.active));
  assert.ok(unknown.warnings.some((w) => w.code === 'grille_inconnue'));
  const forb = assemble(raw({ sites: [site('s1', { security: 99 })] }), opts());
  assert.ok(one(forb).months.every((c) => c.forbidden && !c.active));
  assert.equal(one(forb).urgent, false, 'une zone interdite n\'est jamais une recommandation urgente à planifier');
});

test('pool : dérogation du bureau, sinon du bureau parent, sinon plan général — modèle par bureau racine, ou commun', () => {
  const sites = [site('s1'), site('s2', { fieldOfficeId: B1 }), site('s3', { fieldOfficeId: B2 }), site('s4', { fieldOfficeId: null }), site('s5', { activity: 'Inconnue' })];
  const a = assemble(raw({ sites }), opts());
  assert.equal(one(a, 's1').poolKey, 'b1|school meal activities', 'antenne → bureau racine (modèle général)');
  assert.equal(one(a, 's2').poolKey, 'b1|school meal activities');
  assert.equal(one(a, 's3').poolKey, 'b2|school meal activities', 'dérogation du bureau (casse et espaces ignorés)');
  assert.equal(one(a, 's4').poolKey, '-|school meal activities');
  assert.equal(one(a, 's5').poolKey, null);
  assert.ok(a.warnings.some((w) => w.code === 'sans_mmr' && w.count === 1));
  const info = a.poolInfo.find((p) => p.key === 'b1|school meal activities');
  assert.equal(info.general, true);
  assert.equal(info.officeName, 'Bureau 1');
  assert.equal(info.sitesRegistry, 2);
  const common = assemble(raw({ sites }), opts({ settings: withOverrides(fromRow(null), { generalRowMode: 'commune' }) }));
  assert.equal(one(common, 's1').poolKey, 'general|school meal activities');
  assert.equal(one(common, 's4').poolKey, 'general|school meal activities');
  assert.equal(one(common, 's3').poolKey, 'b2|school meal activities');
});

test('capacités entières : personnes × suivis/j × jours (avec marge), sinon faisable ; jours-personne ; suivis/j par défaut', () => {
  const withPersons = poolCapacity({ operationDuration: 9, riskLevel: 2, feasible: 30, visitsPerDay: 2.5, personsToDeploy: 2, workingDays: 18 },
    { marginPct: 100, defaultVpd: 1, eligible: 100, objective: 'auto', runningMonths: null });
  assert.equal(withPersons.visitsCap, 90); // 2 × 2,5 × 18
  assert.equal(withPersons.capacityMode, 'personnes');
  assert.equal(withPersons.dayCapUnits, 2 * 18 * U);
  assert.equal(withPersons.costUnits, costUnits(2.5));
  assert.equal(withPersons.yearCap, 90 * 9);
  const margin = poolCapacity({ operationDuration: 9, riskLevel: 2, feasible: 30, visitsPerDay: 2.5, personsToDeploy: 2, workingDays: 18 },
    { marginPct: 90, defaultVpd: 1, eligible: 100, objective: 'auto', runningMonths: null });
  assert.equal(margin.visitsCap, 81);
  assert.equal(margin.dayCapUnits, Math.round(2 * 18 * U * 0.9));
  const typed = poolCapacity({ operationDuration: 10, riskLevel: 2, feasible: 52, visitsPerDay: null }, { marginPct: 100, defaultVpd: 1.5, eligible: 824, objective: 'auto', runningMonths: null });
  assert.equal(typed.visitsCap, 52);
  assert.equal(typed.vpd, 1.5);
  assert.equal(typed.vpdSource, 'defaut');
  assert.equal(typed.capacityMode, 'faisable');
  assert.equal(typed.dayCapUnits, Math.ceil((52 * costUnits(1.5)) / U) * U); // ⌈52 ÷ 1,5⌉ = 35 journées
  assert.equal(typed.interval.mode, 'ajuste');
  const stopped = poolCapacity({ operationDuration: 0, riskLevel: 1, feasible: 12, visitsPerDay: 3 }, { marginPct: 100, defaultVpd: 1, eligible: 5, objective: 'auto', runningMonths: null });
  assert.equal(stopped.interval.running, false);
  assert.equal(stopped.yearCap, 0);
  const none = poolCapacity({ operationDuration: 6, riskLevel: 2, feasible: null }, { marginPct: 100, defaultVpd: 1, eligible: 5, objective: 'auto', runningMonths: null });
  assert.equal(none.visitsCap, 0);
});

test('premier mois planifiable : jamais au passé ; exercice passé → rien ; exercice à venir → la plage demandée', () => {
  assert.equal(assemble(raw(), opts({ year: 2026, todayMonth: '2026-10', from: 1 })).input.fromMonth, 10);
  assert.equal(assemble(raw(), opts({ year: 2026, todayMonth: '2026-10', from: 11, to: 12 })).input.fromMonth, 11);
  assert.equal(assemble(raw(), opts({ year: 2025, todayMonth: '2026-10' })).input.fromMonth, 13);
  assert.equal(assemble(raw(), opts({ year: 2027, todayMonth: '2026-10', from: 3, to: 6 })).input.fromMonth, 3);
  assert.equal(assemble(raw(), opts({ year: 2027, from: 3, to: 6 })).input.toMonth, 6);
});

test('périmètre : bureau (antennes comprises), activité, district ; écart MMR ↔ registre > 10 % signalé', () => {
  const sites = [site('s1'), site('s2', { fieldOfficeId: B2 }), site('s3', { activity: 'Climate' }), site('s4', { adm2: 'District B', district: 'District B' })];
  const byOffice = assemble(raw({ sites }), opts({ scope: { officeId: B1 } }));
  assert.deepEqual(byOffice.input.sites.filter((s) => s.inScope).map((s) => s.id).sort(), ['s1', 's3', 's4']);
  const byAct = assemble(raw({ sites }), opts({ scope: { activity: 'climate' } }));
  assert.deepEqual(byAct.input.sites.filter((s) => s.inScope).map((s) => s.id), ['s3']);
  const byDistrict = assemble(raw({ sites }), opts({ scope: { district: 'district b' } }));
  assert.deepEqual(byDistrict.input.sites.filter((s) => s.inScope).map((s) => s.id), ['s4']);
  // Ligne générale (modèle de plusieurs bureaux) comparée à la SOMME de ses bureaux : 2 saisis = 2 au registre.
  const ok = assemble(raw({ sites: [...sites, site('s5', { fieldOfficeId: null })] }), opts());
  assert.equal(ok.warnings.filter((w) => w.code === 'mmr_sites_ecart').length, 1, 'seule la ligne générale (2 saisis, 3 au registre) diffère');
  const w = ok.warnings.find((x) => x.code === 'mmr_sites_ecart');
  assert.deepEqual([w.mmrId, w.typed, w.registry, w.pools.length], ['g', 2, 3, 2]);
  const same = assemble(raw({ sites }), opts());
  assert.equal(same.warnings.filter((x) => x.code === 'mmr_sites_ecart').length, 0);
});

test('regroupement : même lieu = même commune et même nom ; clés de commune et de district normalisées', () => {
  const a = assemble(raw({ sites: [site('s1', { name: 'EPP Ankily' }), site('s2', { name: 'epp  ankily', activity: 'Climate' }), site('s3', { adm3: 'Commune-X ' })] }), opts());
  assert.equal(one(a, 's1').placeKey, one(a, 's2').placeKey);
  assert.equal(one(a, 's1').communeKey, one(a, 's3').communeKey);
  assert.equal(one(a, 's1').districtKey, 'districta');
});

test('empreinte : indépendante de l\'ordre ; chaque section ne réagit qu\'à ses données', () => {
  const a = assemble(raw({ sites: [site('s1'), site('s2')] }), opts());
  const base = fingerprintInputs(a.input, { scope: {} });
  assert.match(base.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(fingerprintInputs({ ...a.input, sites: [...a.input.sites].reverse() }, { scope: {} }).fingerprint, base.fingerprint);
  const tweak = (fn) => { const c = JSON.parse(JSON.stringify(a.input)); fn(c); return changedSections(base.sections, fingerprintInputs(c, { scope: {} }).sections); };
  assert.deepEqual(tweak((c) => { c.sites[0].months[3].st = 'planifie'; }), ['visites']);
  assert.deepEqual(tweak((c) => { c.sites[0].lastReal = '2026-01'; }), ['visites']);
  assert.deepEqual(tweak((c) => { c.sites[0].months[3].active = false; }), ['activation']);
  assert.deepEqual(tweak((c) => { c.sites[0].risk = 'faible'; }), ['registre']);
  assert.deepEqual(tweak((c) => { Object.values(c.pools)[0].visitsCap += 1; }), ['mmr']);
  assert.deepEqual(tweak((c) => { c.params.coverageTargetPct = 90; }), ['parametres']);
  assert.deepEqual(tweak((c) => { c.fromMonth = 2; }), ['parametres'], 'le premier mois planifiable (horloge) fait partie de l\'empreinte');
  assert.deepEqual(changedSections(base.sections, fingerprintInputs(a.input, { scope: { district: 'x' } }).sections), ['parametres']);
  assert.equal(canonical({ b: 1, a: [new Set([2, 1])], f: () => 1, u: undefined }), '{"a":[[1,2]],"b":1}');
});

test('contrôle des invariants : chaque violation est détectée (le contrôle n\'est pas complaisant)', () => {
  const a = assemble(raw({ sites: [site('s1'), site('s2', { security: 99 })], visits: [{ siteId: 's1', month: 6, status: 'planifie' }] }), opts({ from: 1, to: 12 }));
  const r = generatePlan(a.input);
  assert.deepEqual(checkInvariants(a.input, r), []);
  const p = r.proposals.find((x) => x.siteId === 's1');
  const forged = (extra) => ({ ...r, proposals: [...r.proposals, ...extra] });
  const codes = (res) => checkInvariants(a.input, res).map((v) => v.code);
  assert.ok(codes(forged([{ ...p }])).includes('doublon'));
  assert.ok(codes(forged([{ ...p, siteId: 's2', month: 3 }])).includes('zone_interdite'));
  assert.ok(codes(forged([{ ...p, month: 6 }])).includes('deja_une_visite'));
  assert.ok(codes(forged([{ ...p, month: p.month + 1 }])).includes('intervalle'));
  const over = JSON.parse(JSON.stringify(r));
  over.months[0].tours.push({ no: 99, district: 'x', stops: [{ key: 'k', days: [{ no: 1, span: 1, pool: 'x', used: U + 1, visits: [] }] }] });
  assert.ok(codes(over).includes('journee_pleine'));
});
