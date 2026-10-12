const test = require('node:test');
const assert = require('node:assert/strict');
const { detectColumns, buildRows, parseCsv, pickShapefile } = require('../src/modules/settings/adminImport');
const { readShp, isGeographicPrj } = require('../src/modules/settings/shpReader');
const { planBreakdown, matchBreakdown, relinkByPath, directoryCsv, siteColumnFor } = require('../src/modules/settings/localities.domain');

// Colonnes réelles d'un découpage COD-AB (ordre du .dbf : le P-code AVANT le nom).
const COD_FIELDS = ['ADM0_PCODE', 'ADM0_EN', 'ADM1_PCODE', 'ADM1_EN', 'ADM1_TYPE', 'ADM2_PCODE', 'ADM2_EN', 'ADM3_PCODE', 'ADM3_EN', 'ADM3_FR',
  'ADM4_PCODE', 'ADM4_EN', 'ADM4_REF', 'ADM4ALT1EN', 'date', 'validOn', 'Shape_Leng'];

test('shapefile COD-AB : le NOM et le P-code sont distingués (bug « ADM0_PCODE »), pays ignoré, FR préféré', () => {
  const c = detectColumns(COD_FIELDS);
  assert.deepEqual(c.levels.map((l) => l.code), ['adm1', 'adm2', 'adm3', 'adm4']);
  assert.deepEqual(c.levels.map((l) => l.nameField), ['ADM1_EN', 'ADM2_EN', 'ADM3_FR', 'ADM4_EN']);
  assert.deepEqual(c.levels.map((l) => l.pcodeField), ['ADM1_PCODE', 'ADM2_PCODE', 'ADM3_PCODE', 'ADM4_PCODE']);
});

test('colonnes métier sans préfixe ADM + P-code + GPS', () => {
  const c = detectColumns(['Région', 'District', 'District P-code', 'Commune', 'commune_code', 'Latitude', 'Longitude']);
  assert.deepEqual(c.levels.map((l) => [l.code, l.nameField, l.pcodeField]),
    [['adm1', 'Région', null], ['adm2', 'District', 'District P-code'], ['adm3', 'Commune', 'commune_code']]);
  assert.equal(c.latField, 'Latitude'); assert.equal(c.lngField, 'Longitude');
});

test('lignes : chaîne arrêtée au premier niveau vide, GPS plausible seulement', () => {
  const c = detectColumns(['ADM1_EN', 'ADM1_PCODE', 'ADM2_EN', 'ADM2_PCODE']);
  const rows = buildRows([
    { ADM1_EN: 'Anosy', ADM1_PCODE: 'MG23', ADM2_EN: 'Amboasary', ADM2_PCODE: 'MG2301' },
    { ADM1_EN: 'Androy', ADM1_PCODE: 'MG25', ADM2_EN: '', ADM2_PCODE: '' },
    { ADM1_EN: '', ADM2_EN: 'Orphelin' },
  ], c, [{ lat: -25.0, lng: 46.4 }, { lat: 999, lng: 0 }, null]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { names: ['Anosy', 'Amboasary'], pcodes: ['MG23', 'MG2301'], lat: -25, lng: 46.4 });
  assert.deepEqual(rows[1], { names: ['Androy'], pcodes: ['MG25'], lat: null, lng: null });
});

test('CSV libre historique : chaque colonne = un niveau, avertissement', () => {
  const r = parseCsv('Zone A;Zone B\nAnosy;Amboasary\n');
  assert.deepEqual(r.levels.map((l) => l.label), ['Zone A', 'Zone B']);
  // « Faritra » (région en malgache) est, lui, reconnu comme niveau 1.
  assert.equal(parseCsv('Faritra;Distrika\nAnosy;X\n').levels[0].code, 'adm1');
  assert.equal(r.rows[0].names[1], 'Amboasary');
  assert.equal(r.warnings.length, 1);
});

test('zip à plusieurs shapefiles : le niveau le plus fin est retenu avec ses .shp/.prj/.cpg', () => {
  const e = (entryName, data = 'x') => ({ entryName, isDirectory: false, header: { size: data.length }, getData: () => Buffer.from(data) });
  const pick = pickShapefile([e('mdg_adm1.dbf'), e('mdg_adm1.shp'), e('mdg_adm4.dbf', 'yyyy'), e('mdg_adm4.shp', 'S'), e('mdg_adm4.prj', 'GEOGCS["WGS 84"]'), e('mdg_adm4.cpg', 'UTF-8'), e('__MACOSX/._mdg_adm4.dbf')]);
  assert.equal(pick.name, 'mdg_adm4.dbf');
  assert.equal(pick.shp.toString(), 'S'); assert.equal(pick.cpg, 'UTF-8'); assert.match(pick.prj, /^GEOGCS/);
});

// .shp synthétique : un carré (polygone) et un point.
function shpBuffer(records) {
  const parts = records.map((r) => {
    let content;
    if (r.type === 1) { content = Buffer.alloc(20); content.writeInt32LE(1, 0); content.writeDoubleLE(r.x, 4); content.writeDoubleLE(r.y, 12); }
    else {
      const pts = r.ring; content = Buffer.alloc(44 + 4 + 16 * pts.length);
      content.writeInt32LE(5, 0);
      const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
      [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].forEach((v, i) => content.writeDoubleLE(v, 4 + 8 * i));
      content.writeInt32LE(1, 36); content.writeInt32LE(pts.length, 40); content.writeInt32LE(0, 44);
      pts.forEach((p, k) => { content.writeDoubleLE(p[0], 48 + 16 * k); content.writeDoubleLE(p[1], 56 + 16 * k); });
    }
    const head = Buffer.alloc(8); head.writeInt32BE(1, 0); head.writeInt32BE(content.length / 2, 4);
    return Buffer.concat([head, content]);
  });
  const header = Buffer.alloc(100); header.writeInt32BE(9994, 0);
  return Buffer.concat([header, ...parts]);
}

test('lecteur .shp : centroïde de polygone et point', () => {
  const buf = shpBuffer([{ type: 5, ring: [[46, -25], [46, -24], [47, -24], [47, -25], [46, -25]] }, { type: 1, x: 44.5, y: -22.1 }]);
  const pts = readShp(buf);
  assert.equal(pts.length, 2);
  assert.ok(Math.abs(pts[0].lng - 46.5) < 1e-9 && Math.abs(pts[0].lat + 24.5) < 1e-9);
  assert.deepEqual(pts[1], { lng: 44.5, lat: -22.1 });
  assert.equal(isGeographicPrj('PROJCS["UTM 38S"]'), false);
  assert.equal(isGeographicPrj('GEOGCS["WGS 84"]'), true);
});

test('plan d\'insertion : nœuds uniques par chemin, P-code en double écarté, GPS sur l\'unité la plus fine', () => {
  const plan = planBreakdown({
    levels: [{ code: 'adm1' }, { code: 'adm2' }],
    rows: [
      { names: ['Anosy', 'Amboasary'], pcodes: ['MG23', 'MG2301'], lat: -25, lng: 46 },
      { names: ['Anosy', 'Taolagnaro'], pcodes: ['MG23', 'MG2302'], lat: -25.03, lng: 46.98 },
      { names: ['Androy', 'Tsihombe'], pcodes: ['MG25', 'MG2301'], lat: null, lng: null },
    ],
  });
  assert.equal(plan.byDepth[0].length, 2);
  assert.equal(plan.byDepth[1].length, 3);
  assert.equal(plan.byDepth[1][2].pcode, null); // MG2301 déjà pris par Amboasary
  assert.equal(plan.byDepth[1][0].parentKey, 'Anosy');
  assert.equal(plan.points.length, 2);
  assert.equal(plan.warnings.length, 1);
});

test('export CSV du répertoire : colonnes par niveau, BOM, échappement', () => {
  const csv = directoryCsv([{ ancestors: ['Anosy'], name: 'Fort-Dauphin; centre', pcode: 'MG2302', lat: -25.03, lng: 46.98 }], ['Région', 'District']);
  assert.ok(csv.startsWith('﻿Région;District;P-code;Latitude;Longitude\r\n'));
  assert.match(csv, /Anosy;"Fort-Dauphin; centre";MG2302;-25.03;46.98/);
  assert.equal(siteColumnFor('adm3'), 'COALESCE(s.adm3, s.commune)');
  assert.equal(siteColumnFor('adm9'), null);
});

// ---- Réimport sans casse ----------------------------------------------------------
const LEVELS = [{ code: 'adm1', label: 'Région' }, { code: 'adm2', label: 'District' }, { code: 'adm3', label: 'Commune' }];
const EXISTING = [
  { id: 'r1', depth: 1, pcode: 'MG51', path: 'Atsimo-Andrefana' },
  { id: 'd1', depth: 2, pcode: 'MG51101', path: 'Atsimo-Andrefana > Toliara I' },
  { id: 'd2', depth: 2, pcode: null, path: 'Atsimo-Andrefana > Toliara II' },
  { id: 'c1', depth: 3, pcode: 'MG51102010', path: 'Atsimo-Andrefana > Toliara II > Belalanda' },
  { id: 'c9', depth: 3, pcode: null, path: 'Atsimo-Andrefana > Toliara II > Ancienne commune' },
];

test('réimport : identifiants conservés par P-code (même renommé) puis par chemin normalisé', () => {
  const plan = planBreakdown({ levels: LEVELS, rows: [
    { names: ['Atsimo Andrefana', 'Toliara I'], pcodes: [null, 'MG51101'] },
    { names: ['Atsimo Andrefana', 'Toliara-II', 'Belalanda Nord'], pcodes: [null, null, 'MG51102010'] },
    { names: ['Atsimo Andrefana', 'Toliara-II', 'Nouvelle commune'], pcodes: [null, null, 'MG51102099'] },
  ] });
  const { idByKey, removed, stats } = matchBreakdown(EXISTING, plan);
  assert.equal(idByKey.get('Atsimo Andrefana'), 'r1');                         // chemin normalisé
  assert.equal(idByKey.get('Atsimo Andrefana > Toliara I'), 'd1');             // P-code
  assert.equal(idByKey.get('Atsimo Andrefana > Toliara-II'), 'd2');            // chemin normalisé
  assert.equal(idByKey.get('Atsimo Andrefana > Toliara-II > Belalanda Nord'), 'c1'); // P-code malgré le renommage
  assert.equal(idByKey.has('Atsimo Andrefana > Toliara-II > Nouvelle commune'), false);
  assert.deepEqual(removed, ['c9']);
  assert.deepEqual(stats, { kept: 4, byPcode: 2, byPath: 2, added: 1, removed: 1 });
});

test('réimport : « Toliara I » ne reprend jamais l\'identifiant de « Toliara II », un P-code d\'un autre niveau non plus', () => {
  const plan = planBreakdown({ levels: LEVELS, rows: [
    { names: ['Atsimo-Andrefana', 'Toliara II'], pcodes: ['MG51', 'MG51102010'] },
  ] });
  const { idByKey, removed } = matchBreakdown(EXISTING.filter((a) => a.id !== 'd2'), plan);
  assert.equal(idByKey.get('Atsimo-Andrefana'), 'r1');
  assert.equal(idByKey.has('Atsimo-Andrefana > Toliara II'), false); // MG51102010 est une commune
  assert.deepEqual(removed.sort(), ['c1', 'c9', 'd1']);
});

test('réimport : une unité existante n\'est reprise qu\'une fois', () => {
  const plan = planBreakdown({ levels: LEVELS, rows: [
    { names: ['Atsimo-Andrefana'] }, { names: ['Atsimo Andrefana'] },
  ] });
  const { idByKey, stats } = matchBreakdown(EXISTING.slice(0, 1), plan);
  assert.equal([...idByKey.values()].filter((id) => id === 'r1').length, 1);
  assert.equal(stats.added, 1);
});

test('zones détachées : retrouvées par chemin normalisé, seulement si la correspondance est unique', () => {
  const areas = [
    { id: 'a', path: 'Atsimo-Andrefana > Toliara II' },
    { id: 'b', path: 'Anosy > Taolagnaro' },
    { id: 'c', path: 'Anosy > Taolagnaro ' },
  ];
  const out = relinkByPath([
    { ref: 'z1', path: 'Atsimo Andrefana > Toliara-II' },
    { ref: 'z2', path: 'Anosy > Taolagnaro' },
    { ref: 'z3', path: 'Atsimo-Andrefana > Toliara I' },
  ], areas);
  assert.equal(out.get('z1'), 'a');
  assert.equal(out.has('z2'), false); // ambigu
  assert.equal(out.has('z3'), false);
});

test('export réimporté : les cellules GPS vides ne deviennent pas (0, 0)', () => {
  const cols = detectColumns(['Région', 'District', 'P-code', 'Latitude', 'Longitude']);
  const rows = buildRows([
    { Région: 'Androy', District: 'Bekily', 'P-code': '', Latitude: '', Longitude: '' },
    { Région: 'Androy', District: 'Beloha', 'P-code': '', Latitude: '0', Longitude: '0' },
    { Région: 'Androy', District: 'Tsihombe', 'P-code': '', Latitude: '-25,3', Longitude: '45.48' },
  ], cols);
  assert.deepEqual(rows.map((r) => [r.lat, r.lng]), [[null, null], [null, null], [-25.3, 45.48]]);
});
