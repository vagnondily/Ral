/**
 * Retour 114 côté écran (web/src/lib/tpmAttribution.js, web/src/lib/reportExpectation.js) : mêmes états
 * que la règle serveur, « Interne » partout (le mot de ROLE_LABELS.noTpm), jamais « à affecter ».
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const rule = require('../src/modules/tpm/tpmAttribution');
const expectation = require('../src/modules/tpm/reportExpectation');

const WEB = path.join(__dirname, '../../web/src');
const load = async (t, rel) => {
  const file = path.join(WEB, rel);
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return import(pathToFileURL(file).href);
};

test('états internes : la liste de l écran = celle du serveur ; badge « Interne » (ROLE_LABELS.noTpm), jamais « à affecter »', async (t) => {
  const w = await load(t, 'lib/tpmAttribution.js'); if (!w) return;
  const roles = await load(t, 'lib/roles.js');
  assert.deepEqual(w.INTERNAL_STATES, rule.INTERNAL_VISIT_STATES);
  for (const s of rule.INTERNAL_VISIT_STATES) {
    assert.equal(w.TPM_ZONE_STATE[s].label, roles.ROLE_LABELS.noTpm, s);
    assert.equal(w.TPM_ZONE_STATE[s].icon, 'team', s);
    assert.match(w.TPM_VISIT[`zone:${s}`].label, /^Interne/, s);
  }
  for (const s of rule.VISIT_ZONE_STATES) assert.ok(w.TPM_ZONE_STATE[s] || w.TPM_VISIT[`zone:${s}`], `état sans libellé : ${s}`);
  const labels = [...Object.values(w.TPM_ZONE_STATE), ...Object.values(w.TPM_VISIT)].map((d) => d.label);
  assert.ok(labels.every((l) => !/à affecter/i.test(l)), labels.filter((l) => /à affecter/i.test(l)).join(', '));
  for (const a of rule.LOG_ACTIONS) assert.ok(w.TPM_LOG_ACTION[a], `action du journal sans libellé : ${a}`);
});

test('visitInternal = monitoredByOf du serveur (repli sans la colonne) ; la colonne fait foi quand elle est là', async (t) => {
  const w = await load(t, 'lib/tpmAttribution.js'); if (!w) return;
  const cases = [];
  for (const providerId of [null, 'p1']) {
    for (const providerSource of ['zone', 'visite', 'reprise']) {
      for (const providerZoneState of [null, ...rule.VISIT_ZONE_STATES]) cases.push({ providerId, providerSource, providerZoneState });
    }
  }
  for (const v of cases) assert.equal(w.visitInternal(v), rule.monitoredByOf(v) === 'interne', JSON.stringify(v));
  assert.equal(w.visitInternal({ monitoredBy: 'interne', providerId: null }), true);
  assert.equal(w.visitInternal({ monitoredBy: 'non_affecte', providerZoneState: 'sans_contrat' }), false);
  assert.equal(w.visitTpmKey({ providerSource: 'visite', providerId: null }), 'visite:interne');
});

test('internalWhy : dit pourquoi « Interne » (contrats sans TPM, TPM indisponible et motif, décision)', async (t) => {
  const w = await load(t, 'lib/tpmAttribution.js'); if (!w) return;
  const tr = (s, v = {}) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
  assert.equal(w.internalWhy(tr, { state: 'sans_tpm', noTpm: [{ contractLabel: 'FLA-7', holderName: 'TOHANA' }] }), 'contrat sans TPM : FLA-7 (TOHANA)');
  assert.equal(w.internalWhy(tr, { state: 'indisponible', unavailable: [{ providerName: 'RANO Control', reason: 'Équipe mobilisée' }] }), 'TPM indisponible : RANO Control — Équipe mobilisée');
  assert.equal(w.internalWhy(tr, { state: 'aucun_tpm', reason: 'Accès difficile' }), 'décidé : Accès difficile');
  assert.equal(w.internalWhy(tr, { state: 'contrat' }), '');
});

test('rapports attendus : chaque statut et chaque raison du serveur a son libellé à l écran', async (t) => {
  const w = await load(t, 'lib/reportExpectation.js'); if (!w) return;
  for (const s of expectation.EXPECTATION_STATUSES) assert.ok(w.EXPECTED_STATUS[s], s);
  assert.equal(w.LATE_REPORTS_LOOKBACK, require('../src/modules/dashboards/alertsMath').LATE_REPORTS_LOOKBACK, 'même fenêtre que le serveur');
  assert.ok(w.EXPECTED_STATUS.non_applicable_auto && w.EXPECTED_STATUS.interne);
  const out = expectation.expectedReports({
    months: ['2026-07'], today: '2026-10', contractPairs: new Map([['2026-07', [{ providerId: 'a', contractId: 'k' }]]]),
    activity: [{ key: 'interne', month: '2026-07', planned: 1, realised: 0, offices: ['Toliara'] }],
  });
  assert.deepEqual(out.rows.map(w.expectedKey), ['non_applicable_auto', 'interne']);
  for (const r of out.rows) assert.ok(r.reason in w.EXPECTED_REASON, r.reason);
  for (const reason of ['aucune_visite', 'tpm_indisponible', 'saisi_non_applicable', 'a_remettre', 'echeance_depassee', 'rapport_interne', 'document']) {
    assert.ok(reason in w.EXPECTED_REASON, reason);
  }
  const tr = (s, v = {}) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
  assert.equal(w.expectedWho(tr, out.rows[1]), 'Interne — équipe S&E (Toliara)');
  // Un gabarit stocké sans visite planifiée (autoNotApplicable du serveur) : « non applicable d'office » partout.
  assert.equal(w.reportShownStatus({ status: 'attendu', autoNotApplicable: true }), 'non_applicable');
  assert.equal(w.reportStatusDef({ status: 'attendu', autoNotApplicable: true }), w.EXPECTED_STATUS.non_applicable_auto);
  assert.equal(w.reportShownStatus({ status: 'attendu', autoNotApplicable: false }), 'attendu');
});

test('anglais : les lignes « par TPM » qui ne sont pas un TPM (Interne, Non affecté) sont traduites (U14)', async (t) => {
  const en = await load(t, 'locales/en.js'); if (!en) return;
  const { UNIT_LABELS } = require('../src/modules/tpm/fieldMath');
  for (const label of Object.values(UNIT_LABELS)) assert.ok(en.default[label], label);
});

test('aucun écran n écrit plus « À affecter » (retour 114 : sans TPM, le suivi est interne)', (t) => {
  const pages = path.join(WEB, 'pages');
  if (!fs.existsSync(pages)) { t.skip('web/ absent'); return; }
  const hits = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (/\.jsx?$/.test(f.name) && f.name !== 'AssignmentPage.jsx' && /tr\('À affecter/.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(WEB, p));
    }
  };
  walk(pages);
  assert.deepEqual(hits, []);
});

test('vue Indisponibilités (U4, U5, U7) : plage lue bornée à 24 mois ; « Mettre fin » jamais sur un mois passé', async (t) => {
  const w = await load(t, 'lib/tpmAttribution.js'); if (!w) return;
  assert.equal(w.UNAVAILABILITY_MAX_SPAN, rule.MAX_SPAN_MONTHS, 'même plafond que le serveur (GET /unavailability)');
  const span = (r) => w.monthsBetween(r.from, r.to, 100).length;
  // Défaut de l'onglet (mois courant → +5) : jusqu'à 6 mois après, 12 mois.
  assert.deepEqual(w.unavailabilityListRange({ from: '2026-10', to: '2027-03' }, '2026-10'), { from: '2026-10', to: '2027-09', capped: false });
  // Période de 24 mois dans le passé : 30 mois demandés avant U5 (400) — bornée à 24.
  const a = w.unavailabilityListRange({ from: '2025-01', to: '2026-12' }, '2026-10');
  assert.deepEqual(a, { from: '2025-01', to: '2026-12', capped: true });
  assert.equal(span(a), 24);
  // Période future (2026-11 → 2028-04, aujourd'hui 2026-10) : 25 mois demandés avant U5.
  const b = w.unavailabilityListRange({ from: '2026-11', to: '2028-04' }, '2026-10');
  assert.deepEqual([b.from, b.to, span(b)], ['2026-10', '2028-09', 24]);
  // Mettre fin : dès le mois courant pour une période en cours ou à venir.
  assert.deepEqual(w.endRangeOf({ from: '2026-08', to: '2026-12' }, '2026-10'), { from: '2026-10', to: '2026-12', past: false });
  assert.deepEqual(w.endRangeOf({ from: '2026-11', to: '2027-01' }, '2026-10'), { from: '2026-11', to: '2027-01', past: false });
  assert.deepEqual(w.endRangeOf({ from: '2026-10', to: '2026-10' }, '2026-10'), { from: '2026-10', to: '2026-10', past: false });
  // Période ENTIÈREMENT passée (re-relecture, point 4) : retirée sur ses propres bornes — jamais du > au, jamais bloquée.
  assert.deepEqual(w.endRangeOf({ from: '2026-03', to: '2026-05' }, '2026-10'), { from: '2026-03', to: '2026-05', past: true });
  assert.deepEqual(w.endRangeOf({ from: '2026-08', to: '2026-08' }, '2026-10'), { from: '2026-08', to: '2026-08', past: true });
  for (const p of [{ from: '2025-01', to: '2025-02' }, { from: '2026-09', to: '2026-11' }, { from: '2027-01', to: '2027-03' }]) {
    const r = w.endRangeOf(p, '2026-10');
    assert.ok(r && r.from <= r.to && r.from >= p.from && r.to === p.to, JSON.stringify(p));
  }
  assert.equal(w.endRangeOf(null, '2026-10'), null);
  // L'écran ne désactive plus « Mettre fin » sur une période passée et ne dit plus qu'elle est terminée.
  const view = fs.readFileSync(path.join(WEB, 'pages/monitoring/TpmUnavailabilityView.jsx'), 'utf8');
  assert.ok(!view.includes('elle est déjà terminée'));
});

test('Rapports : la période d un lien n est lue et retirée que sur #/tpm/rapports, jamais sur un autre écran (re-relecture, point 1)', async (t) => {
  const p = await load(t, 'lib/period.js'); if (!p) return;
  assert.equal(p.isHashRoute('#/tpm/rapports?from=2026-08&to=2026-08', 'tpm/rapports'), true);
  assert.equal(p.isHashRoute('#/tpm/rapports', 'tpm/rapports'), true);
  assert.equal(p.isHashRoute('#/tpm/rapports/', 'tpm/rapports'), true);
  assert.equal(p.isHashRoute('#/tpm/rapports/abc?x=1', 'tpm/rapports'), true);
  // Lien de la cloche « Exécution du plan » : un autre écran, sa période reste dans l'adresse.
  assert.equal(p.isHashRoute('#/processus/synthese?from=2026-08&to=2026-08', 'tpm/rapports'), false);
  assert.equal(p.isHashRoute('#/tpm/rapportsX?from=2026-08&to=2026-08', 'tpm/rapports'), false);
  assert.equal(p.isHashRoute('#/tpm?from=2026-08&to=2026-08', 'tpm/rapports'), false);
  assert.equal(p.isHashRoute('#/processus/synthese?r=tpm/rapports', 'tpm/rapports'), false, 'un paramètre ne compte jamais');
  assert.equal(p.isHashRoute('', 'tpm/rapports'), false);
  // Et la page l'utilise bien avant de toucher l'adresse.
  const src = fs.readFileSync(path.join(WEB, 'pages/tpm/ReportsPage.jsx'), 'utf8');
  const apply = src.slice(src.indexOf('const apply = () => {'), src.indexOf("window.addEventListener('hashchange', apply)"));
  assert.ok(apply.indexOf("isHashRoute(window.location.hash, 'tpm/rapports')") >= 0
    && apply.indexOf("isHashRoute(window.location.hash, 'tpm/rapports')") < apply.indexOf('replaceState'), 'garde de route avant replaceState');
});

test('routeur (2ᵉ re-relecture, points 3 et 4) : UN parseur d adresse, partagé par App, isHashRoute et usePeriod', async (t) => {
  const r = await load(t, 'lib/route.js'); if (!r) return;
  const p = await load(t, 'lib/period.js');
  const known = (mod, sub) => ['tpm/rapports', 'processus/synthese', 'alertes/centre', 'processus/rbm', 'contrats/liste'].includes(`${mod}/${sub}`);
  const at = (h) => { const x = r.routeOfHash(h, known); return `${x.module}/${x.sub}`; };
  // Comme App.parseHash : segments bruts (aucun nettoyage), redirections, route par défaut.
  assert.equal(at('#/tpm/rapports?from=2026-08&to=2026-08'), 'tpm/rapports');
  assert.equal(at('#x/tpm/rapports?from=2026-08'), 'tpm/rapports', 'ce qui précède le premier « / » est ignoré, comme le routeur');
  for (const h of ['#tpm/rapports?from=2026-08&to=2026-08', '#//tpm/rapports?from=2026-08', '#/tpm//rapports?from=2026-08', '#/TPM/rapports', '#/tpm/rapport%73', '', '#/']) {
    assert.equal(at(h), 'contrats/liste', `${h} : route par défaut (Contrats)`);
  }
  assert.equal(at('#/dashboard/trimestriel'), 'processus/synthese', 'redirection');
  assert.deepEqual(r.routeOfHash('#/processus/rbm/plan/x?from=2026-01', known), { module: 'processus', sub: 'rbm', extra: 'plan', extra2: 'x' });
  // isHashRoute suit le même parseur (les adresses mal formées que le routeur envoie à Contrats ne visent pas Rapports).
  for (const h of ['#tpm/rapports?from=2026-08&to=2026-08', '#//tpm/rapports?from=2026-08&to=2026-08', '#/tpm//rapports?from=2026-08&to=2026-08']) {
    assert.equal(p.isHashRoute(h, 'tpm/rapports'), false, h);
  }
  assert.equal(p.isHashRoute('#x/tpm/rapports?from=2026-08&to=2026-08', 'tpm/rapports'), true);
  // Le routeur l'utilise : plus de parseur ni de redirections à lui.
  const app = fs.readFileSync(path.join(WEB, 'App.jsx'), 'utf8');
  assert.match(app, /routeOfHash\(window\.location\.hash, findRoute\)/);
  assert.ok(!/const REDIRECTS|split\('\?'\)\[0\]\.split\('\/'\)/.test(app), 'aucun second parseur dans App.jsx');
});

test('usePeriod (2ᵉ re-relecture, point 3) : un lien vers un AUTRE écran ne change ni la période de l écran quitté ni la session', async (t) => {
  const p = await load(t, 'lib/period.js'); if (!p) return;
  const synthese = { module: 'processus', sub: 'synthese' };
  assert.equal(p.linkPeriodFor('#/alertes/centre?from=2026-08&to=2026-08', synthese), null, 'Centre d alertes (portée locale)');
  assert.equal(p.linkPeriodFor('#/tpm/rapports?from=2026-08&to=2026-08', synthese), null, '« Rapport en retard »');
  assert.deepEqual(p.linkPeriodFor('#/processus/synthese?from=2026-08&to=2026-08', synthese), { from: '2026-08', to: '2026-08' });
  assert.deepEqual(p.linkPeriodFor('#/processus/synthese/detail?from=2026-08&to=2026-09', synthese), { from: '2026-08', to: '2026-09' }, 'même écran, autres segments : appliqué');
  assert.deepEqual(p.linkPeriodFor('#/dashboard/trimestriel?from=2026-08&to=2026-08', synthese), { from: '2026-08', to: '2026-08' }, 'ancienne adresse redirigée vers cet écran');
  assert.equal(p.linkPeriodFor('#/processus/synthese', synthese), null, 'sans période');
  // Le hook retient son écran au montage et ne lit la période d'un lien que par linkPeriodFor.
  const src = fs.readFileSync(path.join(WEB, 'components/PeriodBanner.jsx'), 'utf8');
  assert.match(src, /const \[screen\] = useState\(\(\) => routeOfHash\(window\.location\.hash\)\)/);
  const onHash = src.slice(src.indexOf('const onHash = () => {'), src.indexOf("window.addEventListener('hashchange', onHash)"));
  assert.match(onHash, /linkPeriodFor\(window\.location\.hash, screen\)/);
  assert.ok(!/readHashPeriod/.test(onHash), 'jamais la période brute d un autre écran');
});
