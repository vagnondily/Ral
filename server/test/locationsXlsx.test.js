const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { buildLocationsWorkbook, parseLocationsWorkbook, HEADERS } = require('../src/modules/tpm/locationsXlsx');

const OFFICES = [{ id: 'o-amb', name: 'Ambovombe', code: '2' }, { id: 'o-bek', name: 'Bekily', code: '8', parentCode: '2' }];
const resolveOffice = (n) => OFFICES.find((o) => o.name.toLowerCase() === String(n).toLowerCase()) || null;
const SITE = {
  locationId: 'L001', name: 'EPP Ankaramena', poiSubtype: 'School', activity: 'School meal activities', officeName: 'Bekily',
  admin1: 'Androy', admin2: 'Bekily', admin3: 'Ankaramena', urbanArea: 'Rural', gpsLat: -24.21345, gpsLng: 45.31234,
  security: 3, synergies: 1, modalityType: 'Food', beneficiaryNumber: 450, newPartner: 0, experiencedPartner: 2,
  lastVisitDate: '2025-11-14', issuesProcess: 1, issuesPartnerReport: 0, issuesCFM: 2, fraud: 1, finalScore: 2,
  monthStatus: { 1: true, 2: true, 7: false }, visits: { 3: 'planifie', 5: 'realise' },
};

test('export → import : chaque champ, statuts mensuels et mois prévus relus', async () => {
  const buf = await buildLocationsWorkbook({ year: 2026, sites: [SITE], offices: OFFICES }).xlsx.writeBuffer();
  const { year, rows, errors, sheet } = await parseLocationsWorkbook(buf, { resolveOffice, activities: ['School meal activities'] });
  assert.equal(sheet, 'Locations Management'); assert.equal(year, 2026); assert.deepEqual(errors, []);
  const r = rows[0];
  assert.equal(r.locationId, 'L001'); assert.equal(r.officeId, 'o-bek'); assert.equal(r.poiSubtype, 'School');
  assert.equal(r.security, 3); assert.equal(r.experiencedPartner, 2); assert.equal(r.fraud, 1); assert.equal(r.beneficiaryNumber, 450);
  assert.equal(r.modalityType, 'Food'); assert.equal(r.lastVisitDate, '2025-11-14'); assert.equal(r.gpsLat, -24.21345);
  assert.deepEqual(r.monthStatus, { 1: true, 2: true, 7: false });
  assert.deepEqual(r.planned, [3]); // R (réalisée) n'est pas recréée en « prévue »
});

test('en-têtes identiques au classeur, formules vivantes Status / code POI', async () => {
  const wb = buildLocationsWorkbook({ year: 2026, sites: [SITE], offices: OFFICES });
  const ws = wb.getWorksheet('Locations Management');
  assert.deepEqual(HEADERS.map((_, i) => ws.getRow(3).getCell(i + 1).value), HEADERS);
  assert.match(ws.getCell('B4').value.formula, /^IFERROR\(LOOKUP\(2,1\/\(AL4:AW4<>""\),AL4:AW4\),""\)$/);
  assert.match(ws.getCell('E4').value.formula, /VLOOKUP\(\$D4,Settings!/);
  assert.equal(ws.getCell('AL2').value, 2026);
});

test('contrôles par ligne : bureau inconnu, échelles, ID, activité hors MMR, libellé d\'origine converti', async () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Locations Management');
  ws.getRow(3).values = HEADERS;
  ws.getRow(4).values = ['L002', '', 'Site OK', 'WFP Warehouse', '', 'School meal activities', 'Ambovombe', '', '', '', '', '', '', 99];
  ws.getRow(5).values = ['X9', '', 'Site KO', 'Château', '', 'Activité inconnue', 'Nulle part', '', '', '', '', '', '', 2];
  const { rows, errors } = await parseLocationsWorkbook(await wb.xlsx.writeBuffer(), { resolveOffice, activities: ['School meal activities'] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].poiSubtype, 'Programme Warehouse'); assert.equal(rows[0].security, 99);
  const msgs = errors.filter((e) => e.line === 5).map((e) => e.message).join(' | ');
  assert.match(msgs, /ID « X9 »/); assert.match(msgs, /Château/); assert.match(msgs, /absent du MMR/); assert.match(msgs, /Nulle part/); assert.match(msgs, /hors échelle/);
});
