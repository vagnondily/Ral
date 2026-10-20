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
