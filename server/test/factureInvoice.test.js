const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { buildInvoiceWorkbook } = require('../src/modules/tpm/factureXlsx');
const { summarize } = require('../src/modules/tpm/reportMath');

// Postes du gabarit réel : une ligne à 100 % bailleur, une ligne « ×90 % »
// (« à payer par le PAM » = montant × 90 % dans le classeur de référence) et
// une ligne entièrement à la charge de l'ONG (0 %).
const ITEMS = [
  { lineCode: 'IV.suivi', designation: 'Indemnité agents', unit: 'j', unitCount: 60, unitCost: 40000, bailleurPct: 1 },
  { lineCode: 'IV.suivi', designation: 'Salaire', unit: 'mois', unitCount: 1, unitCost: 1000000, bailleurPct: 0.9 },
  { lineCode: 'V.locaux', designation: 'Loyer bureau', unit: 'mois', unitCount: 1, unitCost: 500000, bailleurPct: 0, payBy: 'ong' },
];

function invoiceFixture(extra = {}) {
  const report = {
    partnerName: 'ONG Lalana', contractNumero: 'CTR-2026-0002',
    // Numéro de facture et référence sont DEUX champs distincts.
    invoiceNo: '01/10/25_Ciblage', reference: 'REF-INTERNE-7',
    numeroFla: 'FLA-2025-LAL-002', numeroPo: 'PO-1', numeroVendor: 'V-1',
    periodMonth: '2026-05-01', dateDebut: '2025-10-01', dateFin: '2026-09-30',
    advanceDeducted: 0, managementFeePct: 0.07, items: ITEMS, summary: summarize(ITEMS), ...extra,
  };
  return { report, budgetByLine: { 'IV.suivi': 5000000 }, cumulByLine: { 'IV.suivi': 3300000 } };
}

async function roundTrip(invoice) {
  const buf = await buildInvoiceWorkbook(invoice).xlsx.writeBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(buf));
  return wb;
}
// Valeur affichée d'une cellule : le résultat mis en cache d'une formule (exceljs
// n'écrit pas un résultat nul : il se relit absent, donc 0).
const valueOf = (cell) => (cell.value && typeof cell.value === 'object' && 'formula' in cell.value
  ? (cell.value.result ?? 0) : cell.value);

test('invoice workbook has a Facture + État sheet and round-trips', async () => {
  const wb = await roundTrip(invoiceFixture());
  const names = wb.worksheets.map((w) => w.name);
  assert.ok(names.includes('Facture'), 'a Facture (INVOICE) sheet');
  assert.ok(names.includes('État des dépenses'), 'a detailed état sheet');
});

test('finance-17 : la cellule B4 de la feuille Facture porte le numéro de facture, jamais la référence', async () => {
  const ws = (await roundTrip(invoiceFixture())).getWorksheet('Facture');
  assert.equal(ws.getCell('A4').value, 'Numéro de Facture');
  assert.equal(ws.getCell('B4').value, '01/10/25_Ciblage');
  const sansNumero = (await roundTrip(invoiceFixture({ invoiceNo: null }))).getWorksheet('Facture');
  assert.equal(sansNumero.getCell('B4').value, '', 'sans numéro : vide, pas la référence');
});

test('finance-30 : l\'état exporté respecte le % bailleur de chaque ligne, en centimes', async () => {
  const ws = (await roundTrip(invoiceFixture())).getWorksheet('État des dépenses');
  const header = ws.getRow(6).values.slice(1);
  assert.deepEqual(header.slice(5, 9), ['Montant', '% bailleur', 'À payer par le bailleur', "À payer par l'ONG"]);

  const rows = {};
  ws.eachRow((row) => { const d = row.getCell(2).value; if (typeof d === 'string') rows[d] = row; });
  const line = (name) => {
    const r = rows[name];
    return { montant: valueOf(r.getCell(6)), pct: r.getCell(7).value, bailleur: valueOf(r.getCell(8)), ong: valueOf(r.getCell(9)) };
  };
  assert.deepEqual(line('Salaire'), { montant: 1000000, pct: 0.9, bailleur: 900000, ong: 100000 });
  assert.deepEqual(line('Loyer bureau'), { montant: 500000, pct: 0, bailleur: 0, ong: 500000 });
  assert.deepEqual(line('Indemnité agents'), { montant: 2400000, pct: 1, bailleur: 2400000, ong: 0 });
  // Formules vivantes : part bailleur = montant × %, part ONG = le reste.
  const r = rows.Salaire.number;
  assert.equal(rows.Salaire.getCell(8).value.formula, `ROUND(F${r}*G${r},2)`);
  assert.equal(rows.Salaire.getCell(9).value.formula, `F${r}-H${r}`);

  // Totaux : identiques à reportMath.summarize (bailleur 3 300 000, ONG 600 000).
  const totals = {};
  ws.eachRow((row) => { const l = row.getCell(5).value; if (typeof l === 'string') totals[l] = row; });
  assert.equal(valueOf(totals['Total des dépenses'].getCell(6)), 3900000);
  assert.equal(valueOf(totals['À payer par le bailleur (Réalisé)'].getCell(8)), 3300000);
  assert.equal(valueOf(totals["À payer par l'ONG"].getCell(9)), 600000);
});

test('la feuille Facture compte la part bailleur du mois (montant × %), pas le montant brut', async () => {
  const ws = (await roundTrip(invoiceFixture())).getWorksheet('Facture');
  let suivi = null;
  ws.eachRow((row) => { if (row.getCell(3).value === 3300000 && row.getCell(2).value === 5000000) suivi = row; });
  assert.ok(suivi, 'ligne IV.suivi : budget 5 000 000, dépenses du mois 2 400 000 + 900 000');
});
