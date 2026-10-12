const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSubmissions, submissionsFromObjects } = require('../src/modules/monitoring/submissionsImport');

test('parses a CSV, lifting known Kobo columns and keeping raw answers', async () => {
  const csv = [
    '_uuid,SvyDate,field_office,ADMIN1Name,ADMIN4Name,EnuPartner,EnuName,CFM_used',
    'u1,2026-05-03,Ambovombe,Androy,EPP Ankilibe,ONG Lalana,Rakoto,yes',
    'u2,2026-05-04,Ambovombe,Androy,EPP Be,ONG Lalana,Rasoa,no',
  ].join('\n');
  const { submissions } = await parseSubmissions(Buffer.from(csv, 'utf8'), { filename: 'x.csv' });
  assert.equal(submissions.length, 2);
  assert.equal(submissions[0].externalId, 'u1');
  assert.equal(submissions[0].periodMonth, '2026-05-01');
  assert.equal(submissions[0].fieldOffice, 'Ambovombe');
  assert.equal(submissions[0].partner, 'ONG Lalana');
  assert.equal(submissions[0].agent, 'Rakoto');
  assert.equal(submissions[0].data.CFM_used, 'yes'); // raw answer kept for the mapping
});

test('detects a semicolon-delimited CSV', async () => {
  const csv = '_uuid;field_office;q1\nu9;Tulear;A';
  const { submissions } = await parseSubmissions(Buffer.from(csv, 'utf8'), { filename: 'x.csv' });
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].fieldOffice, 'Tulear');
  assert.equal(submissions[0].data.q1, 'A');
});

test('normalizes Kobo JSON objects, flattening group-prefixed keys', () => {
  const rows = [
    { _uuid: 'k1', _submission_time: '2026-05-10T08:00:00', 'grp/field_office': 'Manakara', 'grp/CFM_used': 'oui' },
  ];
  const subs = submissionsFromObjects(rows, 'kobo');
  assert.equal(subs.length, 1);
  assert.equal(subs[0].externalId, 'k1');
  assert.equal(subs[0].periodMonth, '2026-05-01');
  assert.equal(subs[0].fieldOffice, 'Manakara');
  assert.equal(subs[0].data.CFM_used, 'oui');
});

const { buildLookup } = require('../src/modules/monitoring/submissionsImport');

test('import : le code de commune passe avant son nom, quel que soit l\'ordre des colonnes', () => {
  const headers = ['admin3name', 'admin3', 'admin1name', 'admin1'];
  const rows = [['Ampanihy Ouest', 'MG51507090', 'Atsimo Andrefana', 'MG51'], ['Ejeda', 'MG51507050', 'Atsimo Andrefana', 'MG51']];
  const picks = buildLookup(headers, rows);
  assert.equal(headers[picks.admin3], 'admin3');
  assert.equal(headers[picks.admin1], 'admin1');
});

test('import : une colonne « admin3 » qui contient des noms cède la place à la colonne de codes', () => {
  const headers = ['admin3', 'admin3_pcode'];
  const rows = [['Ampanihy Ouest', 'MG51507090'], ['Ejeda', 'MG51507050']];
  assert.equal(headers[buildLookup(headers, rows).admin3], 'admin3_pcode');
});

test('import : en-têtes accentués reconnus (Niveau régional, Énumérateur)', () => {
  const headers = ['Niveau régional', 'Énumérateur', 'District'];
  const picks = buildLookup(headers, [['MG51', 'Rasoa', 'MG51507']]);
  assert.equal(headers[picks.admin1], 'Niveau régional');
  assert.equal(headers[picks.agent], 'Énumérateur');
  assert.equal(headers[picks.admin2], 'District');
});

/* ------------------------------------------------------------------------
 * Formats reconnus par le CONTENU, refus nommés, dates validées, garde zip.
 * ---------------------------------------------------------------------- */
const AdmZip = require('adm-zip');
const ExcelJS = require('exceljs');
const { oleFile, biffGlobals } = require('./helpers/oleFixture');
const { buildSav } = require('./helpers/savFixture');

const zipOf = (files) => {
  const z = new AdmZip();
  for (const [name, content] of Object.entries(files)) z.addFile(name, Buffer.isBuffer(content) ? content : Buffer.from(content));
  return z.toBuffer();
};
async function xlsxOf(sheets) {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) { const ws = wb.addWorksheet(name); rows.forEach((r) => ws.addRow(r)); }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const refused = (status, pattern) => (err) => {
  assert.equal(err.statusCode, status, err.message);
  assert.match(err.message, pattern);
  return true;
};

test('refus nommés : HTML, PDF, Word, PowerPoint, JSON, binaire, vide — quel que soit le nom', async () => {
  const cases = [
    ['<!DOCTYPE html><html><body><table><tr><td>Rapport</td></tr></table></body></html>', /page web \(HTML\)/],
    ['%PDF-1.5\n%âãÏÓ\n1 0 obj', /document PDF/],
    [zipOf({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w:document/>' }), /document Word \(\.docx\)/],
    [zipOf({ '[Content_Types].xml': '<Types/>', 'ppt/presentation.xml': '<p/>' }), /PowerPoint \(\.pptx\)/],
    ['[{"_uuid":"k1","q1":"oui"}]', /JSON/],
    [Buffer.from([0x00, 0x13, 0x37, 0x00, 0xff]), /binaire/],
    ['', /Fichier vide/],
  ];
  for (const [content, pattern] of cases) {
    await assert.rejects(parseSubmissions(Buffer.from(content), { filename: 'donnees.csv' }), refused(400, pattern));
  }
});

test('SPSS compressé (.zsav, signature $FL3) : refus clair, seul ou dans un zip', async () => {
  const zsav = Buffer.concat([Buffer.from('$FL3@(#) IBM SPSS'), Buffer.alloc(300)]);
  await assert.rejects(parseSubmissions(zsav, { filename: 'data.sav' }), refused(400, /\.zsav.*Exportez en \.sav ou \.xlsx/));
  await assert.rejects(parseSubmissions(zipOf({ 'data.sav': zsav })), refused(400, /\.zsav/));
  await assert.rejects(parseSubmissions(zipOf({ 'data.zsav': zsav })), refused(400, /\.zsav/));
});

test('.xls (OLE) jamais lu comme un CSV : données → enregistrer en .xlsx ; Word 97 nommé', async () => {
  await assert.rejects(parseSubmissions(oleFile(biffGlobals(['data'])), { filename: 'export.csv' }),
    refused(400, /Excel 97-2003 \(\.xls\).*\.xlsx ou \.csv/));
  await assert.rejects(parseSubmissions(oleFile(Buffer.alloc(600, 1), { streamName: 'WordDocument' })),
    refused(400, /Word 97-2003 \(\.doc\)/));
});

test('XLSForm (.xlsx ou .xls avec survey/choices) : définition, renvoyée vers « Importer un XLSForm »', async () => {
  const xlsform = await xlsxOf({
    survey: [['type', 'name', 'label'], ['select_one yn', 'cfm', 'CFM utilisé ?'], ['integer', 'nb', 'Nombre']],
    choices: [['list_name', 'name', 'label'], ['yn', 'yes', 'Oui']],
    settings: [['form_title'], ['Suivi GD']],
  });
  await assert.rejects(parseSubmissions(xlsform), refused(400, /DÉFINITION d'un formulaire.*Importer un XLSForm/));
  await assert.rejects(parseSubmissions(oleFile(biffGlobals(['survey', 'choices', 'settings']))),
    refused(400, /DÉFINITION d'un formulaire/));
  // Un export de données dont une feuille s'appelle « survey » (sans choices/settings) reste lu.
  const data = await xlsxOf({ survey: [['_uuid', 'q1'], ['u1', 'oui']] });
  assert.equal((await parseSubmissions(data)).submissions.length, 1);
});

test('date illisible dans un CSV : 400 avec le n° de ligne réel et la colonne', async () => {
  const csv = '_uuid,SvyDate,q1\nu1,2026-05-03,a\n\nu2,30/01/2026,b\nu3,05/03/2026,c\nu4,2026-05-04,d\n';
  await assert.rejects(parseSubmissions(Buffer.from(csv)), (err) => {
    assert.equal(err.statusCode, 400);
    assert.match(err.message, /Date illisible à la ligne 4, colonne « SvyDate » : « 30\/01\/2026 »/);
    assert.match(err.message, /AAAA-MM-JJ/);
    assert.match(err.message, /Autres lignes concernées : 5\./);
    assert.deepEqual(err.details.invalidDates.map((d) => d.line), [4, 5]);
    return true;
  });
});

test('date illisible dans un XLSX : n° de ligne Excel', async () => {
  const buf = await xlsxOf({ data: [['_uuid', 'today', 'q1'], ['u1', '2026-05-03', 'a'], [], ['u2', 'le 3 mai', 'b']] });
  await assert.rejects(parseSubmissions(buf), refused(400, /ligne 4, colonne « today » : « le 3 mai »/));
});

test('date illisible dans des enregistrements (API, SPSS) : n° d\'enregistrement', () => {
  const rows = [{ _uuid: 'a', _submission_time: '2026-05-10T08:00:00' }, { _uuid: 'b', _submission_time: '10/05/2026' }];
  assert.throws(() => submissionsFromObjects(rows, 'kobo'), refused(400, /enregistrement n° 2, colonne « _submission_time »/));
});

test('CSV séparé par tabulations et texte UTF-16 (marque d\'ordre) lus', async () => {
  const tsv = '_uuid\tfield_office\tq1\nu1\tAmbovombe\toui';
  const r1 = await parseSubmissions(Buffer.from(tsv));
  assert.equal(r1.submissions[0].fieldOffice, 'Ambovombe');
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('_uuid;field_office\nu2;Tuléar', 'utf16le')]);
  const r2 = await parseSubmissions(utf16);
  assert.equal(r2.submissions[0].fieldOffice, 'Tuléar');
});

test('zip SPSS de Kobo : data.sav lu, dates SPSS converties, identifiants stables', async () => {
  const sav = buildSav({ cases: [[13989110400, 'AB', 'premier'], [13991702400, 'CD', 'second']], longNames: 'NUM=SvyDate\tSTR4=code\tSTR16=commentaire' });
  const zip = zipOf({ 'repeat_group.sav': buildSav({ cases: [[1, 'X', 'y']] }), 'data.sav': sav });
  const r = await parseSubmissions(zip, { filename: 'export.zip' });
  assert.equal(r.source, 'sav');
  assert.deepEqual(r.variables.map((v) => v.name), ['SvyDate', 'code', 'commentaire']);
  assert.deepEqual(r.submissions.map((s) => s.periodMonth), ['2026-01-01', '2026-03-01']);
  assert.equal(r.submissions[0].submittedAt.toISOString(), '2026-01-30T00:00:00.000Z');
  assert.match(r.submissions[0].externalId, /^sav:[0-9a-f]{24}$/);
  const again = await parseSubmissions(zip);
  assert.equal(again.submissions[0].externalId, r.submissions[0].externalId); // réimport idempotent
});

test('zip sans .sav, ou corrompu : 400 clair', async () => {
  await assert.rejects(parseSubmissions(zipOf({ 'notes.txt': 'x' })), refused(400, /sans fichier SPSS \(\.sav\)/));
  const broken = zipOf({ 'data.sav': buildSav({ cases: [[1, 'A', 'x']] }) }).subarray(0, 60);
  await assert.rejects(parseSubmissions(broken), refused(400, /illisible ou corrompue/));
});

/** Réécrit la taille décompressée DÉCLARÉE de chaque entrée (en-tête local + répertoire central). */
function declareSize(zipBuf, size) {
  const b = Buffer.from(zipBuf);
  for (let p = 0; p + 4 <= b.length; p += 1) {
    const sig = b.readUInt32LE(p);
    if (sig === 0x04034b50) b.writeUInt32LE(size, p + 22);
    else if (sig === 0x02014b50) b.writeUInt32LE(size, p + 24);
  }
  return b;
}

test('garde de décompression : data.sav annoncé à 216 Mo refusé (413) AVANT décompression', async () => {
  const zip = declareSize(zipOf({ 'data.sav': buildSav({ cases: [[1, 'A', 'x']] }) }), 215992459);
  await assert.rejects(parseSubmissions(zip), refused(413, /« data\.sav » ferait 216 Mo.*plafond de 150 Mo/));
  // Plafond relevé par configuration : la garde laisse passer la même archive.
  const lifted = { maxBytes: 300e6, maxRatio: 1e9, ratioFloorBytes: 10e6 };
  const r = await parseSubmissions(zip, { zipLimits: lifted });
  assert.equal(r.submissions.length, 1);
});

test('garde de décompression : bombe réelle (12 Mo de zéros, ×1000) refusée sans être décompressée', async () => {
  const bomb = zipOf({ 'data.sav': Buffer.alloc(12e6) });
  assert.ok(bomb.length < 100e3);
  await assert.rejects(parseSubmissions(bomb), refused(400, /refusée par sécurité.*fois/));
});

test('classeur .xlsx soumis à la même garde (ExcelJS décompresse tout le classeur)', async () => {
  const buf = declareSize(await xlsxOf({ data: [['_uuid'], ['u1']] }), 40e6);
  await assert.rejects(parseSubmissions(buf), refused(413, /ferait \d+ Mo/));
});

/* ------------------------------------------------------------------------
 * Colonnes réelles des exports Kobo du pays (GD, SMP, Nutrition, MIARO,
 * Résilience) et identifiant Kobo commun à tous les formats.
 * ---------------------------------------------------------------------- */
const { valueOf } = require('../src/modules/monitoring/submissionsImport');

test('exports réels : codes de lieu et site reconnus (GD, Nutrition, cantines, MIARO, Résilience)', () => {
  const cases = [
    { headers: ['Adm1Code_gd', 'Adm2Code_gd', 'Adm3Code_gd', 'DPName'], row: ['MG23', 'MG23209', 'MG23209070', 'MG23209070001'],
      want: { admin1: 'MG23', admin2: 'MG23209', admin3: 'MG23209070', site: 'MG23209070001' } },
    { headers: ['Adm1Code_MAM', 'Adm2Code_MAM', 'Adm3Code_MAM', 'Adm4Code_MAM', 'DPName'], row: ['MG51', 'MG51506', 'MG51506013', 'Amboro', 'Antatabe'],
      want: { admin1: 'MG51', admin3: 'MG51506013', admin4: 'Amboro', site: 'Antatabe' } },
    { headers: ['Adm1Code_SMP', 'Adm2Code_SMP', 'Adm3Code_SMP', 'Adm4Code_SMP'], row: ['MG53', 'MG25222', '94', '613100021'],
      want: { admin1: 'MG53', admin2: 'MG25222', admin3: undefined, site: '613100021' } },
    { headers: ['Adm1Name', 'Adm2Name', 'Adm3Name', 'POIName'], row: ['MG52', 'MG52516a', 'MG52516130', 'MG52516130033053'],
      want: { admin1: 'MG52', admin3: 'MG52516130', site: 'MG52516130033053' } },
    { headers: ['Adm1Code', 'Adm3Code', 'Adm4Code', 'ADMIN5Name_DP'], row: ['MG51', 'MG51507090', 'MG51507090001', 'MANIRY CENTRE'],
      want: { admin1: 'MG51', admin3: 'MG51507090', admin4: 'MG51507090001', site: 'MANIRY CENTRE' } },
  ];
  for (const c of cases) {
    const picks = buildLookup(c.headers, [c.row]);
    for (const [field, v] of Object.entries(c.want)) assert.equal(valueOf(picks, field, c.row), v, `${c.headers.join(',')} → ${field}`);
  }
});

test('réponse « autre » (999) : la précision saisie dans la colonne voisine est retenue', () => {
  const headers = ['DPName', 'DPName_Other', 'Adm4Code', 'Adm_4_autres'];
  const row = ['999', 'BEARA AMBOLAMENA', '999', 'Sarodrano'];
  const picks = buildLookup(headers, [row]);
  assert.equal(valueOf(picks, 'site', row), 'BEARA AMBOLAMENA');
  assert.equal(valueOf(picks, 'admin4', row), 'Sarodrano');
  const plain = ['MG23209070001', '', 'MG51507090001', ''];
  assert.equal(valueOf(picks, 'site', plain), 'MG23209070001');
});

test('identifiant Kobo identique en Excel (_uuid) et en SPSS (@_uuid, instanceID) : pas de doublon', async () => {
  const xlsx = 'x.csv';
  const viaExcel = await parseSubmissions(Buffer.from('_uuid,_id,q1\n77bbf6c3-6aea,12,a', 'utf8'), { filename: xlsx });
  const viaSpss = await parseSubmissions(Buffer.from('@_uuid,instanceID,q1\n77bbf6c3-6aea,uuid:77bbf6c3-6aea,a', 'utf8'), { filename: xlsx });
  const viaInstance = await parseSubmissions(Buffer.from('instanceID,q1\nuuid:77bbf6c3-6aea,a', 'utf8'), { filename: xlsx });
  assert.equal(viaExcel.submissions[0].externalId, '77bbf6c3-6aea');
  assert.equal(viaSpss.submissions[0].externalId, '77bbf6c3-6aea');
  assert.equal(viaInstance.submissions[0].externalId, '77bbf6c3-6aea');
});
