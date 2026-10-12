const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const AdmZip = require('adm-zip');
const { loadWorkbook, refArea, mergedCellsInXml, scanSheetXml, MAX_MERGED_CELLS } = require('../src/modules/common/xlsxGuard');

/** Petit classeur réel, dont on retouche le XML de la feuille (après </sheetData>). */
async function workbookWith(extraXml) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Données');
  ws.addRow(['Code', 'Nom']);
  ws.addRow(['MG51', 'Atsimo-Andrefana']);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  if (!extraXml) return buf;
  const zip = new AdmZip(buf);
  const name = 'xl/worksheets/sheet1.xml';
  const xml = zip.readAsText(name).replace('</sheetData>', `</sheetData>${extraXml}`);
  zip.updateFile(name, Buffer.from(xml, 'utf8'));
  return zip.toBuffer();
}

test('surface d\'une référence : cellule, plage, colonnes à plusieurs lettres, illisible', () => {
  assert.equal(refArea('B2'), 1);
  assert.equal(refArea('A1:C3'), 9);
  assert.equal(refArea('$A$6:$AQ$1048576'), 43 * 1048571);
  assert.equal(refArea('C3:A1'), 9);
  assert.equal(refArea('n/a'), -1);           // illisible → refus
  assert.equal(refArea('A6:A20000000'), -1);  // au-delà de la feuille Excel → refus
  assert.equal(refArea('A1:XFE1'), -1);
});

test('cellules fusionnées comptées dans le XML (préfixe d\'espace de noms compris)', () => {
  assert.equal(mergedCellsInXml('<sheetData/>'), 0);
  assert.equal(mergedCellsInXml('<sheetData/><mergeCells count="2"><mergeCell ref="A1:B2"/><mergeCell ref="D4"/></mergeCells>'), 5);
  assert.equal(mergedCellsInXml('<x:mergeCells><x:mergeCell ref="A1:A10"/></x:mergeCells>'), 10);
});

test('classeur de quelques Ko fusionnant A6:AQ1048576 : refusé en un instant, sans être chargé', async () => {
  const buf = await workbookWith('<mergeCells count="1"><mergeCell ref="A6:AQ1048576"/></mergeCells>');
  assert.ok(buf.length < 20000);
  const t0 = Date.now();
  await assert.rejects(loadWorkbook(buf), (e) => e.statusCode === 400 && /fusionne plus de/.test(e.message));
  assert.ok(Date.now() - t0 < 2000);
});

test('validation de données sur une colonne entière : chargé vite, valeurs intactes', async () => {
  const buf = await workbookWith('<dataValidations count="1"><dataValidation type="list" allowBlank="1" sqref="A1:A1048576"><formula1>"a,b"</formula1></dataValidation></dataValidations>');
  const t0 = Date.now();
  const wb = await loadWorkbook(buf);
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(wb.worksheets[0].getCell('B2').value, 'Atsimo-Andrefana');
});

test('fusions ordinaires (modèles réels : quelques milliers de cellules) : acceptées, valeur de la cellule maîtresse lue', async () => {
  const buf = await workbookWith('<mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells>');
  const wb = await loadWorkbook(buf);
  assert.equal(wb.worksheets[0].getCell('A1').value, 'Code');
  assert.ok(MAX_MERGED_CELLS >= 50000);
});

test('archive qui annonce trop de données décompressées : 413 avant tout chargement', async () => {
  const buf = await workbookWith();
  await assert.rejects(loadWorkbook(buf, { zipLimits: { maxBytes: 100, maxRatio: 100, ratioFloorBytes: 10 } }), (e) => e.statusCode === 413);
});

test('relecture : toutes les écritures XML d\'une zone fusionnée sont lues (guillemets, espaces, entités)', () => {
  assert.equal(scanSheetXml("<mergeCell ref='A1:A10'/>").merged, 10);
  assert.equal(scanSheetXml('<mergeCell ref = "A1:A10" />').merged, 10);
  assert.equal(scanSheetXml('<mergeCell ref="A1:A&#49;0"/>').merged, 10);
  assert.equal(scanSheetXml('<x:mergeCell\n ref="A1:B2"/>').merged, 4);
  assert.match(scanSheetXml('<mergeCell ref="A6:A20000000"/>').unreadable, /illisible/);
  assert.match(scanSheetXml('<col min="1" max="50000000" width="9"/>').unreadable, /colonnes/);
  assert.equal(scanSheetXml('<col min="1" max="16384" width="9"/>').maxCol, 16384); // feuille entière : permis
  assert.equal(scanSheetXml('<xdr:from><xdr:col>3</xdr:col></xdr:from>').unreadable, null); // ancrage d'image
});

async function bombVariant(mutate) {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('D').addRow(['a']);
  const zip = new AdmZip(Buffer.from(await wb.xlsx.writeBuffer()));
  const name = 'xl/worksheets/sheet1.xml';
  zip.updateFile(name, Buffer.from(zip.readAsText(name).replace('</sheetData>', '</sheetData><mergeCells count="1"><mergeCell ref=\'A6:AQ1048576\'/></mergeCells>')));
  mutate(zip, name);
  return zip.toBuffer();
}

test('relecture : feuille au chemin inhabituel (« /xl/… », « sheet1.xml.x ») examinée quand même', async () => {
  const slash = await bombVariant((zip, name) => { zip.getEntry(name).entryName = `/${name}`; });
  await assert.rejects(loadWorkbook(slash), (e) => e.statusCode === 400 && /fusionne/.test(e.message));
  const suffix = await bombVariant((zip, name) => { zip.getEntry(name).entryName = `${name}.x`; });
  await assert.rejects(loadWorkbook(suffix), (e) => e.statusCode === 400);
});

test('relecture : classeur dont la liste des entrées est illisible (trop d\'entrées) refusé, jamais ouvert', async () => {
  const many = await bombVariant((zip) => { for (let i = 0; i < 10001; i += 1) zip.addFile(`x/${i}.txt`, Buffer.alloc(0)); });
  await assert.rejects(loadWorkbook(many), (e) => e.statusCode === 400 && /Classeur Excel/.test(e.message));
  await assert.rejects(loadWorkbook(Buffer.from('a,b\n1,2')), (e) => e.statusCode === 400);
});
