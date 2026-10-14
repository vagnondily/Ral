const test = require('node:test');
const assert = require('node:assert/strict');
const { siteDistricts, districtKey } = require('../src/modules/common/siteDistrict');

// Découpage de démonstration (extraits réels) : nom de la zone du P-code de district et sa région.
const AMBOASARY = { pcodeName: 'Amboasary-Atsimo', pcodeRegion: 'Anosy' };
const VANGAINDRANO = { pcodeName: 'Vangaindrano', pcodeRegion: 'Atsimo Atsinanana' };

test('districtKey : minuscules, lettres et chiffres ASCII seulement', () => {
  assert.equal(districtKey('Toliara-II'), 'toliaraii');
  assert.equal(districtKey(' AMBOASARY SUD '), 'amboasarysud');
  assert.equal(districtKey('Atsimo-Andrefana'), districtKey('Atsimo Andrefana'));
  assert.equal(districtKey(null), '');
});

test('un P-code de district d\'une AUTRE région ne déplace jamais le site (ANARABAJY, 2026-09)', () => {
  const sites = [
    // 3 sites « Amboasary » dont le P-code est d'accord (région Anosy) : ils apprennent le nom officiel.
    ...[1, 2, 3].map((i) => ({ id: `ok${i}`, adm1: 'Anosy', adm2: 'Amboasary', ...AMBOASARY })),
    // ANARABAJY : Anosy, Amboasary, mais adm2_pcode = Vangaindrano (Atsimo Atsinanana).
    { id: 'anarabajy', adm1: 'Anosy', adm2: 'Amboasary', ...VANGAINDRANO },
  ];
  const d = siteDistricts(sites);
  assert.deepEqual(d.get('anarabajy'), { key: 'amboasaryatsimo', name: 'Amboasary-Atsimo', official: 'Amboasary-Atsimo' });
  assert.equal(d.get('anarabajy').key, d.get('ok1').key, 'même groupe que les autres sites « Amboasary »');
  assert.ok(![...d.values()].some((x) => /vangaindrano/i.test(x.name)), 'aucune visite rangée à Vangaindrano');
});

test('sans site d\'accord, la graphie du site est gardée — jamais le nom du P-code d\'une autre région', () => {
  const d = siteDistricts([{ id: 'a', adm1: 'Anosy', adm2: 'Amboasary', ...VANGAINDRANO }]);
  assert.deepEqual(d.get('a'), { key: 'amboasary', name: 'Amboasary', official: null });
});

test('variantes d\'un même district réunies (casse, « sud », tiret) : une seule ligne (retour 15)', () => {
  const sites = [
    { id: 'a', adm1: 'Anosy', adm2: 'Amboasary', ...AMBOASARY },
    { id: 'b', adm1: 'Anosy', adm2: 'Amboasary sud', ...AMBOASARY },
    { id: 'c', adm1: 'Anosy', adm2: 'AMBOASARY SUD' }, // sans P-code : appris de « Amboasary sud »
    { id: 'd', adm1: 'Anosy', district: 'Amboasary-Atsimo', ...AMBOASARY },
    { id: 'e', adm1: '', adm2: 'Amboasary Sud' }, // région vide : graphie connue d'une seule région
  ];
  const d = siteDistricts(sites);
  for (const id of ['a', 'b', 'c', 'd', 'e']) assert.equal(d.get(id).key, 'amboasaryatsimo', id);
  assert.equal(d.get('c').name, 'Amboasary-Atsimo');
});

test('région du site et du découpage comparées sans la graphie (« Atsimo-Andrefana » = « Atsimo Andrefana »)', () => {
  const d = siteDistricts([
    { id: 'a', adm1: 'Atsimo-Andrefana', adm2: 'Toliara II', pcodeName: 'Toliary-II', pcodeRegion: 'Atsimo Andrefana' },
    { id: 'b', adm1: 'Atsimo Andrefana', adm2: 'Toliara II' },
  ]);
  assert.equal(d.get('a').name, 'Toliary-II');
  assert.equal(d.get('b').name, 'Toliary-II');
});

test('vote majoritaire : une graphie suit le district officiel le plus fréquent de sa région', () => {
  const sites = [
    ...[1, 2, 3].map((i) => ({ id: `m${i}`, adm1: 'Androy', adm2: 'Ambovombe', pcodeName: 'Ambovombe-Androy', pcodeRegion: 'Androy' })),
    // P-code d'accord sur la région mais d'un autre district : la graphie du site l'emporte.
    { id: 'x', adm1: 'Androy', adm2: 'Ambovombe', pcodeName: 'Antanimora Sud', pcodeRegion: 'Androy' },
    { id: 'y', adm1: 'Androy', adm2: 'Antanimora', pcodeName: 'Antanimora Sud', pcodeRegion: 'Androy' },
  ];
  const d = siteDistricts(sites);
  assert.equal(d.get('x').name, 'Ambovombe-Androy');
  assert.equal(d.get('y').name, 'Antanimora Sud');
});

test('égalité de votes : départage par ordre binaire (le même qu\'en SQL, COLLATE "C")', () => {
  const d = siteDistricts([
    { id: 'a', adm1: 'R', adm2: 'X', pcodeName: 'Zeta', pcodeRegion: 'R' },
    { id: 'b', adm1: 'R', adm2: 'X', pcodeName: 'Alpha', pcodeRegion: 'R' },
  ]);
  assert.equal(d.get('a').name, 'Alpha');
});

test('site sans graphie : nom officiel si son P-code est d\'accord, sinon « — »', () => {
  const d = siteDistricts([
    { id: 'a', adm1: 'Anosy', ...AMBOASARY },
    { id: 'b', adm1: 'Anosy', ...VANGAINDRANO },
    { id: 'c' },
  ]);
  assert.deepEqual(d.get('a'), { key: 'amboasaryatsimo', name: 'Amboasary-Atsimo', official: 'Amboasary-Atsimo' });
  assert.deepEqual(d.get('b'), { key: '—', name: '—', official: null });
  assert.deepEqual(d.get('c'), { key: '—', name: '—', official: null });
});

test('graphie sans région connue de deux régions : gardée telle quelle (aucun choix arbitraire)', () => {
  const d = siteDistricts([
    { id: 'a', adm1: 'R1', adm2: 'Centre', pcodeName: 'Centre Nord', pcodeRegion: 'R1' },
    { id: 'b', adm1: 'R2', adm2: 'Centre', pcodeName: 'Centre Sud', pcodeRegion: 'R2' },
    { id: 'c', adm1: '', adm2: 'Centre' },
  ]);
  assert.equal(d.get('a').name, 'Centre Nord');
  assert.equal(d.get('b').name, 'Centre Sud');
  assert.deepEqual(d.get('c'), { key: 'centre', name: 'Centre', official: null });
});
