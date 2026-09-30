const test = require('node:test');
const assert = require('node:assert/strict');
const { itemAmount, summarize, billedToPam, normalizeItems } = require('../src/modules/tpm/reportMath');

// The real "Formation sur l'activité TPM à Bekily pendant 4 jours" block from
// Facture_YPA_TPM_Novembre_Janvier.pdf (Section IV, all paid by the PAM).
const BEKILY = [
  { lineCode: 'IV.suivi', designation: 'Indemnité coordinateur de terrain', unit: 'homme/jour', unitCount: 4, unitCost: 40000, payBy: 'PAM' },
  { lineCode: 'IV.suivi', designation: 'Indemnité superviseur', unit: 'homme/jour', unitCount: 12, unitCost: 40000, payBy: 'PAM' },
  { lineCode: 'IV.suivi', designation: 'Indemnité des agents', unit: 'homme/jour', unitCount: 60, unitCost: 40000, payBy: 'PAM' },
  { lineCode: 'IV.suivi', designation: 'Bloc note', unit: 'Unité', unitCount: 19, unitCost: 3000, payBy: 'PAM' },
  { lineCode: 'IV.suivi', designation: 'Stylo', unit: 'Unité', unitCount: 19, unitCost: 1000, payBy: 'PAM' },
  { lineCode: 'IV.suivi', designation: 'Connexion internet', unit: 'homme/jour', unitCount: 1, unitCost: 50000, payBy: 'PAM' },
  { lineCode: 'IV.suivi', designation: 'Déplacement location voiture', unit: 'jour', unitCount: 4, unitCost: 300000, payBy: 'PAM' },
  { lineCode: 'IV.suivi', designation: 'carburant', unit: 'litre', unitCount: 252, unitCost: 4900, payBy: 'PAM' },
];

test('itemAmount = quantité × coût unitaire', () => {
  assert.equal(itemAmount({ unitCount: 60, unitCost: 40000 }), 2400000);
  assert.equal(itemAmount({ unitCount: 252, unitCost: 4900 }), 1234800);
});

test('the Bekily invoice totals to exactly 5 600 800 Ar (matches the PDF)', () => {
  const s = summarize(BEKILY);
  assert.equal(s.total, 5600800);
  assert.equal(s.pam, 5600800);
  assert.equal(s.ong, 0);
  assert.equal(billedToPam(BEKILY), 5600800);
});

test('summarize groups by FLA section and splits PAM / ONG', () => {
  const items = [
    { lineCode: 'IV.suivi', designation: 'Suivi terrain', unitCount: 10, unitCost: 1000, payBy: 'PAM' },
    { lineCode: 'V.locaux', designation: 'Loyer bureau', unitCount: 1, unitCost: 500, payBy: 'ONG' },
  ];
  const s = summarize(items);
  assert.equal(s.sections.length, 2);
  const iv = s.sections.find((x) => x.code === 'IV');
  const v = s.sections.find((x) => x.code === 'V');
  assert.equal(iv.pam, 10000);
  assert.equal(v.ong, 500);
  assert.equal(s.total, 10500);
  assert.equal(s.pam, 10000);
  assert.equal(s.ong, 500);
});

test('sections come back in catalogue order I…V', () => {
  const items = [
    { lineCode: 'V.materiel', designation: 'x', unitCount: 1, unitCost: 1 },
    { lineCode: 'I.transport_mt', designation: 'y', unitCount: 1, unitCost: 1 },
    { lineCode: 'IV.suivi', designation: 'z', unitCount: 1, unitCost: 1 },
  ];
  assert.deepEqual(summarize(items).sections.map((s) => s.code), ['I', 'IV', 'V']);
});

test('normalizeItems validates the line, designation, quantities and payer', () => {
  const [it] = normalizeItems([{ lineCode: 'IV.suivi', designation: 'Suivi', unit: 'jour', unitCount: '3', unitCost: '1000', payBy: 'PAM' }]);
  assert.equal(it.unitCount, 3);
  assert.equal(it.payBy, 'PAM');
  assert.equal(it.sortOrder, 0);
  assert.throws(() => normalizeItems([{ lineCode: 'ZZ.nope', designation: 'Suivi', unitCount: 1, unitCost: 1 }]), /Ligne budgétaire inconnue/);
  assert.throws(() => normalizeItems([{ lineCode: 'IV.suivi', designation: 'Suivi', unitCount: -1, unitCost: 1 }]), /Quantité invalide/);
  assert.throws(() => normalizeItems([{ lineCode: 'IV.suivi', designation: '', unitCount: 1, unitCost: 1 }]), /désignation/);
});

test('unknown payer falls back to PAM', () => {
  const [it] = normalizeItems([{ lineCode: 'IV.suivi', designation: 'Suivi', unitCount: 1, unitCost: 1, payBy: 'X' }]);
  assert.equal(it.payBy, 'PAM');
});
