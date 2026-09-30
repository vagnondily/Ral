const test = require('node:test');
const assert = require('node:assert/strict');
const { itemAmount, summarize, billedToFunder, normalizeItems } = require('../src/modules/tpm/reportMath');

// The real "Formation sur l'activité TPM à Bekily pendant 4 jours" block from
// Facture_YPA_TPM_Novembre_Janvier.pdf (Section IV, all borne by the funder).
const BEKILY = [
  { lineCode: 'IV.suivi', designation: 'Indemnité coordinateur de terrain', unit: 'homme/jour', unitCount: 4, unitCost: 40000, payBy: 'bailleur' },
  { lineCode: 'IV.suivi', designation: 'Indemnité superviseur', unit: 'homme/jour', unitCount: 12, unitCost: 40000, payBy: 'bailleur' },
  { lineCode: 'IV.suivi', designation: 'Indemnité des agents', unit: 'homme/jour', unitCount: 60, unitCost: 40000, payBy: 'bailleur' },
  { lineCode: 'IV.suivi', designation: 'Bloc note', unit: 'Unité', unitCount: 19, unitCost: 3000, payBy: 'bailleur' },
  { lineCode: 'IV.suivi', designation: 'Stylo', unit: 'Unité', unitCount: 19, unitCost: 1000, payBy: 'bailleur' },
  { lineCode: 'IV.suivi', designation: 'Connexion internet', unit: 'homme/jour', unitCount: 1, unitCost: 50000, payBy: 'bailleur' },
  { lineCode: 'IV.suivi', designation: 'Déplacement location voiture', unit: 'jour', unitCount: 4, unitCost: 300000, payBy: 'bailleur' },
  { lineCode: 'IV.suivi', designation: 'carburant', unit: 'litre', unitCount: 252, unitCost: 4900, payBy: 'bailleur' },
];

test('itemAmount = quantité × coût unitaire', () => {
  assert.equal(itemAmount({ unitCount: 60, unitCost: 40000 }), 2400000);
  assert.equal(itemAmount({ unitCount: 252, unitCost: 4900 }), 1234800);
});

test('the Bekily invoice totals to exactly 5 600 800 Ar (matches the PDF)', () => {
  const s = summarize(BEKILY);
  assert.equal(s.total, 5600800);
  assert.equal(s.funder, 5600800);
  assert.equal(s.ong, 0);
  assert.equal(billedToFunder(BEKILY), 5600800);
});

test('summarize groups by FLA section and splits bailleur / ONG', () => {
  const items = [
    { lineCode: 'IV.suivi', designation: 'Suivi terrain', unitCount: 10, unitCost: 1000, payBy: 'bailleur' },
    { lineCode: 'V.locaux', designation: 'Loyer bureau', unitCount: 1, unitCost: 500, payBy: 'ong' },
  ];
  const s = summarize(items);
  assert.equal(s.sections.length, 2);
  const iv = s.sections.find((x) => x.code === 'IV');
  const v = s.sections.find((x) => x.code === 'V');
  assert.equal(iv.funder, 10000);
  assert.equal(v.ong, 500);
  assert.equal(s.total, 10500);
  assert.equal(s.funder, 10000);
  assert.equal(s.ong, 500);
});

test('sections come back in catalogue order I…V', () => {
  const items = [
    { lineCode: 'V.materiel', designation: 'xx', unitCount: 1, unitCost: 1 },
    { lineCode: 'I.transport_mt', designation: 'yy', unitCount: 1, unitCost: 1 },
    { lineCode: 'IV.suivi', designation: 'zz', unitCount: 1, unitCost: 1 },
  ];
  assert.deepEqual(summarize(items).sections.map((s) => s.code), ['I', 'IV', 'V']);
});

test('normalizeItems validates the line, designation, quantities and payer', () => {
  const [it] = normalizeItems([{ lineCode: 'IV.suivi', designation: 'Suivi', unit: 'jour', unitCount: '3', unitCost: '1000', payBy: 'bailleur' }]);
  assert.equal(it.unitCount, 3);
  assert.equal(it.payBy, 'bailleur');
  assert.equal(it.sortOrder, 0);
  assert.throws(() => normalizeItems([{ lineCode: 'ZZ.nope', designation: 'Suivi', unitCount: 1, unitCost: 1 }]), /Ligne budgétaire inconnue/);
  assert.throws(() => normalizeItems([{ lineCode: 'IV.suivi', designation: 'Suivi', unitCount: -1, unitCost: 1 }]), /Quantité invalide/);
  assert.throws(() => normalizeItems([{ lineCode: 'IV.suivi', designation: '', unitCount: 1, unitCost: 1 }]), /désignation/);
});

test('unknown payer falls back to bailleur', () => {
  const [it] = normalizeItems([{ lineCode: 'IV.suivi', designation: 'Suivi', unitCount: 1, unitCost: 1, payBy: 'X' }]);
  assert.equal(it.payBy, 'bailleur');
});

test('bailleur share is a per-line percentage (montant × %)', () => {
  // A salary line split 90 % funder / 10 % ONG, plus a 100 % funder line.
  const items = [
    { lineCode: 'IV.suivi', designation: 'Salaire', unitCount: 1, unitCost: 1000000, bailleurPct: 0.9 },
    { lineCode: 'IV.suivi', designation: 'Indemnité', unitCount: 1, unitCost: 500000, bailleurPct: 1 },
  ];
  const s = summarize(items);
  assert.equal(s.total, 1500000);
  assert.equal(s.funder, 1400000); // 900 000 + 500 000
  assert.equal(s.ong, 100000);     // 100 000 + 0
  assert.equal(billedToFunder(items), 1400000);
});

test('bailleurPct tolerates a percent value and normalizes/clamps', () => {
  const [a] = normalizeItems([{ lineCode: 'IV.suivi', designation: 'xx', unitCount: 1, unitCost: 1, bailleurPct: 90 }]);
  assert.equal(a.bailleurPct, 0.9);       // 90 → 0.9
  assert.equal(a.payBy, 'bailleur');
  const [b] = normalizeItems([{ lineCode: 'IV.suivi', designation: 'yy', unitCount: 1, unitCost: 1, bailleurPct: 0 }]);
  assert.equal(b.bailleurPct, 0);
  assert.equal(b.payBy, 'ong');            // 0 % funder → legacy payBy ong
  // legacy binary still works
  const [c] = normalizeItems([{ lineCode: 'IV.suivi', designation: 'zz', unitCount: 1, unitCost: 1, payBy: 'ong' }]);
  assert.equal(c.bailleurPct, 0);
});

test('a poste can split across two activities (activity1Pct)', () => {
  const [it] = normalizeItems([{ lineCode: 'IV.suivi', designation: 'xx', unitCount: 1, unitCost: 1, activityId: 'a1', activity2Id: 'a2', activity1Pct: 60 }]);
  assert.equal(it.activity2Id, 'a2');
  assert.equal(it.activity1Pct, 0.6);
  // no second activity → activity1Pct stays null (all on activity 1)
  const [j] = normalizeItems([{ lineCode: 'IV.suivi', designation: 'yy', unitCount: 1, unitCost: 1, activityId: 'a1' }]);
  assert.equal(j.activity1Pct, null);
});
