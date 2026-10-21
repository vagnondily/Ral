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

test('web : statut affiché d un gabarit en retard = « En retard » (liste, onglet), comme la carte', async (t) => {
  const file = path.join(__dirname, '../../web/src/lib/reportExpectation.js');
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return; }
  const w = await import(pathToFileURL(file).href);
  assert.equal(w.reportShownStatus({ status: 'attendu', late: true }), 'en_retard');
  assert.equal(w.reportStatusDef({ status: 'attendu', late: true }), w.EXPECTED_STATUS.en_retard);
  assert.equal(w.reportShownStatus({ status: 'attendu', autoNotApplicable: true, late: false }), 'non_applicable');
  assert.equal(w.reportShownStatus({ status: 'soumis', late: false }), 'soumis');
});
