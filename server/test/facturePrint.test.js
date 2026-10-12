const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { summarize } = require('../src/modules/tpm/reportMath');

// Modules PURS de l'interface (ES modules sans React ni DOM) : impression de la
// facture et calcul des postes de l'éditeur.
const webLib = (file) => import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'src', 'lib', file)).href);

// Lignes telles que l'éditeur les tient : « % bailleur » en POURCENT, vide = 100 %.
const ROWS = [
  { lineCode: 'IV.suivi', designation: 'Indemnité agents', unit: 'j', unitCount: 60, unitCost: 40000, bailleurPct: '' },
  { lineCode: 'IV.suivi', designation: 'Salaire', unit: 'mois', unitCount: 1, unitCost: 1000000, bailleurPct: 90 },
  { lineCode: 'V.locaux', designation: 'Loyer bureau', unit: 'mois', unitCount: 1, unitCost: 500000, bailleurPct: '0' },
];

// Espaces insécables (U+00A0, U+202F) des montants formatés : remplacés par une espace simple.
const NBSP = new RegExp(`[${String.fromCharCode(0xa0, 0x202f)}]`, 'g');
const plain = (s) => s.replace(NBSP, ' ');
/** Cellules numériques (class="n") de la ligne imprimée dont la désignation est `name`. */
function printedCells(html, name) {
  const tr = plain(html).split('<tr').map((chunk) => chunk.split('</tr>')[0])
    .find((chunk) => chunk.includes(`<div class="d">${name}</div>`));
  assert.ok(tr, `ligne « ${name} » imprimée`);
  return [...tr.matchAll(/<td class="n">([^<]*)<\/td>/g)].map((m) => m[1]);
}

test('postesMath : part bailleur = montant × %, part ONG = le reste, en centimes', async () => {
  const m = await webLib('postesMath.js');
  assert.equal(m.posteFunder(ROWS[1]), 900000);
  assert.equal(m.posteOng(ROWS[1]), 100000);
  assert.equal(m.posteFunder(ROWS[2]), 0);
  assert.equal(m.posteOng(ROWS[2]), 500000);
  assert.equal(m.pctFraction(ROWS[0]), 1, 'vide = 100 %');
  assert.equal(m.pctFraction({ bailleurPct: '90,5' }), 0.905, 'virgule décimale acceptée');
  assert.equal(m.pctFraction({ bailleurPct: '', payBy: 'ong' }), 0, 'ancienne ligne « ONG »');
  // Montant à demi-centime : l'arrondi se fait une fois, au centime, comme le serveur.
  const half = { lineCode: 'IV.suivi', unitCount: 1, unitCost: 1478998.5, bailleurPct: 90 };
  assert.equal(m.posteFunder(half), 1331098.65);
  assert.equal(m.posteOng(half), 147899.85);
});

test('postesMath et reportMath donnent les mêmes totaux (écran = serveur)', async () => {
  const m = await webLib('postesMath.js');
  const rows = [...ROWS, { lineCode: 'IV.suivi', designation: 'Tiers', unitCount: 3, unitCost: 333333.33, bailleurPct: 33.333 }];
  const screen = m.postesTotals(rows);
  const server = summarize(rows.map((r) => ({ ...r, bailleurPct: m.pctFraction(r) })));
  assert.equal(screen.total, server.total);
  assert.equal(screen.funder, server.funder);
  assert.equal(screen.ong, server.ong);
  for (const s of server.sections) {
    assert.deepEqual(screen.bySection[s.code], { total: s.total, funder: s.funder, ong: s.ong }, s.code);
  }
});

test('finance-30 : l\'impression respecte le % bailleur de chaque ligne (90 % → 90/10 ; 0 % → 0/100)', async () => {
  const { facturePrintHtml } = await webLib('facturePrint.js');
  const html = facturePrintHtml({
    head: { partnerName: 'ONG Lalana', contractNumero: 'CTR-2026-0002', invoiceNo: 'FAC-09', periodMonth: '2026-05', advanceDeducted: 0 },
    rows: ROWS,
  });
  // Colonnes numériques : Qté · Coût unit. · Montant · % bailleur · À payer par le bailleur · À payer par l'ONG
  assert.deepEqual(printedCells(html, 'Salaire'), ['1', '1 000 000 Ar', '1 000 000 Ar', '90 %', '900 000 Ar', '100 000 Ar']);
  assert.deepEqual(printedCells(html, 'Loyer bureau'), ['1', '500 000 Ar', '500 000 Ar', '0 %', '0 Ar', '500 000 Ar']);
  assert.deepEqual(printedCells(html, 'Indemnité agents'), ['60', '40 000 Ar', '2 400 000 Ar', '100 %', '2 400 000 Ar', '0 Ar']);
  const text = plain(html);
  assert.match(text, /À payer par le bailleur \(Réalisé\)<\/td><td class="n">3 300 000 Ar/);
  assert.match(text, /À payer par l'ONG<\/td><td class="n">600 000 Ar/);
  assert.doesNotMatch(text, /À la charge de<\/th>/, 'plus de colonne binaire « Bailleur / ONG »');
});
