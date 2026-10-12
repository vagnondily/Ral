const test = require('node:test');
const assert = require('node:assert/strict');
const { itemAmount, summarize, billedToFunder, normalizeItems, payByOf } = require('../src/modules/tpm/reportMath');

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

// Règle de cohérence pay_by ⇔ bailleur_pct (même règle que la contrainte CHECK
// de la migration 048) : 'ong' ⇔ 0 %, 'bailleur' ⇔ > 0 %.
const DB_RULE = (it) => (it.payBy === 'ong' && it.bailleurPct === 0) || (it.payBy === 'bailleur' && it.bailleurPct > 0);
const poste = (extra) => ({ lineCode: 'IV.suivi', designation: 'Salaire', unitCount: 1, unitCost: 1000000, ...extra });

test('payByOf : ONG si et seulement si 0 % bailleur', () => {
  assert.equal(payByOf(0), 'ong');
  assert.equal(payByOf(0.00001), 'bailleur');
  assert.equal(payByOf(0.9), 'bailleur');
  assert.equal(payByOf(1), 'bailleur');
});

test('normalizeItems rend toujours une paire pay_by / % cohérente avec la base', () => {
  const inputs = [
    {}, { payBy: 'bailleur' }, { payBy: 'ong' }, { payBy: 'X' },
    { bailleurPct: 1 }, { bailleurPct: 0.9 }, { bailleurPct: 0 }, { bailleurPct: 90 }, { bailleurPct: 100 },
    { bailleurPct: 0.9, payBy: 'bailleur' }, { bailleurPct: 0, payBy: 'ong' }, { bailleurPct: '', payBy: 'ong' },
  ];
  for (const extra of inputs) {
    const [it] = normalizeItems([poste(extra)]);
    assert.ok(DB_RULE(it), `${JSON.stringify(extra)} → ${it.payBy} / ${it.bailleurPct}`);
  }
  assert.equal(normalizeItems([poste({ payBy: 'ong' })])[0].bailleurPct, 0);
  assert.equal(normalizeItems([poste({ bailleurPct: 0.9 })])[0].payBy, 'bailleur');
});

test('normalizeItems refuse un « à la charge de » qui contredit le % bailleur', () => {
  assert.throws(() => normalizeItems([poste({ payBy: 'ong', bailleurPct: 0.9 })]),
    /Part bailleur invalide pour « Salaire » : un poste à la charge de l'ONG doit avoir 0 % bailleur/);
  assert.throws(() => normalizeItems([poste({ payBy: 'bailleur', bailleurPct: 0 })]),
    /un poste à la charge du bailleur doit avoir un % bailleur supérieur à 0/);
});

test('normalizeItems refuse un % bailleur illisible ou hors bornes (jamais corrigé en silence)', () => {
  for (const bailleurPct of ['abc', -0.1, 150, Number.NaN]) {
    assert.throws(() => normalizeItems([poste({ bailleurPct })]), /% bailleur invalide pour « Salaire »/, String(bailleurPct));
  }
});

test('le % est arrondi à la précision de la base avant d\'en déduire pay_by', () => {
  // numeric(6,5) : 0,000001 s'enregistre 0 → doit être « ONG », pas « bailleur ».
  const [tiny] = normalizeItems([poste({ bailleurPct: 0.000001 })]);
  assert.equal(tiny.bailleurPct, 0);
  assert.equal(tiny.payBy, 'ong');
  const [third] = normalizeItems([poste({ bailleurPct: 1 / 3 })]);
  assert.equal(third.bailleurPct, 0.33333);
  // La part bailleur calculée sur le poste nettoyé est celle que la base recalculera.
  assert.equal(summarize([third]).funder, 333330);
});

test('ligne à 90 % : 90 % bailleur / 10 % ONG ; ligne à 0 % : 0 / 100 % (centimes entiers)', () => {
  const items = normalizeItems([
    poste({ designation: 'Salaire 90', unitCost: 1478998.5, bailleurPct: 0.9 }),
    poste({ designation: 'Loyer ONG', unitCost: 500000, bailleurPct: 0 }),
  ]);
  const s = summarize(items);
  assert.equal(s.total, 1978998.5);
  assert.equal(s.funder, 1331098.65);   // 147 899 850 c × 0,9 = 133 109 865 c
  assert.equal(s.ong, 647899.85);       // 14 789 985 c + 50 000 000 c
  assert.equal(Math.round(s.funder * 100) + Math.round(s.ong * 100), Math.round(s.total * 100));
});
