const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { buildInvoiceWorkbook } = require('../src/modules/tpm/factureXlsx');
const { summarize } = require('../src/modules/tpm/reportMath');

test('invoice workbook has a Facture + État sheet and round-trips', async () => {
  const items = [
    { lineCode: 'IV.suivi', designation: 'Indemnité agents', unit: 'j', unitCount: 60, unitCost: 40000, bailleurPct: 1 },
    { lineCode: 'IV.suivi', designation: 'Salaire', unit: 'mois', unitCount: 1, unitCost: 1000000, bailleurPct: 0.9 },
  ];
  const report = {
    partnerName: 'ONG Lalana', contractNumero: 'CTR-2026-0002', reference: '01/10/25_Ciblage',
    numeroFla: 'FLA-2025-LAL-002', numeroPo: 'PO-1', numeroVendor: 'V-1',
    periodMonth: '2026-05-01', dateDebut: '2025-10-01', dateFin: '2026-09-30',
    advanceDeducted: 0, managementFeePct: 0.07, items, summary: summarize(items),
  };
  const invoice = { report, budgetByLine: { 'IV.suivi': 5000000 }, cumulByLine: { 'IV.suivi': 3300000 } };

  const wb = buildInvoiceWorkbook(invoice);
  const buf = await wb.xlsx.writeBuffer();
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(Buffer.from(buf));
  const names = wb2.worksheets.map((w) => w.name);
  assert.ok(names.includes('Facture'), 'a Facture (INVOICE) sheet');
  assert.ok(names.includes('État des dépenses'), 'a detailed état sheet');
});
