const test = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');
const ExcelJS = require('exceljs');
const { sniffFile, zipDeclaredEntryCount, xlsxSheetNames, decodeText } = require('../src/modules/common/fileSniff');
const { oleFile, biffGlobals } = require('./helpers/oleFixture');
const { buildSav } = require('./helpers/savFixture');

const zipOf = (files) => {
  const z = new AdmZip();
  for (const [name, content] of Object.entries(files)) z.addFile(name, Buffer.from(content));
  return z.toBuffer();
};
const kind = (buf) => sniffFile(buf).kind;

test('reconnaît par les octets, quel que soit le nom : xlsx, docx, pptx, ods, zip SPSS', async () => {
  const wb = new ExcelJS.Workbook(); wb.addWorksheet('data').addRow(['a', 'b']);
  const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
  assert.equal(kind(xlsx), 'xlsx');
  assert.equal(sniffFile(xlsx).label, 'classeur Excel (.xlsx)');
  assert.ok(sniffFile(xlsx).entries.some((e) => e.name === 'xl/workbook.xml' && e.size > 0));

  assert.equal(kind(zipOf({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w:document/>' })), 'docx');
  assert.equal(kind(zipOf({ '[Content_Types].xml': '<Types/>', 'ppt/presentation.xml': '<p/>' })), 'pptx');
  assert.equal(kind(zipOf({ '[Content_Types].xml': '<Types/>', 'xl/workbook.bin': 'x' })), 'xlsb');
  assert.equal(kind(zipOf({ mimetype: 'application/vnd.oasis.opendocument.spreadsheet', 'META-INF/manifest.xml': '<m/>' })), 'ods');
  assert.equal(kind(zipOf({ mimetype: 'application/vnd.oasis.opendocument.text', 'META-INF/manifest.xml': '<m/>' })), 'odf');
  const spss = sniffFile(zipOf({ 'data.sav': buildSav({ cases: [[1, 'A', 'x']] }) }));
  assert.equal(spss.kind, 'zip');
  assert.equal(spss.entries[0].name, 'data.sav');
});

test('SPSS : $FL2 = .sav, $FL3 = .zsav ; OLE ; PDF ; archives et images', () => {
  assert.equal(kind(buildSav({ cases: [[1, 'A', 'x']] })), 'sav');
  assert.equal(kind(Buffer.concat([Buffer.from('$FL3'), Buffer.alloc(200)])), 'zsav');
  assert.equal(kind(oleFile(biffGlobals(['data']))), 'ole');
  assert.equal(kind(Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj')), 'pdf');
  assert.equal(kind(Buffer.from([0x1f, 0x8b, 0x08, 0x00, 1, 2, 3])), 'gzip');
  assert.equal(kind(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4])), '7z');
  assert.equal(kind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image');
  assert.equal(kind(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x41, 0x42])), 'binary');
});

test('texte : HTML (avec ou sans doctype), XML, JSON, RTF, CSV ; vide', () => {
  assert.equal(kind(Buffer.from('<!DOCTYPE html><html><body><table></table></body></html>')), 'html');
  assert.equal(kind(Buffer.from('\uFEFF  \n<html lang="fr"><head>')), 'html');
  assert.equal(kind(Buffer.from('<table><tr><td>a</td></tr></table>')), 'html');            // « .xls » HTML
  assert.equal(kind(Buffer.from('<?xml version="1.0"?><!DOCTYPE html><html>')), 'html');   // XHTML
  assert.equal(kind(Buffer.from('<?xml version="1.0"?><Workbook>')), 'xml');
  assert.equal(kind(Buffer.from('[{"_uuid":"a"}]')), 'json');
  assert.equal(kind(Buffer.from('{"results": []}')), 'json');
  assert.equal(kind(Buffer.from('{\\rtf1\\ansi')), 'rtf');
  assert.equal(kind(Buffer.from('_uuid,SvyDate\nu1,2026-05-03\n')), 'text');
  assert.equal(kind(Buffer.from('[Région];Commune\nAndroy;Ambovombe')), 'text');           // crochet ≠ JSON
  assert.equal(kind(Buffer.from('région;commune\nAnalamanga;Antananarivo', 'latin1')), 'text'); // Windows-1252
  assert.equal(kind(Buffer.alloc(0)), 'empty');
  assert.equal(kind(Buffer.from('  \r\n ')), 'empty');
});

test('texte UTF-16 annoncé par sa marque : reconnu et décodé', () => {
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('a\tb\n1\t2', 'utf16le')]);
  const s = sniffFile(le);
  assert.equal(s.kind, 'text');
  assert.equal(decodeText(le, s), 'a\tb\n1\t2');
  const be = Buffer.from(Buffer.from('x;y', 'utf16le')).swap16();
  const sb = sniffFile(Buffer.concat([Buffer.from([0xfe, 0xff]), be]));
  assert.equal(sb.encoding, 'utf16be');
  assert.equal(decodeText(Buffer.concat([Buffer.from([0xfe, 0xff]), be]), sb), 'x;y');
});

test('zip : nombre d\'entrées lu dans la fin de répertoire, zip corrompu signalé sans exception', () => {
  const buf = zipOf({ 'a.txt': 'a', 'b.txt': 'b', 'c/d.txt': 'd' });
  assert.equal(zipDeclaredEntryCount(buf), 3);
  const truncated = buf.subarray(0, buf.length - 30);
  const s = sniffFile(truncated);
  assert.equal(s.kind, 'zip');
  assert.equal(s.entries, null);
  assert.equal(s.error, 'corrupt');
});

test('zip annonçant trop d\'entrées : refusé sans parcourir le répertoire', () => {
  const buf = Buffer.from(zipOf({ 'a.txt': 'a' }));
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  buf.writeUInt16LE(60000, eocd + 8); buf.writeUInt16LE(60000, eocd + 10);
  const s = sniffFile(buf);
  assert.equal(s.kind, 'zip');
  assert.equal(s.error, 'too-many-entries');
  assert.equal(s.declaredEntries, 60000);
});

test('noms des feuilles d\'un .xlsx lus sans charger le classeur', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('survey'); wb.addWorksheet('choices'); wb.addWorksheet('R&D "1"');
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  assert.deepEqual(xlsxSheetNames(buf), ['survey', 'choices', 'R&D "1"']);
  assert.deepEqual(xlsxSheetNames(Buffer.from('pas un zip')), []);
});
