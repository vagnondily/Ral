const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { HEADERS, buildWorkbook, parseSitesWorkbook } = require('../src/modules/settings/sitesXlsx');

test('en-têtes fidèles à la demande', () => {
  assert.deepEqual(HEADERS, [
    'Identifiant', 'Localité', 'Code POI', 'Field_office', 'Field_office_code',
    'Region', 'Adm1Code', 'District', 'Adm2Code', 'Commune', 'Adm3Code',
    'Fokontany', 'Adm4Code', 'Activity_tag', 'Tag_code', 'Lat', 'Long',
  ]);
});

test('le modèle vide se parse sans ligne', async () => {
  const wb = buildWorkbook({ sites: [] });
  const buf = await wb.xlsx.writeBuffer();
  const { rows } = await parseSitesWorkbook(Buffer.from(buf));
  assert.equal(rows.length, 0);
});

test('aller-retour : export → parse conserve les champs saisissables', async () => {
  const sites = [{
    identifiant: 'csb-a--commune-a--ecole', localite: 'École A', codePoi: 'L003',
    fieldOffice: 'Toliara', fieldOfficeCode: 'TLR', region: 'Atsimo', adm1Code: 'MG7',
    district: 'Toliara II', adm2Code: 'MG71', commune: 'Commune A', adm3Code: 'MG7101',
    fokontany: 'Fkt 1', adm4Code: 'MG710101', activityTag: 'MAM', tagCode: 'A1',
    lat: -23.1, lng: 43.7,
  }];
  const wb = buildWorkbook({ sites });
  const { rows, skipped } = await parseSitesWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
  assert.equal(skipped.length, 0);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.identifiant, 'csb-a--commune-a--ecole');
  assert.equal(r.localite, 'École A');
  assert.equal(r.fieldOfficeCode, 'TLR');
  assert.equal(r.region, 'Atsimo');
  assert.equal(r.commune, 'Commune A');
  assert.equal(r.activityTag, 'MAM');
  assert.equal(r.tagCode, 'A1');
  assert.equal(r.lat, -23.1);
  assert.equal(r.lng, 43.7);
});

test('ligne sans localité → ignorée avec motif ; ligne vide → sautée', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sites');
  ws.getRow(1).values = HEADERS;
  ws.getRow(2).values = ['SITE-X']; // identifiant sans localité → ignoré avec motif
  ws.getRow(3).values = []; // vide → sautée silencieusement
  ws.getRow(4).values = ['', 'École B']; // localité seule → valide
  const { rows, skipped } = await parseSitesWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].localite, 'École B');
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /Localité manquante/);
});

test('tolère « Longitude »/« Latitude » et un ordre de colonnes différent', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sites');
  ws.getRow(1).values = ['Localité', 'Longitude', 'Latitude', 'Commune'];
  ws.getRow(2).values = ['École C', 43.9, -23.4, 'Commune B'];
  const { rows } = await parseSitesWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].localite, 'École C');
  assert.equal(rows[0].lat, -23.4);
  assert.equal(rows[0].lng, 43.9);
  assert.equal(rows[0].commune, 'Commune B');
});

test('en-têtes absents → erreur NO_HEADER', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sites');
  ws.getRow(1).values = ['Foo', 'Bar'];
  ws.getRow(2).values = ['x', 'y'];
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  await assert.rejects(() => parseSitesWorkbook(buf), (e) => e.code === 'NO_HEADER');
});
