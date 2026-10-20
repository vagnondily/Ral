/**
 * Contrôle rapide d'un fichier de soumissions (submissionsImport.precheckSubmissions) : les
 * MÊMES refus, au mot près, que la lecture complète (parseSubmissions) pour tout ce qui ne
 * dépend que de la forme du fichier — l'import en tâche de fond refuse ainsi tout de suite
 * (400 / 413) un fichier qui n'est pas un export de données, sans attendre la tâche.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');
const ExcelJS = require('exceljs');
const { parseSubmissions, precheckSubmissions } = require('../src/modules/monitoring/submissionsImport');
const { oleFile, biffGlobals } = require('./helpers/oleFixture');
const { buildSav } = require('./helpers/savFixture');

const zipOf = (files) => { const z = new AdmZip(); for (const [n, c] of Object.entries(files)) z.addFile(n, Buffer.isBuffer(c) ? c : Buffer.from(c)); return z.toBuffer(); };
async function workbook(sheets) {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) wb.addWorksheet(name).addRows(rows);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const message = async (fn) => { try { await fn(); return null; } catch (e) { return `${e.statusCode} ${e.message}`; } };

test('refus de forme : contrôle rapide et lecture complète disent la même chose', async () => {
  const cases = {
    html: Buffer.from('<!DOCTYPE html><html><body><table></table></body></html>'),
    pdf: Buffer.from('%PDF-1.7\n1 0 obj'),
    docx: zipOf({ '[Content_Types].xml': '<T/>', 'word/document.xml': '<w/>' }),
    zsav: Buffer.concat([Buffer.from('$FL3'), Buffer.alloc(400)]),
    xls: oleFile(biffGlobals(['data'])),
    xlsformXls: oleFile(biffGlobals(['survey', 'choices', 'settings'])),
    xlsformXlsx: await workbook({ survey: [['type', 'name', 'label'], ['integer', 'nb', 'Nombre']], choices: [['list_name', 'name', 'label']] }),
    zipSansSav: zipOf({ 'lisezmoi.txt': 'rien' }),
    zipZsav: zipOf({ 'data.zsav': Buffer.concat([Buffer.from('$FL3'), Buffer.alloc(40)]) }),
  };
  for (const [name, buf] of Object.entries(cases)) {
    const quick = await message(() => precheckSubmissions(buf));
    const full = await message(() => parseSubmissions(buf));
    assert.ok(quick, `${name} : refusé par le contrôle rapide`);
    assert.equal(quick, full, name);
  }
});

test('fichiers de données acceptés par le contrôle rapide (le contenu est lu par la tâche)', async () => {
  assert.deepEqual(precheckSubmissions(Buffer.from('_uuid,SvyDate\nu1,2026-05-03\n')), { kind: 'csv' });
  // Une date illisible n'est vue qu'à la lecture complète (tâche de fond) : le contrôle rapide passe.
  assert.deepEqual(precheckSubmissions(Buffer.from('_uuid,SvyDate\nu1,30/01/2026\n')), { kind: 'csv' });
  assert.deepEqual(precheckSubmissions(await workbook({ data: [['_uuid', 'q1'], ['u1', 'oui']] })), { kind: 'xlsx' });
  const sav = buildSav({ cases: [[1, 'ab', 'texte']] });
  assert.deepEqual(precheckSubmissions(sav), { kind: 'sav' });
  assert.deepEqual(precheckSubmissions(zipOf({ 'data.sav': sav })), { kind: 'zip' });
});

test('garde de décompression : même refus (413) avant toute lecture', async () => {
  const big = zipOf({ 'data.sav': Buffer.alloc(2 * 1024 * 1024, 0x20) });
  const limits = { maxBytes: 1024 * 1024, maxRatio: 1000, ratioFloorBytes: 1024 };
  const quick = await message(() => precheckSubmissions(big, { zipLimits: limits }));
  const full = await message(() => parseSubmissions(big, { zipLimits: limits }));
  assert.match(quick, /^413 /);
  assert.equal(quick, full);
});
