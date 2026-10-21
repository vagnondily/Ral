/**
 * Relecture croisée (points 4 et 15) — une seule règle pour « attendu / en retard » : le jumeau SQL de
 * l'échéance (reportExpectationSql.stubLateSql), les compteurs de la fiche 360° (partnerSheet.reportSummary,
 * expectedCountsOf) et le statut affiché d'un rapport stocké (web/src/lib/reportExpectation).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { stubLateSql, stubNotApplicableSql } = require('../src/modules/tpm/reportExpectationSql');
const { DUE_MONTHS_AFTER } = require('../src/modules/tpm/reportExpectation');
const { reportSummary, expectedCountsOf } = require('../src/modules/partners/partnerSheet');

test('stubLateSql : gabarit « attendu », pas non applicable d office, échéance (dernier mois + DUE_MONTHS_AFTER) dépassée', () => {
  const sql = stubLateSql('r', '2026-10').replace(/\s+/g, ' ');
  assert.ok(sql.includes("r.status = 'attendu'"));
  assert.ok(sql.includes(`NOT ${stubNotApplicableSql('r').replace(/\s+/g, ' ')}`));
  assert.ok(sql.includes(`COALESCE(r.period_end, r.period_month) + interval '${DUE_MONTHS_AFTER} month' < '2026-10-01'::date`));
  // Le mois courant est un littéral contrôlé : jamais autre chose qu'AAAA-MM.
  for (const bad of [undefined, '2026-13', "2026-10'; DROP TABLE x; --", '2026-1']) assert.throws(() => stubLateSql('r', bad));
});

test('stubNotApplicableSql (D-b, relecture des corrections croisées, point 2) : sans visite OU partenaire qui n est plus de type TPM ; fiche inactive : encore attendue', () => {
  const { stubNotTpmSql } = require('../src/modules/tpm/reportExpectationSql');
  const na = stubNotApplicableSql('r').replace(/\s+/g, ' ');
  const notTpm = stubNotTpmSql('r').replace(/\s+/g, ' ');
  assert.ok(na.startsWith(`(${notTpm} OR (r.status = 'attendu' AND NOT EXISTS ( SELECT 1 FROM site_visits sv`));
  assert.match(notTpm, /^\(r\.status = 'attendu' AND NOT EXISTS \( SELECT 1 FROM partners sp JOIN partner_types st ON st\.tenant_id = sp\.tenant_id AND st\.id = sp\.partner_type_id WHERE sp\.tenant_id = r\.tenant_id AND sp\.id = r\.partner_id AND st\.code = 'tpm'\)\)$/);
  assert.ok(!/active/.test(notTpm), 'la fiche inactive n entre pas en compte (D-b)');
});

test('fiche 360° : factures « Attendu » / « En retard » = rapports attendus du TPM ; Soumis / Validé / Rejeté = documents', () => {
  const expected = { rows: [
    { unit: { kind: 'tpm', providerId: 'y' }, status: 'en_retard' },
    { unit: { kind: 'tpm', providerId: 'y' }, status: 'attendu' },
    { unit: { kind: 'tpm', providerId: 'y' }, status: 'attendu' },
    { unit: { kind: 'tpm', providerId: 'y' }, status: 'non_applicable' },
    { unit: { kind: 'tpm', providerId: 'z' }, status: 'en_retard' },
    { unit: { kind: 'interne', providerId: null }, status: 'attendu' },
  ] };
  const live = expectedCountsOf(expected, 'y');
  assert.deepEqual(live, { attendu: 2, en_retard: 1 });
  const stored = [
    { kind: 'financier', status: 'attendu', n: 4 }, { kind: 'financier', status: 'en_retard', n: 1 },
    { kind: 'financier', status: 'valide', n: 2 }, { kind: 'financier', status: 'soumis', n: 1 },
    { kind: 'technique', status: 'en_retard', n: 1 }, { kind: 'technique', status: 'attendu', n: 1 },
  ];
  const s = reportSummary(stored, live);
  assert.deepEqual(s.financier, { attendu: 2, en_retard: 1, valide: 2, soumis: 1 }, 'gabarits enregistrés remplacés par la carte');
  assert.deepEqual(s.technique, { en_retard: 1, attendu: 1 });
  assert.deepEqual([s.total, s.toValidate, s.expected, s.late], [10, 1, 3, 2], 'total : documents enregistrés ; attendus / en retard : carte + techniques');
  // Sans rapports attendus connus : les gabarits enregistrés (avec leur échéance, stubLateSql).
  const raw = reportSummary(stored);
  assert.deepEqual([raw.financier.attendu, raw.financier.en_retard, raw.expected, raw.late], [4, 1, 5, 2]);
});

test('fiche 360° d un TITULAIRE (relecture des corrections croisées, point 1) : les factures attendues / en retard de son TPM sur ses contrats comptent', () => {
  // MIARO tient k1 ; YPA en est le TPM. MIARO n'est le TPM d'aucune ligne : avant, sa fiche comptait 0 / 0.
  const expected = { rows: [
    { unit: { kind: 'tpm', providerId: 'ypa' }, contract: { id: 'k1' }, status: 'en_retard' },
    { unit: { kind: 'tpm', providerId: 'ypa' }, contract: { id: 'k1' }, status: 'attendu' },
    { unit: { kind: 'tpm', providerId: 'ypa' }, contract: { id: 'k2' }, status: 'en_retard' }, // contrat d'un autre titulaire
    { unit: { kind: 'tpm', providerId: 'miaro' }, contract: { id: 'k1' }, status: 'attendu' }, // TPM ET titulaire : une fois
    { unit: { kind: 'tpm', providerId: 'sahy' }, contract: null, status: 'en_retard' },
    { unit: { kind: 'interne', providerId: null }, contract: null, status: 'attendu' },
  ] };
  assert.deepEqual(expectedCountsOf(expected, 'miaro', ['k1']), { attendu: 2, en_retard: 1 });
  assert.deepEqual(expectedCountsOf(expected, 'miaro'), { attendu: 1, en_retard: 0 }, 'sans ses contrats : ses lignes de TPM seules');
  assert.deepEqual(expectedCountsOf(expected, 'ypa', []), { attendu: 1, en_retard: 2 });
  const s = reportSummary([{ kind: 'financier', status: 'en_retard', n: 1 }, { kind: 'financier', status: 'valide', n: 2 }], expectedCountsOf(expected, 'miaro', ['k1']));
  assert.deepEqual([s.financier.attendu, s.financier.en_retard, s.expected, s.late], [2, 1, 2, 1]);
  // Le service passe les contrats tenus (même périmètre que les documents de la fiche, docOf).
  const src = fs.readFileSync(path.join(__dirname, '../src/modules/partners/partners.service.js'), 'utf8');
  assert.match(src, /const held = \(raw\.contracts \|\| \[\]\)\.filter\(\(c\) => c\.holderId === id\)\.map\(\(c\) => c\.id\);/);
  assert.match(src, /expected: expectedCountsOf\(expected, id, held\)/);
});

test('web : statut affiché d un gabarit en retard = « En retard » (liste, onglet), comme la carte', async (t) => {
  const file = path.join(__dirname, '../../web/src/lib/reportExpectation.js');
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return; }
  const w = await import(pathToFileURL(file).href);
  assert.equal(w.reportShownStatus({ status: 'attendu', late: true }), 'en_retard');
  assert.equal(w.reportStatusDef({ status: 'attendu', late: true }), w.EXPECTED_STATUS.en_retard);
  assert.equal(w.reportShownStatus({ status: 'attendu', autoNotApplicable: true, late: false }), 'non_applicable');
  assert.equal(w.reportShownStatus({ status: 'soumis', late: false }), 'soumis');
  assert.ok('partner_not_tpm' in w.EXPECTED_REASON, 'raison D-b libellée à l écran');
  // Bulle d'aide d'un gabarit non applicable d'office : la raison D-b quand le partenaire n'est plus TPM (point 2).
  assert.match(w.autoNotApplicableWhy({ autoNotApplicable: true, partnerNotTpm: true }), /n'est plus un TPM/);
  assert.match(w.autoNotApplicableWhy({ autoNotApplicable: true, partnerNotTpm: false }), /^Aucune visite planifiée/);
  assert.equal(w.autoNotApplicableWhy({ autoNotApplicable: false }), null);
  for (const f of ['pages/tpm/ReportsPage.jsx', 'pages/tpm/provider/ProviderReportsTab.jsx']) {
    assert.match(fs.readFileSync(path.join(__dirname, '../../web/src', f), 'utf8'), /title=\{tr\(autoNotApplicableWhy\(r\)\)\}/, f);
  }
});

test('fil guidé (point 16) : étapes « Facture » / « Validation » = factures RÉELLES qui couvrent le mois (règle de la carte)', async (t) => {
  const file = path.join(__dirname, '../../web/src/lib/reportExpectation.js');
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return; }
  const w = await import(pathToFileURL(file).href);
  const docs = [
    { kind: 'financier', status: 'attendu', periodMonth: '2026-07-01', late: true }, // gabarit en retard : jamais une facture
    { kind: 'financier', status: 'attendu', periodMonth: '2026-07-01', autoNotApplicable: true },
    { kind: 'financier', status: 'non_applicable', periodMonth: '2026-07-01' },
    { kind: 'financier', status: 'soumis', periodMonth: '2026-06-01', periodEnd: '2026-07-01' }, // pluri-mensuelle : couvre juillet
    { kind: 'financier', status: 'valide', periodMonth: '2026-07-01' },
    { kind: 'technique', status: 'valide', periodMonth: '2026-07-01' },
    { kind: 'financier', status: 'valide', periodMonth: '2026-08-01' },
  ];
  assert.deepEqual(w.factureFlow(docs, '2026-07'), { facturesCreees: 2, facturesSoumises: 1, facturesValidees: 1 });
  assert.deepEqual(w.factureFlow(docs, '2026-06'), { facturesCreees: 1, facturesSoumises: 1, facturesValidees: 0 });
  assert.deepEqual(w.factureFlow(docs, '2026-05'), { facturesCreees: 0, facturesSoumises: 0, facturesValidees: 0 });
  // La page recalcule à chaque mois choisi (dépendance `month`) et n'écrit jamais les plans d'un autre mois.
  const page = fs.readFileSync(path.join(__dirname, '../../web/src/pages/tpm/ReportsPage.jsx'), 'utf8');
  assert.match(page, /\.\.\.factureFlow\(reports, month\),\s*\}\), \[reports, plans, month\]\);/);
  assert.match(page, /if \(live\) setPlans\(p\)/);
});

test('D-b (point 21) : partenaire qui n est plus de type TPM → « non applicable », jamais en retard ni alerté ; TPM inactif → encore attendu', () => {
  const e = require('../src/modules/tpm/reportExpectation');
  const { lateReportAlerts } = require('../src/modules/dashboards/alertsMath');
  const base = { visits: 2, docs: [], month: '2026-08', today: '2026-10' };
  assert.equal(e.tpmStatus(base).status, 'en_retard');
  assert.deepEqual(e.tpmStatus({ ...base, notTpm: true }), { status: 'non_applicable', expected: false, auto: true, reason: 'partner_not_tpm' });
  // Un document réel l'emporte toujours.
  assert.equal(e.tpmStatus({ ...base, notTpm: true, docs: [{ status: 'valide' }] }).status, 'valide');
  const input = {
    months: ['2026-08'], today: '2026-10', names: new Map([['sahy', 'SAHY'], ['ypa', 'YPA']]),
    activity: [{ key: 'sahy', contractId: 'k1', month: '2026-08', planned: 0, realised: 1 }, { key: 'ypa', contractId: 'k2', month: '2026-08', planned: 0, realised: 1 }],
  };
  const out = e.expectedReports({ ...input, notTpm: new Set(['sahy']) });
  const by = Object.fromEntries(out.rows.map((r) => [r.unit.providerId, [r.status, r.reason]]));
  assert.deepEqual(by, { sahy: ['non_applicable', 'partner_not_tpm'], ypa: ['en_retard', 'echeance_depassee'] }, 'YPA (même inactif) reste attendu');
  assert.deepEqual(lateReportAlerts(out).map((a) => a.params.provider), ['YPA'], 'aucune alerte pour un partenaire qui n est plus TPM');
});

test('D-b (point 21) : facture de mois PASSÉS d un TPM inactif acceptée (type seul) ; plan, gabarit, technique ou mois courant : TPM actif', () => {
  const { inactiveTpmMayInvoice } = require('../src/modules/tpm/reportExpectation');
  assert.equal(inactiveTpmMayInvoice({ kind: 'financier', periodMonth: '2026-08-01' }, '2026-10'), true);
  assert.equal(inactiveTpmMayInvoice({ kind: 'financier', periodMonth: '2026-08-01', periodEnd: '2026-09-01' }, '2026-10'), true);
  assert.equal(inactiveTpmMayInvoice({ kind: 'financier', periodMonth: '2026-09-01', periodEnd: '2026-10-01' }, '2026-10'), false, 'touche le mois courant');
  assert.equal(inactiveTpmMayInvoice({ kind: 'financier', periodMonth: '2026-10-01' }, '2026-10'), false);
  assert.equal(inactiveTpmMayInvoice({ kind: 'technique', periodMonth: '2026-08-01' }, '2026-10'), false);
  assert.equal(inactiveTpmMayInvoice(null, '2026-10'), false);
});

test('D-c (point 25) : une seule source « indisponible » pour les listes de choix ; plan refusé si TOUS ses mois sont indisponibles', () => {
  const rule = require('../src/modules/tpm/tpmAttribution');
  const { unavailableThroughout } = require('../src/modules/tpm/tpmUnavailability');
  const sel = { months: ['2026-11', '2026-12'], groups: [{ key: 'contrat', providers: [{ id: 'y', months: ['2026-11'] }] }, { key: 'tpm', providers: [{ id: 'z', months: [] }] }] };
  const out = rule.withUnavailableMonths(sel, [{ providerId: 'y', month: '2026-12' }, { providerId: 'z', month: '2027-01' }]);
  assert.deepEqual(out.groups.map((g) => g.providers.map((p) => [p.id, p.unavailableMonths])), [[['y', ['2026-12']]], [['z', []]]], 'seuls les mois de la liste');
  assert.equal(unavailableThroughout(['2026-12'], [{ month: '2026-12' }]), true);
  assert.equal(unavailableThroughout(['2026-11', '2026-12'], [{ month: '2026-12' }]), false);
  assert.equal(unavailableThroughout([], [{ month: '2026-12' }]), false);
});
