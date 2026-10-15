const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../src/modules/tpm/activationMath');

test('Oui / Non / vide, avec les variantes courantes ; le reste est refusé', () => {
  for (const v of ['Oui', 'oui ', 'OUI', 'Yes', '1', 'Active', 'x']) assert.deepEqual(m.parseYesNo(v), { ok: true, value: true }, v);
  for (const v of ['Non', 'non', 'No', '0', 'Inactive', 'inactif']) assert.deepEqual(m.parseYesNo(v), { ok: true, value: false }, v);
  for (const v of ['', '  ', null, undefined]) assert.deepEqual(m.parseYesNo(v), { ok: true, value: null });
  for (const v of ['peut-être', '2', 'Ouii']) assert.equal(m.parseYesNo(v).ok, false, v);
  assert.equal(m.yesNo(true), 'Oui'); assert.equal(m.yesNo(false), 'Non'); assert.equal(m.yesNo(null), '');
});

test('identifiant = Code POI + Tag_code, sinon code MEMS', () => {
  assert.equal(m.identifierOf({ locationId: 'MG23209031001001', tagCode: 'STUNT', code: 'PLAN-0001' }), 'MG23209031001001STUNT');
  assert.equal(m.identifierOf({ locationId: 'L001', tagCode: null }), 'L001');
  assert.equal(m.identifierOf({ locationId: '', code: 'PLAN-0002' }), 'PLAN-0002');
});

test('rapprochement : identifiant, Code POI + Tag_code recalculé, code MEMS ; ambigu jamais rapproché', () => {
  const idx = m.buildSiteIndex([
    { id: 'a', locationId: 'MG1', tagCode: 'SMP', code: 'PLAN-1' },
    { id: 'b', locationId: 'MG1', tagCode: 'STUNT', code: 'PLAN-2' },
    { id: 'c', locationId: 'MG9', tagCode: 'SMP', code: 'PLAN-3' },
    { id: 'd', locationId: 'MG9', tagCode: 'SMP', code: 'PLAN-4' },
  ]);
  assert.deepEqual(idx.resolve('MG1SMP'), { siteId: 'a', ambiguous: false });
  assert.deepEqual(idx.resolve(' mg1 stunt '), { siteId: 'b', ambiguous: false });
  // Formule de l'identifiant non recalculée dans le fichier : Code POI + Tag_code.
  assert.deepEqual(idx.resolve('', { locationId: 'MG1', tagCode: 'STUNT' }), { siteId: 'b', ambiguous: false });
  assert.deepEqual(idx.resolve('PLAN-3'), { siteId: 'c', ambiguous: false });
  assert.deepEqual(idx.resolve('MG9SMP'), { siteId: null, ambiguous: true });
  assert.deepEqual(idx.resolve('INCONNU'), { siteId: null, ambiguous: false });
});

test('rapprochement : l\'identifiant MEMS (S-XXXX-XXXX, saisie tolérante) prime sur le reste', () => {
  const idx = m.buildSiteIndex([
    { id: 'a', publicId: 'S-7K3F-9Q2X', locationId: 'MG1', tagCode: 'SMP' },
    { id: 'b', publicId: 'S-0000-1111', locationId: 'MG2', tagCode: 'SMP' },
  ]);
  // Identifiant du classeur modifié par erreur : l'ID MEMS désigne toujours le bon site.
  assert.deepEqual(idx.resolve('MG2SMP', { publicId: 's 7k3f 9q2x' }), { siteId: 'a', ambiguous: false });
  assert.deepEqual(idx.resolve('S-0000-IIII'), { siteId: null, ambiguous: false }); // pas une colonne ID MEMS
  assert.deepEqual(idx.resolve('', { publicId: 'S-0000-IIII' }), { siteId: 'b', ambiguous: false }); // I → 1
});

test('écarts : seuls les mois qui changent ; vide (undefined) = inchangé ; null = effacer', () => {
  const current = new Map([['a', { 1: true, 2: true, 3: false }]]);
  const changes = m.diffActivation(current, [
    { siteId: 'a', months: { 1: true, 2: false, 3: null, 4: undefined, 5: true }, reason: '  fin de l\'activité  ' },
    { siteId: 'a', months: { 2: true } }, // doublon : la première ligne fait foi
    { siteId: 'b', months: { 12: false } },
  ]);
  assert.deepEqual(changes, [
    { siteId: 'a', month: 2, before: true, after: false, reason: 'fin de l\'activité' },
    { siteId: 'a', month: 3, before: false, after: null, reason: 'fin de l\'activité' },
    { siteId: 'a', month: 5, before: null, after: true, reason: 'fin de l\'activité' },
    { siteId: 'b', month: 12, before: null, after: false, reason: null },
  ]);
  assert.deepEqual(m.summarizeChanges(changes), { changes: 4, sites: 2, activated: 1, deactivated: 2, cleared: 1 });
});

test('totaux par mois et « actif sur l\'exercice »', () => {
  const t = m.monthTotals([{ months: { 1: true, 2: false } }, { months: { 1: true } }, { months: {} }]);
  assert.deepEqual(t[0], { month: 1, active: 2, inactive: 0, unknown: 1 });
  assert.deepEqual(t[1], { month: 2, active: 0, inactive: 1, unknown: 2 });
  assert.equal(t.length, 12);
  assert.equal(m.activeInYear({ 7: true }), true);
  assert.equal(m.activeInYear({ 1: false }), false);
});

test('motif : nettoyé, borné à 500 caractères, vide = null', () => {
  assert.equal(m.cleanReason('   '), null);
  assert.equal(m.cleanReason(42), null);
  assert.equal([...m.cleanReason('é'.repeat(600))].length, 500);
});

test('cases vides : seules les cases SANS statut prennent la valeur ; un Oui / Non saisi ne change jamais', () => {
  const current = new Map([['a', { 1: true, 2: false }], ['b', {}]]);
  const wanted = m.blankFill(current, ['a', 'b', 'c', 'a'], { from: 1, to: 3, value: true, reason: 'ouverture' });
  assert.deepEqual(wanted, [
    { siteId: 'a', months: { 3: true }, reason: 'ouverture' },
    { siteId: 'b', months: { 1: true, 2: true, 3: true }, reason: 'ouverture' },
    { siteId: 'c', months: { 1: true, 2: true, 3: true }, reason: 'ouverture' },
  ]);
  // Branché sur diffActivation : les écarts partent de « non renseigné ».
  const diff = m.diffActivation(current, wanted);
  assert.equal(diff.length, 7);
  assert.ok(diff.every((c) => c.before === null && c.after === true));
  assert.deepEqual(m.summarizeChanges(diff), { changes: 7, sites: 3, activated: 7, deactivated: 0, cleared: 0 });
});

test('cases vides : bornes remises dans l\'ordre et dans 1..12 ; rien à remplir = aucun écart ; valeur booléenne exigée', () => {
  const full = new Map([['a', Object.fromEntries(m.MONTHS.map((x) => [x, false]))]]);
  assert.deepEqual(m.blankFill(full, ['a'], { from: 1, to: 12, value: true }), []);
  const w = m.blankFill(new Map(), ['a'], { from: 14, to: 11, value: false });
  assert.deepEqual(w, [{ siteId: 'a', months: { 11: false, 12: false }, reason: null }]);
  assert.throws(() => m.blankFill(new Map(), ['a'], { from: 1, to: 2, value: null }), TypeError);
});
