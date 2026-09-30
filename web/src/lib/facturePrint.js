import { SECTIONS, SECTION_OF, LINE_LABELS } from './budgetCatalog.js';
import { formatAr } from './format.js';

const PAYER = { bailleur: 'Bailleur', ong: 'ONG' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Open a clean, print-optimized view of a facture in a new window and trigger
 * the browser print dialog — which lets the user save it as PDF. No server PDF
 * engine, no extra dependency: reliable and cross-platform.
 *
 * rows: editor rows [{lineCode,designation,unit,unitCount,unitCost,payBy,observation}]
 */
/** Build the print-ready HTML of a facture (pure — no DOM). */
export function facturePrintHtml({ head, rows, contract }) {
  const amount = (r) => (Number(r.unitCount) || 0) * (Number(r.unitCost) || 0);
  let total = 0; let funder = 0; let ong = 0;
  const bySec = new Map();
  for (const r of rows) {
    if (!(r.designation || '').trim()) continue;
    const a = amount(r);
    total += a;
    if (r.payBy === 'ong') ong += a; else funder += a;
    const code = SECTION_OF[r.lineCode] || '?';
    if (!bySec.has(code)) bySec.set(code, []);
    bySec.get(code).push(r);
  }

  const secLabel = Object.fromEntries(SECTIONS.map((s) => [s.code, s.label]));
  let sectionsHtml = '';
  for (const s of SECTIONS) {
    const items = bySec.get(s.code);
    if (!items || !items.length) continue;
    let sub = 0;
    const lines = items.map((r) => {
      const a = amount(r); sub += a;
      return `<tr>
        <td>${esc(LINE_LABELS[r.lineCode] || r.lineCode)}<div class="d">${esc(r.designation)}</div></td>
        <td>${esc(r.unit || '')}</td>
        <td class="n">${esc(r.unitCount || '')}</td>
        <td class="n">${formatAr(Number(r.unitCost) || 0)}</td>
        <td class="n">${formatAr(a)}</td>
        <td>${PAYER[r.payBy] || 'Bailleur'}</td>
        <td>${esc(r.observation || '')}</td></tr>`;
    }).join('');
    sectionsHtml += `<tr class="sec"><td colspan="7">${s.code}. ${esc(secLabel[s.code])}</td></tr>${lines}
      <tr class="sub"><td colspan="4"></td><td class="n">${formatAr(sub)}</td><td colspan="2">Sous-total ${s.code}</td></tr>`;
  }

  const periode = head.periodEnd && head.periodEnd !== String(head.periodMonth).slice(0, 7)
    ? `${String(head.periodMonth || '').slice(0, 7)} → ${head.periodEnd}` : String(head.periodMonth || '').slice(0, 7);
  const net = head.advanceDeducted > 0 ? `<tr><td class="lbl">Net après avance déduite</td><td class="n">${formatAr(funder - head.advanceDeducted)}</td></tr>` : '';

  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Facture ${esc(head.invoiceNo || '')}</title>
  <style>
    * { font-family: 'Segoe UI', Roboto, Arial, sans-serif; box-sizing: border-box; }
    body { margin: 32px; color: #1a2233; font-size: 12px; }
    h1 { font-size: 18px; margin: 0 0 2px; color: #1f4fd6; }
    .meta { color: #5c6b82; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #e2e8f1; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background: #1f4fd6; color: #fff; font-size: 11px; }
    .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .d { color: #5c6b82; font-size: 11px; }
    tr.sec td { background: #eef1f6; font-weight: 700; color: #1f4fd6; }
    tr.sub td { font-weight: 700; background: #fafbfc; }
    .totals { margin-top: 18px; width: 320px; margin-left: auto; }
    .totals td { padding: 6px 8px; }
    .totals .lbl { font-weight: 700; }
    .totals .grand td { border-top: 2px solid #cbd6e4; }
    .sign { margin-top: 40px; display: flex; justify-content: space-between; color: #5c6b82; }
    @media print { body { margin: 12mm; } }
  </style></head><body>
  <h1>État des dépenses — Facture</h1>
  <div class="meta">${esc(head.partnerName || '')} · ${esc(head.contractNumero || '')}<br>
  Période : ${esc(periode)}${head.invoiceNo ? ` · Facture n° ${esc(head.invoiceNo)}` : ''}${contract ? ` · Budget Suivi/TPM ${formatAr(contract.monitoringBudget)}` : ''}</div>
  <table><thead><tr><th>Ligne / Désignation</th><th>Unité</th><th class="n">Qté</th><th class="n">Coût unit.</th><th class="n">Montant</th><th>À la charge de</th><th>Observation</th></tr></thead>
  <tbody>${sectionsHtml}</tbody></table>
  <table class="totals">
    <tr><td class="lbl">Total des dépenses</td><td class="n">${formatAr(total)}</td></tr>
    <tr class="grand"><td class="lbl">À la charge du bailleur (Réalisé)</td><td class="n">${formatAr(funder)}</td></tr>
    <tr><td class="lbl">À la charge de l'ONG</td><td class="n">${formatAr(ong)}</td></tr>
    ${net}
  </table>
  <div class="sign"><div>Préparé par : ____________________</div><div>Validé par : ____________________</div></div>
  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 250); };</script>
  </body></html>`;
  return html;
}

/**
 * Open a facture in a new window and trigger the browser print dialog — which
 * lets the user save it as PDF. No server PDF engine, no extra dependency.
 */
export function openFacturePrint(input) {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.open(); w.document.write(facturePrintHtml(input)); w.document.close();
  return true;
}
