const test = require('node:test');
const assert = require('node:assert/strict');
const { siteKey, buildSiteIndex, resolveSite, queueKeyOf, isAutomaticSite } = require('../src/modules/common/siteMatch');

const URT = 'Unconditional resource transfers to support access to food';
const SMP = 'School meal activities';
const NUT = 'Nutrition treatment activities';

// Référentiel inspiré du RBM réel (noms de lieux publics, aucune donnée nominative).
const SITES = [
  { id: 's1', name: 'ANAVOHA CENTRE', locationId: 'L268', activity: URT, adm2Pcode: 'MG52518', adm3Pcode: 'MG52518010' },
  { id: 's2', name: 'ANAVOHA', locationId: 'L266', activity: URT, adm2Pcode: 'MG52518', adm3Pcode: 'MG52518010' },
  { id: 's3', name: 'ANAVOHA AMBONIRANO', locationId: 'L267', activity: URT, adm2Pcode: 'MG52518', adm3Pcode: 'MG52518010' },
  { id: 's4', name: 'Ambondro Tanambao', locationId: 'L270', activity: URT, adm2Pcode: 'MG52518', adm3Pcode: 'MG52518010' },
  { id: 's5', name: 'EPP MAHENY', code: 'PLAN-0300', activity: SMP, adm2Pcode: 'MG25222', adm3Pcode: 'MG25222010' },
  { id: 's6', name: 'VOHIPOTSY IV', activity: NUT, adm2Pcode: 'MG51506', adm3Pcode: 'MG51506013' },
  { id: 's7', name: 'VOHIPOTSY I', activity: NUT, adm2Pcode: 'MG51506', adm3Pcode: 'MG51506013' },
  { id: 's8', name: 'Antatabe', activity: NUT, adm2Pcode: 'MG51506', adm3Pcode: 'MG51506013' },
  { id: 's9', name: 'Antatabe', activity: SMP, adm2Pcode: 'MG51506', adm3Pcode: 'MG51506013' },
  { id: 's10', name: 'Ambalatsimivike', activity: URT, adm2Pcode: 'MG52516', adm3Pcode: 'MG52516130', adm4Pcode: 'MG52516130099' },
];
const AREAS = new Map([
  ['MG52518010001', { pcode: 'MG52518010001', name: 'Anavoha', depth: 4, parentPcode: 'MG52518010' }],
  ['MG52518010011', { pcode: 'MG52518010011', name: 'Ambondro', depth: 4, parentPcode: 'MG52518010' }],
  ['MG52518010012', { pcode: 'MG52518010012', name: 'Tanandava', depth: 4, parentPcode: 'MG52518010' }],
  ['MG52518010', { pcode: 'MG52518010', name: 'Morafeno Bekily', depth: 3, parentPcode: 'MG52518' }],
]);
const areaOf = (p) => AREAS.get(p) || null;
const idx = buildSiteIndex(SITES, { aliases: [{ parentKey: 'MG51506013', aliasKey: siteKey('Antatabe Haut'), targetId: 's8' }] });
const r = (q) => resolveSite(idx, { areaOf, ...q });

test('site : clé sans accents ni type d\'établissement, chiffres romains ramenés', () => {
  assert.equal(siteKey('EPP Maheny'), siteKey('maheny'));
  assert.equal(siteKey('Vohipotsy_Iv'), siteKey('VOHIPOTSY IV'));
  assert.notEqual(siteKey('Vohipotsy I'), siteKey('Vohipotsy IV'));
});

test('site : code ou ID RBM du référentiel', () => {
  const x = r({ value: 'l268' });
  assert.equal(x.status, 'code'); assert.equal(x.site.id, 's1');
  assert.equal(r({ value: 'PLAN-0300' }).site.id, 's5');
});

test('GD : DPName = pcode du fokontany → site du même nom dans la commune', () => {
  const x = r({ value: 'MG52518010001', activity: URT });
  assert.equal(x.status, 'lieu'); assert.equal(x.site.id, 's2'); // « ANAVOHA » et non « ANAVOHA CENTRE »
  const y = r({ value: 'MG52518010011', activity: URT });
  assert.equal(y.status, 'deduit'); assert.equal(y.site.id, 's4'); // seul site de la commune qui contient « Ambondro »
  assert.equal(y.area.name, 'Ambondro');
});

test('MIARO : POIName = pcode du fokontany suivi d\'un n° ; site rattaché par son fokontany (adm4)', () => {
  const x = r({ value: 'MG52516130099001', activity: URT, areaOf: (p) => (p === 'MG52516130099' ? { pcode: p, name: 'Ankilibe', depth: 4, parentPcode: 'MG52516130' } : null) });
  assert.equal(x.status, 'lieu'); assert.equal(x.site.id, 's10');
});

test('pcode sans site correspondant : jamais rattaché au hasard', () => {
  const x = r({ value: 'MG52518010012', activity: URT }); // Tanandava : aucun site
  assert.equal(x.status, 'introuvable'); assert.equal(x.site, null);
  assert.equal(isAutomaticSite(x.status), false);
});

test('Nutrition : nom saisi reconnu dans la commune, I et IV jamais confondus', () => {
  const x = r({ value: 'Vohipotsy_Iv', adm3: 'MG51506013', activity: NUT });
  assert.equal(x.status, 'nom'); assert.equal(x.site.id, 's6');
  const y = r({ value: 'Vohipotsy II', adm3: 'MG51506013', activity: NUT });
  assert.notEqual(y.status, 'nom'); assert.equal(y.site, null);
  assert.ok(!y.candidates.some((c) => c.score >= 0.9));
});

test('activité du formulaire : départage deux sites homonymes de la commune', () => {
  assert.equal(r({ value: 'Antatabe', adm3: 'MG51506013', activity: NUT }).site.id, 's8');
  assert.equal(r({ value: 'Antatabe', adm3: 'MG51506013', activity: SMP }).site.id, 's9');
  assert.equal(r({ value: 'Antatabe', adm3: 'MG51506013' }).status, 'ambigu');
});

test('cantines : code d\'école + nom de l\'export ; reconnu dans le district quand la commune manque', () => {
  const x = r({ value: '609010034', label: 'Maheny', adm2: 'MG25222', activity: SMP });
  assert.equal(x.status, 'nom'); assert.equal(x.site.id, 's5');
});

test('graphie apprise (validée une fois) réutilisée', () => {
  const x = r({ value: 'Antatabe-Haut', adm3: 'MG51506013', activity: NUT });
  assert.equal(x.status, 'alias'); assert.equal(x.site.id, 's8');
});

test('nom proche : proposé, jamais appliqué seul ; hors de toute zone : proposé même s\'il est unique', () => {
  const x = r({ value: 'Ambalatsimivik', adm3: 'MG52516130', activity: URT });
  assert.equal(x.status, 'a_valider'); assert.equal(x.candidates[0].site.id, 's10');
  const y = r({ value: 'Maheny' });
  assert.equal(y.status, 'a_valider'); assert.equal(y.candidates[0].site.id, 's5');
  // Hors zone, un nom seulement proche n'est pas proposé (aucun candidat ailleurs dans le pays).
  const z = r({ value: 'Ambalatsimivik' });
  assert.equal(z.status, 'introuvable'); assert.deepEqual(z.candidates, []);
  assert.equal(r({ value: '' }).status, 'vide');
});

test('file et graphie apprise : un code vaut pour tout le pays, un nom dans sa commune', () => {
  assert.deepEqual(queueKeyOf({ value: '609010034', label: 'Maheny', adm2: 'MG25222' }), { parentKey: '', rawKey: 'code:609010034', rawLabel: 'Maheny (609010034)' });
  assert.deepEqual(queueKeyOf({ value: 'mg52518010012' }), { parentKey: '', rawKey: 'code:MG52518010012', rawLabel: 'mg52518010012' });
  assert.deepEqual(queueKeyOf({ value: 'Maniry Sud', adm3: 'mg51507090' }), { parentKey: 'MG51507090', rawKey: siteKey('Maniry Sud'), rawLabel: 'Maniry Sud' });
  // Un code relié à la main une fois est ensuite reconnu partout.
  const learned = buildSiteIndex(SITES, { aliases: [{ parentKey: '', aliasKey: 'code:MG52518010012', targetId: 's1' }] });
  const x = resolveSite(learned, { value: 'MG52518010012', areaOf, activity: URT });
  assert.equal(x.status, 'alias'); assert.equal(x.site.id, 's1');
});

// --- Garde-fous (relecture adverse) ------------------------------------------------
const SCHOOL = [{ id: 'e1', name: 'EPP TERABOVO', activity: SMP, adm3Pcode: 'MG52518010' }];
const fktTerabovo = (p) => (p === 'MG52518010030' ? { pcode: p, name: 'Terabovo', depth: 4, parentPcode: 'MG52518010' } : null);

test('activité : une distribution GD n\'est jamais reliée seule à l\'école du fokontany ; sans activité de fiche, seulement proposé', () => {
  const idx2 = buildSiteIndex(SCHOOL);
  const gd = resolveSite(idx2, { value: 'MG52518010030', activity: URT, areaOf: fktTerabovo });
  assert.equal(gd.status, 'a_valider'); assert.equal(gd.site, null); assert.equal(gd.candidates[0].site.id, 'e1');
  const none = resolveSite(idx2, { value: 'MG52518010030', areaOf: fktTerabovo });
  assert.equal(isAutomaticSite(none.status), false);
  assert.equal(resolveSite(idx2, { value: 'MG52518010030', activity: SMP, areaOf: fktTerabovo }).status, 'lieu');
});

test('commune connue sans site : un homonyme ailleurs dans le district n\'est que proposé', () => {
  const idx2 = buildSiteIndex([{ id: 't1', name: 'TANAMBAO', activity: URT, adm2Pcode: 'MG52514', adm3Pcode: 'MG52514011B' }]);
  const x = resolveSite(idx2, { value: 'Tanambao', adm2: 'MG52514', adm3: 'MG52514011A', activity: URT });
  assert.equal(x.status, 'a_valider'); assert.equal(x.site, null);
  // Commune inconnue : le district fait foi.
  assert.equal(resolveSite(idx2, { value: 'Tanambao', adm2: 'MG52514', activity: URT }).status, 'nom');
});

test('graphie apprise sans zone : ne s\'applique pas là où la commune est connue', () => {
  const idx2 = buildSiteIndex(SITES, { aliases: [{ parentKey: '', aliasKey: siteKey('Antatabe'), targetId: 's9' }] });
  assert.equal(resolveSite(idx2, { value: 'Antatabe', adm3: 'MG51506013', activity: NUT }).site.id, 's8');
  assert.equal(resolveSite(idx2, { value: 'Antatabe' }).site.id, 's9');
});

test('petit code de liste (« 3 ») : clé par libellé dans sa zone, pas un code valable partout', () => {
  assert.deepEqual(queueKeyOf({ value: '3', label: 'Maheny', adm3: 'MG25222010' }), { parentKey: 'MG25222010', rawKey: siteKey('Maheny'), rawLabel: 'Maheny (3)' });
  const idx2 = buildSiteIndex(SITES, { aliases: [{ parentKey: '', aliasKey: 'code:3', targetId: 's5' }] });
  assert.notEqual(resolveSite(idx2, { value: '3', label: 'Ambovombe', adm3: 'MG51506013' }).status, 'alias');
});

test('« deduit » : jamais vers un autre numéro (Beavake → BEAVAKE I) ni vers le site d\'un autre fokontany', () => {
  const idx2 = buildSiteIndex([
    { id: 'b1', name: 'BEAVAKE I', activity: URT, adm3Pcode: 'MG51507110' },
    { id: 'b2', name: 'ANALALAVA CENTRE', activity: URT, adm3Pcode: 'MG51507110', adm4Pcode: 'MG51507110099' },
  ]);
  const areaOf = (p) => ({ MG51507110004: { pcode: 'MG51507110004', name: 'Beavake', depth: 4, parentPcode: 'MG51507110' },
    MG51507110005: { pcode: 'MG51507110005', name: 'Analalava', depth: 4, parentPcode: 'MG51507110' } }[p] || null);
  assert.equal(isAutomaticSite(resolveSite(idx2, { value: 'MG51507110004', activity: URT, areaOf }).status), false);
  assert.equal(isAutomaticSite(resolveSite(idx2, { value: 'MG51507110005', activity: URT, areaOf }).status), false);
});

test('valeur sans contenu (« - », « . ») : vide, rien en file ; clé longue bornée à 200 caractères', () => {
  for (const v of ['-', '.', '/', '___']) {
    assert.equal(resolveSite(idx, { value: v, adm3: 'MG51506013' }).status, 'vide', v);
    assert.equal(queueKeyOf({ value: v, adm3: 'MG51506013' }).rawKey, '', v);
  }
  const long = 'Site '.repeat(80);
  const k1 = queueKeyOf({ value: `${long}A`, adm3: 'X' }).rawKey; const k2 = queueKeyOf({ value: `${long}B`, adm3: 'X' }).rawKey;
  assert.ok(k1.length <= 200 && k2.length <= 200); assert.notEqual(k1, k2);
});
