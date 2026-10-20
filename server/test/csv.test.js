const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const server = require('../src/modules/common/csv');
const { directoryCsv } = require('../src/modules/settings/localities.domain');

const BOM = String.fromCharCode(0xfeff);

// Même table de cas pour l'écrivain serveur et son miroir web (web/src/lib/csv.js).
const CASES = [
  ['=1+1', "'=1+1"], ['+33 6 12', "'+33 6 12"], ['@SUM(A1)', "'@SUM(A1)"], ['-2+3', "'-2+3"],
  ['=HYPERLINK("http://x")', "'=HYPERLINK(\"http://x\")"], ['\t=1', "'\t=1"], ['\r=1', "'\r=1"],
  ['--1', "'--1"], ['- 1+1', "'- 1+1"], ['ok', 'ok'], ['a=b', 'a=b'], ['', ''], [null, ''], [undefined, ''],
  // Géopoint Kobo réel (lat lon alt précision) : plusieurs signes, reste du texte (sinon #NUL! dans Excel).
  ['-23.37307 47.6435553 -6.1 4.9', "'-23.37307 47.6435553 -6.1 4.9"],
  // Les nombres restent des nombres (dont les coordonnées négatives en texte des fichiers réels) ; tiret seul intact.
  [-5, '-5'], [0, '0'], [12.5, '12.5'], ['-12', '-12'], ['-12.5', '-12.5'], ['-23.37307', '-23.37307'], ['-1 234,50', '-1 234,50'],
  [`-1${String.fromCharCode(0x202f)}234,50`, `-1${String.fromCharCode(0x202f)}234,50`], ['-12 %', '-12 %'], ['-0,5', '-0,5'], ['-', '-'],
];

function checkWriter(w, label) {
  for (const [input, expected] of CASES) assert.equal(w.neutralizeFormula(input), expected, `${label} ${JSON.stringify(input)}`);
  // Acceptation R0 : une cellule « =1+1 » exportée commence par une apostrophe.
  assert.equal(w.csvCell('=1+1'), "'=1+1");
  assert.equal(w.csvCell('a;b'), '"a;b"');
  assert.equal(w.csvCell('dit "oui"'), '"dit ""oui"""');
  assert.equal(w.csvCell('=1;2'), '"\'=1;2"');
  assert.equal(w.csvCell('a,b', ','), '"a,b"');
  const file = w.toCsv([['Nom', 'Montant'], ['=cmd|calc', -1500], ['Site; B', '-12 %']]);
  assert.equal(file, `${BOM}Nom;Montant\r\n'=cmd|calc;-1500\r\n"Site; B";-12 %\r\n`);
  assert.equal(w.toCsv([['a']], { bom: false, eol: '\n' }), 'a\n');
  // Taux pour Excel en français : virgule décimale, « % » collé ; vide sans taux.
  assert.equal(w.csvPercent(0.123), '12,3%');
  assert.equal(w.csvPercent(0.12), '12%');
  assert.equal(w.csvPercent(1 / 3), '33,3%');
  assert.equal(w.csvPercent(0.0048), '0,5%');
  assert.equal(w.csvPercent(1 / 3, 0), '33%');
  assert.equal(w.csvPercent(null), '');
  assert.equal(w.csvPercent(Number.NaN), '');
  assert.equal(w.toCsv([['Taux'], [w.csvPercent(0.123)]], { bom: false }), 'Taux\r\n12,3%\r\n');
}

test('CSV serveur : formules neutralisées, nombres négatifs intacts, échappement', () => {
  checkWriter(server, 'serveur');
});

test('CSV web (lib/csv.js) : mêmes règles que le serveur', async (t) => {
  const file = path.join(__dirname, '../../web/src/lib/csv.js');
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return; }
  checkWriter(await import(pathToFileURL(file).href), 'web');
});

test('export CSV des localités : libellé piégé neutralisé, coordonnées négatives conservées', () => {
  const csv = directoryCsv([{ ancestors: ['=HYPERLINK("http://x","clic")'], name: '@Commune', pcode: '+MG1', lat: -25.03, lng: '46.98' }], ['Région', 'District']);
  const line = csv.split('\r\n')[1];
  assert.equal(line, '"\'=HYPERLINK(""http://x"",""clic"")";\'@Commune;\'+MG1;-25.03;46.98');
});

test('Content-Disposition : nom de fichier saisi par l\'utilisateur assaini, UTF-8 conservé', () => {
  assert.equal(server.attachmentHeader('Localites_Régions.csv'),
    'attachment; filename="Localites_Regions.csv"; filename*=UTF-8\'\'Localites_R%C3%A9gions.csv');
  const h = server.attachmentHeader('a"b\r\nSet-Cookie: x/ő\\.csv');
  assert.doesNotMatch(h, /[\r\n]/);
  assert.match(h, /^attachment; filename="a_b__Set-Cookie: x_o_\.csv"; filename\*=UTF-8''/);
  assert.equal(server.attachmentHeader(''), 'attachment; filename="export"; filename*=UTF-8\'\'export');
});
